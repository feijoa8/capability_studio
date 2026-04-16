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

type CompetencyDraft = {
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
  practiceName: string | null,
  subjectName: string,
  subjectDescription: string | null,
  existingCompetencyNames: string[]
): string {
  const cp = companyProfile;
  const orgBlock = cp
    ? [
        nonEmpty(cp.organisation_name) &&
          `Organisation name: ${cp.organisation_name}`,
        nonEmpty(cp.sector) && `Sector: ${cp.sector}`,
        nonEmpty(cp.industry) && `Industry: ${cp.industry}`,
        nonEmpty(cp.summary) && `Summary: ${cp.summary}`,
        nonEmpty(cp.capability_emphasis) && `Capability emphasis: ${cp.capability_emphasis}`,
      ]
        .filter(Boolean)
        .join("\n")
    : "(No organisation profile.)";

  const practiceDisplay =
    practiceName && practiceName.trim()
      ? practiceName.trim()
      : "(Not specified)";

  const sd = subjectDescription?.trim()
    ? subjectDescription.trim()
    : "(No subject description.)";

  const existing =
    existingCompetencyNames.length > 0
      ? existingCompetencyNames.join(", ")
      : "(None yet for this subject.)";

  return `## Organisation context (optional)
${orgBlock}

## INPUT
Practice: ${practiceDisplay}
Subject: ${subjectName}
Description: ${sd}

Existing Competencies: ${existing}

## Task
Generate **4–8 competencies** for this subject within the practice context. Follow every rule in the system message: observable, developable skills; reusable across roles; concise names (2–5 words); no overlap with existing names; no duplication among new items.

Each competency needs a **name** and a **short description** of what good looks like.

Return JSON only with EXACTLY this shape:
{
  "competencies": [
    { "name": "string", "description": "string" }
  ]
}

No markdown fences.`;
}

// Competencies = developable skills within the subject; name + description only.
function parseResult(content: string): { competencies: CompetencyDraft[] } {
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
  const arr = o.competencies;
  if (!Array.isArray(arr)) {
    throw new Error("AI response missing competencies array.");
  }
  const competencies: CompetencyDraft[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const description =
      typeof row.description === "string" ? row.description.trim() : "";
    if (name) competencies.push({ name, description });
  }
  if (competencies.length === 0) {
    throw new Error("AI returned no competencies.");
  }
  return { competencies };
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
    return jsonResponse(
      {
        error:
          "Server configuration error: OpenAI is not configured. Set OPENAI_API_KEY.",
      },
      500
    );
  }

  const model = Deno.env.get("OPENAI_MODEL")?.trim() || "gpt-4o-mini";

  let body: {
    companyProfile?: CompanyProfileInput | null;
    practiceName?: string | null;
    subjectName?: string;
    subjectDescription?: string | null;
    existingCompetencyNames?: string[];
  };
  try {
    const text = await req.text();
    if (!text.trim()) {
      return jsonResponse({ error: "Empty request body." }, 400);
    }
    body = JSON.parse(text) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const subjectName = String(body.subjectName ?? "").trim();
  if (!subjectName) {
    return jsonResponse({ error: "subjectName is required." }, 400);
  }

  const practiceName =
    body.practiceName === undefined || body.practiceName === null
      ? null
      : String(body.practiceName).trim() || null;

  const subjectDescription =
    body.subjectDescription === undefined || body.subjectDescription === null
      ? null
      : String(body.subjectDescription).trim() || null;

  const companyProfile =
    body.companyProfile &&
    typeof body.companyProfile === "object" &&
    !Array.isArray(body.companyProfile)
      ? (body.companyProfile as CompanyProfileInput)
      : null;

  const existingCompetencyNames = Array.isArray(body.existingCompetencyNames)
    ? body.existingCompetencyNames.map((s) => String(s).trim()).filter(Boolean)
    : [];

  const system = `You are designing a **Capability Development** model for Capability Studio.

Your task is to generate **COMPETENCIES** for a given **SUBJECT** within a **PRACTICE**.

---

DEFINITION

• **Practice** = discipline (e.g. Agile Delivery)
• **Subject** = capability area within that discipline (e.g. Sprint Planning)
• **Competency** = a specific, observable, **developable skill** within that subject

---

RULES

1. Generate **4–8 competencies**.

2. Each competency must:
   • Be a clearly defined **skill or capability**
   • Be **observable** and **assessable**
   • Be something an **individual can improve** over time
   • Be **reusable across roles** (not role-specific tasks)

3. **DO NOT** generate:
   • Subjects or Practices (too broad)
   • **Tools** (e.g. Jira, Excel, Power BI)
   • **Tasks** (e.g. Writing documents, Attending meetings)
   • **Outcomes** (e.g. Deliver successful projects)
   • **Personality traits** (e.g. Being proactive)

4. Keep names **concise (2–5 words)**.

5. Avoid **duplication or overlap** among new items and with existing names when provided.

---

GOOD EXAMPLE

Practice: **Agile Delivery**  
Subject: **Sprint Planning**

Competencies:
- Sprint Planning Facilitation
- Backlog Prioritisation
- Story Estimation
- Capacity Planning
- Dependency Identification

---

BAD EXAMPLES (avoid)

- Agile ❌ (practice)
- Planning ❌ (too vague)
- Jira Usage ❌ (tool)
- Running meetings ❌ (task)
- Delivering outcomes ❌ (not a skill)

---

You output **only** valid JSON matching the user's schema. No markdown fences.`;

  const user = buildUserPrompt(
    companyProfile,
    practiceName,
    subjectName,
    subjectDescription,
    existingCompetencyNames
  );

  try {
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
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
    });

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

    const result = parseResult(content);
    return jsonResponse(result, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected server error.";
    console.error("generate-competencies:", e);
    return jsonResponse({ error: msg }, 500);
  }
});
