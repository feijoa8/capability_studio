import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `You are an expert in capability modelling, organisational design, and role definition.

Your task is to recommend competencies for a job profile using an existing capability taxonomy.

CRITICAL RULES:
- You MUST reuse existing subject and competency names exactly as provided.
- Do NOT invent new subjects or competencies in the main suggestions.
- You MAY suggest gaps separately (missing competencies or subjects).
- Prefer subjects and competencies that are marked as "settled" or "protected".
- Use practice context only as guidance (not structure).
- Assign realistic levels — do NOT default everything to "Advanced".
- Calibrate level based on role seniority (e.g. intermediate roles should mostly be intermediate level).
- Group competencies under the correct subject.
- Keep recommendations concise and relevant.

OUTPUT FORMAT:
Return JSON only (no explanation).`;

type CompanyProfileInput = {
  sector?: string | null;
  industry?: string | null;
  summary?: string | null;
  business_purpose?: string | null;
  strategic_priorities?: string | null;
  delivery_context?: string | null;
  capability_emphasis?: string | null;
  role_interpretation_guidance?: string | null;
  terminology_guidance?: string | null;
};

type JobProfileInput = {
  title: string;
  level: string | null;
  job_family: string | null;
  role_summary: string | null;
  responsibilities: string[];
  requirements: string[];
  existing_competency_names: string[];
  /** Human-readable seniority label for level calibration (e.g. "Principal"). */
  role_capability_calibration?: string | null;
  /** Primary practice overlay name for this build (e.g. "Business Analysis"). */
  primary_practice_name?: string | null;
  /** Extra instruction for augmentation / hybrid-role additions. */
  augmentation_guidance?: string | null;
  /** Competency names already included via the primary practice overlay — do not duplicate in core. */
  competency_names_from_primary_practice?: string[];
};

type SuggestionsPayload = {
  companyProfile: CompanyProfileInput | null;
  jobProfile: JobProfileInput;
  taxonomy: {
    capability_areas: {
      id: string;
      name: string;
      governance_status: string | null;
    }[];
    subjects: {
      id: string;
      name: string;
      description: string | null;
      type: string | null;
      governance_status: string | null;
      capability_area_name: string | null;
      practice_labels: string[];
    }[];
    competencies: {
      id: string;
      name: string;
      description: string | null;
      subject_id: string | null;
      subject_name: string | null;
      status: string | null;
      level_names: string[];
    }[];
    subject_practice_notes: string[];
  };
};

/** One competency line inside core or supporting (from model). */
type AiCompetencyLine = {
  competency_name: string;
  recommended_level: string;
  relevance: "low" | "medium" | "high";
  required: boolean;
  reason: string;
};

type AiSubjectGroup = {
  subject_name: string;
  competencies: AiCompetencyLine[];
};

type GapMissingCompetency = {
  name: string;
  suggested_subject: string;
  reason: string;
};

type GapMissingSubject = {
  name: string;
  suggested_capability_area: string;
  reason: string;
};

export type AiJobProfileCompetencyResult = {
  core: AiSubjectGroup[];
  supporting: AiSubjectGroup[];
  gaps: {
    missing_competencies: GapMissingCompetency[];
    missing_subjects: GapMissingSubject[];
  };
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function dash(s: string | null | undefined): string {
  const t = s?.trim();
  return t ? t : "—";
}

function buildUserPromptFromTemplate(payload: SuggestionsPayload): string {
  const jp = payload.jobProfile;
  const cp = payload.companyProfile;

  const responsibilities =
    jp.responsibilities.length > 0
      ? jp.responsibilities.map((r, i) => `${i + 1}. ${r}`).join("\n")
      : "—";
  const requirements =
    jp.requirements.length > 0
      ? jp.requirements.map((r, i) => `${i + 1}. ${r}`).join("\n")
      : "—";

  const subjectsBlock = payload.taxonomy.subjects
    .map((s) => {
      const pr =
        s.practice_labels.length > 0
          ? s.practice_labels.join(", ")
          : "—";
      return `  - name: ${s.name}
    description: ${dash(s.description)}
    capability_area_name: ${dash(s.capability_area_name)}
    governance_status: ${dash(s.governance_status)}
    practice_contexts: ${pr}`;
    })
    .join("\n");

  const competenciesBlock = payload.taxonomy.competencies
    .map((c) => {
      const levels =
        c.level_names.length > 0 ? c.level_names.join(" | ") : "—";
      return `  - name: ${c.name}
    description: ${dash(c.description)}
    subject_name: ${dash(c.subject_name)}
    valid_levels: ${levels}`;
    })
    .join("\n");

  const existingBlock =
    jp.existing_competency_names.length > 0
      ? jp.existing_competency_names.map((n, i) => `${i + 1}. ${n}`).join("\n")
      : "— (none yet on this role)";

  const practiceAugBlock =
    jp.primary_practice_name?.trim() ||
    jp.role_capability_calibration?.trim() ||
    (jp.competency_names_from_primary_practice &&
      jp.competency_names_from_primary_practice.length > 0)
      ? `

ROLE CAPABILITY BUILD (practice overlay — context only, not structure)
Primary practice for this role composition: ${dash(jp.primary_practice_name)}
Role seniority / level calibration: ${dash(jp.role_capability_calibration)}
${jp.augmentation_guidance?.trim() ? `Augmentation focus:\n${jp.augmentation_guidance.trim()}\n` : ""}
Competencies already covered via the primary practice overlay (do NOT duplicate these in "core"; suggest only ADDITIONAL cross-cutting / hybrid competencies such as leadership, stakeholder management, delivery oversight, strategy — typically in "supporting"):
${jp.competency_names_from_primary_practice && jp.competency_names_from_primary_practice.length > 0 ? jp.competency_names_from_primary_practice.map((n, i) => `${i + 1}. ${n}`).join("\n") : "— (none listed)"}
`
      : "";

  return `ROLE CONTEXT

Job Title: ${jp.title}
Level: ${dash(jp.level)}
Job Family: ${dash(jp.job_family)}

Role Purpose:
${dash(jp.role_summary)}
${practiceAugBlock}

Responsibilities:
${responsibilities}

Requirements:
${requirements}

Company Context:
- Sector: ${dash(cp?.sector)}
- Industry: ${dash(cp?.industry)}
- Delivery Context: ${dash(cp?.delivery_context)}
- Capability Emphasis: ${dash(cp?.capability_emphasis)}
- Role Interpretation Guidance: ${dash(cp?.role_interpretation_guidance)}

(Other org profile fields if useful: summary, business purpose, strategic priorities, terminology — omitted here for brevity; prefer the structured taxonomy below.)

Already assigned on this role (do not duplicate in core/supporting):
${existingBlock}

---

CAPABILITY TAXONOMY

Subjects:
${subjectsBlock || "—"}

Competencies:
${competenciesBlock || "—"}

Practice / subject relevance (context only — not structural):
${payload.taxonomy.subject_practice_notes.length > 0 ? payload.taxonomy.subject_practice_notes.map((n, i) => `${i + 1}. ${n}`).join("\n") : "—"}

---

TASK

Suggest a structured set of competencies for this role.

If ROLE CAPABILITY BUILD is present: assume core practice-aligned content is already supplied via the practice overlay; prioritize ADDITIONAL competencies (leadership, stakeholder management, strategy, delivery/governance, coaching) in SUPPORTING unless clearly absent from the taxonomy lists. Do not duplicate competency names listed under "already covered via the primary practice overlay".

Structure your response into:

1. CORE COMPETENCIES (required for the role)
2. SUPPORTING COMPETENCIES (useful but not essential)
3. POTENTIAL GAPS (missing from taxonomy — informational only; do not create)

---

OUTPUT JSON STRUCTURE

{
  "core": [
    {
      "subject_name": "string",
      "competencies": [
        {
          "competency_name": "string",
          "recommended_level": "string",
          "relevance": "high",
          "required": true,
          "reason": "short explanation"
        }
      ]
    }
  ],
  "supporting": [
    {
      "subject_name": "string",
      "competencies": [
        {
          "competency_name": "string",
          "recommended_level": "string",
          "relevance": "medium",
          "required": false,
          "reason": "short explanation"
        }
      ]
    }
  ],
  "gaps": {
    "missing_competencies": [
      {
        "name": "string",
        "suggested_subject": "string",
        "reason": "short explanation"
      }
    ],
    "missing_subjects": [
      {
        "name": "string",
        "suggested_capability_area": "string",
        "reason": "short explanation"
      }
    ]
  }
}

Use only competency and subject names that appear in the taxonomy lists above for "core" and "supporting". Gaps may describe hypothetical additions — they are not applied automatically.`;
}

function parseSubjectGroups(raw: unknown): AiSubjectGroup[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: AiSubjectGroup[] = [];
  for (const g of raw) {
    if (!g || typeof g !== "object") continue;
    const gr = g as Record<string, unknown>;
    const subject_name =
      typeof gr.subject_name === "string" ? gr.subject_name.trim() : "";
    const compsRaw = gr.competencies;
    const competencies: AiCompetencyLine[] = [];
    if (Array.isArray(compsRaw)) {
      for (const line of compsRaw) {
        if (!line || typeof line !== "object") continue;
        const ln = line as Record<string, unknown>;
        const competency_name =
          typeof ln.competency_name === "string"
            ? ln.competency_name.trim()
            : "";
        const recommended_level =
          typeof ln.recommended_level === "string"
            ? ln.recommended_level.trim()
            : typeof (ln as { suggested_required_level?: string })
                .suggested_required_level === "string"
              ? String(
                  (ln as { suggested_required_level: string })
                    .suggested_required_level,
                ).trim()
              : "";
        const rel = ln.relevance;
        const relevance =
          rel === "low" || rel === "medium" || rel === "high" ? rel : "medium";
        const required = Boolean(ln.required ?? ln.suggested_required_flag);
        const reason =
          typeof ln.reason === "string" ? ln.reason.trim() : "";
        if (!competency_name) continue;
        competencies.push({
          competency_name,
          recommended_level,
          relevance,
          required,
          reason,
        });
      }
    }
    if (subject_name && competencies.length > 0) {
      out.push({ subject_name, competencies });
    }
  }
  return out;
}

function parseGaps(o: Record<string, unknown>): AiJobProfileCompetencyResult["gaps"] {
  const gapsRaw = o.gaps;
  const missing_competencies: GapMissingCompetency[] = [];
  const missing_subjects: GapMissingSubject[] = [];

  if (gapsRaw && typeof gapsRaw === "object" && !Array.isArray(gapsRaw)) {
    const gg = gapsRaw as Record<string, unknown>;
    const mc = gg.missing_competencies;
    if (Array.isArray(mc)) {
      for (const item of mc) {
        if (!item || typeof item !== "object") continue;
        const it = item as Record<string, unknown>;
        const name = typeof it.name === "string" ? it.name.trim() : "";
        const suggested_subject =
          typeof it.suggested_subject === "string"
            ? it.suggested_subject.trim()
            : "";
        const reason = typeof it.reason === "string" ? it.reason.trim() : "";
        if (!name && !reason) continue;
        missing_competencies.push({
          name: name || "—",
          suggested_subject: suggested_subject || "—",
          reason: reason || "—",
        });
      }
    }
    const ms = gg.missing_subjects;
    if (Array.isArray(ms)) {
      for (const item of ms) {
        if (!item || typeof item !== "object") continue;
        const it = item as Record<string, unknown>;
        const name = typeof it.name === "string" ? it.name.trim() : "";
        const suggested_capability_area =
          typeof it.suggested_capability_area === "string"
            ? it.suggested_capability_area.trim()
            : "";
        const reason = typeof it.reason === "string" ? it.reason.trim() : "";
        if (!name && !reason) continue;
        missing_subjects.push({
          name: name || "—",
          suggested_capability_area: suggested_capability_area || "—",
          reason: reason || "—",
        });
      }
    }
  }

  return { missing_competencies, missing_subjects };
}

function parseAiResult(content: string): AiJobProfileCompetencyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error("AI response was not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid AI response shape.");
  }
  const o = parsed as Record<string, unknown>;

  let core = parseSubjectGroups(o.core);
  let supporting = parseSubjectGroups(o.supporting);

  const gaps = parseGaps(o);

  if (core.length === 0 && supporting.length === 0) {
    const legacy = o.suggestions_by_subject;
    if (Array.isArray(legacy) && legacy.length > 0) {
      core = parseSubjectGroups(legacy);
    }
  }

  return { core, supporting, gaps };
}

function parseRequestBody(raw: unknown): SuggestionsPayload {
  if (!raw || typeof raw !== "object") {
    throw new Error("Request body must be a JSON object.");
  }
  const body = raw as Record<string, unknown>;

  const companyRaw = body.companyProfile;
  let companyProfile: CompanyProfileInput | null = null;
  if (companyRaw !== undefined && companyRaw !== null) {
    if (typeof companyRaw !== "object" || Array.isArray(companyRaw)) {
      throw new Error("companyProfile must be an object or null.");
    }
    companyProfile = companyRaw as CompanyProfileInput;
  }

  const jpRaw = body.jobProfile;
  if (!jpRaw || typeof jpRaw !== "object" || Array.isArray(jpRaw)) {
    throw new Error("jobProfile is required.");
  }
  const jp = jpRaw as Record<string, unknown>;
  const title = typeof jp.title === "string" ? jp.title.trim() : "";
  if (!title) throw new Error("jobProfile.title is required.");

  const taxRaw = body.taxonomy;
  if (!taxRaw || typeof taxRaw !== "object" || Array.isArray(taxRaw)) {
    throw new Error("taxonomy is required.");
  }
  const tax = taxRaw as Record<string, unknown>;

  const jobProfile: JobProfileInput = {
    title,
    level: jp.level == null ? null : String(jp.level).trim() || null,
    job_family: jp.job_family == null
      ? null
      : String(jp.job_family).trim() || null,
    role_summary:
      jp.role_summary == null
        ? null
        : String(jp.role_summary).trim() || null,
    responsibilities: Array.isArray(jp.responsibilities)
      ? jp.responsibilities.filter((x): x is string => typeof x === "string")
      : [],
    requirements: Array.isArray(jp.requirements)
      ? jp.requirements.filter((x): x is string => typeof x === "string")
      : [],
    existing_competency_names: Array.isArray(jp.existing_competency_names)
      ? jp.existing_competency_names.filter(
          (x): x is string => typeof x === "string",
        )
      : [],
  };

  if (jp.role_capability_calibration != null) {
    const t = String(jp.role_capability_calibration).trim();
    if (t) jobProfile.role_capability_calibration = t;
  }
  if (jp.primary_practice_name != null) {
    const t = String(jp.primary_practice_name).trim();
    if (t) jobProfile.primary_practice_name = t;
  }
  if (jp.augmentation_guidance != null) {
    const t = String(jp.augmentation_guidance).trim();
    if (t) jobProfile.augmentation_guidance = t;
  }
  if (Array.isArray(jp.competency_names_from_primary_practice)) {
    jobProfile.competency_names_from_primary_practice = jp
      .competency_names_from_primary_practice.filter(
        (x): x is string => typeof x === "string" && x.trim().length > 0,
      ).map((x) => x.trim());
  }

  const capability_areas = Array.isArray(tax.capability_areas)
    ? tax.capability_areas
    : [];
  const subjects = Array.isArray(tax.subjects) ? tax.subjects : [];
  const competencies = Array.isArray(tax.competencies) ? tax.competencies : [];
  const subject_practice_notes = Array.isArray(tax.subject_practice_notes)
    ? tax.subject_practice_notes.filter(
        (x): x is string => typeof x === "string",
      )
    : [];

  return {
    companyProfile,
    jobProfile,
    taxonomy: {
      capability_areas: capability_areas as SuggestionsPayload["taxonomy"]["capability_areas"],
      subjects: subjects as SuggestionsPayload["taxonomy"]["subjects"],
      competencies: competencies as SuggestionsPayload["taxonomy"]["competencies"],
      subject_practice_notes,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed. Use POST." }, 405);
  }

  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim();
  if (!apiKey) {
    console.error("suggest-job-profile-competencies: OPENAI_API_KEY is not set");
    return jsonResponse(
      {
        error:
          "Server configuration error: OpenAI is not configured. Set OPENAI_API_KEY for this project.",
      },
      500,
    );
  }

  const model = Deno.env.get("OPENAI_MODEL")?.trim() || "gpt-4o-mini";

  let payload: SuggestionsPayload;
  try {
    const text = await req.text();
    if (!text.trim()) {
      return jsonResponse({ error: "Empty request body." }, 400);
    }
    payload = parseRequestBody(JSON.parse(text));
  } catch (e) {
    const msg =
      e instanceof SyntaxError
        ? "Invalid JSON body."
        : e instanceof Error
          ? e.message
          : "Invalid request body.";
    return jsonResponse({ error: msg }, 400);
  }

  if (payload.taxonomy.competencies.length === 0) {
    return jsonResponse(
      { error: "No competencies in catalogue — add competencies first." },
      400,
    );
  }

  const user = buildUserPromptFromTemplate(payload);

  try {
    const openaiRes = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.22,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: user },
          ],
        }),
      },
    );

    const rawText = await openaiRes.text();
    if (!openaiRes.ok) {
      let detail = rawText || `${openaiRes.status} ${openaiRes.statusText}`;
      try {
        const errJson = JSON.parse(rawText) as {
          error?: { message?: string };
        };
        if (errJson.error?.message) detail = errJson.error.message;
      } catch {
        /* keep */
      }
      console.error(
        "suggest-job-profile-competencies: OpenAI error",
        openaiRes.status,
        detail,
      );
      return jsonResponse({ error: `OpenAI request failed: ${detail}` }, 502);
    }

    let completion: {
      choices?: { message?: { content?: string | null } }[];
    };
    try {
      completion = JSON.parse(rawText) as typeof completion;
    } catch {
      return jsonResponse({ error: "OpenAI returned invalid JSON." }, 502);
    }

    const content = completion.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return jsonResponse({ error: "OpenAI returned an empty message." }, 502);
    }

    const result = parseAiResult(content);
    return jsonResponse(result, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected server error.";
    console.error("suggest-job-profile-competencies:", e);
    return jsonResponse({ error: msg }, 500);
  }
});
