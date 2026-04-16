-- Contextual relevance: Competency ↔ Practice (many-to-many).
-- Practices do not own taxonomy; this table only records which catalogue competencies
-- are relevant in a given practice context.

CREATE TABLE IF NOT EXISTS public.competency_practice_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  competency_id uuid NOT NULL REFERENCES public.competencies (id) ON DELETE CASCADE,
  practice_id uuid NOT NULL REFERENCES public.competency_practices (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT competency_practice_links_unique UNIQUE (competency_id, practice_id)
);

CREATE INDEX IF NOT EXISTS competency_practice_links_org_practice_idx
  ON public.competency_practice_links (organisation_id, practice_id);

CREATE INDEX IF NOT EXISTS competency_practice_links_org_competency_idx
  ON public.competency_practice_links (organisation_id, competency_id);

ALTER TABLE public.competency_practice_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "competency_practice_links_select_member"
  ON public.competency_practice_links FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = competency_practice_links.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
    )
  );

CREATE POLICY "competency_practice_links_insert_admin"
  ON public.competency_practice_links FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = competency_practice_links.organisation_id
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

CREATE POLICY "competency_practice_links_delete_admin"
  ON public.competency_practice_links FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = competency_practice_links.organisation_id
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
