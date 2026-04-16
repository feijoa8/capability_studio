"use client";

import { useCallback, useState } from "react";
import { hasSupabaseBrowserConfig } from "@/lib/publicEnv";

const EMPTY_REPLY_PHRASE =
  "No published help content matched this page yet";

export function ChatDock() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const base =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const canChat = Boolean(base && anon);

  const send = useCallback(async () => {
    const question = q.trim();
    if (!question || !canChat) return;
    setLoading(true);
    setErr(null);
    setReply(null);
    try {
      const url = `${base}/functions/v1/help-api?action=chat`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anon,
          Authorization: `Bearer ${anon}`,
        },
        body: JSON.stringify({
          question,
          context: {
            surface: "website",
            page_key: "landing",
            feature_key: null,
          },
        }),
      });
      let data: { reply?: string; error?: string } = {};
      try {
        data = (await res.json()) as { reply?: string; error?: string };
      } catch {
        throw new Error("Invalid response from help service.");
      }
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      let text = data.reply ?? "";
      if (text.includes(EMPTY_REPLY_PHRASE)) {
        text = `${text.trim()}\n\nTip: publish website help articles tagged for the landing page in the Help Center, or ask your Feijoa8 administrator.`;
      }
      setReply(text);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not reach help service.");
    } finally {
      setLoading(false);
    }
  }, [q, base, anon, canChat]);

  const configOk = hasSupabaseBrowserConfig();

  return (
    <>
      <button
        type="button"
        aria-label="Open Capability Studio assistant"
        title="Help & answers"
        onClick={() => setOpen(true)}
        style={{
          position: "fixed",
          bottom: 22,
          right: 22,
          zIndex: 50,
          width: 52,
          height: 52,
          borderRadius: "50%",
          border: "1px solid var(--border)",
          background: "linear-gradient(145deg, var(--accent) 0%, #a8d63a 100%)",
          color: "#0a0c10",
          fontSize: "1.35rem",
          fontWeight: 700,
          cursor: "pointer",
          boxShadow:
            "0 10px 28px rgba(0,0,0,0.45), 0 0 0 1px rgba(196, 245, 66, 0.16)",
          display: "grid",
          placeItems: "center",
          lineHeight: 1,
        }}
      >
        <span aria-hidden style={{ transform: "translateY(-1px)" }}>
          ?
        </span>
      </button>
      {open ? (
        <div
          role="dialog"
          aria-modal
          aria-label="Capability Studio help"
          style={{
            position: "fixed",
            bottom: 96,
            right: 24,
            zIndex: 51,
            width: "min(380px, calc(100vw - 32px))",
            maxHeight: "min(480px, 70vh)",
            display: "flex",
            flexDirection: "column",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            boxShadow: "0 16px 48px rgba(0,0,0,0.45)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "12px 14px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <p
                style={{
                  margin: 0,
                  fontSize: "0.65rem",
                  fontWeight: 600,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "var(--accent)",
                }}
              >
                Capability Studio
              </p>
              <span style={{ fontWeight: 650, fontSize: "0.95rem", color: "var(--text)" }}>
                Assistant
              </span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn btn-ghost btn-sm"
            >
              Close
            </button>
          </div>
          <div style={{ padding: 12, overflowY: "auto", flex: 1, fontSize: "0.9rem" }}>
            <p style={{ color: "var(--muted)", margin: "0 0 8px", fontSize: "0.8rem" }}>
              Answers are grounded in published Capability Studio help content for this
              website page.
            </p>
            {!configOk ? (
              <p style={{ color: "#f0c674", marginBottom: 8, fontSize: "0.85rem" }}>
                Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable
                chat.
              </p>
            ) : null}
            <textarea
              value={q}
              onChange={(e) => setQ(e.target.value)}
              rows={3}
              placeholder="Ask about Capability Studio…"
              style={{
                width: "100%",
                padding: 8,
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text)",
                resize: "none",
                marginBottom: 8,
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: "100%" }}
              disabled={loading || !q.trim() || !canChat}
              onClick={() => void send()}
            >
              {loading ? "…" : "Ask"}
            </button>
            {err ? (
              <p style={{ color: "#f08080", marginTop: 8 }}>{err}</p>
            ) : null}
            {reply ? (
              <pre
                style={{
                  marginTop: 12,
                  whiteSpace: "pre-wrap",
                  fontFamily: "inherit",
                  color: "var(--text)",
                  lineHeight: 1.45,
                }}
              >
                {reply}
              </pre>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
