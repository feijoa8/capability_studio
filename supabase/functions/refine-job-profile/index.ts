import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Rich company profile (legacy + structured v2) from client merge. */
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
  /** Job family name for context (optional) */
  job_family?: string | null;
  role_summary?: string | null;
  responsibilities?: unknown;
  requirements?: unknown;
};

/** Pass 1: role description / purpose only (no competency themes, no HR list rewrites). */
type RefinementResult = {
  refined_role_summary: string;
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

function deliveryModelsMentionAgile(models: string[]): boolean {
  return models.some((d) => /agile|scrum|safe|kanban/i.test(d));
}

function regulatoryIsElevated(intensity: string | null | undefined): boolean {
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
    lines.push(`Delivery / ways of working: ${deliveryModels.join(", ")}`);
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

function buildUserPrompt(
  companyProfile: CompanyProfileInput | null,
  job: {
    title: string;
    level: string | null;
    job_family: string | null;
    role_summary: string | null;
    responsibilities: string[];
    requirements: string[];
  },
): string {
  const cp = companyProfile;
  const orgBlock = cp ? buildOrganisationContextBlock(cp) : "";

  const cpTyped: CompanyProfileInput = cp ?? {};
  const deliveryModels = stringList(cpTyped.delivery_models);
  const agileHint = deliveryModelsMentionAgile(deliveryModels);
  const regHigh = regulatoryIsElevated(
    nonEmpty(cpTyped.regulatory_intensity),
  );
  const regLabel = nonEmpty(cpTyped.regulatory_intensity) ?? "elevated";

  const orgSection = orgBlock.trim()
    ? orgBlock
    : "(No organisation profile is saved yet — apply general professional standards; still avoid generic filler that could apply to any employer.)";

  const respList =
    job.responsibilities.length > 0
      ? job.responsibilities.map((r, i) => `${i + 1}. ${r}`).join("\n")
      : "(none listed yet)";

  const reqList =
    job.requirements.length > 0
      ? job.requirements.map((r, i) => `${i + 1}. ${r}`).join("\n")
      : "(none listed yet)";

  const desc = nonEmpty(job.role_summary);
  const family = nonEmpty(job.job_family);

  const groundingRules = `
## Grounding rules (mandatory)
- Answer implicitly: **"What makes this role unique in THIS organisation?"** The description must be **specific** to the employer and role; it must **not** read like a template that could apply unchanged to the same job title elsewhere.
- Incorporate **at least 2–3 concrete organisation-specific anchors** drawn from the organisation context above (e.g. sector/industry, strategic focus or drivers, delivery/operating model, regulatory level, capability focus, or terminology guidance). Skip anchors that are missing — never invent facts.
- **Do not** output a generic paragraph that ignores sector, strategy, and operating model when those are provided.
- Avoid empty phrases like "within an Agile framework" or "in a fast-paced environment" **unless** you tie them to **this** organisation (e.g. how work is organised here: squads, hybrid, product-led, matrix).
- **Products, services, customer segments:** Prefer the organisation’s **broader** offering (e.g. "lending products", "financial services"). Optional **parenthetical examples** may **illustrate** scope — e.g. lending products (e.g. mortgages, reverse mortgages, consumer finance). Do **not** make a **single niche** product or line the primary framing unless the context clearly shows the organisation specialises in that niche. Use specifics to **illustrate**, not to **define** the entire role. If a specific product or segment is named, also reflect the **broader portfolio** in the paragraph where natural, and do not repeat the **same** niche example.
${agileHint ? `- **Agile / iterative delivery:** The organisation lists Agile-related delivery models. Explain **how** that likely shapes this role (e.g. cross-functional squads, PI planning, product ownership boundaries) using the **named** delivery models and structure — not a one-line "we use Agile" cliché.\n` : ""}${regHigh ? `- **Regulatory context:** Regulatory intensity is **${regLabel}**. Weave **meaningful** governance, compliance, controls, or risk-awareness into the role purpose where relevant to the role level and domain — not a token mention.\n` : ""}- One **cohesive paragraph**, **2–5 sentences**, same approximate length as a strong professional role purpose — **higher specificity**, not more words.
`.trim();

  return `You are helping refine the **role description / role purpose** for a job profile so it reads clearly in the context of **THIS** organisation.

Use the responsibilities and requirements below only as **background** to understand the role. Do **not** rewrite them and do **not** output revised responsibility or requirement lists. This pass produces **one** durable narrative field: the role purpose / description.

${groundingRules}

## Organisation context (use this to differentiate the role)
${orgSection}

## Current job profile
Job family: ${family ?? "—"}
Title: ${job.title}
Level: ${job.level ?? "—"}
${desc ? `Existing role summary / description (may be empty):\n${desc}\n` : ""}
Current responsibilities (context only — do not echo as a bullet list in your output):
${respList}

Current requirements (context only — do not echo as a bullet list in your output):
${reqList}

Return a JSON object with EXACTLY this key:
- "refined_role_summary": string — **One paragraph, 2–5 sentences**: why this role exists here, what outcomes it owns, and how it fits **this** organisation's strategy, operating model, and constraints (as given above). Must reflect organisation sector/industry, strategic focus and drivers where provided, delivery model and organisation structure where provided, and regulatory expectations when intensity is Medium or higher. No competency themes, capability taxonomy labels, or task bullet lists.

Respond with JSON only, no markdown fences.`;
}

function parseRefinementContent(content: string): RefinementResult {
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
  const refined_role_summary =
    typeof o.refined_role_summary === "string"
      ? o.refined_role_summary.trim()
      : "";
  if (!refined_role_summary) {
    throw new Error("AI response missing refined_role_summary.");
  }
  return { refined_role_summary };
}

function parseRequestBody(raw: unknown): {
  companyProfile: CompanyProfileInput | null;
  job: {
    title: string;
    level: string | null;
    job_family: string | null;
    role_summary: string | null;
    responsibilities: string[];
    requirements: string[];
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
  if (!title) {
    throw new Error("jobProfile.title is required.");
  }
  const level =
    jp.level === undefined || jp.level === null
      ? null
      : String(jp.level).trim() || null;
  const role_summary =
    jp.role_summary === undefined || jp.role_summary === null
      ? null
      : String(jp.role_summary).trim() || null;

  const job_family =
    jp.job_family === undefined || jp.job_family === null
      ? null
      : String(jp.job_family).trim() || null;

  const resp = jp.responsibilities;
  if (resp !== undefined && !Array.isArray(resp)) {
    throw new Error("jobProfile.responsibilities must be an array of strings.");
  }
  const responsibilities = Array.isArray(resp)
    ? resp.filter((x): x is string => typeof x === "string").map((s) => s.trim())
    : [];

  const reqIn = jp.requirements;
  if (reqIn !== undefined && !Array.isArray(reqIn)) {
    throw new Error("jobProfile.requirements must be an array of strings.");
  }
  const requirements = Array.isArray(reqIn)
    ? reqIn.filter((x): x is string => typeof x === "string").map((s) => s.trim())
    : [];

  return {
    companyProfile,
    job: { title, level, job_family, role_summary, responsibilities, requirements },
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
    console.error("refine-job-profile: OPENAI_API_KEY is not set");
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

  const system =
    `You are an expert workforce and role design assistant. This task is **Pass 1 — role description only**.

You output only valid JSON with the single key "refined_role_summary".

The role purpose must be **organisation-grounded**: tie the role to the **specific** employer context supplied (sector, industry, strategy, delivery and org structure, regulatory intensity, capability focus). Reject generic, interchangeable wording that could apply to the same job title at any company.

**Never** produce a boilerplate description that could apply unchanged across employers when organisation context is provided. **Always** make explicit **why this role matters here** — not only what the job does in the abstract.

When mentioning products, services, or segments, prefer **broad** offering language with **optional** parenthetical examples; do not let one niche line dominate unless the context clearly shows that specialisation.

Do not output competency themes, capability taxonomies, or rewritten responsibility/requirement lists.`;

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
      console.error("refine-job-profile: OpenAI error", openaiRes.status, detail);
      return jsonResponse(
        {
          error: `OpenAI request failed: ${detail}`,
        },
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

    const result = parseRefinementContent(content);
    return jsonResponse(result, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected server error.";
    console.error("refine-job-profile:", e);
    return jsonResponse({ error: msg }, 500);
  }
});
