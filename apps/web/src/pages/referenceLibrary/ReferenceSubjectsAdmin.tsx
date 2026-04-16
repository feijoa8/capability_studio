import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { supabase } from "../../lib/supabase";
import {
  countCompetenciesBySubjectIds,
  countSubjectStarterPackItemsBySubjectIds,
  createReferenceSubject,
  listReferenceCapabilityAreasAdmin,
  listReferenceSubjectsAdmin,
  updateReferenceSubject,
} from "../../lib/referenceLibraryAdmin";
import { listReferenceFrameworks } from "../../lib/referenceLibrary";
import type {
  ReferenceCapabilityAreaRow,
  ReferenceLifecycleStatus,
  ReferenceSubjectRow,
} from "../../lib/referenceLibrary";
import {
  bg,
  border,
  btn,
  btnGhost,
  btnPrimary,
  errorColor,
  mutedColor,
  panelShell,
  text,
} from "../hub/hubTheme";
import { referenceAdminInputStyle } from "./referenceAdminFieldStyles";

const inp: CSSProperties = referenceAdminInputStyle;

const LIFE: ReferenceLifecycleStatus[] = [
  "draft",
  "reviewed",
  "published",
  "deprecated",
  "archived",
];

type Props = { isActive: boolean };

export function ReferenceSubjectsAdmin({ isActive }: Props) {
  const [frameworkId, setFrameworkId] = useState("");
  const [frameworks, setFrameworks] = useState<
    Awaited<ReturnType<typeof listReferenceFrameworks>>
  >([]);
  const [areas, setAreas] = useState<ReferenceCapabilityAreaRow[]>([]);
  const [subjects, setSubjects] = useState<
    (ReferenceSubjectRow & {
      reference_capability_areas?: ReferenceCapabilityAreaRow | null;
    })[]
  >([]);
  const [compCounts, setCompCounts] = useState<Record<string, number>>({});
  const [packItemCounts, setPackItemCounts] = useState<Record<string, number>>(
    {},
  );
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<
    "create" | { edit: ReferenceSubjectRow } | null
  >(null);
  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formAreaId, setFormAreaId] = useState("");
  const [formLife, setFormLife] = useState<ReferenceLifecycleStatus>("draft");
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    const subs = await listReferenceSubjectsAdmin(supabase, {
      frameworkId: frameworkId || undefined,
      lifecycle: ["draft", "reviewed", "published", "deprecated", "archived"],
    });
    setSubjects(subs);
    const ids = subs.map((s) => s.id);
    const [cc, pc] = await Promise.all([
      countCompetenciesBySubjectIds(supabase, ids),
      countSubjectStarterPackItemsBySubjectIds(supabase, ids),
    ]);
    setCompCounts(cc);
    setPackItemCounts(pc);
  }, [frameworkId]);

  useEffect(() => {
    if (!isActive) return;
    let c = false;
    (async () => {
      try {
        const fws = await listReferenceFrameworks(supabase, {
          includeNonPublishedForAdmin: true,
        });
        if (c) return;
        setFrameworks(fws);
      } catch (e) {
        if (!c) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      c = true;
    };
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;
    let c = false;
    (async () => {
      try {
        const a = await listReferenceCapabilityAreasAdmin(supabase, {
          frameworkId: frameworkId || undefined,
        });
        if (c) return;
        setAreas(a);
      } catch (e) {
        if (!c) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      c = true;
    };
  }, [isActive, frameworkId]);

  useEffect(() => {
    if (!isActive) return;
    let c = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await reload();
      } catch (e) {
        if (!c) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!c) setLoading(false);
      }
    })();
    return () => {
      c = true;
    };
  }, [isActive, reload]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return subjects;
    return subjects.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.code ?? "").toLowerCase().includes(q),
    );
  }, [subjects, search]);

  function openCreate() {
    setModal("create");
    setFormCode("");
    setFormName("");
    setFormDesc("");
    setFormAreaId(areas[0]?.id ?? "");
    setFormLife("draft");
  }

  function openEdit(s: ReferenceSubjectRow) {
    setModal({ edit: s });
    setFormCode(s.code ?? "");
    setFormName(s.name);
    setFormDesc(s.description ?? "");
    setFormAreaId(s.reference_capability_area_id);
    setFormLife(s.lifecycle_status);
  }

  function duplicateCodeInArea(code: string, areaId: string, excludeId?: string) {
    const c = code.trim().toLowerCase();
    if (!c) return false;
    return subjects.some(
      (s) =>
        s.reference_capability_area_id === areaId &&
        (s.code ?? "").trim().toLowerCase() === c &&
        s.id !== excludeId,
    );
  }

  async function save() {
    const code = formCode.trim();
    const name = formName.trim();
    if (!code || !name || !formAreaId) {
      alert("Code, name, and capability area are required.");
      return;
    }
    const exId = modal && typeof modal === "object" && "edit" in modal ? modal.edit.id : undefined;
    if (duplicateCodeInArea(code, formAreaId, exId)) {
      alert(
        "Another subject in this capability area already uses that code (case-insensitive match to your list).",
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (modal === "create") {
        await createReferenceSubject(supabase, {
          code,
          reference_capability_area_id: formAreaId,
          name,
          description: formDesc.trim() || null,
          lifecycle_status: formLife,
        });
      } else if (modal && "edit" in modal) {
        await updateReferenceSubject(supabase, modal.edit.id, {
          code,
          reference_capability_area_id: formAreaId,
          name,
          description: formDesc.trim() || null,
          lifecycle_status: formLife,
        });
      }
      setModal(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function setLifecycleQuick(
    s: ReferenceSubjectRow,
    next: ReferenceLifecycleStatus,
  ) {
    if (next === "deprecated" || next === "archived") {
      if (
        !window.confirm(
          `Set lifecycle to ${next}? This affects visibility for adoption flows.`,
        )
      ) {
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      await updateReferenceSubject(supabase, s.id, { lifecycle_status: next });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!isActive) return null;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <label style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: mutedColor }}>Framework filter</span>
          <select
            value={frameworkId}
            onChange={(e) => setFrameworkId(e.target.value)}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: `1px solid ${border}`,
              backgroundColor: "#0c0f14",
              color: text,
              minWidth: 200,
            }}
          >
            <option value="">All frameworks</option>
            {frameworks.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <input
          type="search"
          placeholder="Search code or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inp, maxWidth: 280, marginTop: 0 }}
        />
        <button type="button" style={btnPrimary} onClick={openCreate}>
          New subject
        </button>
      </div>
      {error ? <p style={{ color: errorColor, margin: 0 }}>{error}</p> : null}
      {loading ? (
        <p style={{ color: mutedColor }}>Loading…</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
              minWidth: 720,
            }}
          >
            <thead>
              <tr style={{ textAlign: "left", color: mutedColor }}>
                <th style={{ padding: 8 }}>Code</th>
                <th style={{ padding: 8 }}>Name</th>
                <th style={{ padding: 8 }}>Capability area</th>
                <th style={{ padding: 8 }}>Lifecycle</th>
                <th style={{ padding: 8 }}>Comps</th>
                <th style={{ padding: 8 }}>Pack items</th>
                <th style={{ padding: 8 }} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr
                  key={s.id}
                  style={{ borderTop: `1px solid ${border}`, color: text }}
                >
                  <td style={{ padding: 8, fontWeight: 600 }}>{s.code ?? "—"}</td>
                  <td style={{ padding: 8 }}>{s.name}</td>
                  <td style={{ padding: 8, color: mutedColor }}>
                    {s.reference_capability_areas?.name ?? "—"}
                  </td>
                  <td style={{ padding: 8, color: mutedColor }}>
                    {s.lifecycle_status}
                  </td>
                  <td style={{ padding: 8, color: mutedColor }}>
                    {compCounts[s.id] ?? 0}
                  </td>
                  <td style={{ padding: 8, color: mutedColor }}>
                    {packItemCounts[s.id] ?? 0}
                  </td>
                  <td style={{ padding: 8 }}>
                    <button
                      type="button"
                      style={{ ...btnGhost, fontSize: 11, padding: "4px 8px" }}
                      onClick={() => openEdit(s)}
                    >
                      Edit
                    </button>
                    {s.lifecycle_status !== "deprecated" &&
                    s.lifecycle_status !== "archived" ? (
                      <button
                        type="button"
                        style={{ ...btnGhost, fontSize: 11, padding: "4px 8px" }}
                        disabled={saving}
                        onClick={() => void setLifecycleQuick(s, "deprecated")}
                      >
                        Deprecate
                      </button>
                    ) : null}
                    {s.lifecycle_status !== "archived" ? (
                      <button
                        type="button"
                        style={{ ...btnGhost, fontSize: 11, padding: "4px 8px" }}
                        disabled={saving}
                        onClick={() => void setLifecycleQuick(s, "archived")}
                      >
                        Archive
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal ? (
        <div
          style={{
            ...panelShell,
            padding: 14,
            border: `1px solid ${border}`,
            backgroundColor: bg,
            maxWidth: 520,
          }}
        >
          <p style={{ margin: "0 0 10px", fontWeight: 600, color: text }}>
            {modal === "create" ? "Create reference subject" : "Edit reference subject"}
          </p>
          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ fontSize: 12, color: mutedColor }}>
              Code
              <input
                value={formCode}
                onChange={(e) => setFormCode(e.target.value)}
                style={inp}
              />
            </label>
            <label style={{ fontSize: 12, color: mutedColor }}>
              Name
              <input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                style={inp}
              />
            </label>
            <label style={{ fontSize: 12, color: mutedColor }}>
              Capability area
              <select
                value={formAreaId}
                onChange={(e) => setFormAreaId(e.target.value)}
                style={inp}
              >
                <option value="">—</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {(a.code ? `${a.code} · ` : "") + a.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 12, color: mutedColor }}>
              Description
              <textarea
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                rows={3}
                style={{ ...inp, resize: "vertical" as const }}
              />
            </label>
            <label style={{ fontSize: 12, color: mutedColor }}>
              Lifecycle
              <select
                value={formLife}
                onChange={(e) =>
                  setFormLife(e.target.value as ReferenceLifecycleStatus)
                }
                style={inp}
              >
                {LIFE.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                style={btnPrimary}
                disabled={saving}
                onClick={() => void save()}
              >
                Save
              </button>
              <button type="button" style={btn} onClick={() => setModal(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
