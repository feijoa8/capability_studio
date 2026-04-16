import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Buffer } from "node:buffer";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { extractText } from "npm:unpdf@0.12.1";
import mammoth from "npm:mammoth@1.8.0";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_TEXT_CHARS = 120_000;
const LOG = "import-cv-extract";

function msSince(start: number): number {
  return Math.round(performance.now() - start);
}

/** Segment duration + optional cumulative from request start (ms). */
function timing(
  segment: string,
  ms: number,
  cumulativeFromRequest?: number,
): void {
  const d: Record<string, string | number> = { segment, ms };
  if (cumulativeFromRequest !== undefined) {
    d.cumulative_ms = cumulativeFromRequest;
  }
  console.log(`${LOG}: timing`, JSON.stringify(d));
}

/** Concise stage logs (no per-row CV data). */
function stage(
  message: string,
  detail?: Record<string, string | number | boolean | null>,
): void {
  if (detail && Object.keys(detail).length > 0) {
    console.log(`${LOG}: ${message}`, JSON.stringify(detail));
  } else {
    console.log(`${LOG}: ${message}`);
  }
}

/** Log once when a value used as text is not a string (coercion still applied). */
function logNonStringField(field: string, value: unknown): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string") return;
  console.log(
    `${LOG}: non_string_field field=${field} typeof=${typeof value}`,
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Coerce PDF/DOCX extractor output to a single plain string (never assumes .trim() exists). */
function toPlainString(value: unknown, field = "value"): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  logNonStringField(field, value);
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value).trim();
  }
  if (typeof value === "boolean") return value ? "true" : "";
  if (Array.isArray(value)) {
    return value
      .map((x, i) => toPlainString(x, `${field}[${i}]`))
      .filter((s) => s.length > 0)
      .join("\n")
      .trim();
  }
  return "";
}

function normalizePdfExtractResult(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result.trim();
  if (typeof result !== "object") {
    logNonStringField("pdf_extract.root", result);
    return toPlainString(result, "pdf_extract.root");
  }
  const r = result as Record<string, unknown>;
  if ("text" in r) {
    return toPlainString(r.text, "pdf_extract.text");
  }
  console.warn(`${LOG}: PDF extract missing text key`, Object.keys(r));
  return "";
}

function sanitizeFilename(name: unknown): string {
  const base = String(name ?? "cv")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 80);
  return base || "cv";
}

/** Multipart text fields must be strings; `form.get` can be a File for misnamed parts. */
function formTextField(form: FormData, key: string): string | null {
  const v = form.get(key);
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  return null;
}

function truthyFormFlag(raw: string | null): boolean {
  if (raw === null) return false;
  const t = raw.trim().toLowerCase();
  return t === "true" || t === "1" || t === "yes" || t === "on";
}

async function extractPlainText(
  bytes: Uint8Array,
  mime: string,
  filename: string,
): Promise<string> {
  const lower = String(filename ?? "").toLowerCase();
  const isPdf =
    mime === "application/pdf" ||
    lower.endsWith(".pdf");
  const isDocx =
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx");

  if (isPdf) {
    const raw = await extractText(bytes);
    console.log(
      `${LOG}: pdf_raw typeof=${typeof raw} is_array=${Array.isArray(raw)}`,
    );
    const plain = normalizePdfExtractResult(raw);
    if (!plain && raw != null && typeof raw === "object") {
      console.warn(`${LOG}: PDF extract empty; keys`, Object.keys(raw as object));
    }
    return plain;
  }

  if (isDocx) {
    const result = await mammoth.extractRawText({
      buffer: Buffer.from(bytes),
    });
    return toPlainString(result.value, "docx_extract.value");
  }

  throw new Error("Unsupported file type. Use PDF or DOCX.");
}

type CvExtractShape = {
  work_experience: unknown[];
  projects: unknown[];
  qualifications: unknown[];
  certifications: unknown[];
  profile: Record<string, unknown> | null;
};

/**
 * Build section arrays. Returns error field name if a section is present but not array/object-wrappable.
 */
function normalizeExtracted(
  raw: unknown,
): { ok: true; shape: CvExtractShape } | { ok: false; field: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: true,
      shape: {
        work_experience: [],
        projects: [],
        qualifications: [],
        certifications: [],
        profile: null,
      },
    };
  }
  const o = raw as Record<string, unknown>;
  const SECTION_KEYS = [
    "work_experience",
    "projects",
    "qualifications",
    "certifications",
  ] as const;

  for (const k of SECTION_KEYS) {
    if (!(k in o)) continue;
    const v = o[k];
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) continue;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) continue;
    return { ok: false, field: k };
  }

  if ("profile" in o) {
    const p = o.profile;
    if (p !== null && p !== undefined) {
      if (typeof p !== "object" || Array.isArray(p)) {
        return { ok: false, field: "profile" };
      }
    }
  }

  const arr = (k: (typeof SECTION_KEYS)[number]): unknown[] => {
    const v = o[k];
    if (v === null || v === undefined) return [];
    if (Array.isArray(v)) return v as unknown[];
    if (typeof v === "object" && v !== null) return [v];
    return [];
  };

  let profile: Record<string, unknown> | null = null;
  if ("profile" in o) {
    const p = o.profile;
    if (p !== null && p !== undefined && typeof p === "object" && !Array.isArray(p)) {
      profile = p as Record<string, unknown>;
    }
  }

  return {
    ok: true,
    shape: {
      work_experience: arr("work_experience"),
      projects: arr("projects"),
      qualifications: arr("qualifications"),
      certifications: arr("certifications"),
      profile,
    },
  };
}

function asOpenAiMessageContent(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw.trim();
  return toPlainString(raw, "openai.message.content");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed. Use POST." }, 405);
  }

  stage("request_received");
  const requestStart = performance.now();

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse({ error: "Supabase is not configured." }, 500);
  }
  if (!serviceKey) {
    return jsonResponse({ error: "Service role key is not configured." }, 500);
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
  const userId = userData.user.id;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonResponse({ error: "Expected multipart form data." }, 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return jsonResponse({ error: "Missing file field." }, 400);
  }

  const storeCv = truthyFormFlag(formTextField(form, "storeCv"));

  /** Personal CV extract: no org; do not require organisationId or workspace membership. */
  let personalProfile =
    truthyFormFlag(formTextField(form, "personalProfile")) ||
    truthyFormFlag(formTextField(form, "personal_profile"));
  const extractKind = formTextField(form, "extractKind")?.trim().toLowerCase();
  if (
    extractKind === "personal_profile" ||
    extractKind === "personal"
  ) {
    personalProfile = true;
  }

  const organisationIdRaw = form.get("organisationId");
  const organisationId =
    typeof organisationIdRaw === "string" ? organisationIdRaw.trim() : "";

  // If the multipart flag was lost/misparsed but the caller sent no org id, allow
  // authenticated Personal accounts (matches My Experience personal import).
  if (!personalProfile && !organisationId) {
    const { data: prof, error: profErr } = await userClient
      .from("profiles")
      .select("primary_account_type")
      .eq("id", userId)
      .maybeSingle();
    if (!profErr && prof?.primary_account_type === "personal") {
      personalProfile = true;
    }
  }

  let organisationIdForStorage: string | null = null;

  if (!personalProfile) {
    if (!organisationId) {
      return jsonResponse({ error: "organisationId is required." }, 400);
    }
    organisationIdForStorage = organisationId;

    const { data: membership, error: memErr } = await userClient
      .from("workspace_memberships")
      .select("id")
      .eq("user_id", userId)
      .eq("organisation_id", organisationId)
      .maybeSingle();

    if (memErr) {
      console.error("import-cv-extract membership:", memErr.message);
      return jsonResponse({ error: "Could not verify workspace membership." }, 403);
    }
    if (!membership) {
      return jsonResponse({ error: "Not a member of this workspace." }, 403);
    }
  }

  const mime = file.type || "application/octet-stream";
  const filename = file.name || "cv";
  const tFileRead = performance.now();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const msFileRead = msSince(tFileRead);
  timing("file_read", msFileRead, msSince(requestStart));

  if (bytes.byteLength < 16) {
    return jsonResponse({ error: "File is empty or too small." }, 400);
  }
  if (bytes.byteLength > 10 * 1024 * 1024) {
    return jsonResponse({ error: "File must be 10MB or smaller." }, 400);
  }

  stage("file_metadata", {
    name: String(filename).slice(0, 120),
    mime: String(mime).slice(0, 80),
    size: bytes.byteLength,
  });

  let storedMeta: {
    id: string;
    storage_path: string;
  } | null = null;
  let replacedPersonalCvCount = 0;
  let msStorage = 0;

  if (storeCv) {
    const tStorage = performance.now();
    const admin = createClient(supabaseUrl, serviceKey);
    const objectPath = `${userId}/${crypto.randomUUID()}_${sanitizeFilename(filename)}`;
    const { error: upErr } = await admin.storage.from("cv-uploads").upload(
      objectPath,
      bytes,
      {
        contentType: mime,
        upsert: false,
      },
    );
    if (upErr) {
      console.error("cv-uploads upload:", upErr.message);
      return jsonResponse(
        { error: `Could not store file: ${upErr.message}` },
        500,
      );
    }

    const { data: row, error: insErr } = await admin
      .from("user_cv_uploads")
      .insert({
        user_id: userId,
        organisation_id: organisationIdForStorage,
        storage_path: objectPath,
        original_filename: filename,
        mime_type: mime,
        file_size_bytes: bytes.byteLength,
      })
      .select("id, storage_path")
      .single();

    if (insErr || !row) {
      console.error("user_cv_uploads insert:", insErr?.message);
      try {
        await admin.storage.from("cv-uploads").remove([objectPath]);
      } catch {
        /* best effort */
      }
      return jsonResponse({ error: "Could not save file metadata." }, 500);
    }
    storedMeta = { id: row.id as string, storage_path: row.storage_path as string };

    // Personal account path (no organisation id): keep one "current CV" reference.
    // Latest upload wins; older personal rows + storage objects are cleaned up best-effort.
    if (personalProfile && organisationIdForStorage === null) {
      const { data: prevRows, error: prevErr } = await admin
        .from("user_cv_uploads")
        .select("id, storage_path")
        .eq("user_id", userId)
        .is("organisation_id", null)
        .neq("id", storedMeta.id)
        .limit(25);

      if (prevErr) {
        console.warn(`${LOG}: personal_cv_cleanup_select_failed`, prevErr.message);
      } else if (prevRows && prevRows.length > 0) {
        const ids = prevRows
          .map((r) => (r as { id?: unknown }).id)
          .filter((id): id is string => typeof id === "string" && id.length > 0);
        const paths = prevRows
          .map((r) => (r as { storage_path?: unknown }).storage_path)
          .filter((p): p is string => typeof p === "string" && p.length > 0);

        if (paths.length > 0) {
          try {
            await admin.storage.from("cv-uploads").remove(paths);
          } catch {
            /* best effort */
          }
        }
        if (ids.length > 0) {
          const { error: delErr } = await admin
            .from("user_cv_uploads")
            .delete()
            .in("id", ids);
          if (delErr) {
            console.warn(`${LOG}: personal_cv_cleanup_delete_failed`, delErr.message);
          } else {
            replacedPersonalCvCount = ids.length;
          }
        }
      }
    }

    msStorage = msSince(tStorage);
    timing("optional_cv_storage", msStorage, msSince(requestStart));
  }

  let plain: string;
  let msExtract = 0;
  try {
    stage("extraction_started");
    const tExtract = performance.now();
    plain = await extractPlainText(bytes, mime, filename);
    msExtract = msSince(tExtract);
    timing("text_extraction", msExtract, msSince(requestStart));
    stage("extraction_completed", {
      length: plain.length,
      typeof_plain: typeof plain,
    });
  } catch (e) {
    stage("extraction_failed");
    const errName = e instanceof Error ? e.name : "Error";
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(
      `${LOG}: extractPlainText failed`,
      errName,
      errMsg.slice(0, 200),
    );
    return jsonResponse(
      {
        error:
          "Could not read text from this file. Try another PDF export or use DOCX.",
        code: "EXTRACTION_FAILED",
      },
      400,
    );
  }

  if (!plain || plain.length < 40) {
    return jsonResponse(
      {
        error:
          "Very little text could be extracted. Try another file or a text-based PDF.",
      },
      400,
    );
  }

  const clipped = plain.length > MAX_TEXT_CHARS
    ? plain.slice(0, MAX_TEXT_CHARS)
    : plain;
  const truncated = plain.length > MAX_TEXT_CHARS;

  const model = Deno.env.get("OPENAI_MODEL")?.trim() || "gpt-4o-mini";

  const system = `You extract structured resume/CV data for a workforce evidence app. Output ONLY valid JSON (no markdown fences, no commentary).

## Extraction priority (source of truth)
1. **PRIMARY:** Each **role description** and **project description** (narrative bullets/paragraphs: what was done, how, for whom, with what outcomes). Mine these thoroughly for skills, methods, tools, and industry.
2. **SECONDARY:** Explicit “skills” / competency **lists** and profile keywords — use only to **supplement** or disambiguate when they reinforce narrative evidence. Never let a shallow list **replace** richer description-based tags.
3. Prefer **phrases grounded in actual work performed** in that entry (paraphrase closely to the CV; do not invent activities not implied by the text).

## Target tag density (per work_experience row and per project row)
Aim for a **comprehensive, non-redundant** set when the CV has enough content. **Do not under-extract** to keep arrays short; **slight over-inclusion** of evidence-backed tags is better than omitting real signals.
- **skills:** about **5–10** when the description supports it (fewer only if the entry is genuinely thin).
- **methods:** about **3–6** when applicable.
- **tools:** about **2–5** when platforms/products are mentioned or clearly implied.
- **industry:** **one** primary \`industry\` string per row; if two sectors clearly apply, use a single concise label (e.g. "Telecommunications / Technology"). Use \`null\` only when unclear.

## Read the whole CV; treat these as different signal types
1. Explicit skills/competency sections (**secondary** hints)
2. Profile / summary / objective
3. Each work experience: title, employer, dates, **full description** (**primary**)
4. Each project: name, client, **full description** (**primary**)
5. Qualifications and certifications (extract those sections faithfully; do not move degree titles into skills)
6. Named tools/platforms anywhere in the relevant entry
7. **Company / client / domain context** for industry inference

## JSON schema (shape must match exactly)
{
  "profile": {
    "first_name": string | null,
    "last_name": string | null,
    "summary": string | null,
    "location": string | null,
    "linkedin_url": string | null
  },
  "work_experience": [
    {
      "role_title": string,
      "organisation_name": string,
      "description": string | null,
      "start_date": string | null,
      "end_date": string | null,
      "is_current": boolean,
      "industry": string | null,
      "skills": string[],
      "methods": string[],
      "tools": string[]
    }
  ],
  "projects": [
    {
      "project_name": string,
      "client": string | null,
      "role": string | null,
      "description": string | null,
      "start_date": string | null,
      "end_date": string | null,
      "industry": string | null,
      "skills": string[],
      "methods": string[],
      "tools": string[],
      "parent_role_title_hint": string | null,
      "parent_organisation_hint": string | null
    }
  ],
  "qualifications": [
    {
      "title": string,
      "issuer": string | null,
      "qualification_type": string | null,
      "date_achieved": string | null,
      "notes": string | null,
      "credential_url": string | null
    }
  ],
  "certifications": [
    {
      "title": string,
      "issuer": string | null,
      "issue_date": string | null,
      "expiry_date": string | null,
      "renewal_required": boolean,
      "notes": string | null,
      "credential_url": string | null
    }
  ]
}

## Four categories — classification (do not collapse buckets)

**skills** — **Execution-level capabilities**: concrete activities, deliverables, analytical or delivery **techniques** the person applied in that role/project.
Examples: "Customer Journey Mapping", "Requirements Definition", "User Story Definition", "Acceptance Criteria Definition", "Backlog Refinement", "Thematic Analysis", "Root Cause Analysis", "Data Interpretation", "User Interviews", "Insight Synthesis", "Workshop Facilitation", "Process Mapping", "Business Case Development".
Put **named methodologies** (Scrum, Agile, Design Thinking) under **methods**, not skills — unless the CV describes a distinct facilitated activity (e.g. "Sprint Planning Facilitation" → skill; "Scrum" → method).

**methods** — **Structured ways of working**: frameworks, delivery models, named practices.
Examples: "Agile", "Scrum", "Kanban", "Waterfall", "Design Thinking", "Human-Centred Design", "Lean Six Sigma", "SAFe".

**tools** — **Named platforms/products** (software, cloud, vendor systems).
Examples: "Jira", "Miro", "Confluence", "Azure DevOps", "Microsoft Azure", "Microsoft 365", "Salesforce".
Merge obvious variants (e.g. "MS Azure" → "Microsoft Azure"). Do not put methods here.

**industry** — **Domain/sector** for that entry: prefer explicit sector terms; otherwise **infer** from employer, client, project name, or description (stable labels like Telecommunications, Insurance, Government, Financial Services).

## Secondary signal types — include when descriptions support them
Do **not** drop these classes of tags if they appear explicitly or clearly in role/project narrative (map to **skills** unless they are clearly a named method or tool):
- **Analytical techniques:** e.g. thematic analysis, root cause analysis, data interpretation, trend analysis.
- **Requirements / delivery techniques:** e.g. requirements definition, backlog refinement, acceptance criteria definition, user story writing.
- **Research & discovery:** e.g. user interviews, journey mapping, insight synthesis, persona development (when described as work done).

## Deduplication
- Remove **exact** duplicates only (same wording repeated).
- Do **not** merge **distinct** concepts: e.g. "Requirements Definition" ≠ "User Story Definition"; "Thematic Analysis" ≠ "Customer Feedback Analysis"; "Customer Journey Mapping" ≠ "Service Blueprinting" unless the CV treats them as the same.

## DROP rules (narrow — avoid over-filtering)
**DROP only** as tag text (skills/methods/tools):
- Generic **soft skills:** communication, leadership, teamwork, collaboration (and near-synonyms) when used only as fluff.
- **Vague self-descriptors:** e.g. results-driven, strategic thinker, detail-oriented (not execution techniques).
- **Job titles** repeated as capability tags: e.g. "Business Analyst", "Project Manager", "Product Manager" (the role_title field already captures the title).

**Do NOT drop** because they sound “broad” if the CV **describes doing that work** in context:
- Specific **analytical** or **delivery** techniques (including those listed above).
- **Domain-specific execution** activities grounded in the narrative.

Still omit **low-information** single words with no domain meaning in context (e.g. lone "Strategy", "Digital", "Technology", "AI") unless part of a **specific, evidenced** phrase.

Place each concept in the **single best** bucket (no duplicate across skills/methods/tools for the same meaning).

## Explicit skills lists
- Use only as **secondary** confirmation; narrative descriptions **win** for richness and specificity.
- When the list and narrative align, include both granular tags implied by the narrative.

## General row rules
- profile: only if clearly supported; linkedin_url must be full https when present.
- Dates: YYYY-MM-DD or null.
- work_experience: reverse-chronological; merge obvious duplicate roles.
- projects: distinct engagements only; set parent_role_title_hint and parent_organisation_hint to tie to the employer/role the project belongs with.
- qualifications vs certifications: degrees/diplomas → qualifications; vendor certs, licenses, short credentials → certifications.
- Use [] for empty skills/methods/tools arrays only when the entry truly has no extractable signal.
- **Do not fabricate** employers, dates, or credentials. For tags: **extract fully** from text that supports them; do not invent activities with no basis in the CV.`;

  const userPrompt =
    `Parse the CV below into the JSON schema. **Role and project descriptions are primary:** aim for rich, evidence-backed skills (target ~5–10), methods (~3–6), and tools (~2–5) per entry when the text supports it. Use skills-list sections only as secondary hints. Infer industry from employer/client/context. Do not drop valid analytical or delivery techniques that appear in narratives.\n\n---\n${clipped}\n---`;

  let msAi = 0;
  try {
    stage("ai_parse_started");
    const tAi = performance.now();
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
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: userPrompt },
          ],
        }),
      },
    );

    const rawText = await openaiRes.text();
    msAi = msSince(tAi);
    timing("ai_parse_fetch_and_body", msAi, msSince(requestStart));
    stage("ai_parse_completed", {
      http_status: openaiRes.status,
      response_chars: rawText.length,
    });
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
      console.error(`${LOG}: OpenAI HTTP error`, detail.slice(0, 200));
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
      stage("openai_completion_json_parse_failed");
      return jsonResponse(
        {
          error: "OpenAI response was not valid JSON.",
          code: "OPENAI_RESPONSE_NOT_JSON",
        },
        502,
      );
    }
    const rawContent = completion.choices?.[0]?.message?.content;
    const content = asOpenAiMessageContent(rawContent);
    if (!content) {
      const cType = rawContent === null || rawContent === undefined
        ? "null/undefined"
        : typeof rawContent;
      console.warn(`${LOG}: empty OpenAI content`, cType);
      return jsonResponse(
        {
          error: "OpenAI returned empty content.",
          code: "OPENAI_EMPTY",
        },
        502,
      );
    }

    const tNormalize = performance.now();
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(content) as unknown;
      stage("json_parsed_ok");
    } catch (parseErr) {
      console.warn(
        `${LOG}: JSON.parse failed`,
        parseErr instanceof Error ? parseErr.message.slice(0, 120) : "?",
      );
      return jsonResponse(
        {
          error: "The model returned text that was not valid JSON.",
          code: "OPENAI_JSON_PARSE",
        },
        502,
      );
    }

    stage("normalization_started");
    const normalized = normalizeExtracted(parsedJson);
    const msNormalize = msSince(tNormalize);
    timing("json_parse_and_normalize", msNormalize, msSince(requestStart));
    if (!normalized.ok) {
      stage("normalization_failed", { field: normalized.field });
      return jsonResponse(
        {
          error:
            `Invalid extracted/parsed field type for ${normalized.field}`,
          code: "INVALID_FIELD_TYPE",
          field: normalized.field,
        },
        400,
      );
    }
    const extracted = normalized.shape;
    stage("normalization_completed", {
      work_experience: extracted.work_experience.length,
      projects: extracted.projects.length,
      qualifications: extracted.qualifications.length,
      certifications: extracted.certifications.length,
      profile: extracted.profile ? 1 : 0,
    });

    const msTotal = msSince(requestStart);
    console.log(
      `${LOG}: timing_summary`,
      JSON.stringify({
        ms_total: msTotal,
        ms_file_read: msFileRead,
        ms_optional_storage: storeCv ? msStorage : 0,
        ms_text_extraction: msExtract,
        ms_ai_parse_fetch_and_body: msAi,
        ms_json_parse_and_normalize: msNormalize,
      }),
    );
    stage("response_return", { ms_total: msTotal });
    return jsonResponse({
      extracted,
      meta: {
        text_length: plain.length,
        truncated,
        stored_cv: storedMeta,
        replaced_personal_cv_count: replacedPersonalCvCount,
        filename,
        mime,
      },
    });
  } catch (e) {
    const errName = e instanceof Error ? e.name : "Error";
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(
      `${LOG}: pipeline_error`,
      errName,
      errMsg.slice(0, 200),
    );
    return jsonResponse(
      {
        error: "CV import failed on the server. Please try again.",
        code: "INTERNAL_ERROR",
      },
      500,
    );
  }
});
