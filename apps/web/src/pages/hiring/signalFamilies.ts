/**
 * Lightweight heuristic mapping from free-text (competency names, tags, titles)
 * into a small set of signal families. Hiring evaluation only — deterministic, no AI.
 */

export type SignalFamilyId = string;

/** Human-readable labels for UI (Title Case). */
export const SIGNAL_FAMILY_LABELS: Record<string, string> = {
  stakeholder_management: "Stakeholder management",
  requirements_management: "Requirements management",
  business_analysis: "Business analysis",
  change_management: "Change management",
  service_design: "Service design",
  delivery_management: "Delivery management",
  communication: "Communication",
  problem_solving: "Problem solving",
  planning_prioritisation: "Planning & prioritisation",
  facilitation: "Facilitation",
  strategy: "Strategy",
  data_analysis: "Data analysis",
  agile_delivery: "Agile delivery",
  leadership: "Leadership",
  learning_development: "Learning & development",
  ai_ml: "AI & machine learning",
  technical_delivery: "Technical delivery",
  quality_assurance: "Quality & testing",
  research_user_insight: "Research & user insight",
  customer_user_focus: "Customer & user focus",
  governance_risk: "Governance & risk",
};

export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

type Rule = { id: SignalFamilyId; test: (n: string) => boolean };

/** Tighter phrases — typical competency-style wording. */
const STRICT_RULES: Rule[] = [
  {
    id: "stakeholder_management",
    test: (n) =>
      /stakeholder|expectation|consensus|relationship management|engagement management|influence|negotiation|sponsor/.test(
        n,
      ),
  },
  {
    id: "requirements_management",
    test: (n) =>
      /requirement|user stor|backlog|acceptance criteria|scope|prioriti[sz]ation management|change control/.test(
        n,
      ),
  },
  {
    id: "business_analysis",
    test: (n) =>
      /business analys|business need|functional spec|process model|gap analysis|as is|to be|use case/.test(
        n,
      ),
  },
  {
    id: "change_management",
    test: (n) =>
      /change management|change impact|readiness|transition|adoption|communication plan|organizational change/.test(
        n,
      ),
  },
  {
    id: "service_design",
    test: (n) =>
      /service design|journey map|blueprint|touchpoint|service blueprint|cx design/.test(n),
  },
  {
    id: "delivery_management",
    test: (n) =>
      /delivery|programme|program|project management|release|roadmap execution|milestone|dependency management/.test(
        n,
      ),
  },
  {
    id: "communication",
    test: (n) =>
      /communication|presentation|writing|storytelling|briefing|documentation|articulat/.test(n),
  },
  {
    id: "problem_solving",
    test: (n) =>
      /problem solving|root cause|analytical thinking|critical thinking|issue resolution|troubleshoot/.test(
        n,
      ),
  },
  {
    id: "planning_prioritisation",
    test: (n) =>
      /planning|prioriti[sz]ation|time management|work breakdown|forecast|capacity plan/.test(n),
  },
  {
    id: "facilitation",
    test: (n) =>
      /facilitat|workshop|brainstorm|retrospective|design thinking session/.test(n),
  },
  {
    id: "strategy",
    test: (n) =>
      /strateg(y|ic)|vision|business case|value proposition|portfolio|roadmap strategy/.test(n),
  },
  {
    id: "data_analysis",
    test: (n) =>
      /data analys|analytics|sql|dashboard|metric|kpi|reporting|visuali[sz]ation|bi\b|spreadsheet/.test(
        n,
      ),
  },
  {
    id: "agile_delivery",
    test: (n) =>
      /\bscrum\b|agile|kanban|sprint|devops|ci ?cd|lean|safe\b|product owner|product manager/.test(
        n,
      ),
  },
  {
    id: "leadership",
    test: (n) =>
      /leadership|people management|line manager|team lead|mentor|coach|performance management/.test(
        n,
      ),
  },
  {
    id: "learning_development",
    test: (n) =>
      /learning|development|capability|training|l&d|instructional|curriculum|competenc(y|ies)/.test(
        n,
      ),
  },
  {
    id: "ai_ml",
    test: (n) =>
      /\bai\b|machine learning|ml\b|llm|genai|generative|prompt engineering|data science|nlp\b|deep learning/.test(
        n,
      ),
  },
  {
    id: "technical_delivery",
    test: (n) =>
      /software|engineering|developer|architecture|api|cloud|infrastructure|security engineering|integration/.test(
        n,
      ),
  },
  {
    id: "quality_assurance",
    test: (n) =>
      /quality assurance|testing|test automation|qa\b|uat|validation|verification/.test(n),
  },
  {
    id: "research_user_insight",
    test: (n) =>
      /user research|usability|interview|ethnograph|survey design|insight|persona/.test(n),
  },
  {
    id: "customer_user_focus",
    test: (n) =>
      /customer success|customer experience|user centred|user centered|voice of customer/.test(n),
  },
  {
    id: "governance_risk",
    test: (n) =>
      /governance|risk management|compliance|audit|controls|policy/.test(n),
  },
];

/** Broader stems — used for “loose” inference over titles/descriptions. */
const LOOSE_RULES: Rule[] = [
  { id: "stakeholder_management", test: (n) => /client|stakeholder|sponsor|vendor partner/.test(n) },
  { id: "requirements_management", test: (n) => /requirement|backlog|story\b|epic\b/.test(n) },
  { id: "business_analysis", test: (n) => /analyst|analysis|process\b|workflow/.test(n) },
  { id: "change_management", test: (n) => /change\b|transform|migration|rollout/.test(n) },
  { id: "service_design", test: (n) => /service\b|journey|experience design/.test(n) },
  { id: "delivery_management", test: (n) => /deliver|programme|program|project|release/.test(n) },
  { id: "communication", test: (n) => /communicat|present|write|brief/.test(n) },
  { id: "problem_solving", test: (n) => /problem|issue|debug|resolve|analyt/.test(n) },
  { id: "planning_prioritisation", test: (n) => /plan|prioriti|schedule|roadmap/.test(n) },
  { id: "facilitation", test: (n) => /facilitat|workshop|session/.test(n) },
  { id: "strategy", test: (n) => /strateg|vision|portfolio/.test(n) },
  { id: "data_analysis", test: (n) => /data|analytics|metric|dashboard|sql|report/.test(n) },
  { id: "agile_delivery", test: (n) => /agile|scrum|sprint|kanban|devops/.test(n) },
  { id: "leadership", test: (n) => /lead|manage|mentor|coach/.test(n) },
  { id: "learning_development", test: (n) => /learn|train|develop|capability/.test(n) },
  { id: "ai_ml", test: (n) => /\bai\b|ml\b|machine learning|genai|llm|model\b/.test(n) },
  { id: "technical_delivery", test: (n) => /engineer|developer|code|software|technical|architect/.test(n) },
  { id: "quality_assurance", test: (n) => /test|qa\b|quality/.test(n) },
  { id: "research_user_insight", test: (n) => /research|user\b|usability|insight/.test(n) },
  { id: "customer_user_focus", test: (n) => /customer|user experience|ux\b/.test(n) },
  { id: "governance_risk", test: (n) => /govern|risk|compliance|audit/.test(n) },
];

function collectMatches(n: string, rules: Rule[]): SignalFamilyId[] {
  const out: SignalFamilyId[] = [];
  const seen = new Set<string>();
  for (const r of rules) {
    if (r.test(n) && !seen.has(r.id)) {
      seen.add(r.id);
      out.push(r.id);
    }
  }
  return out;
}

export type FamilyMatchTier = "strict" | "loose";

/**
 * Infer signal families for a single phrase or blob of text.
 * Strict = competency-style wording; loose = broader stems (for descriptions).
 */
export function inferFamiliesFromText(
  raw: string,
  tier: FamilyMatchTier,
): SignalFamilyId[] {
  const n = normalizeForMatch(raw);
  if (!n) return [];
  const rules = tier === "strict" ? STRICT_RULES : LOOSE_RULES;
  return collectMatches(n, rules);
}

/** Prefer strict matches; if none, try loose on the same string (job phrases). */
export function inferFamiliesForJobPhrase(raw: string): SignalFamilyId[] {
  const strict = inferFamiliesFromText(raw, "strict");
  if (strict.length > 0) return strict;
  return inferFamiliesFromText(raw, "loose");
}

export function labelForFamily(id: string): string {
  return SIGNAL_FAMILY_LABELS[id] ?? id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
