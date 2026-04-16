# Capability taxonomy reset — dependency map

Discovered from `supabase/migrations` (March–April 2026). Actual table names in Postgres:

## Core taxonomy (deleted by reset)

| Table | Notes |
|--------|--------|
| `public.capability_areas` | Top-level areas; `competency_subjects.capability_area_id` → `ON DELETE SET NULL` |
| `public.competency_subjects` | “Subjects” in the app; `practice_id` → `competency_practices` `SET NULL`; `replaced_by_id` self-FK `SET NULL` |
| `public.competencies` | Leaf nodes; `subject_id` → `competency_subjects` `SET NULL`; `replaced_by_id` self-FK `SET NULL` |

## Links involving subjects (deleted)

| Table | FK |
|--------|-----|
| `public.subject_practice_links` | `subject_id` → `competency_subjects` **`ON DELETE CASCADE`** |
| `public.competency_practice_links` | `competency_id` → `competencies` **`ON DELETE CASCADE`**; `practice_id` → `competency_practices` **`ON DELETE CASCADE`** |

## Links involving competencies (must clear before deleting `competencies`)

| Table | FK / behaviour |
|--------|----------------|
| `public.competency_level_definitions` | `competency_id` → `competencies` (delete rows explicitly; remote schema may use `CASCADE` or not) |
| `public.job_profile_competencies` | `competency_id` → `competencies` (explicit delete via `job_profiles.organisation_id`) |
| `public.org_user_competencies` | `competency_id` → `competencies` **`ON DELETE CASCADE`** |
| `public.org_user_competency_assessments` | `competency_id` → `competencies` **`ON DELETE CASCADE`** |
| `public.development_goals` | `competency_id` → `competencies` **`ON DELETE CASCADE`** |
| `public.development_goal_notes` | `goal_id` → `development_goals` **`ON DELETE CASCADE`** |
| `public.development_plan_objectives` | `competency_id` → `competencies` **`ON DELETE SET NULL`** |

## Preserved (not deleted)

- `public.organisations`, `public.organisation_profiles`
- `public.competency_practices` (practices)
- `public.job_profiles`, `public.job_families`, HR satellite tables (`job_profile_responsibilities`, etc.) — only `job_profile_competencies` rows are removed
- `public.development_plans` (objectives may keep rows with `competency_id` nulled by FK)
- Auth / workspace tables

## Safe deletion order (organisation-scoped)

1. Optional: `UPDATE development_plan_objectives SET competency_id = NULL` for competencies in scope (redundant if FK is `SET NULL`).
2. `DELETE` child rows that reference `competencies` (level definitions, job profile links, org user links, assessments) — **or** rely on `CASCADE` where present; scripts use explicit deletes for clarity.
3. `DELETE FROM development_goals` where `competency_id` in org’s competencies (cascade removes `development_goal_notes`).
4. Clear `competencies.replaced_by_id`, then `DELETE FROM competencies` for the org.
5. `DELETE FROM subject_practice_links` for the org.
6. Clear `competency_subjects.replaced_by_id`, then `DELETE FROM competency_subjects` for the org.
7. `DELETE FROM capability_areas` for the org.

`competency_subjects` must be removed after `competencies` (competencies reference subjects; `ON DELETE SET NULL` would orphan — we delete competencies first, then subjects).
