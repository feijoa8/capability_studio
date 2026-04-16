-- Upgrade development_focus_items to simple Kanban + lifecycle tracking

-- Status: backlog | in_progress | blocked | complete
ALTER TABLE public.development_focus_items
  DROP CONSTRAINT IF EXISTS development_focus_items_status_check;

ALTER TABLE public.development_focus_items
  ADD CONSTRAINT development_focus_items_status_check
  CHECK (status IN ('backlog', 'in_progress', 'blocked', 'complete'));

ALTER TABLE public.development_focus_items
  ADD COLUMN IF NOT EXISTS due_date timestamptz NULL;

ALTER TABLE public.development_focus_items
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS development_focus_items_active_user_idx
  ON public.development_focus_items (user_id, status, updated_at DESC)
  WHERE archived = false;

-- Updates / notes per focus item
CREATE TABLE IF NOT EXISTS public.development_focus_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  focus_item_id uuid NOT NULL REFERENCES public.development_focus_items (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS development_focus_updates_item_idx
  ON public.development_focus_updates (focus_item_id, created_at DESC);

ALTER TABLE public.development_focus_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "development_focus_updates_select_own" ON public.development_focus_updates;
CREATE POLICY "development_focus_updates_select_own"
  ON public.development_focus_updates FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "development_focus_updates_insert_own" ON public.development_focus_updates;
CREATE POLICY "development_focus_updates_insert_own"
  ON public.development_focus_updates FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "development_focus_updates_update_own" ON public.development_focus_updates;
CREATE POLICY "development_focus_updates_update_own"
  ON public.development_focus_updates FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "development_focus_updates_delete_own" ON public.development_focus_updates;
CREATE POLICY "development_focus_updates_delete_own"
  ON public.development_focus_updates FOR DELETE
  USING (user_id = auth.uid());

