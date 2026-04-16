-- Platform-level system role on memberships (separate from workspace_role).
-- Reference library admin uses system_role = 'system_admin' + @feijoa8.com email only.

-- ---------------------------------------------------------------------------
-- Column + constraint
-- ---------------------------------------------------------------------------
ALTER TABLE public.workspace_memberships
  ADD COLUMN IF NOT EXISTS system_role text;

ALTER TABLE public.workspace_memberships
  DROP CONSTRAINT IF EXISTS workspace_memberships_system_role_check;

ALTER TABLE public.workspace_memberships
  ADD CONSTRAINT workspace_memberships_system_role_check
  CHECK (system_role IS NULL OR system_role = 'system_admin');

COMMENT ON COLUMN public.workspace_memberships.system_role IS
  'Platform-level role; only system_admin is defined. Must pair with @feijoa8.com auth email; enforced by trigger and is_reference_library_admin().';

-- ---------------------------------------------------------------------------
-- Enforce @feijoa8.com when system_role = system_admin
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workspace_memberships_enforce_system_admin_domain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  em text;
BEGIN
  IF NEW.system_role IS DISTINCT FROM 'system_admin' THEN
    RETURN NEW;
  END IF;

  SELECT u.email INTO em
  FROM auth.users u
  WHERE u.id = NEW.user_id;

  IF em IS NULL OR NOT (lower(trim(em)) ~ '^[^@]+@feijoa8\.com$') THEN
    RAISE EXCEPTION
      'system_role system_admin is only allowed for users with an @feijoa8.com email';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workspace_memberships_enforce_system_admin_domain_trg
  ON public.workspace_memberships;

CREATE TRIGGER workspace_memberships_enforce_system_admin_domain_trg
  BEFORE INSERT OR UPDATE OF system_role, user_id ON public.workspace_memberships
  FOR EACH ROW
  EXECUTE PROCEDURE public.workspace_memberships_enforce_system_admin_domain();

-- ---------------------------------------------------------------------------
-- Reference library admin gate (replaces company_it_admin proxy)
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
    INNER JOIN auth.users u ON u.id = wm.user_id
    WHERE wm.user_id = auth.uid()
      AND wm.membership_status = 'active'
      AND wm.system_role = 'system_admin'
      AND lower(trim(u.email)) ~ '^[^@]+@feijoa8\.com$'
  );
$$;

COMMENT ON FUNCTION public.is_reference_library_admin() IS
  'True when the caller has an active membership with system_role = system_admin and an @feijoa8.com auth email.';
