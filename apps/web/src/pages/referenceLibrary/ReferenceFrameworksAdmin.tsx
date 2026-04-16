import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { supabase } from "../../lib/supabase";
import {
  createReferenceFramework,
  updateReferenceFramework,
} from "../../lib/referenceLibraryAdmin";
import {
  listReferenceFrameworks,
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

export function ReferenceFrameworksAdmin({ isActive }: Props) {
  const [rows, setRows] = useState<ReferenceFrameworkRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<"create" | { edit: ReferenceFrameworkRow } | null>(
    null,
  );
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [life, setLife] = useState<ReferenceLifecycleStatus>("draft");
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    const list = await listReferenceFrameworks(supabase, {
      includeNonPublishedForAdmin: true,
    });
    setRows(list);
  }, []);

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

  function openCreate() {
    setModal("create");
    setCode("");
    setName("");
    setDescription("");
    setLife("draft");
  }

  function openEdit(r: ReferenceFrameworkRow) {
    setModal({ edit: r });
    setCode(r.code);
    setName(r.name);
    setDescription(r.description ?? "");
    setLife(r.lifecycle_status);
  }

  async function save() {
    const c = code.trim();
    const n = name.trim();
    if (!c || !n) {
      alert("Code and name are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (modal === "create") {
        await createReferenceFramework(supabase, {
          code: c,
          name: n,
          description: description.trim() || null,
          lifecycle_status: life,
        });
      } else if (modal && typeof modal === "object" && "edit" in modal) {
        await updateReferenceFramework(supabase, modal.edit.id, {
          code: c,
          name: n,
          description: description.trim() || null,
          lifecycle_status: life,
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
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="button" style={btnPrimary} onClick={openCreate}>
          New framework
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
              minWidth: 520,
            }}
          >
            <thead>
              <tr style={{ textAlign: "left", color: mutedColor }}>
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
                  <td style={{ padding: 8, fontWeight: 600 }}>{r.code}</td>
                  <td style={{ padding: 8 }}>{r.name}</td>
                  <td style={{ padding: 8, color: mutedColor }}>
                    {r.lifecycle_status}
                  </td>
                  <td style={{ padding: 8 }}>
                    <button
                      type="button"
                      style={btn}
                      onClick={() => openEdit(r)}
                    >
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
            {modal === "create" ? "Create framework" : "Edit framework"}
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
                rows={3}
                style={{ ...inp, resize: "vertical" as const }}
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
