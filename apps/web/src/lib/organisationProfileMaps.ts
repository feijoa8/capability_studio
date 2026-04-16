import type { OrganisationProfileRow } from "../pages/hub/types";

/** Normalise Postgres text[] / null to string array. */
export function normaliseStringArray(v: string[] | null | undefined): string[] {
  if (!v || !Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string" && x.trim());
}

/** Parse legacy free-text lines (semicolon-separated) into known option labels. */
export function parseSemicolonSelections(
  text: string | null | undefined,
  allowed: readonly string[],
): string[] {
  if (!text?.trim()) return [];
  const set = new Set(allowed);
  const parts = text
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.filter((p) => set.has(p));
}

/**
 * Merged view for AI / edge functions: preserves legacy string fields while
 * exposing structured v2 fields. Legacy columns are back-filled from v2 when
 * present so older prompts keep working during transition.
 */
export type OrganisationProfileMergedForAi = {
  organisation_name: string | null;
  /** Public URL; assistive research only. */
  company_url: string | null;
  sector: string | null;
  industry: string | null;
  summary: string | null;
  strategic_focus: string | null;
  key_drivers: string[];
  delivery_models: string[];
  organisation_structure: string | null;
  primary_capability_areas: string[];
  capability_focus_notes: string | null;
  regulatory_intensity: string | null;
  role_model_bias: string | null;
  role_interpretation_guidance: string | null;
  terminology_guidance: string | null;
  /** Legacy mirrors (for prompts that still expect these keys). */
  business_purpose: string | null;
  strategic_priorities: string | null;
  delivery_context: string | null;
  capability_emphasis: string | null;
};

/** Legacy 9-field shape still used by several Edge Functions. */
export type RefineJobProfileCompanyPayload = {
  sector: string | null;
  industry: string | null;
  summary: string | null;
  business_purpose: string | null;
  strategic_priorities: string | null;
  delivery_context: string | null;
  capability_emphasis: string | null;
  role_interpretation_guidance: string | null;
  terminology_guidance: string | null;
};

export function toRefineJobProfileCompanyPayload(
  row: OrganisationProfileRow | null,
): RefineJobProfileCompanyPayload | null {
  const m = mergeOrganisationProfileForAi(row);
  if (!m) return null;
  return {
    sector: m.sector,
    industry: m.industry,
    summary: m.summary,
    business_purpose: m.business_purpose,
    strategic_priorities: m.strategic_priorities,
    delivery_context: m.delivery_context,
    capability_emphasis: m.capability_emphasis,
    role_interpretation_guidance: m.role_interpretation_guidance,
    terminology_guidance: m.terminology_guidance,
  };
}

/** Richer object for grouping / coverage tools (extra keys ignored by older Edge parsers). */
export function toMinimalCompanyProfilePayload(
  row: OrganisationProfileRow | null,
): Record<string, unknown> | null {
  const m = mergeOrganisationProfileForAi(row);
  if (!m) return null;
  return {
    organisation_name: m.organisation_name,
    sector: m.sector,
    industry: m.industry,
    summary: m.summary,
    strategic_focus: m.strategic_focus,
    key_drivers: m.key_drivers,
    delivery_models: m.delivery_models,
    organisation_structure: m.organisation_structure,
    primary_capability_areas: m.primary_capability_areas,
    capability_focus_notes: m.capability_focus_notes,
    regulatory_intensity: m.regulatory_intensity,
    role_model_bias: m.role_model_bias,
  };
}

/** Same legacy string block as v1 plus structured fields for richer job-profile prompts. */
export type HierarchyCompanyProfilePayload = {
  organisation_name: string | null;
  sector: string | null;
  industry: string | null;
  summary: string | null;
  business_purpose: string | null;
  strategic_priorities: string | null;
  delivery_context: string | null;
  capability_emphasis: string | null;
  role_interpretation_guidance: string | null;
  terminology_guidance: string | null;
  company_url: string | null;
  strategic_focus: string | null;
  key_drivers: string[];
  delivery_models: string[];
  organisation_structure: string | null;
  primary_capability_areas: string[];
  capability_focus_notes: string | null;
  regulatory_intensity: string | null;
  role_model_bias: string | null;
};

export function toHierarchyCompanyProfilePayload(
  row: OrganisationProfileRow | null,
): HierarchyCompanyProfilePayload | null {
  const m = mergeOrganisationProfileForAi(row);
  if (!m) return null;
  return {
    organisation_name: m.organisation_name,
    sector: m.sector,
    industry: m.industry,
    summary: m.summary,
    business_purpose: m.business_purpose,
    strategic_priorities: m.strategic_priorities,
    delivery_context: m.delivery_context,
    capability_emphasis: m.capability_emphasis,
    role_interpretation_guidance: m.role_interpretation_guidance,
    terminology_guidance: m.terminology_guidance,
    company_url: m.company_url,
    strategic_focus: m.strategic_focus,
    key_drivers: m.key_drivers,
    delivery_models: m.delivery_models,
    organisation_structure: m.organisation_structure,
    primary_capability_areas: m.primary_capability_areas,
    capability_focus_notes: m.capability_focus_notes,
    regulatory_intensity: m.regulatory_intensity,
    role_model_bias: m.role_model_bias,
  };
}

/** Extended company block for job-profile competency suggestion Edge Function. */
export function toSuggestJobProfileCompanyExtendedPayload(
  row: OrganisationProfileRow | null,
): Record<string, unknown> | null {
  const m = mergeOrganisationProfileForAi(row);
  if (!m) return null;
  const base = toRefineJobProfileCompanyPayload(row);
  if (!base) return null;
  return {
    ...base,
    company_url: m.company_url,
    strategic_focus: m.strategic_focus,
    key_drivers: m.key_drivers,
    regulatory_intensity: m.regulatory_intensity,
    organisation_structure: m.organisation_structure,
    role_model_bias: m.role_model_bias,
    delivery_models: m.delivery_models,
    primary_capability_areas: m.primary_capability_areas,
    capability_focus_notes: m.capability_focus_notes,
  };
}

export function mergeOrganisationProfileForAi(
  row: OrganisationProfileRow | null,
): OrganisationProfileMergedForAi | null {
  if (!row) return null;

  const strategic_focus =
    row.strategic_focus?.trim() || row.business_purpose?.trim() || null;
  const key_drivers = normaliseStringArray(row.key_drivers);
  const delivery_models = normaliseStringArray(row.delivery_models);
  const primary_areas = normaliseStringArray(row.primary_capability_areas);

  const strategic_priorities =
    key_drivers.length > 0
      ? key_drivers.join("; ")
      : row.strategic_priorities?.trim() || null;

  const delivery_context =
    delivery_models.length > 0
      ? delivery_models.join("; ")
      : row.delivery_context?.trim() || null;

  const capability_emphasis =
    primary_areas.length > 0
      ? primary_areas.join("; ")
      : row.capability_emphasis?.trim() || null;

  return {
    organisation_name: row.organisation_name ?? null,
    company_url: row.company_url ?? null,
    sector: row.sector ?? null,
    industry: row.industry ?? null,
    summary: row.summary ?? null,
    strategic_focus,
    key_drivers,
    delivery_models,
    organisation_structure: row.organisation_structure ?? null,
    primary_capability_areas: primary_areas,
    capability_focus_notes: row.capability_focus_notes ?? null,
    regulatory_intensity: row.regulatory_intensity ?? null,
    role_model_bias: row.role_model_bias ?? null,
    role_interpretation_guidance: row.role_interpretation_guidance ?? null,
    terminology_guidance: row.terminology_guidance ?? null,
    business_purpose: strategic_focus,
    strategic_priorities,
    delivery_context,
    capability_emphasis,
  };
}
