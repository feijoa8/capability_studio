/**
 * Non-persistent semantic signal fit: normalized families vs candidate evidence. No AI.
 */

import {
  inferFamiliesForJobPhrase,
  labelForFamily,
  normalizeForMatch,
} from "./signalFamilies";

export type SignalFitResult = {
  score: number;
  summary: string;
  strengths: string[];
  partialCoverage: string[];
  gaps: string[];
  /** Number of raw job profile signal phrases (HR copy + skills). */
  jobSignalCount: number;
  /** Count of job signal families with strict candidate coverage. */
  overlapCount: number;
};

export type JobSignalsInput = {
  rawSignals: string[];
  families: string[];
};

export type CandidateSignalsInput = {
  rawSignals: string[];
  familiesStrict: string[];
  familiesLoose: string[];
};

const MAX_LIST = 5;
const FAMILY_WEIGHT = 0.72;
const RAW_WEIGHT = 0.28;
/** Partial family coverage counts at a fraction toward the family score. */
const PARTIAL_FAMILY_CREDIT = 0.52;

function buildSummary(score: number, jobRawCount: number): string {
  if (jobRawCount === 0) {
    return "This role has no hiring signals on the job profile yet. Add a summary, responsibilities, requirements, or skills in Job Profiles to score fit.";
  }
  if (score > 70) {
    return "Strong alignment with key role requirements. Candidate demonstrates relevant experience in core areas.";
  }
  if (score >= 40) {
    return "Moderate alignment. Candidate shows relevant strengths but lacks depth in some key areas.";
  }
  return "Limited alignment. Candidate lacks several core signals required for the role.";
}

function sortIdsByWeight(ids: string[], w: Map<string, number>): string[] {
  return [...ids].sort((a, b) => (w.get(b) ?? 0) - (w.get(a) ?? 0));
}

/** How many job signal phrases roll up into each family (importance). */
function buildFamilyImportance(rawSignals: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const raw of rawSignals) {
    for (const f of inferFamiliesForJobPhrase(raw)) {
      m.set(f, (m.get(f) ?? 0) + 1);
    }
  }
  return m;
}

function rawPhraseOverlapRatio(jobRaws: string[], candRaws: string[]): number {
  if (jobRaws.length === 0) return 0;
  const candNorm = candRaws.map(normalizeForMatch).filter(Boolean);
  let hits = 0;
  for (const j of jobRaws) {
    const jn = normalizeForMatch(j);
    if (!jn) continue;
    const hit = candNorm.some(
      (c) =>
        c === jn ||
        (jn.length > 2 && (c.includes(jn) || jn.includes(c))),
    );
    if (hit) hits++;
  }
  return hits / jobRaws.length;
}

/** Job phrases that did not map to any family — surfaced only if still unmatched in raw evidence. */
function unmappedJobGapDisplays(
  jobRaws: string[],
  candRaws: string[],
  maxAdd: number,
): string[] {
  const out: string[] = [];
  for (const raw of jobRaws) {
    if (inferFamiliesForJobPhrase(raw).length > 0) continue;
    const jn = normalizeForMatch(raw);
    if (!jn) continue;
    const hit = candRaws.some((c) => {
      const cn = normalizeForMatch(c);
      return (
        cn &&
        (cn === jn ||
          (jn.length > 2 && (cn.includes(jn) || jn.includes(cn))))
      );
    });
    if (!hit) {
      const t = raw.trim();
      const display = t.length > 44 ? `${t.slice(0, 41)}…` : t;
      out.push(display);
      if (out.length >= maxAdd) break;
    }
  }
  return out;
}

/**
 * Semantic fit: primary score from normalized family overlap (strict + partial via loose inference);
 * refined by raw phrase overlap. Gaps are concept labels, max 5.
 */
export function computeSignalFit(
  job: JobSignalsInput,
  candidate: CandidateSignalsInput,
): SignalFitResult {
  const jobRaws = job.rawSignals.map((s) => s.trim()).filter(Boolean);
  const jobFamilySet = new Set(job.families);
  const familyImportance = buildFamilyImportance(jobRaws);
  for (const f of jobFamilySet) {
    if (!familyImportance.has(f)) familyImportance.set(f, 1);
  }

  const candStrict = new Set(candidate.familiesStrict);
  const candLoose = new Set(candidate.familiesLoose);

  const overlapIds = [...jobFamilySet].filter((f) => candStrict.has(f));
  const partialIds = [...jobFamilySet].filter(
    (f) => !candStrict.has(f) && candLoose.has(f),
  );
  const gapIds = [...jobFamilySet].filter(
    (f) => !candStrict.has(f) && !candLoose.has(f),
  );

  const rawRatio = rawPhraseOverlapRatio(jobRaws, candidate.rawSignals);

  const jn = jobFamilySet.size;
  let score: number;

  if (jobRaws.length === 0) {
    score = 0;
  } else if (jn === 0) {
    score = Math.round(rawRatio * 100);
  } else {
    const covered =
      overlapIds.length + PARTIAL_FAMILY_CREDIT * partialIds.length;
    const familyRatio = Math.min(1, covered / jn);
    score = Math.round(
      Math.min(100, familyRatio * (FAMILY_WEIGHT * 100) + rawRatio * (RAW_WEIGHT * 100)),
    );
  }

  const strengths = sortIdsByWeight(overlapIds, familyImportance)
    .slice(0, MAX_LIST)
    .map(labelForFamily);

  const partialCoverage = sortIdsByWeight(partialIds, familyImportance)
    .slice(0, MAX_LIST)
    .map(labelForFamily);

  let gaps = sortIdsByWeight(gapIds, familyImportance)
    .slice(0, MAX_LIST)
    .map(labelForFamily);

  if (gaps.length < MAX_LIST) {
    const room = MAX_LIST - gaps.length;
    const extra = unmappedJobGapDisplays(
      jobRaws,
      candidate.rawSignals,
      room,
    );
    gaps = [...gaps, ...extra];
  }

  return {
    score,
    summary: buildSummary(score, jobRaws.length),
    strengths,
    partialCoverage,
    gaps,
    jobSignalCount: jobRaws.length,
    overlapCount: overlapIds.length,
  };
}
