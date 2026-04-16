import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { supabase } from "../../lib/supabase";
import {
  countCompetencyStarterPackItemsByCompetencyIds,
  createReferenceCompetency,
  listReferenceCompetenciesAdmin,
  listReferenceSubjectsAdmin,
  updateReferenceCompetency,
} from "../../lib/referenceLibraryAdmin";
import { listReferenceFrameworks } from "../../lib/referenceLibrary";
import type {
  ReferenceCompetencyRow,
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

export function ReferenceCompetenciesAdmin({ isActive }: Props) {
  const [frameworkId, setFrameworkId] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [frameworks, setFrameworks] = useState<
    Awaited<ReturnType<typeof listReferenceFrameworks>>
  >([]);
  const [subjects, setSubjects] = useState<
    (ReferenceSubjectRow & {
      reference_capability_areas?: { name?: string } | null;
    })[]
  >([]);
  const [competencies, setCompetencies] = useState<
    (ReferenceCompetencyRow & {
      reference_subjects?: ReferenceSubjectRow | null;
    })[]
  >([]);
  const [packItemCounts, setPackItemCounts] = useState<Record<string, number>>(
    {},
  );
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<
    "create" | { edit: ReferenceCompetencyRow } | null
  >(null);
  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formCanonical, setFormCanonical] = useState("");
  const [formSubjectId, setFormSubjectId] = useState("");
  const [formLife, setFormLife] = useState<ReferenceLifecycleStatus>("draft");
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    const comps = await listReferenceCompetenciesAdmin(supabase, {
      frameworkId: frameworkId || undefined,
      referenceSubjectId: subjectFilter || undefined,
      lifecycle: ["draft", "reviewed", "published", "deprecated", "archived"],
    });
    setCompetencies(comps);
    const ids = comps.map((c) => c.id);
    const pc = await countCompetencyStarterPackItemsByCompetencyIds(
      supabase,
      ids,
    );
    setPackItemCounts(pc);
  }, [frameworkId, subjectFilter]);

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
        const subs = await listReferenceSubjectsAdmin(supabase, {
          frameworkId: frameworkId || undefined,
          lifecycle: ["draft", "reviewed", "published", "deprecated", "archived"],
        });
        if (c) return;
        setSubjects(subs);
        setFormSubjectId((prev) => {
          if (prev && subs.some((s) => s.id === prev)) return prev;
          return subs[0]?.id ?? "";
        });
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
    if (!q) return competencies;
    return competencies.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.code ?? "").toLowerCase().includes(q) ||
        (c.canonical_name ?? "").toLowerCase().includes(q),
    );
  }, [competencies, search]);

  function openCreate() {
    setModal("create");
    setFormCode("");
    setFormName("");
    setFormDesc("");
    setFormCanonical("");
    setFormSubjectId(subjectFilter || subjects[0]?.id || "");
    setFormLife("draft");
  }

  function openEdit(c: ReferenceCompetencyRow) {
    setModal({ edit: c });
    setFormCode(c.code ?? "");
    setFormName(c.name);
    setFormDesc(c.description ?? "");
    setFormCanonical(c.canonical_name ?? "");
    setFormSubjectId(c.reference_subject_id);
    setFormLife(c.lifecycle_status);
  }

  function duplicateCodeInSubject(
    code: string,
    subjectId: string,
    excludeId?: string,
  ) {
    const c = code.trim().toLowerCase();
    if (!c) return false;
    return competencies.some(
      (x) =>
        x.reference_subject_id === subjectId &&
        (x.code ?? "").trim().toLowerCase() === c &&
        x.id !== excludeId,
    );
  }

  async function save() {
    const code = formCode.trim();
    const name = formName.trim();
    if (!code || !name || !formSubjectId) {
      alert("Code, name, and reference subject are required.");
      return;
    }
    const exId =
      modal && typeof modal === "object" && "edit" in modal
        ? modal.edit.id
        : undefined;
    if (duplicateCodeInSubject(code, formSubjectId, exId)) {
      alert(
        "Another competency on this subject already uses that code (per loaded list).",
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (modal === "create") {
        await createReferenceCompetency(supabase, {
          code,
          reference_subject_id: formSubjectId,
          name,
          description: formDesc.trim() || null,
          canonical_name: formCanonical.trim() || null,
          lifecycle_status: formLife,
        });
      } else if (modal && "edit" in modal) {
        await updateReferenceCompetency(supabase, modal.edit.id, {
          code,
          reference_subject_id: formSubjectId,
          name,
          description: formDesc.trim() || null,
          canonical_name: formCanonical.trim() || null,
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
    row: ReferenceCompetencyRow,
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
      await updateReferenceCompetency(supabase, row.id, {
        lifecycle_status: next,
      });
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
            onChange={(e) => {
              setFrameworkId(e.target.value);
              setSubjectFilter("");
            }}
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
        <label style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: mutedColor }}>Subject filter</span>
          <select
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: `1px solid ${border}`,
              backgroundColor: "#0c0f14",
              color: text,
              minWidth: 220,
            }}
          >
            <option value="">All subjects</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {(s.code ? `${s.code} · ` : "") + s.name}
              </option>
            ))}
          </select>
        </label>
        <input
          type="search"
          placeholder="Search code, name, canonical…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inp, maxWidth: 280, marginTop: 0 }}
        />
        <button type="button" style={btnPrimary} onClick={openCreate}>
          New competency
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
              minWidth: 800,
            }}
          >
            <thead>
              <tr style={{ textAlign: "left", color: mutedColor }}>
                <th style={{ padding: 8 }}>Code</th>
                <th style={{ padding: 8 }}>Name</th>
                <th style={{ padding: 8 }}>Canonical</th>
                <th style={{ padding: 8 }}>Subject</th>
                <th style={{ padding: 8 }}>Lifecycle</th>
                <th style={{ padding: 8 }}>Pack items</th>
                <th style={{ padding: 8 }} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  style={{ borderTop: `1px solid ${border}`, color: text }}
                >
                  <td style={{ padding: 8, fontWeight: 600 }}>{c.code ?? "—"}</td>
                  <td style={{ padding: 8 }}>{c.name}</td>
                  <td style={{ padding: 8, color: mutedColor }}>
                    {c.canonical_name ?? "—"}
                  </td>
                  <td style={{ padding: 8, color: mutedColor }}>
                    {c.reference_subjects?.name ?? "—"}
                  </td>
                  <td style={{ padding: 8, color: mutedColor }}>
                    {c.lifecycle_status}
                  </td>
                  <td style={{ padding: 8, color: mutedColor }}>
                    {packItemCounts[c.id] ?? 0}
                  </td>
                  <td style={{ padding: 8 }}>
                    <button
                      type="button"
                      style={{ ...btnGhost, fontSize: 11, padding: "4px 8px" }}
                      onClick={() => openEdit(c)}
                    >
                      Edit
                    </button>
                    {c.lifecycle_status !== "deprecated" &&
                    c.lifecycle_status !== "archived" ? (
                      <button
                        type="button"
                        style={{ ...btnGhost, fontSize: 11, padding: "4px 8px" }}
                        disabled={saving}
                        onClick={() => void setLifecycleQuick(c, "deprecated")}
                      >
                        Deprecate
                      </button>
                    ) : null}
                    {c.lifecycle_status !== "archived" ? (
                      <button
                        type="button"
                        style={{ ...btnGhost, fontSize: 11, padding: "4px 8px" }}
                        disabled={saving}
                        onClick={() => void setLifecycleQuick(c, "archived")}
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
            {modal === "create"
              ? "Create reference competency"
              : "Edit reference competency"}
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
              Canonical name
              <input
                value={formCanonical}
                onChange={(e) => setFormCanonical(e.target.value)}
                style={inp}
              />
            </label>
            <label style={{ fontSize: 12, color: mutedColor }}>
              Reference subject
              <select
                value={formSubjectId}
                onChange={(e) => setFormSubjectId(e.target.value)}
                style={inp}
              >
                <option value="">—</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {(s.code ? `${s.code} · ` : "") + s.name}
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
