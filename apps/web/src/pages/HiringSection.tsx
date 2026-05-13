import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  border,
  btnGhost,
  btnPrimary,
  mutedColor,
  panelShell,
  surface,
  text,
} from "./hub/hubTheme";
import { CreateRoleModal } from "./hiring/CreateRoleModal";
import { HiringRoleDetail } from "./hiring/HiringRoleDetail";
import {
  fetchHiringOpenings,
  fetchManagedOpeningIdSet,
  fetchPipelineStatsForOpenings,
  fetchProfileDisplayNamesByUserIds,
  formatRoleCardPipelineLine,
  type HiringOpeningRow,
  type HiringOpeningStatus,
} from "./hiring/hiringApi";

type Props = {
  activeOrgId: string | null;
  isActive: boolean;
};

function readDetailIdFromHash(): string | null {
  const h = window.location.hash.replace(/^#/, "");
  if (!h.startsWith("hiring/")) return null;
  const id = h.slice("hiring/".length).trim();
  if (/^[0-9a-f-]{36}$/i.test(id)) return id;
  return null;
}

function setHiringHash(detailId: string | null) {
  const base = `${window.location.pathname}${window.location.search}`;
  if (detailId) {
    window.history.replaceState(null, "", `${base}#hiring/${detailId}`);
  } else {
    window.history.replaceState(null, "", `${base}#hiring`);
  }
}

const STATUS_STYLE: Record<
  HiringOpeningStatus,
  { bg: string; fg: string }
> = {
  draft: { bg: "rgba(140, 140, 160, 0.2)", fg: "#c4c8d4" },
  open: { bg: "rgba(110, 176, 240, 0.15)", fg: "#8eb8e8" },
  filled: { bg: "rgba(120, 200, 160, 0.18)", fg: "#9fd4b8" },
  closed: { bg: "rgba(180, 100, 100, 0.15)", fg: "#d8a8a8" },
};

/** Defensive: DB should not return duplicates, but a stable list avoids transient key/row issues. */
function dedupeOpeningsById(rows: HiringOpeningRow[]): HiringOpeningRow[] {
  const byId = new Map<string, HiringOpeningRow>();
  for (const r of rows) {
    if (!r?.id) continue;
    if (!byId.has(r.id)) byId.set(r.id, r);
  }
  return Array.from(byId.values());
}

export function HiringSection({ activeOrgId, isActive }: Props) {
  const [detailId, setDetailId] = useState<string | null>(() =>
    readDetailIdFromHash(),
  );
  const [openings, setOpenings] = useState<HiringOpeningRow[]>([]);
  const [pipelineByOpening, setPipelineByOpening] = useState<
    Awaited<ReturnType<typeof fetchPipelineStatsForOpenings>>
  >({});
  const [ownerNames, setOwnerNames] = useState<Record<string, string>>({});
  const [jpTitles, setJpTitles] = useState<Record<string, string | null>>({});
  const [managedOpeningIds, setManagedOpeningIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [loading, setLoading] = useState(true);
  const [listRefreshing, setListRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const displayOpenings = useMemo(
    () => dedupeOpeningsById(openings),
    [openings],
  );
  /**
   * Invalidates in-flight work when the load is superseded (StrictMode, org switch,
   * rapid tab use). Stale async completions must not set partial state.
   */
  const loadSequenceRef = useRef(0);

  /** Initial list: `loadList()`; after create / back from detail: `loadList({ silent: true })` (section-level, no full-page flash). */
  const loadList = useCallback(async (opts?: { silent?: boolean }) => {
    if (!activeOrgId) return;
    const silent = opts?.silent === true;
    const seq = ++loadSequenceRef.current;
    if (silent) setListRefreshing(true);
    else setLoading(true);
    try {
      const rows = dedupeOpeningsById(
        await fetchHiringOpenings(supabase, activeOrgId),
      );
      if (seq !== loadSequenceRef.current) return;
      const ids = rows.map((r) => r.id);

      const [managedSet, pipeline] = await Promise.all([
        fetchManagedOpeningIdSet(supabase, ids),
        fetchPipelineStatsForOpenings(supabase, ids),
      ]);
      if (seq !== loadSequenceRef.current) return;

      const ownerUserIds = [
        ...new Set(
          rows.flatMap((r) =>
            [r.hiring_manager_user_id, r.hiring_lead_user_id].filter(
              (x): x is string => Boolean(x),
            ),
          ),
        ),
      ];
      const names = await fetchProfileDisplayNamesByUserIds(
        supabase,
        ownerUserIds,
      );
      if (seq !== loadSequenceRef.current) return;

      const jpIds = [
        ...new Set(
          rows.map((r) => r.job_profile_id).filter((id): id is string => Boolean(id)),
        ),
      ];
      const titles: Record<string, string | null> = {};
      if (jpIds.length > 0) {
        const { data: jps } = await supabase
          .from("job_profiles")
          .select("id, title")
          .in("id", jpIds);
        for (const raw of jps ?? []) {
          const r = raw as { id: string; title: string };
          titles[r.id] = String(r.title ?? "").trim() || null;
        }
      }
      if (seq !== loadSequenceRef.current) return;

      // Single batch: openings + managed chips + cards render together (no in-between state).
      setOpenings(rows);
      setManagedOpeningIds(managedSet);
      setPipelineByOpening(pipeline);
      setOwnerNames(names);
      setJpTitles(titles);
    } finally {
      if (seq === loadSequenceRef.current) {
        if (!silent) setLoading(false);
        if (silent) setListRefreshing(false);
      }
    }
  }, [activeOrgId]);

  useEffect(() => {
    if (!isActive || !activeOrgId) return;
    void loadList();
  }, [isActive, activeOrgId, loadList]);

  useEffect(() => {
    if (!isActive) return;
    const onHash = () => setDetailId(readDetailIdFromHash());
    window.addEventListener("hashchange", onHash);
    onHash();
    return () => window.removeEventListener("hashchange", onHash);
  }, [isActive]);

  if (!isActive) return null;

  if (!activeOrgId) {
    return (
      <div style={{ ...panelShell, marginTop: 0 }}>
        <p style={{ margin: 0, color: mutedColor, fontSize: 14 }}>
          Select a workspace to manage hiring.
        </p>
      </div>
    );
  }

  if (detailId) {
    return (
      <div style={{ ...panelShell, marginTop: 0 }}>
        <HiringRoleDetail
          organisationId={activeOrgId}
          openingId={detailId}
          onBack={() => {
            setDetailId(null);
            setHiringHash(null);
            void loadList({ silent: true });
          }}
        />
      </div>
    );
  }

  return (
    <div style={{ ...panelShell, marginTop: 0 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 22,
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 600,
              color: text,
              letterSpacing: "-0.02em",
            }}
          >
            Hiring
          </h2>
          <p
            style={{
              margin: "8px 0 0",
              fontSize: 14,
              color: mutedColor,
              lineHeight: 1.5,
            }}
          >
            Internal roles linked to job profiles. Add workspace members as
            candidates and track stages.
          </p>
        </div>
        <button type="button" style={btnPrimary} onClick={() => setCreateOpen(true)}>
          Create role
        </button>
      </div>

      {listRefreshing ? (
        <p style={{ color: mutedColor, margin: "0 0 12px", fontSize: 13 }}>
          Updating roles…
        </p>
      ) : null}

      {loading ? (
        <p style={{ color: mutedColor, margin: 0 }}>Loading…</p>
      ) : displayOpenings.length === 0 ? (
        <div
          style={{
            padding: "24px 20px",
            borderRadius: 10,
            border: `1px solid ${border}`,
            background: surface,
            color: mutedColor,
            fontSize: 14,
          }}
        >
          No hiring roles yet. Create one to get started.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: 14,
          }}
        >
          {displayOpenings.map((o) => {
            const jt = o.job_profile_id ? jpTitles[o.job_profile_id] : null;
            const title = o.title?.trim() || jt || "Untitled role";
            const st = STATUS_STYLE[o.status];
            return (
              <div
                key={o.id}
                style={{
                  padding: "16px 18px",
                  borderRadius: 10,
                  border: `1px solid ${border}`,
                  background: surface,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      fontSize: 16,
                      fontWeight: 600,
                      color: text,
                      lineHeight: 1.35,
                    }}
                  >
                    {title}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: 6,
                      flexShrink: 0,
                    }}
                  >
                    {managedOpeningIds.has(o.id) ? (
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          padding: "3px 7px",
                          borderRadius: 6,
                          border: `1px solid rgba(110, 176, 240, 0.45)`,
                          color: "#8eb8e8",
                        }}
                      >
                        Managed
                      </span>
                    ) : null}
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        padding: "4px 8px",
                        borderRadius: 6,
                        background: st.bg,
                        color: st.fg,
                      }}
                    >
                      {o.status}
                    </span>
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: mutedColor,
                    lineHeight: 1.45,
                  }}
                >
                  {formatRoleCardPipelineLine(
                    pipelineByOpening[o.id] ?? {
                      total: 0,
                      byStage: {
                        applied: 0,
                        reviewed: 0,
                        shortlisted: 0,
                        interview: 0,
                        offer: 0,
                        hired: 0,
                        rejected: 0,
                      },
                    },
                  )}
                </div>
                <div style={{ fontSize: 12, color: mutedColor, lineHeight: 1.45 }}>
                  <span style={{ color: text, fontWeight: 500 }}>
                    Hiring Manager:
                  </span>{" "}
                  {o.hiring_manager_user_id
                    ? ownerNames[o.hiring_manager_user_id] ?? "—"
                    : "—"}
                </div>
                <div style={{ fontSize: 12, color: mutedColor, lineHeight: 1.45 }}>
                  <span style={{ color: text, fontWeight: 500 }}>Hiring Lead:</span>{" "}
                  {o.hiring_lead_user_id
                    ? ownerNames[o.hiring_lead_user_id] ?? "—"
                    : "—"}
                </div>
                <div>
                  <button
                    type="button"
                    style={btnGhost}
                    onClick={() => {
                      setDetailId(o.id);
                      setHiringHash(o.id);
                    }}
                  >
                    View
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CreateRoleModal
        open={createOpen}
        organisationId={activeOrgId}
        onClose={() => setCreateOpen(false)}
        onCreated={() => void loadList({ silent: true })}
      />
    </div>
  );
}
