-- Phase 2 onboarding: organisation signup creates org + company_owner membership in one transaction.
-- SECURITY DEFINER bypasses RLS on organisations / workspace_memberships for this controlled path.

CREATE OR REPLACE FUNCTION public.register_workspace_as_owner(p_organisation_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_uid uuid := auth.uid();
  v_name text := trim(p_organisation_name);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF v_name IS NULL OR length(v_name) = 0 THEN
    RAISE EXCEPTION 'organisation name required';
  END IF;
  IF length(v_name) > 200 THEN
    RAISE EXCEPTION 'organisation name too long';
  END IF;

  -- One-shot onboarding: user must not already have any workspace row.
  IF EXISTS (
    SELECT 1 FROM public.workspace_memberships wm
    WHERE wm.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'workspace membership already exists for this user';
  END IF;

  INSERT INTO public.organisations (name)
  VALUES (v_name)
  RETURNING id INTO v_org_id;

  INSERT INTO public.workspace_memberships (
    organisation_id,
    user_id,
    workspace_role,
    membership_status,
    access_type,
    approved_by_owner,
    is_primary
  ) VALUES (
    v_org_id,
    v_uid,
    'company_owner',
    'active',
    'standard',
    true,
    true
  );

  RETURN v_org_id;
END;
$$;

COMMENT ON FUNCTION public.register_workspace_as_owner(text) IS
  'Onboarding: authenticated user with no memberships creates an organisation and becomes company_owner (standard access, active).';

REVOKE ALL ON FUNCTION public.register_workspace_as_owner(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_workspace_as_owner(text) TO authenticated;
