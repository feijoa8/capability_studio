-- Generated: consultant RLS — policies recreated with workspace_membership_row_effective.
-- Drops prior policies by name and recreates patched bodies.

DROP POLICY IF EXISTS "reference_frameworks_select_authenticated" ON public.reference_frameworks;
CREATE POLICY "reference_frameworks_select_authenticated"
  ON public.reference_frameworks FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
    )
    AND (
      lifecycle_status IN ('published', 'deprecated')
      OR public.is_reference_library_admin()
    )
  );

DROP POLICY IF EXISTS "reference_capability_areas_select_authenticated" ON public.reference_capability_areas;
CREATE POLICY "reference_capability_areas_select_authenticated"
  ON public.reference_capability_areas FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
    )
    AND (
      lifecycle_status IN ('published', 'deprecated')
      OR public.is_reference_library_admin()
    )
  );

DROP POLICY IF EXISTS "reference_subjects_select_authenticated" ON public.reference_subjects;
CREATE POLICY "reference_subjects_select_authenticated"
  ON public.reference_subjects FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
    )
    AND (
      lifecycle_status IN ('published', 'deprecated')
      OR public.is_reference_library_admin()
    )
  );

DROP POLICY IF EXISTS "reference_competencies_select_authenticated" ON public.reference_competencies;
CREATE POLICY "reference_competencies_select_authenticated"
  ON public.reference_competencies FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
    )
    AND (
      lifecycle_status IN ('published', 'deprecated')
      OR public.is_reference_library_admin()
    )
  );

DROP POLICY IF EXISTS "reference_competency_aliases_select_authenticated" ON public.reference_competency_aliases;
CREATE POLICY "reference_competency_aliases_select_authenticated"
  ON public.reference_competency_aliases FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
    )
    AND (
      EXISTS (
        SELECT 1 FROM public.reference_competencies rc
        WHERE rc.id = reference_competency_aliases.reference_competency_id
          AND (
            rc.lifecycle_status IN ('published', 'deprecated')
            OR public.is_reference_library_admin()
          )
      )
    )
  );

DROP POLICY IF EXISTS "reference_subject_framework_links_select_authenticated" ON public.reference_subject_framework_links;
CREATE POLICY "reference_subject_framework_links_select_authenticated"
  ON public.reference_subject_framework_links FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
    )
  );

DROP POLICY IF EXISTS "reference_competency_framework_links_select_authenticated" ON public.reference_competency_framework_links;
CREATE POLICY "reference_competency_framework_links_select_authenticated"
  ON public.reference_competency_framework_links FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
    )
  );

DROP POLICY IF EXISTS "reference_starter_packs_select_authenticated" ON public.reference_starter_packs;
CREATE POLICY "reference_starter_packs_select_authenticated"
  ON public.reference_starter_packs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
    )
    AND (
      lifecycle_status = 'published'
      OR public.is_reference_library_admin()
    )
  );

DROP POLICY IF EXISTS "reference_starter_pack_items_select_authenticated" ON public.reference_starter_pack_items;
CREATE POLICY "reference_starter_pack_items_select_authenticated"
  ON public.reference_starter_pack_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
    )
    AND (
      EXISTS (
        SELECT 1 FROM public.reference_starter_packs p
        WHERE p.id = reference_starter_pack_items.reference_starter_pack_id
          AND (
            p.lifecycle_status = 'published'
            OR public.is_reference_library_admin()
          )
      )
    )
  );

DROP POLICY IF EXISTS "competency_practice_links_select_member" ON public.competency_practice_links;
CREATE POLICY "competency_practice_links_select_member"
  ON public.competency_practice_links FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = competency_practice_links.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
        AND public.workspace_membership_row_effective(wm)
    )
  );

DROP POLICY IF EXISTS "competency_practice_links_insert_admin" ON public.competency_practice_links;
CREATE POLICY "competency_practice_links_insert_admin"
  ON public.competency_practice_links FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = competency_practice_links.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
        AND public.workspace_membership_row_effective(wm)
        AND wm.workspace_role IN (
          'company_owner',
          'company_admin',
          'company_it_admin',
          'learning_lead'
        )
    )
  );

DROP POLICY IF EXISTS "competency_practice_links_delete_admin" ON public.competency_practice_links;
CREATE POLICY "competency_practice_links_delete_admin"
  ON public.competency_practice_links FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = competency_practice_links.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
        AND public.workspace_membership_row_effective(wm)
        AND wm.workspace_role IN (
          'company_owner',
          'company_admin',
          'company_it_admin',
          'learning_lead'
        )
    )
  );

DROP POLICY IF EXISTS "subject_practice_links_select_member" ON public.subject_practice_links;
CREATE POLICY "subject_practice_links_select_member"
  ON public.subject_practice_links FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = subject_practice_links.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
        AND public.workspace_membership_row_effective(wm)
    )
  );

DROP POLICY IF EXISTS "subject_practice_links_insert_admin" ON public.subject_practice_links;
CREATE POLICY "subject_practice_links_insert_admin"
  ON public.subject_practice_links FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = subject_practice_links.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
        AND public.workspace_membership_row_effective(wm)
        AND wm.workspace_role IN (
          'company_owner',
          'company_admin',
          'company_it_admin',
          'learning_lead'
        )
    )
  );

DROP POLICY IF EXISTS "subject_practice_links_delete_admin" ON public.subject_practice_links;
CREATE POLICY "subject_practice_links_delete_admin"
  ON public.subject_practice_links FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = subject_practice_links.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
        AND public.workspace_membership_row_effective(wm)
        AND wm.workspace_role IN (
          'company_owner',
          'company_admin',
          'company_it_admin',
          'learning_lead'
        )
    )
  );

DROP POLICY IF EXISTS "capability_areas_select_member" ON public.capability_areas;
CREATE POLICY "capability_areas_select_member"
  ON public.capability_areas FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = capability_areas.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
        AND public.workspace_membership_row_effective(wm)
    )
  );

DROP POLICY IF EXISTS "capability_areas_insert_admin" ON public.capability_areas;
CREATE POLICY "capability_areas_insert_admin"
  ON public.capability_areas FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = capability_areas.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
        AND public.workspace_membership_row_effective(wm)
        AND wm.workspace_role IN (
          'company_owner',
          'company_admin',
          'company_it_admin',
          'learning_lead'
        )
    )
  );

DROP POLICY IF EXISTS "capability_areas_update_admin" ON public.capability_areas;
CREATE POLICY "capability_areas_update_admin"
  ON public.capability_areas FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = capability_areas.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
        AND public.workspace_membership_row_effective(wm)
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
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = capability_areas.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
        AND public.workspace_membership_row_effective(wm)
        AND wm.workspace_role IN (
          'company_owner',
          'company_admin',
          'company_it_admin',
          'learning_lead'
        )
    )
  );

DROP POLICY IF EXISTS "capability_areas_delete_admin" ON public.capability_areas;
CREATE POLICY "capability_areas_delete_admin"
  ON public.capability_areas FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = capability_areas.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
        AND public.workspace_membership_row_effective(wm)
        AND wm.workspace_role IN (
          'company_owner',
          'company_admin',
          'company_it_admin',
          'learning_lead'
        )
    )
  );

DROP POLICY IF EXISTS "industry_insights_select_workspace_admin" ON public.industry_insights;
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

DROP POLICY IF EXISTS "industry_insights_select_linked_org_member" ON public.industry_insights;
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
        AND public.workspace_membership_row_effective(wm)
    )
  );

DROP POLICY IF EXISTS "industry_insights_insert_workspace_admin" ON public.industry_insights;
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

DROP POLICY IF EXISTS "industry_insights_update_workspace_admin" ON public.industry_insights;
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

DROP POLICY IF EXISTS "organisation_insight_links_select_member" ON public.organisation_insight_links;
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
        AND public.workspace_membership_row_effective(wm)
    )
  );

DROP POLICY IF EXISTS "organisation_insight_links_insert_workspace_admin" ON public.organisation_insight_links;
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
        AND public.workspace_membership_row_effective(wm)
        AND wm.workspace_role IN (
          'company_owner',
          'company_admin',
          'company_it_admin',
          'learning_lead'
        )
    )
  );

DROP POLICY IF EXISTS "organisation_insight_links_update_workspace_admin" ON public.organisation_insight_links;
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
        AND public.workspace_membership_row_effective(wm)
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
        AND public.workspace_membership_row_effective(wm)
        AND wm.workspace_role IN (
          'company_owner',
          'company_admin',
          'company_it_admin',
          'learning_lead'
        )
    )
  );

DROP POLICY IF EXISTS "organisation_insight_links_delete_workspace_admin" ON public.organisation_insight_links;
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
        AND public.workspace_membership_row_effective(wm)
        AND wm.workspace_role IN (
          'company_owner',
          'company_admin',
          'company_it_admin',
          'learning_lead'
        )
    )
  );

DROP POLICY IF EXISTS "organisation_profiles_select_member" ON public.organisation_profiles;
CREATE POLICY "organisation_profiles_select_member"
  ON public.organisation_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = organisation_profiles.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
        AND public.workspace_membership_row_effective(wm)
    )
  );

DROP POLICY IF EXISTS "organisation_profiles_insert_admin" ON public.organisation_profiles;
CREATE POLICY "organisation_profiles_insert_admin"
  ON public.organisation_profiles FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = organisation_profiles.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
        AND public.workspace_membership_row_effective(wm)
        AND wm.workspace_role IN (
          'company_owner',
          'company_admin',
          'company_it_admin',
          'learning_lead'
        )
    )
  );

DROP POLICY IF EXISTS "organisation_profiles_update_admin" ON public.organisation_profiles;
CREATE POLICY "organisation_profiles_update_admin"
  ON public.organisation_profiles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = organisation_profiles.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
        AND public.workspace_membership_row_effective(wm)
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
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = organisation_profiles.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
        AND public.workspace_membership_row_effective(wm)
        AND wm.workspace_role IN (
          'company_owner',
          'company_admin',
          'company_it_admin',
          'learning_lead'
        )
    )
  );

DROP POLICY IF EXISTS "organisation_profiles_delete_admin" ON public.organisation_profiles;
CREATE POLICY "organisation_profiles_delete_admin"
  ON public.organisation_profiles FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = organisation_profiles.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
        AND public.workspace_membership_row_effective(wm)
        AND wm.workspace_role IN (
          'company_owner',
          'company_admin',
          'company_it_admin',
          'learning_lead'
        )
    )
  );

DROP POLICY IF EXISTS "teams_select_workspace_members" ON public.teams;
CREATE POLICY "teams_select_workspace_members"
  ON public.teams FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = teams.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
        AND public.workspace_membership_row_effective(wm)
    )
  );

DROP POLICY IF EXISTS "teams_insert_workspace_admin" ON public.teams;
CREATE POLICY "teams_insert_workspace_admin"
  ON public.teams FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = teams.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
        AND wm.workspace_role IN ('company_owner', 'company_admin', 'company_it_admin', 'learning_lead')
        AND wm.membership_status = 'active'
    )
  );

DROP POLICY IF EXISTS "teams_update_workspace_admin" ON public.teams;
CREATE POLICY "teams_update_workspace_admin"
  ON public.teams FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = teams.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
        AND wm.workspace_role IN ('company_owner', 'company_admin', 'company_it_admin', 'learning_lead')
        AND wm.membership_status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = teams.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
        AND wm.workspace_role IN ('company_owner', 'company_admin', 'company_it_admin', 'learning_lead')
        AND wm.membership_status = 'active'
    )
  );

DROP POLICY IF EXISTS "teams_delete_workspace_admin" ON public.teams;
CREATE POLICY "teams_delete_workspace_admin"
  ON public.teams FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = teams.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
        AND wm.workspace_role IN ('company_owner', 'company_admin', 'company_it_admin', 'learning_lead')
        AND wm.membership_status = 'active'
    )
  );

DROP POLICY IF EXISTS "user_team_assignments_select_workspace_members" ON public.user_team_assignments;
CREATE POLICY "user_team_assignments_select_workspace_members"
  ON public.user_team_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = user_team_assignments.organisation_id
        AND wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
        AND public.workspace_membership_row_effective(wm)
    )
  );

DROP POLICY IF EXISTS "user_team_assignments_insert_workspace_admin" ON public.user_team_assignments;
CREATE POLICY "user_team_assignments_insert_workspace_admin"
  ON public.user_team_assignments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = user_team_assignments.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
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

DROP POLICY IF EXISTS "user_team_assignments_update_workspace_admin" ON public.user_team_assignments;
CREATE POLICY "user_team_assignments_update_workspace_admin"
  ON public.user_team_assignments FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = user_team_assignments.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
        AND wm.workspace_role IN ('company_owner', 'company_admin', 'company_it_admin', 'learning_lead')
        AND wm.membership_status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = user_team_assignments.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
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

DROP POLICY IF EXISTS "user_team_assignments_delete_workspace_admin" ON public.user_team_assignments;
CREATE POLICY "user_team_assignments_delete_workspace_admin"
  ON public.user_team_assignments FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = user_team_assignments.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
        AND wm.workspace_role IN ('company_owner', 'company_admin', 'company_it_admin', 'learning_lead')
        AND wm.membership_status = 'active'
    )
  );

DROP POLICY IF EXISTS "user_reporting_lines_select_workspace_admin" ON public.user_reporting_lines;
CREATE POLICY "user_reporting_lines_select_workspace_admin"
  ON public.user_reporting_lines FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = user_reporting_lines.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
        AND wm.workspace_role IN ('company_owner', 'company_admin', 'company_it_admin', 'learning_lead')
        AND wm.membership_status = 'active'
    )
  );

DROP POLICY IF EXISTS "user_reporting_lines_insert_workspace_admin" ON public.user_reporting_lines;
CREATE POLICY "user_reporting_lines_insert_workspace_admin"
  ON public.user_reporting_lines FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = user_reporting_lines.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
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

DROP POLICY IF EXISTS "user_reporting_lines_update_workspace_admin" ON public.user_reporting_lines;
CREATE POLICY "user_reporting_lines_update_workspace_admin"
  ON public.user_reporting_lines FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = user_reporting_lines.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
        AND wm.workspace_role IN ('company_owner', 'company_admin', 'company_it_admin', 'learning_lead')
        AND wm.membership_status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = user_reporting_lines.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
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

DROP POLICY IF EXISTS "user_reporting_lines_delete_workspace_admin" ON public.user_reporting_lines;
CREATE POLICY "user_reporting_lines_delete_workspace_admin"
  ON public.user_reporting_lines FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.organisation_id = user_reporting_lines.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
        AND wm.workspace_role IN ('company_owner', 'company_admin', 'company_it_admin', 'learning_lead')
        AND wm.membership_status = 'active'
    )
  );

DROP POLICY IF EXISTS "user_career_plans_select_own" ON public.user_career_plans;
CREATE POLICY "user_career_plans_select_own"
  ON public.user_career_plans FOR SELECT
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = user_career_plans.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
    )
  );

DROP POLICY IF EXISTS "user_career_plans_insert_own" ON public.user_career_plans;
CREATE POLICY "user_career_plans_insert_own"
  ON public.user_career_plans FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = user_career_plans.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
    )
  );

DROP POLICY IF EXISTS "user_career_plans_update_own" ON public.user_career_plans;
CREATE POLICY "user_career_plans_update_own"
  ON public.user_career_plans FOR UPDATE
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = user_career_plans.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = user_career_plans.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
    )
  );

DROP POLICY IF EXISTS "user_career_plans_delete_own" ON public.user_career_plans;
CREATE POLICY "user_career_plans_delete_own"
  ON public.user_career_plans FOR DELETE
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = user_career_plans.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
    )
  );

DROP POLICY IF EXISTS "development_goal_notes_select" ON public.development_goal_notes;
CREATE POLICY "development_goal_notes_select"
  ON development_goal_notes FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM development_goals dg
      WHERE dg.id = development_goal_notes.goal_id
        AND EXISTS (
          SELECT 1 FROM workspace_memberships wm
          WHERE wm.organisation_id = dg.organisation_id
            AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
        )
    )
  );

DROP POLICY IF EXISTS "development_goal_notes_insert" ON public.development_goal_notes;
CREATE POLICY "development_goal_notes_insert"
  ON development_goal_notes FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM development_goals dg
      WHERE dg.id = development_goal_notes.goal_id
        AND EXISTS (
          SELECT 1 FROM workspace_memberships wm
          WHERE wm.organisation_id = dg.organisation_id
            AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
        )
        AND (
          dg.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM workspace_memberships wm2
            WHERE wm2.organisation_id = dg.organisation_id
              AND wm2.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm2)
              AND wm2.workspace_role IN ('company_admin', 'learning_lead')
          )
        )
    )
  );

DROP POLICY IF EXISTS "development_goals_select" ON public.development_goals;
CREATE POLICY "development_goals_select"
  ON development_goals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = development_goals.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
    )
  );

DROP POLICY IF EXISTS "development_goals_insert" ON public.development_goals;
CREATE POLICY "development_goals_insert"
  ON development_goals FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = development_goals.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
    )
    AND (
      development_goals.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = development_goals.organisation_id
          AND wm2.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm2)
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  );

DROP POLICY IF EXISTS "development_goals_update" ON public.development_goals;
CREATE POLICY "development_goals_update"
  ON development_goals FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = development_goals.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
    )
    AND (
      development_goals.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = development_goals.organisation_id
          AND wm2.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm2)
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = development_goals.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
    )
    AND (
      development_goals.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = development_goals.organisation_id
          AND wm2.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm2)
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  );

DROP POLICY IF EXISTS "development_goals_delete" ON public.development_goals;
CREATE POLICY "development_goals_delete"
  ON development_goals FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = development_goals.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
    )
    AND (
      development_goals.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = development_goals.organisation_id
          AND wm2.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm2)
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  );

DROP POLICY IF EXISTS "job_profile_responsibilities_org_access" ON public.job_profile_responsibilities;
CREATE POLICY "job_profile_responsibilities_org_access"
  ON job_profile_responsibilities FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM job_profiles jp
      INNER JOIN workspace_memberships wm
        ON wm.organisation_id = jp.organisation_id AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
      WHERE jp.id = job_profile_responsibilities.job_profile_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM job_profiles jp
      INNER JOIN workspace_memberships wm
        ON wm.organisation_id = jp.organisation_id AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
      WHERE jp.id = job_profile_responsibilities.job_profile_id
    )
  );

DROP POLICY IF EXISTS "job_profile_requirements_org_access" ON public.job_profile_requirements;
CREATE POLICY "job_profile_requirements_org_access"
  ON job_profile_requirements FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM job_profiles jp
      INNER JOIN workspace_memberships wm
        ON wm.organisation_id = jp.organisation_id AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
      WHERE jp.id = job_profile_requirements.job_profile_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM job_profiles jp
      INNER JOIN workspace_memberships wm
        ON wm.organisation_id = jp.organisation_id AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
      WHERE jp.id = job_profile_requirements.job_profile_id
    )
  );

DROP POLICY IF EXISTS "job_profile_skills_org_access" ON public.job_profile_skills;
CREATE POLICY "job_profile_skills_org_access"
  ON job_profile_skills FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM job_profiles jp
      INNER JOIN workspace_memberships wm
        ON wm.organisation_id = jp.organisation_id AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
      WHERE jp.id = job_profile_skills.job_profile_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM job_profiles jp
      INNER JOIN workspace_memberships wm
        ON wm.organisation_id = jp.organisation_id AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
      WHERE jp.id = job_profile_skills.job_profile_id
    )
  );

DROP POLICY IF EXISTS "org_user_competency_assessments_select" ON public.org_user_competency_assessments;
CREATE POLICY "org_user_competency_assessments_select"
  ON org_user_competency_assessments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = org_user_competency_assessments.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
    )
  );

DROP POLICY IF EXISTS "org_user_competency_assessments_insert" ON public.org_user_competency_assessments;
CREATE POLICY "org_user_competency_assessments_insert"
  ON org_user_competency_assessments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = org_user_competency_assessments.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
    )
    AND org_user_competency_assessments.contributor_user_id = auth.uid()
    AND (
      org_user_competency_assessments.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = org_user_competency_assessments.organisation_id
          AND wm2.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm2)
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  );

DROP POLICY IF EXISTS "org_user_competency_assessments_update" ON public.org_user_competency_assessments;
CREATE POLICY "org_user_competency_assessments_update"
  ON org_user_competency_assessments FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = org_user_competency_assessments.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
    )
    AND (
      org_user_competency_assessments.contributor_user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = org_user_competency_assessments.organisation_id
          AND wm2.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm2)
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  );

DROP POLICY IF EXISTS "org_user_competency_assessments_delete" ON public.org_user_competency_assessments;
CREATE POLICY "org_user_competency_assessments_delete"
  ON org_user_competency_assessments FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = org_user_competency_assessments.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
    )
    AND (
      org_user_competency_assessments.contributor_user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = org_user_competency_assessments.organisation_id
          AND wm2.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm2)
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  );

DROP POLICY IF EXISTS "org_user_job_profiles_select" ON public.org_user_job_profiles;
CREATE POLICY "org_user_job_profiles_select"
  ON org_user_job_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = org_user_job_profiles.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
    )
  );

DROP POLICY IF EXISTS "org_user_job_profiles_insert" ON public.org_user_job_profiles;
CREATE POLICY "org_user_job_profiles_insert"
  ON org_user_job_profiles FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = org_user_job_profiles.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
    )
    AND (
      org_user_job_profiles.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = org_user_job_profiles.organisation_id
          AND wm2.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm2)
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  );

DROP POLICY IF EXISTS "org_user_job_profiles_update" ON public.org_user_job_profiles;
CREATE POLICY "org_user_job_profiles_update"
  ON org_user_job_profiles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = org_user_job_profiles.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
    )
    AND (
      org_user_job_profiles.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = org_user_job_profiles.organisation_id
          AND wm2.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm2)
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = org_user_job_profiles.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
    )
    AND (
      org_user_job_profiles.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = org_user_job_profiles.organisation_id
          AND wm2.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm2)
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  );

DROP POLICY IF EXISTS "org_user_job_profiles_delete" ON public.org_user_job_profiles;
CREATE POLICY "org_user_job_profiles_delete"
  ON org_user_job_profiles FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = org_user_job_profiles.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
    )
    AND (
      org_user_job_profiles.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = org_user_job_profiles.organisation_id
          AND wm2.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm2)
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  );

DROP POLICY IF EXISTS "org_user_competencies_select" ON public.org_user_competencies;
CREATE POLICY "org_user_competencies_select"
  ON org_user_competencies FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = org_user_competencies.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
    )
  );

DROP POLICY IF EXISTS "org_user_competencies_insert" ON public.org_user_competencies;
CREATE POLICY "org_user_competencies_insert"
  ON org_user_competencies FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = org_user_competencies.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
    )
    AND (
      org_user_competencies.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = org_user_competencies.organisation_id
          AND wm2.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm2)
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  );

DROP POLICY IF EXISTS "org_user_competencies_update" ON public.org_user_competencies;
CREATE POLICY "org_user_competencies_update"
  ON org_user_competencies FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = org_user_competencies.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
    )
    AND (
      org_user_competencies.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = org_user_competencies.organisation_id
          AND wm2.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm2)
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = org_user_competencies.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
    )
    AND (
      org_user_competencies.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = org_user_competencies.organisation_id
          AND wm2.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm2)
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  );

DROP POLICY IF EXISTS "org_user_competencies_delete" ON public.org_user_competencies;
CREATE POLICY "org_user_competencies_delete"
  ON org_user_competencies FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM workspace_memberships wm
      WHERE wm.organisation_id = org_user_competencies.organisation_id
        AND wm.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm)
    )
    AND (
      org_user_competencies.user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM workspace_memberships wm2
        WHERE wm2.organisation_id = org_user_competencies.organisation_id
          AND wm2.user_id = auth.uid()
        AND public.workspace_membership_row_effective(wm2)
          AND wm2.workspace_role IN ('company_admin', 'learning_lead')
      )
    )
  );
