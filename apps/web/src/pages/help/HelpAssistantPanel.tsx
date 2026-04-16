import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  answerHelpQuestion,
  fetchContextualHelpBundle,
  type HelpContextPayload,
} from "../../lib/helpCenterService";
import { pageContextLabel, pageKeyFromAppSection } from "../../lib/helpPageKeys";
import type { AppSection } from "../hub/types";
import {
  bg,
  border,
  brandLime,
  brandLimeMuted,
  btn,
  btnPrimary,
  errorColor,
  mutedColor,
  surface,
  text,
} from "../hub/hubTheme";

type Props = {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  activeSection: AppSection;
  workspaceRole: string | null;
  /** Membership row `system_role` (e.g. system_admin) — help audience for platform articles. */
  membershipSystemRole: string | null;
  /** `profiles.system_role` — e.g. learning_consultant. */
  profileSystemRole: string | null;
  organisationId: string | null;
  userEmail: string;
};

export function HelpAssistantPanel({
  open,
  onOpen,
  onClose,
  activeSection,
  workspaceRole,
  membershipSystemRole,
  profileSystemRole,
  organisationId,
  userEmail,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const ctx: HelpContextPayload = {
    surface: "app",
    page_key: pageKeyFromAppSection(activeSection),
    workspace_role: workspaceRole,
    system_role: membershipSystemRole,
    profile_system_role: profileSystemRole,
    organisation_id: organisationId,
  };

  const pageLabel = pageContextLabel(ctx.page_key ?? "dashboard");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    let c = false;
    (async () => {
      setLoading(true);
      setError(null);
      setReply(null);
      try {
        const bundle = await fetchContextualHelpBundle(supabase, ctx);
        if (c) return;
        const p = bundle.mapping?.starter_prompt
          ? `**This page:** ${bundle.mapping.starter_prompt}\n\n`
          : "";
        const hints: string[] = [];
        for (const a of bundle.articles.slice(0, 3)) {
          hints.push(`• ${a.title}`);
        }
        for (const f of bundle.faqs.slice(0, 2)) {
          hints.push(`• FAQ: ${f.question.slice(0, 72)}`);
        }
        setPreview(
          p + (hints.length ? `**Matching help:**\n${hints.join("\n")}` : ""),
        );
      } catch (e) {
        if (!c) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!c) setLoading(false);
      }
    })();
    return () => {
      c = true;
    };
  }, [
    open,
    activeSection,
    workspaceRole,
    membershipSystemRole,
    profileSystemRole,
    organisationId,
  ]);

  async function ask() {
    const q = question.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    try {
      const out = await answerHelpQuestion(supabase, ctx, q);
      setReply(out.reply);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label="Open Capability Studio assistant"
        title="Help & answers"
        onClick={onOpen}
        style={{
          position: "fixed",
          right: 22,
          bottom: 22,
          zIndex: 2400,
          width: 52,
          height: 52,
          borderRadius: "50%",
          border: `1px solid ${border}`,
          background: `linear-gradient(145deg, ${brandLime} 0%, #a8d63a 100%)`,
          color: "#0a0c10",
          fontSize: 22,
          fontWeight: 700,
          cursor: "pointer",
          boxShadow: `0 10px 28px rgba(0,0,0,0.45), 0 0 0 1px ${brandLimeMuted}`,
          lineHeight: 1,
          display: "grid",
          placeItems: "center",
        }}
      >
        <span aria-hidden style={{ transform: "translateY(-1px)" }}>
          ?
        </span>
      </button>

      {open ? (
        <>
          <div
            role="presentation"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 2500,
              background: "rgba(0,0,0,0.52)",
            }}
            onClick={onClose}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
            }}
          />
          <div
            role="dialog"
            aria-modal
            aria-labelledby="help-assistant-title"
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              width: "min(440px, 100vw)",
              height: "100vh",
              backgroundColor: bg,
              borderLeft: `1px solid ${border}`,
              zIndex: 2600,
              display: "flex",
              flexDirection: "column",
              boxShadow: "-8px 0 32px rgba(0,0,0,0.45)",
              animation: "helpPanelIn 0.22s ease forwards",
            }}
          >
            <style>
              {`
                @keyframes helpPanelIn {
                  from { transform: translateX(100%); opacity: 0.96; }
                  to { transform: translateX(0); opacity: 1; }
                }
              `}
            </style>
            <div
              style={{
                padding: "14px 16px",
                borderBottom: `1px solid ${border}`,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 12,
                backgroundColor: surface,
              }}
            >
              <div>
                <p
                  id="help-assistant-title"
                  style={{
                    margin: 0,
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: brandLime,
                  }}
                >
                  Capability Studio
                </p>
                <span style={{ fontWeight: 650, fontSize: 16, color: text }}>
                  Assistant
                </span>
                <p style={{ margin: "6px 0 0", fontSize: 12, color: mutedColor, lineHeight: 1.45 }}>
                  Grounded answers from your Help Center — not generic AI guesses.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                style={{ ...btn, padding: "6px 12px", flexShrink: 0 }}
              >
                Close
              </button>
            </div>
            <div
              style={{
                padding: 14,
                flex: 1,
                overflowY: "auto",
                fontSize: 13,
                color: text,
              }}
            >
              <p
                style={{
                  margin: "0 0 10px",
                  padding: "8px 10px",
                  borderRadius: 8,
                  backgroundColor: "rgba(196, 245, 66, 0.06)",
                  border: `1px solid ${brandLimeMuted}`,
                  fontSize: 12,
                  color: mutedColor,
                  lineHeight: 1.45,
                }}
              >
                <strong style={{ color: text }}>Where you are:</strong> {pageLabel}
                {userEmail ? (
                  <>
                    {" "}
                    · Signed in
                  </>
                ) : null}
              </p>
              {loading && !reply ? (
                <p style={{ color: mutedColor }}>Loading contextual help…</p>
              ) : null}
              {preview ? (
                <div
                  style={{
                    marginBottom: 12,
                    padding: 10,
                    borderRadius: 8,
                    border: `1px solid ${border}`,
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.5,
                  }}
                >
                  {preview}
                </div>
              ) : null}
              {error ? <p style={{ color: errorColor }}>{error}</p> : null}
              <label style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                <span style={{ color: mutedColor, fontSize: 12 }}>Ask a question</span>
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  rows={3}
                  placeholder="e.g. How do starter packs work?"
                  style={{
                    width: "100%",
                    padding: 8,
                    borderRadius: 8,
                    border: `1px solid ${border}`,
                    backgroundColor: "#0c0f14",
                    color: text,
                    resize: "vertical",
                  }}
                />
              </label>
              <button
                type="button"
                style={btnPrimary}
                disabled={loading || !question.trim()}
                onClick={() => void ask()}
              >
                Ask using help content
              </button>
              {reply ? (
                <div
                  style={{
                    marginTop: 14,
                    padding: 10,
                    borderRadius: 8,
                    border: `1px solid ${border}`,
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.55,
                  }}
                >
                  {reply}
                </div>
              ) : null}
              <p style={{ marginTop: 12, fontSize: 11, color: mutedColor, lineHeight: 1.45 }}>
                Answers are assembled from published Help Center articles and FAQs only. If
                nothing is published for this area yet, add or publish content in{" "}
                <strong style={{ color: text }}>Help Center (system)</strong>.
              </p>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
