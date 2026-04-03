-- Allow managers to read direct reports' experience and qualifications (Team Insights).

CREATE POLICY "user_experience_select_manager_direct_reports"
  ON public.user_experience FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_reporting_lines url
      WHERE url.user_id = user_experience.user_id
        AND url.manager_user_id = auth.uid()
    )
  );

CREATE POLICY "user_qualifications_select_manager_direct_reports"
  ON public.user_qualifications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_reporting_lines url
      WHERE url.user_id = user_qualifications.user_id
        AND url.manager_user_id = auth.uid()
    )
  );
