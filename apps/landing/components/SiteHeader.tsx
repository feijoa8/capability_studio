"use client";

import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getForgotPasswordHref,
  getLoginHref,
  getOpenAppHref,
  getSignupHref,
} from "@/lib/appLinks";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Props = {
  initialUser: User | null;
};

const navLinkStyle = {
  color: "var(--muted)",
  fontSize: "0.9rem",
  fontWeight: 500,
} as const;

export function SiteHeader({ initialUser }: Props) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(initialUser);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const loginHref = useMemo(() => getLoginHref(), []);
  const signupHref = useMemo(() => getSignupHref(), []);
  const forgotHref = useMemo(() => getForgotPasswordHref(), []);
  const openAppHref = useMemo(() => getOpenAppHref(), []);

  const signOut = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
    router.refresh();
  }, [router]);

  const label = user?.email?.trim() ?? "";
  const initial = label ? label[0]!.toUpperCase() : "?";

  return (
    <header
      className="site-header"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 40,
        background: "rgba(10, 12, 16, 0.92)",
        backdropFilter: "blur(10px)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div
        className="container site-header-inner"
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto",
          alignItems: "center",
          gap: "1.25rem",
          minHeight: 64,
          paddingBlock: "0.65rem",
        }}
      >
        <Link
          href="/#hero"
          className="site-brand"
          style={{
            fontWeight: 650,
            fontSize: "1rem",
            letterSpacing: "-0.02em",
            color: "var(--text)",
            whiteSpace: "nowrap",
          }}
        >
          Feijoa8 · <span style={{ color: "var(--accent)" }}>Capability Studio</span>
        </Link>

        <nav aria-label="Primary" className="site-header-nav" style={{ justifySelf: "center" }}>
          <ul
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "1.25rem",
              listStyle: "none",
              margin: 0,
              padding: 0,
              justifyContent: "center",
            }}
          >
            <li>
              <Link href="/#value" style={navLinkStyle}>
                Why us
              </Link>
            </li>
            <li>
              <Link href="/#how-it-works" style={navLinkStyle}>
                How it works
              </Link>
            </li>
            <li>
              <Link href="/#features" style={navLinkStyle}>
                Capabilities
              </Link>
            </li>
            <li>
              <Link href="/#use-cases" style={navLinkStyle}>
                Who it&apos;s for
              </Link>
            </li>
          </ul>
        </nav>

        <div
          style={{
            justifySelf: "end",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexWrap: "wrap",
          }}
        >
          {user ? (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  paddingRight: "4px",
                  maxWidth: "min(220px, 40vw)",
                }}
                title={label || "Signed in"}
              >
                <span
                  aria-hidden
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    display: "grid",
                    placeItems: "center",
                    fontSize: "0.85rem",
                    fontWeight: 700,
                    color: "var(--accent)",
                    flexShrink: 0,
                  }}
                >
                  {initial}
                </span>
                <span
                  style={{
                    fontSize: "0.8rem",
                    color: "var(--muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {label || "Signed in"}
                </span>
              </div>
              <a href={openAppHref} className="btn btn-primary btn-sm">
                Open app
              </a>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void signOut()}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <a href={loginHref} className="btn btn-ghost btn-sm">
                Login
              </a>
              <a href={forgotHref} className="btn btn-ghost btn-sm">
                Forgot password
              </a>
              <a href={signupHref} className="btn btn-primary btn-sm">
                Get started
              </a>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
