import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_LEVEL_ROWS: {
  level_name: string;
  level_order: number;
}[] = [
  { level_name: "Beginner", level_order: 1 },
  { level_name: "Intermediate", level_order: 2 },
  { level_name: "Advanced", level_order: 3 },
  { level_name: "Expert", level_order: 4 },
];

/**
 * Inserts the standard four proficiency levels for a competency (Beginner → Expert).
 * Matches the shape used by Manage Levels in CompetenciesSection.
 */
export async function insertDefaultCompetencyLevels(
  client: SupabaseClient,
  competencyId: string
) {
  return client.from("competency_level_definitions").insert(
    DEFAULT_LEVEL_ROWS.map((row) => ({
      competency_id: competencyId,
      level_name: row.level_name,
      level_order: row.level_order,
      description: null,
      is_active: true,
    }))
  );
}
