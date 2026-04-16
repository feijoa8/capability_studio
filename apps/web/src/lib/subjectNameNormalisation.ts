import { supabase } from "./supabase";

/** Input row: subjects under one capability area (matches Edge Function body). */
export type SubjectNormalisationInputRow = {
  capabilityAreaId?: string | null;
  capabilityAreaName: string;
  subjects: {
    subjectId?: string | null;
    name: string;
    description?: string | null;
    category?: string | null;
  }[];
};

export type NormaliseSubjectTaxonomyRequest = {
  companyProfile?: Record<string, unknown> | null;
  capabilityAreas: SubjectNormalisationInputRow[];
};

export type NormalisedSubjectRow = {
  subjectId: string | null;
  name: string;
  description: string | null;
  category: string | null;
};

export type NormalisedCapabilityAreaRow = {
  capabilityAreaId: string | null;
  capabilityAreaName: string;
  subjects: NormalisedSubjectRow[];
};

export type SubjectNormalisationNotes = {
  merges: {
    from: string[];
    to: string;
    capabilityAreaName: string;
  }[];
  renames: {
    from: string;
    to: string;
    capabilityAreaName: string;
  }[];
  moves: {
    subjectName: string;
    fromArea: string;
    toArea: string;
    reason: string;
  }[];
  preservedDistinctions: string[];
};

export type NormaliseSubjectTaxonomyResponse = {
  capabilityAreas: NormalisedCapabilityAreaRow[];
  notes: SubjectNormalisationNotes;
};

function normStr(s: unknown): string {
  return typeof s === "string" ? s.trim() : "";
}

function coerceSubjectRow(raw: unknown): NormalisedSubjectRow | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const name = normStr(o.name);
  if (!name) return null;
  const sid = o.subjectId;
  const subjectId =
    sid === undefined || sid === null
      ? null
      : typeof sid === "string"
        ? sid.trim() || null
        : null;
  const description = normStr(o.description) || null;
  const category = normStr(o.category) || null;
  return { subjectId, name, description, category };
}

function coerceAreaRow(raw: unknown): NormalisedCapabilityAreaRow | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const capabilityAreaName = normStr(o.capabilityAreaName);
  if (!capabilityAreaName) return null;
  const aid = o.capabilityAreaId;
  const capabilityAreaId =
    aid === undefined || aid === null
      ? null
      : typeof aid === "string"
        ? aid.trim() || null
        : null;
  const subsRaw = o.subjects;
  const subjects: NormalisedSubjectRow[] = [];
  if (Array.isArray(subsRaw)) {
    for (const s of subsRaw) {
      const row = coerceSubjectRow(s);
      if (row) subjects.push(row);
    }
  }
  return { capabilityAreaId, capabilityAreaName, subjects };
}

function coerceNotes(raw: unknown): SubjectNormalisationNotes {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      merges: [],
      renames: [],
      moves: [],
      preservedDistinctions: [],
    };
  }
  const n = raw as Record<string, unknown>;
  const merges = Array.isArray(n.merges) ? n.merges : [];
  const renames = Array.isArray(n.renames) ? n.renames : [];
  const moves = Array.isArray(n.moves) ? n.moves : [];
  const preserved = Array.isArray(n.preservedDistinctions)
    ? n.preservedDistinctions
    : [];
  return {
    merges: merges.filter((x) => x && typeof x === "object") as SubjectNormalisationNotes["merges"],
    renames: renames.filter((x) => x && typeof x === "object") as SubjectNormalisationNotes["renames"],
    moves: moves.filter((x) => x && typeof x === "object") as SubjectNormalisationNotes["moves"],
    preservedDistinctions: preserved
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .map((x) => x.trim()),
  };
}

/** Normalises loose model JSON into typed response (safe for UI). */
export function coerceNormaliseSubjectTaxonomyResponse(
  raw: unknown,
): NormaliseSubjectTaxonomyResponse {
  const o = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  const areasRaw = o.capabilityAreas;
  const capabilityAreas: NormalisedCapabilityAreaRow[] = [];
  if (Array.isArray(areasRaw)) {
    for (const a of areasRaw) {
      const row = coerceAreaRow(a);
      if (row) capabilityAreas.push(row);
    }
  }
  return {
    capabilityAreas,
    notes: coerceNotes(o.notes),
  };
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

/**
 * Calls Edge Function `normalise-subject-taxonomy` (review/governance step).
 * Not invoked automatically after subject generation — wire from UI when ready.
 */
export async function normaliseSubjectTaxonomy(
  body: NormaliseSubjectTaxonomyRequest,
): Promise<NormaliseSubjectTaxonomyResponse> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token?.trim();
  if (!accessToken) {
    throw new Error(
      "You must be signed in. Your session may have expired — sign in again.",
    );
  }

  const { data, error } = await supabase.functions.invoke(
    "normalise-subject-taxonomy",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      body,
    },
  );

  if (error) {
    throw new Error(await invokeErrorMessage(error, data));
  }
  if (!data || typeof data !== "object") {
    throw new Error("Invalid response from normalise-subject-taxonomy.");
  }
  return coerceNormaliseSubjectTaxonomyResponse(data);
}
