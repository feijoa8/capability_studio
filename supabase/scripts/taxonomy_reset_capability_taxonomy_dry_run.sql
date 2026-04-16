-- =============================================================================
-- DRY RUN — Capability taxonomy reset (organisation-scoped)
-- No data is permanently deleted (transaction ends with ROLLBACK).
-- =============================================================================
-- 1. Replace every occurrence of the placeholder UUID (00000000-0000-0000-0000-000000000001)
--    with your organisations.id. Use find/replace across the whole file.
-- 2. Run in Supabase SQL Editor. Review NOTICE output and any SELECT grids.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_org uuid := '00000000-0000-0000-0000-000000000001'::uuid;
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.competency_level_definitions cld
  JOIN public.competencies c ON c.id = cld.competency_id
  WHERE c.organisation_id = v_org;
  RAISE NOTICE 'competency_level_definitions (rows for org competencies): %', n;

  SELECT count(*) INTO n
  FROM public.job_profile_competencies jpc
  JOIN public.job_profiles jp ON jp.id = jpc.job_profile_id
  WHERE jp.organisation_id = v_org;
  RAISE NOTICE 'job_profile_competencies (rows for org job profiles): %', n;

  SELECT count(*) INTO n FROM public.org_user_competency_assessments WHERE organisation_id = v_org;
  RAISE NOTICE 'org_user_competency_assessments: %', n;

  SELECT count(*) INTO n FROM public.org_user_competencies WHERE organisation_id = v_org;
  RAISE NOTICE 'org_user_competencies: %', n;

  SELECT count(*) INTO n
  FROM public.development_goals dg
  WHERE dg.organisation_id = v_org AND dg.competency_id IS NOT NULL;
  RAISE NOTICE 'development_goals (with competency_id): %', n;

  SELECT count(*) INTO n FROM public.competencies WHERE organisation_id = v_org;
  RAISE NOTICE 'competencies: %', n;

  SELECT count(*) INTO n FROM public.subject_practice_links WHERE organisation_id = v_org;
  RAISE NOTICE 'subject_practice_links: %', n;

  SELECT count(*) INTO n FROM public.competency_practice_links WHERE organisation_id = v_org;
  RAISE NOTICE 'competency_practice_links: %', n;

  SELECT count(*) INTO n FROM public.competency_subjects WHERE organisation_id = v_org;
  RAISE NOTICE 'competency_subjects: %', n;

  SELECT count(*) INTO n FROM public.capability_areas WHERE organisation_id = v_org;
  RAISE NOTICE 'capability_areas: %', n;
END $$;

-- --- Deletes (same order as execution script; rolled back at end) ---

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

ROLLBACK;

-- =============================================================================
-- End DRY RUN — nothing persisted
-- =============================================================================
