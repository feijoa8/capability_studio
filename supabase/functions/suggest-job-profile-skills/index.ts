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
  company_url?: string | null;
};

type JobProfileInput = {
  title?: string;
  level?: string | null;
  job_family?: string | null;
  role_summary?: string | null;
  responsibilities?: unknown;
  requirements?: unknown;
  existing_skill_names?: unknown;
};

type SkillSuggestionResult = {
  core_skills: string[];
  tools_and_platforms: string[];
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
  if (strategicFocus) lines.push(`Strategic focus / direction: ${strategicFocus}`);
  const keyDrivers = stringList(cp.key_drivers);
  const prioritiesLegacy = nonEmpty(cp.strategic_priorities);
  if (keyDrivers.length > 0) {
    lines.push(`Key strategic drivers: ${keyDrivers.join(", ")}`);
  } else if (prioritiesLegacy) {
    lines.push(`Strategic priorities (legacy): ${prioritiesLegacy}`);
  }
  const deliveryModels = stringList(cp.delivery_models);
  const deliveryLegacy = nonEmpty(cp.delivery_context);
  if (deliveryModels.length > 0) {
    lines.push(`Delivery / ways of working: ${deliveryModels.join(", ")}`);
  } else if (deliveryLegacy) {
    lines.push(`Delivery context (legacy): ${deliveryLegacy}`);
  }
  const orgStructure = nonEmpty(cp.organisation_structure);
  if (orgStructure) lines.push(`Organisation structure: ${orgStructure}`);
  const capAreas = stringList(cp.primary_capability_areas);
  const capLegacy = nonEmpty(cp.capability_emphasis);
  if (capAreas.length > 0) {
    lines.push(`Primary capability focus areas: ${capAreas.join(", ")}`);
  } else if (capLegacy) {
    lines.push(`Capability emphasis (legacy): ${capLegacy}`);
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

function normalizeSkillKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function dedupeAgainstExisting(
  suggested: string[],
  existing: Set<string>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of suggested) {
    const t = typeof raw === "string" ? raw.trim() : "";
    if (!t) continue;
    const key = normalizeSkillKey(t);
    if (existing.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function buildUserPrompt(
  companyProfile: CompanyProfileInput | null,
  job: {
    title: string;
    level: string | null;
    job_family: string | null;
    role_summary: string | null;
    responsibilities: string[];
    requirements: string[];
    existing_skill_names: string[];
  },
): string {
  const cp = companyProfile;
  const orgBlock = cp ? buildOrganisationContextBlock(cp) : "";
  const orgSection = orgBlock.trim()
    ? orgBlock
    : "(No organisation profile — still ground suggestions in role title, responsibilities, and requirements; avoid generic filler.)";

  const respList =
    job.responsibilities.length > 0
      ? job.responsibilities.map((r, i) => `${i + 1}. ${r}`).join("\n")
      : "(none listed)";

  const reqList =
    job.requirements.length > 0
      ? job.requirements.map((r, i) => `${i + 1}. ${r}`).join("\n")
      : "(none listed)";

  const desc = nonEmpty(job.role_summary);
  const family = nonEmpty(job.job_family);

  const existingBlock =
    job.existing_skill_names.length > 0
      ? job.existing_skill_names.map((s, i) => `${i + 1}. ${s}`).join("\n")
      : "(none yet)";

  return `Suggest **skills for this job profile** in **two separate lists**: transferable **core skills** (capabilities) and **tools & platforms** (software, systems, concrete tooling).

Ground suggestions in the organisation context, role title/level/family, role purpose, responsibilities, and requirements. Be **specific** to this employer and role — not a generic template. Do **not** invent organisation facts.

## Organisation context
${orgSection}

## Role
Job family: ${family ?? "—"}
Title: ${job.title}
Level: ${job.level ?? "—"}
${desc ? `Role purpose / description:\n${desc}\n` : ""}

## Responsibilities
${respList}

## Requirements
${reqList}

## Already on this profile (do NOT repeat or trivially rephrase in either list)
${existingBlock}

---

## core_skills (capabilities — what someone can *do*)
- **1–3 words** preferred; short phrases only when essential.
- **Atomic** and **transferable**; suitable for CV matching and development planning.
- **No** software, product, or platform names (those go in tools_and_platforms).
- **No** long phrases; avoid suffix clutter like "tools", "frameworks", "techniques" unless essential.
- Focus on **capabilities**, **methods**, and **domains** (e.g. product strategy, regulatory literacy).

**Good examples:** Product strategy; Roadmapping; Stakeholder management; Data analysis; Regulatory compliance; Backlog management; Customer insights

**Bad examples (anti-patterns):**
- "Cross-functional collaboration tools" → use **Cross-functional collaboration**
- "Stakeholder engagement strategies" → **Stakeholder management**
- "Customer experience optimization techniques" → **Customer experience design**

Return **8–16** items. No duplicates. Each must be **new** relative to the existing list above.

---

## tools_and_platforms (what they use to do the work)
- Widely recognised **software**, **platforms**, **languages**, or **concrete tools** realistic for this role.
- **5–10** items when relevant; omit padding.
- May include collaboration, analytics, delivery, design, or data tools as appropriate.

**Examples:** Jira; Confluence; SQL; Power BI; Excel; Figma; Miro; Azure DevOps

No duplicates. Each must be **new** relative to the existing list above.

---

Return JSON with **exactly** these two keys:
- "core_skills": string[]
- "tools_and_platforms": string[]

Respond with JSON only, no markdown fences.`;
}

function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseSkillContent(content: string): SkillSuggestionResult {
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
  let core_skills = parseStringArray(o.core_skills);
  let tools_and_platforms = parseStringArray(o.tools_and_platforms);
  const legacy = parseStringArray(o.suggested_skills);
  if (core_skills.length === 0 && tools_and_platforms.length === 0 && legacy.length > 0) {
    core_skills = legacy;
  }
  return { core_skills, tools_and_platforms };
}

function parseRequestBody(raw: unknown): {
  companyProfile: CompanyProfileInput | null;
  job: {
    title: string;
    level: string | null;
    job_family: string | null;
    role_summary: string | null;
    responsibilities: string[];
    requirements: string[];
    existing_skill_names: string[];
  };
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

  const jobRaw = body.jobProfile;
  if (!jobRaw || typeof jobRaw !== "object" || Array.isArray(jobRaw)) {
    throw new Error("jobProfile is required and must be an object.");
  }
  const jp = jobRaw as JobProfileInput;
  const title = typeof jp.title === "string" ? jp.title.trim() : "";
  if (!title) {
    throw new Error("jobProfile.title is required.");
  }
  const level =
    jp.level === undefined || jp.level === null
      ? null
      : String(jp.level).trim() || null;
  const job_family =
    jp.job_family === undefined || jp.job_family === null
      ? null
      : String(jp.job_family).trim() || null;
  const role_summary =
    jp.role_summary === undefined || jp.role_summary === null
      ? null
      : String(jp.role_summary).trim() || null;

  const resp = jp.responsibilities;
  if (resp !== undefined && !Array.isArray(resp)) {
    throw new Error("jobProfile.responsibilities must be an array of strings.");
  }
  const responsibilities = Array.isArray(resp)
    ? resp.filter((x): x is string => typeof x === "string").map((s) => s.trim())
    : [];

  const reqIn = jp.requirements;
  if (reqIn !== undefined && !Array.isArray(reqIn)) {
    throw new Error("jobProfile.requirements must be an array of strings.");
  }
  const requirements = Array.isArray(reqIn)
    ? reqIn.filter((x): x is string => typeof x === "string").map((s) => s.trim())
    : [];

  const ex = jp.existing_skill_names;
  if (ex !== undefined && !Array.isArray(ex)) {
    throw new Error("jobProfile.existing_skill_names must be an array of strings.");
  }
  const existing_skill_names = Array.isArray(ex)
    ? ex
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  return {
    companyProfile,
    job: {
      title,
      level,
      job_family,
      role_summary,
      responsibilities,
      requirements,
      existing_skill_names,
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

  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim();
  if (!apiKey) {
    console.error("suggest-job-profile-skills: OPENAI_API_KEY is not set");
    return jsonResponse(
      {
        error:
          "Server configuration error: OpenAI is not configured. Set OPENAI_API_KEY for this project.",
      },
      500,
    );
  }

  const model =
    Deno.env.get("OPENAI_MODEL")?.trim() || "gpt-4o-mini";

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

  const existingKeys = new Set(
    parsedBody.job.existing_skill_names.map((s) => normalizeSkillKey(s)),
  );

  const system =
    `You output **only** valid JSON with two keys: "core_skills" and "tools_and_platforms" (both string arrays).

**core_skills** = transferable capabilities (what someone can do) — short, atomic, **no** software or platform names.

**tools_and_platforms** = concrete tools, software, languages, and platforms used in the role.

Do not duplicate items already listed in existing_skill_names. Do not mix tool names into core_skills. Keep outputs grounded in the supplied role and organisation context — avoid generic lists that ignore sector, strategy, and operating model when provided.`;

  const user = buildUserPrompt(parsedBody.companyProfile, parsedBody.job);

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
          temperature: 0.32,
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
      console.error("suggest-job-profile-skills: OpenAI error", openaiRes.status, detail);
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

    const parsed = parseSkillContent(content);
    const keys = new Set(existingKeys);
    const coreFiltered = dedupeAgainstExisting(parsed.core_skills, keys);
    for (const c of coreFiltered) {
      keys.add(normalizeSkillKey(c));
    }
    const toolsFiltered = dedupeAgainstExisting(
      parsed.tools_and_platforms,
      keys,
    );

    return jsonResponse(
      {
        core_skills: coreFiltered,
        tools_and_platforms: toolsFiltered,
      },
      200,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected server error.";
    console.error("suggest-job-profile-skills:", e);
    return jsonResponse({ error: msg }, 500);
  }
});
