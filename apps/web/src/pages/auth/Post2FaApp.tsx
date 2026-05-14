import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import MyDashboard from "../MyDashboard";
import {
  AccountSetupScreen,
  isAccountSetupCompleteInSession,
  markAccountSetupComplete,
} from "./AccountSetupScreen";

type Props = {
  userEmail: string;
};

/**
 * After 2FA, show one-time account setup (personal vs workspace framing), then the main app.
 *
 * Completion is persisted on `profiles.primary_account_type` (see `accountSetupCompletion.ts`).
 * `sessionStorage` alone is not sufficient across tabs/sessions; we re-check the profile row
 * so returning users are not trapped on AccountSetupScreen after every login.
 */
export function Post2FaApp({ userEmail }: Props) {
  const [setupDone, setSetupDone] = useState<boolean | null>(() =>
    isAccountSetupCompleteInSession() ? true : null,
  );

  useEffect(() => {
    if (setupDone !== null) return;

    let cancelled = false;
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) {
        if (!cancelled) setSetupDone(false);
        return;
      }
      const { data, error } = await supabase
        .from("profiles")
        .select("primary_account_type")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.warn("[Post2FaApp] profile primary_account_type check:", error.message);
        if (!cancelled) setSetupDone(false);
        return;
      }
      const t = data?.primary_account_type;
      if (t === "personal" || t === "organisation") {
        markAccountSetupComplete();
        if (!cancelled) setSetupDone(true);
      } else {
        if (!cancelled) setSetupDone(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setupDone]);

  if (setupDone === null) {
    return null;
  }

  if (!setupDone) {
    return (
      <AccountSetupScreen
        userEmail={userEmail}
        onComplete={() => setSetupDone(true)}
      />
    );
  }

  return <MyDashboard userEmail={userEmail} />;
}
