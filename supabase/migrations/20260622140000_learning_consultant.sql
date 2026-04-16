-- Learning consultant platform role, consultant onboarding requests, and workspace access gates.
-- Consultants need: (1) profiles.system_role = learning_consultant (system admin approves request)
-- and (2) workspace_memberships with access_type = consultant, approved_by_owner = true.

-- ---------------------------------------------------------------------------
-- profiles.system_role (platform; only learning_consultant — system_admin stays on memberships for ref library)
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS system_role text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_system_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_system_role_check
  CHECK (system_role IS NULL OR system_role = 'learning_consultant');

COMMENT ON COLUMN public.profiles.system_role IS
  'Platform role: learning_consultant after system admin approves consultant_requests. Not system_admin (that remains on workspace_memberships for Feijoa8 operators).';

-- ---------------------------------------------------------------------------
-- consultant_requests (one row per user)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consultant_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consultant_requests_user_id_unique UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS consultant_requests_status_idx
  ON public.consultant_requests (status);

ALTER TABLE public.consultant_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "consultant_requests_select_own_or_sysadmin"
  ON public.consultant_requests FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_reference_library_admin()
  );

CREATE POLICY "consultant_requests_insert_own_pending"
  ON public.consultant_requests FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'
  );

CREATE POLICY "consultant_requests_update_sysadmin"
  ON public.consultant_requests FOR UPDATE TO authenticated
  USING (public.is_reference_library_admin())
  WITH CHECK (public.is_reference_library_admin());

-- ---------------------------------------------------------------------------
-- workspace_memberships: consultant access to orgs
-- ---------------------------------------------------------------------------
ALTER TABLE public.workspace_memberships
  ADD COLUMN IF NOT EXISTS access_type text NOT NULL DEFAULT 'standard';

ALTER TABLE public.workspace_memberships
  ADD COLUMN IF NOT EXISTS approved_by_owner boolean NOT NULL DEFAULT true;

ALTER TABLE public.workspace_memberships
  DROP CONSTRAINT IF EXISTS workspace_memberships_access_type_check;

ALTER TABLE public.workspace_memberships
  ADD CONSTRAINT workspace_memberships_access_type_check
  CHECK (access_type IN ('standard', 'consultant'));

COMMENT ON COLUMN public.workspace_memberships.access_type IS
  'consultant = external learning consultant; requires profiles.system_role and approved_by_owner.';

COMMENT ON COLUMN public.workspace_memberships.approved_by_owner IS
  'For access_type consultant: must be true (org owner approved). Always true for standard members.';

-- ---------------------------------------------------------------------------
-- Effective access: active membership + consultant rules
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workspace_membership_row_effective(wm public.workspace_memberships)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    wm.membership_status = 'active'
    AND (
      wm.access_type IS DISTINCT FROM 'consultant'
      OR (
        wm.access_type = 'consultant'
        AND COALESCE(wm.approved_by_owner, false) = true
        AND EXISTS (
          SELECT 1
          FROM public.profiles p
          WHERE p.id = wm.user_id
            AND p.system_role = 'learning_consultant'
        )
      )
    );
$$;

COMMENT ON FUNCTION public.workspace_membership_row_effective(public.workspace_memberships) IS
  'True when this membership row grants org data access under RLS (consultants need platform role + owner approval).';

ALTER TABLE public.workspace_memberships
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Enforce: consultant memberships only after platform learning_consultant is granted
CREATE OR REPLACE FUNCTION public.workspace_memberships_consultant_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.access_type, 'standard') = 'consultant' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = NEW.user_id AND p.system_role = 'learning_consultant'
    ) THEN
      RAISE EXCEPTION 'consultant workspace access requires profiles.system_role = learning_consultant';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workspace_memberships_consultant_guard_trg ON public.workspace_memberships;
CREATE TRIGGER workspace_memberships_consultant_guard_trg
  BEFORE INSERT OR UPDATE OF access_type, approved_by_owner, user_id
  ON public.workspace_memberships
  FOR EACH ROW
  EXECUTE PROCEDURE public.workspace_memberships_consultant_guard();

-- ---------------------------------------------------------------------------
-- RPC: system admin approves consultant (Feijoa8 operator via is_reference_library_admin)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_consultant_request(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
BEGIN
  IF NOT public.is_reference_library_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  UPDATE public.consultant_requests
  SET status = 'approved', updated_at = now()
  WHERE user_id = p_user_id AND status = 'pending';

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RAISE EXCEPTION 'no pending consultant request for this user';
  END IF;

  UPDATE public.profiles
  SET system_role = 'learning_consultant'
  WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_consultant_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_consultant_request(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: organisation owner approves consultant access to their workspace
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_consultant_workspace_membership(p_membership_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  SELECT organisation_id INTO v_org
  FROM public.workspace_memberships
  WHERE id = p_membership_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'membership not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_memberships wm
    WHERE wm.organisation_id = v_org
      AND wm.user_id = auth.uid()
      AND wm.workspace_role = 'company_owner'
      AND wm.membership_status = 'active'
      AND public.workspace_membership_row_effective(wm)
  ) THEN
    RAISE EXCEPTION 'only an effective company owner can approve consultant access';
  END IF;

  UPDATE public.workspace_memberships
  SET approved_by_owner = true
  WHERE id = p_membership_id
    AND access_type = 'consultant';
END;
$$;

REVOKE ALL ON FUNCTION public.approve_consultant_workspace_membership(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_consultant_workspace_membership(uuid) TO authenticated;
