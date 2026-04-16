import { supabase } from "./supabase";
import type {
  CapabilityAreaRow,
  CompetencyPracticeRow,
  CompetencyRow,
  CompetencySubjectRow,
  OrganisationProfileRow,
} from "../pages/hub/types";
import { isAssignableLifecycleStatus } from "../pages/hub/competencyLifecycle";

/** Synthetic grouping for subjects with no capability_area_id (payload only). */
export const PRACTICE_REFINEMENT_UNASSIGNED_AREA_ID =
  "__unassigned_capability_area__";

export type PracticeCompetencyRefinementCapabilityAreaPayload = {
  id: string;
  name: string;
  subjects: {
    id: string;
    name: string;
    competencies: { id: string; name: string }[];
  }[];
};

export type PracticeCompetencyRefinementRequest = {
  companyProfile: Record<string, unknown> | null;
  practice: {
    id: string;
    name: string;
    description: string | null;
    reference_framework?: string | null;
  };
  /** Organisation taxonomy: competency_subjects → competencies */
  capabilityAreas: PracticeCompetencyRefinementCapabilityAreaPayload[];
  /** Shared reference library slice (reference areas → reference subjects → reference competencies). */
  referenceCapabilityAreas?: PracticeCompetencyRefinementCapabilityAreaPayload[];
};

export type RelevantSubjectSuggestion = {
  subject_id: string;
  subject_name: string;
  reason: string;
};

export type RelevantCompetencySuggestion = {
  competency_id: string;
  competency_name: string;
  subject_id: string;
  subject_name: string;
  reason: string;
};

export type ReferenceCompetencySuggestion = {
  reference_competency_id: string;
  reference_competency_name: string;
  reference_subject_id: string;
  reference_subject_name: string;
  reason: string;
};

export type MissingCompetencySuggestion = {
  name: string;
  subject_id: string;
  subject_name: string;
  reason: string;
};

export type PracticeCompetencyRefinementNotes = {
  coverage_gaps: string[];
  framework_alignment: string[];
};

export type PracticeCompetencyRefinementResponse = {
  relevant_subjects: RelevantSubjectSuggestion[];
  relevant_competencies: RelevantCompetencySuggestion[];
  reference_competencies: ReferenceCompetencySuggestion[];
  missing_competencies: MissingCompetencySuggestion[];
  notes: PracticeCompetencyRefinementNotes;
};

function normNameKey(s: string): string {
  return s.trim().toLowerCase();
}

export type BuildPracticeCompetencyRefinementRequestArgs = {
  practice: CompetencyPracticeRow;
  capabilityAreas: CapabilityAreaRow[];
  subjects: CompetencySubjectRow[];
  competencies: CompetencyRow[];
  companyProfile: OrganisationProfileRow | null;
  /** Optional override for reference_framework sent to AI (e.g. draft from modal). */
  referenceFrameworkDraft?: string | null;
  /** Pre-fetched reference library tree (published slice). */
  referenceCapabilityAreas?: PracticeCompetencyRefinementCapabilityAreaPayload[];
};

/**
 * Builds nested org capabilityAreas + competency_subjects + competencies for the edge function.
 * Includes all active competency_subjects (even with zero competencies). Unassigned subjects
 * are grouped under a synthetic area id.
 */
export function buildPracticeCompetencyRefinementRequest(
  args: BuildPracticeCompetencyRefinementRequestArgs,
): PracticeCompetencyRefinementRequest {
  const {
    practice,
    capabilityAreas,
    subjects,
    competencies,
    companyProfile,
    referenceFrameworkDraft,
    referenceCapabilityAreas,
  } = args;

  const assignableSubjects = subjects.filter((s) =>
    isAssignableLifecycleStatus(s.status),
  );

  const compsBySubject = (subjectId: string) =>
    competencies
      .filter(
        (c) =>
          c.subject_id === subjectId && isAssignableLifecycleStatus(c.status),
      )
      .map((c) => ({
        id: c.id,
        name: c.name.trim(),
      }));

  const capabilityAreasOut: PracticeCompetencyRefinementCapabilityAreaPayload[] =
    [];

  for (const area of capabilityAreas) {
    const subs = assignableSubjects.filter(
      (s) => (s.capability_area_id ?? null) === area.id,
    );
    if (subs.length === 0) continue;
    capabilityAreasOut.push({
      id: area.id,
      name: area.name.trim(),
      subjects: subs.map((s) => ({
        id: s.id,
        name: s.name.trim(),
        competencies: compsBySubject(s.id),
      })),
    });
  }

  const unassigned = assignableSubjects.filter((s) => !s.capability_area_id);
  if (unassigned.length > 0) {
    capabilityAreasOut.push({
      id: PRACTICE_REFINEMENT_UNASSIGNED_AREA_ID,
      name: "Unassigned capability area",
      subjects: unassigned.map((s) => ({
        id: s.id,
        name: s.name.trim(),
        competencies: compsBySubject(s.id),
      })),
    });
  }

  const cp = companyProfile
    ? ({
        organisation_name: companyProfile.organisation_name ?? null,
        sector: companyProfile.sector ?? null,
        industry: companyProfile.industry ?? null,
        summary: companyProfile.summary ?? null,
      } as Record<string, unknown>)
    : null;

  const fw =
    referenceFrameworkDraft !== undefined
      ? referenceFrameworkDraft?.trim() || null
      : practice.reference_framework?.trim() || null;

  const refAreas =
    referenceCapabilityAreas && referenceCapabilityAreas.length > 0
      ? referenceCapabilityAreas
      : undefined;

  return {
    companyProfile: cp,
    practice: {
      id: practice.id,
      name: practice.name.trim(),
      description: practice.description?.trim() ?? null,
      reference_framework: fw,
    },
    capabilityAreas: capabilityAreasOut,
    ...(refAreas ? { referenceCapabilityAreas: refAreas } : {}),
  };
}

type OrgValidation = {
  validSubjectIds: Set<string>;
  validCompetencyIds: Set<string>;
  competencySubjectId: Map<string, string>;
  subjectIdToName: Map<string, string>;
  competencyIdToName: Map<string, string>;
  existingNamesBySubject: Map<string, Set<string>>;
};

function collectOrgValidationFromPayload(
  areas: PracticeCompetencyRefinementCapabilityAreaPayload[],
): OrgValidation {
  const validSubjectIds = new Set<string>();
  const validCompetencyIds = new Set<string>();
  const competencySubjectId = new Map<string, string>();
  const subjectIdToName = new Map<string, string>();
  const competencyIdToName = new Map<string, string>();
  const existingNamesBySubject = new Map<string, Set<string>>();

  for (const area of areas) {
    for (const sub of area.subjects) {
      validSubjectIds.add(sub.id);
      subjectIdToName.set(sub.id, sub.name);
      if (!existingNamesBySubject.has(sub.id)) {
        existingNamesBySubject.set(sub.id, new Set());
      }
      const ns = existingNamesBySubject.get(sub.id)!;
      for (const c of sub.competencies) {
        validCompetencyIds.add(c.id);
        competencySubjectId.set(c.id, sub.id);
        competencyIdToName.set(c.id, c.name);
        ns.add(normNameKey(c.name));
      }
    }
  }

  return {
    validSubjectIds,
    validCompetencyIds,
    competencySubjectId,
    subjectIdToName,
    competencyIdToName,
    existingNamesBySubject,
  };
}

type RefValidation = {
  validReferenceCompetencyIds: Set<string>;
  referenceCompetencyIdToName: Map<string, string>;
  referenceCompetencyIdToSubjectId: Map<string, string>;
  referenceSubjectIdToName: Map<string, string>;
};

function collectReferenceValidationFromPayload(
  areas: PracticeCompetencyRefinementCapabilityAreaPayload[] | undefined,
): RefValidation {
  const validReferenceCompetencyIds = new Set<string>();
  const referenceCompetencyIdToName = new Map<string, string>();
  const referenceCompetencyIdToSubjectId = new Map<string, string>();
  const referenceSubjectIdToName = new Map<string, string>();

  if (!areas) {
    return {
      validReferenceCompetencyIds,
      referenceCompetencyIdToName,
      referenceCompetencyIdToSubjectId,
      referenceSubjectIdToName,
    };
  }

  for (const area of areas) {
    for (const sub of area.subjects) {
      referenceSubjectIdToName.set(sub.id, sub.name);
      for (const c of sub.competencies) {
        validReferenceCompetencyIds.add(c.id);
        referenceCompetencyIdToName.set(c.id, c.name);
        referenceCompetencyIdToSubjectId.set(c.id, sub.id);
      }
    }
  }

  return {
    validReferenceCompetencyIds,
    referenceCompetencyIdToName,
    referenceCompetencyIdToSubjectId,
    referenceSubjectIdToName,
  };
}

export function coercePracticeCompetencyRefinementResponse(
  raw: unknown,
  org: OrgValidation,
  ref: RefValidation,
): PracticeCompetencyRefinementResponse {
  const emptyNotes: PracticeCompetencyRefinementNotes = {
    coverage_gaps: [],
    framework_alignment: [],
  };
  const empty: PracticeCompetencyRefinementResponse = {
    relevant_subjects: [],
    relevant_competencies: [],
    reference_competencies: [],
    missing_competencies: [],
    notes: emptyNotes,
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return empty;
  const o = raw as Record<string, unknown>;

  const relevant_subjects: RelevantSubjectSuggestion[] = [];
  const rs = o.relevant_subjects;
  if (Array.isArray(rs)) {
    const seen = new Set<string>();
    for (const row of rs) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const subject_id =
        typeof r.subject_id === "string" ? r.subject_id.trim() : "";
      const reason =
        typeof r.reason === "string" ? r.reason.trim().slice(0, 600) : "";
      if (!subject_id || !org.validSubjectIds.has(subject_id)) continue;
      if (seen.has(subject_id)) continue;
      seen.add(subject_id);
      relevant_subjects.push({
        subject_id,
        subject_name: org.subjectIdToName.get(subject_id) ?? subject_id,
        reason: reason || "—",
      });
    }
  }

  const relevant_competencies: RelevantCompetencySuggestion[] = [];
  const rc = o.relevant_competencies;
  if (Array.isArray(rc)) {
    const seen = new Set<string>();
    for (const row of rc) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const competency_id =
        typeof r.competency_id === "string" ? r.competency_id.trim() : "";
      const reason =
        typeof r.reason === "string" ? r.reason.trim().slice(0, 600) : "";
      if (!competency_id || !org.validCompetencyIds.has(competency_id)) continue;
      if (seen.has(competency_id)) continue;
      seen.add(competency_id);
      const subject_id = org.competencySubjectId.get(competency_id) ?? "";
      relevant_competencies.push({
        competency_id,
        competency_name: org.competencyIdToName.get(competency_id) ?? competency_id,
        subject_id,
        subject_name: org.subjectIdToName.get(subject_id) ?? subject_id,
        reason: reason || "—",
      });
    }
  }

  const reference_competencies: ReferenceCompetencySuggestion[] = [];
  const rr = o.reference_competencies;
  if (Array.isArray(rr)) {
    const seen = new Set<string>();
    for (const row of rr) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const rid =
        typeof r.reference_competency_id === "string"
          ? r.reference_competency_id.trim()
          : "";
      const reason =
        typeof r.reason === "string" ? r.reason.trim().slice(0, 600) : "";
      if (!rid || !ref.validReferenceCompetencyIds.has(rid)) continue;
      if (seen.has(rid)) continue;
      seen.add(rid);
      const rsid = ref.referenceCompetencyIdToSubjectId.get(rid) ?? "";
      reference_competencies.push({
        reference_competency_id: rid,
        reference_competency_name:
          ref.referenceCompetencyIdToName.get(rid) ?? rid,
        reference_subject_id: rsid,
        reference_subject_name:
          ref.referenceSubjectIdToName.get(rsid) ?? rsid,
        reason: reason || "—",
      });
    }
  }

  const missing_competencies: MissingCompetencySuggestion[] = [];
  const mc = o.missing_competencies;
  if (Array.isArray(mc)) {
    const seenKeys = new Set<string>();
    for (const row of mc) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const name = typeof r.name === "string" ? r.name.trim() : "";
      const subject_id =
        typeof r.subject_id === "string" ? r.subject_id.trim() : "";
      const reason =
        typeof r.reason === "string" ? r.reason.trim().slice(0, 600) : "";
      if (!name || name.length > 220) continue;
      if (!subject_id || !org.validSubjectIds.has(subject_id)) continue;
      const dedupeKey = `${subject_id}::${normNameKey(name)}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);
      missing_competencies.push({
        name: name.slice(0, 200),
        subject_id,
        subject_name: org.subjectIdToName.get(subject_id) ?? subject_id,
        reason: reason || "—",
      });
    }
  }

  const compNameBySubject = new Map<string, Set<string>>();
  for (const c of relevant_competencies) {
    if (!compNameBySubject.has(c.subject_id)) {
      compNameBySubject.set(c.subject_id, new Set());
    }
    compNameBySubject.get(c.subject_id)!.add(normNameKey(c.competency_name));
  }

  const missingFiltered = missing_competencies.filter((m) => {
    const set = compNameBySubject.get(m.subject_id);
    if (set?.has(normNameKey(m.name))) return false;
    return true;
  });

  const notes: PracticeCompetencyRefinementNotes = { ...emptyNotes };
  const notesRaw = o.notes;
  if (notesRaw && typeof notesRaw === "object" && !Array.isArray(notesRaw)) {
    const n = notesRaw as Record<string, unknown>;
    if (Array.isArray(n.coverage_gaps)) {
      for (const x of n.coverage_gaps) {
        if (typeof x === "string" && x.trim()) {
          notes.coverage_gaps.push(x.trim().slice(0, 500));
        }
      }
    }
    if (Array.isArray(n.framework_alignment)) {
      for (const x of n.framework_alignment) {
        if (typeof x === "string" && x.trim()) {
          notes.framework_alignment.push(x.trim().slice(0, 500));
        }
      }
    }
  }

  return {
    relevant_subjects,
    relevant_competencies,
    reference_competencies,
    missing_competencies: missingFiltered,
    notes,
  };
}

/** Remove reference rows that duplicate an org competency on an adopted org subject for the same reference parent. */
export function filterReferenceSuggestionsAgainstOrg(
  reference_competencies: ReferenceCompetencySuggestion[],
  subjects: CompetencySubjectRow[],
  competencies: CompetencyRow[],
): ReferenceCompetencySuggestion[] {
  const orgSubjectByRefSubject = new Map<string, string>();
  for (const s of subjects) {
    const rid = s.reference_subject_id;
    if (rid && isAssignableLifecycleStatus(s.status)) {
      orgSubjectByRefSubject.set(rid, s.id);
    }
  }
  return reference_competencies.filter((r) => {
    const orgSubId = orgSubjectByRefSubject.get(r.reference_subject_id);
    if (!orgSubId) return true;
    const nk = normNameKey(r.reference_competency_name);
    const clash = competencies.some(
      (c) =>
        c.subject_id === orgSubId &&
        isAssignableLifecycleStatus(c.status) &&
        normNameKey(c.name) === nk,
    );
    return !clash;
  });
}

async function invokeErrorMessage(
  error: { message?: string; context?: unknown },
  data: unknown,
): Promise<string> {
  let msg = error.message ?? "Edge function request failed.";
  const ctx = error.context;
  if (ctx instanceof Response) {
    try {
      const text = await ctx.clone().text();
      if (text) {
        try {
          const parsed = JSON.parse(text) as { error?: string };
          if (typeof parsed.error === "string" && parsed.error.trim()) {
            msg = parsed.error.trim();
          }
        } catch {
          msg = text.length > 500 ? `${text.slice(0, 500)}…` : text;
        }
      }
    } catch {
      /* keep */
    }
  }
  if (data && typeof data === "object" && data !== null && "error" in data) {
    const e = (data as { error?: unknown }).error;
    if (typeof e === "string" && e.trim()) msg = e.trim();
  }
  return msg;
}

export async function refinePracticeCompetencies(
  body: PracticeCompetencyRefinementRequest,
  subjects: CompetencySubjectRow[],
  competencies: CompetencyRow[],
): Promise<PracticeCompetencyRefinementResponse> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token?.trim();
  if (!accessToken) {
    throw new Error(
      "You must be signed in. Your session may have expired — sign in again.",
    );
  }

  const org = collectOrgValidationFromPayload(body.capabilityAreas);
  const ref = collectReferenceValidationFromPayload(body.referenceCapabilityAreas);

  const { data, error } = await supabase.functions.invoke(
    "refine-practice-competencies",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      body,
    },
  );

  if (error) {
    throw new Error(await invokeErrorMessage(error, data));
  }

  let coerced = coercePracticeCompetencyRefinementResponse(data, org, ref);

  coerced = {
    ...coerced,
    missing_competencies: coerced.missing_competencies.filter((m) => {
      const set = org.existingNamesBySubject.get(m.subject_id);
      return !set?.has(normNameKey(m.name));
    }),
    reference_competencies: filterReferenceSuggestionsAgainstOrg(
      coerced.reference_competencies,
      subjects,
      competencies,
    ),
  };

  return coerced;
}
