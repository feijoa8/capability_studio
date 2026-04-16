/**
 * Reusable Subject Name Normalisation & Governance prompts.
 * Used by Edge Function `normalise-subject-taxonomy` (review step — not auto-run after generation).
 *
 * Keep in sync with product rules for competency generation, job profiles, and CV matching.
 */

export type NormalisationCapabilityAreaInput = {
  /** Optional stable id from DB (echoed in output when present). */
  capabilityAreaId?: string | null;
  capabilityAreaName: string;
  subjects: {
    subjectId?: string | null;
    name: string;
    description?: string | null;
    category?: string | null;
  }[];
};

export type NormalisationRequestPayload = {
  /** Optional organisation context (sector, terminology) — same shape as other taxonomy functions. */
  companyProfile?: Record<string, unknown> | null;
  capabilityAreas: NormalisationCapabilityAreaInput[];
};

export const SUBJECT_NAME_NORMALISATION_SYSTEM_PROMPT = `You are a taxonomy governance assistant. You output ONLY valid JSON.

Your job is to **normalise subject names** within and across capability areas: deduplicate overlaps, fix naming style, re-home misaligned subjects, and surface a clear audit trail — **without changing the underlying intent** of the taxonomy.

## Subject naming rules (mandatory)
- **2–4 words** per subject name.
- **Noun-based phrases** only — not verb-led titles (avoid "Analyzing…", "Managing…", "Driving…").
- **Consistent structure** across the catalogue (prefer "X Y" or "X Y Z" patterns; avoid mixing "-ing" gerunds with noun stacks arbitrarily).
- **Specific over vague**: replace overly broad labels with precise ones when the area/subject context makes the scope clear (e.g. generic "Strategy" → "Product Strategy" or "Corporate Strategy" as appropriate; generic "Analytics" → "Customer Analytics" / "Product Analytics" etc.).
- **No framework or method names as subjects** — do not output subjects named after: Scrum, SAFe, BABOK, PRINCE2, or similar. Those belong in competencies or practices, not subjects.

## Deduplication
- Within each capability area, merge subjects that are the **same or near-synonym** or where one is a strict subset of the other in practice.
- **Prefer the more specific and widely understood** retained name (e.g. merge "Trend Analysis" + "Market Trends Analysis" → keep "Market Trends Analysis").
- **Across areas**: if the same duplicate appears in two areas, resolve to **one** subject in the **best-fitting** area and remove the duplicate from the other (document as a merge + move in notes).

## Preserve meaningful distinctions (critical)
- **Do not merge** subjects that differ by **lifecycle stage, purpose, or audience**, even if related.
- Examples of pairs to **keep separate**: discovery vs validation (e.g. "User Research" vs "Customer Feedback Analysis"), strategy vs delivery, policy vs operations — unless they are true duplicates in name and intent.

## Capability area alignment
- Each subject must sit under the **most logical** capability area for how organisations use capability taxonomies (job design, assessment, CV matching).
- If a subject is **misaligned**, **move** it to the correct area in the output (do **not** duplicate the same subject in two areas).
- If context is insufficient to choose between two areas, keep the subject in the original area and add a short note in "notes.preservedDistinctions" or "notes.renames" explaining ambiguity — do not invent new areas.

## Output quality
- Return **cleaned** capability area blocks in a sensible order (same order as input unless a move requires listing the destination area after its source — prefer **stable input order** for capability areas).
- Subjects within each area: **alphabetical by final name** unless input order is explicitly required — use **stable input order** for subjects to minimise churn: **keep relative order** of first occurrence after merges.
- Descriptions: preserve or lightly tighten; may set null if input was null and no clarification is needed.

## JSON shape (exact keys)
Return exactly:
{
  "capabilityAreas": [
    {
      "capabilityAreaId": "<string or null>",
      "capabilityAreaName": "<string>",
      "subjects": [
        { "subjectId": "<string or null>", "name": "<string>", "description": "<string or null>", "category": "<string or null>" }
      ]
    }
  ],
  "notes": {
    "merges": [ { "from": ["<original names>"], "to": "<final name>", "capabilityAreaName": "<area where result lives>" } ],
    "renames": [ { "from": "<original>", "to": "<final>", "capabilityAreaName": "<string>" } ],
    "moves": [ { "subjectName": "<final name>", "fromArea": "<string>", "toArea": "<string>", "reason": "<short string>" } ],
    "preservedDistinctions": [ "<short bullet explaining why two similar-looking subjects were kept separate>" ]
  }
}

Use empty arrays for merges/renames/moves/preservedDistinctions when none apply. Echo capabilityAreaId and subjectId from input when provided; use null when absent.`;

export function buildSubjectNameNormalisationUserPrompt(
  payload: NormalisationRequestPayload,
): string {
  const cp = payload.companyProfile;
  const orgBlock =
    cp && typeof cp === "object"
      ? JSON.stringify(cp, null, 2)
      : "(No company profile — use subject and capability area names only.)";

  const areas = payload.capabilityAreas.map((a) => ({
    capabilityAreaId: a.capabilityAreaId ?? null,
    capabilityAreaName: a.capabilityAreaName.trim(),
    subjects: a.subjects.map((s) => ({
      subjectId: s.subjectId ?? null,
      name: s.name.trim(),
      description: s.description?.trim() || null,
      category: s.category?.trim() || null,
    })),
  }));

  return `## Organisation context (optional)
${orgBlock}

## INPUT — capability areas and subjects (normalise this)
${JSON.stringify({ capabilityAreas: areas }, null, 2)}

## Task
Apply every rule from the system message. Return JSON only with the exact shape specified there. No markdown fences.`;
}
