/**
 * Normalise `hiring_applications.cv_extract_snapshot` (import-cv-extract shape)
 * for Talent Search / consultancy review UI.
 */

export type TalentExperienceRow = {
  role_title: string | null;
  organisation_name: string | null;
  description: string | null;
  industry: string | null;
  start_date: string | null;
  end_date: string | null;
  skills: string[];
  source: "cv_extract" | "profile";
};

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function strArr(v: unknown, limit = 24): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = str(x);
    if (s) out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

export type CvExtractParsed = {
  summaryFromCv: string | null;
  /** Primary structured roles from CV extract (preferred for external review). */
  workExperience: TalentExperienceRow[];
  /** Short project lines for context. */
  projectHighlights: { title: string; subtitle: string | null }[];
  /** Flattened skill-like tokens from work + projects (deduped). */
  skillsAggregate: string[];
};

function normKey(title: string, org: string): string {
  return `${title.toLowerCase().slice(0, 80)}|${org.toLowerCase().slice(0, 80)}`;
}

/**
 * Parse CV extract JSON into display rows and highlights.
 */
export function parseCvExtractSnapshot(raw: unknown): CvExtractParsed | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const snap = raw as Record<string, unknown>;

  let summaryFromCv: string | null = null;
  const prof = snap.profile;
  if (prof && typeof prof === "object" && !Array.isArray(prof)) {
    const pr = prof as Record<string, unknown>;
    const sum = str(pr.summary);
    summaryFromCv = sum.length > 0 ? sum : null;
  }

  const workExperience: TalentExperienceRow[] = [];
  const wx = snap.work_experience;
  if (Array.isArray(wx)) {
    for (const item of wx) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const o = item as Record<string, unknown>;
      const role_title = str(o.role_title) || null;
      const organisation_name = str(o.organisation_name) || null;
      const description = str(o.description) || null;
      const industry = str(o.industry) || null;
      const start_date = str(o.start_date) || null;
      const end_date = str(o.end_date) || null;
      const skills = [
        ...strArr(o.skills, 20),
        ...strArr(o.methods, 12),
        ...strArr(o.tools, 12),
      ];
      const dedup = [...new Set(skills.map((s) => s.trim()).filter(Boolean))].slice(
        0,
        16,
      );
      if (!role_title && !organisation_name && !description) continue;
      workExperience.push({
        role_title,
        organisation_name,
        description,
        industry,
        start_date: start_date || null,
        end_date: end_date || null,
        skills: dedup,
        source: "cv_extract",
      });
    }
  }

  const projectHighlights: { title: string; subtitle: string | null }[] = [];
  const pj = snap.projects;
  if (Array.isArray(pj)) {
    for (const item of pj) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const o = item as Record<string, unknown>;
      const name = str(o.project_name) || str(o.name);
      if (!name) continue;
      const client = str(o.client);
      const role = str(o.role);
      const subtitle = [client, role].filter(Boolean).join(" · ") || null;
      projectHighlights.push({ title: name, subtitle });
      if (projectHighlights.length >= 8) break;
    }
  }

  const skillsAggregate: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    const t = s.trim();
    if (!t || t.length < 2) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    skillsAggregate.push(t);
  };
  for (const w of workExperience) {
    for (const s of w.skills ?? []) push(s);
  }
  if (Array.isArray(pj)) {
    for (const item of pj) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const o = item as Record<string, unknown>;
      for (const k of ["skills", "methods", "tools"] as const) {
        for (const s of strArr(o[k], 12)) push(s);
      }
    }
  }

  if (
    workExperience.length === 0 &&
    projectHighlights.length === 0 &&
    !summaryFromCv &&
    skillsAggregate.length === 0
  ) {
    return null;
  }

  return {
    summaryFromCv,
    workExperience,
    projectHighlights,
    skillsAggregate: skillsAggregate.slice(0, 24),
  };
}

/** Profile-backed experience rows (My Experience) for merge/dedupe. */
export function profileRowsToTalentRows(
  rows: Array<{
    role_title: string | null;
    organisation_name: string | null;
    description: string | null;
    industry: string | null;
    start_date: string | null;
    end_date: string | null;
    skills: string[] | null;
  }>,
): TalentExperienceRow[] {
  return rows.map((r) => ({
    role_title: r.role_title,
    organisation_name: r.organisation_name,
    description: r.description,
    industry: r.industry,
    start_date: r.start_date,
    end_date: r.end_date,
    skills: (r.skills ?? []).filter(Boolean),
    source: "profile" as const,
  }));
}

/**
 * Supplement profile rows that do not duplicate CV extract roles (fuzzy key on title+org).
 */
export function mergeExternalExperience(
  cvParsed: CvExtractParsed | null,
  profileRows: TalentExperienceRow[],
): { primary: TalentExperienceRow[]; supplementary: TalentExperienceRow[] } {
  const primary = cvParsed?.workExperience?.length
    ? [...cvParsed.workExperience]
    : [];

  const keys = new Set<string>();
  for (const r of primary) {
    keys.add(
      normKey(str(r.role_title), str(r.organisation_name)),
    );
  }

  const supplementary: TalentExperienceRow[] = [];
  for (const r of profileRows) {
    if (r.source !== "profile") continue;
    const k = normKey(str(r.role_title), str(r.organisation_name));
    if (keys.has(k)) continue;
    keys.add(k);
    supplementary.push(r);
  }

  return { primary, supplementary };
}
