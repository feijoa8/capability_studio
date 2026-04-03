import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
  title?: string;
  level?: string | null;
  role_summary?: string | null;
  responsibilities?: unknown;
};

type RefinementResult = {
  refined_role_summary: string;
  improved_responsibilities: string[];
  suggested_requirements: string[];
  suggested_capabilities: string[];
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

function buildUserPrompt(
  companyProfile: CompanyProfileInput | null,
  job: {
    title: string;
    level: string | null;
    role_summary: string | null;
    responsibilities: string[];
  },
): string {
  const cp = companyProfile;
  const orgBlock = cp
    ? [
        nonEmpty(cp.sector) && `Sector: ${cp.sector}`,
        nonEmpty(cp.industry) && `Industry: ${cp.industry}`,
        nonEmpty(cp.delivery_context) && `Delivery context: ${cp.delivery_context}`,
        nonEmpty(cp.capability_emphasis) && `Capability emphasis: ${cp.capability_emphasis}`,
        nonEmpty(cp.summary) && `Organisation summary: ${cp.summary}`,
        nonEmpty(cp.business_purpose) && `Business purpose: ${cp.business_purpose}`,
        nonEmpty(cp.strategic_priorities) &&
          `Strategic priorities: ${cp.strategic_priorities}`,
        nonEmpty(cp.role_interpretation_guidance) &&
          `Role interpretation guidance: ${cp.role_interpretation_guidance}`,
        nonEmpty(cp.terminology_guidance) &&
          `Terminology guidance: ${cp.terminology_guidance}`,
      ]
        .filter(Boolean)
        .join("\n")
    : "(No organisation profile is saved yet — apply general professional standards and note assumptions.)";

  const respList =
    job.responsibilities.length > 0
      ? job.responsibilities.map((r, i) => `${i + 1}. ${r}`).join("\n")
      : "(none listed yet)";

  const desc = nonEmpty(job.role_summary);

  return `Refine this job profile so it reflects how the role operates in THIS organisation.

## Organisation context
${orgBlock}

## Current job profile
Title: ${job.title}
Level: ${job.level ?? "—"}
${desc ? `Existing role summary / notes:\n${desc}\n` : ""}
Current responsibilities:
${respList}

## Section definitions (critical — do not merge or duplicate)
- **Responsibilities** = what the role *does*: outcomes, accountabilities, day-to-day deliverables (use action-oriented bullets).
- **Requirements** = what someone *needs to have*: qualifications (if relevant), experience expectations, domain knowledge, regulatory or industry exposure, and expectations appropriate to the stated level (e.g. senior vs principal). Not a list of tasks.
- **Capabilities** = **applied capability statements** for THIS role in THIS domain/industry: reusable labels that could sit in a capability library and be **compared to competency expectations** (not task lists, not credentials, not “years of experience”). They describe *what kind of work* the person can perform at a professional level, anchored in the sector, delivery context, or regulatory environment.

**Capabilities — form:** Prefer **short noun phrases** (roughly 3–8 words), not full sentences and not single-word trait labels. **Do not** output generic soft skills as standalone items—e.g. reject "Analytical thinking", "Communication", "Collaboration", "Adaptability", "Stakeholder management" unless embedded in a **role/context-specific phrase**. If a soft skill would be relevant, name the **applied** form (e.g. "Stakeholder facilitation in agile delivery" not "Communication").

**Good style examples (adapt to this role and org—do not copy verbatim if irrelevant):**  
"Regulatory requirements analysis", "Business-to-technology translation", "Stakeholder facilitation in agile delivery", "Requirements traceability and validation", "Compliance-aware backlog refinement", "Process improvement identification in regulated environments".

**Capabilities — must not:** Duplicate or paraphrase bullets from responsibilities (duties/outcomes) or requirements (credentials, tenure, education). Capabilities are **distinct**: they are the applied abilities that sit *between* generic traits and task lists.

**Anti-duplication:** Each bullet should appear in at most ONE of: improved_responsibilities, suggested_requirements, suggested_capabilities. If content could fit two sections, choose the single best fit.

Return a JSON object with EXACTLY these keys (all required):
- "refined_role_summary": string — 2–5 sentences; specific to this org, not generic HR boilerplate.
- "improved_responsibilities": string[] — 4–12 items unless the role is very narrow; duty/outcome focused only.
- "suggested_requirements": string[] — 3–10 items covering qualifications, experience, domain/regulatory exposure, level bar; must not repeat responsibility wording.
- "suggested_capabilities": string[] — **6–10** items; **short applied capability phrases** (noun-phrase style), role- and domain-specific, strong differentiation vs similar job titles in other domains; suitable for frameworks, role matching, and development planning.

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
  const ir = o.improved_responsibilities;
  const req = o.suggested_requirements;
  const sc = o.suggested_capabilities;
  if (!refined_role_summary) {
    throw new Error("AI response missing refined_role_summary.");
  }
  if (!Array.isArray(ir) || !ir.every((x) => typeof x === "string")) {
    throw new Error("AI response missing improved_responsibilities array.");
  }
  if (!Array.isArray(req) || !req.every((x) => typeof x === "string")) {
    throw new Error("AI response missing suggested_requirements array.");
  }
  if (!Array.isArray(sc) || !sc.every((x) => typeof x === "string")) {
    throw new Error("AI response missing suggested_capabilities array.");
  }
  return {
    refined_role_summary,
    improved_responsibilities: ir.map((s) => s.trim()).filter(Boolean),
    suggested_requirements: req.map((s) => s.trim()).filter(Boolean),
    suggested_capabilities: sc.map((s) => s.trim()).filter(Boolean),
  };
}

function parseRequestBody(raw: unknown): {
  companyProfile: CompanyProfileInput | null;
  job: {
    title: string;
    level: string | null;
    role_summary: string | null;
    responsibilities: string[];
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

  const resp = jp.responsibilities;
  if (resp !== undefined && !Array.isArray(resp)) {
    throw new Error("jobProfile.responsibilities must be an array of strings.");
  }
  const responsibilities = Array.isArray(resp)
    ? resp.filter((x): x is string => typeof x === "string").map((s) => s.trim())
    : [];

  return {
    companyProfile,
    job: { title, level, role_summary, responsibilities },
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
    `You are an expert workforce and role design assistant. You interpret job profiles in the context of the employer's sector, industry, delivery model, and capability priorities.

You output only valid JSON matching the user's schema. Use the organisation's terminology where provided.

Distinguish strictly:
- Responsibilities → what the role does (work, outcomes, accountabilities).
- Requirements → what a hire must bring (credentials, experience, domain/regulatory exposure, level-appropriate bar). Never list day-to-day tasks here.
- Capabilities → **applied capability statements** (short noun phrases, 3–8 words), role- and domain-specific, usable in capability frameworks and for matching against competency definitions. **Never** emit bare generic soft skills: e.g. "analytical thinking", "communication", "collaboration", "adaptability", "stakeholder management" as single words or two-word trait labels. **Prefer** noun-phrase capability expressions over personality labels; embed any soft skill only inside a context-specific phrase (e.g. "Requirements traceability and validation" not "Attention to detail").

Each capability must be distinct from responsibilities (not tasks) and from requirements (not credentials). Differentiate this role from similar titles in other domains (e.g. Agile BA vs construction PM).`;

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
          temperature: 0.35,
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
