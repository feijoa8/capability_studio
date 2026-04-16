import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CompetencyDraft = {
  name: string;
  description?: string;
};

type SubjectDraft = {
  name: string;
  description?: string;
  competencies: CompetencyDraft[];
};

type PracticeDraft = {
  name: string;
  description?: string;
  subjects: SubjectDraft[];
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Expects Practice → Subject → Competency semantics per Capability Studio rules; shape unchanged.
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
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!name) continue;
    const description =
      typeof row.description === "string" ? row.description.trim() : undefined;
    const subjectsRaw = row.subjects;
    const subjects: SubjectDraft[] = [];
    if (Array.isArray(subjectsRaw)) {
      for (const s of subjectsRaw) {
        if (!s || typeof s !== "object") continue;
        const sr = s as Record<string, unknown>;
        const sn = typeof sr.name === "string" ? sr.name.trim() : "";
        if (!sn) continue;
        const sd =
          typeof sr.description === "string" ? sr.description.trim() : undefined;
        const compRaw = sr.competencies;
        const competencies: CompetencyDraft[] = [];
        if (Array.isArray(compRaw)) {
          for (const c of compRaw) {
            if (!c || typeof c !== "object") continue;
            const cr = c as Record<string, unknown>;
            const cn = typeof cr.name === "string" ? cr.name.trim() : "";
            if (!cn) continue;
            const cd =
              typeof cr.description === "string"
                ? cr.description.trim()
                : undefined;
            competencies.push({
              name: cn,
              description: cd,
            });
          }
        }
        subjects.push({
          name: sn,
          description: sd,
          competencies,
        });
      }
    }
    practices.push({ name, description, subjects });
  }
  if (practices.length === 0) {
    throw new Error("AI returned no practices.");
  }
  return { practices };
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
    console.error("generate-hierarchy-from-prompt: OPENAI_API_KEY is not set");
    return jsonResponse(
      {
        error:
          "Server configuration error: OpenAI is not configured. Set OPENAI_API_KEY for this project.",
      },
      500,
    );
  }

  const model = Deno.env.get("OPENAI_MODEL")?.trim() || "gpt-4o-mini";

  let prompt: string;
  let taxonomyAnchors: Record<string, unknown> | null = null;
  try {
    const text = await req.text();
    if (!text.trim()) {
      return jsonResponse({ error: "Empty request body." }, 400);
    }
    const body = JSON.parse(text) as Record<string, unknown>;
    const p = body.prompt;
    prompt = typeof p === "string" ? p.trim() : "";
    if (!prompt) {
      return jsonResponse({ error: "Missing or empty prompt." }, 400);
    }
    const ta = body.taxonomyAnchors;
    if (ta !== undefined && ta !== null && typeof ta === "object" && !Array.isArray(ta)) {
      taxonomyAnchors = ta as Record<string, unknown>;
    }
  } catch (e) {
    const msg =
      e instanceof SyntaxError
        ? "Invalid JSON body."
        : e instanceof Error
          ? e.message
        : "Invalid request body.";
    return jsonResponse({ error: msg }, 400);
  }

  const system = `You generate JSON for **Capability Studio**, a capability development tool—not a generic consulting taxonomy. Hierarchy is always:

**Practice → Subjects → Competencies**

**Practice (top level):** High-level **disciplines**, professional **functions**, or **ways of working**.
Good examples: Agile Delivery, Business Analysis, Product Management, Service Design, Project Delivery, Change Management, Engineering, Data Practice.
Bad as Practices (usually put these under a discipline as **Subjects**): Risk Management, Compliance, Customer Experience, Data Governance, Digital Banking, Financial Products, Technology Integration.

**Subject:** Domains, focus areas, or bodies of work **within** a Practice.
Good examples: Customer Experience, Risk Management, Regulatory Compliance, Data Governance, Product Discovery, Stakeholder Engagement, Requirements Management, Service Blueprinting.

**Competency:** Reusable skills/capabilities for job profiles and development—not one-off tasks or projects.
Good examples: Journey Mapping, Stakeholder Management, Risk Assessment, Requirements Elicitation, Process Modelling, Backlog Prioritisation, Service Prototyping.

**Correct structure (examples):**
- Practice: Business Analysis → Subject: Requirements Management → Competency: Requirements Elicitation
- Practice: Service Design → Subject: Customer Experience → Competency: Journey Mapping

**Incorrect (do not do this):** Top-level Practice named "Customer Experience", "Risk Management", or "Compliance"—these should almost always be **Subjects** under an appropriate discipline.

**Rules:**
- Prefer **fewer, stronger** Practices and **more specific** Subjects under them.
- Avoid domain-specific Practices unless they are genuinely top-level disciplines.
- Competencies must be **reusable developmental capabilities**, not tasks, projects, or deliverables.
- **3–6 Practices** maximum in a full response; **3–6 Subjects** per Practice; **3–6 Competencies** per Subject.
- Narrow user requests: prefer **one** justified Practice (or fit content under **one** discipline with rich Subjects) rather than many thin Practices—do not pad with filler practices.
- Names concise and professional; no duplicates or near-duplicates within the output.
- **Taxonomy governance:** if the user lists protected or settled anchors, do **not** propose replacements, merges, or near-duplicate alternatives that undermine those names.

Return JSON only with EXACTLY this shape (no markdown fences):
{
  "practices": [
    {
      "name": "string",
      "description": "string (optional)",
      "subjects": [
        {
          "name": "string",
          "description": "string (optional)",
          "competencies": [
            { "name": "string", "description": "string (optional)" }
          ]
        }
      ]
    }
  ]
}`;

  function formatTaxonomyAnchors(ta: Record<string, unknown> | null): string {
    if (!ta) return "";
    const lines: string[] = [];
    const take = (key: string): string[] => {
      const v = ta[key];
      return Array.isArray(v)
        ? v.map((x) => String(x).trim()).filter(Boolean)
        : [];
    };
    const ps = take("protectedSubjectNames");
    const ss = take("settledSubjectNames");
    const pc = take("protectedCapabilityAreaNames");
    const sc = take("settledCapabilityAreaNames");
    const pp = take("protectedPracticeNames");
    const spr = take("settledPracticeNames");
    if (ps.length) {
      lines.push(
        `Protected subjects (fixed): ${ps.join(", ")}`,
      );
    }
    if (ss.length) {
      lines.push(`Settled subjects (stable): ${ss.join(", ")}`);
    }
    if (pc.length) {
      lines.push(
        `Protected capability areas (fixed names): ${pc.join(", ")}`,
      );
    }
    if (sc.length) {
      lines.push(`Settled capability areas (preferred anchors): ${sc.join(", ")}`);
    }
    if (pp.length) {
      lines.push(`Protected practices (fixed): ${pp.join(", ")}`);
    }
    if (spr.length) {
      lines.push(`Settled practices (stable): ${spr.join(", ")}`);
    }
    if (lines.length === 0) return "";
    return `

## Taxonomy anchors (governance — do not undermine or duplicate)
${lines.join("\n")}
`;
  }

  const user = `## User request
${prompt}
${formatTaxonomyAnchors(taxonomyAnchors)}
## Scope
- **Narrow requests** (e.g. one new function or domain): prefer **at most 1–2** discipline-level Practices, with **3–6 Subjects** under each and **3–6 Competencies** per Subject where relevant—or **one** Practice with rich Subjects. Do not invent unrelated top-level Practices.
- **Broader requests:** at most **6** Practices total; each Practice **3–6 Subjects**; each Subject **3–6 Competencies**. Keep Competencies as reusable skills, not tasks.`;

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
      console.error(
        "generate-hierarchy-from-prompt: OpenAI error",
        openaiRes.status,
        detail,
      );
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
    console.error("generate-hierarchy-from-prompt:", e);
    return jsonResponse({ error: msg }, 500);
  }
});
