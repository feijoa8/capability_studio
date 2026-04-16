import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CompanyProfileInput = {
  organisation_name?: string | null;
  sector?: string | null;
  industry?: string | null;
  summary?: string | null;
  strategic_focus?: string | null;
  key_drivers?: unknown;
  delivery_models?: unknown;
  organisation_structure?: string | null;
  primary_capability_areas?: unknown;
  capability_focus_notes?: string | null;
  regulatory_intensity?: string | null;
  role_model_bias?: string | null;
  business_purpose?: string | null;
  strategic_priorities?: string | null;
  delivery_context?: string | null;
  capability_emphasis?: string | null;
  role_interpretation_guidance?: string | null;
  terminology_guidance?: string | null;
};

type DepthSetting = "light" | "moderate" | "comprehensive";

type SubjectBlock = {
  name: string;
  competencies: string[];
  /** Present only when no competencies could be produced for this subject. */
  warning?: string;
};

type GenerateResult = {
  subjects: SubjectBlock[];
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function nonEmpty(s: string | null | undefined): string | null {
  const t = s?.trim();
  return t ? t : null;
}

function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildOrganisationContextBlock(cp: CompanyProfileInput): string {
  const lines: string[] = [];
  const orgName = nonEmpty(cp.organisation_name);
  if (orgName) lines.push(`Organisation name: ${orgName}`);
  const sector = nonEmpty(cp.sector);
  const industry = nonEmpty(cp.industry);
  if (sector) lines.push(`Sector: ${sector}`);
  if (industry) lines.push(`Industry: ${industry}`);
  const summary = nonEmpty(cp.summary);
  if (summary) lines.push(`Organisation summary: ${summary}`);
  const strategicFocus = nonEmpty(cp.strategic_focus) ?? nonEmpty(cp.business_purpose);
  if (strategicFocus) lines.push(`Strategic focus: ${strategicFocus}`);
  const keyDrivers = stringList(cp.key_drivers);
  const prioritiesLegacy = nonEmpty(cp.strategic_priorities);
  if (keyDrivers.length > 0) {
    lines.push(`Key strategic drivers: ${keyDrivers.join(", ")}`);
  } else if (prioritiesLegacy) {
    lines.push(`Strategic priorities: ${prioritiesLegacy}`);
  }
  const deliveryModels = stringList(cp.delivery_models);
  const deliveryLegacy = nonEmpty(cp.delivery_context);
  if (deliveryModels.length > 0) {
    lines.push(`Delivery / ways of working: ${deliveryModels.join(", ")}`);
  } else if (deliveryLegacy) {
    lines.push(`Delivery context: ${deliveryLegacy}`);
  }
  const orgStructure = nonEmpty(cp.organisation_structure);
  if (orgStructure) lines.push(`Organisation structure: ${orgStructure}`);
  const capAreas = stringList(cp.primary_capability_areas);
  const capLegacy = nonEmpty(cp.capability_emphasis);
  if (capAreas.length > 0) {
    lines.push(`Primary capability focus areas: ${capAreas.join(", ")}`);
  } else if (capLegacy) {
    lines.push(`Capability emphasis: ${capLegacy}`);
  }
  const capNotes = nonEmpty(cp.capability_focus_notes);
  if (capNotes) lines.push(`Capability / delivery notes: ${capNotes}`);
  const reg = nonEmpty(cp.regulatory_intensity);
  if (reg) lines.push(`Regulatory intensity: ${reg}`);
  const bias = nonEmpty(cp.role_model_bias);
  if (bias) lines.push(`Role model bias: ${bias}`);
  const roleGuide = nonEmpty(cp.role_interpretation_guidance);
  if (roleGuide) lines.push(`Role interpretation guidance: ${roleGuide}`);
  const termGuide = nonEmpty(cp.terminology_guidance);
  if (termGuide) lines.push(`Terminology guidance: ${termGuide}`);
  return lines.length > 0 ? lines.join("\n") : "";
}

function normalizeDepth(raw: unknown): DepthSetting | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  if (t === "light" || t === "moderate" || t === "comprehensive") return t;
  return null;
}

function depthInstructions(depth: DepthSetting): string {
  switch (depth) {
    case "light":
      return `**Depth: Light** — **1–2** competencies per subject; **core** items only.`;
    case "moderate":
      return `**Depth: Moderate** — **3–5** competencies per subject; **core** plus **supporting** items.`;
    case "comprehensive":
      return `**Depth: Comprehensive** — **5–8** competencies per subject; include **adjacent** and **advanced** areas where relevant.`;
    default:
      return "";
  }
}

/** First occurrence of a competency name wins across subjects (later duplicates dropped). */
function dedupeCompetenciesAcrossSubjects(rows: SubjectBlock[]): {
  rows: SubjectBlock[];
  removedCount: number;
} {
  const seen = new Set<string>();
  let removedCount = 0;
  const out = rows.map((row) => {
    const competencies: string[] = [];
    for (const c of row.competencies) {
      const t = c.trim();
      if (!t) continue;
      const k = t.toLowerCase();
      if (seen.has(k)) {
        removedCount++;
        continue;
      }
      seen.add(k);
      competencies.push(t);
    }
    return { name: row.name, competencies };
  });
  return { rows: out, removedCount };
}

function alignOutputToRequestedSubjects(
  requested: string[],
  aiRows: SubjectBlock[],
): SubjectBlock[] {
  const byKey = new Map<string, string[]>();
  for (const row of aiRows) {
    const k = row.name.trim().toLowerCase();
    if (!k) continue;
    const comps = row.competencies
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter(Boolean);
    byKey.set(k, comps);
  }
  return requested.map((name) => ({
    name: name.trim(),
    competencies: byKey.get(name.trim().toLowerCase()) ?? [],
  }));
}

const SYSTEM_PROMPT = `You are a capability modelling assistant. You output ONLY valid JSON.

You generate **competency** names for **approved subjects** — short, observable capability labels. You do **not** output descriptions, levels, or metadata.

Competency names must be **2–4 words**, **specific**, and **practical** (observable in work). No paragraphs.

Competency scope rules:
• Do NOT generate competencies that are broad enough to be Subjects.
• Competencies must be more specific than their parent subject.

Bad examples:
• 'Product Management'
• 'User Research'
• 'Stakeholder Engagement'

Good examples:
• 'Roadmap prioritisation'
• 'Interview design'
• 'Stakeholder alignment'

If a concept feels like it could stand alone as a Subject, do not include it as a competency.

Competency quality rules:
• Competencies must be:
• specific
• observable
• practically applicable in a role
• Avoid:
• generic organisational behaviours
• vague terms like 'management', 'strategy', 'support'
• long phrases or sentences
• Prefer:
• action-oriented or domain-specific capabilities
• concepts that could be assessed or developed

Bad:
• 'Communication skills'
• 'Strategic thinking'

Good:
• 'Stakeholder alignment'
• 'Value proposition design'

Do not invent competencies unrelated to the subject or organisation context. Avoid duplication of the same competency across different subjects.

Return shape:
{
  "subjects": [
    { "name": "<exact subject name from input>", "competencies": ["...", "..."] }
  ]
}

Include **one object per subject** in the same order as listed in the user message, with **matching "name" strings** (exact spelling).`;

function buildUserPrompt(
  companyProfile: CompanyProfileInput | null,
  subjectNames: string[],
  depth: DepthSetting,
): string {
  const orgBlock = companyProfile
    ? buildOrganisationContextBlock(companyProfile)
    : "";
  const orgSection = orgBlock.trim()
    ? orgBlock
    : "(No organisation profile — ground competencies in subject names and sector only.)";

  const subjectList = subjectNames
    .map((s, i) => `${i + 1}. ${s.trim()}`)
    .join("\n");

  return `## Organisation context
${orgSection}

## Approved subjects (generate competencies for each — use these **exact** names in output)
${subjectList}

## Depth
${depthInstructions(depth)}

## Competency scope rules
• Do NOT generate competencies that are broad enough to be Subjects.
• Competencies must be more specific than their parent subject.

Bad examples:
• 'Product Management'
• 'User Research'
• 'Stakeholder Engagement'

Good examples:
• 'Roadmap prioritisation'
• 'Interview design'
• 'Stakeholder alignment'

If a concept feels like it could stand alone as a Subject, do not include it as a competency.

## Competency quality rules
• Competencies must be:
• specific
• observable
• practically applicable in a role
• Avoid:
• generic organisational behaviours
• vague terms like 'management', 'strategy', 'support'
• long phrases or sentences
• Prefer:
• action-oriented or domain-specific capabilities
• concepts that could be assessed or developed

Bad:
• 'Communication skills'
• 'Strategic thinking'

Good:
• 'Stakeholder alignment'
• 'Value proposition design'

## Coverage behaviour
• Each subject should have at least one relevant competency where possible.
• If exact matches are limited, broaden slightly within the subject domain before returning no results.
• Do not leave a subject empty if reasonable competencies can be inferred from context.

## Rules
- Reflect **organisation context** and **subject domain** in the competency mix.
- Keep competencies **non-overlapping** across subjects where possible; if the same idea fits two subjects, prefer **one** subject only.
- **No** irrelevant filler; **no** duplicate competency strings across the whole response (case-insensitive).

Return JSON only:
{
  "subjects": [
    {
      "name": "Product Strategy",
      "competencies": ["Market positioning", "Value proposition design", "Portfolio prioritisation"]
    }
  ]
}`;
}

function parseAiResult(content: string, requestedSubjects: string[]): GenerateResult {
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
  const raw = o.subjects;
  if (!Array.isArray(raw)) {
    throw new Error('AI response missing "subjects" array.');
  }

  const aiRows: SubjectBlock[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!name) continue;
    const compsRaw = row.competencies;
    const competencies: string[] = [];
    if (Array.isArray(compsRaw)) {
      for (const c of compsRaw) {
        if (typeof c !== "string") continue;
        const t = c.trim();
        if (t) competencies.push(t);
      }
    }
    aiRows.push({ name, competencies });
  }

  const aligned = alignOutputToRequestedSubjects(requestedSubjects, aiRows);
  const totalBeforeDedupe = aligned.reduce(
    (n, r) => n + r.competencies.length,
    0,
  );
  const { rows: deduped, removedCount } =
    dedupeCompetenciesAcrossSubjects(aligned);

  if (
    removedCount > 0 &&
    (removedCount >= 5 ||
      (totalBeforeDedupe > 0 && removedCount / totalBeforeDedupe >= 0.25))
  ) {
    console.info(
      `generate-competencies-from-subjects: deduplication removed ${removedCount} duplicate label(s) of ${totalBeforeDedupe} total before dedupe`,
    );
  }

  const subjects: SubjectBlock[] = deduped.map((row) => {
    if (row.competencies.length === 0) {
      console.warn(
        `generate-competencies-from-subjects: no competencies for subject "${row.name}" after alignment/deduplication`,
      );
      return {
        name: row.name,
        competencies: [],
        warning: "No competencies could be generated for this subject",
      };
    }
    return { name: row.name, competencies: row.competencies };
  });

  return { subjects };
}

function parseRequestBody(raw: unknown): {
  companyProfile: CompanyProfileInput | null;
  subjectNames: string[];
  depth: DepthSetting;
} {
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

  const subRaw = body.subjects;
  let subjectNames: string[] = [];
  if (Array.isArray(subRaw)) {
    for (const x of subRaw) {
      if (typeof x === "string" && x.trim()) {
        subjectNames.push(x.trim());
      } else if (x && typeof x === "object" && !Array.isArray(x)) {
        const n = (x as Record<string, unknown>).name;
        if (typeof n === "string" && n.trim()) subjectNames.push(n.trim());
      }
    }
  }
  if (subjectNames.length === 0) {
    throw new Error(
      "subjects must be a non-empty array of strings or { name: string } objects.",
    );
  }

  const depth = normalizeDepth(body.depth);
  if (!depth) {
    throw new Error(
      'depth must be one of: "light", "moderate", "comprehensive".',
    );
  }

  return { companyProfile, subjectNames, depth };
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
    console.error("generate-competencies-from-subjects: OPENAI_API_KEY is not set");
    return jsonResponse(
      {
        error:
          "Server configuration error: OpenAI is not configured. Set OPENAI_API_KEY for this project.",
      },
      500,
    );
  }

  const model = Deno.env.get("OPENAI_MODEL")?.trim() || "gpt-4o-mini";

  let parsedBody: ReturnType<typeof parseRequestBody>;
  try {
    const text = await req.text();
    if (!text.trim()) {
      return jsonResponse({ error: "Empty request body." }, 400);
    }
    parsedBody = parseRequestBody(JSON.parse(text));
  } catch (e) {
    const msg =
      e instanceof SyntaxError
        ? "Invalid JSON body."
        : e instanceof Error
          ? e.message
          : "Invalid request body.";
    return jsonResponse({ error: msg }, 400);
  }

  const user = buildUserPrompt(
    parsedBody.companyProfile,
    parsedBody.subjectNames,
    parsedBody.depth,
  );

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
          temperature: 0.32,
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
        "generate-competencies-from-subjects: OpenAI error",
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

    const result = parseAiResult(content, parsedBody.subjectNames);
    return jsonResponse(result, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected server error.";
    console.error("generate-competencies-from-subjects:", e);
    return jsonResponse({ error: msg }, 500);
  }
});
