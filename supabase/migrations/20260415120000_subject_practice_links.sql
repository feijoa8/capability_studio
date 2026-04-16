-- Many-to-many: Subject ↔ Practice contextual relevance (replaces single competency_subjects.practice_id over time).

CREATE TABLE IF NOT EXISTS public.subject_practice_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.competency_subjects (id) ON DELETE CASCADE,
  practice_id uuid NOT NULL REFERENCES public.competency_practices (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subject_practice_links_unique UNIQUE (subject_id, practice_id)
);

CREATE INDEX IF NOT EXISTS subject_practice_links_org_practice_idx
  ON public.subject_practice_links (organisation_id, practice_id);

CREATE INDEX IF NOT EXISTS subject_practice_links_org_subject_idx
  ON public.subject_practice_links (organisation_id, subject_id);

-- Backfill from legacy column (idempotent via UNIQUE)
INSERT INTO public.subject_practice_links (organisation_id, subject_id, practice_id, created_at)
SELECT organisation_id, id, practice_id, now()
FROM public.competency_subjects
WHERE practice_id IS NOT NULL
ON CONFLICT (subject_id, practice_id) DO NOTHING;

ALTER TABLE public.subject_practice_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subject_practice_links_select_member"
  ON public.subject_practice_links FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = subject_practice_links.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
    )
  );

CREATE POLICY "subject_practice_links_insert_admin"
  ON public.subject_practice_links FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = subject_practice_links.organisation_id
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

CREATE POLICY "subject_practice_links_delete_admin"
  ON public.subject_practice_links FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = subject_practice_links.organisation_id
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
