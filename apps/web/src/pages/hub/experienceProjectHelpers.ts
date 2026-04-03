import { supabase } from "../../lib/supabase";
import type { UserExperienceProject } from "./types";

/**
 * Load project rows for a work experience entry (RLS: current user only).
 * Safe groundwork for future My Experience / CV flows — not wired in UI yet.
 */
export async function getProjectsForExperience(
  experienceId: string
): Promise<UserExperienceProject[]> {
  const { data, error } = await supabase
    .from("user_experience_projects")
    .select("*")
    .eq("experience_id", experienceId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("getProjectsForExperience:", error.message);
    return [];
  }

  return (data ?? []) as UserExperienceProject[];
}
