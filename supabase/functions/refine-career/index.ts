import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LOG = "refine-career";

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

function asStrArray(v: unknown, max = 20): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = asStr(x);
    if (s) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

type FocusArea = {
  title: string;
  description: string;
  rationale: string;
  related_signals: {
    skills?: string[];
    methods?: string[];
    tools?: string[];
    industries?: string[];
  };
  confidence?: number;
};

function normalizeSuggestion(raw: unknown): { ok: true; suggestion: unknown } | { ok: false; message: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "Model returned non-object JSON." };
  }
  const o = raw as Record<string, unknown>;
  const focusRaw = o.focus_areas;
  const focusAreas: FocusArea[] = [];
  if (Array.isArray(focusRaw)) {
    for (const item of focusRaw) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const it = item as Record<string, unknown>;
      const title = asStr(it.title);
      const description = asStr(it.description);
      const rationale = asStr(it.rationale);
      if (!title || !description || !rationale) continue;
      const rel = it.related_signals;
      const related =
        rel && typeof rel === "object" && !Array.isArray(rel)
          ? (rel as Record<string, unknown>)
          : {};
      const confidence =
        typeof it.confidence === "number" ? clamp01(it.confidence) : undefined;
      focusAreas.push({
        title,
        description,
        rationale,
        related_signals: {
          skills: asStrArray(related.skills, 12),
          methods: asStrArray(related.methods, 12),
          tools: asStrArray(related.tools, 12),
          industries: asStrArray(related.industries, 10),
        },
        confidence,
      });
      if (focusAreas.length >= 6) break;
    }
  }

  const followUps = asStrArray(o.follow_ups, 5);

  return {
    ok: true,
    suggestion: {
      focus_areas: focusAreas,
      follow_ups: followUps.length ? followUps : undefined,
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
      { error: "OpenAI is not configured. Set OPENAI_API_KEY for this project." },
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
  if (context.schemaVersion !== 1) {
    return jsonResponse({ error: "Unsupported context schemaVersion." }, 400);
  }
  if (asStr(context.entityType) !== "career_plan") {
    return jsonResponse({ error: "Invalid entity for refinement." }, 400);
  }
  const payload = context.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return jsonResponse({ error: "Missing payload." }, 400);
  }

  const model = Deno.env.get("OPENAI_MODEL")?.trim() || "gpt-4o-mini";

  const system = `You are the AI Career Coach for Capability Studio.\n\nYou receive ONE bounded career context JSON. You must return ONLY valid JSON (no markdown) matching this exact shape:\n\n{\n  \"focus_areas\": [\n    {\n      \"title\": string,\n      \"description\": string,\n      \"rationale\": string,\n      \"related_signals\": {\n        \"skills\"?: string[],\n        \"methods\"?: string[],\n        \"tools\"?: string[],\n        \"industries\"?: string[]\n      },\n      \"confidence\"?: number\n    }\n  ],\n  \"follow_ups\"?: string[]\n}\n\nRules:\n1) Grounding: Every focus area MUST be grounded in the provided evidence snapshot and/or the user's stated career vision/notes. Do not invent experience.\n2) Output: Propose 3–6 focus areas max. Each must be specific and actionable (a theme the user could work on), not vague traits. Avoid generic advice like \"communication\" unless you tie it to concrete context (e.g. stakeholder facilitation in delivery settings).\n3) Evidence alignment: Prefer themes that connect (a) aspirations (next/future roles) with (b) gaps and repeated signals.\n4) related_signals: Include only items present in the context (top skills/methods/tools/industries). Keep lists short (<=8).\n5) confidence: Optional number 0..1 representing how strongly the evidence supports the suggestion.\n6) follow_ups: 0–5 short questions only if needed to disambiguate direction or strengthen weak evidence.\n7) Tone: Professional, direct. No fluff, no motivational prose.`;

  const userPrompt = `Generate focus areas from this career context. Return JSON only.\n\n${JSON.stringify(ctx)}`;

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
        const errJson = JSON.parse(rawText) as { error?: { message?: string } };
        if (errJson.error?.message) detail = errJson.error.message;
      } catch {
        /* keep */
      }
      console.error(`${LOG}: OpenAI HTTP`, detail.slice(0, 200));
      return jsonResponse({ error: `OpenAI request failed: ${detail}` }, 502);
    }

    let completion: { choices?: { message?: { content?: unknown } }[] };
    try {
      completion = JSON.parse(rawText) as { choices?: { message?: { content?: unknown } }[] };
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
      return jsonResponse({ error: "Model output was not valid JSON." }, 502);
    }

    const normalized = normalizeSuggestion(parsed);
    if (!normalized.ok) {
      return jsonResponse({ error: normalized.message }, 502);
    }

    return jsonResponse({ suggestion: normalized.suggestion });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${LOG}: error`, msg.slice(0, 200));
    return jsonResponse(
      { error: "Career coach failed on the server. Please try again." },
      500,
    );
  }
});

