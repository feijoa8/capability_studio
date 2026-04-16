import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LOG = "compare-job-to-evidence";

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

function excerpt(s: string | null, n: number): string | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  if (t.length <= n) return t;
  return `${t.slice(0, n - 1)}…`;
}

type RoleAnalysis = Record<string, unknown>;

function isRoleAnalysisShape(o: unknown): o is RoleAnalysis {
  return !!o && typeof o === "object" && !Array.isArray(o);
}

export type EvidenceSnapshotV1 = {
  schemaVersion: 1;
  work_experience: Array<{
    role_title: string | null;
    organisation_name: string | null;
    industry: string | null;
    skills: string[];
    methods: string[];
    tools: string[];
    description_excerpt: string | null;
  }>;
  projects: Array<{
    project_name: string | null;
    client: string | null;
    role: string | null;
    industry: string | null;
    skills: string[];
    methods: string[];
    tools: string[];
    description_excerpt: string | null;
  }>;
  qualifications: Array<{ name: string; issuer: string | null }>;
  certifications: Array<{ title: string; issuer: string | null }>;
};

export type JobEvidenceComparison = {
  match_score: number;
  summary: string;
  strengths: string[];
  partial_coverage: string[];
  gaps: string[];
  competency_summary: string;
};

function mergeSkillTags(row: Record<string, unknown>): string[] {
  const a = asStrArray(row.skills, 64);
  const b = asStrArray(row.skill_tags, 64);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of [...a, ...b]) {
    const k = x.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out.slice(0, 48);
}

function normalizeComparison(raw: unknown):
  | { ok: true; comparison: JobEvidenceComparison }
  | { ok: false; message: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "Model returned non-object JSON." };
  }
  const o = raw as Record<string, unknown>;
  let match_score = typeof o.match_score === "number" ? o.match_score : NaN;
  if (!Number.isFinite(match_score)) {
    return { ok: false, message: "Missing numeric match_score." };
  }
  match_score = Math.round(Math.max(0, Math.min(100, match_score)));
  const summary = asStr(o.summary);
  if (!summary || summary.length < 10) {
    return { ok: false, message: "Missing or too-short summary." };
  }
  const competency_summary = asStr(o.competency_summary);
  if (!competency_summary || competency_summary.length < 10) {
    return { ok: false, message: "Missing or too-short competency_summary." };
  }
  return {
    ok: true,
    comparison: {
      match_score,
      summary,
      strengths: asStrArray(o.strengths, 14),
      partial_coverage: asStrArray(o.partial_coverage, 14),
      gaps: asStrArray(o.gaps, 14),
      competency_summary,
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
  const uid = userData.user.id;

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
  const role_analysis = b.role_analysis;
  if (!isRoleAnalysisShape(role_analysis)) {
    return jsonResponse({ error: "Missing role_analysis object." }, 400);
  }

  const [expRes, projRes, qualRes, certRes] = await Promise.all([
    userClient
      .from("user_experience")
      .select(
        "role_title, organisation_name, description, industry, skills, skill_tags, methods, tools",
      )
      .eq("user_id", uid)
      .order("sort_order", { ascending: true }),
    userClient
      .from("user_experience_projects")
      .select(
        "project_name, client, role, description, skills, methods, tools, industry",
      )
      .eq("user_id", uid),
    userClient.from("user_qualifications").select("name, issuer").eq("user_id", uid),
    userClient.from("user_certifications").select("title, issuer").eq("user_id", uid),
  ]);

  if (expRes.error) {
    console.error(LOG, expRes.error.message);
    return jsonResponse({ error: "Could not load work experience." }, 500);
  }
  if (projRes.error) {
    console.error(LOG, projRes.error.message);
    return jsonResponse({ error: "Could not load projects." }, 500);
  }
  if (qualRes.error) {
    console.error(LOG, qualRes.error.message);
    return jsonResponse({ error: "Could not load qualifications." }, 500);
  }
  if (certRes.error) {
    console.error(LOG, certRes.error.message);
    return jsonResponse({ error: "Could not load certifications." }, 500);
  }

  const work_experience = (expRes.data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      role_title: asStr(r.role_title),
      organisation_name: asStr(r.organisation_name),
      industry: asStr(r.industry),
      skills: mergeSkillTags(r),
      methods: asStrArray(r.methods, 24),
      tools: asStrArray(r.tools, 24),
      description_excerpt: excerpt(asStr(r.description), 520),
    };
  });

  const projects = (projRes.data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      project_name: asStr(r.project_name),
      client: asStr(r.client),
      role: asStr(r.role),
      industry: asStr(r.industry),
      skills: asStrArray(r.skills, 32),
      methods: asStrArray(r.methods, 24),
      tools: asStrArray(r.tools, 24),
      description_excerpt: excerpt(asStr(r.description), 420),
    };
  });

  const qualifications = (qualRes.data ?? [])
    .map((row) => {
      const r = row as Record<string, unknown>;
      const name = asStr(r.name);
      if (!name) return null;
      return { name, issuer: asStr(r.issuer) };
    })
    .filter(Boolean) as EvidenceSnapshotV1["qualifications"];

  const certifications = (certRes.data ?? [])
    .map((row) => {
      const r = row as Record<string, unknown>;
      const title = asStr(r.title);
      if (!title) return null;
      return { title, issuer: asStr(r.issuer) };
    })
    .filter(Boolean) as EvidenceSnapshotV1["certifications"];

  const evidence_snapshot: EvidenceSnapshotV1 = {
    schemaVersion: 1,
    work_experience,
    projects,
    qualifications,
    certifications,
  };

  const model = Deno.env.get("OPENAI_MODEL")?.trim() || "gpt-4o-mini";

  const outShape = `{
  "match_score": number,
  "summary": string,
  "strengths": string[],
  "partial_coverage": string[],
  "gaps": string[],
  "competency_summary": string
}`;

  const system =
    `You compare a structured job posting analysis to a user's evidence snapshot from Capability Studio (work experience, projects, qualifications, certifications).\n\n` +
    `Return ONLY valid JSON (no markdown) matching:\n${outShape}\n\n` +
    `Rules:\n` +
    `1) Grounding: Only reference evidence present in the evidence_snapshot. Do not invent roles, employers, or credentials.\n` +
    `2) match_score: integer 0–100 — realistic fit based on overlap of skills, methods, tools, industries, and seniority signals. If evidence is empty, score low (0–35) and say so in summary.\n` +
    `3) summary: 2–5 sentences, direct, no hype.\n` +
    `4) strengths: clear matches between job signals and evidence (cite themes, not fictional detail).\n` +
    `5) partial_coverage: areas where the user has related but not sufficient evidence.\n` +
    `6) gaps: important job asks with no or weak evidence in the snapshot.\n` +
    `7) competency_summary: short paragraph synthesising how the user's evidenced capabilities line up with the role's key competencies.\n` +
    `8) Be specific; avoid generic phrases like "strong communicator" unless the job text emphasises it and evidence supports it.\n`;

  const userPrompt = `Job role analysis (JSON):\n${JSON.stringify(role_analysis)}\n\nEvidence snapshot (JSON):\n${JSON.stringify(evidence_snapshot)}\n\nReturn JSON only.`;

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

    const normalized = normalizeComparison(parsed);
    if (!normalized.ok) {
      return jsonResponse({ error: normalized.message }, 502);
    }

    return jsonResponse({
      comparison: normalized.comparison,
      evidence_snapshot,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${LOG}: error`, msg.slice(0, 200));
    return jsonResponse(
      { error: "Comparison failed on the server. Please try again." },
      500,
    );
  }
});
