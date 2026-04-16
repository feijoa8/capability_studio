-- Capability Areas: primary grouping layer for subjects (non-breaking; practice_id unchanged).

CREATE TABLE IF NOT EXISTS public.capability_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS capability_areas_org_idx
  ON public.capability_areas (organisation_id);

ALTER TABLE public.competency_subjects
  ADD COLUMN IF NOT EXISTS capability_area_id uuid REFERENCES public.capability_areas (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS competency_subjects_capability_area_idx
  ON public.competency_subjects (capability_area_id);

ALTER TABLE public.capability_areas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "capability_areas_select_member"
  ON public.capability_areas FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = capability_areas.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
    )
  );

CREATE POLICY "capability_areas_insert_admin"
  ON public.capability_areas FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = capability_areas.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
        AND wm.workspace_role IN (
          'company_owner',
          'company_admin',
          'company_it_admin',
          'learning_lead'
        )
    )
  );

CREATE POLICY "capability_areas_update_admin"
  ON public.capability_areas FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = capability_areas.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
        AND wm.workspace_role IN (
          'company_owner',
          'company_admin',
          'company_it_admin',
          'learning_lead'
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = capability_areas.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
        AND wm.workspace_role IN (
          'company_owner',
          'company_admin',
          'company_it_admin',
          'learning_lead'
        )
    )
  );

CREATE POLICY "capability_areas_delete_admin"
  ON public.capability_areas FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = capability_areas.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
        AND wm.workspace_role IN (
          'company_owner',
          'company_admin',
          'company_it_admin',
          'learning_lead'
        )
    )
  );
