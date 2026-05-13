import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  border,
  btnGhost,
  btnPrimary,
  errorColor,
  fieldBg,
  mutedColor,
  surface,
  surfaceHover,
  text,
} from "../hub/hubTheme";
import {
  fetchInternalMembersForOrg,
  type InternalMemberPick,
} from "./hiringApi";

type Props = {
  open: boolean;
  organisationId: string;
  openingId: string;
  existingCandidateIds: Set<string>;
  onClose: () => void;
  onAdded: () => void;
};

export function AddCandidateModal({
  open,
  organisationId,
  openingId,
  existingCandidateIds,
  onClose,
  onAdded,
}: Props) {
  const [members, setMembers] = useState<InternalMemberPick[]>([]);
  const [query, setQuery] = useState("");
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setError(null);
    void (async () => {
      const rows = await fetchInternalMembersForOrg(supabase, organisationId);
      setMembers(rows);
    })();
  }, [open, organisationId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members.filter((m) => {
      if (existingCandidateIds.has(m.userId)) return false;
      if (!q) return true;
      return (
        m.displayName.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q)
      );
    });
  }, [members, query, existingCandidateIds]);

  async function addOne(userId: string) {
    setError(null);
    setAddingId(userId);
    const { error: err } = await supabase.from("hiring_applications").insert({
      opening_id: openingId,
      candidate_user_id: userId,
      stage: "applied",
    });
    setAddingId(null);
    if (err) {
      setError(err.message);
      return;
    }
    onAdded();
    onClose();
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 80,
        padding: 16,
      }}
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "min(480px, 100%)",
          maxHeight: "min(560px, 90vh)",
          backgroundColor: surface,
          border: `1px solid ${border}`,
          borderRadius: 12,
          padding: "20px 22px",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 600,
            color: text,
          }}
        >
          Add internal candidate
        </h3>
        <input
          type="search"
          placeholder="Search by name or email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 8,
            border: `1px solid ${border}`,
            background: fieldBg,
            color: text,
            fontSize: 14,
            boxSizing: "border-box",
          }}
        />
        {error ? (
          <p style={{ color: errorColor, fontSize: 13, margin: 0 }}>{error}</p>
        ) : null}
        <div
          style={{
            overflowY: "auto",
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            minHeight: 200,
          }}
        >
          {filtered.length === 0 ? (
            <p style={{ color: mutedColor, fontSize: 14, margin: 0 }}>
              No members match, or everyone is already on this role.
            </p>
          ) : (
            filtered.map((m) => (
              <div
                key={m.userId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${border}`,
                  background: surfaceHover,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: text, fontSize: 14 }}>
                    {m.displayName}
                  </div>
                  <div style={{ fontSize: 12, color: mutedColor }}>
                    {m.email || "—"}
                    {m.jobTitle ? (
                      <span style={{ color: text }}> · {m.jobTitle}</span>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  style={btnPrimary}
                  disabled={addingId !== null}
                  onClick={() => void addOne(m.userId)}
                >
                  {addingId === m.userId ? "…" : "Add"}
                </button>
              </div>
            ))
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" style={btnGhost} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
