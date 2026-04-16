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
  company_url?: string | null;
};

type JobProfileInput = {
  title?: string;
  level?: string | null;
  job_family?: string | null;
  role_summary?: string | null;
  responsibilities?: unknown;
  existing_requirements?: unknown;
};

type Result = { suggested_requirements: string[] };

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

function regulatoryIsMediumOrHigher(intensity: string | null | undefined): boolean {
  const t = intensity?.trim().toLowerCase();
  return t === "medium" || t === "high" || t === "critical";
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
  if (summary) lines.push(`Organisation summary (overview): ${summary}`);

  const strategicFocus = nonEmpty(cp.strategic_focus) ?? nonEmpty(cp.business_purpose);
  if (strategicFocus) {
    lines.push(`Strategic focus / direction: ${strategicFocus}`);
  }

  const keyDrivers = stringList(cp.key_drivers);
  const prioritiesLegacy = nonEmpty(cp.strategic_priorities);
  if (keyDrivers.length > 0) {
    lines.push(`Key strategic drivers: ${keyDrivers.join(", ")}`);
  } else if (prioritiesLegacy) {
    lines.push(`Strategic priorities (legacy text): ${prioritiesLegacy}`);
  }

  const deliveryModels = stringList(cp.delivery_models);
  const deliveryLegacy = nonEmpty(cp.delivery_context);
  if (deliveryModels.length > 0) {
    lines.push(`Delivery / ways of working (delivery_models): ${deliveryModels.join(", ")}`);
  } else if (deliveryLegacy) {
    lines.push(`Delivery context (legacy text): ${deliveryLegacy}`);
  }

  const orgStructure = nonEmpty(cp.organisation_structure);
  if (orgStructure) {
    lines.push(`Organisation structure: ${orgStructure}`);
  }

  const capAreas = stringList(cp.primary_capability_areas);
  const capLegacy = nonEmpty(cp.capability_emphasis);
  if (capAreas.length > 0) {
    lines.push(`Primary capability focus areas: ${capAreas.join(", ")}`);
  } else if (capLegacy) {
    lines.push(`Capability emphasis (legacy text): ${capLegacy}`);
  }

  const capNotes = nonEmpty(cp.capability_focus_notes);
  if (capNotes) lines.push(`Capability / delivery notes: ${capNotes}`);

  const reg = nonEmpty(cp.regulatory_intensity);
  if (reg) lines.push(`Regulatory intensity: ${reg}`);

  const bias = nonEmpty(cp.role_model_bias);
  if (bias) lines.push(`Role model bias (how roles are framed): ${bias}`);

  const roleGuide = nonEmpty(cp.role_interpretation_guidance);
  if (roleGuide) lines.push(`Role interpretation guidance: ${roleGuide}`);

  const termGuide = nonEmpty(cp.terminology_guidance);
  if (termGuide) lines.push(`Terminology guidance: ${termGuide}`);

  return lines.length > 0 ? lines.join("\n") : "";
}

function normalizeLineKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function dedupeAgainstExisting(
  suggested: string[],
  existing: Set<string>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of suggested) {
    const t = typeof raw === "string" ? raw.trim() : "";
    if (!t) continue;
    const key = normalizeLineKey(t);
    if (existing.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function buildUserPrompt(
  companyProfile: CompanyProfileInput | null,
  job: {
    title: string;
    level: string | null;
    job_family: string | null;
    role_summary: string | null;
    responsibilities: string[];
    existing_requirements: string[];
  },
): string {
  const cp = companyProfile;
  const orgBlock = cp ? buildOrganisationContextBlock(cp) : "";
  const cpTyped: CompanyProfileInput = cp ?? {};
  const deliveryModelList = stringList(cpTyped.delivery_models);
  const hasDeliverySignals =
    deliveryModelList.length > 0 || Boolean(nonEmpty(cpTyped.delivery_context));
  const regLabel = nonEmpty(cpTyped.regulatory_intensity);
  const regMediumPlus = regulatoryIsMediumOrHigher(cpTyped.regulatory_intensity);

  const orgSection = orgBlock.trim()
    ? orgBlock
    : "(No organisation profile is saved yet — still avoid generic hiring filler; ground criteria in role title, sector, and responsibilities when possible.)";

  const respList =
    job.responsibilities.length > 0
      ? job.responsibilities.map((r, i) => `${i + 1}. ${r}`).join("\n")
      : "(none listed)";

  const existingBlock =
    job.existing_requirements.length > 0
      ? job.existing_requirements.map((r, i) => `${i + 1}. ${r}`).join("\n")
      : "(none yet)";

  const desc = nonEmpty(job.role_summary);
  const family = nonEmpty(job.job_family);

  const operatingModelSection = hasDeliverySignals
    ? `
## Operating model signals (mandatory when delivery context exists)
- Delivery models and/or delivery context appear in the organisation profile. Include **at least one** requirement that describes how work is **executed** here (e.g. product-led delivery, agile squads, hybrid governance, cadence) — anchored to the **named** models, structure, or legacy delivery text — not generic "Agile experience" alone.
`.trim()
    : "";

  const regulatorySection = regMediumPlus
    ? `
## Regulatory context (mandatory)
- **regulatory_intensity** is **${regLabel ?? "Medium"}** or higher. Include **at least one** requirement that reflects compliance, governance, risk awareness, or control-relevant experience appropriate to the role — substantive, not a single token phrase.
`.trim()
    : "";

  return `Suggest **additional requirements** for this job profile.

**Requirements** = hiring-quality, **assessable** criteria: what a candidate must **bring** (education where relevant, experience, domain/regulatory exposure, methods, data/decision skills, stakeholder influence) — **level-appropriate**. **Not** day-to-day accountabilities (those are responsibilities).

Align with the **role purpose** and **current responsibilities** below: requirements complement them; **do not** restate responsibilities as requirements or copy their phrasing.

## Differentiation rules
- Avoid **generic** hiring language that could apply to any organisation.
- Reflect how **this** organisation operates where context exists (e.g. product-led, agile, matrix, regulated).
- Do not over-focus on a **single** product, niche, or offering unless the organisation clearly specialises in it.
- Prefer **broad domain** phrasing with optional examples in parentheses.
- Use examples to **illustrate** scope, not **define** the entire criterion.

Bad:
'Experience in reverse mortgages'

Good:
'Experience delivering financial products (e.g. lending, savings, or consumer finance products)'

## Organisation anchoring
Each new requirement should reflect **at least one** of the following **where relevant** (only from supplied context — **never invent** organisation facts):
- Industry or sector context
- Regulatory intensity
- Delivery model (Agile, product-led, hybrid, etc.)
- Organisation structure (e.g. cross-functional, matrix)
- Strategic focus or key drivers

## Reduce generic HR boilerplate
- Avoid vague phrases such as: 'strong communication skills', 'team player', 'fast-paced environment'.
- Instead, express these **in context**, e.g. 'ability to align cross-functional stakeholders in a matrix or product-led environment'.

${operatingModelSection ? `${operatingModelSection}\n\n` : ""}${regulatorySection ? `${regulatorySection}\n\n` : ""}## Structural balance (across the suggested set)
Seek a **balanced mix** as appropriate to the level:
- Education / qualification (**optional**, not dominant — do not over-weight degrees or certifications)
- Experience (years + domain)
- Domain knowledge (industry / regulation)
- Methods / ways of working
- Data / decision-making capability
- Stakeholder / influence capability

## Organisation context
${orgSection}

## Role
Job family: ${family ?? "—"}
Title: ${job.title}
Level: ${job.level ?? "—"}
${desc ? `Role purpose / description:\n${desc}\n` : ""}

## Current responsibilities (context — do not duplicate or paraphrase as requirements)
${respList}

## Existing requirements (CRITICAL — do NOT repeat, rephrase, or overlap with these)
${existingBlock}

Return JSON with EXACTLY one key:
- "suggested_requirements": string[] — **6–10** new items. Each must be **clear**, **assessable**, and **non-overlapping** with each other and with existing lines. No invented organisation facts. No duplicates.

Respond with JSON only, no markdown fences.`;
}

function parseContent(content: string): Result {
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
  const arr = o.suggested_requirements;
  if (!Array.isArray(arr) || !arr.every((x) => typeof x === "string")) {
    throw new Error("AI response missing suggested_requirements array.");
  }
  const suggested_requirements = arr.map((s) => s.trim()).filter(Boolean);
  return { suggested_requirements };
}

function parseRequestBody(raw: unknown): {
  companyProfile: CompanyProfileInput | null;
  job: {
    title: string;
    level: string | null;
    job_family: string | null;
    role_summary: string | null;
    responsibilities: string[];
    existing_requirements: string[];
  };
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

  const jobRaw = body.jobProfile;
  if (!jobRaw || typeof jobRaw !== "object" || Array.isArray(jobRaw)) {
    throw new Error("jobProfile is required and must be an object.");
  }
  const jp = jobRaw as JobProfileInput;
  const title = typeof jp.title === "string" ? jp.title.trim() : "";
  if (!title) throw new Error("jobProfile.title is required.");
  const level =
    jp.level === undefined || jp.level === null
      ? null
      : String(jp.level).trim() || null;
  const job_family =
    jp.job_family === undefined || jp.job_family === null
      ? null
      : String(jp.job_family).trim() || null;
  const role_summary =
    jp.role_summary === undefined || jp.role_summary === null
      ? null
      : String(jp.role_summary).trim() || null;

  const resp = jp.responsibilities;
  if (resp !== undefined && !Array.isArray(resp)) {
    throw new Error("jobProfile.responsibilities must be an array of strings.");
  }
  const responsibilities = Array.isArray(resp)
    ? resp.filter((x): x is string => typeof x === "string").map((s) => s.trim())
    : [];

  const ex = jp.existing_requirements;
  if (ex !== undefined && !Array.isArray(ex)) {
    throw new Error("jobProfile.existing_requirements must be an array of strings.");
  }
  const existing_requirements = Array.isArray(ex)
    ? ex.filter((x): x is string => typeof x === "string").map((s) => s.trim())
    : [];

  return {
    companyProfile,
    job: {
      title,
      level,
      job_family,
      role_summary,
      responsibilities,
      existing_requirements,
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
    console.error("suggest-job-profile-requirements: OPENAI_API_KEY is not set");
    return jsonResponse(
      {
        error:
          "Server configuration error: OpenAI is not configured. Set OPENAI_API_KEY for this project.",
      },
      500,
    );
  }

  const model =
    Deno.env.get("OPENAI_MODEL")?.trim() || "gpt-4o-mini";

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

  const existingKeys = new Set(
    parsedBody.job.existing_requirements.map((s) => normalizeLineKey(s)),
  );

  const system =
    `You suggest **additional job requirements** only: hiring-quality, assessable criteria (credentials, experience, domain/regulatory exposure, education, methods, influence — level-appropriate).

Output valid JSON with one key "suggested_requirements" (string array).

Ground every requirement when organisation context is supplied: sector, strategy, delivery model, structure, regulatory intensity, capability focus — use only what is given; never invent facts.

Prefer broad domain language with parenthetical examples; avoid centring on one niche unless context shows specialisation. Avoid generic HR clichés; phrase soft skills in organisational context.

Do not repeat or paraphrase existing_requirements. Do not output responsibility-style task bullets.`;

  const user = buildUserPrompt(parsedBody.companyProfile, parsedBody.job);

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
            { role: "system", content: system },
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
        /* keep detail */
      }
      console.error(
        "suggest-job-profile-requirements: OpenAI error",
        openaiRes.status,
        detail,
      );
      return jsonResponse(
        { error: `OpenAI request failed: ${detail}` },
        502,
      );
    }

    let completion: {
      choices?: { message?: { content?: string | null } }[];
    };
    try {
      completion = JSON.parse(rawText) as typeof completion;
    } catch {
      return jsonResponse(
        { error: "OpenAI returned invalid JSON." },
        502,
      );
    }

    const content = completion.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return jsonResponse(
        { error: "OpenAI returned an empty message." },
        502,
      );
    }

    const parsed = parseContent(content);
    const filtered = dedupeAgainstExisting(
      parsed.suggested_requirements,
      existingKeys,
    );
    return jsonResponse({ suggested_requirements: filtered }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected server error.";
    console.error("suggest-job-profile-requirements:", e);
    return jsonResponse({ error: msg }, 500);
  }
});
