-- Shared reference capability library (global, not org-scoped).
-- Org taxonomy traceability on competency_subjects / competencies.
-- Safe to re-run: uses IF NOT EXISTS / idempotent patterns.

-- ---------------------------------------------------------------------------
-- Reference lifecycle (shared across reference_* tables)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'reference_lifecycle_status'
  ) THEN
    CREATE TYPE public.reference_lifecycle_status AS ENUM (
      'draft',
      'reviewed',
      'published',
      'deprecated',
      'archived'
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Core reference tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reference_frameworks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  description text,
  lifecycle_status public.reference_lifecycle_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS reference_frameworks_code_normalized_uq
  ON public.reference_frameworks (lower(trim(both from code)));

CREATE INDEX IF NOT EXISTS reference_frameworks_lifecycle_idx
  ON public.reference_frameworks (lifecycle_status);

CREATE TABLE IF NOT EXISTS public.reference_capability_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_framework_id uuid NOT NULL REFERENCES public.reference_frameworks (id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  sort_order int NOT NULL DEFAULT 0,
  lifecycle_status public.reference_lifecycle_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reference_capability_areas_framework_idx
  ON public.reference_capability_areas (reference_framework_id);

CREATE TABLE IF NOT EXISTS public.reference_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_capability_area_id uuid NOT NULL REFERENCES public.reference_capability_areas (id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  lifecycle_status public.reference_lifecycle_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reference_subjects_area_idx
  ON public.reference_subjects (reference_capability_area_id);

CREATE INDEX IF NOT EXISTS reference_subjects_lifecycle_idx
  ON public.reference_subjects (lifecycle_status);

CREATE TABLE IF NOT EXISTS public.reference_competencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_subject_id uuid NOT NULL REFERENCES public.reference_subjects (id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  canonical_name text,
  lifecycle_status public.reference_lifecycle_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reference_competencies_subject_idx
  ON public.reference_competencies (reference_subject_id);

CREATE INDEX IF NOT EXISTS reference_competencies_lifecycle_idx
  ON public.reference_competencies (lifecycle_status);

CREATE TABLE IF NOT EXISTS public.reference_competency_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_competency_id uuid NOT NULL REFERENCES public.reference_competencies (id) ON DELETE CASCADE,
  alias text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reference_competency_aliases_comp_idx
  ON public.reference_competency_aliases (reference_competency_id);

CREATE TABLE IF NOT EXISTS public.reference_subject_framework_links (
  reference_subject_id uuid NOT NULL REFERENCES public.reference_subjects (id) ON DELETE CASCADE,
  reference_framework_id uuid NOT NULL REFERENCES public.reference_frameworks (id) ON DELETE CASCADE,
  PRIMARY KEY (reference_subject_id, reference_framework_id)
);

CREATE TABLE IF NOT EXISTS public.reference_competency_framework_links (
  reference_competency_id uuid NOT NULL REFERENCES public.reference_competencies (id) ON DELETE CASCADE,
  reference_framework_id uuid NOT NULL REFERENCES public.reference_frameworks (id) ON DELETE CASCADE,
  PRIMARY KEY (reference_competency_id, reference_framework_id)
);

CREATE TABLE IF NOT EXISTS public.reference_starter_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  description text,
  reference_framework_id uuid REFERENCES public.reference_frameworks (id) ON DELETE SET NULL,
  lifecycle_status public.reference_lifecycle_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS reference_starter_packs_code_normalized_uq
  ON public.reference_starter_packs (lower(trim(both from code)));

CREATE INDEX IF NOT EXISTS reference_starter_packs_lifecycle_idx
  ON public.reference_starter_packs (lifecycle_status);

CREATE TABLE IF NOT EXISTS public.reference_starter_pack_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_starter_pack_id uuid NOT NULL REFERENCES public.reference_starter_packs (id) ON DELETE CASCADE,
  reference_subject_id uuid REFERENCES public.reference_subjects (id) ON DELETE CASCADE,
  reference_competency_id uuid REFERENCES public.reference_competencies (id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  CONSTRAINT reference_starter_pack_items_one_target CHECK (
    (reference_subject_id IS NOT NULL AND reference_competency_id IS NULL)
    OR (reference_subject_id IS NULL AND reference_competency_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS reference_starter_pack_items_pack_idx
  ON public.reference_starter_pack_items (reference_starter_pack_id);

CREATE TABLE IF NOT EXISTS public.reference_review_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_table text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  performed_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Org taxonomy traceability (align names with app / product language)
-- ---------------------------------------------------------------------------
ALTER TABLE public.competency_subjects
  ADD COLUMN IF NOT EXISTS reference_subject_id uuid REFERENCES public.reference_subjects (id) ON DELETE SET NULL;

ALTER TABLE public.competency_subjects
  ADD COLUMN IF NOT EXISTS origin_type text;

ALTER TABLE public.competency_subjects DROP CONSTRAINT IF EXISTS competency_subjects_origin_type_check;
ALTER TABLE public.competency_subjects ADD CONSTRAINT competency_subjects_origin_type_check
  CHECK (
    origin_type IS NULL
    OR origin_type IN ('native', 'reference_adopted', 'imported', 'unknown')
  );

CREATE UNIQUE INDEX IF NOT EXISTS competency_subjects_org_ref_subject_unique
  ON public.competency_subjects (organisation_id, reference_subject_id)
  WHERE reference_subject_id IS NOT NULL;

ALTER TABLE public.competencies
  ADD COLUMN IF NOT EXISTS reference_competency_id uuid REFERENCES public.reference_competencies (id) ON DELETE SET NULL;

ALTER TABLE public.competencies
  ADD COLUMN IF NOT EXISTS origin_type text;

ALTER TABLE public.competencies
  ADD COLUMN IF NOT EXISTS canonical_name text;

ALTER TABLE public.competencies DROP CONSTRAINT IF EXISTS competencies_origin_type_check;
ALTER TABLE public.competencies ADD CONSTRAINT competencies_origin_type_check
  CHECK (
    origin_type IS NULL
    OR origin_type IN ('native', 'reference_adopted', 'imported', 'unknown')
  );

CREATE UNIQUE INDEX IF NOT EXISTS competencies_org_ref_comp_unique
  ON public.competencies (organisation_id, reference_competency_id)
  WHERE reference_competency_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RLS: reference layer — read for members; write for reference library admins
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_reference_library_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_memberships wm
    WHERE wm.user_id = auth.uid()
      AND wm.membership_status = 'active'
      AND wm.workspace_role = 'company_it_admin'
  );
$$;

ALTER TABLE public.reference_frameworks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_capability_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_competencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_competency_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_subject_framework_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_competency_framework_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_starter_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_starter_pack_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_review_log ENABLE ROW LEVEL SECURITY;

-- Drop legacy policies if re-running
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename LIKE 'reference_%'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      r.policyname,
      r.tablename
    );
  END LOOP;
END $$;

-- Authenticated workspace members: read published reference content; full read for reference admins.
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

CREATE POLICY "reference_subject_framework_links_select_authenticated"
  ON public.reference_subject_framework_links FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
    )
  );

CREATE POLICY "reference_competency_framework_links_select_authenticated"
  ON public.reference_competency_framework_links FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships wm
      WHERE wm.user_id = auth.uid()
        AND wm.membership_status = 'active'
    )
  );

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

CREATE POLICY "reference_review_log_select_admin"
  ON public.reference_review_log FOR SELECT TO authenticated
  USING (public.is_reference_library_admin());

-- Writes: reference library system admins only (no hard deletes required by product)
CREATE POLICY "reference_frameworks_write_admin"
  ON public.reference_frameworks FOR ALL TO authenticated
  USING (public.is_reference_library_admin())
  WITH CHECK (public.is_reference_library_admin());

CREATE POLICY "reference_capability_areas_write_admin"
  ON public.reference_capability_areas FOR ALL TO authenticated
  USING (public.is_reference_library_admin())
  WITH CHECK (public.is_reference_library_admin());

CREATE POLICY "reference_subjects_write_admin"
  ON public.reference_subjects FOR ALL TO authenticated
  USING (public.is_reference_library_admin())
  WITH CHECK (public.is_reference_library_admin());

CREATE POLICY "reference_competencies_write_admin"
  ON public.reference_competencies FOR ALL TO authenticated
  USING (public.is_reference_library_admin())
  WITH CHECK (public.is_reference_library_admin());

CREATE POLICY "reference_competency_aliases_write_admin"
  ON public.reference_competency_aliases FOR ALL TO authenticated
  USING (public.is_reference_library_admin())
  WITH CHECK (public.is_reference_library_admin());

CREATE POLICY "reference_subject_framework_links_write_admin"
  ON public.reference_subject_framework_links FOR ALL TO authenticated
  USING (public.is_reference_library_admin())
  WITH CHECK (public.is_reference_library_admin());

CREATE POLICY "reference_competency_framework_links_write_admin"
  ON public.reference_competency_framework_links FOR ALL TO authenticated
  USING (public.is_reference_library_admin())
  WITH CHECK (public.is_reference_library_admin());

CREATE POLICY "reference_starter_packs_write_admin"
  ON public.reference_starter_packs FOR ALL TO authenticated
  USING (public.is_reference_library_admin())
  WITH CHECK (public.is_reference_library_admin());

CREATE POLICY "reference_starter_pack_items_write_admin"
  ON public.reference_starter_pack_items FOR ALL TO authenticated
  USING (public.is_reference_library_admin())
  WITH CHECK (public.is_reference_library_admin());

CREATE POLICY "reference_review_log_insert_admin"
  ON public.reference_review_log FOR INSERT TO authenticated
  WITH CHECK (public.is_reference_library_admin());

COMMENT ON FUNCTION public.is_reference_library_admin IS
  'Reference library “system admin” gate: company_it_admin workspace role (tenant-wide).';
