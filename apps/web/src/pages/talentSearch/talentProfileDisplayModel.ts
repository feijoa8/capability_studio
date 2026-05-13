import type { TalentProfileDetailPayload } from "./talentSearchApi";
import {
  mergeExternalExperience,
  parseCvExtractSnapshot,
  profileRowsToTalentRows,
  type TalentExperienceRow,
} from "./cvExtractExperience";

export type { TalentExperienceRow } from "./cvExtractExperience";

export type TalentProfileDisplayModel = {
  headlineSummary: string | null;
  /** Total years from dated rows (rough), or null if insufficient dates. */
  yearsExperience: number | null;
  primaryExperiences: TalentExperienceRow[];
  supplementaryExperiences: TalentExperienceRow[];
  projectHighlights: { title: string; subtitle: string | null }[];
  skillsHighlight: string[];
  /** True when CV extract contributed structured rows or summary. */
  hasCvExtractStructure: boolean;
};

function parseYear(iso: string | null | undefined): number | null {
  if (!iso || typeof iso !== "string") return null;
  const m = iso.match(/^(\d{4})/);
  if (m) return parseInt(m[1], 10);
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.getFullYear();
  } catch {
    return null;
  }
}

function endYear(end: string | null | undefined): number | null {
  const eyRaw = end;
  if (
    !eyRaw ||
    (typeof eyRaw === "string" &&
      (eyRaw.toLowerCase().includes("present") ||
        eyRaw === "current" ||
        eyRaw.toLowerCase() === "now"))
  ) {
    return new Date().getFullYear();
  }
  return parseYear(eyRaw);
}

/** Career span (earliest start → latest end) when dates exist; rough MVP metric. */
function estimateYearsFromRows(
  rows: Pick<TalentExperienceRow, "start_date" | "end_date">[],
): number | null {
  let minS: number | null = null;
  let maxE: number | null = null;
  for (const r of rows) {
    const sy = parseYear(r.start_date);
    const ey = endYear(r.end_date);
    if (sy != null) minS = minS === null ? sy : Math.min(minS, sy);
    if (ey != null) maxE = maxE === null ? ey : Math.max(maxE, ey);
  }
  if (minS != null && maxE != null && maxE >= minS && maxE - minS < 80) {
    return maxE - minS;
  }
  return null;
}

export function buildTalentProfileDisplayModel(
  payload: TalentProfileDetailPayload,
): TalentProfileDisplayModel {
  const p = payload.profile;
  const profileExp = profileRowsToTalentRows(payload.experience ?? []);

  if (p.source_type === "internal") {
    const primaryExperiences = profileExp.map((r) => ({
      ...r,
      source: "profile" as const,
    }));
    return {
      headlineSummary: p.summary ?? null,
      yearsExperience: estimateYearsFromRows(primaryExperiences),
      primaryExperiences,
      supplementaryExperiences: [],
      projectHighlights: [],
      skillsHighlight: dedupeSkills(primaryExperiences.flatMap((x) => x.skills)),
      hasCvExtractStructure: false,
    };
  }

  const cvParsed = parseCvExtractSnapshot(p.cv_extract_snapshot);
  const merged = mergeExternalExperience(cvParsed, profileExp);

  const primaryExperiences = merged.primary.length
    ? merged.primary
    : merged.supplementary.length
      ? merged.supplementary
      : profileExp.map((r) => ({ ...r, source: "profile" as const }));

  const supplementaryExperiences =
    merged.primary.length > 0 ? merged.supplementary : [];

  const headlineSummary =
    (p.summary && p.summary.trim()) ||
    cvParsed?.summaryFromCv ||
    null;

  const allDated = [...primaryExperiences, ...supplementaryExperiences];
  const yearsExperience = estimateYearsFromRows(allDated);

  const skillsHighlight = dedupeSkills(
    cvParsed?.skillsAggregate?.length
      ? cvParsed.skillsAggregate
      : primaryExperiences.flatMap((x) => x.skills),
  );

  return {
    headlineSummary,
    yearsExperience,
    primaryExperiences,
    supplementaryExperiences,
    projectHighlights: cvParsed?.projectHighlights ?? [],
    skillsHighlight,
    hasCvExtractStructure: Boolean(
      cvParsed &&
        (cvParsed.workExperience.length > 0 ||
          !!cvParsed.summaryFromCv ||
          cvParsed.projectHighlights.length > 0),
    ),
  };
}

function dedupeSkills(skills: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of skills) {
    const t = s.trim();
    if (t.length < 2) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= 18) break;
  }
  return out;
}
