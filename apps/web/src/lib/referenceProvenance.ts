import type {
  CapabilityAreaRow,
  CompetencyRow,
  CompetencySubjectRow,
} from "../pages/hub/types";

/** PostgREST may return a single object or one-element array for embeds. */
export function unwrapReferenceJoin<T>(v: T | T[] | null | undefined): T | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export type ReferenceFrameworkSnippet = {
  id?: string;
  code?: string | null;
  name?: string | null;
};

export type ReferenceCapabilityAreaEmbed = {
  id?: string;
  name?: string | null;
  reference_frameworks?: ReferenceFrameworkSnippet | ReferenceFrameworkSnippet[] | null;
};

export type ReferenceSubjectEmbed = {
  id?: string;
  name?: string | null;
  reference_capability_areas?: ReferenceCapabilityAreaEmbed | ReferenceCapabilityAreaEmbed[] | null;
};

export type ReferenceCompetencyEmbed = {
  id?: string;
  name?: string | null;
  reference_subjects?: ReferenceSubjectEmbed | ReferenceSubjectEmbed[] | null;
};

/** Org subject row with optional PostgREST embeds (see CompetenciesSection selects). */
export type CompetencySubjectWithProvenance = CompetencySubjectRow & {
  capability_areas?: { id: string; name: string } | { id: string; name: string }[] | null;
  reference_subjects?: ReferenceSubjectEmbed | ReferenceSubjectEmbed[] | null;
};

export type CompetencyWithProvenance = CompetencyRow & {
  reference_competencies?: ReferenceCompetencyEmbed | ReferenceCompetencyEmbed[] | null;
};

export type ReferenceSubjectProvenanceFields = {
  source_reference_subject_name: string | null;
  source_reference_capability_area_name: string | null;
  source_reference_framework_name: string | null;
  source_reference_framework_code: string | null;
};

export function provenanceFromReferenceSubjectEmbed(
  ref: ReferenceSubjectEmbed | null | undefined,
): ReferenceSubjectProvenanceFields {
  const r = unwrapReferenceJoin(ref);
  if (!r) {
    return {
      source_reference_subject_name: null,
      source_reference_capability_area_name: null,
      source_reference_framework_name: null,
      source_reference_framework_code: null,
    };
  }
  const subName = r.name?.trim() || null;
  const area = unwrapReferenceJoin(r.reference_capability_areas);
  const areaName = area?.name?.trim() || null;
  const fw = unwrapReferenceJoin(area?.reference_frameworks);
  const fwName = fw?.name?.trim() || null;
  const fwCode = fw?.code?.trim() || null;
  return {
    source_reference_subject_name: subName,
    source_reference_capability_area_name: areaName,
    source_reference_framework_name: fwName,
    source_reference_framework_code: fwCode,
  };
}

export function orgCapabilityAreaDisplayName(
  subject: CompetencySubjectRow,
  capabilityAreas: CapabilityAreaRow[],
): string | null {
  const sid = subject.capability_area_id;
  if (!sid) return null;
  const hit = capabilityAreas.find((a) => a.id === sid);
  if (hit?.name?.trim()) return hit.name.trim();
  const emb = unwrapReferenceJoin(
    (subject as CompetencySubjectWithProvenance).capability_areas,
  );
  return emb?.name?.trim() || null;
}

export type SubjectProvenanceLines = {
  /** e.g. "Capability area: Delivery & Execution" */
  capabilityAreaLine: string | null;
  /** e.g. "Mapped from: Elicitation and Collaboration" */
  mappedFromLine: string | null;
  /** e.g. "Source framework: BABOK" */
  sourceFrameworkLine: string | null;
};

/**
 * Secondary copy for catalogue / practice views — does not replace org subject naming.
 */
export function getSubjectProvenanceLines(
  subject: CompetencySubjectWithProvenance,
  capabilityAreas: CapabilityAreaRow[],
): SubjectProvenanceLines {
  const caName = orgCapabilityAreaDisplayName(subject, capabilityAreas);
  const capabilityAreaLine = caName ? `Capability area: ${caName}` : null;

  const ref = unwrapReferenceJoin(subject.reference_subjects);
  const p = provenanceFromReferenceSubjectEmbed(ref ?? undefined);
  const mappedFromLine =
    subject.reference_subject_id && p.source_reference_subject_name
      ? `Mapped from: ${p.source_reference_subject_name}`
      : null;

  let sourceFrameworkLine: string | null = null;
  if (p.source_reference_framework_code || p.source_reference_framework_name) {
    const code = p.source_reference_framework_code;
    const name = p.source_reference_framework_name;
    if (code && name && code !== name) {
      sourceFrameworkLine = `Source framework: ${code} — ${name}`;
    } else {
      sourceFrameworkLine = `Source framework: ${code ?? name ?? ""}`.trim();
    }
  }

  return {
    capabilityAreaLine,
    mappedFromLine,
    sourceFrameworkLine,
  };
}

/** One line for competency detail when adopted from reference library. */
export function getCompetencyReferenceMappedFromLine(
  competency: CompetencyWithProvenance,
): string | null {
  if (!competency.reference_competency_id) return null;
  const rc = unwrapReferenceJoin(competency.reference_competencies);
  const name = rc?.name?.trim();
  if (!name) return null;
  return `Mapped from reference competency: ${name}`;
}
