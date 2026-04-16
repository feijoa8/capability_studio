-- Taxonomy governance: draft / settled / protected (orthogonal to lifecycle status on subjects).
-- competency_subjects already uses `status` for active/deprecated/archived — use governance_status here.

ALTER TABLE public.capability_areas
  ADD COLUMN IF NOT EXISTS governance_status text NOT NULL DEFAULT 'draft';

ALTER TABLE public.capability_areas DROP CONSTRAINT IF EXISTS capability_areas_governance_status_check;
ALTER TABLE public.capability_areas ADD CONSTRAINT capability_areas_governance_status_check
  CHECK (governance_status IN ('draft', 'settled', 'protected'));

CREATE INDEX IF NOT EXISTS capability_areas_org_governance_idx
  ON public.capability_areas (organisation_id, governance_status);

ALTER TABLE public.competency_subjects
  ADD COLUMN IF NOT EXISTS governance_status text NOT NULL DEFAULT 'draft';

ALTER TABLE public.competency_subjects DROP CONSTRAINT IF EXISTS competency_subjects_governance_status_check;
ALTER TABLE public.competency_subjects ADD CONSTRAINT competency_subjects_governance_status_check
  CHECK (governance_status IN ('draft', 'settled', 'protected'));

CREATE INDEX IF NOT EXISTS competency_subjects_org_governance_idx
  ON public.competency_subjects (organisation_id, governance_status);
