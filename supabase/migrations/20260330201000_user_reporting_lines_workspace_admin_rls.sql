-- Allow company admins / learning leads to manage reporting lines for any member in the workspace
-- (User Admin). Existing policies keep self-service insert/update for employees.
drop policy if exists "development_plans_select_own" on public.development_plans;
drop policy if exists "development_plans_insert_own" on public.development_plans;
drop policy if exists "development_plans_update_own" on public.development_plans;
drop policy if exists "development_plans_delete_own" on public.development_plans;

drop policy if exists "development_plan_objectives_select_own" on public.development_plan_objectives;
drop policy if exists "development_plan_objectives_insert_own" on public.development_plan_objectives;
drop policy if exists "development_plan_objectives_update_own" on public.development_plan_objectives;
drop policy if exists "development_plan_objectives_delete_own" on public.development_plan_objectives;

CREATE POLICY "user_reporting_lines_select_workspace_admin"
  ON public.user_reporting_lines FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = user_reporting_lines.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.workspace_role IN ('company_owner', 'company_admin', 'company_it_admin', 'learning_lead')
        AND wm.membership_status = 'active'
    )
  );

CREATE POLICY "user_reporting_lines_insert_workspace_admin"
  ON public.user_reporting_lines FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = user_reporting_lines.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.workspace_role IN ('company_owner', 'company_admin', 'company_it_admin', 'learning_lead')
        AND wm.membership_status = 'active'
    )
    AND EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = user_reporting_lines.organisation_id
        AND wm.user_id = user_reporting_lines.user_id
        AND wm.membership_status = 'active'
    )
    AND EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = user_reporting_lines.organisation_id
        AND wm.user_id = user_reporting_lines.manager_user_id
        AND wm.membership_status = 'active'
    )
  );

CREATE POLICY "user_reporting_lines_update_workspace_admin"
  ON public.user_reporting_lines FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = user_reporting_lines.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.workspace_role IN ('company_owner', 'company_admin', 'company_it_admin', 'learning_lead')
        AND wm.membership_status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = user_reporting_lines.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.workspace_role IN ('company_owner', 'company_admin', 'company_it_admin', 'learning_lead')
        AND wm.membership_status = 'active'
    )
    AND EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = user_reporting_lines.organisation_id
        AND wm.user_id = user_reporting_lines.user_id
        AND wm.membership_status = 'active'
    )
    AND EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = user_reporting_lines.organisation_id
        AND wm.user_id = user_reporting_lines.manager_user_id
        AND wm.membership_status = 'active'
    )
  );

CREATE POLICY "user_reporting_lines_delete_workspace_admin"
  ON public.user_reporting_lines FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = user_reporting_lines.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.workspace_role IN ('company_owner', 'company_admin', 'company_it_admin', 'learning_lead')
        AND wm.membership_status = 'active'
    )
  );
