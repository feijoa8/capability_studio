import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CompanyProfileInput = Record<string, unknown> | null;

type PracticeInput = {
  id: string;
  name: string;
  description?: string | null;
  reference_framework?: string | null;
};

type CompetencyIn = { id: string; name: string };
type SubjectIn = {
  id: string;
  name: string;
  competencies: CompetencyIn[];
};
type CapabilityAreaIn = {
  id: string;
  name: string;
  subjects: SubjectIn[];
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normKey(s: string): string {
  return s.trim().toLowerCase();
}

function buildOrgTaxonomyBlock(areas: CapabilityAreaIn[]): string {
  return areas
    .map((area) => {
      const subBlocks = area.subjects.map((s) => {
        const compLines = s.competencies.length
          ? s.competencies
              .map(
                (c) =>
                  `      • org competency id=${c.id} | ${c.name.trim().slice(0, 200)}`,
              )
              .join("\n")
          : "      (no org competencies under this competency_subject)";
        return [
          `    Org competency_subject id=${s.id} | ${s.name.trim().slice(0, 200)}`,
          "    Org competencies:",
          compLines,
        ].join("\n");
      });
      return [
        `Org capability area id=${area.id} | ${area.name.trim().slice(0, 200)}`,
        " Org competency_subjects:",
        subBlocks.join("\n\n"),
      ].join("\n");
    })
    .join("\n\n");
}

function buildReferenceTaxonomyBlock(areas: CapabilityAreaIn[]): string {
  if (areas.length === 0) {
    return "(No shared reference library slice was supplied — rely on org taxonomy only.)";
  }
  return areas
    .map((area) => {
      const subBlocks = area.subjects.map((s) => {
        const compLines = s.competencies.length
          ? s.competencies
              .map(
                (c) =>
                  `      • reference competency id=${c.id} | ${c.name.trim().slice(0, 200)}`,
              )
              .join("\n")
          : "      (no reference competencies)";
        return [
          `    Reference subject id=${s.id} | ${s.name.trim().slice(0, 200)}`,
          "    Reference competencies:",
          compLines,
        ].join("\n");
      });
      return [
        `Reference capability area id=${area.id} | ${area.name.trim().slice(0, 200)}`,
        " Reference subjects:",
        subBlocks.join("\n\n"),
      ].join("\n");
    })
    .join("\n\n");
}

function buildUserPrompt(
  companyProfile: CompanyProfileInput,
  practice: PracticeInput,
  orgAreas: CapabilityAreaIn[],
  referenceAreas: CapabilityAreaIn[],
): string {
  const cp =
    companyProfile &&
    typeof companyProfile === "object" &&
    !Array.isArray(companyProfile)
      ? (companyProfile as Record<string, unknown>)
      : null;
  const orgBlock = cp
    ? [
        typeof cp.organisation_name === "string" && cp.organisation_name.trim() &&
          `Organisation: ${String(cp.organisation_name).trim()}`,
        typeof cp.sector === "string" && cp.sector.trim() &&
          `Sector: ${String(cp.sector).trim()}`,
        typeof cp.industry === "string" && cp.industry.trim() &&
          `Industry: ${String(cp.industry).trim()}`,
        typeof cp.summary === "string" && cp.summary.trim() &&
          `Summary: ${String(cp.summary).trim().slice(0, 800)}`,
      ]
        .filter(Boolean)
        .join("\n")
    : "(No organisation profile.)";

  const prDesc = practice.description?.trim()
    ? practice.description.trim().slice(0, 900)
    : "(No description.)";

  const refFw = practice.reference_framework?.trim()
    ? practice.reference_framework.trim().slice(0, 200)
    : null;

  const orgTax = buildOrgTaxonomyBlock(orgAreas);
  const refTax = buildReferenceTaxonomyBlock(referenceAreas);

  return `## Organisation context
${orgBlock}

## Practice (context layer only — does not own the taxonomy)
id=${practice.id}
name=${practice.name.trim()}
description: ${prDesc}
reference_framework: ${refFw ?? "(none — infer sensible best-practice alignment)"}

## Organisation taxonomy (competency_subjects → competencies)
Use **only** org competency_subject_id and org competency_id values from this tree for organisation matches.
${orgTax}

## Shared reference library (read-only catalogue — adopt into org separately)
Use **only** reference competency id values from this block in **reference_competencies**. These are not org rows until adopted.
${refTax}

## Task
Return **only** valid JSON with this exact shape (no markdown fences):
{
  "relevant_subjects": [
    { "subject_id": "<org competency_subject uuid>", "reason": "<short string>" }
  ],
  "relevant_competencies": [
    { "competency_id": "<org competency uuid>", "reason": "<short string>" }
  ],
  "reference_competencies": [
    { "reference_competency_id": "<reference competency uuid from reference library block>", "reason": "<short string>" }
  ],
  "missing_competencies": [
    { "subject_id": "<org competency_subject uuid>", "name": "<new org competency name>", "reason": "<short string>" }
  ],
  "notes": {
    "coverage_gaps": ["<optional bullet strings>"],
    "framework_alignment": ["<optional bullet strings>"]
  }
}

Rules:
• **Priority**: Prefer existing **organisation** competencies; then **reference_competencies** for gaps; then **missing_competencies** only when neither covers the need.
• **Never** invent org subject_id, org competency_id, or reference_competency_id — only values appearing in the inputs above.
• **Never** propose new org competency_subjects or capability areas. **missing_competencies** MUST use an existing org competency_subject_id.
• **reference_competencies** MUST use ids from the reference library block; omit the array if the reference block is empty.
• **Duplicates**: do not suggest a missing competency whose name matches an existing org competency on the same org subject (case-insensitive).
• **reference_framework**: If set, align thinking to that model and map to closest org subjects and reference competencies — without inventing structure.
• Keep competency names short, observable, and reusable.
• **notes.coverage_gaps** / **notes.framework_alignment**: concise diagnostics.`;
}

function parseStrictResult(
  content: string,
  validOrgSubjectIds: Set<string>,
  validOrgCompetencyIds: Set<string>,
  orgCompetencySubjectId: Map<string, string>,
  existingOrgNameKeysBySubject: Map<string, Set<string>>,
  validReferenceCompetencyIds: Set<string>,
  referenceCompetencySubjectId: Map<string, string>,
): {
  relevant_subjects: { subject_id: string; reason: string }[];
  relevant_competencies: { competency_id: string; reason: string }[];
  reference_competencies: { reference_competency_id: string; reason: string }[];
  missing_competencies: { subject_id: string; name: string; reason: string }[];
  notes: { coverage_gaps: string[]; framework_alignment: string[] };
} {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return {
      relevant_subjects: [],
      relevant_competencies: [],
      reference_competencies: [],
      missing_competencies: [],
      notes: { coverage_gaps: [], framework_alignment: [] },
    };
  }

  const relevant_subjects: { subject_id: string; reason: string }[] = [];
  const rs = raw.relevant_subjects;
  if (Array.isArray(rs)) {
    const seen = new Set<string>();
    for (const row of rs) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const subject_id =
        typeof o.subject_id === "string" ? o.subject_id.trim() : "";
      const reason =
        typeof o.reason === "string" ? o.reason.trim().slice(0, 600) : "";
      if (!subject_id || !validOrgSubjectIds.has(subject_id)) continue;
      if (seen.has(subject_id)) continue;
      seen.add(subject_id);
      relevant_subjects.push({ subject_id, reason: reason || "—" });
    }
  }

  const relevant_competencies: { competency_id: string; reason: string }[] = [];
  const rc = raw.relevant_competencies;
  if (Array.isArray(rc)) {
    const seen = new Set<string>();
    for (const row of rc) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const competency_id =
        typeof o.competency_id === "string" ? o.competency_id.trim() : "";
      const reason =
        typeof o.reason === "string" ? o.reason.trim().slice(0, 600) : "";
      if (!competency_id || !validOrgCompetencyIds.has(competency_id)) continue;
      if (seen.has(competency_id)) continue;
      seen.add(competency_id);
      relevant_competencies.push({ competency_id, reason: reason || "—" });
    }
  }

  const reference_competencies: {
    reference_competency_id: string;
    reason: string;
  }[] = [];
  const rr = raw.reference_competencies;
  if (Array.isArray(rr) && validReferenceCompetencyIds.size > 0) {
    const seen = new Set<string>();
    for (const row of rr) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const rid =
        typeof o.reference_competency_id === "string"
          ? o.reference_competency_id.trim()
          : "";
      const reason =
        typeof o.reason === "string" ? o.reason.trim().slice(0, 600) : "";
      if (!rid || !validReferenceCompetencyIds.has(rid)) continue;
      if (seen.has(rid)) continue;
      seen.add(rid);
      reference_competencies.push({
        reference_competency_id: rid,
        reason: reason || "—",
      });
    }
  }

  const missing_competencies: {
    subject_id: string;
    name: string;
    reason: string;
  }[] = [];
  const mc = raw.missing_competencies;
  if (Array.isArray(mc)) {
    const seenKeys = new Set<string>();
    for (const row of mc) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const subject_id =
        typeof o.subject_id === "string" ? o.subject_id.trim() : "";
      const name = typeof o.name === "string" ? o.name.trim() : "";
      const reason =
        typeof o.reason === "string" ? o.reason.trim().slice(0, 600) : "";
      if (!subject_id || !validOrgSubjectIds.has(subject_id)) continue;
      if (!name || name.length > 220) continue;
      const nk = normKey(name);
      const existing = existingOrgNameKeysBySubject.get(subject_id);
      if (existing?.has(nk)) continue;
      const dedupe = `${subject_id}::${nk}`;
      if (seenKeys.has(dedupe)) continue;
      seenKeys.add(dedupe);
      missing_competencies.push({
        subject_id,
        name: name.slice(0, 200),
        reason: reason || "—",
      });
    }
  }

  const notesRaw = raw.notes;
  const coverage_gaps: string[] = [];
  const framework_alignment: string[] = [];
  if (notesRaw && typeof notesRaw === "object" && !Array.isArray(notesRaw)) {
    const n = notesRaw as Record<string, unknown>;
    if (Array.isArray(n.coverage_gaps)) {
      for (const x of n.coverage_gaps) {
        if (typeof x === "string" && x.trim()) {
          coverage_gaps.push(x.trim().slice(0, 500));
        }
      }
    }
    if (Array.isArray(n.framework_alignment)) {
      for (const x of n.framework_alignment) {
        if (typeof x === "string" && x.trim()) {
          framework_alignment.push(x.trim().slice(0, 500));
        }
      }
    }
  }

  const orgCompNameBySubject = new Map<string, Set<string>>();
  for (const c of relevant_competencies) {
    const sid = orgCompetencySubjectId.get(c.competency_id) ?? "";
    if (!sid) continue;
    if (!orgCompNameBySubject.has(sid)) {
      orgCompNameBySubject.set(sid, new Set());
    }
    /* name enrichment not available here — duplicate filtering against missing uses existingOrgNameKeysBySubject only */
  }

  void orgCompNameBySubject;

  const missingFiltered = missing_competencies.filter((m) => {
    const set = existingOrgNameKeysBySubject.get(m.subject_id);
    return !set?.has(normKey(m.name));
  });

  /* Drop reference suggestions that duplicate an org competency name on the mapped org subject (by reference parent subject → not known here). Client may re-filter. */

  void referenceCompetencySubjectId;

  return {
    relevant_subjects,
    relevant_competencies,
    reference_competencies,
    missing_competencies: missingFiltered,
    notes: { coverage_gaps, framework_alignment },
  };
}

function collectOrgValidationSets(areas: CapabilityAreaIn[]): {
  validOrgSubjectIds: Set<string>;
  validOrgCompetencyIds: Set<string>;
  orgCompetencySubjectId: Map<string, string>;
  existingOrgNameKeysBySubject: Map<string, Set<string>>;
} {
  const validOrgSubjectIds = new Set<string>();
  const validOrgCompetencyIds = new Set<string>();
  const orgCompetencySubjectId = new Map<string, string>();
  const existingOrgNameKeysBySubject = new Map<string, Set<string>>();

  for (const area of areas) {
    if (!Array.isArray(area.subjects)) continue;
    for (const sub of area.subjects) {
      const sid = typeof sub.id === "string" ? sub.id.trim() : "";
      if (!sid) continue;
      validOrgSubjectIds.add(sid);
      if (!existingOrgNameKeysBySubject.has(sid)) {
        existingOrgNameKeysBySubject.set(sid, new Set());
      }
      const nameSet = existingOrgNameKeysBySubject.get(sid)!;
      if (Array.isArray(sub.competencies)) {
        for (const c of sub.competencies) {
          const cid = typeof c.id === "string" ? c.id.trim() : "";
          const cname = typeof c.name === "string" ? c.name.trim() : "";
          if (!cid || !cname) continue;
          validOrgCompetencyIds.add(cid);
          orgCompetencySubjectId.set(cid, sid);
          nameSet.add(normKey(cname));
        }
      }
    }
  }

  return {
    validOrgSubjectIds,
    validOrgCompetencyIds,
    orgCompetencySubjectId,
    existingOrgNameKeysBySubject,
  };
}

function collectReferenceValidationSets(areas: CapabilityAreaIn[]): {
  validReferenceCompetencyIds: Set<string>;
  referenceCompetencySubjectId: Map<string, string>;
} {
  const validReferenceCompetencyIds = new Set<string>();
  const referenceCompetencySubjectId = new Map<string, string>();

  for (const area of areas) {
    if (!Array.isArray(area.subjects)) continue;
    for (const sub of area.subjects) {
      const sid = typeof sub.id === "string" ? sub.id.trim() : "";
      if (!sid) continue;
      if (Array.isArray(sub.competencies)) {
        for (const c of sub.competencies) {
          const cid = typeof c.id === "string" ? c.id.trim() : "";
          if (!cid) continue;
          validReferenceCompetencyIds.add(cid);
          referenceCompetencySubjectId.set(cid, sid);
        }
      }
    }
  }

  return { validReferenceCompetencyIds, referenceCompetencySubjectId };
}

function parseCapabilityAreasInput(raw: unknown): CapabilityAreaIn[] {
  const capabilityAreas: CapabilityAreaIn[] = [];
  if (!Array.isArray(raw)) return capabilityAreas;
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const ao = a as Record<string, unknown>;
    const aid = typeof ao.id === "string" ? ao.id.trim() : "";
    const aname = typeof ao.name === "string" ? ao.name.trim() : "";
    if (!aid || !aname) continue;
    const subjects: SubjectIn[] = [];
    const rawSubs = ao.subjects;
    if (Array.isArray(rawSubs)) {
      for (const s of rawSubs) {
        if (!s || typeof s !== "object") continue;
        const so = s as Record<string, unknown>;
        const sid = typeof so.id === "string" ? so.id.trim() : "";
        const sname = typeof so.name === "string" ? so.name.trim() : "";
        if (!sid || !sname) continue;
        const competencies: CompetencyIn[] = [];
        const rawComps = so.competencies;
        if (Array.isArray(rawComps)) {
          for (const c of rawComps) {
            if (!c || typeof c !== "object") continue;
            const co = c as Record<string, unknown>;
            const cid = typeof co.id === "string" ? co.id.trim() : "";
            const cname = typeof co.name === "string" ? co.name.trim() : "";
            if (!cid || !cname) continue;
            competencies.push({ id: cid, name: cname });
          }
        }
        subjects.push({ id: sid, name: sname, competencies });
      }
    }
    capabilityAreas.push({ id: aid, name: aname, subjects });
  }
  return capabilityAreas;
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
    companyProfile?: CompanyProfileInput;
    practice?: PracticeInput;
    capabilityAreas?: CapabilityAreaIn[];
    referenceCapabilityAreas?: CapabilityAreaIn[];
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
    typeof practice !== "object" ||
    typeof practice.id !== "string" ||
    !practice.id.trim() ||
    typeof practice.name !== "string" ||
    !practice.name.trim()
  ) {
    return jsonResponse(
      { error: "practice.id and practice.name are required." },
      400,
    );
  }

  const orgCapabilityAreas = parseCapabilityAreasInput(body.capabilityAreas);
  const referenceCapabilityAreas = parseCapabilityAreasInput(
    body.referenceCapabilityAreas,
  );

  if (orgCapabilityAreas.length === 0) {
    return jsonResponse(
      { error: "At least one org capability area with competency_subjects is required." },
      400,
    );
  }

  let totalOrgSubjects = 0;
  for (const a of orgCapabilityAreas) {
    totalOrgSubjects += a.subjects.length;
  }
  if (totalOrgSubjects === 0) {
    return jsonResponse(
      { error: "At least one org competency_subject is required in the taxonomy payload." },
      400,
    );
  }

  const {
    validOrgSubjectIds,
    validOrgCompetencyIds,
    orgCompetencySubjectId,
    existingOrgNameKeysBySubject,
  } = collectOrgValidationSets(orgCapabilityAreas);

  const { validReferenceCompetencyIds, referenceCompetencySubjectId } =
    collectReferenceValidationSets(referenceCapabilityAreas);

  const companyProfile =
    body.companyProfile &&
    typeof body.companyProfile === "object" &&
    !Array.isArray(body.companyProfile)
      ? body.companyProfile
      : null;

  const system = `You align a **Practice** (organisational context) with:
1) the **organisation taxonomy** (competency_subjects and competencies), and
2) an optional **shared reference library** slice (read-only catalogue).

Immutable rules:
• Output **only** JSON matching the user schema.
• Never invent UUIDs.
• Never propose creating new competency_subjects — only competencies under existing org subjects.
• Prefer org reuse, then reference catalogue, then missing new org competencies.

No markdown.`;

  const user = buildUserPrompt(
    companyProfile,
    practice,
    orgCapabilityAreas,
    referenceCapabilityAreas,
  );

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

    const parsed = parseStrictResult(
      content,
      validOrgSubjectIds,
      validOrgCompetencyIds,
      orgCompetencySubjectId,
      existingOrgNameKeysBySubject,
      validReferenceCompetencyIds,
      referenceCompetencySubjectId,
    );

    return jsonResponse(parsed, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected server error.";
    console.error("refine-practice-competencies:", e);
    return jsonResponse({ error: msg }, 500);
  }
});
