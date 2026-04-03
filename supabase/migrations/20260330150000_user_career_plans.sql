-- Personal career planning (per workspace); separate from development goals

CREATE TABLE IF NOT EXISTS public.user_career_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  next_role text,
  next_role_horizon text,
  future_role text,
  future_role_horizon text,
  career_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_career_plans_user_org_unique UNIQUE (user_id, organisation_id)
);

CREATE INDEX IF NOT EXISTS user_career_plans_org_user_idx
  ON public.user_career_plans (organisation_id, user_id);

ALTER TABLE public.user_career_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_career_plans_select_own" ON public.user_career_plans;
DROP POLICY IF EXISTS "user_career_plans_insert_own" ON public.user_career_plans;
DROP POLICY IF EXISTS "user_career_plans_update_own" ON public.user_career_plans;
DROP POLICY IF EXISTS "user_career_plans_delete_own" ON public.user_career_plans;

CREATE POLICY "user_career_plans_select_own"
  ON public.user_career_plans FOR SELECT
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = user_career_plans.organisation_id
        AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY "user_career_plans_insert_own"
  ON public.user_career_plans FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = user_career_plans.organisation_id
        AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY "user_career_plans_update_own"
  ON public.user_career_plans FOR UPDATE
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = user_career_plans.organisation_id
        AND wm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = user_career_plans.organisation_id
        AND wm.user_id = auth.uid()
    )
  );

CREATE POLICY "user_career_plans_delete_own"
  ON public.user_career_plans FOR DELETE
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = user_career_plans.organisation_id
        AND wm.user_id = auth.uid()
    )
  );
