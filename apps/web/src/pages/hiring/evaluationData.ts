import type { SupabaseClient } from "@supabase/supabase-js";
import {
  inferFamiliesForJobPhrase,
  inferFamiliesFromText,
  type SignalFamilyId,
} from "./signalFamilies";

function pushSignal(buf: Map<string, string>, raw: string) {
  const t = raw.trim();
  if (!t) return;
  const k = t.toLowerCase();
  if (!buf.has(k)) buf.set(k, t);
}

function flattenTextArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? "").trim()).filter(Boolean);
}

const DESCRIPTION_CAP = 4000;

function clipDescription(s: string | null | undefined): string {
  if (!s?.trim()) return "";
  const t = s.trim();
  return t.length <= DESCRIPTION_CAP ? t : t.slice(0, DESCRIPTION_CAP);
}

export type JobSignals = {
  rawSignals: string[];
  /** Union of inferred families from HR-style role text (not competency catalogue). */
  families: SignalFamilyId[];
};

export type CandidateSignals = {
  rawSignals: string[];
  /** Per-tag / per-field strict family hits. */
  familiesStrict: SignalFamilyId[];
  /** Strict ∪ loose blob inference (captures implicit wording in descriptions). */
  familiesLoose: SignalFamilyId[];
};

function dedupeIds(ids: SignalFamilyId[]): SignalFamilyId[] {
  const seen = new Set<string>();
  const out: SignalFamilyId[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function addFamiliesFromText(
  text: string,
  tier: "strict" | "loose",
  into: Set<SignalFamilyId>,
): void {
  for (const id of inferFamiliesFromText(text, tier)) into.add(id);
}

/**
 * Hiring fit job-side signals: title, role summary, responsibilities, requirements, and skills
 * (realistic vs CVs). Does not use internal competency catalogue mappings.
 */
export async function fetchJobSignals(
  client: SupabaseClient,
  jobProfileId: string,
): Promise<JobSignals> {
  const buf = new Map<string, string>();

  const { data: jp, error: jpErr } = await client
    .from("job_profiles")
    .select("title, role_summary")
    .eq("id", jobProfileId)
    .maybeSingle();

  if (jpErr) {
    console.warn("job_profiles (signals):", jpErr.message);
  } else if (jp) {
    const row = jp as { title?: string | null; role_summary?: string | null };
    if (row.title?.trim()) pushSignal(buf, row.title.trim());
    const rs = clipDescription(row.role_summary);
    if (rs) {
      for (const chunk of rs.split(/\n+/).map((s) => s.trim()).filter(Boolean)) {
        pushSignal(buf, chunk);
      }
    }
  }

  const [
    { data: respRows, error: respErr },
    { data: reqRows, error: reqErr },
    { data: skillRows, error: skillErr },
  ] = await Promise.all([
    client
      .from("job_profile_responsibilities")
      .select("description, order_index")
      .eq("job_profile_id", jobProfileId)
      .order("order_index", { ascending: true }),
    client
      .from("job_profile_requirements")
      .select("description, order_index")
      .eq("job_profile_id", jobProfileId)
      .order("order_index", { ascending: true }),
    client
      .from("job_profile_skills")
      .select("name")
      .eq("job_profile_id", jobProfileId),
  ]);

  if (respErr) console.warn("job_profile_responsibilities (signals):", respErr.message);
  if (reqErr) console.warn("job_profile_requirements (signals):", reqErr.message);
  if (skillErr) console.warn("job_profile_skills (signals):", skillErr.message);

  for (const raw of respRows ?? []) {
    const d = String((raw as { description: string }).description ?? "").trim();
    if (d) pushSignal(buf, d);
  }
  for (const raw of reqRows ?? []) {
    const d = String((raw as { description: string }).description ?? "").trim();
    if (d) pushSignal(buf, d);
  }
  for (const raw of skillRows ?? []) {
    const n = String((raw as { name: string }).name ?? "").trim();
    if (n) pushSignal(buf, n);
  }

  const rawSignals = [...buf.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );

  const famSet = new Set<SignalFamilyId>();
  for (const phrase of rawSignals) {
    for (const f of inferFamiliesForJobPhrase(phrase)) famSet.add(f);
  }
  if (famSet.size === 0 && rawSignals.length > 0) {
    for (const f of inferFamiliesForJobPhrase(rawSignals.join(" "))) famSet.add(f);
  }

  return {
    rawSignals,
    families: dedupeIds([...famSet]),
  };
}

export type FetchCandidateSignalsOptions = {
  /**
   * Structured CV from `hiring_applications.cv_extract_snapshot` (import-cv-extract shape).
   * Merged after My Experience so external applicants without profile evidence still get signals.
   */
  cvExtractSnapshot?: Record<string, unknown> | null;
};

/**
 * Pull phrases from stored CV extract JSON into the same signal buffers as My Experience.
 */
function appendCvExtractSnapshotToSignals(
  buf: Map<string, string>,
  strictFam: Set<SignalFamilyId>,
  looseFam: Set<SignalFamilyId>,
  snap: Record<string, unknown>,
): void {
  const absorb = (text: string) => {
    const t = text.trim();
    if (!t) return;
    pushSignal(buf, t);
    addFamiliesFromText(t, "strict", strictFam);
    addFamiliesFromText(t, "loose", looseFam);
  };

  const prof = snap.profile;
  if (prof && typeof prof === "object" && !Array.isArray(prof)) {
    const pr = prof as Record<string, unknown>;
    for (const key of ["summary", "first_name", "last_name", "location"] as const) {
      const v = pr[key];
      if (typeof v === "string" && v.trim()) absorb(v.trim());
    }
  }

  const wx = snap.work_experience;
  if (Array.isArray(wx)) {
    for (const item of wx) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const o = item as Record<string, unknown>;
      for (const key of [
        "role_title",
        "organisation_name",
        "description",
        "industry",
      ] as const) {
        const v = o[key];
        if (typeof v === "string" && v.trim()) absorb(clipDescription(v));
      }
      for (const key of ["skills", "methods", "tools"] as const) {
        const arr = o[key];
        if (!Array.isArray(arr)) continue;
        for (const x of arr) {
          if (typeof x === "string" && x.trim()) absorb(x.trim());
        }
      }
    }
  }

  const projects = snap.projects;
  if (Array.isArray(projects)) {
    for (const item of projects) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const o = item as Record<string, unknown>;
      for (const key of [
        "project_name",
        "client",
        "role",
        "description",
        "industry",
        "parent_role_title_hint",
        "parent_organisation_hint",
      ] as const) {
        const v = o[key];
        if (typeof v === "string" && v.trim()) absorb(clipDescription(v));
      }
      for (const key of ["skills", "methods", "tools"] as const) {
        const arr = o[key];
        if (!Array.isArray(arr)) continue;
        for (const x of arr) {
          if (typeof x === "string" && x.trim()) absorb(x.trim());
        }
      }
    }
  }

  for (const section of ["qualifications", "certifications"] as const) {
    const arr = snap[section];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const o = item as Record<string, unknown>;
      for (const key of ["title", "notes", "issuer"] as const) {
        const v = o[key];
        if (typeof v === "string" && v.trim()) absorb(v.trim());
      }
    }
  }
}

/**
 * Evidence-linked signals: experience + projects (skills, methods, tools, industry, titles, descriptions).
 * Optional `cvExtractSnapshot` merges application-scoped extract (external apply) into signals.
 */
export async function fetchCandidateSignals(
  client: SupabaseClient,
  candidateUserId: string,
  options?: FetchCandidateSignalsOptions,
): Promise<CandidateSignals> {
  const buf = new Map<string, string>();
  const strictFam = new Set<SignalFamilyId>();
  const looseFam = new Set<SignalFamilyId>();

  const absorb = (text: string) => {
    const t = text.trim();
    if (!t) return;
    pushSignal(buf, t);
    addFamiliesFromText(t, "strict", strictFam);
    addFamiliesFromText(t, "loose", looseFam);
  };

  const { data: expRows, error: expErr } = await client
    .from("user_experience")
    .select(
      "skills, methods, tools, industry, role_title, organisation_name, description",
    )
    .eq("user_id", candidateUserId);

  if (expErr) {
    console.warn("user_experience (signals):", expErr.message);
  } else {
    for (const row of expRows ?? []) {
      const r = row as {
        skills?: string[] | null;
        methods?: string[] | null;
        tools?: string[] | null;
        industry?: string | null;
        role_title?: string | null;
        organisation_name?: string | null;
        description?: string | null;
      };
      for (const x of flattenTextArray(r.skills)) absorb(x);
      for (const x of flattenTextArray(r.methods)) absorb(x);
      for (const x of flattenTextArray(r.tools)) absorb(x);
      if (r.industry?.trim()) absorb(r.industry.trim());
      if (r.role_title?.trim()) absorb(r.role_title.trim());
      if (r.organisation_name?.trim()) absorb(r.organisation_name.trim());
      const desc = clipDescription(r.description);
      if (desc) absorb(desc);
    }
  }

  const { data: projRows, error: projErr } = await client
    .from("user_experience_projects")
    .select("skills, methods, tools, project_name, client, role, description, industry")
    .eq("user_id", candidateUserId);

  if (projErr) {
    console.warn("user_experience_projects (signals):", projErr.message);
  } else {
    for (const row of projRows ?? []) {
      const r = row as {
        skills?: string[] | null;
        methods?: string[] | null;
        tools?: string[] | null;
        project_name?: string | null;
        client?: string | null;
        role?: string | null;
        description?: string | null;
        industry?: string | null;
      };
      for (const x of flattenTextArray(r.skills)) absorb(x);
      for (const x of flattenTextArray(r.methods)) absorb(x);
      for (const x of flattenTextArray(r.tools)) absorb(x);
      if (r.project_name?.trim()) absorb(r.project_name.trim());
      if (r.client?.trim()) absorb(r.client.trim());
      if (r.role?.trim()) absorb(r.role.trim());
      if (r.industry?.trim()) absorb(r.industry.trim());
      const pdesc = clipDescription(r.description);
      if (pdesc) absorb(pdesc);
    }
  }

  const snap = options?.cvExtractSnapshot;
  if (snap && typeof snap === "object" && !Array.isArray(snap)) {
    appendCvExtractSnapshotToSignals(buf, strictFam, looseFam, snap);
  }

  const rawSignals = [...buf.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );

  const blob = rawSignals.join(" ");
  addFamiliesFromText(blob, "loose", looseFam);
  for (const id of strictFam) looseFam.add(id);

  return {
    rawSignals,
    familiesStrict: dedupeIds([...strictFam]),
    familiesLoose: dedupeIds([...looseFam]),
  };
}
