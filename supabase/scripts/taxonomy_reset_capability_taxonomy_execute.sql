-- =============================================================================
-- EXECUTION VERSION (permanent) — Capability taxonomy reset (organisation-scoped)
-- =============================================================================
-- 1. Replace every occurrence of 00000000-0000-0000-0000-000000000001 with your organisations.id.
-- 2. Run once in Supabase SQL Editor when you intend to wipe taxonomy data.
-- 3. This does NOT delete: organisation_profiles, job_profiles, competency_practices,
--    users, or workspace configuration. It removes capability areas, subjects,
--    competencies, and dependent links listed in TAXONOMY_RESET_DEPENDENCIES.md.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_org uuid := '00000000-0000-0000-0000-000000000001'::uuid;
  n bigint;
BEGIN
  SELECT count(*) INTO n
  FROM public.competency_level_definitions cld
  JOIN public.competencies c ON c.id = cld.competency_id
  WHERE c.organisation_id = v_org;
  RAISE NOTICE 'Deleting competency_level_definitions rows (approx): %', n;

  SELECT count(*) INTO n
  FROM public.job_profile_competencies jpc
  JOIN public.job_profiles jp ON jp.id = jpc.job_profile_id
  WHERE jp.organisation_id = v_org;
  RAISE NOTICE 'Deleting job_profile_competencies rows (approx): %', n;

  SELECT count(*) INTO n FROM public.competencies WHERE organisation_id = v_org;
  RAISE NOTICE 'Deleting competencies rows (approx): %', n;

  SELECT count(*) INTO n FROM public.competency_subjects WHERE organisation_id = v_org;
  RAISE NOTICE 'Deleting competency_subjects rows (approx): %', n;

  SELECT count(*) INTO n FROM public.capability_areas WHERE organisation_id = v_org;
  RAISE NOTICE 'Deleting capability_areas rows (approx): %', n;
END $$;

DELETE FROM public.competency_level_definitions
WHERE competency_id IN (SELECT id FROM public.competencies WHERE organisation_id = '00000000-0000-0000-0000-000000000001'::uuid);

DELETE FROM public.job_profile_competencies jpc
USING public.job_profiles jp
WHERE jpc.job_profile_id = jp.id
  AND jp.organisation_id = '00000000-0000-0000-0000-000000000001'::uuid;

DELETE FROM public.org_user_competency_assessments
WHERE organisation_id = '00000000-0000-0000-0000-000000000001'::uuid;

DELETE FROM public.org_user_competencies
WHERE organisation_id = '00000000-0000-0000-0000-000000000001'::uuid;

DELETE FROM public.development_goals
WHERE organisation_id = '00000000-0000-0000-0000-000000000001'::uuid
  AND competency_id IN (SELECT id FROM public.competencies WHERE organisation_id = '00000000-0000-0000-0000-000000000001'::uuid);

UPDATE public.development_plan_objectives
SET competency_id = NULL
WHERE competency_id IN (SELECT id FROM public.competencies WHERE organisation_id = '00000000-0000-0000-0000-000000000001'::uuid);

UPDATE public.competencies
SET replaced_by_id = NULL
WHERE organisation_id = '00000000-0000-0000-0000-000000000001'::uuid;

DELETE FROM public.competency_practice_links
WHERE organisation_id = '00000000-0000-0000-0000-000000000001'::uuid;

DELETE FROM public.competencies
WHERE organisation_id = '00000000-0000-0000-0000-000000000001'::uuid;

DELETE FROM public.subject_practice_links
WHERE organisation_id = '00000000-0000-0000-0000-000000000001'::uuid;

UPDATE public.competency_subjects
SET replaced_by_id = NULL
WHERE organisation_id = '00000000-0000-0000-0000-000000000001'::uuid;

DELETE FROM public.competency_subjects
WHERE organisation_id = '00000000-0000-0000-0000-000000000001'::uuid;

DELETE FROM public.capability_areas
WHERE organisation_id = '00000000-0000-0000-0000-000000000001'::uuid;

COMMIT;

-- =============================================================================
-- End EXECUTION — changes committed
-- =============================================================================
