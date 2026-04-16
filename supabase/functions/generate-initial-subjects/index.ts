import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Canonical names — model must use these exactly (validated after generation). */
const FIXED_CAPABILITY_AREA_NAMES = [
  "Strategy & Direction",
  "Customer & Market Insight",
  "Product & Service Design",
  "Product Management",
  "Delivery & Execution",
  "Operations & Service",
  "Growth & Engagement",
  "Risk, Compliance & Governance",
  "Data, Technology & Platforms",
  "People & Capability",
] as const;

type CompanyProfileInput = {
  organisation_name?: string | null;
  sector?: string | null;
  industry?: string | null;
  summary?: string | null;
  strategic_focus?: string | null;
  key_drivers?: unknown;
  delivery_models?: unknown;
  organisation_structure?: string | null;
  primary_capability_areas?: unknown;
  capability_focus_notes?: string | null;
  regulatory_intensity?: string | null;
  role_model_bias?: string | null;
  business_purpose?: string | null;
  strategic_priorities?: string | null;
  delivery_context?: string | null;
  capability_emphasis?: string | null;
  role_interpretation_guidance?: string | null;
  terminology_guidance?: string | null;
};

type ScopeInput = {
  /** Broadness of generation. */
  type: "organisation" | "department" | "team" | "domain";
  /** Optional focus label (e.g. department name, team name, domain lens). */
  focus?: string | null;
};

type CapabilityAreaBlock = {
  name: string;
  subjects: string[];
};

type GenerateResult = {
  capability_areas: CapabilityAreaBlock[];
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

function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildOrganisationContextBlock(cp: CompanyProfileInput): string {
  const lines: string[] = [];
  const orgName = nonEmpty(cp.organisation_name);
  if (orgName) lines.push(`Organisation name: ${orgName}`);
  const sector = nonEmpty(cp.sector);
  const industry = nonEmpty(cp.industry);
  if (sector) lines.push(`Sector: ${sector}`);
  if (industry) lines.push(`Industry: ${industry}`);
  const summary = nonEmpty(cp.summary);
  if (summary) lines.push(`Organisation summary: ${summary}`);
  const strategicFocus = nonEmpty(cp.strategic_focus) ?? nonEmpty(cp.business_purpose);
  if (strategicFocus) lines.push(`Strategic focus: ${strategicFocus}`);
  const keyDrivers = stringList(cp.key_drivers);
  const prioritiesLegacy = nonEmpty(cp.strategic_priorities);
  if (keyDrivers.length > 0) {
    lines.push(`Key strategic drivers: ${keyDrivers.join(", ")}`);
  } else if (prioritiesLegacy) {
    lines.push(`Strategic priorities: ${prioritiesLegacy}`);
  }
  const deliveryModels = stringList(cp.delivery_models);
  const deliveryLegacy = nonEmpty(cp.delivery_context);
  if (deliveryModels.length > 0) {
    lines.push(`Delivery / ways of working: ${deliveryModels.join(", ")}`);
  } else if (deliveryLegacy) {
    lines.push(`Delivery context: ${deliveryLegacy}`);
  }
  const orgStructure = nonEmpty(cp.organisation_structure);
  if (orgStructure) lines.push(`Organisation structure: ${orgStructure}`);
  const capAreas = stringList(cp.primary_capability_areas);
  const capLegacy = nonEmpty(cp.capability_emphasis);
  if (capAreas.length > 0) {
    lines.push(`Primary capability focus areas: ${capAreas.join(", ")}`);
  } else if (capLegacy) {
    lines.push(`Capability emphasis: ${capLegacy}`);
  }
  const capNotes = nonEmpty(cp.capability_focus_notes);
  if (capNotes) lines.push(`Capability / delivery notes: ${capNotes}`);
  const reg = nonEmpty(cp.regulatory_intensity);
  if (reg) lines.push(`Regulatory intensity: ${reg}`);
  const bias = nonEmpty(cp.role_model_bias);
  if (bias) lines.push(`Role model bias: ${bias}`);
  const roleGuide = nonEmpty(cp.role_interpretation_guidance);
  if (roleGuide) lines.push(`Role interpretation guidance: ${roleGuide}`);
  const termGuide = nonEmpty(cp.terminology_guidance);
  if (termGuide) lines.push(`Terminology guidance: ${termGuide}`);
  return lines.length > 0 ? lines.join("\n") : "";
}

function canonicalCapabilityAreaName(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const low = t.toLowerCase();
  for (const name of FIXED_CAPABILITY_AREA_NAMES) {
    if (name.toLowerCase() === low) return name;
  }
  return null;
}

/** Merge duplicate area rows; then remove duplicate subjects globally (first wins). */
function mergeAndDedupeSubjects(
  areas: CapabilityAreaBlock[],
): CapabilityAreaBlock[] {
  const byName = new Map<string, string[]>();
  for (const block of areas) {
    const cur = byName.get(block.name) ?? [];
    byName.set(block.name, [...cur, ...block.subjects]);
  }
  const merged: CapabilityAreaBlock[] = [...byName.entries()].map(
    ([name, subjects]) => ({ name, subjects }),
  );

  const seen = new Set<string>();
  const out: CapabilityAreaBlock[] = [];
  for (const block of merged) {
    const subjects: string[] = [];
    for (const s of block.subjects) {
      const t = typeof s === "string" ? s.trim() : "";
      if (!t) continue;
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      subjects.push(t);
    }
    if (subjects.length > 0) {
      out.push({ name: block.name, subjects });
    }
  }
  return out;
}

const SYSTEM_PROMPT = `You are a capability taxonomy designer. You output ONLY valid JSON.

You propose **subject** names (domain groupings) under **fixed** capability areas. You do **not** propose competencies, levels, or long descriptions.

Rules:
- Use **only** the ten capability area names provided in the user message — spell them **exactly** as given.
- Do **not** include an area with an empty subject list — omit areas that are not relevant.
- Subjects: **2–5 words**, concise, distinct, meaningful domain labels (e.g. "Product Strategy", "User Research").
- No **framework or method brands** as subject names (e.g. not PRINCE2, BABOK, SAFe as subject titles).
- No generic filler ("General skills", "Miscellaneous").
- Avoid overlapping subject names across areas where possible; each subject should sit clearly under one area.

Output JSON shape:
{
  "capability_areas": [
    { "name": "<exact fixed area name>", "subjects": ["Subject One", "Subject Two"] }
  ]
}`;

function buildUserPrompt(
  companyProfile: CompanyProfileInput | null,
  scope: ScopeInput,
): string {
  const fixedList = FIXED_CAPABILITY_AREA_NAMES.map((n, i) => `${i + 1}. ${n}`).join(
    "\n",
  );

  const orgBlock = companyProfile
    ? buildOrganisationContextBlock(companyProfile)
    : "";
  const orgSection = orgBlock.trim()
    ? orgBlock
    : "(No organisation profile supplied — infer cautiously from scope only.)";

  const focus = nonEmpty(scope.focus);
  const scopeLines =
    scope.type === "organisation"
      ? `**Scope: organisation** — propose subjects with **broad** coverage across **all relevant** capability areas (do not force irrelevant areas).`
      : scope.type === "department"
        ? `**Scope: department**${focus ? ` — "${focus}"` : ""} — **narrower** subjects aligned to that part of the organisation; fewer areas, more targeted.`
        : scope.type === "team"
          ? `**Scope: team**${focus ? ` — "${focus}"` : ""} — **focused** subjects; only areas that clearly apply.`
          : `**Scope: domain**${focus ? ` — "${focus}"` : ""} — **deeper** subjects concentrated in the **most relevant** one or few capability areas; do not spread thinly across all areas.`;

  return `## Fixed capability areas (use these names **exactly** in "name" fields)

${fixedList}

## Organisation context
${orgSection}

## Scope
${scopeLines}

## Task
Generate an **initial** set of **subjects** grouped under the fixed capability areas above, grounded in the organisation context and scope.

Return JSON only:
{
  "capability_areas": [
    { "name": "Product Management", "subjects": ["Product Strategy", "Product Discovery"] }
  ]
}

Remember: omit entire capability area entries if you would have no relevant subjects. No competencies. No long descriptions.`;
}

/** Parses model output. Optional governance pass: `normalise-subject-taxonomy` (UI review; not auto-run). */
function parseAiResult(content: string): GenerateResult {
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
  const raw = o.capability_areas;
  if (!Array.isArray(raw)) {
    throw new Error('AI response missing "capability_areas" array.');
  }

  const capability_areas: CapabilityAreaBlock[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const nameRaw = typeof row.name === "string" ? row.name : "";
    const canonical = canonicalCapabilityAreaName(nameRaw);
    if (!canonical) continue;

    const subRaw = row.subjects;
    const subjects: string[] = [];
    if (Array.isArray(subRaw)) {
      for (const s of subRaw) {
        if (typeof s !== "string") continue;
        const t = s.trim();
        if (t) subjects.push(t);
      }
    }
    if (subjects.length === 0) continue;
    capability_areas.push({ name: canonical, subjects });
  }

  const deduped = mergeAndDedupeSubjects(capability_areas);
  if (deduped.length === 0) {
    throw new Error("No valid capability areas with subjects were produced.");
  }
  const areaOrder: Record<string, number> = {};
  for (let i = 0; i < FIXED_CAPABILITY_AREA_NAMES.length; i++) {
    areaOrder[FIXED_CAPABILITY_AREA_NAMES[i]] = i;
  }
  deduped.sort(
    (a, b) => (areaOrder[a.name] ?? 99) - (areaOrder[b.name] ?? 99),
  );
  return { capability_areas: deduped };
}

function parseRequestBody(raw: unknown): {
  companyProfile: CompanyProfileInput | null;
  scope: ScopeInput;
} {
  if (!raw || typeof raw !== "object") {
    throw new Error("Request body must be a JSON object.");
  }
  const body = raw as Record<string, unknown>;

  const companyRaw = body.companyProfile;
  let companyProfile: CompanyProfileInput | null = null;
  if (companyRaw !== undefined && companyRaw !== null) {
    if (typeof companyRaw !== "object" || Array.isArray(companyRaw)) {
      throw new Error("companyProfile must be an object or null.");
    }
    companyProfile = companyRaw as CompanyProfileInput;
  }

  const scopeRaw = body.scope;
  if (!scopeRaw || typeof scopeRaw !== "object" || Array.isArray(scopeRaw)) {
    throw new Error("scope is required and must be an object.");
  }
  const sc = scopeRaw as Record<string, unknown>;
  const t = sc.type;
  const type =
    t === "organisation" || t === "department" || t === "team" || t === "domain"
      ? t
      : null;
  if (!type) {
    throw new Error(
      'scope.type must be one of: "organisation", "department", "team", "domain".',
    );
  }
  const focus =
    sc.focus === undefined || sc.focus === null
      ? null
      : String(sc.focus).trim() || null;

  return { companyProfile, scope: { type, focus } };
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
    console.error("generate-initial-subjects: OPENAI_API_KEY is not set");
    return jsonResponse(
      {
        error:
          "Server configuration error: OpenAI is not configured. Set OPENAI_API_KEY for this project.",
      },
      500,
    );
  }

  const model = Deno.env.get("OPENAI_MODEL")?.trim() || "gpt-4o-mini";

  let parsedBody: ReturnType<typeof parseRequestBody>;
  try {
    const text = await req.text();
    if (!text.trim()) {
      return jsonResponse({ error: "Empty request body." }, 400);
    }
    parsedBody = parseRequestBody(JSON.parse(text));
  } catch (e) {
    const msg =
      e instanceof SyntaxError
        ? "Invalid JSON body."
        : e instanceof Error
          ? e.message
          : "Invalid request body.";
    return jsonResponse({ error: msg }, 400);
  }

  const user = buildUserPrompt(
    parsedBody.companyProfile,
    parsedBody.scope,
  );

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
          temperature: 0.35,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
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
        /* keep */
      }
      console.error("generate-initial-subjects: OpenAI error", openaiRes.status, detail);
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

    const result = parseAiResult(content);
    return jsonResponse(result, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected server error.";
    console.error("generate-initial-subjects:", e);
    return jsonResponse({ error: msg }, 500);
  }
});
