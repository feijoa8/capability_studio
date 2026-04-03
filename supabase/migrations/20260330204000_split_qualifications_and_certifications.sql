-- Split enduring qualifications from renewable certifications; org-scoped rows.

DROP POLICY IF EXISTS "user_qualifications_select_manager_direct_reports" ON public.user_qualifications;
DROP POLICY IF EXISTS "user_qualifications_select_own" ON public.user_qualifications;
DROP POLICY IF EXISTS "user_qualifications_insert_own" ON public.user_qualifications;
DROP POLICY IF EXISTS "user_qualifications_update_own" ON public.user_qualifications;
DROP POLICY IF EXISTS "user_qualifications_delete_own" ON public.user_qualifications;

DROP POLICY IF EXISTS "user_certifications_select_manager_direct_reports" ON public.user_certifications;
DROP POLICY IF EXISTS "user_certifications_select_own" ON public.user_certifications;
DROP POLICY IF EXISTS "user_certifications_insert_own" ON public.user_certifications;
DROP POLICY IF EXISTS "user_certifications_update_own" ON public.user_certifications;
DROP POLICY IF EXISTS "user_certifications_delete_own" ON public.user_certifications;

CREATE TABLE IF NOT EXISTS public.user_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  title text NOT NULL,
  issuer text,
  qualification_type text,
  date_achieved date,
  notes text,
  credential_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'user_qualifications'
  ) THEN
    CREATE INDEX IF NOT EXISTS user_qualifications_org_user_idx
      ON public.user_qualifications (organisation_id, user_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.user_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  title text NOT NULL,
  issuer text,
  issue_date date,
  expiry_date date,
  renewal_required boolean NOT NULL DEFAULT true,
  notes text,
  credential_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_certifications_org_user_idx
  ON public.user_certifications (organisation_id, user_id);

ALTER TABLE IF EXISTS public.user_qualifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_certifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
  SELECT 1
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name = 'user_qualifications'
) THEN

    DROP POLICY IF EXISTS "user_qualifications_select_own" ON public.user_qualifications;
    DROP POLICY IF EXISTS "user_qualifications_insert_own" ON public.user_qualifications;
    DROP POLICY IF EXISTS "user_qualifications_update_own" ON public.user_qualifications;
    DROP POLICY IF EXISTS "user_qualifications_delete_own" ON public.user_qualifications;
    DROP POLICY IF EXISTS "user_qualifications_select_manager_direct_reports" ON public.user_qualifications;

    CREATE POLICY "user_qualifications_select_own"
      ON public.user_qualifications FOR SELECT
      USING (auth.uid() = user_id);

    CREATE POLICY "user_qualifications_insert_own"
      ON public.user_qualifications FOR INSERT
      WITH CHECK (auth.uid() = user_id);

    CREATE POLICY "user_qualifications_update_own"
      ON public.user_qualifications FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);

    CREATE POLICY "user_qualifications_delete_own"
      ON public.user_qualifications FOR DELETE
      USING (auth.uid() = user_id);

    CREATE POLICY "user_qualifications_select_manager_direct_reports"
      ON public.user_qualifications FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.user_reporting_lines url
          WHERE url.user_id = user_qualifications.user_id
            AND url.manager_user_id = auth.uid()
        )
      );

  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'user_certifications'
  ) THEN

    DROP POLICY IF EXISTS "user_certifications_select_own" ON public.user_certifications;
    DROP POLICY IF EXISTS "user_certifications_insert_own" ON public.user_certifications;
    DROP POLICY IF EXISTS "user_certifications_update_own" ON public.user_certifications;
    DROP POLICY IF EXISTS "user_certifications_delete_own" ON public.user_certifications;
    DROP POLICY IF EXISTS "user_certifications_select_manager_direct_reports" ON public.user_certifications;

    CREATE POLICY "user_certifications_select_own"
      ON public.user_certifications FOR SELECT
      USING (auth.uid() = user_id);

    CREATE POLICY "user_certifications_insert_own"
      ON public.user_certifications FOR INSERT
      WITH CHECK (auth.uid() = user_id);

    CREATE POLICY "user_certifications_update_own"
      ON public.user_certifications FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);

    CREATE POLICY "user_certifications_delete_own"
      ON public.user_certifications FOR DELETE
      USING (auth.uid() = user_id);

    CREATE POLICY "user_certifications_select_manager_direct_reports"
      ON public.user_certifications FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.user_reporting_lines url
          WHERE url.user_id = user_certifications.user_id
            AND url.manager_user_id = auth.uid()
        )
      );

  END IF;
END $$;