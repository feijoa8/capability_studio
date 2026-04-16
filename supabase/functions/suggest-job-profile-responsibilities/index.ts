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
  existing_responsibilities?: unknown;
  requirements?: unknown;
};

type Result = { suggested_responsibilities: string[] };

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
    existing_responsibilities: string[];
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
    : "(No organisation profile is saved yet — still avoid generic bullets that could apply to the same job title anywhere.)";

  const existingBlock =
    job.existing_responsibilities.length > 0
      ? job.existing_responsibilities
          .map((r, i) => `${i + 1}. ${r}`)
          .join("\n")
      : "(none yet)";

  const reqList =
    job.requirements.length > 0
      ? job.requirements.map((r, i) => `${i + 1}. ${r}`).join("\n")
      : "(none listed)";

  const desc = nonEmpty(job.role_summary);
  const family = nonEmpty(job.job_family);

  const grounding = `
## Differentiation rules (mandatory)
- Each suggested bullet must be **organisation-grounded** when context is provided: tie work to **this** sector/industry, **strategic drivers**, **delivery and org structure**, **regulatory level**, and/or **capability focus** — using only what appears above. Do **not** output interchangeable "standard ${job.title || "role"}" template lines.
- **Products, services, segments:** Prefer the organisation’s **broader** offering (e.g. "lending products", "financial services"). Optional **parenthetical examples** illustrate scope — e.g. lending products (e.g. mortgages, reverse mortgages, consumer finance). Do **not** centre bullets on a **single niche** product unless the context clearly shows specialisation there. Specifics **illustrate**; they do not **define** the whole accountability.
- If any bullet names a **specific** product, service line, or segment, include **at least one** bullet that clearly reflects the **broader** portfolio or offering — unless the organisation context indicates exclusive focus on that niche.
- Do **not** repeat the **same** niche example (same named product/segment) across **multiple** bullets; use it **once** at most, and use broader phrasing or **different** illustrative examples elsewhere.
- **Avoid** vague phrases ("drive innovation", "work in Agile", "stakeholder management") unless you **anchor** them to this context (e.g. named delivery model, governance, customer/regulatory reality).
- **Tension / trade-offs:** Where the context implies competing pressures — e.g. **innovation vs compliance**, **speed vs governance**, **customer pull vs regulatory obligations** — reflect that tension in **at least one** bullet when it fits the role (do not invent conflicts absent from context).
${agileHint ? `- **Operating model:** The organisation uses Agile-related delivery labels. Describe **how** work runs (e.g. squads, product-led flow, hybrid with stage gates, PI cadence) using those **named** models and structure — **not** generic "Agile sprints" alone.\n` : ""}${regHigh ? `- **Regulatory:** Intensity is **${regLabel}**. Integrate **concrete** compliance, evidence, approval, or risk-control accountabilities where appropriate — not a single token mention.\n` : ""}
## Internal variety (within your new bullets only)
- **Do not** emit several bullets that are the same idea reworded (e.g. roadmap prioritisation + KPI reviews + performance analysis if they collapse to one planning/measurement theme). **Each** new line = **one** distinct accountability; merge overlapping ideas into a single sharper bullet instead of spreading them.
`.trim();

  return `Suggest **additional responsibilities** for this job profile.

**Responsibilities** = what the role *does*: outcomes, accountabilities, deliverables (concise, action-oriented). Do **not** list qualifications or years of experience — those belong in Requirements.

${grounding}

## Organisation context
${orgSection}

## Role
Job family: ${family ?? "—"}
Title: ${job.title}
Level: ${job.level ?? "—"}
${desc ? `Role purpose / description:\n${desc}\n` : ""}

## Current requirements (context — do not copy as responsibilities)
${reqList}

## Existing responsibilities (CRITICAL — do NOT repeat, rephrase, or overlap with these)
${existingBlock}

Return JSON with EXACTLY one key:
- "suggested_responsibilities": string[] — **4–12** new bullets (similar total length to a strong list — **tighter wording**, not longer). Strong verbs. Each item **meaningfully distinct** from existing lines **and** from each other in the new array. No duplicates.

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
  const arr = o.suggested_responsibilities;
  if (!Array.isArray(arr) || !arr.every((x) => typeof x === "string")) {
    throw new Error("AI response missing suggested_responsibilities array.");
  }
  const suggested_responsibilities = arr.map((s) => s.trim()).filter(Boolean);
  return { suggested_responsibilities };
}

function parseRequestBody(raw: unknown): {
  companyProfile: CompanyProfileInput | null;
  job: {
    title: string;
    level: string | null;
    job_family: string | null;
    role_summary: string | null;
    existing_responsibilities: string[];
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

  const er = jp.existing_responsibilities;
  if (er !== undefined && !Array.isArray(er)) {
    throw new Error("jobProfile.existing_responsibilities must be an array of strings.");
  }
  const existing_responsibilities = Array.isArray(er)
    ? er.filter((x): x is string => typeof x === "string").map((s) => s.trim())
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
    job: {
      title,
      level,
      job_family,
      role_summary,
      existing_responsibilities,
      requirements,
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
    console.error("suggest-job-profile-responsibilities: OPENAI_API_KEY is not set");
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
    parsedBody.job.existing_responsibilities.map((s) => normalizeLineKey(s)),
  );

  const system =
    `You suggest **additional job responsibilities** only: concrete accountabilities and outcomes for **this** employer when organisation context is supplied.

Output valid JSON with one key "suggested_responsibilities" (string array).

Prioritise **distinctive**, context-specific bullets over generic role templates. When naming products, services, or segments, prefer **broad** offerings; use parenthetical examples to illustrate, not to narrow the whole role to one niche unless context demands it. If a niche example appears, ensure **portfolio-level** coverage elsewhere; never reuse the **same** niche example in multiple bullets.

Do not repeat or paraphrase existing_responsibilities. Do not output requirements-style credentials. Keep each line focused and non-overlapping with other new lines.`;

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
        "suggest-job-profile-responsibilities: OpenAI error",
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
      parsed.suggested_responsibilities,
      existingKeys,
    );
    return jsonResponse({ suggested_responsibilities: filtered }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected server error.";
    console.error("suggest-job-profile-responsibilities:", e);
    return jsonResponse({ error: msg }, 500);
  }
});
