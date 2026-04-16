-- Personal-first development focus items (backlog-first)
-- Supports Personal Account (organisation_id IS NULL) and future workspace use.

CREATE TABLE IF NOT EXISTS public.development_focus_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  organisation_id uuid REFERENCES public.organisations (id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('catalogue', 'ai', 'manual')),
  related_signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'backlog' CHECK (status IN ('backlog', 'in_progress', 'complete')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS development_focus_items_user_idx
  ON public.development_focus_items (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS development_focus_items_org_user_idx
  ON public.development_focus_items (organisation_id, user_id, updated_at DESC);

ALTER TABLE public.development_focus_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "development_focus_items_select_own" ON public.development_focus_items;
CREATE POLICY "development_focus_items_select_own"
  ON public.development_focus_items FOR SELECT
  USING (
    user_id = auth.uid()
    AND (
      organisation_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.workspace_memberships wm
        WHERE wm.organisation_id = development_focus_items.organisation_id
          AND wm.user_id = auth.uid()
          AND public.workspace_membership_row_effective(wm)
      )
    )
  );

DROP POLICY IF EXISTS "development_focus_items_insert_own" ON public.development_focus_items;
CREATE POLICY "development_focus_items_insert_own"
  ON public.development_focus_items FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (
      organisation_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.workspace_memberships wm
        WHERE wm.organisation_id = development_focus_items.organisation_id
          AND wm.user_id = auth.uid()
          AND public.workspace_membership_row_effective(wm)
      )
    )
  );

DROP POLICY IF EXISTS "development_focus_items_update_own" ON public.development_focus_items;
CREATE POLICY "development_focus_items_update_own"
  ON public.development_focus_items FOR UPDATE
  USING (
    user_id = auth.uid()
    AND (
      organisation_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.workspace_memberships wm
        WHERE wm.organisation_id = development_focus_items.organisation_id
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
        WHERE wm.organisation_id = development_focus_items.organisation_id
          AND wm.user_id = auth.uid()
          AND public.workspace_membership_row_effective(wm)
      )
    )
  );

DROP POLICY IF EXISTS "development_focus_items_delete_own" ON public.development_focus_items;
CREATE POLICY "development_focus_items_delete_own"
  ON public.development_focus_items FOR DELETE
  USING (
    user_id = auth.uid()
    AND (
      organisation_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.workspace_memberships wm
        WHERE wm.organisation_id = development_focus_items.organisation_id
          AND wm.user_id = auth.uid()
          AND public.workspace_membership_row_effective(wm)
      )
    )
  );

