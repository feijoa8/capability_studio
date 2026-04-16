import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { resolveJobPostingPlainText } from "../_shared/jobPostingSourceResolution.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LOG = "extract-job-posting";

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

function asStrArray(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = asStr(x);
    if (s) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

export type RoleAnalysisExtraction = {
  job_title: string | null;
  company: string | null;
  location: string | null;
  role_summary: string;
  key_competencies: string[];
  skills: string[];
  methods_practices: string[];
  tools_platforms: string[];
  industry_domain: string | null;
  watch_outs: string[];
  questions_to_ask: string[];
  key_role_signals: string[];
};

function normalizeExtraction(
  raw: unknown,
): { ok: true; extraction: RoleAnalysisExtraction } | { ok: false; message: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "Model returned non-object JSON." };
  }
  const o = raw as Record<string, unknown>;
  const role_summary = asStr(o.role_summary);
  if (!role_summary || role_summary.length < 20) {
    return { ok: false, message: "Missing or too-short role_summary in model output." };
  }
  return {
    ok: true,
    extraction: {
      job_title: asStr(o.job_title),
      company: asStr(o.company),
      location: asStr(o.location),
      role_summary,
      key_competencies: asStrArray(o.key_competencies, 16),
      skills: asStrArray(o.skills, 24),
      methods_practices: asStrArray(o.methods_practices, 16),
      tools_platforms: asStrArray(o.tools_platforms, 20),
      industry_domain: asStr(o.industry_domain),
      watch_outs: asStrArray(o.watch_outs, 12),
      questions_to_ask: asStrArray(o.questions_to_ask, 12),
      key_role_signals: asStrArray(o.key_role_signals, 14),
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
  const scrapingBeeKey = Deno.env.get("SCRAPINGBEE_API_KEY")?.trim();
  const internalJobHostsEnv = Deno.env.get("APPLICATION_EVAL_INTERNAL_JOB_HOSTS")?.trim();

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

  const b = body as Record<string, unknown>;
  const raw_description = asStr(b.raw_description);
  const title_hint = asStr(b.title_hint);
  const company_hint = asStr(b.company_hint);
  const source_url = asStr(b.source_url);
  const internal_posting_id = asStr(b.internal_posting_id);

  const resolved = await resolveJobPostingPlainText({
    raw_description: raw_description ?? "",
    source_url,
    internal_posting_id,
    scrapingBeeApiKey: scrapingBeeKey ?? null,
    internalJobHostsEnv,
    userClient,
  });

  if (!resolved.ok) {
    return jsonResponse({ error: resolved.error }, resolved.status);
  }

  const postingTextForAi = resolved.resolved.posting_text;
  const title_hint_final = title_hint;
  const company_hint_final = company_hint;
  const source_url_final =
    resolved.resolved.kind === "external_url"
      ? resolved.resolved.fetched_url ?? source_url
      : source_url;

  const model = Deno.env.get("OPENAI_MODEL")?.trim() || "gpt-4o-mini";

  const shape = `{
  "job_title": string | null,
  "company": string | null,
  "location": string | null,
  "role_summary": string,
  "key_competencies": string[],
  "skills": string[],
  "methods_practices": string[],
  "tools_platforms": string[],
  "industry_domain": string | null,
  "watch_outs": string[],
  "questions_to_ask": string[],
  "key_role_signals": string[]
}`;

  const system =
    `You analyse job postings for Capability Studio users.\n\nReturn ONLY valid JSON (no markdown) matching this shape:\n${shape}\n\nRules:\n` +
    `1) Grounding: Every field MUST be justified by the posting text below. The text may be pasted by the user or retrieved from a job page (HTML stripped) — treat it as the source of truth. Do not invent employers, locations, or tools not implied by the text.\n` +
    `2) Optional user hints (title_hint, company_hint, source_url) may help disambiguate; only use if they clearly align with the posting — otherwise ignore.\n` +
    `3) role_summary: 3–8 sentences, concrete (scope, outcomes, seniority, stakeholders). No generic filler.\n` +
    `4) Lists: specific nouns and phrases from or clearly implied by the posting; dedupe; no padding to hit counts.\n` +
    `5) key_competencies: capability themes (e.g. stakeholder management, technical delivery), not restating job title alone.\n` +
    `6) watch_outs: risks, red flags, or unclear expectations visible in the text (e.g. vague scope, conflicting signals).\n` +
    `7) questions_to_ask: sharp interview/clarification questions tied to gaps or ambiguities in the posting.\n` +
    `8) key_role_signals: short bullets of what makes this role distinctive (level, domain, delivery model, etc.).\n` +
    `9) If the text is not a job description, still return best-effort JSON with watch_outs explaining the issue.\n`;

  const userPayload = JSON.stringify({
    source_resolution: {
      kind: resolved.resolved.kind,
      fetched_url: resolved.resolved.fetched_url,
      internal_posting_id: resolved.resolved.internal_posting_id,
    },
    title_hint: title_hint_final,
    company_hint: company_hint_final,
    source_url: source_url_final,
    posting_text: postingTextForAi,
  });

  const userPrompt = `Analyse this job posting payload. Return JSON only.\n\n${userPayload}`;

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
      completion = JSON.parse(rawText) as {
        choices?: { message?: { content?: unknown } }[];
      };
    } catch {
      return jsonResponse({ error: "OpenAI response was not valid JSON." }, 502);
    }

    const content = completion.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content.trim() : "";
    if (!text) {
      return jsonResponse({ error: "OpenAI returned empty content." }, 502);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return jsonResponse({ error: "Model output was not valid JSON." }, 502);
    }

    const normalized = normalizeExtraction(parsed);
    if (!normalized.ok) {
      return jsonResponse({ error: normalized.message }, 502);
    }

    const source_resolution = {
      kind: resolved.resolved.kind,
      fetched_url: resolved.resolved.fetched_url,
      internal_posting_id: resolved.resolved.internal_posting_id,
    };

    return jsonResponse({
      extraction: normalized.extraction,
      source_resolution,
      ...(resolved.resolved.kind !== "manual_text"
        ? { resolved_posting_text: postingTextForAi }
        : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${LOG}: error`, msg.slice(0, 200));
    return jsonResponse(
      { error: "Job extraction failed on the server. Please try again." },
      500,
    );
  }
});
