import type {
  UserCertificationRow,
  UserExperienceRow,
  UserQualificationRow,
} from "./types";
import { mergeExtractedEvidenceTags } from "./evidenceTagEnrichment";
import { dedupeSkillsNormalized } from "./skillNormalization";

/** Normalised for duplicate checks */
export function normKey(s: string | null | undefined): string {
  if (s == null) return "";
  if (typeof s === "string") {
    return s.trim().toLowerCase().replace(/\s+/g, " ");
  }
  if (typeof s === "number" && Number.isFinite(s)) {
    return String(s).trim().toLowerCase().replace(/\s+/g, " ");
  }
  return "";
}

export type CvWorkExperienceDraft = {
  role_title: string;
  organisation_name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
  industry: string | null;
  skills: string[];
  methods: string[];
  tools: string[];
};

export type CvProjectDraft = {
  project_name: string;
  client: string | null;
  role: string | null;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  industry: string | null;
  skills: string[];
  methods: string[];
  tools: string[];
  parent_role_title_hint: string | null;
  parent_organisation_hint: string | null;
};

export type CvQualificationDraft = {
  title: string;
  issuer: string | null;
  qualification_type: string | null;
  date_achieved: string | null;
  notes: string | null;
  credential_url: string | null;
};

export type CvCertificationDraft = {
  title: string;
  issuer: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  renewal_required: boolean;
  notes: string | null;
  credential_url: string | null;
};

/** Parsed from optional \`profile\` object in the extract response (AI + server). */
export type CvProfileDraft = {
  first_name: string | null;
  last_name: string | null;
  summary: string | null;
  location: string | null;
  linkedin_url: string | null;
};

export type CvExtractedPayload = {
  work_experience: CvWorkExperienceDraft[];
  projects: CvProjectDraft[];
  qualifications: CvQualificationDraft[];
  certifications: CvCertificationDraft[];
  /** Present when the extractor returns a profile block (personal prefill + workspace import). */
  profile: CvProfileDraft | null;
};

function asStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const t = v.trim();
    return t ? t : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return null;
  return null;
}

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  return fallback;
}

function asStrArray(v: unknown): string[] {
  if (typeof v === "string") {
    const parts = v.split(/[,;\n]/).map((p) => p.trim()).filter(Boolean);
    const out: string[] = [];
    for (const p of parts) {
      const s = asStr(p);
      if (s) out.push(s);
    }
    return dedupeSkillsNormalized(out);
  }
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = asStr(x);
    if (s) out.push(s);
  }
  return dedupeSkillsNormalized(out);
}

function parseDate(v: unknown): string | null {
  const s = asStr(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  return null;
}

function asObjectArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v != null && typeof v === "object") return [v];
  return [];
}

function parseCvProfileBlock(
  raw: unknown,
): CvProfileDraft | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  const first_name = asStr(p.first_name);
  const last_name = asStr(p.last_name);
  const summary = asStr(p.summary);
  const location = asStr(p.location);
  const linkedin_url = asStr(p.linkedin_url ?? p.linkedin);
  if (!first_name && !last_name && !summary && !location && !linkedin_url) {
    return null;
  }
  return {
    first_name,
    last_name,
    summary,
    location,
    linkedin_url,
  };
}

export function parseCvPayload(raw: unknown): CvExtractedPayload {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      work_experience: [],
      projects: [],
      qualifications: [],
      certifications: [],
      profile: null,
    };
  }
  const o = raw as Record<string, unknown>;
  const we = asObjectArray(o.work_experience);
  const pj = asObjectArray(o.projects);
  const qu = asObjectArray(o.qualifications);
  const ce = asObjectArray(o.certifications);

  const work_experience: CvWorkExperienceDraft[] = [];
  for (const item of we) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const role_title = asStr(r.role_title) ?? "";
    const organisation_name = asStr(r.organisation_name) ?? "";
    if (!role_title.trim() || !organisation_name.trim()) continue;
    const merged = mergeExtractedEvidenceTags({
      skills: asStrArray(r.skills),
      methods: asStrArray(r.methods),
      tools: asStrArray(r.tools),
    });
    work_experience.push({
      role_title: role_title.trim(),
      organisation_name: organisation_name.trim(),
      description: asStr(r.description),
      start_date: parseDate(r.start_date),
      end_date: parseDate(r.end_date),
      is_current: asBool(r.is_current, false),
      industry: asStr(r.industry),
      skills: merged.skills,
      methods: merged.methods,
      tools: merged.tools,
    });
  }

  const projects: CvProjectDraft[] = [];
  for (const item of pj) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const project_name = asStr(r.project_name) ?? "";
    if (!project_name.trim()) continue;
    const mergedP = mergeExtractedEvidenceTags({
      skills: asStrArray(r.skills),
      methods: asStrArray(r.methods),
      tools: asStrArray(r.tools),
    });
    projects.push({
      project_name: project_name.trim(),
      client: asStr(r.client),
      role: asStr(r.role),
      description: asStr(r.description),
      start_date: parseDate(r.start_date),
      end_date: parseDate(r.end_date),
      industry: asStr(r.industry),
      skills: mergedP.skills,
      methods: mergedP.methods,
      tools: mergedP.tools,
      parent_role_title_hint: asStr(r.parent_role_title_hint),
      parent_organisation_hint: asStr(r.parent_organisation_hint),
    });
  }

  const qualifications: CvQualificationDraft[] = [];
  for (const item of qu) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const title = asStr(r.title) ?? "";
    if (!title.trim()) continue;
    qualifications.push({
      title: title.trim(),
      issuer: asStr(r.issuer),
      qualification_type: asStr(r.qualification_type),
      date_achieved: parseDate(r.date_achieved),
      notes: asStr(r.notes),
      credential_url: asStr(r.credential_url),
    });
  }

  const certifications: CvCertificationDraft[] = [];
  for (const item of ce) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const title = asStr(r.title) ?? "";
    if (!title.trim()) continue;
    certifications.push({
      title: title.trim(),
      issuer: asStr(r.issuer),
      issue_date: parseDate(r.issue_date),
      expiry_date: parseDate(r.expiry_date),
      renewal_required: asBool(r.renewal_required, true),
      notes: asStr(r.notes),
      credential_url: asStr(r.credential_url),
    });
  }

  const profile = parseCvProfileBlock(o.profile);

  return {
    work_experience,
    projects,
    qualifications,
    certifications,
    profile,
  };
}

export type Selectable<T> = T & {
  include: boolean;
  duplicateOf?: "existing" | "batch";
  duplicateNote?: string;
};

/** How imported CV work/projects are reconciled with what is already saved. */
export type CvEvidenceImportMode = "merge" | "append" | "replace";

export function matchExperienceId(
  draft: CvProjectDraft,
  pool: { id: string; role_title: string | null; organisation_name: string | null }[]
): string | null {
  const rh = normKey(draft.parent_role_title_hint);
  const oh = normKey(draft.parent_organisation_hint);
  let best: { id: string; score: number } | null = null;
  for (const e of pool) {
    const ers = normKey(e.role_title);
    const eos = normKey(e.organisation_name);
    let score = 0;
    if (rh && ers) {
      if (ers === rh || ers.includes(rh) || rh.includes(ers)) score += 2;
    }
    if (oh && eos) {
      if (eos === oh || eos.includes(oh) || oh.includes(eos)) score += 2;
    }
    if (score > (best?.score ?? -1)) {
      best = { id: e.id, score };
    }
  }
  if (best && best.score >= 1) return best.id;
  return null;
}

function isDupExperience(
  draft: CvWorkExperienceDraft,
  existing: UserExperienceRow[]
): boolean {
  const rk = normKey(draft.role_title);
  const ok = normKey(draft.organisation_name);
  for (const e of existing) {
    if (normKey(e.role_title) !== rk) continue;
    if (normKey(e.organisation_name) !== ok) continue;
    return true;
  }
  return false;
}

type QualLike = {
  title: string;
  issuer: string | null;
  date_achieved: string | null;
};

export function isDupQual(draft: QualLike, existing: QualLike[]): boolean {
  const tk = normKey(draft.title);
  const ik = normKey(draft.issuer);
  const dk = draft.date_achieved?.slice(0, 10) ?? "";
  for (const e of existing) {
    if (normKey(e.title) !== tk) continue;
    if (normKey(e.issuer) !== ik) continue;
    const ed = e.date_achieved?.slice(0, 10) ?? "";
    if (dk && ed && dk !== ed) continue;
    if (!dk && !ed) return true;
    if (dk && ed && dk === ed) return true;
  }
  return false;
}

type CertLike = {
  title: string;
  issuer: string | null;
  issue_date: string | null;
};

export function isDupCert(draft: CertLike, existing: CertLike[]): boolean {
  const tk = normKey(draft.title);
  const ik = normKey(draft.issuer);
  const idt = draft.issue_date?.slice(0, 10) ?? "";
  for (const e of existing) {
    if (normKey(e.title) !== tk) continue;
    if (normKey(e.issuer) !== ik) continue;
    const eid = e.issue_date?.slice(0, 10) ?? "";
    if (idt && eid && idt !== eid) continue;
    if (!idt && !eid) return true;
    if (idt && eid && idt === eid) return true;
  }
  return false;
}

export function isDupProject(
  draft: CvProjectDraft,
  experienceId: string,
  existing: { experience_id: string; project_name?: string | null }[]
): boolean {
  const pk = normKey(draft.project_name);
  for (const p of existing) {
    if (p.experience_id !== experienceId) continue;
    if (normKey(p.project_name) !== pk) continue;
    return true;
  }
  return false;
}

export function annotateSelectable(
  payload: CvExtractedPayload,
  experiences: UserExperienceRow[],
  qualifications: UserQualificationRow[],
  certifications: UserCertificationRow[],
  projects: { experience_id: string; project_name?: string | null }[],
  opts?: { importMode?: CvEvidenceImportMode }
): {
  work_experience: Selectable<CvWorkExperienceDraft>[];
  projects: Selectable<CvProjectDraft>[];
  qualifications: Selectable<CvQualificationDraft>[];
  certifications: Selectable<CvCertificationDraft>[];
} {
  const importMode = opts?.importMode ?? "merge";
  const checkWorkAgainstExisting =
    importMode === "merge";

  const seenRoles = new Set<string>();
  const work_experience: Selectable<CvWorkExperienceDraft>[] =
    payload.work_experience.map((w) => {
      const key = `${normKey(w.role_title)}|${normKey(w.organisation_name)}`;
      let duplicateOf: "existing" | "batch" | undefined;
      let duplicateNote: string | undefined;
      if (seenRoles.has(key)) {
        duplicateOf = "batch";
        duplicateNote = "Duplicate entry in this import.";
      } else if (checkWorkAgainstExisting && isDupExperience(w, experiences)) {
        duplicateOf = "existing";
        duplicateNote = "Matches an existing work experience entry.";
      }
      seenRoles.add(key);
      return {
        ...w,
        include: !duplicateOf,
        duplicateOf,
        duplicateNote,
      };
    });

  const seenQualBatch = new Set<string>();
  const qualificationsOut: Selectable<CvQualificationDraft>[] =
    payload.qualifications.map((q) => {
      const batchKey = `${normKey(q.title)}|${normKey(q.issuer)}|${
        q.date_achieved?.slice(0, 10) ?? ""
      }`;
      const dupBatch = seenQualBatch.has(batchKey);
      if (!dupBatch) seenQualBatch.add(batchKey);
      const dupExisting = isDupQual(q, qualifications)
        ? ("existing" as const)
        : undefined;
      const dup = dupExisting ?? (dupBatch ? ("batch" as const) : undefined);
      return {
        ...q,
        include: !dup,
        duplicateOf: dup,
        duplicateNote: dupExisting
          ? "Matches an existing qualification."
          : dupBatch
            ? "Duplicate entry in this import."
            : undefined,
      };
    });

  const seenCertBatch = new Set<string>();
  const certificationsOut: Selectable<CvCertificationDraft>[] =
    payload.certifications.map((c) => {
      const batchKey = `${normKey(c.title)}|${normKey(c.issuer)}|${
        c.issue_date?.slice(0, 10) ?? ""
      }`;
      const dupBatch = seenCertBatch.has(batchKey);
      if (!dupBatch) seenCertBatch.add(batchKey);
      const dupExisting = isDupCert(c, certifications)
        ? ("existing" as const)
        : undefined;
      const dup = dupExisting ?? (dupBatch ? ("batch" as const) : undefined);
      return {
        ...c,
        include: !dup,
        duplicateOf: dup,
        duplicateNote: dupExisting
          ? "Matches an existing certification."
          : dupBatch
            ? "Duplicate entry in this import."
            : undefined,
      };
    });

  const projectsOut: Selectable<CvProjectDraft>[] = payload.projects.map(
    (p) => ({
      ...p,
      include: true,
    })
  ) as Selectable<CvProjectDraft>[];

  return {
    work_experience,
    projects: annotateProjectsSelectable(
      projectsOut,
      work_experience,
      experiences,
      projects,
      { importMode }
    ),
    qualifications: qualificationsOut,
    certifications: certificationsOut,
  };
}

/** Match projects to existing + selected import roles for preview. */
export function annotateProjectsSelectable(
  projectRows: Selectable<CvProjectDraft>[],
  workSelectable: Selectable<CvWorkExperienceDraft>[],
  experiences: UserExperienceRow[],
  existingProjects: { experience_id: string; project_name?: string | null }[],
  opts?: { importMode?: CvEvidenceImportMode }
): Selectable<CvProjectDraft>[] {
  const importMode = opts?.importMode ?? "merge";
  const experiencePoolSource =
    importMode === "replace" ? [] : experiences;
  const projectsForExistingDup =
    importMode === "replace" ? [] : existingProjects;

  const pool: {
    id: string;
    role_title: string | null;
    organisation_name: string | null;
  }[] = [
    ...experiencePoolSource.map((e) => ({
      id: e.id,
      role_title: e.role_title,
      organisation_name: e.organisation_name,
    })),
    ...workSelectable
      .filter((w) => w.include)
      .map((w, idx) => ({
        id: `__import__${idx}`,
        role_title: w.role_title,
        organisation_name: w.organisation_name,
      })),
  ];

  return projectRows.map((p) => {
    const expId = matchExperienceId(p, pool);
    if (!expId) {
      return {
        ...p,
        include: false,
        duplicateOf: "existing",
        duplicateNote:
          "No matching work experience (select a role above or add the role first).",
      };
    }
    if (!expId.startsWith("__import__")) {
      if (isDupProject(p, expId, projectsForExistingDup)) {
        return {
          ...p,
          include: false,
          duplicateOf: "existing",
          duplicateNote: "Same project name already exists under that role.",
        };
      }
    }
    return { ...p, include: p.include !== false };
  });
}
