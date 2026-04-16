import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  buildSubjectNameNormalisationUserPrompt,
  type NormalisationRequestPayload,
  SUBJECT_NAME_NORMALISATION_SYSTEM_PROMPT,
} from "../_shared/subjectNameNormalisationPrompt.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function invokeErrorMessage(
  error: { message?: string; context?: unknown },
  data: unknown,
): Promise<string> {
  let msg = error.message ?? "Edge function request failed.";
  const ctx = error.context;
  if (ctx instanceof Response) {
    try {
      const text = await ctx.clone().text();
      if (text) {
        try {
          const parsed = JSON.parse(text) as { error?: string };
          if (typeof parsed.error === "string" && parsed.error.trim()) {
            msg = parsed.error.trim();
          }
        } catch {
          msg = text.length > 500 ? `${text.slice(0, 500)}…` : text;
        }
      }
    } catch {
      /* keep */
    }
  }
  if (data && typeof data === "object" && data !== null && "error" in data) {
    const e = (data as { error?: unknown }).error;
    if (typeof e === "string" && e.trim()) msg = e.trim();
  }
  return msg;
}

function parseBody(raw: unknown): NormalisationRequestPayload {
  if (!raw || typeof raw !== "object") {
    throw new Error("Request body must be a JSON object.");
  }
  const body = raw as Record<string, unknown>;
  const areasRaw = body.capabilityAreas;
  if (!Array.isArray(areasRaw) || areasRaw.length === 0) {
    throw new Error(
      "capabilityAreas must be a non-empty array of { capabilityAreaName, subjects }.",
    );
  }
  const capabilityAreas: NormalisationRequestPayload["capabilityAreas"] = [];
  for (const a of areasRaw) {
    if (!a || typeof a !== "object" || Array.isArray(a)) continue;
    const row = a as Record<string, unknown>;
    const capabilityAreaName =
      typeof row.capabilityAreaName === "string"
        ? row.capabilityAreaName.trim()
        : "";
    if (!capabilityAreaName) continue;
    const capabilityAreaId =
      row.capabilityAreaId === undefined || row.capabilityAreaId === null
        ? null
        : typeof row.capabilityAreaId === "string"
          ? row.capabilityAreaId.trim() || null
          : null;
    const subjRaw = row.subjects;
    const subjects: NormalisationRequestPayload["capabilityAreas"][0]["subjects"] =
      [];
    if (Array.isArray(subjRaw)) {
      for (const s of subjRaw) {
        if (!s || typeof s !== "object" || Array.isArray(s)) continue;
        const sr = s as Record<string, unknown>;
        const name = typeof sr.name === "string" ? sr.name.trim() : "";
        if (!name) continue;
        const subjectId =
          sr.subjectId === undefined || sr.subjectId === null
            ? null
            : typeof sr.subjectId === "string"
              ? sr.subjectId.trim() || null
              : null;
        const description =
          typeof sr.description === "string" ? sr.description.trim() : null;
        const category =
          typeof sr.category === "string" ? sr.category.trim() : null;
        subjects.push({
          subjectId,
          name,
          description: description || null,
          category: category || null,
        });
      }
    }
    capabilityAreas.push({
      capabilityAreaId,
      capabilityAreaName,
      subjects,
    });
  }
  if (capabilityAreas.length === 0) {
    throw new Error("No valid capability areas with names and subjects.");
  }
  const companyProfile =
    body.companyProfile === undefined || body.companyProfile === null
      ? null
      : typeof body.companyProfile === "object" && !Array.isArray(body.companyProfile)
        ? (body.companyProfile as Record<string, unknown>)
        : null;
  return { companyProfile, capabilityAreas };
}

function parseAiResult(content: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error("AI response was not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid AI response shape.");
  }
  return parsed as Record<string, unknown>;
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
    console.error("normalise-subject-taxonomy: OPENAI_API_KEY is not set");
    return jsonResponse(
      {
        error:
          "Server configuration error: OpenAI is not configured. Set OPENAI_API_KEY for this project.",
      },
      500,
    );
  }

  const model = Deno.env.get("OPENAI_MODEL")?.trim() || "gpt-4o-mini";

  let payload: NormalisationRequestPayload;
  try {
    const text = await req.text();
    if (!text.trim()) {
      return jsonResponse({ error: "Empty request body." }, 400);
    }
    payload = parseBody(JSON.parse(text));
  } catch (e) {
    const msg =
      e instanceof SyntaxError
        ? "Invalid JSON body."
        : e instanceof Error
          ? e.message
          : "Invalid request body.";
    return jsonResponse({ error: msg }, 400);
  }

  const user = buildSubjectNameNormalisationUserPrompt(payload);

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
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: SUBJECT_NAME_NORMALISATION_SYSTEM_PROMPT,
            },
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
      console.error(
        "normalise-subject-taxonomy: OpenAI error",
        openaiRes.status,
        detail,
      );
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

    const msg = completion.choices?.[0]?.message?.content?.trim();
    if (!msg) {
      return jsonResponse({ error: "OpenAI returned an empty message." }, 502);
    }

    const result = parseAiResult(msg);
    return jsonResponse(result, 200);
  } catch (e) {
    const err = e instanceof Error ? e.message : "Unexpected server error.";
    console.error("normalise-subject-taxonomy:", e);
    return jsonResponse({ error: err }, 500);
  }
});
