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
  business_purpose?: string | null;
  strategic_priorities?: string | null;
  delivery_context?: string | null;
  capability_emphasis?: string | null;
  role_interpretation_guidance?: string | null;
  terminology_guidance?: string | null;
};

type PracticeDraft = {
  name: string;
  description: string;
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
  domain: string | null,
  focus: string | null,
): string {
  const cp = companyProfile;
  const orgBlock = cp
    ? [
        nonEmpty(cp.organisation_name) && `Organisation name: ${cp.organisation_name}`,
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
    : "(No organisation profile is saved yet — infer reasonable practices from the optional domain and focus only, and state assumptions briefly in practice descriptions where helpful.)";

  const domainLine = domain
    ? `Target domain: ${domain}`
    : "(No specific domain requested — use the organisation context only.)";
  const focusLine = focus
    ? `Focus area / lens: ${focus}`
    : "(No specific focus area requested.)";

  return `## Organisation context
${orgBlock}

## Optional scope
${domainLine}
${focusLine}

## Task
Propose a **practice model**: a set of **coarse practice areas** (not subjects, not competencies) that together cover how capability work is organised in this organisation.

**Requirements:**
- Align each practice to the organisation’s industry, delivery model, and regulatory environment (when inferable from context).
- **6–14 practices** unless the organisation is very small (then at least 4).
- Practices must be **mutually distinct** (no overlapping names or duplicate concepts).
- **Collectively** they should span the domain / org context without large gaps — avoid listing only one part of the value chain unless the focus explicitly narrows scope.
- **Avoid generic filler** that could apply to any company (e.g. "Communication", "Leadership" as standalone practice names).
- **Do not** go below "practice" level: no job titles, no competencies, no subject areas, no process steps — stay at **strategic practice groupings** (e.g. how a bank might organise "Customer insight", "Digital delivery", "Risk & compliance", etc., when relevant to context).
- Each practice needs a short **name** (title case or sentence case) and a **description** (1–3 sentences) that anchors it in this organisation.

Return JSON only with EXACTLY this shape:
{
  "practices": [
    { "name": "string", "description": "string" }
  ]
}

No markdown fences.`;
}

function parseGenerateResult(content: string): { practices: PracticeDraft[] } {
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
  const arr = o.practices;
  if (!Array.isArray(arr)) {
    throw new Error("AI response missing practices array.");
  }
  const practices: PracticeDraft[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name =
      typeof row.name === "string" ? row.name.trim() : "";
    const description =
      typeof row.description === "string" ? row.description.trim() : "";
    if (name) {
      practices.push({ name, description });
    }
  }
  if (practices.length === 0) {
    throw new Error("AI returned no practices.");
  }
  return { practices };
}

function parseRequestBody(raw: unknown): {
  companyProfile: CompanyProfileInput | null;
  domain: string | null;
  focus: string | null;
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

  const domainRaw = body.domain;
  const focusRaw = body.focus;
  const domain =
    domainRaw === undefined || domainRaw === null
      ? null
      : String(domainRaw).trim() || null;
  const focus =
    focusRaw === undefined || focusRaw === null
      ? null
      : String(focusRaw).trim() || null;

  return { companyProfile, domain, focus };
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
    console.error("generate-practice-model: OPENAI_API_KEY is not set");
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
    `You are an expert organisational capability and workforce design consultant. You design **practice models** for competency frameworks inside organisations.

You output only valid JSON matching the user's schema. Use the organisation's terminology where provided.

**Rules:**
- Practices are **coarse thematic areas** (not job titles, not competencies, not subjects, not detailed processes).
- Avoid generic duplicates that could apply anywhere; tie each practice to the organisation’s industry, delivery model, and regulatory environment when known.
- **Mutual distinctness** and **collective coverage** of the domain are required.
- **Not too granular** — no sub-skills or subject lists; this is a organising layer above subjects.`;

  const user = buildUserPrompt(
    parsedBody.companyProfile,
    parsedBody.domain,
    parsedBody.focus,
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
          temperature: 0.4,
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
      console.error("generate-practice-model: OpenAI error", openaiRes.status, detail);
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

    const result = parseGenerateResult(content);
    return jsonResponse(result, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected server error.";
    console.error("generate-practice-model:", e);
    return jsonResponse({ error: msg }, 500);
  }
});
