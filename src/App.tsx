import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import MyDashboard from "./pages/MyDashboard";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleSignIn(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAuthError("");
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) setAuthError(error.message);
  }

  const loginBox = {
    maxWidth: 360,
    margin: "48px auto",
    padding: "0 20px",
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  } as const;

  if (!authReady) {
    return (
      <div style={{ ...loginBox, textAlign: "center", color: "#555" }}>
        Loading…
      </div>
    );
  }

  if (!session) {
    return (
      <div style={loginBox}>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 20 }}>
          Sign in
        </h1>
        <form
          onSubmit={handleSignIn}
          style={{ display: "grid", gap: 12, maxWidth: 320 }}
        >
          <input
            type="email"
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ padding: "10px 12px", fontSize: 15 }}
          />
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ padding: "10px 12px", fontSize: 15 }}
          />
          <button type="submit" style={{ padding: "10px 14px", fontSize: 15 }}>
            Sign in
          </button>
        </form>
        {authError && (
          <p style={{ color: "#b00020", marginTop: 12, fontSize: 14 }}>
            {authError}
          </p>
        )}
      </div>
    );
  }

  const userEmail = session.user.email ?? "";

  return <MyDashboard userEmail={userEmail} />;
}
