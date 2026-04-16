import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { supabase } from "../../lib/supabase";
import {
  createReferenceCapabilityArea,
  listReferenceCapabilityAreasAdmin,
  updateReferenceCapabilityArea,
} from "../../lib/referenceLibraryAdmin";
import {
  listReferenceFrameworks,
  type ReferenceCapabilityAreaRow,
  type ReferenceFrameworkRow,
  type ReferenceLifecycleStatus,
} from "../../lib/referenceLibrary";
import {
  bg,
  border,
  btn,
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

export function ReferenceCapabilityAreasAdmin({ isActive }: Props) {
  const [frameworks, setFrameworks] = useState<ReferenceFrameworkRow[]>([]);
  const [fwId, setFwId] = useState("");
  const [rows, setRows] = useState<ReferenceCapabilityAreaRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<
    "create" | { edit: ReferenceCapabilityAreaRow } | null
  >(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [life, setLife] = useState<ReferenceLifecycleStatus>("draft");
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!fwId) {
      setRows([]);
      return;
    }
    const list = await listReferenceCapabilityAreasAdmin(supabase, {
      frameworkId: fwId,
    });
    setRows(list);
  }, [fwId]);

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
        setFwId((prev) => prev || fws[0]?.id || "");
      } catch (e) {
        if (!c) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      c = true;
    };
  }, [isActive]);

  useEffect(() => {
    if (!isActive || !fwId) return;
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
  }, [isActive, fwId, reload]);

  function openCreate() {
    if (!fwId) {
      alert("Select a framework first.");
      return;
    }
    setModal("create");
    setCode("");
    setName("");
    setDescription("");
    setSortOrder(rows.length);
    setLife("draft");
  }

  function openEdit(r: ReferenceCapabilityAreaRow) {
    setModal({ edit: r });
    setCode(r.code ?? "");
    setName(r.name);
    setDescription(r.description ?? "");
    setSortOrder(r.sort_order);
    setLife(r.lifecycle_status);
  }

  async function save() {
    const c = code.trim();
    const n = name.trim();
    if (!c || !n) {
      alert("Code and name are required.");
      return;
    }
    if (!fwId && modal === "create") return;
    setSaving(true);
    setError(null);
    try {
      if (modal === "create") {
        await createReferenceCapabilityArea(supabase, {
          reference_framework_id: fwId,
          code: c,
          name: n,
          description: description.trim() || null,
          sort_order: sortOrder,
          lifecycle_status: life,
        });
      } else if (modal && typeof modal === "object" && "edit" in modal) {
        await updateReferenceCapabilityArea(supabase, modal.edit.id, {
          code: c,
          name: n,
          description: description.trim() || null,
          sort_order: sortOrder,
          lifecycle_status: life,
          reference_framework_id: fwId,
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

  if (!isActive) return null;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <label style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 13, color: mutedColor }}>Framework</span>
        <select
          value={fwId}
          onChange={(e) => setFwId(e.target.value)}
          style={{
            padding: "6px 10px",
            borderRadius: 8,
            border: `1px solid ${border}`,
            backgroundColor: "#0c0f14",
            color: text,
            minWidth: 220,
          }}
        >
          <option value="">—</option>
          {frameworks.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} ({f.code})
            </option>
          ))}
        </select>
      </label>
      <div>
        <button
          type="button"
          style={btnPrimary}
          onClick={openCreate}
          disabled={!fwId}
        >
          New capability area
        </button>
      </div>
      {error ? <p style={{ color: errorColor, margin: 0 }}>{error}</p> : null}
      {!fwId ? (
        <p style={{ color: mutedColor }}>Select a framework to list areas.</p>
      ) : loading ? (
        <p style={{ color: mutedColor }}>Loading…</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
              minWidth: 560,
            }}
          >
            <thead>
              <tr style={{ textAlign: "left", color: mutedColor }}>
                <th style={{ padding: 8 }}>Sort</th>
                <th style={{ padding: 8 }}>Code</th>
                <th style={{ padding: 8 }}>Name</th>
                <th style={{ padding: 8 }}>Lifecycle</th>
                <th style={{ padding: 8 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  style={{ borderTop: `1px solid ${border}`, color: text }}
                >
                  <td style={{ padding: 8, color: mutedColor }}>{r.sort_order}</td>
                  <td style={{ padding: 8, fontWeight: 600 }}>{r.code ?? "—"}</td>
                  <td style={{ padding: 8 }}>{r.name}</td>
                  <td style={{ padding: 8, color: mutedColor }}>
                    {r.lifecycle_status}
                  </td>
                  <td style={{ padding: 8 }}>
                    <button type="button" style={btn} onClick={() => openEdit(r)}>
                      Edit
                    </button>
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
            maxWidth: 480,
          }}
        >
          <p style={{ margin: "0 0 10px", fontWeight: 600, color: text }}>
            {modal === "create" ? "Create capability area" : "Edit capability area"}
          </p>
          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ fontSize: 12, color: mutedColor }}>
              Code
              <input value={code} onChange={(e) => setCode(e.target.value)} style={inp} />
            </label>
            <label style={{ fontSize: 12, color: mutedColor }}>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} style={inp} />
            </label>
            <label style={{ fontSize: 12, color: mutedColor }}>
              Description
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                style={{ ...inp, resize: "vertical" as const }}
              />
            </label>
            <label style={{ fontSize: 12, color: mutedColor }}>
              Sort order
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
                style={inp}
              />
            </label>
            <label style={{ fontSize: 12, color: mutedColor }}>
              Lifecycle
              <select
                value={life}
                onChange={(e) =>
                  setLife(e.target.value as ReferenceLifecycleStatus)
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
