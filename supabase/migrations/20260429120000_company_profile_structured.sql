-- Structured company profile v2: URL, strategy drivers, operating model, capability focus, regulatory, role bias.
-- Preserves legacy text columns for backward-compatible reads.

ALTER TABLE public.organisation_profiles
  ADD COLUMN IF NOT EXISTS company_url text,
  ADD COLUMN IF NOT EXISTS strategic_focus text,
  ADD COLUMN IF NOT EXISTS key_drivers text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS delivery_models text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS organisation_structure text,
  ADD COLUMN IF NOT EXISTS primary_capability_areas text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS capability_focus_notes text,
  ADD COLUMN IF NOT EXISTS regulatory_intensity text,
  ADD COLUMN IF NOT EXISTS role_model_bias text;

COMMENT ON COLUMN public.organisation_profiles.company_url IS 'Optional public site URL for assistive research only.';
COMMENT ON COLUMN public.organisation_profiles.strategic_focus IS 'Primary narrative for strategy (replaces overlapping free-text in UI; legacy business_purpose/strategic_priorities may still exist).';
COMMENT ON COLUMN public.organisation_profiles.key_drivers IS 'Structured strategy drivers (e.g. Growth, Innovation).';
COMMENT ON COLUMN public.organisation_profiles.delivery_models IS 'Structured delivery approaches (e.g. Agile Scrum, Hybrid).';
COMMENT ON COLUMN public.organisation_profiles.organisation_structure IS 'Single-select label: Functional, Matrix, etc.';
COMMENT ON COLUMN public.organisation_profiles.primary_capability_areas IS 'Capability focus areas (multi-select).';
COMMENT ON COLUMN public.organisation_profiles.capability_focus_notes IS 'Optional notes for capability / delivery nuance.';
COMMENT ON COLUMN public.organisation_profiles.regulatory_intensity IS 'Low | Medium | High | Critical';
COMMENT ON COLUMN public.organisation_profiles.role_model_bias IS 'Product-led | Delivery-led | Project-led | Mixed';

-- Conservative backfill from legacy columns
UPDATE public.organisation_profiles
SET
  strategic_focus = COALESCE(
    NULLIF(trim(both from strategic_focus), ''),
    NULLIF(
      trim(both from concat_ws(
        E'\n\n',
        NULLIF(trim(both from business_purpose), ''),
        NULLIF(trim(both from strategic_priorities), '')
      )),
      ''
    )
  ),
  capability_focus_notes = COALESCE(
    NULLIF(trim(both from capability_focus_notes), ''),
    NULLIF(
      trim(both from concat_ws(
        E'\n\n',
        NULLIF(trim(both from delivery_context), ''),
        NULLIF(trim(both from capability_emphasis), '')
      )),
      ''
    )
  )
;
