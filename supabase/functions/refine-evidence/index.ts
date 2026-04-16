import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LOG = "refine-evidence";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asStr(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") {
    const t = v.trim();
    return t.length ? t : null;
  }
  return null;
}

function asStrArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = asStr(x);
    if (s) out.push(s);
  }
  return out;
}

function asFollowUps(v: unknown): Array<{
  id: string;
  question: string;
  optional: boolean;
}> {
  if (!Array.isArray(v)) return [];
  const out: Array<{ id: string; question: string; optional: boolean }> = [];
  let i = 0;
  for (const item of v) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const q = asStr(o.question);
    if (!q) continue;
    i += 1;
    out.push({
      id: asStr(o.id) ?? `q${i}`,
      question: q,
      optional: typeof o.optional === "boolean" ? o.optional : true,
    });
  }
  return out.slice(0, 5);
}

function normalizeSuggestion(
  raw: unknown,
  entityId: string,
): {
  ok: true; suggestion: Record<string, unknown>;
} | { ok: false; message: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "Model returned non-object JSON." };
  }
  const o = raw as Record<string, unknown>;
  return {
    ok: true,
    suggestion: {
      schemaVersion: 1,
      mode: o.mode ?? "refine_experience",
      entityType: o.entityType ?? "work_experience",
      entityId: asStr(o.entityId) ?? entityId,
      suggestedDescription: asStr(o.suggestedDescription),
      suggestedSkills: asStrArray(o.suggestedSkills),
      suggestedMethods: asStrArray(o.suggestedMethods),
      suggestedTools: asStrArray(o.suggestedTools),
      suggestedIndustry: o.suggestedIndustry === null
        ? null
        : asStr(o.suggestedIndustry),
      followUpQuestions: asFollowUps(o.followUpQuestions),
      rationale: asStr(o.rationale),
      categoryConfidence:
        o.categoryConfidence &&
          typeof o.categoryConfidence === "object" &&
          !Array.isArray(o.categoryConfidence)
          ? o.categoryConfidence
          : null,
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim();
  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse({ error: "Supabase is not configured." }, 500);
  }
  if (!apiKey) {
    return jsonResponse(
      {
        error:
          "OpenAI is not configured. Set OPENAI_API_KEY for this project.",
      },
      500,
    );
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Missing or invalid Authorization header." }, 401);
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Expected JSON body." }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const ctx = (body as Record<string, unknown>).context;
  if (!ctx || typeof ctx !== "object" || Array.isArray(ctx)) {
    return jsonResponse({ error: "Missing context object." }, 400);
  }

  const context = ctx as Record<string, unknown>;
  const schemaVersion = context.schemaVersion;
  if (schemaVersion !== 1) {
    return jsonResponse({ error: "Unsupported context schemaVersion." }, 400);
  }

  const mode = context.mode;
  const entityId = asStr(context.entityId);
  const entityType = asStr(context.entityType);

  if (
    mode !== "refine_experience" && mode !== "derive_tags"
  ) {
    return jsonResponse({ error: "Unsupported refinement mode." }, 400);
  }
  if (entityType !== "work_experience" || !entityId) {
    return jsonResponse({ error: "Invalid entity for refinement." }, 400);
  }

  const payload = context.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return jsonResponse({ error: "Missing payload." }, 400);
  }

  const { data: row, error: rowErr } = await userClient
    .from("user_experience")
    .select("id")
    .eq("id", entityId)
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (rowErr) {
    console.error(`${LOG}: row lookup`, rowErr.message);
    return jsonResponse({ error: "Could not verify experience row." }, 403);
  }
  if (!row) {
    return jsonResponse({ error: "Experience not found." }, 404);
  }

  const model = Deno.env.get("OPENAI_MODEL")?.trim() || "gpt-4o-mini";

  const system = `You are an expert career evidence assistant for Capability Studio. You receive ONE work experience context as JSON (role, organisation, description, skills, methods, tools, industry, related project snippets). You must return ONLY valid JSON (no markdown), matching this exact shape:

{
  "schemaVersion": 1,
  "mode": "refine_experience",
  "entityType": "work_experience",
  "entityId": "<same as input entityId>",
  "suggestedDescription": string | null,
  "suggestedSkills": string[],
  "suggestedMethods": string[],
  "suggestedTools": string[],
  "suggestedIndustry": string | null,
  "followUpQuestions": [ { "id": string, "question": string, "optional": boolean } ],
  "rationale": string | null,
  "categoryConfidence": { "skills"?: "low"|"medium"|"high", "methods"?: "...", "tools"?: "...", "industry"?: "...", "summary"?: "..." } | null
}

Rules:
1) TRUTHFULNESS: Do not invent employers, dates, clients, or achievements. Only clarify and sharpen wording using information implied or stated in the input. If the description is empty, produce a cautious summary only from title, organisation, and tags/projects—or set suggestedDescription to null and add followUpQuestions.
2) DESCRIPTION: suggestedDescription should be CV-ready: clear bullets or short paragraphs, concrete outcomes where the text supports them. No bloated corporate filler. Preserve meaning; do not change job facts.
3) TAGS — four categories:
   - suggestedSkills: execution-level capabilities (e.g. "Requirements Definition", "Customer Journey Mapping", "Stakeholder Workshop Facilitation"). NOT broad umbrellas like "Business Analysis", "Consulting", "Product Management" as skills. NOT vague soft skills: "Communication", "Leadership", "Teamwork".
   - suggestedMethods: named ways of working (Scrum, Kanban, Agile, Design Thinking, Lean Six Sigma).
   - suggestedTools: named software/platforms ONLY (Jira, Azure DevOps, Miro, Salesforce). Do not put prose like "Engagement With Marketing Teams" in tools—omit or move to rationale. Do not infer tools without reasonable evidence in the text.
   - suggestedIndustry: one concise sector/domain string when supported by organisation/role/projects (e.g. Telecommunications, Insurance); else null.
4) Build on existing tags in the input; improve specificity and remove noise. Deduplicate case-insensitively.
5) followUpQuestions: 0–3 short questions ONLY if evidence is weak or ambiguous; each optional:true unless you need one critical clarification. Empty array if not needed.
6) rationale: one short paragraph on what you changed and why (or null).
7) Arrays may be empty only if you have nothing to add; prefer enriching weak rows when the text allows.`;

  const userPrompt = `Refine this work experience context. Return JSON only.\n\n${JSON.stringify(ctx)}`;

  try {
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.25,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    const rawText = await openaiRes.text();
    if (!openaiRes.ok) {
      let detail = rawText || `${openaiRes.status}`;
      try {
        const errJson = JSON.parse(rawText) as {
          error?: { message?: string };
        };
        if (errJson.error?.message) detail = errJson.error.message;
      } catch {
        /* keep */
      }
      console.error(`${LOG}: OpenAI HTTP`, detail.slice(0, 200));
      return jsonResponse({ error: `OpenAI request failed: ${detail}` }, 502);
    }

    let completion: {
      choices?: { message?: { content?: unknown } }[];
    };
    try {
      completion = JSON.parse(rawText) as {
        choices?: { message?: { content?: unknown } }[];
      };
    } catch {
      return jsonResponse({ error: "OpenAI response was not valid JSON." }, 502);
    }

    const content = completion.choices?.[0]?.message?.content;
    const text =
      typeof content === "string"
        ? content.trim()
        : "";
    if (!text) {
      return jsonResponse({ error: "OpenAI returned empty content." }, 502);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return jsonResponse(
        { error: "Model output was not valid JSON." },
        502,
      );
    }

    const normalized = normalizeSuggestion(parsed, entityId);
    if (!normalized.ok) {
      return jsonResponse({ error: normalized.message }, 502);
    }

    const hasContent =
      (normalized.suggestion.suggestedDescription != null &&
        String(normalized.suggestion.suggestedDescription).trim().length > 0) ||
      (Array.isArray(normalized.suggestion.suggestedSkills) &&
        (normalized.suggestion.suggestedSkills as string[]).length > 0) ||
      (Array.isArray(normalized.suggestion.suggestedMethods) &&
        (normalized.suggestion.suggestedMethods as string[]).length > 0) ||
      (Array.isArray(normalized.suggestion.suggestedTools) &&
        (normalized.suggestion.suggestedTools as string[]).length > 0) ||
      (normalized.suggestion.suggestedIndustry != null &&
        String(normalized.suggestion.suggestedIndustry).trim().length > 0);

    if (!hasContent) {
      return jsonResponse({
        suggestion: {
          ...normalized.suggestion,
          rationale:
            (normalized.suggestion.rationale as string | null) ??
            "No strong refinements could be proposed from the current evidence. Add more detail to the role description or tags, then try again.",
        },
      });
    }

    return jsonResponse({ suggestion: normalized.suggestion });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${LOG}: error`, msg.slice(0, 200));
    return jsonResponse(
      { error: "Refinement failed on the server. Please try again." },
      500,
    );
  }
});
