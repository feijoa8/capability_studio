-- Shared industry / regulatory / legal insights; link rows to organisations.

CREATE TABLE public.industry_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  summary text NOT NULL,
  category text NOT NULL,
  industry text,
  region text,
  tags text[] NOT NULL DEFAULT '{}',
  source_url text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT industry_insights_status_check CHECK (
    status IN ('active', 'deprecated', 'archived')
  ),
  CONSTRAINT industry_insights_category_check CHECK (
    category IN ('industry', 'regulatory', 'legal', 'technology', 'market')
  )
);

CREATE INDEX industry_insights_category_idx ON public.industry_insights (category);
CREATE INDEX industry_insights_status_idx ON public.industry_insights (status);
CREATE INDEX industry_insights_industry_idx ON public.industry_insights (industry);

CREATE TABLE public.organisation_insight_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  insight_id uuid NOT NULL REFERENCES public.industry_insights (id) ON DELETE CASCADE,
  relevance_note text,
  relevance_score integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organisation_insight_links_org_insight_unique UNIQUE (organisation_id, insight_id)
);

CREATE INDEX organisation_insight_links_org_idx
  ON public.organisation_insight_links (organisation_id);
CREATE INDEX organisation_insight_links_insight_idx
  ON public.organisation_insight_links (insight_id);

ALTER TABLE public.industry_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_insight_links ENABLE ROW LEVEL SECURITY;

-- Authenticated users see active insights; workspace admins see all statuses.
CREATE POLICY "industry_insights_select_active"
  ON public.industry_insights FOR SELECT
  TO authenticated
  USING (status = 'active');

CREATE POLICY "industry_insights_select_workspace_admin"
  ON public.industry_insights FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_memberships wm
      WHERE wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
        AND wm.workspace_role IN (
          'company_owner',
          'company_admin',
          'company_it_admin',
          'learning_lead'
        )
    )
  );

-- Members can read insights that are linked to their organisation (any status).
CREATE POLICY "industry_insights_select_linked_org_member"
  ON public.industry_insights FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organisation_insight_links oil
      INNER JOIN public.workspace_memberships wm
        ON wm.organisation_id = oil.organisation_id
      WHERE oil.insight_id = industry_insights.id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
    )
  );

CREATE POLICY "industry_insights_insert_workspace_admin"
  ON public.industry_insights FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workspace_memberships wm
      WHERE wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
        AND wm.workspace_role IN (
          'company_owner',
          'company_admin',
          'company_it_admin',
          'learning_lead'
        )
    )
  );

CREATE POLICY "industry_insights_update_workspace_admin"
  ON public.industry_insights FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_memberships wm
      WHERE wm.user_id = auth.uid()
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
      SELECT 1
      FROM public.workspace_memberships wm
      WHERE wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
        AND wm.workspace_role IN (
          'company_owner',
          'company_admin',
          'company_it_admin',
          'learning_lead'
        )
    )
  );

-- Org members can read links for their organisation.
CREATE POLICY "organisation_insight_links_select_member"
  ON public.organisation_insight_links FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_memberships wm
      WHERE wm.organisation_id = organisation_insight_links.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
    )
  );

CREATE POLICY "organisation_insight_links_insert_workspace_admin"
  ON public.organisation_insight_links FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workspace_memberships wm
      WHERE wm.organisation_id = organisation_insight_links.organisation_id
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

CREATE POLICY "organisation_insight_links_update_workspace_admin"
  ON public.organisation_insight_links FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_memberships wm
      WHERE wm.organisation_id = organisation_insight_links.organisation_id
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
      SELECT 1
      FROM public.workspace_memberships wm
      WHERE wm.organisation_id = organisation_insight_links.organisation_id
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

CREATE POLICY "organisation_insight_links_delete_workspace_admin"
  ON public.organisation_insight_links FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_memberships wm
      WHERE wm.organisation_id = organisation_insight_links.organisation_id
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
