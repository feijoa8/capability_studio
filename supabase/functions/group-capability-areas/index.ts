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

type SubjectInput = {
  id: string;
  name: string;
  description: string | null;
  governance_status?: string | null;
  /** Current capability area label for anchored subjects (settled / protected). */
  current_capability_area_name?: string | null;
};

type CapabilityAreaAnchorInput = {
  name: string;
  governance_status?: string | null;
};

const UNASSIGNED_GROUP_NAME = "(Unassigned)";

function normKey(s: string): string {
  return s.trim().toLowerCase();
}

function parseGov(
  v: string | null | undefined
): "draft" | "settled" | "protected" {
  const t = (v ?? "").trim().toLowerCase();
  if (t === "settled" || t === "protected") return t;
  return "draft";
}

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

function formatSubjectLine(s: SubjectInput): string {
  const d = s.description?.trim()
    ? ` — ${s.description.trim().slice(0, 400)}`
    : "";
  const g = parseGov(s.governance_status);
  const tag =
    g === "draft"
      ? ""
      : g === "protected"
        ? ` [PROTECTED — must stay under "${s.current_capability_area_name?.trim() || UNASSIGNED_GROUP_NAME}"]`
        : ` [SETTLED — prefer staying under "${s.current_capability_area_name?.trim() || UNASSIGNED_GROUP_NAME}"]`;
  return `- ${s.name.trim()}${d}${tag}`;
}

function buildAnchorBlock(
  capabilityAreaAnchors: CapabilityAreaAnchorInput[]
): string {
  if (!capabilityAreaAnchors.length) return "";
  const lines = capabilityAreaAnchors.map((a) => {
    const g = parseGov(a.governance_status);
    const label =
      g === "protected"
        ? "PROTECTED (fixed name — do not rename, merge, or replace with a near-duplicate)"
        : g === "settled"
          ? "SETTLED (stable anchor — prefer mapping new draft subjects here)"
          : "DRAFT";
    return `- ${a.name.trim()} — ${label}`;
  });
  return `## Existing capability areas (governance)
${lines.join("\n")}

`;
}

function buildBottomUpPrompt(
  companyProfile: CompanyProfileInput | null,
  subjects: SubjectInput[],
  capabilityAreaAnchors: CapabilityAreaAnchorInput[]
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

  const draftSubs = subjects.filter((s) => parseGov(s.governance_status) === "draft");
  const anchoredSubs = subjects.filter((s) => parseGov(s.governance_status) !== "draft");

  const draftLines = draftSubs.map((s) => {
    const d = s.description?.trim()
      ? ` — ${s.description.trim().slice(0, 400)}`
      : "";
    return `- ${s.name.trim()}${d}`;
  });

  const anchoredLines = anchoredSubs.map(formatSubjectLine);

  const anchorBlock = buildAnchorBlock(capabilityAreaAnchors);

  const focusNote =
    draftSubs.length > 0
      ? `Focus **primarily** on clustering **draft** subjects. Do **not** move **protected** or **settled** subjects out of their stated capability area (see tags).`
      : `All subjects are anchored — still output valid JSON groups matching their fixed areas.`;

  return `## Context
${orgBlock}

${anchorBlock}## Subjects — primary focus: DRAFT (cluster these)
${draftLines.length > 0 ? draftLines.join("\n") : "(No draft subjects — only anchored rows below.)"}

## Subjects — SETTLED / PROTECTED (must stay in listed areas; do not reshuffle)
${anchoredLines.length > 0 ? anchoredLines.join("\n") : "(None.)"}

## Task (bottom-up clustering)
${focusNote}
1. Propose **capability areas** (often **5–15**), reusing **existing area names** from the governance list when they fit.
2. **Protected** subjects: must appear in output under their **exact** current capability area name (or "${UNASSIGNED_GROUP_NAME}" if unassigned).
3. **Settled** subjects: keep under their current capability area unless you have no alternative (prefer stability).
4. **Draft** subjects: assign to the best area; prefer **settled** areas as merge targets over inventing many new names.
5. Every subject name must appear **exactly once** (use **exact** strings).
6. List **possible duplicate** pairs (draft-heavy; **do not** suggest alternatives that replace **protected** or **settled** names).
7. Flag **activity-style** draft subject names (names from the list only).

Return JSON only with EXACTLY this shape:
{
  "groups": [
    {
      "capability_area_name": "string",
      "capability_area_description": "string or null",
      "subject_names": ["exact name from list", "..."]
    }
  ],
  "possible_duplicates": [
    { "name_a": "string", "name_b": "string", "note": "string or null" }
  ],
  "activity_style_subjects": [
    { "name": "string", "note": "string or null" }
  ]
}

No markdown fences.`;
}

function buildTopDownPrompt(
  companyProfile: CompanyProfileInput | null,
  subjects: SubjectInput[],
  predefinedAreaNames: string[],
  capabilityAreaAnchors: CapabilityAreaAnchorInput[]
): string {
  const cp = companyProfile;
  const orgBlock = cp
    ? [
        nonEmpty(cp.organisation_name) &&
          `Organisation: ${cp.organisation_name}`,
        nonEmpty(cp.sector) && `Sector: ${cp.sector}`,
        nonEmpty(cp.summary) && `Summary: ${cp.summary}`,
      ]
        .filter(Boolean)
        .join("\n")
    : "(No organisation profile.)";

  const anchorBlock = buildAnchorBlock(capabilityAreaAnchors);
  const areas = predefinedAreaNames.map((a) => `- ${a.trim()}`).join("\n");
  const lines = subjects.map(formatSubjectLine);

  return `## Context
${orgBlock}

${anchorBlock}## Predefined capability areas (assign each subject to exactly one)
${areas}

## Subjects
${lines.join("\n")}

## Task
Assign **each** subject to **exactly one** of the predefined capability area names above (use the **exact** area name string). **Protected** subjects must map to their current area only; **settled** subjects should stay stable unless impossible.

Also list possible duplicate pairs and activity-style names (same rules as bottom-up; do not undermine protected anchors).

Return JSON only with EXACTLY this shape:
{
  "groups": [
    {
      "capability_area_name": "string (must match one of the predefined names)",
      "capability_area_description": "null",
      "subject_names": ["exact subject name from list", "..."]
    }
  ],
  "possible_duplicates": [
    { "name_a": "string", "name_b": "string", "note": "string or null" }
  ],
  "activity_style_subjects": [
    { "name": "string", "note": "string or null" }
  ]
}

Every subject name must appear exactly once across all groups. No markdown fences.`;
}

function parseResult(content: string): {
  groups: {
    capability_area_name: string;
    capability_area_description: string | null;
    subject_names: string[];
  }[];
  possible_duplicates: {
    name_a: string;
    name_b: string;
    note: string | null;
  }[];
  activity_style_subjects: { name: string; note: string | null }[];
} {
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
  const groupsRaw = o.groups;
  if (!Array.isArray(groupsRaw)) {
    throw new Error("AI response missing groups array.");
  }
  const groups: {
    capability_area_name: string;
    capability_area_description: string | null;
    subject_names: string[];
  }[] = [];
  for (const item of groupsRaw) {
    if (!item || typeof item !== "object") continue;
    const g = item as Record<string, unknown>;
    const name =
      typeof g.capability_area_name === "string"
        ? g.capability_area_name.trim()
        : "";
    if (!name) continue;
    let capability_area_description: string | null = null;
    if (g.capability_area_description != null) {
      const d = String(g.capability_area_description).trim();
      capability_area_description = d ? d : null;
    }
    const sn = g.subject_names;
    const subject_names = Array.isArray(sn)
      ? sn.map((x) => String(x).trim()).filter(Boolean)
      : [];
    groups.push({
      capability_area_name: name,
      capability_area_description,
      subject_names,
    });
  }
  if (groups.length === 0) {
    throw new Error("AI returned no groups.");
  }

  const dupRaw = o.possible_duplicates;
  const possible_duplicates: {
    name_a: string;
    name_b: string;
    note: string | null;
  }[] = [];
  if (Array.isArray(dupRaw)) {
    for (const item of dupRaw) {
      if (!item || typeof item !== "object") continue;
      const d = item as Record<string, unknown>;
      const a = typeof d.name_a === "string" ? d.name_a.trim() : "";
      const b = typeof d.name_b === "string" ? d.name_b.trim() : "";
      if (!a || !b) continue;
      let note: string | null = null;
      if (d.note != null) {
        const n = String(d.note).trim();
        note = n ? n : null;
      }
      possible_duplicates.push({ name_a: a, name_b: b, note });
    }
  }

  const actRaw = o.activity_style_subjects;
  const activity_style_subjects: { name: string; note: string | null }[] = [];
  if (Array.isArray(actRaw)) {
    for (const item of actRaw) {
      if (!item || typeof item !== "object") continue;
      const d = item as Record<string, unknown>;
      const name = typeof d.name === "string" ? d.name.trim() : "";
      if (!name) continue;
      let note: string | null = null;
      if (d.note != null) {
        const n = String(d.note).trim();
        note = n ? n : null;
      }
      activity_style_subjects.push({ name, note });
    }
  }

  return { groups, possible_duplicates, activity_style_subjects };
}

function enforceGovernanceAnchors(
  result: {
    groups: {
      capability_area_name: string;
      capability_area_description: string | null;
      subject_names: string[];
    }[];
    possible_duplicates: {
      name_a: string;
      name_b: string;
      note: string | null;
    }[];
    activity_style_subjects: { name: string; note: string | null }[];
  },
  subjects: SubjectInput[],
): typeof result {
  const anchored = subjects.filter((s) => {
    const g = parseGov(s.governance_status);
    return g === "protected" || g === "settled";
  });
  if (anchored.length === 0) return result;

  const anchoredKeys = new Set(anchored.map((s) => normKey(s.name)));
  const groups = result.groups.map((g) => ({
    ...g,
    subject_names: g.subject_names.filter(
      (n) => !anchoredKeys.has(normKey(n)),
    ),
  }));

  for (const s of anchored) {
    const name = s.name.trim();
    const areaRaw = s.current_capability_area_name?.trim() || null;
    const targetName = areaRaw ?? UNASSIGNED_GROUP_NAME;
    let g = groups.find(
      (x) => normKey(x.capability_area_name) === normKey(targetName),
    );
    if (!g) {
      g = {
        capability_area_name: areaRaw ?? UNASSIGNED_GROUP_NAME,
        capability_area_description: null,
        subject_names: [],
      };
      groups.push(g);
    }
    g.subject_names.push(name);
  }

  const nonempty = groups.filter((g) => g.subject_names.length > 0);
  return {
    ...result,
    groups: nonempty.length > 0 ? nonempty : groups,
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
    return jsonResponse(
      {
        error:
          "Server configuration error: OpenAI is not configured. Set OPENAI_API_KEY.",
      },
      500
    );
  }

  const model = Deno.env.get("OPENAI_MODEL")?.trim() || "gpt-4o-mini";

  let body: {
    companyProfile?: CompanyProfileInput | null;
    subjects?: SubjectInput[];
    mode?: "bottom_up" | "top_down";
    predefinedAreaNames?: string[];
    capabilityAreaAnchors?: CapabilityAreaAnchorInput[];
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

  const mode = body.mode === "top_down" ? "top_down" : "bottom_up";
  const subjectsRaw = Array.isArray(body.subjects) ? body.subjects : [];
  const subjects: SubjectInput[] = [];
  for (const s of subjectsRaw) {
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
    const current_capability_area_name =
      o.current_capability_area_name !== undefined &&
      o.current_capability_area_name !== null
        ? String(o.current_capability_area_name).trim() || null
        : null;
    subjects.push({
      id,
      name,
      description,
      governance_status,
      current_capability_area_name,
    });
  }

  const capabilityAreaAnchors: CapabilityAreaAnchorInput[] = [];
  const rawAnchors = body.capabilityAreaAnchors;
  if (Array.isArray(rawAnchors)) {
    for (const r of rawAnchors) {
      if (!r || typeof r !== "object") continue;
      const o = r as Record<string, unknown>;
      const an = typeof o.name === "string" ? o.name.trim() : "";
      if (!an) continue;
      const governance_status =
        o.governance_status !== undefined && o.governance_status !== null
          ? String(o.governance_status).trim() || null
          : null;
      capabilityAreaAnchors.push({ name: an, governance_status });
    }
  }

  if (subjects.length === 0) {
    return jsonResponse({ error: "At least one subject is required." }, 400);
  }

  let predefinedAreaNames: string[] = [];
  if (mode === "top_down") {
    predefinedAreaNames = Array.isArray(body.predefinedAreaNames)
      ? body.predefinedAreaNames
          .map((x) => String(x).trim())
          .filter(Boolean)
      : [];
    if (predefinedAreaNames.length < 2) {
      return jsonResponse(
        {
          error:
            "Top-down mode requires at least two predefined capability area names.",
        },
        400
      );
    }
  }

  const companyProfile =
    body.companyProfile &&
    typeof body.companyProfile === "object" &&
    !Array.isArray(body.companyProfile)
      ? (body.companyProfile as CompanyProfileInput)
      : null;

  const system = `You are helping organise an existing **subject catalogue** into **capability areas** for Capability Studio.

Capability areas are **navigation / governance groupings** for subjects. They do **not** replace subjects and do **not** own competencies directly in this task.

Governance:
• **Protected** subjects and capability areas are **fixed anchors** — never suggest reassignment, renaming, merges, or “better” duplicates that replace them.
• **Settled** items are **stable preferred anchors** — prefer mapping new draft work to them; avoid reshuffling settled subjects by default.
• **Draft** items are free to reorganise.

Rules:
• Output **only** valid JSON matching the user's schema.
• Use **exact** subject name strings from the input list when listing subject_names.
• Prefer **fewer, clearer** areas over many tiny buckets.
• Do **not** delete or merge subject rows in the JSON — only group names under areas.

No markdown fences.`;

  const user =
    mode === "top_down"
      ? buildTopDownPrompt(
          companyProfile,
          subjects,
          predefinedAreaNames,
          capabilityAreaAnchors,
        )
      : buildBottomUpPrompt(companyProfile, subjects, capabilityAreaAnchors);

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

    const result = parseResult(content);
    const enforced = enforceGovernanceAnchors(result, subjects);
    return jsonResponse(enforced, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected server error.";
    console.error("group-capability-areas:", e);
    return jsonResponse({ error: msg }, 500);
  }
});
