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
  existingPracticeNames: string[],
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

  const existingPracticesBlock =
    existingPracticeNames.length > 0
      ? `## Existing practices in this workspace (do not duplicate or trivially rename)
${existingPracticeNames.join(", ")}

`
      : "";

  return `## Organisation context
${orgBlock}

## Optional scope
${domainLine}
${focusLine}

${existingPracticesBlock}## Task (Capability Studio)
You are proposing **Practices** only for a capability development tool. Output is **not** a consulting taxonomy: Practices must be **disciplines or ways of working**—not business domains, regulatory themes, or industry topics (those belong in **Subjects** in a full hierarchy, not here).

**Practice layer rules:**
- **Include:** high-level disciplines, professional functions, or ways of working (e.g. Agile Delivery, Business Analysis, Product Management, Service Design, Project Delivery, Change Management, Engineering, Data Practice).
- **Exclude:** domains or functional areas that read as **Subjects**—e.g. Risk Management, Compliance, Customer Experience, Data Governance, Digital Banking, Financial Products, Technology Integration—unless naming them clearly as a **discipline** (rare). Prefer fewer, stronger Practices; **no filler** practices.
- Return **3–6 practices** maximum. Small orgs may use fewer; never exceed 6.
- Practices must be **mutually distinct** (no overlapping names or near-duplicates).
- **Collectively** they should cover how capability work is organised without huge gaps, unless scope is explicitly narrow.
- Each practice needs a short **name** and a **description** (1–3 sentences) anchored in this organisation where context allows.

Return JSON only with EXACTLY this shape:
{
  "practices": [
    { "name": "string", "description": "string" }
  ]
}

No markdown fences.`;
}

// Expects discipline-level practice names; JSON shape is unchanged—prompting enforces semantics.
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
  existingPracticeNames: string[];
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

  const epnRaw = body.existingPracticeNames;
  const existingPracticeNames = Array.isArray(epnRaw)
    ? epnRaw.map((x) => String(x).trim()).filter(Boolean)
    : [];

  return { companyProfile, domain, focus, existingPracticeNames };
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
    `You support **Capability Studio**, a capability development tool. You output only valid JSON matching the schema.

**What a Practice is (critical):**
- Practices are **high-level disciplines, professional functions, or ways of working**—the top layer above Subjects and Competencies.
- **Do not** use business domains, regulatory areas, industry topics, or operational themes as Practice names when they are better framed as **Subjects** under a discipline.

**Good Practice examples:** Agile Delivery, Business Analysis, Product Management, Service Design, Project Delivery, Change Management, Engineering, Data Practice.

**Bad Practice examples (usually Subjects, not Practices):** Risk Management, Compliance, Customer Experience, Data Governance, Digital Banking, Financial Products, Technology Integration.

**Correct vs incorrect (names only):**
- Correct: Practice "Business Analysis" (discipline).
- Incorrect: Practice "Customer Experience" or "Risk Management" or "Compliance"—these are typically **Subjects** under e.g. Service Design, Business Analysis, or Change Management.

**Output discipline:**
- Prefer **fewer, stronger** Practices; avoid filler.
- Names concise and professional; no duplicate or near-duplicate concepts.`;

  const user = buildUserPrompt(
    parsedBody.companyProfile,
    parsedBody.domain,
    parsedBody.focus,
    parsedBody.existingPracticeNames,
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
