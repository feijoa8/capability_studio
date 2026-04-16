import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const KEY_DRIVERS = [
  "Growth",
  "Cost optimisation",
  "Innovation",
  "Compliance",
  "Customer experience",
  "Operational efficiency",
] as const;

const DELIVERY_MODELS = [
  "Agile Scrum",
  "Agile SAFe",
  "Waterfall",
  "Hybrid",
  "Product-led",
  "Project-led",
] as const;

const ORG_STRUCTURE = [
  "Functional",
  "Matrix",
  "Product-aligned",
  "Platform-based",
  "Project-based",
  "Hybrid",
] as const;

const CAPABILITY_AREAS = [
  "Product",
  "Technology",
  "Marketing",
  "Sales",
  "Service",
  "Operations",
  "Finance",
  "Legal / Risk",
  "People / HR",
  "Data / Analytics",
  "All",
] as const;

const REGULATORY = ["Low", "Medium", "High", "Critical"] as const;

const ROLE_BIAS = [
  "Product-led",
  "Delivery-led",
  "Project-led",
  "Mixed",
] as const;

type Suggestions = {
  /** Organisation overview — who they are, what they do, distinguishing context (1–3 sentences). */
  summary: string | null;
  /** Short directional statement — what they appear to be pursuing strategically; must not repeat summary. */
  strategic_focus: string | null;
  key_drivers: string[];
  delivery_models: string[];
  organisation_structure: string | null;
  primary_capability_areas: string[];
  regulatory_intensity: string | null;
  role_model_bias: string | null;
  capability_focus_notes: string | null;
  rationale: string | null;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function htmlToText(html: string): string {
  let t = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ");
  t = t.replace(/<\/(p|div|h[1-6]|li|br|tr)>/gi, "\n");
  t = t.replace(/<[^>]+>/g, " ");
  t = t
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
  t = t.replace(/\s+/g, " ").replace(/\n\s*\n/g, "\n").trim();
  return t;
}

function findAboutPageUrl(homeUrl: string, html: string): string | null {
  let base: URL;
  try {
    base = new URL(homeUrl);
  } catch {
    return null;
  }
  const hint = /about|who-we|our-story|our-company|company(?![a-z])/i;
  const anchorRe = /<a[^>]+href=["']([^"'>\s]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const raw = m[1];
    if (!hint.test(raw)) continue;
    try {
      const abs = new URL(raw, base);
      if (abs.origin !== base.origin) continue;
      if (abs.pathname === base.pathname && abs.search === base.search) {
        continue;
      }
      return abs.href;
    } catch {
      /* skip */
    }
  }
  return null;
}

async function fetchHtmlViaScrapingBee(
  targetUrl: string,
  apiKey: string,
): Promise<{ ok: boolean; status: number; html: string; error?: string }> {
  const u = new URL("https://app.scrapingbee.com/api/v1/");
  u.searchParams.set("api_key", apiKey);
  u.searchParams.set("url", targetUrl);
  u.searchParams.set("render_js", "false");

  const res = await fetch(u.toString(), { method: "GET" });
  const html = await res.text();
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      html: "",
      error: html?.slice(0, 400) || `${res.status} ${res.statusText}`,
    };
  }
  return { ok: true, status: res.status, html };
}

function clampText(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…[truncated]`;
}

function matchFromAllowed(
  value: string | null | undefined,
  allowed: readonly string[],
): string | null {
  if (!value?.trim()) return null;
  const t = value.trim();
  if (allowed.includes(t)) return t;
  const low = t.toLowerCase();
  for (const a of allowed) {
    if (a.toLowerCase() === low) return a;
  }
  return null;
}

function matchManyFromAllowed(
  raw: unknown,
  allowed: readonly string[],
): string[] {
  if (!Array.isArray(raw)) return [];
  const set = new Set<string>();
  for (const x of raw) {
    if (typeof x !== "string") continue;
    const m = matchFromAllowed(x, allowed);
    if (m) set.add(m);
  }
  return [...set];
}

/** Normalise model output: no whitespace-only, literal "null", or dash placeholders. */
function normalizeSummaryFromModel(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return normalizeSummaryFromModel(String(raw));
  }
  if (Array.isArray(raw) && raw.length > 0) {
    return normalizeSummaryFromModel(raw[0]);
  }
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\u00a0/g, " ").trim();
  if (!t) return null;
  if (/^(null|undefined|n\/a|—|-|\.{2,})$/i.test(t)) return null;
  return t.slice(0, 1200);
}

function normalizeStrategicFocusFromModel(raw: unknown): string | null {
  const s = normalizeSummaryFromModel(raw);
  if (!s) return null;
  return s.slice(0, 400);
}

/**
 * Conservative overview from raw page text only (no new facts). Used when the model omits summary.
 */
function extractConservativeSummaryFromSource(
  homePlain: string,
  aboutPlain: string | null,
): string | null {
  const raw = [homePlain, aboutPlain].filter((x) => x && x.trim()).join("\n\n");
  const oneLine = raw.replace(/\s+/g, " ").trim();
  if (oneLine.length < 120) return null;

  const sentenceParts = oneLine.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(
    Boolean,
  );
  const skipStart = /^(accept|cookie|cookies|privacy policy|terms|menu|search|sign in|log in|skip to)/i;
  const sentences: string[] = [];
  for (const p of sentenceParts) {
    if (p.length < 28) continue;
    if (skipStart.test(p.slice(0, 55))) continue;
    sentences.push(p);
    if (sentences.length >= 3) break;
  }
  if (sentences.length > 0) {
    let out = sentences.join(" ");
    if (out.length > 1000) out = `${out.slice(0, 997)}…`;
    return out;
  }

  const snippet = oneLine.slice(0, 520);
  const lastSpace = snippet.lastIndexOf(" ");
  const cut = lastSpace > 220 ? snippet.slice(0, lastSpace) : snippet;
  const t = cut.trim();
  return t.length >= 90 ? `${t}${oneLine.length > t.length ? "…" : ""}` : null;
}

/**
 * If the model put a long "overview" into strategic_focus and left summary empty, split
 * at the first sentence boundary after the opening sentence.
 */
function repairMisplacedStrategicFocus(
  strategic_focus: string | null,
): { summary: string | null; strategic_focus: string | null } {
  const t = strategic_focus?.trim() ?? "";
  if (t.length < 200) {
    return { summary: null, strategic_focus: t || null };
  }
  let splitAfter = -1;
  const minFirst = Math.min(80, Math.floor(t.length / 4));
  for (let i = minFirst; i < t.length - 25; i++) {
    const c = t[i];
    if ((c === "." || c === "?" || c === "!") && /\s/.test(t[i + 1] ?? "")) {
      splitAfter = i;
      break;
    }
  }
  if (splitAfter === -1) return { summary: null, strategic_focus: t };
  const first = t.slice(0, splitAfter + 1).trim();
  const rest = t.slice(splitAfter + 1).trim();
  if (first.length < 45 || rest.length < 18) {
    return { summary: null, strategic_focus: t };
  }
  return {
    summary: first.slice(0, 1200),
    strategic_focus: rest.slice(0, 400),
  };
}

function ensureSummaryWithFallback(
  suggestions: Suggestions,
  sourceCharCount: number,
  homePlain: string,
  aboutPlain: string | null,
): Suggestions {
  let summary = normalizeSummaryFromModel(suggestions.summary);
  let strategic_focus = normalizeStrategicFocusFromModel(suggestions.strategic_focus);

  const sourceSubstantial = sourceCharCount >= 200;

  if (!summary && sourceSubstantial) {
    const extracted = extractConservativeSummaryFromSource(homePlain, aboutPlain);
    if (extracted) {
      summary = extracted;
    }
  }

  if (!summary && strategic_focus && sourceSubstantial) {
    const repaired = repairMisplacedStrategicFocus(strategic_focus);
    if (repaired.summary) {
      summary = repaired.summary;
      strategic_focus = repaired.strategic_focus;
    }
  }

  return {
    ...suggestions,
    summary,
    strategic_focus,
  };
}

function parseAiSuggestions(content: string): Suggestions {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error("AI response was not valid JSON.");
  }

  const summary = normalizeSummaryFromModel(o.summary);

  const strategic_focus = normalizeStrategicFocusFromModel(o.strategic_focus);

  const key_drivers = matchManyFromAllowed(o.key_drivers, KEY_DRIVERS);
  const delivery_models = matchManyFromAllowed(o.delivery_models, DELIVERY_MODELS);
  const primary_capability_areas = matchManyFromAllowed(
    o.primary_capability_areas,
    CAPABILITY_AREAS,
  );

  const organisation_structure = matchFromAllowed(
    typeof o.organisation_structure === "string"
      ? o.organisation_structure
      : null,
    ORG_STRUCTURE,
  );
  const regulatory_intensity = matchFromAllowed(
    typeof o.regulatory_intensity === "string"
      ? o.regulatory_intensity
      : null,
    REGULATORY,
  );
  const role_model_bias = matchFromAllowed(
    typeof o.role_model_bias === "string" ? o.role_model_bias : null,
    ROLE_BIAS,
  );

  const capability_focus_notes =
    typeof o.capability_focus_notes === "string" && o.capability_focus_notes.trim()
      ? o.capability_focus_notes.trim().slice(0, 4000)
      : null;

  const rationale =
    typeof o.rationale === "string" && o.rationale.trim()
      ? o.rationale.trim().slice(0, 2000)
      : null;

  return {
    summary,
    strategic_focus,
    key_drivers,
    delivery_models,
    organisation_structure,
    primary_capability_areas,
    regulatory_intensity,
    role_model_bias,
    capability_focus_notes,
    rationale,
  };
}

const SYSTEM_PROMPT = `You are an analyst extracting structured organisational context from public website text.

The text may be incomplete or marketing-heavy. Infer conservatively for enums. Use only the allowed enum values provided in the user message for multi-select and single-select fields.

WORKFLOW (follow this order mentally, then output valid JSON):
1) First, write "summary": the main organisation overview (who they are, what they do, market/context). Use ONLY what the source supports. This field is REQUIRED whenever the source text is enough to say anything substantive about the organisation — do not skip it to put prose elsewhere.
2) Then write "strategic_focus": a SHORT directional line (what they appear to be pursuing). Derive it from the same source; it must NOT copy or paraphrase "summary". Prefer 1 sentence, max 2 very short sentences.
3) Fill structured fields (key_drivers, etc.) as appropriate.

CRITICAL — two different text fields:
- "summary": 1–3 sentences. Organisation overview ONLY. Never leave this null or empty if the website text clearly describes the company, its products/services, or its mission — unless the source is genuinely too thin or ambiguous to describe the organisation at all.
- "strategic_focus": Directional priorities/bets only. Must stay short. Do not dump overview or long narrative here — that belongs in "summary". "key_drivers" are structured tags; do not restate them as a long paragraph in strategic_focus.

Return JSON only with this exact shape (include "summary" as the first key in your object):
{
  "summary": "string — required when source is sufficient; 1-3 sentences; organisation overview",
  "strategic_focus": "string or null — 1 sentence, or 2 short sentences max; directional only; no overlap with summary",
  "key_drivers": ["only from allowed key_drivers list"],
  "delivery_models": ["only from allowed delivery_models list"],
  "organisation_structure": "one value from allowed organisation_structure or null",
  "primary_capability_areas": ["only from allowed primary_capability_areas list"],
  "regulatory_intensity": "one value from allowed regulatory_intensity or null",
  "role_model_bias": "one value from allowed role_model_bias or null",
  "capability_focus_notes": "string or null — optional nuance on capabilities or delivery not captured above",
  "rationale": "string — brief note on what you inferred and limitations (e.g. marketing site only)"
}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed. Use POST." }, 405);
  }

  const scrapingKey = Deno.env.get("SCRAPINGBEE_API_KEY")?.trim();
  if (!scrapingKey) {
    console.error("research-company-profile-url: SCRAPINGBEE_API_KEY missing");
    return jsonResponse(
      {
        error:
          "Server configuration: ScrapingBee is not configured (SCRAPINGBEE_API_KEY).",
      },
      500,
    );
  }

  const openaiKey = Deno.env.get("OPENAI_API_KEY")?.trim();
  if (!openaiKey) {
    return jsonResponse(
      {
        error:
          "Server configuration: OpenAI is not configured (OPENAI_API_KEY).",
      },
      500,
    );
  }

  const model = Deno.env.get("OPENAI_MODEL")?.trim() || "gpt-4o-mini";

  let body: { url?: string };
  try {
    const text = await req.text();
    if (!text.trim()) {
      return jsonResponse({ error: "Empty request body." }, 400);
    }
    body = JSON.parse(text) as { url?: string };
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
  if (!rawUrl) {
    return jsonResponse({ error: "url is required." }, 400);
  }

  let pageUrl: URL;
  try {
    pageUrl = new URL(rawUrl);
  } catch {
    return jsonResponse({ error: "Invalid URL." }, 400);
  }

  if (pageUrl.protocol !== "http:" && pageUrl.protocol !== "https:") {
    return jsonResponse({ error: "Only http and https URLs are supported." }, 400);
  }

  const home = pageUrl.href;
  const homeFetch = await fetchHtmlViaScrapingBee(home, scrapingKey);
  if (!homeFetch.ok) {
    return jsonResponse(
      {
        error:
          `Could not fetch the website (${homeFetch.status}). The site may block automated access or the URL may be wrong.`,
        detail: homeFetch.error,
      },
      502,
    );
  }

  const homeText = htmlToText(homeFetch.html);
  let aboutPlain: string | null = null;
  let combined = `## Homepage (${home})\n${clampText(homeText, 9000)}\n`;

  const aboutHref = findAboutPageUrl(home, homeFetch.html);
  if (aboutHref) {
    const aboutFetch = await fetchHtmlViaScrapingBee(aboutHref, scrapingKey);
    if (aboutFetch.ok) {
      const aboutText = htmlToText(aboutFetch.html);
      aboutPlain = aboutText;
      combined += `\n## About page (${aboutHref})\n${clampText(aboutText, 6000)}\n`;
    }
  }

  const stripped = combined.replace(/\s+/g, " ").trim();
  if (stripped.length < 80) {
    return jsonResponse(
      {
        error:
          "Not enough readable content was extracted from the site. Continue filling the profile manually.",
      },
      422,
    );
  }

  const userMsg = `Allowed values (use these exact strings only where applicable):

key_drivers: ${KEY_DRIVERS.join(", ")}
delivery_models: ${DELIVERY_MODELS.join(", ")}
organisation_structure: ${ORG_STRUCTURE.join(", ")}
primary_capability_areas: ${CAPABILITY_AREAS.join(", ")}
regulatory_intensity: ${REGULATORY.join(", ")}
role_model_bias: ${ROLE_BIAS.join(", ")}

Mandatory rules:
- Always write "summary" first (main organisation overview, 1–3 sentences) whenever the website text below is substantive enough to infer who the organisation is and what it does. If you output "strategic_focus" or any structured fields, you MUST also output a non-empty "summary" unless the source is genuinely too thin or contradictory to describe the organisation.
- "strategic_focus" must be short and directional only — not a second overview. Never leave "summary" empty while filling "strategic_focus" with long descriptive content; that content belongs in "summary".

---

WEBSITE TEXT (may include navigation/footer noise — focus on substantive content):

${clampText(combined, 20000)}`;

  try {
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMsg },
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

    let suggestions = parseAiSuggestions(content);
    suggestions = ensureSummaryWithFallback(
      suggestions,
      stripped.length,
      homeText,
      aboutPlain,
    );

    const hasAny =
      suggestions.summary ||
      suggestions.strategic_focus ||
      suggestions.key_drivers.length > 0 ||
      suggestions.delivery_models.length > 0 ||
      suggestions.organisation_structure ||
      suggestions.primary_capability_areas.length > 0 ||
      suggestions.regulatory_intensity ||
      suggestions.role_model_bias ||
      suggestions.capability_focus_notes;

    if (!hasAny) {
      return jsonResponse(
        {
          error:
            "Could not derive usable suggestions from this content. Edit the profile manually.",
          suggestions,
        },
        422,
      );
    }

    return jsonResponse({
      suggestions,
      sources: {
        homepage: home,
        about_page: aboutHref ?? null,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected server error.";
    console.error("research-company-profile-url:", e);
    return jsonResponse({ error: msg }, 500);
  }
});
