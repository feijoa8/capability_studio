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
};

/** Subject anchor for taxonomy (existing rows only; no creation). */
type SubjectAnchorInput = {
  id: string;
  name: string;
  description: string | null;
  governance_status?: string | null;
  capability_area_name: string | null;
  capability_area_governance?: string | null;
};

type CompetencyInput = {
  id: string;
  name: string;
  description: string | null;
  competency_type?: string | null;
};

type SuggestionOut = {
  competency_id: string;
  suggested_subject_name: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  duplicate_or_merge_note: string | null;
  may_be_subject_instead: boolean;
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
  subjectAnchors: SubjectAnchorInput[],
  competencies: CompetencyInput[],
): string {
  const cp = companyProfile;
  const orgBlock = cp
    ? [
        nonEmpty(cp.organisation_name) &&
          `Organisation: ${cp.organisation_name}`,
        nonEmpty(cp.sector) && `Sector: ${cp.sector}`,
        nonEmpty(cp.industry) && `Industry: ${cp.industry}`,
        nonEmpty(cp.summary) && `Summary: ${cp.summary}`,
      ]
        .filter(Boolean)
        .join("\n")
    : "(No organisation profile.)";

  const subjLines = subjectAnchors.map((s) => {
    const d = s.description?.trim()
      ? ` — ${s.description.trim().slice(0, 400)}`
      : "";
    const g = (s.governance_status ?? "draft").trim().toLowerCase();
    const govTag =
      g === "protected"
        ? " [SUBJECT PROTECTED — strong anchor; prefer when fit is plausible]"
        : g === "settled"
          ? " [SUBJECT SETTLED — stable anchor; prefer over inventing new groupings]"
          : "";
    const cap = s.capability_area_name?.trim()
      ? ` | Capability area: ${s.capability_area_name.trim()}`
      : " | Capability area: (unassigned)";
    const capG = s.capability_area_governance
      ? ` (area ${governanceLabel(s.capability_area_governance)})`
      : "";
    return `- id=${s.id} | ${s.name.trim()}${d}${govTag}${cap}${capG}`;
  });

  const compLines = competencies.map((c) => {
    const d = c.description?.trim()
      ? ` — ${c.description.trim().slice(0, 400)}`
      : "";
    const t = c.competency_type?.trim()
      ? ` | type=${c.competency_type.trim()}`
      : "";
    return `- id=${c.id} | ${c.name.trim()}${d}${t}`;
  });

  return `## Context
${orgBlock}

## Existing subjects (reuse only — do not invent new subjects)
${subjLines.length > 0 ? subjLines.join("\n") : "(No subjects — cannot assign.)"}

## Competencies without a subject (assign each to exactly one subject above)
${compLines.join("\n")}

## Task
For **each** competency id, assign the **single best-fitting** existing subject by **exact subject name** from the list.

Rules:
1. **suggested_subject_name** must match **exactly** one **name** from the subject list (same spelling as shown after the pipe).
2. **confidence**: high / medium / low.
3. **reason**: one short sentence (max 220 chars).
4. **duplicate_or_merge_note**: optional — if another competency or subject name is very similar; do **not** instruct deletion or merge in this workflow.
5. **may_be_subject_instead**: true if the competency name reads like a **domain** or **discipline** better suited as a Subject than a Competency.

Prefer **settled** and **protected** subjects when they fit; use **capability area** as context only.

Return JSON only with EXACTLY this shape:
{
  "suggestions": [
    {
      "competency_id": "uuid from input",
      "suggested_subject_name": "string (must match a listed subject name)",
      "confidence": "high",
      "reason": "string",
      "duplicate_or_merge_note": "string or null",
      "may_be_subject_instead": false
    }
  ]
}

No markdown fences.`;
}

function governanceLabel(v: string | null | undefined): string {
  const t = (v ?? "").trim().toLowerCase();
  if (t === "protected") return "protected";
  if (t === "settled") return "settled";
  return "draft";
}

function parseResult(
  content: string,
  expectedCompetencyIds: Set<string>,
): { suggestions: SuggestionOut[] } {
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
  const raw = o.suggestions;
  if (!Array.isArray(raw)) {
    throw new Error("AI response missing suggestions array.");
  }
  const suggestions: SuggestionOut[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const competency_id =
      typeof row.competency_id === "string" ? row.competency_id.trim() : "";
    if (!competency_id || !expectedCompetencyIds.has(competency_id)) continue;
    if (seen.has(competency_id)) continue;
    seen.add(competency_id);
    const suggested_subject_name =
      typeof row.suggested_subject_name === "string"
        ? row.suggested_subject_name.trim()
        : "";
    const confRaw =
      typeof row.confidence === "string"
        ? row.confidence.trim().toLowerCase()
        : "";
    const confidence: "high" | "medium" | "low" =
      confRaw === "high" || confRaw === "low" ? confRaw : "medium";
    const reason =
      typeof row.reason === "string" ? row.reason.trim().slice(0, 400) : "";
    let duplicate_or_merge_note: string | null = null;
    if (row.duplicate_or_merge_note != null) {
      const c = String(row.duplicate_or_merge_note).trim();
      duplicate_or_merge_note = c ? c.slice(0, 400) : null;
    }
    const may_be_subject_instead = row.may_be_subject_instead === true;
    if (!suggested_subject_name || !reason) continue;
    suggestions.push({
      competency_id,
      suggested_subject_name,
      confidence,
      reason,
      duplicate_or_merge_note,
      may_be_subject_instead,
    });
  }
  return { suggestions };
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
      500,
    );
  }

  const model = Deno.env.get("OPENAI_MODEL")?.trim() || "gpt-4o-mini";

  let body: {
    companyProfile?: CompanyProfileInput | null;
    subjectAnchors?: SubjectAnchorInput[];
    competencies?: CompetencyInput[];
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

  const companyProfile =
    body.companyProfile &&
    typeof body.companyProfile === "object" &&
    !Array.isArray(body.companyProfile)
      ? (body.companyProfile as CompanyProfileInput)
      : null;

  const subjectAnchors: SubjectAnchorInput[] = [];
  const rawAnchors = body.subjectAnchors;
  if (Array.isArray(rawAnchors)) {
    for (const a of rawAnchors) {
      if (!a || typeof a !== "object") continue;
      const o = a as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id.trim() : "";
      const name = typeof o.name === "string" ? o.name.trim() : "";
      if (!id || !name) continue;
      const description =
        o.description === undefined || o.description === null
          ? null
          : String(o.description).trim() || null;
      const governance_status =
        o.governance_status !== undefined && o.governance_status !== null
          ? String(o.governance_status).trim() || null
          : null;
      const capability_area_name =
        o.capability_area_name !== undefined && o.capability_area_name !== null
          ? String(o.capability_area_name).trim() || null
          : null;
      const capability_area_governance =
        o.capability_area_governance !== undefined &&
        o.capability_area_governance !== null
          ? String(o.capability_area_governance).trim() || null
          : null;
      subjectAnchors.push({
        id,
        name,
        description,
        governance_status,
        capability_area_name,
        capability_area_governance,
      });
    }
  }

  const competencies: CompetencyInput[] = [];
  const rawComp = body.competencies;
  if (Array.isArray(rawComp)) {
    for (const c of rawComp) {
      if (!c || typeof c !== "object") continue;
      const o = c as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id.trim() : "";
      const name = typeof o.name === "string" ? o.name.trim() : "";
      if (!id || !name) continue;
      const description =
        o.description === undefined || o.description === null
          ? null
          : String(o.description).trim() || null;
      const competency_type =
        o.competency_type !== undefined && o.competency_type !== null
          ? String(o.competency_type).trim() || null
          : null;
      competencies.push({ id, name, description, competency_type });
    }
  }

  if (subjectAnchors.length === 0) {
    return jsonResponse(
      { error: "At least one subject anchor is required." },
      400,
    );
  }

  if (competencies.length === 0) {
    return jsonResponse(
      { error: "At least one competency is required." },
      400,
    );
  }

  const expectedCompetencyIds = new Set(competencies.map((c) => c.id));

  const system = `You assign **unassigned competencies** to **existing subjects** in Capability Studio.

Rules:
• Output **only** valid JSON matching the user's schema.
• **Reuse** existing subjects only — never invent new subject names that are not in the input list.
• **Capability areas** are context only; competencies attach to **Subjects**.
• Prefer **settled** and **protected** subjects when semantically appropriate.
• Do **not** merge or delete rows; notes only in duplicate_or_merge_note.

No markdown fences.`;

  const user = buildUserPrompt(companyProfile, subjectAnchors, competencies);

  try {
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
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

    const parsed = parseResult(content, expectedCompetencyIds);

    const byId = new Map(parsed.suggestions.map((s) => [s.competency_id, s]));
    const out: SuggestionOut[] = [];
    const firstSubjectName = subjectAnchors[0]!.name.trim();
    for (const c of competencies) {
      const existing = byId.get(c.id);
      if (existing) {
        out.push(existing);
        continue;
      }
      out.push({
        competency_id: c.id,
        suggested_subject_name: firstSubjectName,
        confidence: "low",
        reason: "Model omitted this row; pick a subject manually.",
        duplicate_or_merge_note: null,
        may_be_subject_instead: false,
      });
    }

    return jsonResponse({ suggestions: out }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected server error.";
    console.error("refine-unassigned-competencies:", e);
    return jsonResponse({ error: msg }, 500);
  }
});
