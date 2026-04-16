-- Phase 4: email OTP second factor (enrollment + login challenge + session proof).
-- OTP codes are stored as HMAC-SHA256 hex in application layer (edge); DB never holds plaintext.

-- ---------------------------------------------------------------------------
-- Who must use 2FA (aligns with Phase 1 role model)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_requires_mandatory_2fa(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uemail text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT email INTO uemail FROM auth.users WHERE id = p_user_id;
  IF uemail IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_user_id AND p.system_role = 'learning_consultant'
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.workspace_memberships wm
    WHERE wm.user_id = p_user_id
      AND wm.membership_status = 'active'
      AND wm.workspace_role = 'company_owner'
      AND wm.access_type = 'standard'
  ) THEN
    RETURN true;
  END IF;

  IF uemail ILIKE '%@feijoa8.com'
     AND EXISTS (
       SELECT 1 FROM public.workspace_memberships wm
       WHERE wm.user_id = p_user_id
         AND wm.membership_status = 'active'
         AND wm.system_role = 'system_admin'
     ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.user_requires_mandatory_2fa(uuid) IS
  'True when email OTP 2FA is mandatory: learning_consultant, company_owner (standard), or Feijoa8 platform operator (WM.system_admin + feijoa8 email).';

REVOKE ALL ON FUNCTION public.user_requires_mandatory_2fa(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_requires_mandatory_2fa(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Settings row (readable by owner; writes via service role / edge only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_second_factor (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  method text NOT NULL DEFAULT 'email_otp'
    CONSTRAINT user_second_factor_method_check CHECK (method = 'email_otp'),
  enabled boolean NOT NULL DEFAULT false,
  enrolled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_second_factor_enabled_idx
  ON public.user_second_factor (enabled) WHERE enabled = true;

ALTER TABLE public.user_second_factor ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_second_factor_select_own"
  ON public.user_second_factor FOR SELECT TO authenticated
  USING (user_id = auth.uid());

COMMENT ON TABLE public.user_second_factor IS
  'Email OTP 2FA enrollment; mutations from Edge Functions (service role) only.';

-- ---------------------------------------------------------------------------
-- Challenges (service role only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_second_factor_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('enroll', 'login')),
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempt_count int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  consumed_at timestamptz,
  next_resend_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_second_factor_challenges_user_purpose_idx
  ON public.user_second_factor_challenges (user_id, purpose)
  WHERE consumed_at IS NULL;

ALTER TABLE public.user_second_factor_challenges ENABLE ROW LEVEL SECURITY;

-- No policies: authenticated cannot read/write; service role bypasses RLS.

-- ---------------------------------------------------------------------------
-- Session proof after successful login OTP (ties to current JWT session)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_second_factor_session (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  session_key text NOT NULL,
  verified_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, session_key)
);

CREATE INDEX IF NOT EXISTS user_second_factor_session_expiry_idx
  ON public.user_second_factor_session (verified_until);

ALTER TABLE public.user_second_factor_session ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- RPC: current JWT has valid2FA proof for this login session
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_second_factor_session_valid()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  jwt jsonb;
  sk text;
BEGIN
  IF uid IS NULL THEN
    RETURN false;
  END IF;

  jwt := auth.jwt();
  IF jwt IS NULL THEN
    RETURN false;
  END IF;

  sk := jwt->>'session_id';
  IF sk IS NULL OR sk = '' THEN
    sk := coalesce(jwt->>'sub', '') || ':' || coalesce(jwt->>'iat', '');
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_second_factor_session s
    WHERE s.user_id = uid
      AND s.session_key = sk
      AND s.verified_until > now()
  );
END;
$$;

COMMENT ON FUNCTION public.user_second_factor_session_valid() IS
  'True when this Supabase session has completed email OTP for the current access token session.';

REVOKE ALL ON FUNCTION public.user_second_factor_session_valid() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_second_factor_session_valid() TO authenticated;

-- ---------------------------------------------------------------------------
-- Cleanup expired session rows (optional manual / cron)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_second_factor_prune_expired_sessions()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.user_second_factor_session WHERE verified_until < now();
$$;

REVOKE ALL ON FUNCTION public.user_second_factor_prune_expired_sessions() FROM PUBLIC;

-- Convenience for clients (uses auth.uid(); no user id argument).
CREATE OR REPLACE FUNCTION public.user_requires_mandatory_2fa_for_me()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_requires_mandatory_2fa(auth.uid());
$$;

REVOKE ALL ON FUNCTION public.user_requires_mandatory_2fa_for_me() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_requires_mandatory_2fa_for_me() TO authenticated;
