import type { SupabaseClient } from "@supabase/supabase-js";

export type JobProfilePreviewCompetency = {
  name: string;
  requiredLevel: string | null;
  relevance: string;
};

export type JobProfilePreviewData = {
  title: string;
  roleSummary: string | null;
  levelName: string | null;
  responsibilities: string[];
  requirements: string[];
  skills: string[];
  /** Populated only when `includeCompetencies` is true (developmental / L&D view). */
  competencies: JobProfilePreviewCompetency[];
};

export type JobProfilePreviewOptions = {
  /** When true, loads mapped competencies (internal development constructs). Default false for hiring-facing preview. */
  includeCompetencies?: boolean;
};

function competencyNameFromRow(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "object" && raw !== null && "name" in raw) {
    return String((raw as { name: string }).name ?? "").trim();
  }
  return "";
}

async function fetchCompetencyMappings(
  client: SupabaseClient,
  jobProfileId: string,
): Promise<JobProfilePreviewCompetency[]> {
  const { data: jpcRows, error } = await client
    .from("job_profile_competencies")
    .select("required_level, relevance, competencies ( name )")
    .eq("job_profile_id", jobProfileId);

  if (error) {
    console.warn("job_profile_competencies preview:", error.message);
    return [];
  }

  const competencies: JobProfilePreviewCompetency[] = [];
  for (const raw of jpcRows ?? []) {
    const r = raw as {
      required_level: string | null;
      relevance: string;
      competencies: { name: string } | { name: string }[] | null;
    };
    const emb = r.competencies;
    const name =
      Array.isArray(emb) && emb[0]
        ? competencyNameFromRow(emb[0])
        : competencyNameFromRow(emb);
    if (!name) continue;
    competencies.push({
      name,
      requiredLevel: r.required_level,
      relevance: r.relevance ?? "medium",
    });
  }

  competencies.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
  return competencies;
}

/**
 * Read-only job profile bundle for Hiring preview: HR-style signals only by default.
 * Competency mappings are omitted unless `includeCompetencies` is requested.
 */
export async function fetchJobProfilePreviewData(
  client: SupabaseClient,
  jobProfileId: string,
  opts?: JobProfilePreviewOptions,
): Promise<JobProfilePreviewData | null> {
  const includeCompetencies = opts?.includeCompetencies === true;

  const { data: jp, error: jpErr } = await client
    .from("job_profiles")
    .select("title, role_summary, level_name")
    .eq("id", jobProfileId)
    .maybeSingle();

  if (jpErr || !jp) {
    if (jpErr) console.warn("job_profiles preview:", jpErr.message);
    return null;
  }

  const row = jp as {
    title: string;
    role_summary?: string | null;
    level_name?: string | null;
  };

  const [
    { data: respRows },
    { data: reqRows },
    { data: skillRows },
    competencies,
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
    includeCompetencies
      ? fetchCompetencyMappings(client, jobProfileId)
      : Promise.resolve([] as JobProfilePreviewCompetency[]),
  ]);

  const responsibilities = (respRows ?? [])
    .map((r) => String((r as { description: string }).description ?? "").trim())
    .filter(Boolean);

  const requirements = (reqRows ?? [])
    .map((r) => String((r as { description: string }).description ?? "").trim())
    .filter(Boolean);

  const skillNames = (skillRows ?? [])
    .map((r) => String((r as { name: string }).name ?? "").trim())
    .filter(Boolean);
  const seenSkill = new Set<string>();
  const skills: string[] = [];
  for (const s of skillNames) {
    const k = s.toLowerCase();
    if (seenSkill.has(k)) continue;
    seenSkill.add(k);
    skills.push(s);
  }
  skills.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  return {
    title: String(row.title ?? "").trim() || "Job profile",
    roleSummary: row.role_summary?.trim() || null,
    levelName: row.level_name?.trim() || null,
    responsibilities,
    requirements,
    skills,
    competencies,
  };
}
