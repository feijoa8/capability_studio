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

type SubjectDraft = {
  name: string;
  description: string;
  category: string | null;
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

function anchorBlock(
  settledSubjectNames: string[],
  protectedSubjectNames: string[],
): string {
  const lines: string[] = [];
  if (protectedSubjectNames.length > 0) {
    lines.push(
      `**Protected** subject names (fixed — do not duplicate, replace, or propose alternatives that undermine these): ${protectedSubjectNames.join(", ")}`
    );
  }
  if (settledSubjectNames.length > 0) {
    lines.push(
      `**Settled** subject names (stable anchors — prefer mapping new work to distinct new names; avoid near-duplicates): ${settledSubjectNames.join(", ")}`
    );
  }
  if (lines.length === 0) return "";
  return `

## Taxonomy governance (subjects)
${lines.join("\n")}
`;
}

function buildPracticeUserPrompt(
  companyProfile: CompanyProfileInput | null,
  practiceName: string,
  practiceDescription: string | null,
  existingSubjectNames: string[],
  settledSubjectNames: string[],
  protectedSubjectNames: string[],
): string {
  const cp = companyProfile;
  const orgBlock = cp
    ? [
        nonEmpty(cp.organisation_name) &&
          `Organisation name: ${cp.organisation_name}`,
        nonEmpty(cp.sector) && `Sector: ${cp.sector}`,
        nonEmpty(cp.industry) && `Industry: ${cp.industry}`,
        nonEmpty(cp.summary) && `Summary: ${cp.summary}`,
        nonEmpty(cp.delivery_context) && `Delivery context: ${cp.delivery_context}`,
        nonEmpty(cp.capability_emphasis) && `Capability emphasis: ${cp.capability_emphasis}`,
      ]
        .filter(Boolean)
        .join("\n")
    : "(No organisation profile — infer from the practice only.)";

  const existing =
    existingSubjectNames.length > 0
      ? `Already used in this practice (do not duplicate or trivially rename): ${existingSubjectNames.join(", ")}`
      : "(No existing subjects in this practice yet.)";

  const pd = practiceDescription?.trim()
    ? practiceDescription.trim()
    : "(No practice description provided.)";

  return `## Organisation context (optional)
${orgBlock}

## INPUT
Practice: ${practiceName}
Description: ${pd}

## Existing subjects
${existing}

## Task
Generate **3–6 subjects** for the practice above. Apply every rule from the system message: capability areas within this discipline only, mutually distinct, concise names (2–4 words), short descriptions.

Optional **category** per subject (short navigation label) when helpful; otherwise null.
${anchorBlock(settledSubjectNames, protectedSubjectNames)}
Return JSON only with EXACTLY this shape:
{
  "subjects": [
    { "name": "string", "description": "string", "category": "string or null" }
  ]
}

No markdown fences.`;
}

function buildOrganisationUserPrompt(
  companyProfile: CompanyProfileInput | null,
  existingSubjectNames: string[],
  settledSubjectNames: string[],
  protectedSubjectNames: string[],
): string {
  const cp = companyProfile;
  const orgBlock = cp
    ? [
        nonEmpty(cp.organisation_name) &&
          `Organisation name: ${cp.organisation_name}`,
        nonEmpty(cp.sector) && `Sector: ${cp.sector}`,
        nonEmpty(cp.industry) && `Industry: ${cp.industry}`,
        nonEmpty(cp.summary) && `Summary: ${cp.summary}`,
        nonEmpty(cp.business_purpose) && `Business purpose: ${cp.business_purpose}`,
        nonEmpty(cp.strategic_priorities) &&
          `Strategic priorities: ${cp.strategic_priorities}`,
        nonEmpty(cp.delivery_context) && `Delivery context: ${cp.delivery_context}`,
        nonEmpty(cp.capability_emphasis) && `Capability emphasis: ${cp.capability_emphasis}`,
      ]
        .filter(Boolean)
        .join("\n")
    : "(No organisation profile — infer sensible company-wide capability areas from general knowledge.)";

  const existing =
    existingSubjectNames.length > 0
      ? `Already used as organisation subject names (do not duplicate or trivially rename): ${existingSubjectNames.join(", ")}`
      : "(No existing organisation subjects yet.)";

  return `## Organisation (company-wide) context
${orgBlock}

## Existing organisation subjects
${existing}

## Task
Generate **3–6 subjects** for **organisation-wide organisational capabilities** — cross-cutting capability **areas** that apply across the company (not tied to a single professional discipline/practice).

Good examples of **grain** (names may vary): Communication, Privacy, Health & Safety, Culture, Compliance, Ethics, Information Security, Diversity & Inclusion.

Rules:
• Mutually distinct areas; concise names (2–4 words); short descriptions.
• Do **not** output generic practices/disciplines as if they were subjects (e.g. "Agile Delivery" as a whole practice).
• Do **not** output tools or one-off tasks.

Optional **category** per subject when helpful; otherwise null.
${anchorBlock(settledSubjectNames, protectedSubjectNames)}
Return JSON only with EXACTLY this shape:
{
  "subjects": [
    { "name": "string", "description": "string", "category": "string or null" }
  ]
}

No markdown fences.`;
}

/**
 * Post-generation governance: subject naming / deduplication is handled by a separate
 * review step — Edge Function `normalise-subject-taxonomy` (optional UI: "Refine subject names").
 * Do not auto-invoke it from here until product explicitly enables that flow.
 */
// Subjects = capability areas within the given practice; category optional for UI.
function parseResult(content: string): { subjects: SubjectDraft[] } {
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
  const arr = o.subjects;
  if (!Array.isArray(arr)) {
    throw new Error("AI response missing subjects array.");
  }
  const subjects: SubjectDraft[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const description =
      typeof row.description === "string" ? row.description.trim() : "";
    let category: string | null = null;
    if (row.category !== undefined && row.category !== null) {
      const c = String(row.category).trim();
      category = c ? c : null;
    }
    if (name) subjects.push({ name, description, category });
  }
  if (subjects.length === 0) {
    throw new Error("AI returned no subjects.");
  }
  return { subjects };
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
    practiceName?: string;
    practiceDescription?: string | null;
    organisationContext?: boolean;
    existingSubjectNames?: string[];
    settledSubjectNames?: string[];
    protectedSubjectNames?: string[];
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

  const organisationContext = body.organisationContext === true;

  const practiceName = String(body.practiceName ?? "").trim();
  if (!organisationContext && !practiceName) {
    return jsonResponse(
      {
        error:
          "practiceName is required unless organisationContext is true.",
      },
      400
    );
  }

  const practiceDescription =
    body.practiceDescription === undefined || body.practiceDescription === null
      ? null
      : String(body.practiceDescription).trim() || null;

  const companyProfile =
    body.companyProfile &&
    typeof body.companyProfile === "object" &&
    !Array.isArray(body.companyProfile)
      ? (body.companyProfile as CompanyProfileInput)
      : null;

  const existingSubjectNames = Array.isArray(body.existingSubjectNames)
    ? body.existingSubjectNames.map((s) => String(s).trim()).filter(Boolean)
    : [];

  const settledSubjectNames = Array.isArray(body.settledSubjectNames)
    ? body.settledSubjectNames.map((s) => String(s).trim()).filter(Boolean)
    : [];
  const protectedSubjectNames = Array.isArray(body.protectedSubjectNames)
    ? body.protectedSubjectNames.map((s) => String(s).trim()).filter(Boolean)
    : [];

  const systemPractice = `You are designing a **Capability Development** model for Capability Studio.

Your task is to generate **SUBJECTS** for a single given **PRACTICE**.

---

DEFINITION

A **SUBJECT** is a capability area within a professional **discipline**.

• **Practice** = discipline (e.g. Business Analysis, Agile Delivery)
• **Subject** = capability area within that discipline
• **Competency** = specific skill within a subject (you do not generate competencies here)

---

RULES

1. Generate **3–6 subjects**.

2. Subjects must:
   • Be **reusable** capability areas
   • Be **commonly recognised** within the discipline
   • Be **stable over time** (not trends or tools)
   • Be **mutually distinct** (no overlap)

3. **DO NOT** generate:
   • Other **practices** as if they were subjects (e.g. treating "Customer Experience" or "Risk Management" as a subject when they are really a different practice/domain)
   • **Tools** (e.g. Jira, Power BI)
   • **Tasks or activities** (e.g. "Writing documents")
   • **Outcomes** (e.g. "Improved customer satisfaction")

4. Keep names **concise (2–4 words)**.

---

GOOD EXAMPLE

Practice: **Business Analysis**

Subjects:
- Requirements Management
- Stakeholder Engagement
- Process Modelling
- Business Case Development
- Data Analysis

---

BAD EXAMPLES (avoid)

- Customer Experience ❌ (often a different practice/domain, not BA-specific)
- Compliance ❌ (broad domain; wrong grain)
- Agile ❌ (that is a practice / discipline name)
- Reporting ❌ (too generic / task-like)

---

You output **only** valid JSON matching the user's schema. No markdown fences.

Taxonomy governance: if the user lists **protected** or **settled** subject names, **do not** duplicate them, rename them, or propose alternatives that replace them.`;

  const systemOrganisation = `You are designing **organisation-wide organisational subjects** for Capability Studio.

These subjects are **company-wide capability areas** (organisation type): cross-cutting themes that apply across roles and practices — not sub-areas of a single professional discipline.

---

DEFINITION

• **Organisation subject** = a reusable capability **area** at company scope (e.g. Communication, Privacy, Health & Safety, Culture, Compliance).
• They are **not** the same as **practice** disciplines (e.g. "Business Analysis" is a practice, not an organisation subject here).
• **Competency** = skill within a subject (you do not generate competencies here).

---

RULES

1. Generate **3–6 subjects**.

2. Subjects must be:
   • **Organisation-wide** and **commonly recognised** in workplaces
   • **Mutually distinct** (no overlap)
   • **Stable** (not one-off projects or tools)

3. **DO NOT** generate:
   • A full **practice** name as a subject (e.g. "Agile Delivery", "Data Science")
   • **Tools** (Jira, Excel)
   • **Job titles** or **projects**

4. Keep names **concise (2–4 words)**.

---

GOOD EXAMPLES (grain)

- Communication
- Privacy & Data Protection
- Health & Safety
- Culture & Engagement
- Compliance & Regulatory
- Ethics & Conduct

---

You output **only** valid JSON matching the user's schema. No markdown fences.

Taxonomy governance: if the user lists **protected** or **settled** subject names, **do not** duplicate them, rename them, or propose alternatives that replace them.`;

  const system = organisationContext ? systemOrganisation : systemPractice;

  const user = organisationContext
    ? buildOrganisationUserPrompt(
        companyProfile,
        existingSubjectNames,
        settledSubjectNames,
        protectedSubjectNames,
      )
    : buildPracticeUserPrompt(
        companyProfile,
        practiceName,
        practiceDescription,
        existingSubjectNames,
        settledSubjectNames,
        protectedSubjectNames,
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
    console.error("generate-subjects:", e);
    return jsonResponse({ error: msg }, 500);
  }
});
