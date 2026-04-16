import type { SupabaseClient } from "@supabase/supabase-js";
import { insertDefaultCompetencyLevels } from "./insertDefaultCompetencyLevels";
import type { CapabilityAreaRow } from "../pages/hub/types";

/** Matches DB enum `reference_lifecycle_status`. */
export type ReferenceLifecycleStatus =
  | "draft"
  | "reviewed"
  | "published"
  | "deprecated"
  | "archived";

export type ReferenceFrameworkRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  lifecycle_status: ReferenceLifecycleStatus;
};

export type ReferenceCapabilityAreaRow = {
  id: string;
  reference_framework_id: string;
  /** Present on live DB — optional for older schemas. */
  code?: string | null;
  name: string;
  description: string | null;
  sort_order: number;
  lifecycle_status: ReferenceLifecycleStatus;
};

export type ReferenceSubjectRow = {
  id: string;
  reference_capability_area_id: string;
  /** Present on live DB — optional for older schemas. */
  code?: string | null;
  name: string;
  description: string | null;
  lifecycle_status: ReferenceLifecycleStatus;
  /** Present when joined from reference_capability_areas (e.g. pack detail). */
  reference_capability_areas?:
    | ReferenceCapabilityAreaRow
    | ReferenceCapabilityAreaRow[]
    | null;
};

export type ReferenceCompetencyRow = {
  id: string;
  reference_subject_id: string;
  /** Present on live DB — optional for older schemas. */
  code?: string | null;
  name: string;
  description: string | null;
  canonical_name: string | null;
  lifecycle_status: ReferenceLifecycleStatus;
};

export type ReferenceStarterPackRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  reference_framework_id: string | null;
  lifecycle_status: ReferenceLifecycleStatus;
  updated_at?: string;
  /** PostgREST may return object or single-row array depending on config. */
  reference_frameworks?: ReferenceFrameworkRow | ReferenceFrameworkRow[] | null;
};

/** Matches live `reference_starter_pack_items` (starter_pack_id + item_type). */
export type ReferenceStarterPackItemType = "subject" | "competency";

export type ReferenceStarterPackItemRow = {
  id: string;
  /** Live FK column on `reference_starter_pack_items`. */
  starter_pack_id: string;
  /** Optional legacy name — not used on current DBs. */
  reference_starter_pack_id?: string;
  item_type?: ReferenceStarterPackItemType | null;
  reference_subject_id: string | null;
  reference_competency_id: string | null;
  sort_order: number;
  reference_subjects?: ReferenceSubjectRow | ReferenceSubjectRow[] | null;
  reference_competencies?: (ReferenceCompetencyRow & {
    reference_subjects?: ReferenceSubjectRow | ReferenceSubjectRow[] | null;
  }) | null;
};

/** Classify pack items for counts and adoption — supports `item_type` or legacy XOR ids. */
export function isReferenceStarterPackSubjectItem(
  i: ReferenceStarterPackItemRow,
): boolean {
  const t = i.item_type;
  if (t === "subject") return true;
  if (t === "competency") return false;
  return Boolean(i.reference_subject_id && !i.reference_competency_id);
}

export function isReferenceStarterPackCompetencyItem(
  i: ReferenceStarterPackItemRow,
): boolean {
  const t = i.item_type;
  if (t === "competency") return true;
  if (t === "subject") return false;
  return Boolean(i.reference_competency_id && !i.reference_subject_id);
}

export type ReferenceCompetencyAliasRow = {
  id: string;
  reference_competency_id: string;
  alias: string;
};

export type ReferenceSubjectFilters = {
  frameworkId?: string;
  capabilityAreaId?: string;
  lifecycle?: ReferenceLifecycleStatus | ReferenceLifecycleStatus[];
};

export type ReferenceCompetencyFilters = {
  frameworkId?: string;
  referenceSubjectId?: string;
  lifecycle?: ReferenceLifecycleStatus | ReferenceLifecycleStatus[];
};

export type ReferenceTaxonomyPayload = {
  id: string;
  name: string;
  subjects: {
    id: string;
    name: string;
    competencies: { id: string; name: string }[];
  }[];
};

/** How an org competency_subject was matched during reference adoption. */
export type SubjectMatchBasis =
  | "reference_id"
  | "exact_name"
  | "normalized_name"
  | "new";

/** How org capability area was chosen when adopting a reference subject. */
export type CapabilityAreaMappingSource =
  | "subject_crosswalk"
  | "reference_area_match"
  | "none";

export type ReferenceSubjectCapabilityAreaResolution = {
  capabilityAreaId: string | null;
  capabilityAreaResolved: boolean;
  /** Org capability area display name (from crosswalk config or matched org row). */
  mappedCapabilityAreaName: string | null;
  capabilityAreaMappingSource: CapabilityAreaMappingSource;
};

export type AdoptSubjectResult = {
  competencySubjectId: string;
  created: boolean;
  /** Resolved org capability area, or null when unmapped (subject may appear under Unassigned). */
  capability_area_id: string | null;
  /** True when no org capability area matched and the insert used null capability_area_id. */
  fellBackToUnassignedCapabilityArea: boolean;
  /** Reference subject display name (for unassigned summaries). */
  adoptedSubjectName?: string | null;
  /** Existing org subject reused instead of inserting. */
  reusedExisting?: boolean;
  /** Org subject was archived/deprecated/inactive and restored. */
  reactivatedExisting?: boolean;
  matchedBy?: SubjectMatchBasis;
  /** True when a non-null org capability area id was resolved for this adoption. */
  capabilityAreaResolved?: boolean;
  /** Org capability area name for debugging (crosswalk target or matched org area). */
  mappedCapabilityAreaName?: string | null;
  capabilityAreaMappingSource?: CapabilityAreaMappingSource;
};

export type AdoptCompetencyResult = {
  competencyId: string;
  competencyName: string;
  created: boolean;
  /** Matched an existing org row (by reference id or normalised name) instead of inserting. */
  reusedExisting: boolean;
  /** Row was archived/deprecated/inactive and restored to active. */
  reactivatedExisting: boolean;
  /** Row was already active before updates (may still have traceability/relink patches). */
  alreadyActiveExisting: boolean;
  /** subject_id was changed to the adoption target. */
  relinkedToSubject: boolean;
  /** How the org subject for this competency was resolved (when applicable). */
  subjectMatchedBy?: SubjectMatchBasis | null;
  /** True when the competency could not be linked to an org subject (should be rare). */
  competencyLeftWithoutSubject?: boolean;
  /** When this adoption created the org competency_subject first (competency-only pack items). */
  adoptedSubject?: AdoptSubjectResult | null;
  /** Org competency_subject id for this competency after adoption (practice overlay linking). */
  resolvedOrganisationSubjectId?: string | null;
};

export type AdoptStarterPackSummary = {
  subjectsAdded: number;
  subjectsSkipped: number;
  competenciesAdded: number;
  competenciesSkipped: number;
  /** Existing org competencies matched and updated (reuse/reactivate/relink), not new inserts. */
  competenciesReused: number;
  /** Subset of reused rows that required lifecycle restore from archived/deprecated/inactive. */
  competenciesReactivated: number;
  /** Newly adopted subjects that could not be mapped to an org capability area. */
  subjectsUnassignedCount: number;
  subjectsUnassignedNames: string[];
  /** Copy for UI toasts when any subject landed unassigned. */
  unassignedCapabilityAreaWarning: string | null;
  /** Optional supplement when mapping failed (deterministic crosswalk + reference area match). */
  subjectCapabilityAreaMappingNote: string | null;
  /** Org subjects matched to existing rows (non-insert). */
  subjectsReused: number;
  /** Org subjects restored from archived/deprecated/inactive. */
  subjectsReactivated: number;
  /** Competencies whose subject_id was set/changed to the resolved org subject. */
  competenciesRelinkedToSubjects: number;
  /** Competencies still without a subject after adoption (should be rare). */
  competenciesLeftUnassigned: number;
  /** Matched org practice name when practice overlay linking ran (or attempted). */
  practiceResolvedName: string | null;
  /** Subject items successfully ensured against the practice overlay (same as items when practice resolved). */
  practiceLinkedSubjectsCount: number;
  /** Competency items successfully ensured against the practice overlay. */
  practiceLinkedCompetenciesCount: number;
  /** New subject_practice_links rows created this run (idempotent re-adopt stays low). */
  practiceNewSubjectPracticeLinks: number;
  /** New competency_practice_links rows created this run. */
  practiceNewCompetencyPracticeLinks: number;
  /** Human-readable practice overlay outcome. */
  practiceLinkingNote: string | null;
  errors: string[];
};

export type ReferenceCoverageForPractice = {
  organisationSubjectCount: number;
  organisationCompetencyCount: number;
  matchedFrameworkId: string | null;
  matchedFrameworkLabel: string | null;
  referenceSubjectCount: number;
  referenceCompetencyCount: number;
};

/**
 * Normalise capability area names for matching reference ↔ org rows.
 * Safety-critical: keep in sync between exact match and fallback lookup.
 */
export function normalizeCapabilityAreaName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, " ")
    .replace(/[''"`´]+/g, "")
    .replace(/[,;:.!?()[\]{}]/g, "")
    .replace(/\s*&\s*/g, " & ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * When reference_capability_areas.name has no exact org match, try these org names in order.
 * First existing org capability area wins — do not hardcode a single global target.
 * Keys are normalised with {@link normalizeCapabilityAreaName}.
 */
const REFERENCE_CAPABILITY_AREA_FALLBACKS: Record<string, readonly string[]> = {
  [normalizeCapabilityAreaName("IT Service Management")]: [
    "Technology Strategy and Enablement",
    "Service Delivery and Operations",
    "Operations & Service",
    "Delivery & Execution",
    "Data, Technology & Platforms",
  ],
  [normalizeCapabilityAreaName("Service Delivery")]: [
    "Service Delivery and Operations",
    "Operations & Service",
    "Delivery & Execution",
  ],
  [normalizeCapabilityAreaName("Technology")]: [
    "Technology Strategy and Enablement",
    "Data, Technology & Platforms",
  ],
  [normalizeCapabilityAreaName("Information Technology")]: [
    "Technology Strategy and Enablement",
    "Data, Technology & Platforms",
  ],
  [normalizeCapabilityAreaName("IT Operations")]: [
    "Service Delivery and Operations",
    "Operations & Service",
    "Delivery & Execution",
  ],
  [normalizeCapabilityAreaName("Digital")]: [
    "Data, Technology & Platforms",
    "Technology Strategy and Enablement",
  ],
};

export type ResolveOrganisationCapabilityAreaParams = {
  organisationId: string;
  referenceCapabilityAreaId: string;
  /** Prefer passing name from reference_capability_areas for matching */
  referenceCapabilityAreaName?: string | null;
  orgCapabilityAreas: CapabilityAreaRow[];
};

/**
 * Resolve org capability_areas.id for a reference capability area using:
 * 1) exact normalised name match
 * 2) deterministic fallback aliases (first org match wins)
 * Returns null if no mapping — caller may leave capability_area_id null (Unassigned bucket).
 */
export function resolveOrganisationCapabilityAreaIdForReferenceArea(
  params: ResolveOrganisationCapabilityAreaParams,
): string | null {
  void params.organisationId;
  void params.referenceCapabilityAreaId;
  const name = params.referenceCapabilityAreaName?.trim();
  if (!name) return null;

  const normRef = normalizeCapabilityAreaName(name);
  if (!normRef) return null;

  const orgByNorm = new Map<string, string>();
  for (const a of params.orgCapabilityAreas) {
    const k = normalizeCapabilityAreaName(a.name);
    if (!orgByNorm.has(k)) orgByNorm.set(k, a.id);
  }

  const direct = orgByNorm.get(normRef);
  if (direct) return direct;

  const chain = REFERENCE_CAPABILITY_AREA_FALLBACKS[normRef];
  if (chain) {
    for (const candidate of chain) {
      const id = orgByNorm.get(normalizeCapabilityAreaName(candidate));
      if (id) return id;
    }
  }

  return null;
}

function frameworkHintTokens(hint: string | null | undefined): string[] {
  if (!hint?.trim()) return [];
  return hint
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Map a reference capability area name to an org capability_areas row (exact + fallbacks). */
export function mapOrgCapabilityAreaIdForReferenceArea(
  orgCapabilityAreas: CapabilityAreaRow[],
  referenceAreaName: string,
): string | null {
  return resolveOrganisationCapabilityAreaIdForReferenceArea({
    organisationId: "",
    referenceCapabilityAreaId: "",
    referenceCapabilityAreaName: referenceAreaName,
    orgCapabilityAreas,
  });
}

export async function listReferenceFrameworks(
  client: SupabaseClient,
  opts?: { includeNonPublishedForAdmin?: boolean },
): Promise<ReferenceFrameworkRow[]> {
  let q = client.from("reference_frameworks").select(
    "id, code, name, description, lifecycle_status",
  );
  if (!opts?.includeNonPublishedForAdmin) {
    q = q.in("lifecycle_status", ["published", "deprecated"]);
  }
  const { data, error } = await q.order("name");
  if (error) throw new Error(error.message);
  return (data as ReferenceFrameworkRow[]) ?? [];
}

export async function listReferenceStarterPacks(
  client: SupabaseClient,
  opts?: { publishedOnly?: boolean },
): Promise<ReferenceStarterPackRow[]> {
  let q = client
    .from("reference_starter_packs")
    .select(
      "id, code, name, description, reference_framework_id, lifecycle_status, reference_frameworks ( id, code, name, description, lifecycle_status )",
    );
  if (opts?.publishedOnly !== false) {
    q = q.eq("lifecycle_status", "published");
  }
  const { data, error } = await q.order("name");
  if (error) throw new Error(error.message);
  return (data as unknown as ReferenceStarterPackRow[]) ?? [];
}

export async function getReferenceStarterPackDetail(
  client: SupabaseClient,
  packId: string,
): Promise<{
  pack: ReferenceStarterPackRow;
  items: ReferenceStarterPackItemRow[];
}> {
  const { data: pack, error: pErr } = await client
    .from("reference_starter_packs")
    .select(
      "id, code, name, description, reference_framework_id, lifecycle_status, updated_at, reference_frameworks ( id, code, name, description, lifecycle_status )",
    )
    .eq("id", packId)
    .maybeSingle();
  if (pErr) throw new Error(pErr.message);
  if (!pack) throw new Error("Starter pack not found.");

  const { data: items, error: iErr } = await client
    .from("reference_starter_pack_items")
    .select(
      `id, starter_pack_id, item_type, reference_subject_id, reference_competency_id, sort_order,
       reference_subjects (
         id, name, description, lifecycle_status, reference_capability_area_id,
         reference_capability_areas ( id, name )
       ),
       reference_competencies (
         id, name, description, canonical_name, lifecycle_status, reference_subject_id,
         reference_subjects (
           id, name, description, lifecycle_status, reference_capability_area_id,
           reference_capability_areas ( id, name )
         )
       )`,
    )
    .eq("starter_pack_id", packId)
    .order("sort_order", { ascending: true });
  if (iErr) throw new Error(iErr.message);

  return {
    pack: pack as unknown as ReferenceStarterPackRow,
    items: (items as unknown as ReferenceStarterPackItemRow[]) ?? [],
  };
}

export async function listReferenceSubjects(
  client: SupabaseClient,
  filters: ReferenceSubjectFilters = {},
): Promise<
  (ReferenceSubjectRow & {
    reference_capability_areas?: ReferenceCapabilityAreaRow | null;
  })[]
> {
  let allowedAreaIds: string[] | null = null;
  if (filters.frameworkId) {
    const { data: areas, error: aErr } = await client
      .from("reference_capability_areas")
      .select("id")
      .eq("reference_framework_id", filters.frameworkId);
    if (aErr) throw new Error(aErr.message);
    allowedAreaIds = (areas ?? []).map((a: { id: string }) => a.id);
    if (allowedAreaIds.length === 0) return [];
  }

  let q = client
    .from("reference_subjects")
    .select(
      "id, reference_capability_area_id, name, description, lifecycle_status, reference_capability_areas ( id, name, reference_framework_id, lifecycle_status )",
    );

  if (filters.capabilityAreaId) {
    q = q.eq("reference_capability_area_id", filters.capabilityAreaId);
  }
  if (allowedAreaIds) {
    q = q.in("reference_capability_area_id", allowedAreaIds);
  }
  if (filters.lifecycle) {
    const lif = Array.isArray(filters.lifecycle)
      ? filters.lifecycle
      : [filters.lifecycle];
    q = q.in("lifecycle_status", lif);
  } else {
    q = q.in("lifecycle_status", ["published", "deprecated"]);
  }

  const { data, error } = await q.order("name");
  if (error) throw new Error(error.message);
  return (data as unknown as (ReferenceSubjectRow & {
    reference_capability_areas?: ReferenceCapabilityAreaRow | null;
  })[]) ?? [];
}

export async function listReferenceCompetencies(
  client: SupabaseClient,
  filters: ReferenceCompetencyFilters = {},
): Promise<
  (ReferenceCompetencyRow & {
    reference_subjects?: (ReferenceSubjectRow & {
      reference_capability_areas?: ReferenceCapabilityAreaRow | null;
    }) | null;
  })[]
> {
  let allowedSubjectIds: string[] | null = null;
  if (filters.frameworkId) {
    const { data: areas, error: aErr } = await client
      .from("reference_capability_areas")
      .select("id")
      .eq("reference_framework_id", filters.frameworkId);
    if (aErr) throw new Error(aErr.message);
    const areaIds = (areas ?? []).map((a: { id: string }) => a.id);
    if (areaIds.length === 0) return [];
    const { data: subs, error: sErr } = await client
      .from("reference_subjects")
      .select("id")
      .in("reference_capability_area_id", areaIds);
    if (sErr) throw new Error(sErr.message);
    allowedSubjectIds = (subs ?? []).map((s: { id: string }) => s.id);
    if (allowedSubjectIds.length === 0) return [];
  }

  let q = client
    .from("reference_competencies")
    .select(
      "id, reference_subject_id, name, description, canonical_name, lifecycle_status, reference_subjects ( id, name, reference_capability_area_id, lifecycle_status, reference_capability_areas ( id, reference_framework_id, name ) )",
    );

  if (filters.referenceSubjectId) {
    q = q.eq("reference_subject_id", filters.referenceSubjectId);
  }
  if (allowedSubjectIds) {
    q = q.in("reference_subject_id", allowedSubjectIds);
  }
  if (filters.lifecycle) {
    const lif = Array.isArray(filters.lifecycle)
      ? filters.lifecycle
      : [filters.lifecycle];
    q = q.in("lifecycle_status", lif);
  } else {
    q = q.in("lifecycle_status", ["published", "deprecated"]);
  }

  const { data, error } = await q.order("name");
  if (error) throw new Error(error.message);
  return (data as unknown as (ReferenceCompetencyRow & {
    reference_subjects?: (ReferenceSubjectRow & {
      reference_capability_areas?: ReferenceCapabilityAreaRow | null;
    }) | null;
  })[]) ?? [];
}

/**
 * Build nested reference capability areas → subjects → competencies for the AI payload.
 * When `referenceFrameworkHint` matches a published framework (code/name tokens), only that
 * framework’s tree is included; otherwise all published reference trees are included (bounded).
 */
export async function fetchReferenceTaxonomyPayload(
  client: SupabaseClient,
  referenceFrameworkHint: string | null | undefined,
  opts?: { maxAreas?: number },
): Promise<ReferenceTaxonomyPayload[]> {
  const maxAreas = opts?.maxAreas ?? 40;
  const frameworks = await listReferenceFrameworks(client);
  const tokens = frameworkHintTokens(referenceFrameworkHint ?? null);

  let selectedFrameworkIds = frameworks.map((f) => f.id);
  if (tokens.length > 0) {
    const narrowed = frameworks.filter((f) => {
      const blob = `${f.code} ${f.name}`.toLowerCase();
      return tokens.some((t) => blob.includes(t));
    });
    if (narrowed.length > 0) {
      selectedFrameworkIds = narrowed.map((f) => f.id);
    }
  }

  const { data: areas, error: aErr } = await client
    .from("reference_capability_areas")
    .select("id, reference_framework_id, name, sort_order, lifecycle_status")
    .in("reference_framework_id", selectedFrameworkIds)
    .in("lifecycle_status", ["published", "deprecated"])
    .order("sort_order")
    .limit(maxAreas);
  if (aErr) throw new Error(aErr.message);
  const areaRows = (areas ?? []) as ReferenceCapabilityAreaRow[];
  if (areaRows.length === 0) return [];

  const areaIds = areaRows.map((a) => a.id);
  const { data: subjects, error: sErr } = await client
    .from("reference_subjects")
    .select("id, reference_capability_area_id, name, lifecycle_status")
    .in("reference_capability_area_id", areaIds)
    .in("lifecycle_status", ["published", "deprecated"])
    .order("name");
  if (sErr) throw new Error(sErr.message);
  const subjectRows = (subjects ?? []) as ReferenceSubjectRow[];
  if (subjectRows.length === 0) {
    return areaRows.map((a) => ({
      id: a.id,
      name: a.name.trim(),
      subjects: [],
    }));
  }

  const subjectIds = subjectRows.map((s) => s.id);
  const { data: comps, error: cErr } = await client
    .from("reference_competencies")
    .select("id, reference_subject_id, name, lifecycle_status")
    .in("reference_subject_id", subjectIds)
    .in("lifecycle_status", ["published", "deprecated"])
    .order("name");
  if (cErr) throw new Error(cErr.message);
  const compRows = (comps ?? []) as ReferenceCompetencyRow[];

  return areaRows.map((area) => {
    const subs = subjectRows.filter(
      (s) => s.reference_capability_area_id === area.id,
    );
    return {
      id: area.id,
      name: area.name.trim(),
      subjects: subs.map((s) => ({
        id: s.id,
        name: s.name.trim(),
        competencies: compRows
          .filter((c) => c.reference_subject_id === s.id)
          .map((c) => ({ id: c.id, name: c.name.trim() })),
      })),
    };
  });
}

/**
 * Resolve org competency_subject for a reference subject (by reference_subject_id), or null.
 */
export async function findOrgSubjectForReferenceSubject(
  client: SupabaseClient,
  organisationId: string,
  referenceSubjectId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("competency_subjects")
    .select("id")
    .eq("organisation_id", organisationId)
    .eq("reference_subject_id", referenceSubjectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Resolve org competency for a reference competency (by reference_competency_id), or null.
 */
export async function findOrgCompetencyForReferenceCompetency(
  client: SupabaseClient,
  organisationId: string,
  referenceCompetencyId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("competencies")
    .select("id")
    .eq("organisation_id", organisationId)
    .eq("reference_competency_id", referenceCompetencyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { id: string } | null)?.id ?? null;
}

/** Normalise competency names for duplicate detection within an organisation. */
export function normalizeCompetencyName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, " ")
    .replace(/[''"`´]+/g, "")
    .replace(/[,;:.!?()[\]{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalise subject names for duplicate detection during reference adoption. */
export function normalizeSubjectName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, " ")
    .replace(/[''"`´]+/g, "")
    .replace(/[,;:.!?()[\]{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Starter Pack / reference subject → org capability area **display name** (not id).
 * Keys: {@link normalizeSubjectName}(reference subject name). Values must match an existing
 * org `capability_areas.name` (after {@link normalizeCapabilityAreaName}). Extend per pack (e.g. ITIL).
 */
const REFERENCE_SUBJECT_CROSSWALK_TO_ORG_CAPABILITY_AREA_NAME: Record<string, string> =
  Object.fromEntries(
    (
      [
        // BA_CORE — reference “Business Analysis” subjects → organisation taxonomy
        ["Strategy Analysis", "Strategy & Direction"],
        ["Elicitation and Collaboration", "Delivery & Execution"],
        ["Requirements Analysis and Definition", "Delivery & Execution"],
        ["Requirements Life Cycle Management", "Operations & Service"],
        ["Solution Evaluation", "Operations & Service"],
        ["Stakeholder Engagement", "Growth & Engagement"],
        ["Business Process and Operational Analysis", "Operations & Service"],
      ] as const
    ).map(([refSubject, orgAreaName]) => [
      normalizeSubjectName(refSubject),
      orgAreaName,
    ]),
  );

function orgCapabilityAreaLabelById(
  orgCapabilityAreas: CapabilityAreaRow[],
  id: string,
): string | null {
  const row = orgCapabilityAreas.find((a) => a.id === id);
  return row?.name?.trim() ?? null;
}

export type ResolveOrganisationCapabilityAreaForReferenceSubjectParams = {
  organisationId: string;
  referenceSubject: Pick<ReferenceSubjectRow, "id" | "name">;
  referenceCapabilityAreaId: string;
  referenceCapabilityAreaName: string | null | undefined;
  orgCapabilityAreas: CapabilityAreaRow[];
};

/**
 * Resolve org `capability_areas.id` for a reference subject:
 * 1) subject-level crosswalk (deterministic Starter Pack / known subjects)
 * 2) reference capability area match ({@link resolveOrganisationCapabilityAreaIdForReferenceArea})
 */
export function resolveOrganisationCapabilityAreaIdForReferenceSubject(
  params: ResolveOrganisationCapabilityAreaForReferenceSubjectParams,
): ReferenceSubjectCapabilityAreaResolution {
  const {
    organisationId,
    referenceSubject,
    referenceCapabilityAreaId,
    referenceCapabilityAreaName,
    orgCapabilityAreas,
  } = params;

  const orgByNorm = new Map<string, { id: string; name: string }>();
  for (const a of orgCapabilityAreas) {
    const k = normalizeCapabilityAreaName(a.name);
    if (!orgByNorm.has(k)) orgByNorm.set(k, { id: a.id, name: a.name.trim() });
  }

  const normSubject = normalizeSubjectName(referenceSubject.name);
  const crosswalkTarget = normSubject
    ? REFERENCE_SUBJECT_CROSSWALK_TO_ORG_CAPABILITY_AREA_NAME[normSubject]
    : undefined;

  if (crosswalkTarget) {
    const mapped = orgByNorm.get(normalizeCapabilityAreaName(crosswalkTarget));
    if (mapped) {
      return {
        capabilityAreaId: mapped.id,
        capabilityAreaResolved: true,
        mappedCapabilityAreaName: mapped.name,
        capabilityAreaMappingSource: "subject_crosswalk",
      };
    }
  }

  const fromArea = resolveOrganisationCapabilityAreaIdForReferenceArea({
    organisationId,
    referenceCapabilityAreaId,
    referenceCapabilityAreaName,
    orgCapabilityAreas,
  });

  if (fromArea) {
    return {
      capabilityAreaId: fromArea,
      capabilityAreaResolved: true,
      mappedCapabilityAreaName: orgCapabilityAreaLabelById(
        orgCapabilityAreas,
        fromArea,
      ),
      capabilityAreaMappingSource: "reference_area_match",
    };
  }

  return {
    capabilityAreaId: null,
    capabilityAreaResolved: false,
    mappedCapabilityAreaName: null,
    capabilityAreaMappingSource: "none",
  };
}

export type OrgCompetencyAdoptionRow = {
  id: string;
  name: string;
  status: string | null;
  is_active: boolean;
  subject_id: string | null;
  reference_competency_id: string | null;
  canonical_name: string | null;
  origin_type: string | null;
  competency_type: string | null;
};

const ORG_COMPETENCY_ADOPTION_SELECT =
  "id, name, status, is_active, subject_id, reference_competency_id, canonical_name, origin_type, competency_type";

export type OrgSubjectAdoptionRow = {
  id: string;
  name: string;
  status: string | null;
  is_active: boolean;
  capability_area_id: string | null;
  reference_subject_id: string | null;
  origin_type: string | null;
};

const ORG_SUBJECT_ADOPTION_SELECT =
  "id, name, status, is_active, capability_area_id, reference_subject_id, origin_type";

function orgSubjectLifecycleIsActive(row: OrgSubjectAdoptionRow): boolean {
  const s = (row.status ?? "active").toLowerCase();
  return s === "active" && row.is_active;
}

function scoreOrgSubjectMatch(
  s: OrgSubjectAdoptionRow,
  targetCapabilityAreaId: string | null,
  referenceSubjectId: string,
): number {
  let score = 0;
  if (s.reference_subject_id === referenceSubjectId) score += 1_000_000;
  if (targetCapabilityAreaId && s.capability_area_id === targetCapabilityAreaId) {
    score += 100_000;
  }
  if (orgSubjectLifecycleIsActive(s)) score += 50_000;
  const st = (s.status ?? "active").toLowerCase();
  if (st === "active") score += 20_000;
  else if (st === "deprecated") score += 10_000;
  if (st !== "archived") score += 5_000;
  if (s.is_active) score += 2_000;
  return score;
}

export type FindExistingOrganisationSubjectForAdoptionParams = {
  organisationId: string;
  referenceSubject: Pick<ReferenceSubjectRow, "id" | "name">;
  targetCapabilityAreaId: string | null;
};

export type FindExistingOrganisationSubjectForAdoptionResult = {
  row: OrgSubjectAdoptionRow;
  matchedBy: SubjectMatchBasis;
};

/**
 * Find an org competency_subject to reuse for reference adoption:
 * 1) reference_subject_id, 2) exact name, 3) normalised name (best-scored if several).
 */
export async function findExistingOrganisationSubjectForAdoption(
  client: SupabaseClient,
  params: FindExistingOrganisationSubjectForAdoptionParams,
): Promise<FindExistingOrganisationSubjectForAdoptionResult | null> {
  const { organisationId, referenceSubject, targetCapabilityAreaId } = params;
  const refId = referenceSubject.id;

  const { data: byRefRows, error: e1 } = await client
    .from("competency_subjects")
    .select(ORG_SUBJECT_ADOPTION_SELECT)
    .eq("organisation_id", organisationId)
    .eq("reference_subject_id", refId)
    .limit(1);
  if (e1) throw new Error(e1.message);
  const byRef = (byRefRows as OrgSubjectAdoptionRow[] | null)?.[0];
  if (byRef) return { row: byRef, matchedBy: "reference_id" };

  const trimmed = referenceSubject.name.trim();
  const { data: byExactRows, error: e2 } = await client
    .from("competency_subjects")
    .select(ORG_SUBJECT_ADOPTION_SELECT)
    .eq("organisation_id", organisationId)
    .eq("name", trimmed)
    .limit(1);
  if (e2) throw new Error(e2.message);
  const byExact = (byExactRows as OrgSubjectAdoptionRow[] | null)?.[0];
  if (byExact) return { row: byExact, matchedBy: "exact_name" };

  const norm = normalizeSubjectName(trimmed);
  if (!norm) return null;

  const { data: allRows, error: e3 } = await client
    .from("competency_subjects")
    .select(ORG_SUBJECT_ADOPTION_SELECT)
    .eq("organisation_id", organisationId);
  if (e3) throw new Error(e3.message);
  const normMatches = ((allRows as OrgSubjectAdoptionRow[]) ?? []).filter(
    (s) => normalizeSubjectName(s.name) === norm,
  );
  if (normMatches.length === 0) return null;
  if (normMatches.length === 1) return { row: normMatches[0]!, matchedBy: "normalized_name" };
  normMatches.sort(
    (a, b) =>
      scoreOrgSubjectMatch(b, targetCapabilityAreaId, refId) -
      scoreOrgSubjectMatch(a, targetCapabilityAreaId, refId),
  );
  return { row: normMatches[0]!, matchedBy: "normalized_name" };
}

/**
 * Restore traceability and active lifecycle on an existing org subject without overwriting meaningful data.
 */
export async function reactivateOrReuseOrganisationSubject(
  client: SupabaseClient,
  organisationId: string,
  existing: OrgSubjectAdoptionRow,
  referenceSubject: ReferenceSubjectRow,
  resolution: ReferenceSubjectCapabilityAreaResolution,
  matchedBy: SubjectMatchBasis,
): Promise<AdoptSubjectResult> {
  const wasActive = orgSubjectLifecycleIsActive(existing);
  const needsReactivation = !wasActive;

  const patch: Record<string, unknown> = {};

  if (needsReactivation) {
    patch.status = "active";
    patch.is_active = true;
    patch.deprecated_at = null;
    patch.deprecated_reason = null;
    patch.replaced_by_id = null;
  }

  if (existing.capability_area_id == null && resolution.capabilityAreaId != null) {
    patch.capability_area_id = resolution.capabilityAreaId;
  }

  if (!existing.reference_subject_id) {
    patch.reference_subject_id = referenceSubject.id;
  }

  if (!existing.origin_type?.trim()) {
    patch.origin_type = "reference_adopted";
  }

  if (Object.keys(patch).length > 0) {
    const { error: upErr } = await client
      .from("competency_subjects")
      .update(patch)
      .eq("id", existing.id)
      .eq("organisation_id", organisationId);
    if (upErr) throw new Error(upErr.message);
  }

  const mergedCapabilityAreaId =
    (patch.capability_area_id as string | undefined) ?? existing.capability_area_id;
  const fellBackToUnassignedCapabilityArea = !resolution.capabilityAreaResolved;

  return {
    competencySubjectId: existing.id,
    created: false,
    capability_area_id: mergedCapabilityAreaId,
    fellBackToUnassignedCapabilityArea,
    adoptedSubjectName: referenceSubject.name.trim(),
    reusedExisting: true,
    reactivatedExisting: needsReactivation,
    matchedBy,
    capabilityAreaResolved: resolution.capabilityAreaResolved,
    mappedCapabilityAreaName: resolution.mappedCapabilityAreaName,
    capabilityAreaMappingSource: resolution.capabilityAreaMappingSource,
  };
}

function orgCompetencyLifecycleIsActive(row: OrgCompetencyAdoptionRow): boolean {
  const s = (row.status ?? "active").toLowerCase();
  return s === "active" && row.is_active;
}

function scoreOrgCompetencyMatch(
  c: OrgCompetencyAdoptionRow,
  targetSubjectId: string | null,
  referenceCompetencyId: string,
): number {
  let score = 0;
  if (c.reference_competency_id === referenceCompetencyId) score += 1_000_000;
  if (targetSubjectId && c.subject_id === targetSubjectId) score += 100_000;
  if (orgCompetencyLifecycleIsActive(c)) score += 50_000;
  const st = (c.status ?? "").toLowerCase();
  if (st !== "archived" && st !== "deprecated") score += 10_000;
  if (c.reference_competency_id) score += 5_000;
  return score;
}

export type FindExistingOrganisationCompetencyParams = {
  organisationId: string;
  referenceCompetencyId: string;
  competencyName: string;
  targetSubjectId: string | null;
};

/**
 * Find an org competency to reuse for reference adoption:
 * A) same reference_competency_id, B) exact name, C) normalised name (best-scored if several).
 */
export async function findExistingOrganisationCompetencyForAdoption(
  client: SupabaseClient,
  params: FindExistingOrganisationCompetencyParams,
): Promise<OrgCompetencyAdoptionRow | null> {
  const {
    organisationId,
    referenceCompetencyId,
    competencyName,
    targetSubjectId,
  } = params;

  const { data: byRefRows, error: e1 } = await client
    .from("competencies")
    .select(ORG_COMPETENCY_ADOPTION_SELECT)
    .eq("organisation_id", organisationId)
    .eq("reference_competency_id", referenceCompetencyId)
    .limit(1);
  if (e1) throw new Error(e1.message);
  const byRef = (byRefRows as OrgCompetencyAdoptionRow[] | null)?.[0];
  if (byRef) return byRef;

  const trimmed = competencyName.trim();
  const { data: byExactRows, error: e2 } = await client
    .from("competencies")
    .select(ORG_COMPETENCY_ADOPTION_SELECT)
    .eq("organisation_id", organisationId)
    .eq("name", trimmed)
    .limit(1);
  if (e2) throw new Error(e2.message);
  const byExact = (byExactRows as OrgCompetencyAdoptionRow[] | null)?.[0];
  if (byExact) return byExact;

  const norm = normalizeCompetencyName(trimmed);
  if (!norm) return null;

  const { data: allRows, error: e3 } = await client
    .from("competencies")
    .select(ORG_COMPETENCY_ADOPTION_SELECT)
    .eq("organisation_id", organisationId);
  if (e3) throw new Error(e3.message);
  const normMatches = ((allRows as OrgCompetencyAdoptionRow[]) ?? []).filter(
    (c) => normalizeCompetencyName(c.name) === norm,
  );
  if (normMatches.length === 0) return null;
  if (normMatches.length === 1) return normMatches[0]!;
  normMatches.sort(
    (a, b) =>
      scoreOrgCompetencyMatch(b, targetSubjectId, referenceCompetencyId) -
      scoreOrgCompetencyMatch(a, targetSubjectId, referenceCompetencyId),
  );
  return normMatches[0]!;
}

/**
 * Reuse or restore an existing org competency for reference adoption — avoids unique-name insert failures.
 * Aligns with CompetenciesSection restore semantics (active + clear deprecation fields).
 */
export async function reactivateOrReuseOrganisationCompetency(
  client: SupabaseClient,
  organisationId: string,
  existing: OrgCompetencyAdoptionRow,
  targetSubjectId: string | null,
  ref: ReferenceCompetencyRow,
  referenceCompetencyId: string,
  adoptedSubject: AdoptSubjectResult | null,
): Promise<AdoptCompetencyResult> {
  const wasActive = orgCompetencyLifecycleIsActive(existing);
  const needsReactivation = !wasActive;

  const canonical = (ref.canonical_name ?? ref.name).trim();
  const displayName = existing.name.trim() || ref.name.trim();

  const patch: Record<string, unknown> = {};

  if (needsReactivation) {
    patch.status = "active";
    patch.is_active = true;
    patch.deprecated_at = null;
    patch.deprecated_reason = null;
    patch.replaced_by_id = null;
  }

  let relinkedToSubject = false;
  if (targetSubjectId && existing.subject_id !== targetSubjectId) {
    patch.subject_id = targetSubjectId;
    relinkedToSubject = true;
  }

  if (!existing.reference_competency_id) {
    patch.reference_competency_id = referenceCompetencyId;
  }
  if (!existing.canonical_name?.trim()) {
    patch.canonical_name = canonical;
  }
  if (!existing.origin_type?.trim()) {
    patch.origin_type = "reference_adopted";
  }

  if (Object.keys(patch).length > 0) {
    const { error: upErr } = await client
      .from("competencies")
      .update(patch)
      .eq("id", existing.id)
      .eq("organisation_id", organisationId);
    if (upErr) throw new Error(upErr.message);
  }

  const { count, error: cntErr } = await client
    .from("competency_level_definitions")
    .select("id", { count: "exact", head: true })
    .eq("competency_id", existing.id);
  if (cntErr) throw new Error(cntErr.message);
  if ((count ?? 0) === 0) {
    const { error: lvlErr } = await insertDefaultCompetencyLevels(
      client,
      existing.id,
    );
    if (lvlErr) {
      console.warn("insertDefaultCompetencyLevels (reuse path):", lvlErr.message);
    }
  }

  const reactivatedExisting = needsReactivation;
  const alreadyActiveExisting = wasActive;
  const reusedExisting = true;

  return {
    competencyId: existing.id,
    competencyName: displayName,
    created: false,
    reusedExisting,
    reactivatedExisting,
    alreadyActiveExisting,
    relinkedToSubject,
    subjectMatchedBy: adoptedSubject?.matchedBy ?? null,
    competencyLeftWithoutSubject: !targetSubjectId && !existing.subject_id,
    adoptedSubject,
    resolvedOrganisationSubjectId:
      targetSubjectId ?? existing.subject_id ?? null,
  };
}

export async function adoptReferenceSubjectToOrganisation(
  client: SupabaseClient,
  referenceSubjectId: string,
  organisationId: string,
  orgCapabilityAreas: CapabilityAreaRow[],
): Promise<AdoptSubjectResult> {
  const { data: sub, error: sErr } = await client
    .from("reference_subjects")
    .select(
      "id, name, description, reference_capability_area_id, reference_capability_areas ( id, name, reference_framework_id )",
    )
    .eq("id", referenceSubjectId)
    .maybeSingle();
  if (sErr) throw new Error(sErr.message);
  if (!sub) throw new Error("Reference subject not found.");

  const row = sub as unknown as ReferenceSubjectRow & {
    reference_capability_areas?:
      | { id: string; name: string }
      | { id: string; name: string }[]
      | null;
  };
  const refArea = row.reference_capability_areas;
  const refAreaRow = Array.isArray(refArea) ? refArea[0] : refArea;
  const refAreaId = refAreaRow?.id ?? row.reference_capability_area_id;
  const areaName = refAreaRow?.name ?? "";

  const resolution = resolveOrganisationCapabilityAreaIdForReferenceSubject({
    organisationId,
    referenceSubject: { id: referenceSubjectId, name: row.name },
    referenceCapabilityAreaId: refAreaId,
    referenceCapabilityAreaName: areaName,
    orgCapabilityAreas,
  });

  const capabilityAreaId = resolution.capabilityAreaId;
  const fellBackToUnassignedCapabilityArea = !resolution.capabilityAreaResolved;
  const subjectName = row.name.trim();

  const found = await findExistingOrganisationSubjectForAdoption(client, {
    organisationId,
    referenceSubject: { id: referenceSubjectId, name: row.name },
    targetCapabilityAreaId: capabilityAreaId,
  });

  if (found) {
    return reactivateOrReuseOrganisationSubject(
      client,
      organisationId,
      found.row,
      row,
      resolution,
      found.matchedBy,
    );
  }

  const { data: inserted, error: iErr } = await client
    .from("competency_subjects")
    .insert({
      organisation_id: organisationId,
      name: subjectName,
      description: row.description?.trim() ?? null,
      category: null,
      type: "practice",
      practice_id: null,
      capability_area_id: capabilityAreaId,
      is_active: true,
      status: "active",
      reference_subject_id: referenceSubjectId,
      origin_type: "reference_adopted",
    })
    .select("id")
    .single();
  if (iErr) throw new Error(iErr.message);
  return {
    competencySubjectId: inserted.id as string,
    created: true,
    capability_area_id: capabilityAreaId,
    fellBackToUnassignedCapabilityArea,
    adoptedSubjectName: subjectName,
    reusedExisting: false,
    reactivatedExisting: false,
    matchedBy: "new",
    capabilityAreaResolved: resolution.capabilityAreaResolved,
    mappedCapabilityAreaName: resolution.mappedCapabilityAreaName,
    capabilityAreaMappingSource: resolution.capabilityAreaMappingSource,
  };
}

export async function adoptReferenceCompetencyToOrganisation(
  client: SupabaseClient,
  referenceCompetencyId: string,
  organisationId: string,
  orgCapabilityAreas: CapabilityAreaRow[],
  competencySubjectIdOverride?: string | null,
): Promise<AdoptCompetencyResult> {
  const { data: rc, error: cErr } = await client
    .from("reference_competencies")
    .select("id, name, description, canonical_name, reference_subject_id")
    .eq("id", referenceCompetencyId)
    .maybeSingle();
  if (cErr) throw new Error(cErr.message);
  if (!rc) throw new Error("Reference competency not found.");

  const ref = rc as ReferenceCompetencyRow;
  let orgSubjectId = competencySubjectIdOverride?.trim() || null;
  let adoptedSubject: AdoptSubjectResult | null = null;
  if (!orgSubjectId) {
    adoptedSubject = await adoptReferenceSubjectToOrganisation(
      client,
      ref.reference_subject_id,
      organisationId,
      orgCapabilityAreas,
    );
    orgSubjectId = adoptedSubject.competencySubjectId;
  }

  const existingOrg = await findExistingOrganisationCompetencyForAdoption(
    client,
    {
      organisationId,
      referenceCompetencyId,
      competencyName: ref.name,
      targetSubjectId: orgSubjectId,
    },
  );

  if (existingOrg) {
    return reactivateOrReuseOrganisationCompetency(
      client,
      organisationId,
      existingOrg,
      orgSubjectId,
      ref,
      referenceCompetencyId,
      adoptedSubject,
    );
  }

  const canonical = (ref.canonical_name ?? ref.name).trim();
  const { data: inserted, error: iErr } = await client
    .from("competencies")
    .insert({
      organisation_id: organisationId,
      name: ref.name.trim(),
      description: ref.description?.trim() ?? null,
      competency_type: "practice",
      subject_id: orgSubjectId,
      is_active: true,
      status: "active",
      reference_competency_id: referenceCompetencyId,
      origin_type: "reference_adopted",
      canonical_name: canonical,
    })
    .select("id")
    .single();
  if (iErr) throw new Error(iErr.message);
  const newId = inserted.id as string;
  const { error: lvlErr } = await insertDefaultCompetencyLevels(client, newId);
  if (lvlErr) {
    console.warn("insertDefaultCompetencyLevels:", lvlErr.message);
  }
  return {
    competencyId: newId,
    competencyName: ref.name.trim(),
    created: true,
    reusedExisting: false,
    reactivatedExisting: false,
    alreadyActiveExisting: false,
    relinkedToSubject: false,
    subjectMatchedBy: adoptedSubject?.matchedBy ?? null,
    competencyLeftWithoutSubject: !orgSubjectId,
    adoptedSubject,
    resolvedOrganisationSubjectId: orgSubjectId,
  };
}

const UNASSIGNED_AREA_WARNING =
  "Some subjects could not be mapped to an organisation Capability Area and were placed in Unassigned.";

const SUBJECT_CAPABILITY_MAPPING_NOTE =
  "Some subjects could not be mapped to a Capability Area and were left unassigned.";

function pushUnassignedName(names: string[], name: string | null | undefined) {
  const n = name?.trim();
  if (n && !names.includes(n)) names.push(n);
}

/**
 * Deterministic starter pack → org `competency_practices.name` candidates (extend per pack).
 * Safety: only matches existing org rows — never creates practices here.
 */
const STARTER_PACK_CODE_TO_ORG_PRACTICE_NAME_CANDIDATES: Record<
  string,
  readonly string[]
> = {
  BA_CORE: ["Business Analysis"],
  /** Prefer service/ops naming common in Capability Studio; first exact org match wins. */
  ITIL_CORE: [
    "IT Service Management",
    "Service Management",
    "Operations & Service",
    "ITIL",
  ],
};

function normalizeOrgPracticeLookupName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, " ");
}

export type ResolveOrganisationPracticeForStarterPackParams = {
  organisationId: string;
  starterPackCode: string;
  starterPackName?: string | null;
  frameworkCode?: string | null;
  frameworkName?: string | null;
};

function collectOrgPracticeNameCandidatesForStarterPack(
  params: ResolveOrganisationPracticeForStarterPackParams,
): string[] {
  const out: string[] = [];
  const code = params.starterPackCode.trim().toUpperCase();
  const mapped = STARTER_PACK_CODE_TO_ORG_PRACTICE_NAME_CANDIDATES[code];
  if (mapped) out.push(...mapped);

  const fb = `${params.frameworkCode ?? ""} ${params.frameworkName ?? ""}`.toLowerCase();
  if (fb.includes("babok") || fb.includes("business analysis")) {
    out.push("Business Analysis");
  }
  if (fb.includes("itil")) {
    out.push("IT Service Management", "ITIL", "Operations & Service");
  }

  const pn = params.starterPackName?.trim().toLowerCase() ?? "";
  if (pn.includes("business analysis") || pn.includes("ba core")) {
    out.push("Business Analysis");
  }

  const seen = new Set<string>();
  return out
    .map((x) => x.trim())
    .filter((x) => {
      if (!x || seen.has(x.toLowerCase())) return false;
      seen.add(x.toLowerCase());
      return true;
    });
}

/**
 * Resolve a single org `competency_practices` row for Starter Pack adoption overlay linking.
 * Returns null if no suitable practice exists — adoption must still succeed without it.
 */
export async function resolveOrganisationPracticeForStarterPack(
  client: SupabaseClient,
  params: ResolveOrganisationPracticeForStarterPackParams,
): Promise<{ id: string; name: string } | null> {
  const { data, error } = await client
    .from("competency_practices")
    .select("id, name, status")
    .eq("organisation_id", params.organisationId)
    .in("status", ["active", "deprecated"]);
  if (error) throw new Error(error.message);
  const practices = ((data ?? []) as { id: string; name: string }[]).filter(
    (p) => p.name?.trim(),
  );
  const candidates = collectOrgPracticeNameCandidatesForStarterPack(params);
  if (candidates.length === 0) return null;

  for (const c of candidates) {
    const nc = normalizeOrgPracticeLookupName(c);
    const hit = practices.find(
      (p) => normalizeOrgPracticeLookupName(p.name) === nc,
    );
    if (hit) return { id: hit.id, name: hit.name.trim() };
  }

  const sorted = [...candidates].sort((a, b) => b.length - a.length);
  for (const c of sorted) {
    const nc = normalizeOrgPracticeLookupName(c);
    if (nc.length < 3) continue;
    const hit = practices.find((p) =>
      normalizeOrgPracticeLookupName(p.name).includes(nc),
    );
    if (hit) return { id: hit.id, name: hit.name.trim() };
  }

  return null;
}

/**
 * Idempotent: inserts subject_practice_links or succeeds on unique violation (23505).
 */
export async function ensureSubjectLinkedToPractice(
  client: SupabaseClient,
  organisationId: string,
  practiceId: string,
  competencySubjectId: string,
): Promise<{ error: Error | null; created: boolean }> {
  const { error } = await client.from("subject_practice_links").insert({
    organisation_id: organisationId,
    subject_id: competencySubjectId,
    practice_id: practiceId,
  });
  if (!error) return { error: null, created: true };
  if (error.code === "23505") return { error: null, created: false };
  return { error: new Error(error.message), created: false };
}

/**
 * Idempotent: inserts competency_practice_links or succeeds on unique violation (23505).
 */
export async function ensureCompetencyLinkedToPractice(
  client: SupabaseClient,
  organisationId: string,
  practiceId: string,
  competencyId: string,
): Promise<{ error: Error | null; created: boolean }> {
  const { error } = await client.from("competency_practice_links").insert({
    organisation_id: organisationId,
    competency_id: competencyId,
    practice_id: practiceId,
  });
  if (!error) return { error: null, created: true };
  if (error.code === "23505") return { error: null, created: false };
  return { error: new Error(error.message), created: false };
}

export async function adoptReferenceStarterPackToOrganisation(
  client: SupabaseClient,
  packId: string,
  organisationId: string,
  orgCapabilityAreas: CapabilityAreaRow[],
): Promise<AdoptStarterPackSummary> {
  const summary: AdoptStarterPackSummary = {
    subjectsAdded: 0,
    subjectsSkipped: 0,
    competenciesAdded: 0,
    competenciesSkipped: 0,
    competenciesReused: 0,
    competenciesReactivated: 0,
    subjectsUnassignedCount: 0,
    subjectsUnassignedNames: [],
    unassignedCapabilityAreaWarning: null,
    subjectCapabilityAreaMappingNote: null,
    subjectsReused: 0,
    subjectsReactivated: 0,
    competenciesRelinkedToSubjects: 0,
    competenciesLeftUnassigned: 0,
    practiceResolvedName: null,
    practiceLinkedSubjectsCount: 0,
    practiceLinkedCompetenciesCount: 0,
    practiceNewSubjectPracticeLinks: 0,
    practiceNewCompetencyPracticeLinks: 0,
    practiceLinkingNote: null,
    errors: [],
  };

  const { pack, items } = await getReferenceStarterPackDetail(client, packId);
  if (pack.lifecycle_status !== "published") {
    summary.errors.push("Pack is not published.");
    return summary;
  }

  const packFwRaw = pack.reference_frameworks;
  const packFw = (
    Array.isArray(packFwRaw) ? packFwRaw[0] : packFwRaw
  ) as { code?: string; name?: string } | null | undefined;

  let targetPractice: { id: string; name: string } | null = null;
  try {
    targetPractice = await resolveOrganisationPracticeForStarterPack(client, {
      organisationId,
      starterPackCode: pack.code,
      starterPackName: pack.name,
      frameworkCode: packFw?.code ?? null,
      frameworkName: packFw?.name ?? null,
    });
  } catch (e) {
    summary.errors.push(
      `Practice resolution: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  summary.practiceResolvedName = targetPractice?.name ?? null;

  const subjectsTouchedForPractice = new Set<string>();
  const competenciesTouchedForPractice = new Set<string>();

  const subjectItems = items.filter(isReferenceStarterPackSubjectItem);
  const competencyItems = items.filter(isReferenceStarterPackCompetencyItem);

  for (const it of subjectItems) {
    const rid = it.reference_subject_id!;
    try {
      const r = await adoptReferenceSubjectToOrganisation(
        client,
        rid,
        organisationId,
        orgCapabilityAreas,
      );
      if (r.created) {
        summary.subjectsAdded++;
        if (r.fellBackToUnassignedCapabilityArea) {
          summary.subjectsUnassignedCount++;
          pushUnassignedName(summary.subjectsUnassignedNames, r.adoptedSubjectName);
        }
      } else {
        summary.subjectsSkipped++;
        summary.subjectsReused++;
        if (r.reactivatedExisting) summary.subjectsReactivated++;
      }
      if (targetPractice) {
        const { error: ple, created: pCreated } =
          await ensureSubjectLinkedToPractice(
            client,
            organisationId,
            targetPractice.id,
            r.competencySubjectId,
          );
        if (ple) {
          summary.errors.push(
            `Practice link (subject ${rid}): ${ple.message}`,
          );
        } else {
          subjectsTouchedForPractice.add(r.competencySubjectId);
          if (pCreated) summary.practiceNewSubjectPracticeLinks++;
        }
      }
    } catch (e) {
      summary.errors.push(
        `Subject ${rid}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  for (const it of competencyItems) {
    const rid = it.reference_competency_id!;
    try {
      const r = await adoptReferenceCompetencyToOrganisation(
        client,
        rid,
        organisationId,
        orgCapabilityAreas,
        null,
      );
      if (r.created) {
        summary.competenciesAdded++;
      } else {
        summary.competenciesReused++;
        if (r.reactivatedExisting) summary.competenciesReactivated++;
        if (
          r.alreadyActiveExisting &&
          !r.relinkedToSubject &&
          !r.reactivatedExisting
        ) {
          summary.competenciesSkipped++;
        }
      }
      if (r.competencyLeftWithoutSubject) {
        summary.competenciesLeftUnassigned++;
      } else {
        summary.competenciesRelinkedToSubjects++;
      }
      const side = r.adoptedSubject;
      if (side) {
        if (side.created) {
          summary.subjectsAdded++;
          if (side.fellBackToUnassignedCapabilityArea) {
            summary.subjectsUnassignedCount++;
            pushUnassignedName(summary.subjectsUnassignedNames, side.adoptedSubjectName);
          }
        } else {
          summary.subjectsSkipped++;
          summary.subjectsReused++;
          if (side.reactivatedExisting) summary.subjectsReactivated++;
        }
      }
      if (targetPractice) {
        const sid = r.resolvedOrganisationSubjectId;
        if (sid) {
          const { error: se, created: sc } =
            await ensureSubjectLinkedToPractice(
              client,
              organisationId,
              targetPractice.id,
              sid,
            );
          if (se) {
            summary.errors.push(
              `Practice link (subject for competency ${rid}): ${se.message}`,
            );
          } else {
            subjectsTouchedForPractice.add(sid);
            if (sc) summary.practiceNewSubjectPracticeLinks++;
          }
        }
        const { error: ce, created: cc } = await ensureCompetencyLinkedToPractice(
          client,
          organisationId,
          targetPractice.id,
          r.competencyId,
        );
        if (ce) {
          summary.errors.push(
            `Practice link (competency ${rid}): ${ce.message}`,
          );
        } else {
          competenciesTouchedForPractice.add(r.competencyId);
          if (cc) summary.practiceNewCompetencyPracticeLinks++;
        }
      }
    } catch (e) {
      summary.errors.push(
        `Competency ${rid}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  summary.practiceLinkedSubjectsCount = subjectsTouchedForPractice.size;
  summary.practiceLinkedCompetenciesCount = competenciesTouchedForPractice.size;

  if (targetPractice) {
    const pn = targetPractice.name.trim();
    if (
      summary.practiceNewSubjectPracticeLinks === 0 &&
      summary.practiceNewCompetencyPracticeLinks === 0
    ) {
      summary.practiceLinkingNote = `Practice overlay: taxonomy items were already linked to “${pn}” (no new practice links needed).`;
    } else {
      summary.practiceLinkingNote = `Practice overlay: added ${summary.practiceNewSubjectPracticeLinks} new subject link(s) and ${summary.practiceNewCompetencyPracticeLinks} new competency link(s) for “${pn}”.`;
    }
  } else {
    summary.practiceLinkingNote =
      "No matching organisation practice was found — practice overlay links were not applied. Create or rename a practice to match this pack (e.g. “Business Analysis” for BA_CORE), or link manually.";
  }

  if (summary.subjectsUnassignedCount > 0) {
    summary.unassignedCapabilityAreaWarning = UNASSIGNED_AREA_WARNING;
    summary.subjectCapabilityAreaMappingNote = SUBJECT_CAPABILITY_MAPPING_NOTE;
  }

  return summary;
}

/** Lightweight coverage stats for refinement UI headers. */
export async function getReferenceCoverageForPractice(
  client: SupabaseClient,
  practiceId: string,
  _organisationId: string,
  practiceReferenceFramework: string | null | undefined,
  orgSubjectCount: number,
  orgCompetencyCount: number,
): Promise<ReferenceCoverageForPractice> {
  void practiceId;
  void _organisationId;
  const frameworks = await listReferenceFrameworks(client);
  const tokens = frameworkHintTokens(practiceReferenceFramework ?? null);
  let matched: ReferenceFrameworkRow | null = null;
  if (tokens.length > 0) {
    matched =
      frameworks.find((f) => {
        const blob = `${f.code} ${f.name}`.toLowerCase();
        return tokens.some((t) => blob.includes(t));
      }) ?? null;
  }

  let referenceSubjectCount = 0;
  let referenceCompetencyCount = 0;

  if (matched) {
    const { data: areas } = await client
      .from("reference_capability_areas")
      .select("id")
      .eq("reference_framework_id", matched.id)
      .in("lifecycle_status", ["published", "deprecated"]);
    const areaIds = (areas ?? []).map((a: { id: string }) => a.id);
    if (areaIds.length > 0) {
      const { count: subCount } = await client
        .from("reference_subjects")
        .select("id", { count: "exact", head: true })
        .in("reference_capability_area_id", areaIds)
        .in("lifecycle_status", ["published", "deprecated"]);
      referenceSubjectCount = subCount ?? 0;

      const { data: subs } = await client
        .from("reference_subjects")
        .select("id")
        .in("reference_capability_area_id", areaIds)
        .in("lifecycle_status", ["published", "deprecated"]);
      const sids = (subs ?? []).map((s: { id: string }) => s.id);
      if (sids.length > 0) {
        const { count: compCount } = await client
          .from("reference_competencies")
          .select("id", { count: "exact", head: true })
          .in("reference_subject_id", sids)
          .in("lifecycle_status", ["published", "deprecated"]);
        referenceCompetencyCount = compCount ?? 0;
      }
    }
  }

  return {
    organisationSubjectCount: orgSubjectCount,
    organisationCompetencyCount: orgCompetencyCount,
    matchedFrameworkId: matched?.id ?? null,
    matchedFrameworkLabel: matched
      ? `${matched.name} (${matched.code})`
      : null,
    referenceSubjectCount,
    referenceCompetencyCount,
  };
}

export async function listReferenceCompetencyAliasesForCompetencies(
  client: SupabaseClient,
  competencyIds: string[],
): Promise<ReferenceCompetencyAliasRow[]> {
  if (competencyIds.length === 0) return [];
  const { data, error } = await client
    .from("reference_competency_aliases")
    .select("id, reference_competency_id, alias")
    .in("reference_competency_id", competencyIds);
  if (error) throw new Error(error.message);
  return (data as ReferenceCompetencyAliasRow[]) ?? [];
}

export async function countReferenceDashboardStats(
  client: SupabaseClient,
): Promise<{
  frameworks: number;
  publishedSubjects: number;
  publishedCompetencies: number;
  publishedPacks: number;
  draftSubjects: number;
  deprecatedSubjects: number;
}> {
  const [{ count: frameworks }, { count: publishedSubjects }, { count: publishedCompetencies }, { count: publishedPacks }, { count: draftSubjects }, { count: deprecatedSubjects }] =
    await Promise.all([
      client
        .from("reference_frameworks")
        .select("id", { count: "exact", head: true }),
      client
        .from("reference_subjects")
        .select("id", { count: "exact", head: true })
        .eq("lifecycle_status", "published"),
      client
        .from("reference_competencies")
        .select("id", { count: "exact", head: true })
        .eq("lifecycle_status", "published"),
      client
        .from("reference_starter_packs")
        .select("id", { count: "exact", head: true })
        .eq("lifecycle_status", "published"),
      client
        .from("reference_subjects")
        .select("id", { count: "exact", head: true })
        .eq("lifecycle_status", "draft"),
      client
        .from("reference_subjects")
        .select("id", { count: "exact", head: true })
        .eq("lifecycle_status", "deprecated"),
    ]);

  return {
    frameworks: frameworks ?? 0,
    publishedSubjects: publishedSubjects ?? 0,
    publishedCompetencies: publishedCompetencies ?? 0,
    publishedPacks: publishedPacks ?? 0,
    draftSubjects: draftSubjects ?? 0,
    deprecatedSubjects: deprecatedSubjects ?? 0,
  };
}
