-- Teams: lightweight primary org grouping. Separate from reporting lines.
-- user_team_assignments: one primary team per user per org (unique org+user).

CREATE TABLE IF NOT EXISTS public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  manager_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teams_org_name_unique UNIQUE (organisation_id, name)
);

CREATE INDEX IF NOT EXISTS teams_organisation_id_idx ON public.teams (organisation_id);

CREATE TABLE IF NOT EXISTS public.user_team_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_team_assignments_org_user_unique UNIQUE (organisation_id, user_id)
);

CREATE INDEX IF NOT EXISTS user_team_assignments_organisation_id_idx
  ON public.user_team_assignments (organisation_id);
CREATE INDEX IF NOT EXISTS user_team_assignments_team_id_idx
  ON public.user_team_assignments (team_id);

CREATE OR REPLACE FUNCTION public.teams_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS teams_touch_updated_at_trg ON public.teams;
CREATE TRIGGER teams_touch_updated_at_trg
  BEFORE UPDATE ON public.teams
  FOR EACH ROW
  EXECUTE PROCEDURE public.teams_touch_updated_at();

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_team_assignments ENABLE ROW LEVEL SECURITY;

-- ---------- teams: read for workspace members ----------
CREATE POLICY "teams_select_workspace_members"
  ON public.teams FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = teams.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
    )
  );

CREATE POLICY "teams_insert_workspace_admin"
  ON public.teams FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = teams.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.workspace_role IN ('company_owner', 'company_admin', 'company_it_admin', 'learning_lead')
        AND wm.membership_status = 'active'
    )
  );

CREATE POLICY "teams_update_workspace_admin"
  ON public.teams FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = teams.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.workspace_role IN ('company_owner', 'company_admin', 'company_it_admin', 'learning_lead')
        AND wm.membership_status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = teams.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.workspace_role IN ('company_owner', 'company_admin', 'company_it_admin', 'learning_lead')
        AND wm.membership_status = 'active'
    )
  );

CREATE POLICY "teams_delete_workspace_admin"
  ON public.teams FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = teams.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.workspace_role IN ('company_owner', 'company_admin', 'company_it_admin', 'learning_lead')
        AND wm.membership_status = 'active'
    )
  );

-- ---------- user_team_assignments: read for workspace members ----------
CREATE POLICY "user_team_assignments_select_workspace_members"
  ON public.user_team_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = user_team_assignments.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
    )
  );

CREATE POLICY "user_team_assignments_insert_workspace_admin"
  ON public.user_team_assignments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = user_team_assignments.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.workspace_role IN ('company_owner', 'company_admin', 'company_it_admin', 'learning_lead')
        AND wm.membership_status = 'active'
    )
    AND EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = user_team_assignments.organisation_id
        AND wm.user_id = user_team_assignments.user_id
        AND wm.membership_status = 'active'
    )
    AND EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = user_team_assignments.team_id
        AND t.organisation_id = user_team_assignments.organisation_id
    )
  );

CREATE POLICY "user_team_assignments_update_workspace_admin"
  ON public.user_team_assignments FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = user_team_assignments.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.workspace_role IN ('company_owner', 'company_admin', 'company_it_admin', 'learning_lead')
        AND wm.membership_status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = user_team_assignments.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.workspace_role IN ('company_owner', 'company_admin', 'company_it_admin', 'learning_lead')
        AND wm.membership_status = 'active'
    )
    AND EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = user_team_assignments.organisation_id
        AND wm.user_id = user_team_assignments.user_id
        AND wm.membership_status = 'active'
    )
    AND EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = user_team_assignments.team_id
        AND t.organisation_id = user_team_assignments.organisation_id
    )
  );

CREATE POLICY "user_team_assignments_delete_workspace_admin"
  ON public.user_team_assignments FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = user_team_assignments.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.workspace_role IN ('company_owner', 'company_admin', 'company_it_admin', 'learning_lead')
        AND wm.membership_status = 'active'
    )
  );
