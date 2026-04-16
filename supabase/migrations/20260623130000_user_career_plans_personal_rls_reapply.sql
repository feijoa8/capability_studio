-- Re-apply personal-standalone access for user_career_plans after later migrations
-- replaced policies with workspace-only rules.

DROP POLICY IF EXISTS "user_career_plans_select_own" ON public.user_career_plans;
CREATE POLICY "user_career_plans_select_own"
  ON public.user_career_plans FOR SELECT
  USING (
    user_id = auth.uid()
    AND (
      organisation_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.workspace_memberships wm
        WHERE wm.organisation_id = user_career_plans.organisation_id
          AND wm.user_id = auth.uid()
          AND public.workspace_membership_row_effective(wm)
      )
    )
  );

DROP POLICY IF EXISTS "user_career_plans_insert_own" ON public.user_career_plans;
CREATE POLICY "user_career_plans_insert_own"
  ON public.user_career_plans FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (
      organisation_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.workspace_memberships wm
        WHERE wm.organisation_id = user_career_plans.organisation_id
          AND wm.user_id = auth.uid()
          AND public.workspace_membership_row_effective(wm)
      )
    )
  );

DROP POLICY IF EXISTS "user_career_plans_update_own" ON public.user_career_plans;
CREATE POLICY "user_career_plans_update_own"
  ON public.user_career_plans FOR UPDATE
  USING (
    user_id = auth.uid()
    AND (
      organisation_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.workspace_memberships wm
        WHERE wm.organisation_id = user_career_plans.organisation_id
          AND wm.user_id = auth.uid()
          AND public.workspace_membership_row_effective(wm)
      )
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND (
      organisation_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.workspace_memberships wm
        WHERE wm.organisation_id = user_career_plans.organisation_id
          AND wm.user_id = auth.uid()
          AND public.workspace_membership_row_effective(wm)
      )
    )
  );

DROP POLICY IF EXISTS "user_career_plans_delete_own" ON public.user_career_plans;
CREATE POLICY "user_career_plans_delete_own"
  ON public.user_career_plans FOR DELETE
  USING (
    user_id = auth.uid()
    AND (
      organisation_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.workspace_memberships wm
        WHERE wm.organisation_id = user_career_plans.organisation_id
          AND wm.user_id = auth.uid()
          AND public.workspace_membership_row_effective(wm)
      )
    )
  );
