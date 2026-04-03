-- Structured company / workspace context (one row per organisation) for UX and future AI features.

CREATE TABLE IF NOT EXISTS public.organisation_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL UNIQUE REFERENCES public.organisations (id) ON DELETE CASCADE,
  organisation_name text,
  sector text,
  industry text,
  summary text,
  business_purpose text,
  strategic_priorities text,
  delivery_context text,
  capability_emphasis text,
  role_interpretation_guidance text,
  terminology_guidance text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organisation_profiles_organisation_id_idx
  ON public.organisation_profiles (organisation_id);

ALTER TABLE public.organisation_profiles ENABLE ROW LEVEL SECURITY;

-- Active workspace members can read their organisation profile
CREATE POLICY "organisation_profiles_select_member"
  ON public.organisation_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = organisation_profiles.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
    )
  );

-- Workspace admins (canonical + legacy elevated roles)
CREATE POLICY "organisation_profiles_insert_admin"
  ON public.organisation_profiles FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = organisation_profiles.organisation_id
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

CREATE POLICY "organisation_profiles_update_admin"
  ON public.organisation_profiles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = organisation_profiles.organisation_id
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
      WHERE wm.organisation_id = organisation_profiles.organisation_id
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

CREATE POLICY "organisation_profiles_delete_admin"
  ON public.organisation_profiles FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = organisation_profiles.organisation_id
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
