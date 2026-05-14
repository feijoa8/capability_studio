import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import {
  addDevelopmentFocusItem,
  addUpdateForFocusItem,
  archiveDevelopmentFocusItem,
  deleteDevelopmentFocusItem,
  listUpdatesForFocusItem,
  setDevelopmentFocusItemDueDate,
  updateDevelopmentFocusItemStatus,
} from "./hub/developmentFocusItemsApi";
import { focusItemBacklogTags } from "./hub/developmentBacklogBadges";
import type {
  DevelopmentFocusItemRow,
  DevelopmentFocusItemStatus,
  DevelopmentFocusUpdateRow,
} from "./hub/types";
import {
  bg,
  border,
  borderSubtle,
  btnGhost,
  mutedColor,
  surface,
  surfaceHover,
  text,
} from "./hub/hubTheme";
import styles from "./MyDevelopmentSection.module.css";

const KANBAN_COLS: Array<{ key: DevelopmentFocusItemStatus; label: string }> = [
  { key: "backlog", label: "Backlog" },
  { key: "in_progress", label: "In Progress" },
  { key: "blocked", label: "Blocked" },
  { key: "complete", label: "Complete" },
];

function formatShortDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

type Props = {
  items: DevelopmentFocusItemRow[];
  setItems: Dispatch<SetStateAction<DevelopmentFocusItemRow[]>>;
  setLoadError: (msg: string | null) => void;
  addBlurb: string;
  /** When set, show a small chip on cards that are linked to a plan objective. */
  focusItemIdsLinkedToAPlan?: ReadonlySet<string> | null;
};

/**
 * Kanban backlog for the user’s `development_focus_items` (one list per user).
 */
export function DevelopmentBacklogBoard({
  items,
  setItems,
  setLoadError,
  addBlurb,
  focusItemIdsLinkedToAPlan = null,
}: Props) {
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addDesc, setAddDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  /** Which card has the progress-updates panel open. */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** Card body: default collapsed; set true to show description, due date, and actions. */
  const [cardBodyExpandedById, setCardBodyExpandedById] = useState<
    Record<string, boolean>
  >({});
  const [updatesByItemId, setUpdatesByItemId] = useState<
    Record<string, DevelopmentFocusUpdateRow[]>
  >({});
  const [updateDraftByItemId, setUpdateDraftByItemId] = useState<Record<string, string>>(
    {},
  );

  useEffect(() => {
    if (!expandedId) return;
    if (updatesByItemId[expandedId]) return;
    void (async () => {
      try {
        const rows = await listUpdatesForFocusItem(expandedId);
        setUpdatesByItemId((prev) => ({ ...prev, [expandedId]: rows }));
      } catch (e) {
        console.warn(
          "development_focus_updates load:",
          e instanceof Error ? e.message : String(e),
        );
      }
    })();
  }, [expandedId, updatesByItemId]);

  const onAdd = useCallback(async () => {
    if (!addTitle.trim()) return;
    setSaving(true);
    setLoadError(null);
    try {
      const row = await addDevelopmentFocusItem({
        organisation_id: null,
        title: addTitle,
        description: addDesc,
        source: "manual",
        related_signals: {},
        status: "backlog",
      });
      const reinforced = Boolean(row.reinforced);
      if (reinforced) {
        setItems((prev) => {
          const i = prev.findIndex((r) => r.id === row.id);
          if (i === -1) return [row, ...prev];
          const next = [...prev];
          next[i] = row;
          return next;
        });
      } else {
        setItems((prev) => [row, ...prev]);
      }
      setAddTitle("");
      setAddDesc("");
      setAddModalOpen(false);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not add item.");
    } finally {
      setSaving(false);
    }
  }, [addTitle, addDesc, setItems, setLoadError]);

  const onAddModalSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      void onAdd();
    },
    [onAdd],
  );

  const personalCard = {
    padding: "16px 18px",
    borderRadius: 10,
    backgroundColor: surface,
    border: `1px solid ${border}`,
    boxSizing: "border-box" as const,
  };

  return (
    <div className={styles.backlogBoardRoot}>
      <section>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <p
            style={{
              margin: 0,
              flex: "1 1 16rem",
              minWidth: 0,
              fontSize: 14,
              color: mutedColor,
              lineHeight: 1.55,
            }}
          >
            {addBlurb}
          </p>
          <button
            type="button"
            onClick={() => {
              setLoadError(null);
              setAddTitle("");
              setAddDesc("");
              setAddModalOpen(true);
            }}
            style={{
              ...btnGhost,
              flexShrink: 0,
              fontSize: 13,
              fontWeight: 600,
              padding: "8px 14px",
            }}
          >
            Add backlog item
          </button>
        </div>
      </section>

      <section>
        <p
          style={{
            margin: 0,
            fontSize: 12,
            fontWeight: 600,
            color: mutedColor,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          Board
        </p>
        <div className={styles.kanbanScroll}>
          <div className={styles.kanbanGrid}>
          {KANBAN_COLS.map((col) => {
            const rows = items.filter((x) => x.status === col.key && !x.archived);
            return (
              <div key={col.key} className={styles.kanbanCol}>
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    fontWeight: 600,
                    color: mutedColor,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                  }}
                >
                  {col.label} <span style={{ color: mutedColor }}>· {rows.length}</span>
                </p>
                {rows.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 13, color: mutedColor }}>—</p>
                ) : (
                  rows.map((r) => {
                    const updatesOpen = expandedId === r.id;
                    const updates = updatesByItemId[r.id] ?? [];
                    const dueIso = r.due_date?.trim() || "";
                    const dueInput =
                      dueIso && !Number.isNaN(new Date(dueIso).getTime())
                        ? new Date(dueIso).toISOString().slice(0, 10)
                        : "";
                    const statusBtn = {
                      ...btnGhost,
                      fontSize: 12,
                      padding: "6px 10px",
                      fontWeight: 600,
                      color: text,
                      flexShrink: 0,
                    } as const;
                    const archiveDeleteBtn = {
                      ...btnGhost,
                      fontSize: 12,
                      padding: "6px 10px",
                      fontWeight: 400,
                      color: mutedColor,
                      opacity: 0.92,
                      flexShrink: 0,
                    } as const;
                    const tagChips = focusItemBacklogTags(r);
                    const isBodyExpanded = cardBodyExpandedById[r.id] === true;
                    return (
                      <div
                        key={r.id}
                        style={{
                          padding: "12px 14px",
                          borderRadius: 10,
                          backgroundColor: surface,
                          border: `1px solid ${borderSubtle}`,
                          display: "grid",
                          gap: isBodyExpanded ? 10 : 0,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 10,
                            alignItems: "flex-start",
                          }}
                        >
                          <div
                            style={{
                              flex: 1,
                              minWidth: 0,
                              display: "grid",
                              gap: 6,
                            }}
                          >
                            {isBodyExpanded ? (
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  gap: 8,
                                  flexWrap: "wrap",
                                  alignItems: "center",
                                }}
                              >
                                <p
                                  style={{
                                    margin: 0,
                                    fontSize: 14,
                                    fontWeight: 600,
                                    color: text,
                                  }}
                                >
                                  {r.title}
                                </p>
                                <span
                                  style={{ fontSize: 10, color: mutedColor, fontWeight: 500 }}
                                >
                                  {r.source}
                                </span>
                              </div>
                            ) : (
                              <p
                                style={{
                                  margin: 0,
                                  fontSize: 14,
                                  fontWeight: 600,
                                  color: text,
                                  lineHeight: 1.35,
                                }}
                              >
                                {r.title}
                              </p>
                            )}
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {tagChips.map((t) => (
                                <span
                                  key={t.key + t.label}
                                  style={{
                                    fontSize: 9,
                                    fontWeight: 700,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.04em",
                                    color: text,
                                    padding: "2px 7px",
                                    borderRadius: 999,
                                    border: `1px solid ${borderSubtle}`,
                                    backgroundColor: "rgba(0,0,0,0.2)",
                                  }}
                                >
                                  {t.label}
                                </span>
                              ))}
                              {focusItemIdsLinkedToAPlan?.has(r.id) ? (
                                <span
                                  style={{
                                    fontSize: 9,
                                    fontWeight: 600,
                                    color: mutedColor,
                                    padding: "2px 7px",
                                    borderRadius: 999,
                                    border: `1px solid rgba(110, 176, 240, 0.35)`,
                                    backgroundColor: "rgba(110, 176, 240, 0.08)",
                                  }}
                                >
                                  On a plan
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <button
                            type="button"
                            aria-expanded={isBodyExpanded}
                            title={isBodyExpanded ? "Collapse card" : "Expand card"}
                            onClick={() => {
                              setCardBodyExpandedById((prev) => {
                                const wasExpanded = prev[r.id] === true;
                                if (wasExpanded) {
                                  setExpandedId((exp) => (exp === r.id ? null : exp));
                                }
                                return { ...prev, [r.id]: !wasExpanded };
                              });
                            }}
                            style={{
                              ...btnGhost,
                              flexShrink: 0,
                              fontSize: 14,
                              lineHeight: 1,
                              padding: "4px 8px",
                              minWidth: 28,
                              color: mutedColor,
                            }}
                          >
                            {isBodyExpanded ? "▾" : "▸"}
                          </button>
                        </div>
                        {isBodyExpanded ? (
                          <>
                            {r.description?.trim() ? (
                              <p
                                style={{
                                  margin: 0,
                                  fontSize: 13,
                                  color: mutedColor,
                                  lineHeight: 1.5,
                                }}
                              >
                                {r.description}
                              </p>
                            ) : null}
                            <label
                              style={{
                                display: "grid",
                                gap: 6,
                                fontSize: 12,
                                color: mutedColor,
                              }}
                            >
                              Due date
                              <input
                                type="date"
                                value={dueInput}
                                onChange={async (e) => {
                                  const v = e.target.value;
                                  setActionId(r.id);
                                  setLoadError(null);
                                  try {
                                    const iso = v
                                      ? new Date(`${v}T12:00:00.000Z`).toISOString()
                                      : null;
                                    await setDevelopmentFocusItemDueDate({
                                      id: r.id,
                                      due_date: iso,
                                    });
                                    setItems((prev) =>
                                      prev.map((x) =>
                                        x.id === r.id ? { ...x, due_date: iso } : x,
                                      ),
                                    );
                                  } catch (err) {
                                    setLoadError(
                                      err instanceof Error
                                        ? err.message
                                        : "Could not set due date.",
                                    );
                                  } finally {
                                    setActionId(null);
                                  }
                                }}
                                style={{
                                  width: "100%",
                                  padding: "8px 10px",
                                  fontSize: 13,
                                  color: text,
                                  backgroundColor: bg,
                                  border: `1px solid ${border}`,
                                  borderRadius: 8,
                                  boxSizing: "border-box" as const,
                                }}
                              />
                            </label>
                            <div
                              style={{
                                display: "flex",
                                flexWrap: "nowrap",
                                gap: 6,
                                alignItems: "center",
                                overflowX: "auto",
                                paddingBottom: 2,
                                WebkitOverflowScrolling: "touch",
                              }}
                            >
                              {(
                                [
                                  ["Backlog", "backlog" as const],
                                  ["In progress", "in_progress" as const],
                                  ["Blocked", "blocked" as const],
                                  ["Complete", "complete" as const],
                                ] as const
                              ).map(([label, st]) => (
                                <button
                                  key={st}
                                  type="button"
                                  disabled={actionId === r.id || r.status === st}
                                  style={statusBtn}
                                  onClick={async () => {
                                    setActionId(r.id);
                                    setLoadError(null);
                                    try {
                                      await updateDevelopmentFocusItemStatus({
                                        id: r.id,
                                        status: st,
                                      });
                                      setItems((prev) =>
                                        prev.map((x) =>
                                          x.id === r.id ? { ...x, status: st } : x,
                                        ),
                                      );
                                    } catch (err) {
                                      setLoadError(
                                        err instanceof Error
                                          ? err.message
                                          : "Could not move item.",
                                      );
                                    } finally {
                                      setActionId(null);
                                    }
                                  }}
                                >
                                  {label}
                                </button>
                              ))}
                              <span
                                aria-hidden
                                style={{
                                  display: "inline-block",
                                  width: 1,
                                  height: 14,
                                  background: borderSubtle,
                                  flexShrink: 0,
                                  margin: "0 2px",
                                }}
                              />
                              <button
                                type="button"
                                disabled={actionId === r.id}
                                style={archiveDeleteBtn}
                                onClick={async () => {
                                  setActionId(r.id);
                                  setLoadError(null);
                                  try {
                                    await archiveDevelopmentFocusItem(r.id);
                                    setItems((prev) => prev.filter((x) => x.id !== r.id));
                                  } catch (err) {
                                    setLoadError(
                                      err instanceof Error
                                        ? err.message
                                        : "Could not archive item.",
                                    );
                                  } finally {
                                    setActionId(null);
                                  }
                                }}
                              >
                                Archive
                              </button>
                              <button
                                type="button"
                                disabled={actionId === r.id}
                                style={archiveDeleteBtn}
                                onClick={async () => {
                                  if (!window.confirm("Delete this focus item?")) return;
                                  setActionId(r.id);
                                  setLoadError(null);
                                  try {
                                    await deleteDevelopmentFocusItem(r.id);
                                    setItems((prev) => prev.filter((x) => x.id !== r.id));
                                  } catch (err) {
                                    setLoadError(
                                      err instanceof Error
                                        ? err.message
                                        : "Could not delete item.",
                                    );
                                  } finally {
                                    setActionId(null);
                                  }
                                }}
                              >
                                Delete
                              </button>
                            </div>
                            <div
                              style={{
                                borderTop: `1px solid ${borderSubtle}`,
                                marginTop: 2,
                                paddingTop: 8,
                                display: "grid",
                                gap: 0,
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setExpandedId((prev) => (prev === r.id ? null : r.id));
                                }}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  width: "100%",
                                  margin: 0,
                                  padding: "2px 0 8px",
                                  border: "none",
                                  background: "transparent",
                                  cursor: "pointer",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  color: mutedColor,
                                  textAlign: "left",
                                }}
                              >
                                <span>
                                  {updatesOpen
                                    ? "Hide progress updates"
                                    : `Progress updates (${updates.length})`}
                                </span>
                              </button>
                              {updatesOpen ? (
                                <div style={{ display: "grid", gap: 10 }}>
                                  <div
                                    style={{
                                      padding: "10px 12px",
                                      borderRadius: 10,
                                      border: `1px solid ${borderSubtle}`,
                                      backgroundColor: surfaceHover,
                                      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                                    }}
                                  >
                                    {updates.length === 0 ? (
                                      <p
                                        style={{
                                          margin: 0,
                                          fontSize: 13,
                                          color: mutedColor,
                                          lineHeight: 1.5,
                                        }}
                                      >
                                        No updates yet.
                                      </p>
                                    ) : (
                                      <ul
                                        style={{
                                          margin: 0,
                                          paddingLeft: 18,
                                          display: "grid",
                                          gap: 10,
                                        }}
                                      >
                                        {updates.map((u) => (
                                          <li
                                            key={u.id}
                                            style={{
                                              listStyleType: "disc",
                                              color: mutedColor,
                                            }}
                                          >
                                            <div style={{ display: "grid", gap: 4 }}>
                                              <span
                                                style={{
                                                  fontSize: 11,
                                                  color: mutedColor,
                                                }}
                                              >
                                                {formatShortDate(u.created_at)}
                                              </span>
                                              <span
                                                style={{
                                                  fontSize: 13,
                                                  color: text,
                                                  lineHeight: 1.55,
                                                }}
                                              >
                                                {u.note}
                                              </span>
                                            </div>
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                  <div style={{ display: "grid", gap: 8 }}>
                                    <textarea
                                      rows={2}
                                      value={updateDraftByItemId[r.id] ?? ""}
                                      onChange={(e) =>
                                        setUpdateDraftByItemId((prev) => ({
                                          ...prev,
                                          [r.id]: e.target.value,
                                        }))
                                      }
                                      placeholder="Add a progress note or blocker update…"
                                      style={{
                                        width: "100%",
                                        padding: "10px 12px",
                                        fontSize: 13,
                                        color: text,
                                        backgroundColor: bg,
                                        border: `1px solid ${border}`,
                                        borderRadius: 8,
                                        boxSizing: "border-box" as const,
                                        resize: "vertical" as const,
                                        fontFamily: "inherit",
                                        lineHeight: 1.5,
                                      }}
                                    />
                                    <button
                                      type="button"
                                      disabled={actionId === r.id}
                                      style={{
                                        ...btnGhost,
                                        fontSize: 12,
                                        padding: "7px 12px",
                                        justifySelf: "start",
                                      }}
                                      onClick={async () => {
                                        const note = (updateDraftByItemId[r.id] ?? "").trim();
                                        if (!note) return;
                                        setActionId(r.id);
                                        setLoadError(null);
                                        try {
                                          const row = await addUpdateForFocusItem({
                                            focus_item_id: r.id,
                                            note,
                                          });
                                          setUpdatesByItemId((prev) => ({
                                            ...prev,
                                            [r.id]: [row, ...(prev[r.id] ?? [])],
                                          }));
                                          setUpdateDraftByItemId((prev) => ({
                                            ...prev,
                                            [r.id]: "",
                                          }));
                                        } catch (err) {
                                          setLoadError(
                                            err instanceof Error
                                              ? err.message
                                              : "Could not add update.",
                                          );
                                        } finally {
                                          setActionId(null);
                                        }
                                      }}
                                    >
                                      Add update
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            );
          })}
          </div>
        </div>
      </section>

      {addModalOpen ? (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="add-backlog-item-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "24px 16px",
            overflow: "auto",
            backgroundColor: "rgba(0,0,0,0.55)",
            boxSizing: "border-box",
          }}
          onMouseDown={(ev) => {
            if (ev.target === ev.currentTarget) {
              if (!saving) setAddModalOpen(false);
            }
          }}
        >
          <form
            onSubmit={onAddModalSubmit}
            style={{
              width: "100%",
              maxWidth: 400,
              marginTop: 32,
              ...personalCard,
              display: "grid",
              gap: 12,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="add-backlog-item-title"
              style={{
                margin: 0,
                fontSize: 17,
                fontWeight: 600,
                color: text,
              }}
            >
              Add backlog item
            </h2>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Title
              <input
                required
                value={addTitle}
                onChange={(e) => setAddTitle(e.target.value)}
                autoFocus
                placeholder="e.g. Strengthen stakeholder engagement"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  fontSize: 14,
                  color: text,
                  backgroundColor: bg,
                  border: `1px solid ${border}`,
                  borderRadius: 8,
                  boxSizing: "border-box" as const,
                }}
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Description (optional)
              <textarea
                value={addDesc}
                onChange={(e) => setAddDesc(e.target.value)}
                rows={4}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  fontSize: 14,
                  color: text,
                  backgroundColor: bg,
                  border: `1px solid ${border}`,
                  borderRadius: 8,
                  boxSizing: "border-box" as const,
                  resize: "vertical" as const,
                  fontFamily: "inherit",
                  lineHeight: 1.5,
                }}
              />
            </label>
            <div
              style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}
            >
              <button
                type="button"
                disabled={saving}
                style={{ ...btnGhost, fontSize: 13 }}
                onClick={() => {
                  if (!saving) setAddModalOpen(false);
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !addTitle.trim()}
                style={{
                  ...btnGhost,
                  fontSize: 13,
                  fontWeight: 600,
                  opacity: saving || !addTitle.trim() ? 0.5 : 1,
                }}
              >
                {saving ? "Adding…" : "Add to backlog"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
