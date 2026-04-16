-- Allow standalone Individual / Personal Account career plans (no workspace).
-- One row per user where organisation_id IS NULL; workspace rows unchanged.

ALTER TABLE public.user_career_plans
  ALTER COLUMN organisation_id DROP NOT NULL;

ALTER TABLE public.user_career_plans
  DROP CONSTRAINT IF EXISTS user_career_plans_user_org_unique;

-- Personal: at most one plan per user with NULL organisation_id
CREATE UNIQUE INDEX IF NOT EXISTS user_career_plans_personal_user_unique
  ON public.user_career_plans (user_id)
  WHERE (organisation_id IS NULL);

-- Workspace: keep one plan per (user, organisation) when organisation is set
CREATE UNIQUE INDEX IF NOT EXISTS user_career_plans_workspace_user_org_unique
  ON public.user_career_plans (user_id, organisation_id)
  WHERE (organisation_id IS NOT NULL);

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
