import type { SupabaseClient } from "@supabase/supabase-js";
import type { HiringApplicationRow } from "./hiringApi";
import { fetchJobSignals } from "./evaluationData";
import { fetchJobProfilePreviewData } from "./jobProfilePreview";
import { parseEvaluationSnapshot } from "./hiringEvaluationDisplay";

export type InterviewQuestionSections = {
  strengthValidation: string[];
  gapExploration: string[];
  roleCritical: string[];
};

const MAX_STRENGTH = 3;
const MAX_GAP = 3;
const MAX_ROLE = 2;
const MAX_EMBED = 90;

function clipPhrase(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trim() + "…";
}

function dedupeLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels) {
    const t = raw.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/** Word-style match for short tokens that are substrings of common English words (e.g. excel / excellent). */
function includesWordCaseInsensitive(haystack: string, word: string): boolean {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${esc}\\b`, "i").test(haystack);
}

/** Picks among behavioural opener patterns deterministically (per label + section). */
function variantIndex(seed: string, salt: number): number {
  let h = salt * 17;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 4;
}

/** Strength validation — behavioural / outcome-focused, not requirement restatement. */
function buildStrengthQuestion(strength: string, index: number): string {
  const s = clipPhrase(strength.trim(), MAX_EMBED);
  const v = variantIndex(strength, index);

  switch (v) {
    case 0:
      return `Can you tell me about a time when ${s} was clearly part of how you delivered a meaningful outcome? What happened?`;
    case 1:
      return `Describe a situation where you had to rely on ${s} under real pressure. What did you do, and what changed as a result?`;
    case 2:
      return `Walk me through an example of applying ${s} when something important was on the line for the team or the business.`;
    default:
      return `Tell me about how you’ve put ${s} into practice — what actions did you take and what did you learn?`;
  }
}

/**
 * Gap exploration — behavioural phrasing by gap type (qualification / tool / domain / general).
 * `index` rotates templates so consecutive gaps don’t sound identical.
 */
function buildGapQuestion(gap: string, index: number): string {
  const g = clipPhrase(gap.trim(), MAX_EMBED);
  const lower = gap.toLowerCase();
  const alt = index % 2 === 0;

  if (
    lower.includes("degree") ||
    lower.includes("qualification") ||
    lower.includes("certification")
  ) {
    if (alt) {
      return `Describe a situation where you had to apply knowledge or judgement that many people strengthen through formal study. When you think about expectations connected to “${g}”, how have you built comparable depth through your experience?`;
    }
    return `Can you tell me about a time when you had to draw on structured judgement or analysis in your work — in ways that relate to areas like “${g}” — and how you’ve developed that capability over time?`;
  }

  const toolKeywords = [
    "tool",
    "system",
    "platform",
    "software",
    "confluence",
    "jira",
    "sql",
    "power bi",
  ] as const;
  const hasToolKeyword =
    toolKeywords.some((k) => lower.includes(k)) ||
    includesWordCaseInsensitive(gap, "excel");

  if (hasToolKeyword) {
    if (alt) {
      return `Describe a situation where you had to get up to speed quickly with a new tool or platform. How did you approach it when something like “${g}” was in the mix?`;
    }
    return `Can you tell me about a time when you used tools or platforms comparable to those around “${g}”, and how you applied them to move work forward?`;
  }

  const domainKeywords = [
    "banking",
    "finance",
    "health",
    "insurance",
    "regulatory",
    "government",
    "industry",
  ] as const;
  if (domainKeywords.some((k) => lower.includes(k))) {
    if (alt) {
      return `Can you tell me about a time when you had to assess impact or risk in a regulated or tightly governed context? What was your approach, especially where “${g}” was relevant?`;
    }
    return `Describe a situation where you had to work in a regulated or high-governance environment. How did you navigate it, particularly in settings that touch on “${g}”?`;
  }

  if (alt) {
    return `Walk me through an example of how you’ve approached “${g}” on the job when it mattered for an outcome. What did you actually do?`;
  }
  return `Can you tell me about a time when getting “${g}” right became important for delivery? How did you tackle it in practice?`;
}

/**
 * Rule-based questions only — no AI, no persistence.
 * Inputs: evaluation strengths/gaps, job competency names, job/candidate signal phrases.
 */
export function buildInterviewQuestionSections(input: {
  strengthLabels: string[];
  gapLabels: string[];
  jobCompetencyNames: string[];
  jobSignalPhrases: string[];
}): InterviewQuestionSections {
  const strengths = dedupeLabels(input.strengthLabels).slice(0, MAX_STRENGTH);
  const gaps = dedupeLabels(input.gapLabels).slice(0, MAX_GAP);

  const strengthValidation = strengths.map((s, i) => buildStrengthQuestion(s, i));

  const gapExploration = gaps.map((g, i) => buildGapQuestion(g, i));

  const roleCritical: string[] = [];
  const comps = dedupeLabels(input.jobCompetencyNames).slice(0, MAX_ROLE);
  comps.forEach((name, i) => {
    const n = clipPhrase(name, MAX_EMBED);
    if (variantIndex(name, i) % 2 === 0) {
      roleCritical.push(
        `Can you tell me about a time when delivering on expectations similar to “${n}” was central to your work? What did you do, and what would you bring forward into this role?`,
      );
    } else {
      roleCritical.push(
        `Describe a situation where impact in an area like “${n}” really mattered. How did you approach it — and how would you apply that mindset in your first months here?`,
      );
    }
  });

  const jobPhrases = dedupeLabels(input.jobSignalPhrases);
  let pi = 0;
  while (roleCritical.length < MAX_ROLE && pi < jobPhrases.length) {
    const phrase = clipPhrase(jobPhrases[pi]!, 100);
    pi += 1;
    if (variantIndex(phrase, pi) % 2 === 0) {
      roleCritical.push(
        `Walk me through how you’d handle a realistic situation that sounds like: “${phrase}”. What would you clarify first, and what would you do next?`,
      );
    } else {
      roleCritical.push(
        `Can you tell me about a time when you faced work that resembled “${phrase}”? What was the outcome, and what would you repeat here?`,
      );
    }
  }

  while (roleCritical.length > MAX_ROLE) roleCritical.pop();

  if (roleCritical.length === 0) {
    roleCritical.push(
      "Can you tell me about a time when you set clear outcomes for your first months in a new stretch of work — what did you prioritise and what did you actually deliver?",
    );
  }

  return {
    strengthValidation,
    gapExploration,
    roleCritical: roleCritical.slice(0, MAX_ROLE),
  };
}

export function interviewSectionsToPlainText(
  sections: InterviewQuestionSections,
): string {
  const blocks: string[] = [];
  blocks.push("Targeted interview questions");
  blocks.push("");

  if (sections.strengthValidation.length > 0) {
    blocks.push("Strength validation");
    for (const q of sections.strengthValidation) blocks.push(`- ${q}`);
    blocks.push("");
  }

  if (sections.gapExploration.length > 0) {
    blocks.push("Gap exploration");
    for (const q of sections.gapExploration) blocks.push(`- ${q}`);
    blocks.push("");
  }

  if (sections.roleCritical.length > 0) {
    blocks.push("Role-critical scenarios");
    for (const q of sections.roleCritical) blocks.push(`- ${q}`);
    blocks.push("");
  }

  return blocks.join("\n").trim();
}

export function sectionToPlainText(title: string, questions: string[]): string {
  if (questions.length === 0) return "";
  const lines = [title, ...questions.map((q) => `- ${q}`)];
  return lines.join("\n");
}

/** Loads signals + evaluation snapshot and builds sections (derived only). */
export async function loadInterviewQuestionSections(
  client: SupabaseClient,
  jobProfileId: string | null,
  _candidateUserId: string,
  row: HiringApplicationRow,
): Promise<InterviewQuestionSections> {
  const snap = parseEvaluationSnapshot(row.evaluation_snapshot);
  const strengthLabels = [...(snap.strengths ?? [])];
  const gapLabels = [...(snap.gaps ?? [])];

  let jobCompetencyNames: string[] = [];
  let jobSignalPhrases: string[] = [];

  if (jobProfileId) {
    const [job, preview] = await Promise.all([
      fetchJobSignals(client, jobProfileId),
      fetchJobProfilePreviewData(client, jobProfileId, {
        includeCompetencies: true,
      }),
    ]);
    jobSignalPhrases = job.rawSignals;
    if (preview?.competencies?.length) {
      jobCompetencyNames = preview.competencies
        .map((c) => c.name.trim())
        .filter(Boolean);
    }
  }

  return buildInterviewQuestionSections({
    strengthLabels,
    gapLabels,
    jobCompetencyNames,
    jobSignalPhrases,
  });
}
