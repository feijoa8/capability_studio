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
import { isEarlyAccessPhase } from "@/lib/earlyAccess";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Props = {
  initialUser: User | null;
};

const navLinkStyle = {
  color: "var(--muted)",
  fontSize: "0.9rem",
  fontWeight: 500,
} as const;

const earlyAccess = isEarlyAccessPhase();

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
      <div className="container">
        <div
          className="site-header-inner"
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
          ) : earlyAccess ? (
            <>
              <a href={loginHref} className="btn btn-primary btn-sm">
                Log in
              </a>
              <a href={forgotHref} className="btn btn-ghost btn-sm">
                Forgot password
              </a>
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
        {earlyAccess && !user ? (
          <div
            role="region"
            aria-label="Controlled early access"
            style={{
              marginTop: "0.15rem",
              marginBottom: "0.65rem",
              padding: "0.85rem 1rem",
              borderRadius: "var(--radius)",
              border: "1px solid var(--border)",
              background: "var(--bg-elevated)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                flexWrap: "wrap",
                marginBottom: "0.5rem",
              }}
            >
              <h2
                style={{
                  fontSize: "0.95rem",
                  fontWeight: 650,
                  margin: 0,
                  color: "var(--text)",
                }}
              >
                Controlled Early Access
              </h2>
              <span
                style={{
                  fontSize: "0.65rem",
                  fontWeight: 600,
                  letterSpacing: "0.07em",
                  textTransform: "uppercase",
                  color: "var(--accent)",
                  border: "1px solid rgba(196, 245, 66, 0.35)",
                  padding: "2px 7px",
                  borderRadius: 6,
                }}
              >
                Early Access
              </span>
            </div>
            <p
              style={{
                margin: 0,
                fontSize: "0.875rem",
                color: "var(--muted)",
                lineHeight: 1.55,
                maxWidth: "62ch",
              }}
            >
              Capability Studio is currently available to a limited group of invited users while
              we continue testing, refinement, and platform hardening.
            </p>
            <p
              style={{
                margin: "0.65rem 0 0",
                fontSize: "0.875rem",
                color: "var(--muted)",
                lineHeight: 1.55,
                maxWidth: "62ch",
              }}
            >
              If you would like access or are interested in participating in early testing, please
              contact:{" "}
              <a href="mailto:info@feijoa8.com" style={{ fontWeight: 600 }}>
                info@feijoa8.com
              </a>
            </p>
          </div>
        ) : null}
      </div>
    </header>
  );
}
