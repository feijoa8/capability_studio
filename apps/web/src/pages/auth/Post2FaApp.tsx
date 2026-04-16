import { useState } from "react";
import MyDashboard from "../MyDashboard";
import {
  AccountSetupScreen,
  isAccountSetupCompleteInSession,
} from "./AccountSetupScreen";

type Props = {
  userEmail: string;
};

/**
 * After 2FA, show one-time account setup (personal vs workspace framing), then the main app.
 */
export function Post2FaApp({ userEmail }: Props) {
  const [setupDone, setSetupDone] = useState(isAccountSetupCompleteInSession);

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
