import type { SupabaseClient } from "@supabase/supabase-js";

export type HiringOpeningStatus = "draft" | "open" | "filled" | "closed";

export type HiringOpeningVisibility =
  | "internal_only"
  | "public_hosted"
  | "external_link_only";

export type HiringCandidateSource = "internal" | "external";

export type HiringApplicationStage =
  | "applied"
  | "reviewed"
  | "shortlisted"
  | "interview"
  | "offer"
  | "hired"
  | "rejected"
  | "withdrawn";

export type HiringOpeningRow = {
  id: string;
  organisation_id: string;
  job_profile_id: string | null;
  title: string | null;
  status: HiringOpeningStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  /** Decision / role owner; optional on legacy rows until edited. */
  hiring_manager_user_id?: string | null;
  /** Recruiter / process owner. */
  hiring_lead_user_id?: string | null;
  visibility?: HiringOpeningVisibility;
  public_slug?: string | null;
  published_at?: string | null;
};

export type HiringApplicationRow = {
  id: string;
  opening_id: string;
  candidate_user_id: string;
  stage: HiringApplicationStage;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** Present after DB migration; 0–100 from last evaluation. */
  evaluation_score?: number | null;
  evaluation_band?: string | null;
  evaluation_summary?: string | null;
  evaluation_snapshot?: Record<string, unknown> | null;
  evaluation_updated_at?: string | null;
  /** Set when the recruiter sends the rejection outcome to the candidate (in-app). */
  outcome_sent_at?: string | null;
  outcome_feedback?: string | null;
  candidate_source?: HiringCandidateSource;
  application_answers?: Record<string, unknown> | null;
  consent_version?: string | null;
  consent_summary?: string | null;
  consent_accepted_at?: string | null;
  cv_upload_id?: string | null;
  cv_extract_snapshot?: Record<string, unknown> | null;
  /** AI-derived strengths / gaps / suggestions after outcome is sent. */
  development_suggestions?: unknown;
  /** Optional applicant cover letter (internal and external apply flows). */
  cover_letter_text?: string | null;
  cover_letter_updated_at?: string | null;
};

/** Normalised shape stored in `development_suggestions` JSONB. */
export type HiringDevelopmentSuggestions = {
  strengths: string[];
  gaps: string[];
  suggestions: string[];
};

export function parseDevelopmentSuggestions(
  raw: unknown,
): HiringDevelopmentSuggestions | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (
    !Array.isArray(o.strengths) ||
    !Array.isArray(o.gaps) ||
    !Array.isArray(o.suggestions)
  ) {
    return null;
  }
  const clean = (a: unknown[]): string[] =>
    a
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .map((s) => s.trim());
  const strengths = clean(o.strengths);
  const gaps = clean(o.gaps);
  const suggestions = clean(o.suggestions);
  if (
    strengths.length === 0 &&
    gaps.length === 0 &&
    suggestions.length === 0
  ) {
    return null;
  }
  return { strengths, gaps, suggestions };
}

export function hasUsableDevelopmentSuggestions(row: HiringApplicationRow): boolean {
  return parseDevelopmentSuggestions(row.development_suggestions) != null;
}

export const KANBAN_STAGES: HiringApplicationStage[] = [
  "applied",
  "reviewed",
  "shortlisted",
  "interview",
  "offer",
  "hired",
];

export const STAGE_LABEL: Record<HiringApplicationStage, string> = {
  applied: "Applied",
  reviewed: "Reviewed",
  shortlisted: "Shortlisted",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

/** Stages where an external candidate may withdraw (early pipeline only). */
export const CANDIDATE_WITHDRAW_STAGES: HiringApplicationStage[] = [
  "applied",
  "reviewed",
  "shortlisted",
];

export function stageAllowsCandidateWithdraw(
  stage: HiringApplicationStage,
): boolean {
  return CANDIDATE_WITHDRAW_STAGES.includes(stage);
}

/** Candidates may update an optional cover letter while the process is still open for them. */
export function coverLetterEditableForCandidateStage(
  stage: HiringApplicationStage,
): boolean {
  return stage !== "hired" && stage !== "rejected" && stage !== "withdrawn";
}

export type ManagedOrganisationRow = {
  id: string;
  managing_org_id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size_band: string | null;
  context_notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ManagedRoleRow = {
  id: string;
  managed_org_id: string;
  job_profile_id: string;
  hiring_opening_id: string;
  created_by: string;
  is_anonymous: boolean;
  public_name: string | null;
  salary_min: number | null;
  salary_max: number | null;
  currency: string | null;
  created_at: string;
};

export type ManagedHiringContextForOpening = {
  role: ManagedRoleRow;
  clientOrgName: string;
};

export async function fetchManagedOrganisationsForManager(
  client: SupabaseClient,
  managingOrgId: string,
): Promise<ManagedOrganisationRow[]> {
  const { data, error } = await client
    .from("managed_organisations")
    .select("*")
    .eq("managing_org_id", managingOrgId)
    .order("name");
  if (error) {
    console.warn("managed_organisations:", error.message);
    return [];
  }
  return (data ?? []) as ManagedOrganisationRow[];
}

/** managed_roles + client org name; one row per opening. */
export async function fetchManagedHiringForOpening(
  client: SupabaseClient,
  openingId: string,
): Promise<ManagedHiringContextForOpening | null> {
  const { data, error } = await client
    .from("managed_roles")
    .select(
      "id, managed_org_id, job_profile_id, hiring_opening_id, created_by, is_anonymous, public_name, salary_min, salary_max, currency, created_at",
    )
    .eq("hiring_opening_id", openingId)
    .maybeSingle();

  if (error) {
    console.warn("managed_roles for opening:", error.message);
    return null;
  }
  if (!data) return null;
  const r = data as Record<string, unknown>;
  const managedOrgId = String(r.managed_org_id);
  const { data: orgRow, error: orgErr } = await client
    .from("managed_organisations")
    .select("name")
    .eq("id", managedOrgId)
    .maybeSingle();
  if (orgErr) {
    console.warn("managed_organisations:", orgErr.message);
  }
  const clientName = String(
    (orgRow as { name?: string } | null)?.name ?? "",
  ).trim() || "Client org";
  const role: ManagedRoleRow = {
    id: String(r.id),
    managed_org_id: managedOrgId,
    job_profile_id: String(r.job_profile_id),
    hiring_opening_id: String(r.hiring_opening_id),
    created_by: String(r.created_by),
    is_anonymous: r.is_anonymous === true,
    public_name: r.public_name == null ? null : String(r.public_name),
    salary_min: r.salary_min == null ? null : Number(r.salary_min),
    salary_max: r.salary_max == null ? null : Number(r.salary_max),
    currency: r.currency == null ? null : String(r.currency),
    created_at: String(r.created_at),
  };
  return { role, clientOrgName: clientName };
}

/** Openings in this set have a managed_roles row. */
export async function fetchManagedOpeningIdSet(
  client: SupabaseClient,
  openingIds: string[],
): Promise<Set<string>> {
  if (openingIds.length === 0) return new Set();
  const { data, error } = await client
    .from("managed_roles")
    .select("hiring_opening_id")
    .in("hiring_opening_id", openingIds);
  if (error) {
    console.warn("managed_roles by openings:", error.message);
    return new Set();
  }
  const s = new Set<string>();
  for (const row of data ?? []) {
    const id = (row as { hiring_opening_id: string }).hiring_opening_id;
    if (id) s.add(id);
  }
  return s;
}

export async function fetchHiringOpenings(
  client: SupabaseClient,
  organisationId: string,
): Promise<HiringOpeningRow[]> {
  const { data, error } = await client
    .from("hiring_openings")
    .select("*")
    .eq("organisation_id", organisationId)
    .order("updated_at", { ascending: false });

  if (error) {
    console.warn("hiring_openings:", error.message);
    return [];
  }
  return (data ?? []) as HiringOpeningRow[];
}

export async function fetchOpeningApplicationCounts(
  client: SupabaseClient,
  openingIds: string[],
): Promise<Record<string, number>> {
  if (openingIds.length === 0) return {};
  const { data, error } = await client
    .from("hiring_applications")
    .select("opening_id")
    .in("opening_id", openingIds);

  if (error) {
    console.warn("hiring_applications count:", error.message);
    return {};
  }
  const counts: Record<string, number> = {};
  for (const id of openingIds) counts[id] = 0;
  for (const row of data ?? []) {
    const oid = (row as { opening_id: string }).opening_id;
    counts[oid] = (counts[oid] ?? 0) + 1;
  }
  return counts;
}

export type OpeningPipelineStats = {
  total: number;
  byStage: Record<HiringApplicationStage, number>;
};

const EMPTY_STAGE_COUNTS = (): Record<HiringApplicationStage, number> => ({
  applied: 0,
  reviewed: 0,
  shortlisted: 0,
  interview: 0,
  offer: 0,
  hired: 0,
  rejected: 0,
  withdrawn: 0,
});

/** Load application rows for pipeline breakdown (list + cards). */
export async function fetchPipelineStatsForOpenings(
  client: SupabaseClient,
  openingIds: string[],
): Promise<Record<string, OpeningPipelineStats>> {
  const out: Record<string, OpeningPipelineStats> = {};
  for (const id of openingIds) {
    out[id] = { total: 0, byStage: EMPTY_STAGE_COUNTS() };
  }
  if (openingIds.length === 0) return out;

  const { data, error } = await client
    .from("hiring_applications")
    .select("opening_id, stage")
    .in("opening_id", openingIds);

  if (error) {
    console.warn("hiring_applications pipeline:", error.message);
    return out;
  }

  for (const raw of data ?? []) {
    const row = raw as { opening_id: string; stage: string };
    const oid = row.opening_id;
    if (!out[oid]) continue;
    const st = row.stage as HiringApplicationStage;
    if (!(st in out[oid].byStage)) continue;
    out[oid].total += 1;
    out[oid].byStage[st] += 1;
  }
  return out;
}

/** Compact single-line summary for role cards, e.g. "3 candidates • 1 applied • 2 reviewed". */
export function formatRoleCardPipelineLine(stats: OpeningPipelineStats): string {
  const parts: string[] = [
    `${stats.total} candidate${stats.total === 1 ? "" : "s"}`,
  ];
  const order: HiringApplicationStage[] = [
    ...KANBAN_STAGES,
    "rejected",
    "withdrawn",
  ];
  for (const s of order) {
    const n = stats.byStage[s] ?? 0;
    if (n > 0) {
      parts.push(`${n} ${STAGE_LABEL[s].toLowerCase()}`);
    }
  }
  return parts.join(" • ");
}

/** Display names for hiring card headers (manager / lead). */
export async function fetchProfileDisplayNamesByUserIds(
  client: SupabaseClient,
  userIds: string[],
): Promise<Record<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const { data, error } = await client
    .from("profiles")
    .select("id, display_name, first_name, last_name, email")
    .in("id", ids);
  if (error) {
    console.warn("profiles names:", error.message);
    return {};
  }
  const map: Record<string, string> = {};
  for (const raw of data ?? []) {
    const row = raw as {
      id: string;
      display_name?: string | null;
      first_name?: string | null;
      last_name?: string | null;
      email?: string | null;
    };
    map[row.id] = displayNameFromProfile(row);
  }
  return map;
}

function displayNameFromProfile(p: {
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
}): string {
  const dn = p.display_name?.trim();
  if (dn) return dn;
  const fn = (p.first_name ?? "").trim();
  const ln = (p.last_name ?? "").trim();
  const combined = [fn, ln].filter(Boolean).join(" ");
  if (combined) return combined;
  return p.email?.trim() || "Member";
}

/**
 * Hiring card / modal label when `profiles` may be unreadable (legacy RLS) or thin rows.
 * Order: profile fields → CV extract `profile.first_name`/`last_name` → optional application_answers
 * strings → truncated user id.
 */
export function hiringCandidateDisplayName(
  row: HiringApplicationRow,
  profile:
    | {
        display_name?: string | null;
        first_name?: string | null;
        last_name?: string | null;
        email?: string | null;
      }
    | null
    | undefined,
): string {
  if (profile) {
    const fromProf = displayNameFromProfile(profile);
    if (fromProf && fromProf !== "Member") return fromProf;
  }

  const snap = row.cv_extract_snapshot;
  if (snap && typeof snap === "object" && !Array.isArray(snap)) {
    const prof = (snap as Record<string, unknown>).profile;
    if (prof && typeof prof === "object" && !Array.isArray(prof)) {
      const p = prof as Record<string, unknown>;
      const fn = typeof p.first_name === "string" ? p.first_name.trim() : "";
      const ln = typeof p.last_name === "string" ? p.last_name.trim() : "";
      const combined = [fn, ln].filter(Boolean).join(" ");
      if (combined) return combined;
    }
  }

  const ans = row.application_answers;
  if (ans && typeof ans === "object" && !Array.isArray(ans)) {
    const o = ans as Record<string, unknown>;
    for (const k of ["applicant_name", "display_name", "full_name", "name"] as const) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }

  const id = row.candidate_user_id;
  return id ? `${id.slice(0, 8)}…` : "—";
}

/** Email line on hiring cards; profile is preferred when RLS allows SELECT. */
export function hiringCandidateEmailLine(
  _row: HiringApplicationRow,
  profile: { email?: string | null } | null | undefined,
): string {
  const em = profile?.email?.trim();
  if (em) return em;
  return "—";
}

/** External apply stores `cv_upload_id` on the application; show View CV only in that case. */
export function hiringApplicationHasViewableExternalCv(
  row: HiringApplicationRow,
): boolean {
  return (
    row.candidate_source === "external" &&
    typeof row.cv_upload_id === "string" &&
    row.cv_upload_id.length > 0
  );
}

/**
 * Opens the submitted CV in a new tab (signed URL). Requires DB/storage policies for
 * hiring recruiters (`user_cv_uploads_select_hiring_org_recruiter`, storage policy).
 */
export async function openHiringApplicationCv(
  client: SupabaseClient,
  row: HiringApplicationRow,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!hiringApplicationHasViewableExternalCv(row) || !row.cv_upload_id) {
    return { ok: false, error: "No CV is linked to this application." };
  }

  const { data, error } = await client
    .from("user_cv_uploads")
    .select("id, user_id, storage_path, original_filename, mime_type")
    .eq("id", row.cv_upload_id)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }
  const meta = data as {
    id: string;
    user_id: string;
    storage_path: string;
    original_filename?: string | null;
    mime_type?: string | null;
  } | null;
  if (!meta?.storage_path) {
    return { ok: false, error: "CV file metadata was not found." };
  }
  if (meta.user_id !== row.candidate_user_id) {
    return { ok: false, error: "CV does not match this candidate." };
  }

  const { data: signed, error: signErr } = await client.storage
    .from("cv-uploads")
    .createSignedUrl(meta.storage_path, 3600);

  if (signErr || !signed?.signedUrl) {
    return {
      ok: false,
      error: signErr?.message ?? "Could not open the CV file.",
    };
  }

  window.open(signed.signedUrl, "_blank", "noopener,noreferrer");
  return { ok: true };
}

export async function fetchHiringOpening(
  client: SupabaseClient,
  openingId: string,
): Promise<HiringOpeningRow | null> {
  const { data, error } = await client
    .from("hiring_openings")
    .select("*")
    .eq("id", openingId)
    .maybeSingle();

  if (error) {
    console.warn("hiring_openings one:", error.message);
    return null;
  }
  return data as HiringOpeningRow | null;
}

export async function fetchApplicationsForOpening(
  client: SupabaseClient,
  openingId: string,
): Promise<HiringApplicationRow[]> {
  const { data, error } = await client
    .from("hiring_applications")
    .select("*")
    .eq("opening_id", openingId)
    .order("updated_at", { ascending: false });

  if (error) {
    console.warn("hiring_applications:", error.message);
    return [];
  }
  return (data ?? []) as HiringApplicationRow[];
}

export type InternalMemberPick = {
  userId: string;
  displayName: string;
  email: string;
  jobTitle: string | null;
  experienceHint: string | null;
};

/** Active workspace members for internal hiring picker. */
export async function fetchInternalMembersForOrg(
  client: SupabaseClient,
  organisationId: string,
): Promise<InternalMemberPick[]> {
  const { data: wmRows, error: wmErr } = await client
    .from("workspace_memberships")
    .select("user_id")
    .eq("organisation_id", organisationId)
    .eq("membership_status", "active");

  if (wmErr || !wmRows?.length) {
    if (wmErr) console.warn("workspace_memberships picker:", wmErr.message);
    return [];
  }

  const userIds = [
    ...new Set(
      wmRows
        .map((r) => (r as { user_id: string | null }).user_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const { data: profiles, error: pErr } = await client
    .from("profiles")
    .select("id, display_name, first_name, last_name, email")
    .in("id", userIds);

  if (pErr) {
    console.warn("profiles picker:", pErr.message);
    return [];
  }

  const { data: ujpRows } = await client
    .from("user_job_profiles")
    .select("user_id, job_profile_id")
    .eq("organisation_id", organisationId)
    .in("user_id", userIds);

  const jpIds = [
    ...new Set(
      (ujpRows ?? [])
        .map((r) => (r as { job_profile_id: string | null }).job_profile_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const jpTitleById: Record<string, string> = {};
  if (jpIds.length > 0) {
    const { data: jps } = await client
      .from("job_profiles")
      .select("id, title")
      .in("id", jpIds);
    for (const jp of jps ?? []) {
      const row = jp as { id: string; title: string };
      jpTitleById[row.id] = row.title;
    }
  }

  const jobTitleByUser = new Map<string, string | null>();
  for (const raw of ujpRows ?? []) {
    const r = raw as { user_id: string; job_profile_id: string | null };
    if (r.job_profile_id && jpTitleById[r.job_profile_id]) {
      jobTitleByUser.set(r.user_id, jpTitleById[r.job_profile_id]);
    }
  }

  const out: InternalMemberPick[] = [];
  for (const p of profiles ?? []) {
    const row = p as {
      id: string;
      display_name?: string | null;
      first_name?: string | null;
      last_name?: string | null;
      email?: string | null;
    };
    out.push({
      userId: row.id,
      displayName: displayNameFromProfile(row),
      email: row.email?.trim() ?? "",
      jobTitle: jobTitleByUser.get(row.id) ?? null,
      /** Cross-user My Experience is manager-scoped in RLS; filled when visible. */
      experienceHint: null,
    });
  }

  out.sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, {
      sensitivity: "base",
    }),
  );
  return out;
}

export async function resolveJobProfileTitle(
  client: SupabaseClient,
  jobProfileId: string | null,
): Promise<string | null> {
  if (!jobProfileId) return null;
  const { data, error } = await client
    .from("job_profiles")
    .select("title")
    .eq("id", jobProfileId)
    .maybeSingle();
  if (error || !data) return null;
  return String((data as { title: string }).title ?? "").trim() || null;
}

/** Records recruiter-written feedback and marks the rejection outcome as sent to the candidate. Does not change stage. */
export async function sendCandidateOutcome(
  client: SupabaseClient,
  applicationId: string,
  feedback: string,
  options?: { cvExtractSnapshot?: Record<string, unknown> | null },
): Promise<{ error: string | null }> {
  const trimmed = feedback.trim();
  if (!trimmed) {
    return { error: "Feedback is required." };
  }
  const { error } = await client
    .from("hiring_applications")
    .update({
      outcome_feedback: trimmed,
      outcome_sent_at: new Date().toISOString(),
    })
    .eq("id", applicationId);
  if (error) {
    return { error: error.message };
  }

  try {
    const { data, error: fnErr } = await client.functions.invoke(
      "generate-development-suggestions",
      {
        body: {
          feedback: trimmed,
          cv_extract: options?.cvExtractSnapshot ?? {},
        },
      },
    );
    if (fnErr) {
      console.warn("generate-development-suggestions:", fnErr.message);
      return { error: null };
    }
    const parsed = parseDevelopmentSuggestions(data);
    if (parsed) {
      const { error: upErr } = await client
        .from("hiring_applications")
        .update({ development_suggestions: parsed })
        .eq("id", applicationId);
      if (upErr) {
        console.warn("development_suggestions persistence:", upErr.message);
      }
    }
  } catch (e) {
    console.warn("generate-development-suggestions invoke failed:", e);
  }
  return { error: null };
}

export type SubmitInternalHiringApplicationResult =
  | { ok: true; applicationId: string }
  | { ok: false; error: string };

/** Self-apply: inserts internal application; optional cover letter. Does not touch CV/profile/experience. */
export async function submitInternalHiringApplication(
  client: SupabaseClient,
  args: {
    openingId: string;
    userId: string;
    coverLetterText: string | null;
  },
): Promise<SubmitInternalHiringApplicationResult> {
  const trimmed = asTrimmedStringOrNull(args.coverLetterText);
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("hiring_applications")
    .insert({
      opening_id: args.openingId,
      candidate_user_id: args.userId,
      stage: "applied",
      candidate_source: "internal" as const,
      cover_letter_text: trimmed,
      cover_letter_updated_at: trimmed ? now : null,
    })
    .select("id")
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }
  const id = (data as { id: string }).id;
  if (!id) {
    return { ok: false, error: "Application was not created." };
  }
  return { ok: true, applicationId: id };
}

function asTrimmedStringOrNull(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length > 0 ? t : null;
}

/** Update cover letter only; does not change stage or evaluation. */
export async function updateHiringApplicationCoverLetter(
  client: SupabaseClient,
  applicationId: string,
  coverLetterText: string | null,
): Promise<{ error: string | null }> {
  const trimmed = asTrimmedStringOrNull(coverLetterText);
  const now = new Date().toISOString();
  const { error } = await client
    .from("hiring_applications")
    .update({
      cover_letter_text: trimmed,
      cover_letter_updated_at: trimmed ? now : null,
    })
    .eq("id", applicationId);
  if (error) {
    return { error: error.message };
  }
  return { error: null };
}
