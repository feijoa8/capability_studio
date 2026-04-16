/**
 * System reference library admin CRUD (RLS: `is_reference_library_admin()` — system_role
 * system_admin + @feijoa8.com auth email).
 * Aligns with live `reference_starter_pack_items`: starter_pack_id, item_type, reference_*_id.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getReferenceStarterPackDetail,
  isReferenceStarterPackCompetencyItem,
  isReferenceStarterPackSubjectItem,
  type ReferenceCapabilityAreaRow,
  type ReferenceCompetencyRow,
  type ReferenceFrameworkRow,
  type ReferenceLifecycleStatus,
  type ReferenceStarterPackItemRow,
  type ReferenceStarterPackRow,
  type ReferenceSubjectRow,
} from "./referenceLibrary";

export type StarterPackAdminListRow = ReferenceStarterPackRow & {
  subject_count: number;
  competency_count: number;
  framework_label: string | null;
};

async function appendReviewLog(
  client: SupabaseClient,
  row: {
    entity_table: string;
    entity_id: string;
    action: string;
    details?: Record<string, unknown> | null;
  },
): Promise<void> {
  const { error } = await client.from("reference_review_log").insert({
    entity_table: row.entity_table,
    entity_id: row.entity_id,
    action: row.action,
    details: row.details ?? null,
  });
  if (error) {
    console.warn("[reference_review_log]", error.message);
  }
}

export async function fetchStarterPackItemCountsByPackId(
  client: SupabaseClient,
  packIds: string[],
): Promise<Record<string, { subjects: number; competencies: number }>> {
  const out: Record<string, { subjects: number; competencies: number }> = {};
  for (const id of packIds) {
    out[id] = { subjects: 0, competencies: 0 };
  }
  if (packIds.length === 0) return out;
  const { data, error } = await client
    .from("reference_starter_pack_items")
    .select(
      "starter_pack_id, item_type, reference_subject_id, reference_competency_id",
    )
    .in("starter_pack_id", packIds);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as ReferenceStarterPackItemRow[]) {
    const pid = row.starter_pack_id;
    if (!out[pid]) out[pid] = { subjects: 0, competencies: 0 };
    if (isReferenceStarterPackSubjectItem(row)) out[pid].subjects++;
    else if (isReferenceStarterPackCompetencyItem(row)) out[pid].competencies++;
  }
  return out;
}

export async function listStarterPacksAdmin(
  client: SupabaseClient,
): Promise<StarterPackAdminListRow[]> {
  const { data, error } = await client
    .from("reference_starter_packs")
    .select(
      "id, code, name, description, reference_framework_id, lifecycle_status, updated_at, created_at, reference_frameworks ( id, code, name )",
    )
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  const packs = (data ?? []) as unknown as (ReferenceStarterPackRow & {
    reference_frameworks?: { code?: string; name?: string } | null;
  })[];
  const ids = packs.map((p) => p.id);
  const counts = await fetchStarterPackItemCountsByPackId(client, ids);
  return packs.map((p) => {
    const fw = p.reference_frameworks;
    const f = Array.isArray(fw) ? fw[0] : fw;
    const framework_label = f?.name
      ? `${f.name}${f.code ? ` (${f.code})` : ""}`
      : null;
    const c = counts[p.id] ?? { subjects: 0, competencies: 0 };
    return {
      ...p,
      subject_count: c.subjects,
      competency_count: c.competencies,
      framework_label,
    };
  });
}

export async function getStarterPackAdminDetail(
  client: SupabaseClient,
  packId: string,
) {
  return getReferenceStarterPackDetail(client, packId);
}

export async function createReferenceFramework(
  client: SupabaseClient,
  row: {
    code: string;
    name: string;
    description?: string | null;
    lifecycle_status?: ReferenceLifecycleStatus;
  },
): Promise<ReferenceFrameworkRow> {
  const code = row.code.trim();
  const name = row.name.trim();
  if (!code || !name) throw new Error("Framework code and name are required.");
  const { data, error } = await client
    .from("reference_frameworks")
    .insert({
      code,
      name,
      description: row.description?.trim() || null,
      lifecycle_status: row.lifecycle_status ?? "draft",
    })
    .select("id, code, name, description, lifecycle_status")
    .single();
  if (error) throw new Error(error.message);
  await appendReviewLog(client, {
    entity_table: "reference_frameworks",
    entity_id: (data as ReferenceFrameworkRow).id,
    action: "created",
    details: { code },
  });
  return data as ReferenceFrameworkRow;
}

export async function updateReferenceFramework(
  client: SupabaseClient,
  id: string,
  patch: Partial<{
    code: string;
    name: string;
    description: string | null;
    lifecycle_status: ReferenceLifecycleStatus;
  }>,
): Promise<void> {
  const { error } = await client
    .from("reference_frameworks")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(error.message);
  await appendReviewLog(client, {
    entity_table: "reference_frameworks",
    entity_id: id,
    action: "updated",
    details: patch as Record<string, unknown>,
  });
}

export async function listReferenceCapabilityAreasAdmin(
  client: SupabaseClient,
  opts?: { frameworkId?: string },
): Promise<ReferenceCapabilityAreaRow[]> {
  let q = client
    .from("reference_capability_areas")
    .select(
      "id, reference_framework_id, code, name, description, sort_order, lifecycle_status",
    )
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (opts?.frameworkId) {
    q = q.eq("reference_framework_id", opts.frameworkId);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data as ReferenceCapabilityAreaRow[]) ?? [];
}

export async function createReferenceCapabilityArea(
  client: SupabaseClient,
  row: {
    reference_framework_id: string;
    code: string;
    name: string;
    description?: string | null;
    sort_order?: number;
    lifecycle_status?: ReferenceLifecycleStatus;
  },
): Promise<ReferenceCapabilityAreaRow> {
  const code = row.code.trim();
  const name = row.name.trim();
  if (!code || !name) throw new Error("Capability area code and name are required.");
  const { data, error } = await client
    .from("reference_capability_areas")
    .insert({
      reference_framework_id: row.reference_framework_id,
      code,
      name,
      description: row.description?.trim() || null,
      sort_order: row.sort_order ?? 0,
      lifecycle_status: row.lifecycle_status ?? "draft",
    })
    .select(
      "id, reference_framework_id, code, name, description, sort_order, lifecycle_status",
    )
    .single();
  if (error) throw new Error(error.message);
  const r = data as ReferenceCapabilityAreaRow;
  await appendReviewLog(client, {
    entity_table: "reference_capability_areas",
    entity_id: r.id,
    action: "created",
    details: { code, framework_id: row.reference_framework_id },
  });
  return r;
}

export async function updateReferenceCapabilityArea(
  client: SupabaseClient,
  id: string,
  patch: Partial<{
    code: string;
    name: string;
    description: string | null;
    sort_order: number;
    lifecycle_status: ReferenceLifecycleStatus;
    reference_framework_id: string;
  }>,
): Promise<void> {
  const { error } = await client
    .from("reference_capability_areas")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(error.message);
  await appendReviewLog(client, {
    entity_table: "reference_capability_areas",
    entity_id: id,
    action: "updated",
    details: patch as Record<string, unknown>,
  });
}

const SUBJECT_ADMIN_SELECT =
  "id, code, reference_capability_area_id, name, description, lifecycle_status, reference_capability_areas ( id, code, name, reference_framework_id )";

export async function listReferenceSubjectsAdmin(
  client: SupabaseClient,
  opts?: { frameworkId?: string; lifecycle?: ReferenceLifecycleStatus[] },
): Promise<
  (ReferenceSubjectRow & {
    reference_capability_areas?: ReferenceCapabilityAreaRow | null;
  })[]
> {
  let allowedAreaIds: string[] | null = null;
  if (opts?.frameworkId) {
    const { data: areas, error: aErr } = await client
      .from("reference_capability_areas")
      .select("id")
      .eq("reference_framework_id", opts.frameworkId);
    if (aErr) throw new Error(aErr.message);
    allowedAreaIds = (areas ?? []).map((a: { id: string }) => a.id);
    if (allowedAreaIds.length === 0) return [];
  }
  let q = client.from("reference_subjects").select(SUBJECT_ADMIN_SELECT);
  if (allowedAreaIds) {
    q = q.in("reference_capability_area_id", allowedAreaIds);
  }
  const lif = opts?.lifecycle;
  if (lif?.length) {
    q = q.in("lifecycle_status", lif);
  }
  const { data, error } = await q.order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as (ReferenceSubjectRow & {
    reference_capability_areas?: ReferenceCapabilityAreaRow | null;
  })[];
}

export async function createReferenceSubject(
  client: SupabaseClient,
  row: {
    code: string;
    reference_capability_area_id: string;
    name: string;
    description?: string | null;
    lifecycle_status?: ReferenceLifecycleStatus;
  },
): Promise<ReferenceSubjectRow> {
  const code = row.code.trim();
  const name = row.name.trim();
  if (!code || !name) throw new Error("Subject code and name are required.");
  const { data, error } = await client
    .from("reference_subjects")
    .insert({
      code,
      reference_capability_area_id: row.reference_capability_area_id,
      name,
      description: row.description?.trim() || null,
      lifecycle_status: row.lifecycle_status ?? "draft",
    })
    .select(SUBJECT_ADMIN_SELECT)
    .single();
  if (error) throw new Error(error.message);
  const r = data as unknown as ReferenceSubjectRow;
  await appendReviewLog(client, {
    entity_table: "reference_subjects",
    entity_id: r.id,
    action: "created",
    details: { code },
  });
  return r;
}

export async function updateReferenceSubject(
  client: SupabaseClient,
  id: string,
  patch: Partial<{
    code: string;
    reference_capability_area_id: string;
    name: string;
    description: string | null;
    lifecycle_status: ReferenceLifecycleStatus;
  }>,
): Promise<void> {
  const { error } = await client
    .from("reference_subjects")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(error.message);
  await appendReviewLog(client, {
    entity_table: "reference_subjects",
    entity_id: id,
    action: "updated",
    details: patch as Record<string, unknown>,
  });
}

const COMP_ADMIN_SELECT =
  "id, code, reference_subject_id, name, description, canonical_name, lifecycle_status, reference_subjects ( id, code, name, reference_capability_area_id )";

export async function listReferenceCompetenciesAdmin(
  client: SupabaseClient,
  opts?: {
    frameworkId?: string;
    referenceSubjectId?: string;
    lifecycle?: ReferenceLifecycleStatus[];
  },
): Promise<
  (ReferenceCompetencyRow & {
    reference_subjects?: ReferenceSubjectRow | null;
  })[]
> {
  let allowedSubjectIds: string[] | null = null;
  if (opts?.frameworkId) {
    const { data: areas, error: aErr } = await client
      .from("reference_capability_areas")
      .select("id")
      .eq("reference_framework_id", opts.frameworkId);
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
  let q = client.from("reference_competencies").select(COMP_ADMIN_SELECT);
  if (opts?.referenceSubjectId) {
    q = q.eq("reference_subject_id", opts.referenceSubjectId);
  }
  if (allowedSubjectIds) {
    q = q.in("reference_subject_id", allowedSubjectIds);
  }
  if (opts?.lifecycle?.length) {
    q = q.in("lifecycle_status", opts.lifecycle);
  }
  const { data, error } = await q.order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as (ReferenceCompetencyRow & {
    reference_subjects?: ReferenceSubjectRow | null;
  })[];
}

export async function createReferenceCompetency(
  client: SupabaseClient,
  row: {
    code: string;
    reference_subject_id: string;
    name: string;
    description?: string | null;
    canonical_name?: string | null;
    lifecycle_status?: ReferenceLifecycleStatus;
  },
): Promise<ReferenceCompetencyRow> {
  const code = row.code.trim();
  const name = row.name.trim();
  if (!code || !name) throw new Error("Competency code and name are required.");
  const { data, error } = await client
    .from("reference_competencies")
    .insert({
      code,
      reference_subject_id: row.reference_subject_id,
      name,
      description: row.description?.trim() || null,
      canonical_name: row.canonical_name?.trim() || null,
      lifecycle_status: row.lifecycle_status ?? "draft",
    })
    .select(COMP_ADMIN_SELECT)
    .single();
  if (error) throw new Error(error.message);
  const r = data as unknown as ReferenceCompetencyRow;
  await appendReviewLog(client, {
    entity_table: "reference_competencies",
    entity_id: r.id,
    action: "created",
    details: { code },
  });
  return r;
}

export async function updateReferenceCompetency(
  client: SupabaseClient,
  id: string,
  patch: Partial<{
    code: string;
    reference_subject_id: string;
    name: string;
    description: string | null;
    canonical_name: string | null;
    lifecycle_status: ReferenceLifecycleStatus;
  }>,
): Promise<void> {
  const { error } = await client
    .from("reference_competencies")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(error.message);
  await appendReviewLog(client, {
    entity_table: "reference_competencies",
    entity_id: id,
    action: "updated",
    details: patch as Record<string, unknown>,
  });
}

export async function createStarterPack(
  client: SupabaseClient,
  row: {
    code: string;
    name: string;
    description?: string | null;
    reference_framework_id: string | null;
    lifecycle_status?: ReferenceLifecycleStatus;
  },
): Promise<ReferenceStarterPackRow> {
  const code = row.code.trim();
  const name = row.name.trim();
  if (!code || !name) throw new Error("Starter pack code and name are required.");
  const { data, error } = await client
    .from("reference_starter_packs")
    .insert({
      code,
      name,
      description: row.description?.trim() || null,
      reference_framework_id: row.reference_framework_id,
      lifecycle_status: row.lifecycle_status ?? "draft",
    })
    .select(
      "id, code, name, description, reference_framework_id, lifecycle_status, updated_at",
    )
    .single();
  if (error) throw new Error(error.message);
  const p = data as ReferenceStarterPackRow;
  await appendReviewLog(client, {
    entity_table: "reference_starter_packs",
    entity_id: p.id,
    action: "created",
    details: { code },
  });
  return p;
}

export async function updateStarterPack(
  client: SupabaseClient,
  id: string,
  patch: Partial<{
    code: string;
    name: string;
    description: string | null;
    reference_framework_id: string | null;
    lifecycle_status: ReferenceLifecycleStatus;
  }>,
): Promise<void> {
  const { error } = await client
    .from("reference_starter_packs")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(error.message);
  await appendReviewLog(client, {
    entity_table: "reference_starter_packs",
    entity_id: id,
    action: "updated",
    details: patch as Record<string, unknown>,
  });
}

export async function duplicateStarterPack(
  client: SupabaseClient,
  sourcePackId: string,
  newCode: string,
  newName: string,
): Promise<ReferenceStarterPackRow> {
  const code = newCode.trim();
  const name = newName.trim();
  if (!code || !name) throw new Error("New code and name are required.");
  const { pack, items } = await getReferenceStarterPackDetail(
    client,
    sourcePackId,
  );
  const { data: inserted, error: insErr } = await client
    .from("reference_starter_packs")
    .insert({
      code,
      name,
      description: pack.description?.trim()
        ? `Copy · ${pack.description.trim()}`
        : `Duplicate of ${pack.name}`,
      reference_framework_id: pack.reference_framework_id,
      lifecycle_status: "draft",
    })
    .select(
      "id, code, name, description, reference_framework_id, lifecycle_status, updated_at",
    )
    .single();
  if (insErr) throw new Error(insErr.message);
  const newPack = inserted as ReferenceStarterPackRow;
  let sort = 0;
  for (const it of items) {
    const isSub = isReferenceStarterPackSubjectItem(it);
    const isComp = isReferenceStarterPackCompetencyItem(it);
    if (!isSub && !isComp) continue;
    sort += 1;
    const { error: itErr } = await client
      .from("reference_starter_pack_items")
      .insert({
        starter_pack_id: newPack.id,
        item_type: isSub ? "subject" : "competency",
        reference_subject_id: isSub ? it.reference_subject_id : null,
        reference_competency_id: isComp ? it.reference_competency_id : null,
        sort_order: it.sort_order ?? sort,
      });
    if (itErr) throw new Error(itErr.message);
  }
  await appendReviewLog(client, {
    entity_table: "reference_starter_packs",
    entity_id: newPack.id,
    action: "duplicated",
    details: { from: sourcePackId, code },
  });
  return newPack;
}

async function nextItemSortOrder(
  client: SupabaseClient,
  packId: string,
): Promise<number> {
  const { data, error } = await client
    .from("reference_starter_pack_items")
    .select("sort_order")
    .eq("starter_pack_id", packId)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const max = (data as { sort_order: number }[] | null)?.[0]?.sort_order;
  return typeof max === "number" ? max + 1 : 0;
}

export async function addSubjectToStarterPack(
  client: SupabaseClient,
  packId: string,
  referenceSubjectId: string,
): Promise<void> {
  const { data: existing } = await client
    .from("reference_starter_pack_items")
    .select("id")
    .eq("starter_pack_id", packId)
    .eq("item_type", "subject")
    .eq("reference_subject_id", referenceSubjectId)
    .maybeSingle();
  if (existing) throw new Error("That subject is already in this pack.");
  const sort_order = await nextItemSortOrder(client, packId);
  const { error } = await client.from("reference_starter_pack_items").insert({
    starter_pack_id: packId,
    item_type: "subject",
    reference_subject_id: referenceSubjectId,
    reference_competency_id: null,
    sort_order,
  });
  if (error) throw new Error(error.message);
  await appendReviewLog(client, {
    entity_table: "reference_starter_pack_items",
    entity_id: packId,
    action: "subject_added",
    details: { reference_subject_id: referenceSubjectId },
  });
}

export async function removeSubjectFromStarterPack(
  client: SupabaseClient,
  itemId: string,
): Promise<void> {
  const { error } = await client
    .from("reference_starter_pack_items")
    .delete()
    .eq("id", itemId);
  if (error) throw new Error(error.message);
}

export async function addCompetencyToStarterPack(
  client: SupabaseClient,
  packId: string,
  referenceCompetencyId: string,
): Promise<void> {
  const { data: existing } = await client
    .from("reference_starter_pack_items")
    .select("id")
    .eq("starter_pack_id", packId)
    .eq("item_type", "competency")
    .eq("reference_competency_id", referenceCompetencyId)
    .maybeSingle();
  if (existing) throw new Error("That competency is already in this pack.");
  const sort_order = await nextItemSortOrder(client, packId);
  const { error } = await client.from("reference_starter_pack_items").insert({
    starter_pack_id: packId,
    item_type: "competency",
    reference_subject_id: null,
    reference_competency_id: referenceCompetencyId,
    sort_order,
  });
  if (error) throw new Error(error.message);
  await appendReviewLog(client, {
    entity_table: "reference_starter_pack_items",
    entity_id: packId,
    action: "competency_added",
    details: { reference_competency_id: referenceCompetencyId },
  });
}

export async function removeCompetencyFromStarterPack(
  client: SupabaseClient,
  itemId: string,
): Promise<void> {
  const { error } = await client
    .from("reference_starter_pack_items")
    .delete()
    .eq("id", itemId);
  if (error) throw new Error(error.message);
}

export async function updateStarterPackItemSortOrder(
  client: SupabaseClient,
  itemId: string,
  sort_order: number,
): Promise<void> {
  const { error } = await client
    .from("reference_starter_pack_items")
    .update({ sort_order })
    .eq("id", itemId);
  if (error) throw new Error(error.message);
}

/** Usage counts: how many starter pack items reference this subject. */
export async function countStarterPackUsageForReferenceSubject(
  client: SupabaseClient,
  referenceSubjectId: string,
): Promise<number> {
  const { count, error } = await client
    .from("reference_starter_pack_items")
    .select("id", { count: "exact", head: true })
    .eq("item_type", "subject")
    .eq("reference_subject_id", referenceSubjectId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function countStarterPackUsageForReferenceCompetency(
  client: SupabaseClient,
  referenceCompetencyId: string,
): Promise<number> {
  const { count, error } = await client
    .from("reference_starter_pack_items")
    .select("id", { count: "exact", head: true })
    .eq("item_type", "competency")
    .eq("reference_competency_id", referenceCompetencyId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Batch: competency rows per reference subject (for admin tables). */
export async function countCompetenciesBySubjectIds(
  client: SupabaseClient,
  subjectIds: string[],
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const id of subjectIds) out[id] = 0;
  if (subjectIds.length === 0) return out;
  const { data, error } = await client
    .from("reference_competencies")
    .select("reference_subject_id")
    .in("reference_subject_id", subjectIds);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as { reference_subject_id: string }[]) {
    const sid = row.reference_subject_id;
    out[sid] = (out[sid] ?? 0) + 1;
  }
  return out;
}

/** Batch: subject-type pack items per reference subject. */
export async function countSubjectStarterPackItemsBySubjectIds(
  client: SupabaseClient,
  subjectIds: string[],
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const id of subjectIds) out[id] = 0;
  if (subjectIds.length === 0) return out;
  const { data, error } = await client
    .from("reference_starter_pack_items")
    .select("reference_subject_id")
    .eq("item_type", "subject")
    .in("reference_subject_id", subjectIds);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as { reference_subject_id: string | null }[]) {
    const sid = row.reference_subject_id;
    if (sid) out[sid] = (out[sid] ?? 0) + 1;
  }
  return out;
}

/** Batch: competency-type pack items per reference competency. */
export async function countCompetencyStarterPackItemsByCompetencyIds(
  client: SupabaseClient,
  competencyIds: string[],
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const id of competencyIds) out[id] = 0;
  if (competencyIds.length === 0) return out;
  const { data, error } = await client
    .from("reference_starter_pack_items")
    .select("reference_competency_id")
    .eq("item_type", "competency")
    .in("reference_competency_id", competencyIds);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as { reference_competency_id: string | null }[]) {
    const cid = row.reference_competency_id;
    if (cid) out[cid] = (out[cid] ?? 0) + 1;
  }
  return out;
}

export function validatePublishStarterPack(
  pack: Pick<
    ReferenceStarterPackRow,
    "code" | "name" | "reference_framework_id" | "lifecycle_status"
  >,
  itemCount: number,
  opts?: { requireItems?: boolean },
): string | null {
  if (!pack.code?.trim() || !pack.name?.trim()) {
    return "Code and name are required before publishing.";
  }
  if (!pack.reference_framework_id) {
    return "Select a reference framework before publishing.";
  }
  if (opts?.requireItems && itemCount === 0) {
    return "Add at least one pack item before publishing.";
  }
  return null;
}
