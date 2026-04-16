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

type CapabilityAreaContext = {
  id: string;
  name: string;
  description: string | null;
  governance_status?: string | null;
};

type SubjectContext = {
  id: string;
  name: string;
  description: string | null;
  governance_status?: string | null;
};

type SuggestionOut = {
  subject_id: string;
  suggested_capability_area_name: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  close_variant_or_merge_note: string | null;
  may_be_competency_instead: boolean;
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
  capabilityAreas: CapabilityAreaContext[],
  subjects: SubjectContext[],
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

  const areaLines = capabilityAreas.map((a) => {
    const g = (a.governance_status ?? "draft").trim().toLowerCase();
    const tag =
      g === "protected"
        ? " [PROTECTED — fixed anchor; do not rename or replace]"
        : g === "settled"
          ? " [SETTLED — stable anchor; prefer aligning leftovers here]"
          : "";
    const d = a.description?.trim()
      ? ` — ${a.description.trim().slice(0, 280)}`
      : "";
    return `- ${a.name.trim()}${tag}${d}`;
  });

  const subjLines = subjects.map((s) => {
    const d = s.description?.trim()
      ? ` — ${s.description.trim().slice(0, 400)}`
      : "";
    return `- id=${s.id} | ${s.name.trim()}${d}`;
  });

  return `## Context
${orgBlock}

## Existing capability areas (anchors)
${areaLines.length > 0 ? areaLines.join("\n") : "(None — you may still recommend best-fit names from this list only if empty is impossible.)"}

## Leftover subjects (no capability area assigned yet)
These are the only subjects to analyse. Each must receive exactly one suggestion object.

${subjLines.join("\n")}

## Task
For **each** subject id above, propose the **single best-matching** capability area name from the **Existing capability areas** list.

Rules:
1. **suggested_capability_area_name** must match **exactly** one of the area names from the list (same spelling as listed), unless the list is empty — if empty, use the closest concise area name you would expect (2–5 words).
2. **confidence**: high / medium / low based on fit clarity.
3. **reason**: one short sentence (max 200 chars).
4. **close_variant_or_merge_note**: optional — if another existing subject name is very similar, or a merge might be considered later; otherwise null. Do **not** instruct deletion.
5. **may_be_competency_instead**: true if the name reads like a task, ritual, or granular skill better placed under a subject as a competency.

**Protected** areas are immovable labels. **Settled** areas are preferred targets for alignment.

Return JSON only with EXACTLY this shape:
{
  "suggestions": [
    {
      "subject_id": "uuid from input",
      "suggested_capability_area_name": "string (must match a listed area name when areas exist)",
      "confidence": "high",
      "reason": "string",
      "close_variant_or_merge_note": "string or null",
      "may_be_competency_instead": false
    }
  ]
}

No markdown fences.`;
}

function parseGov(
  v: string | null | undefined,
): "draft" | "settled" | "protected" {
  const t = (v ?? "").trim().toLowerCase();
  if (t === "settled" || t === "protected") return t;
  return "draft";
}

function parseResult(
  content: string,
  expectedSubjectIds: Set<string>,
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
    const subject_id =
      typeof row.subject_id === "string" ? row.subject_id.trim() : "";
    if (!subject_id || !expectedSubjectIds.has(subject_id)) continue;
    if (seen.has(subject_id)) continue;
    seen.add(subject_id);
    const suggested_capability_area_name =
      typeof row.suggested_capability_area_name === "string"
        ? row.suggested_capability_area_name.trim()
        : "";
    const confRaw =
      typeof row.confidence === "string"
        ? row.confidence.trim().toLowerCase()
        : "";
    const confidence: "high" | "medium" | "low" =
      confRaw === "high" || confRaw === "low" ? confRaw : "medium";
    const reason =
      typeof row.reason === "string" ? row.reason.trim().slice(0, 400) : "";
    let close_variant_or_merge_note: string | null = null;
    if (row.close_variant_or_merge_note != null) {
      const c = String(row.close_variant_or_merge_note).trim();
      close_variant_or_merge_note = c ? c.slice(0, 400) : null;
    }
    const may_be_competency_instead = row.may_be_competency_instead === true;
    if (!suggested_capability_area_name || !reason) continue;
    suggestions.push({
      subject_id,
      suggested_capability_area_name,
      confidence,
      reason,
      close_variant_or_merge_note,
      may_be_competency_instead,
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
    capabilityAreas?: CapabilityAreaContext[];
    subjects?: SubjectContext[];
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

  const capabilityAreas: CapabilityAreaContext[] = [];
  const rawAreas = body.capabilityAreas;
  if (Array.isArray(rawAreas)) {
    for (const a of rawAreas) {
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
      capabilityAreas.push({
        id,
        name,
        description,
        governance_status,
      });
    }
  }

  const subjects: SubjectContext[] = [];
  const rawSubj = body.subjects;
  if (Array.isArray(rawSubj)) {
    for (const s of rawSubj) {
      if (!s || typeof s !== "object") continue;
      const o = s as Record<string, unknown>;
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
      if (parseGov(governance_status) === "protected") continue;
      subjects.push({ id, name, description, governance_status });
    }
  }

  if (subjects.length === 0) {
    return jsonResponse(
      { error: "At least one subject is required (non-protected, with id and name)." },
      400,
    );
  }

  const expectedIds = new Set(subjects.map((s) => s.id));

  const system = `You align **unassigned** subjects to existing **capability areas** for Capability Studio.

Rules:
• Output **only** valid JSON matching the user's schema.
• Prefer **existing** capability area names exactly as listed.
• **Protected** capability areas are fixed anchors — never suggest renaming them.
• **Settled** areas are preferred alignment targets.
• Do **not** delete subjects or merge rows — notes only.
• Flag **may_be_competency_instead** when the subject name is activity-like or too granular.

No markdown fences.`;

  const user = buildUserPrompt(companyProfile, capabilityAreas, subjects);

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

    const parsed = parseResult(content, expectedIds);

    /** Ensure every input subject has a suggestion; pad with medium-confidence fallback. */
    const byId = new Map(parsed.suggestions.map((s) => [s.subject_id, s]));
    const out: SuggestionOut[] = [];
    for (const s of subjects) {
      const existing = byId.get(s.id);
      if (existing) {
        out.push(existing);
        continue;
      }
      const fallbackName =
        capabilityAreas.length > 0 ? capabilityAreas[0]!.name.trim() : "General";
      out.push({
        subject_id: s.id,
        suggested_capability_area_name: fallbackName,
        confidence: "low",
        reason: "Model omitted this row; review manually.",
        close_variant_or_merge_note: null,
        may_be_competency_instead: false,
      });
    }

    return jsonResponse({ suggestions: out }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected server error.";
    console.error("refine-leftover-subjects:", e);
    return jsonResponse({ error: msg }, 500);
  }
});
