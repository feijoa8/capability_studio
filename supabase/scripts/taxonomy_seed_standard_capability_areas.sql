-- =============================================================================
-- Re-seed standard Capability Areas (10) for one organisation
-- =============================================================================
-- Run AFTER taxonomy reset (or anytime). Replace 00000000-0000-0000-0000-000000000001.
-- Idempotent: skips insert when (organisation_id, name) already exists.
-- No unique index required: uses NOT EXISTS guard.
-- governance_status defaults to 'draft' on capability_areas.
-- =============================================================================

DO $$
DECLARE
  v_org uuid := '00000000-0000-0000-0000-000000000001'::uuid;
BEGIN

  INSERT INTO public.capability_areas (organisation_id, name, description, governance_status)
  SELECT v_org, v.name, NULL::text, 'draft'
  FROM (
    VALUES
      ('Strategy & Direction'),
      ('Customer & Market Insight'),
      ('Product & Service Design'),
      ('Product Management'),
      ('Delivery & Execution'),
      ('Operations & Service'),
      ('Growth & Engagement'),
      ('Risk, Compliance & Governance'),
      ('Data, Technology & Platforms'),
      ('People & Capability')
  ) AS v(name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.capability_areas ca
    WHERE ca.organisation_id = v_org
      AND ca.name = v.name
  );
END $$;
