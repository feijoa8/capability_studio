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

type PracticeInput = {
  id: string;
  name: string;
  description?: string | null;
};

type CapabilityAreaContext = {
  id: string;
  name: string;
  description?: string | null;
  governance_status?: string | null;
};

type SubjectCatalogueRow = {
  id: string;
  name: string;
  description?: string | null;
  type?: string | null;
  practice_id?: string | null;
  practice_context_ids?: string[];
  governance_status?: string | null;
  capability_area_id?: string | null;
};

function subjectContextIds(s: SubjectCatalogueRow): string[] {
  const fromArr = Array.isArray(s.practice_context_ids)
    ? s.practice_context_ids.filter((x) => typeof x === "string" && x.trim())
    : [];
  if (fromArr.length > 0) return [...new Set(fromArr)];
  return s.practice_id?.trim() ? [s.practice_id.trim()] : [];
}

type LinkExistingOut = {
  subject_id: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  duplicate_or_close_match_note: string | null;
};

type MissingAreaOut = {
  proposed_name: string;
  proposed_description: string | null;
  suggested_capability_area_name: string | null;
  confidence: "high" | "medium" | "low";
  reason: string;
  duplicate_or_close_match_note: string | null;
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
  practice: PracticeInput,
  currentLinked: SubjectCatalogueRow[],
  catalogue: SubjectCatalogueRow[],
  capabilityAreas: CapabilityAreaContext[],
  stableAnchors: SubjectCatalogueRow[],
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

  const prDesc = practice.description?.trim()
    ? practice.description.trim().slice(0, 600)
    : "(No description.)";

  const cur = currentLinked.map((s) => {
    const d = s.description?.trim()
      ? ` — ${s.description.trim().slice(0, 320)}`
      : "";
    return `- id=${s.id} | ${s.name.trim()}${d}`;
  });

  const cat = catalogue.map((s) => {
    const d = s.description?.trim()
      ? ` — ${s.description.trim().slice(0, 280)}`
      : "";
    const ids = subjectContextIds(s);
    const pid = ids.length > 0
      ? ` | current_practice_context_ids=[${ids.join(",")}]`
      : " | current_practice_context_ids=[]";
    const g = (s.governance_status ?? "draft").trim().toLowerCase();
    const gt =
      g === "protected"
        ? " [SUBJECT PROTECTED]"
        : g === "settled"
          ? " [SUBJECT SETTLED]"
          : "";
    return `- id=${s.id} | ${s.name.trim()}${d}${pid}${gt}`;
  });

  const areas = capabilityAreas.map((a) => {
    const g = (a.governance_status ?? "draft").trim().toLowerCase();
    const tag =
      g === "protected"
        ? " [AREA PROTECTED]"
        : g === "settled"
          ? " [AREA SETTLED]"
          : "";
    const d = a.description?.trim()
      ? ` — ${a.description.trim().slice(0, 200)}`
      : "";
    return `- ${a.name.trim()}${tag}${d}`;
  });

  const anchors = stableAnchors.map((s) => {
    const d = s.description?.trim()
      ? ` — ${s.description.trim().slice(0, 200)}`
      : "";
    return `- id=${s.id} | ${s.name.trim()}${d}`;
  });

  return `## Context
${orgBlock}

## Target practice (contextual lens — does NOT own subjects)
- id=${practice.id}
- name=${practice.name.trim()}
- description: ${prDesc}

## Subjects already marked relevant to THIS practice (id=${practice.id})
${cur.length > 0 ? cur.join("\n") : "(None — coverage may be weak.)"}

## Full subject catalogue (reuse existing rows; prefer linking over inventing)
${cat.join("\n")}

## Stable subject anchors (settled / protected — prefer when plausible)
${anchors.length > 0 ? anchors.join("\n") : "(None listed.)"}

## Capability areas (structural grouping — when proposing a *new* subject name, pick best-fit area name from this list, or null if truly unassigned)
${areas.length > 0 ? areas.join("\n") : "(None — use concise new area names only if list empty.)"}

## Task
Return JSON with two arrays:

### A) link_existing
Subjects from the catalogue that should **also** be marked relevant to this practice (add a link — do **not** remove other practice links).
- Only include subject ids where **current_practice_context_ids does NOT already include this practice id**. Subjects may be relevant to multiple practices.
- Exclude subjects that are clearly irrelevant to this practice domain.
- Max 18 items. Each: subject_id (uuid from catalogue), confidence (high/medium/low), reason (short), duplicate_or_close_match_note (null or note if name is near another subject).

### B) missing_areas
**Possible gap** subject *domains* that are not adequately covered by existing subject names for this practice — only when a genuine gap exists.
- Prefer **zero** rows if existing subjects can be linked instead.
- Max 8 items. Each: proposed_name, proposed_description (null ok), suggested_capability_area_name (must match a listed capability area name exactly, or null), confidence, reason, duplicate_or_close_match_note (required if similar to an existing subject name).

**Critical:** Practices are contextual only; you are not restructuring capability areas. Do not invent duplicate subject names that match existing catalogue names.

Return JSON only:
{
  "link_existing": [ { "subject_id": "", "confidence": "medium", "reason": "", "duplicate_or_close_match_note": null } ],
  "missing_areas": [ { "proposed_name": "", "proposed_description": null, "suggested_capability_area_name": null, "confidence": "low", "reason": "", "duplicate_or_close_match_note": null } ]
}

No markdown fences.`;
}

function parseConfidence(
  v: unknown,
): "high" | "medium" | "low" {
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (t === "high" || t === "low") return t;
  return "medium";
}

function parseResult(
  content: string,
  catalogueIds: Set<string>,
  practiceId: string,
  catalogueById: Map<string, SubjectCatalogueRow>,
): { link_existing: LinkExistingOut[]; missing_areas: MissingAreaOut[] } {
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

  const link_existing: LinkExistingOut[] = [];
  const rawLink = o.link_existing;
  if (Array.isArray(rawLink)) {
    const seen = new Set<string>();
    for (const item of rawLink) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const subject_id =
        typeof row.subject_id === "string" ? row.subject_id.trim() : "";
      if (!subject_id || !catalogueIds.has(subject_id) || seen.has(subject_id)) {
        continue;
      }
      const sub = catalogueById.get(subject_id);
      if (!sub) continue;
      if (subjectContextIds(sub).includes(practiceId)) continue;
      seen.add(subject_id);
      const reason =
        typeof row.reason === "string" ? row.reason.trim().slice(0, 400) : "";
      if (!reason) continue;
      let duplicate_or_close_match_note: string | null = null;
      if (row.duplicate_or_close_match_note != null) {
        const c = String(row.duplicate_or_close_match_note).trim();
        duplicate_or_close_match_note = c ? c.slice(0, 400) : null;
      }
      link_existing.push({
        subject_id,
        confidence: parseConfidence(row.confidence),
        reason,
        duplicate_or_close_match_note,
      });
    }
  }

  const missing_areas: MissingAreaOut[] = [];
  const rawMiss = o.missing_areas;
  if (Array.isArray(rawMiss)) {
    for (const item of rawMiss) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const proposed_name =
        typeof row.proposed_name === "string" ? row.proposed_name.trim() : "";
      if (!proposed_name) continue;
      const reason =
        typeof row.reason === "string" ? row.reason.trim().slice(0, 400) : "";
      if (!reason) continue;
      let proposed_description: string | null = null;
      if (row.proposed_description != null) {
        const d = String(row.proposed_description).trim();
        proposed_description = d ? d.slice(0, 1200) : null;
      }
      let suggested_capability_area_name: string | null = null;
      if (row.suggested_capability_area_name != null) {
        const a = String(row.suggested_capability_area_name).trim();
        suggested_capability_area_name = a ? a.slice(0, 200) : null;
      }
      let duplicate_or_close_match_note: string | null = null;
      if (row.duplicate_or_close_match_note != null) {
        const c = String(row.duplicate_or_close_match_note).trim();
        duplicate_or_close_match_note = c ? c.slice(0, 400) : null;
      }
      missing_areas.push({
        proposed_name,
        proposed_description,
        suggested_capability_area_name,
        confidence: parseConfidence(row.confidence),
        reason,
        duplicate_or_close_match_note,
      });
    }
  }

  return { link_existing, missing_areas };
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
    practice?: PracticeInput;
    subjects?: SubjectCatalogueRow[];
    capabilityAreas?: CapabilityAreaContext[];
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

  const practice = body.practice;
  if (
    !practice ||
    typeof practice.id !== "string" ||
    !practice.id.trim() ||
    typeof practice.name !== "string" ||
    !practice.name.trim()
  ) {
    return jsonResponse({ error: "practice id and name are required." }, 400);
  }

  const catalogue: SubjectCatalogueRow[] = [];
  const rawSub = body.subjects;
  if (Array.isArray(rawSub)) {
    for (const s of rawSub) {
      if (!s || typeof s !== "object") continue;
      const o = s as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id.trim() : "";
      const name = typeof o.name === "string" ? o.name.trim() : "";
      if (!id || !name) continue;
      const rawPids = o["practice_context_ids"];
      let practice_context_ids: string[] | undefined;
      if (Array.isArray(rawPids)) {
        practice_context_ids = rawPids
          .filter((x): x is string => typeof x === "string" && !!x.trim())
          .map((x) => x.trim());
      }
      catalogue.push({
        id,
        name,
        description:
          o.description === undefined || o.description === null
            ? null
            : String(o.description).trim() || null,
        type:
          o.type === undefined || o.type === null
            ? null
            : String(o.type).trim() || null,
        practice_id:
          o.practice_id === undefined || o.practice_id === null
            ? null
            : String(o.practice_id).trim() || null,
        practice_context_ids,
        governance_status:
          o.governance_status === undefined || o.governance_status === null
            ? null
            : String(o.governance_status).trim() || null,
        capability_area_id:
          o.capability_area_id === undefined || o.capability_area_id === null
            ? null
            : String(o.capability_area_id).trim() || null,
      });
    }
  }

  if (catalogue.length === 0) {
    return jsonResponse(
      { error: "At least one subject in the catalogue is required." },
      400,
    );
  }

  const capabilityAreas: CapabilityAreaContext[] = [];
  const rawAreas = body.capabilityAreas;
  if (Array.isArray(rawAreas)) {
    for (const a of rawAreas) {
      if (!a || typeof a !== "object") continue;
      const o = a as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id.trim() : "";
      const name = typeof o.name === "string" ? o.name.trim() : "";
      if (!id || !name) continue;
      capabilityAreas.push({
        id,
        name,
        description:
          o.description === undefined || o.description === null
            ? null
            : String(o.description).trim() || null,
        governance_status:
          o.governance_status === undefined || o.governance_status === null
            ? null
            : String(o.governance_status).trim() || null,
      });
    }
  }

  const pid = practice.id.trim();
  const currentLinked = catalogue.filter((s) =>
    subjectContextIds(s).includes(pid)
  );
  const stableAnchors = catalogue.filter((s) => {
    const g = (s.governance_status ?? "").trim().toLowerCase();
    return g === "settled" || g === "protected";
  });

  const catalogueIds = new Set(catalogue.map((s) => s.id));
  const catalogueById = new Map(catalogue.map((s) => [s.id, s]));

  const companyProfile =
    body.companyProfile &&
    typeof body.companyProfile === "object" &&
    !Array.isArray(body.companyProfile)
      ? (body.companyProfile as CompanyProfileInput)
      : null;

  const user = buildUserPrompt(
    companyProfile,
    {
      id: pid,
      name: practice.name.trim(),
      description: practice.description ?? null,
    },
    currentLinked,
    catalogue,
    capabilityAreas,
    stableAnchors,
  );

  const system = `You help refine **practice coverage** for Capability Studio.

Rules:
• Practices are **contextual lenses** only — they do not own the taxonomy.
• Prefer **linking existing subjects** (category A) before proposing **new subject areas** (category B).
• Output **only** valid JSON with keys link_existing and missing_areas.
• Respect settled/protected labels as stable anchors.
• Avoid duplicate or near-duplicate subject names relative to the catalogue.

No markdown fences.`;

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

    const parsed = parseResult(content, catalogueIds, pid, catalogueById);
    return jsonResponse(parsed, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected server error.";
    console.error("refine-practice-coverage:", e);
    return jsonResponse({ error: msg }, 500);
  }
});
