import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  buildPackSubjectGroups,
  type PackSubjectGroup,
} from "./referencePackPreview";
import {
  addCompetencyToStarterPack,
  addSubjectToStarterPack,
  createStarterPack,
  duplicateStarterPack,
  listStarterPacksAdmin,
  listReferenceCompetenciesAdmin,
  listReferenceSubjectsAdmin,
  removeCompetencyFromStarterPack,
  removeSubjectFromStarterPack,
  type StarterPackAdminListRow,
  updateStarterPack,
  updateStarterPackItemSortOrder,
  validatePublishStarterPack,
} from "../../lib/referenceLibraryAdmin";
import {
  getReferenceStarterPackDetail,
  isReferenceStarterPackCompetencyItem,
  isReferenceStarterPackSubjectItem,
  listReferenceFrameworks,
  type ReferenceFrameworkRow,
  type ReferenceLifecycleStatus,
} from "../../lib/referenceLibrary";
import {
  bg,
  border,
  borderSubtle,
  btn,
  btnGhost,
  btnPrimary,
  errorColor,
  mutedColor,
  panelShell,
  surface,
  text,
} from "../hub/hubTheme";
import { referenceAdminInputStyle } from "./referenceAdminFieldStyles";

const inp = referenceAdminInputStyle;

const LIFECYCLE_OPTIONS: ReferenceLifecycleStatus[] = [
  "draft",
  "reviewed",
  "published",
  "deprecated",
  "archived",
];

type Props = {
  isActive: boolean;
};

export function ReferenceStarterPacksAdmin({ isActive }: Props) {
  const [rows, setRows] = useState<StarterPackAdminListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameworks, setFrameworks] = useState<ReferenceFrameworkRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Awaited<
    ReturnType<typeof getReferenceStarterPackDetail>
  > | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [newOpen, setNewOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState<string | null>(null);
  const [dupCode, setDupCode] = useState("");
  const [dupName, setDupName] = useState("");

  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formFw, setFormFw] = useState<string>("");
  const [formLife, setFormLife] =
    useState<ReferenceLifecycleStatus>("draft");

  const [subjectSearch, setSubjectSearch] = useState("");
  const [compSearch, setCompSearch] = useState("");
  const [compSubjectFilter, setCompSubjectFilter] = useState<string>("");
  const [allSubjects, setAllSubjects] = useState<
    Awaited<ReturnType<typeof listReferenceSubjectsAdmin>>
  >([]);
  const [allComps, setAllComps] = useState<
    Awaited<ReturnType<typeof listReferenceCompetenciesAdmin>>
  >([]);

  const reloadList = useCallback(async () => {
    const list = await listStarterPacksAdmin(supabase);
    setRows(list);
  }, []);

  useEffect(() => {
    if (!isActive) return;
    let c = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [fws, subs, comps] = await Promise.all([
          listReferenceFrameworks(supabase, { includeNonPublishedForAdmin: true }),
          listReferenceSubjectsAdmin(supabase, {
            lifecycle: ["draft", "reviewed", "published", "deprecated", "archived"],
          }),
          listReferenceCompetenciesAdmin(supabase, {
            lifecycle: ["draft", "reviewed", "published", "deprecated", "archived"],
          }),
        ]);
        if (c) return;
        setFrameworks(fws);
        setAllSubjects(subs);
        setAllComps(comps);
        await reloadList();
      } catch (e) {
        if (!c) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!c) setLoading(false);
      }
    })();
    return () => {
      c = true;
    };
  }, [isActive, reloadList]);

  const loadDetail = useCallback(async (packId: string) => {
    setDetailLoading(true);
    try {
      const d = await getReferenceStarterPackDetail(supabase, packId);
      setDetail(d);
      setFormCode(d.pack.code);
      setFormName(d.pack.name);
      setFormDesc(d.pack.description ?? "");
      setFormFw(d.pack.reference_framework_id ?? "");
      setFormLife(d.pack.lifecycle_status);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId || !isActive) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId, isActive, loadDetail]);

  const previewGroups: PackSubjectGroup[] = useMemo(() => {
    if (!detail?.items.length) return [];
    return buildPackSubjectGroups(detail.items);
  }, [detail]);

  async function handleSavePack() {
    if (!selectedId) return;
    setSaving(true);
    setError(null);
    try {
      const msg = validatePublishStarterPack(
        {
          code: formCode,
          name: formName,
          reference_framework_id: formFw || null,
          lifecycle_status: formLife,
        },
        detail?.items.length ?? 0,
        { requireItems: formLife === "published" },
      );
      if (msg) {
        alert(msg);
        setSaving(false);
        return;
      }
      await updateStarterPack(supabase, selectedId, {
        code: formCode.trim(),
        name: formName.trim(),
        description: formDesc.trim() || null,
        reference_framework_id: formFw || null,
        lifecycle_status: formLife,
      });
      await reloadList();
      await loadDetail(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleCreatePack() {
    if (!formCode.trim() || !formName.trim()) {
      alert("Code and name are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const p = await createStarterPack(supabase, {
        code: formCode.trim(),
        name: formName.trim(),
        description: formDesc.trim() || null,
        reference_framework_id: formFw || null,
        lifecycle_status: "draft",
      });
      setNewOpen(false);
      setFormCode("");
      setFormName("");
      setFormDesc("");
      setFormFw("");
      await reloadList();
      setSelectedId(p.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDuplicate() {
    if (!dupOpen || !dupCode.trim() || !dupName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const p = await duplicateStarterPack(supabase, dupOpen, dupCode.trim(), dupName.trim());
      setDupOpen(null);
      setDupCode("");
      setDupName("");
      await reloadList();
      setSelectedId(p.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const filteredSubjects = useMemo(() => {
    const q = subjectSearch.trim().toLowerCase();
    if (!q) return allSubjects;
    return allSubjects.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.code ?? "").toLowerCase().includes(q),
    );
  }, [allSubjects, subjectSearch]);

  const filteredComps = useMemo(() => {
    let list = allComps;
    if (compSubjectFilter) {
      list = list.filter((c) => c.reference_subject_id === compSubjectFilter);
    }
    const q = compSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.code ?? "").toLowerCase().includes(q),
    );
  }, [allComps, compSearch, compSubjectFilter]);

  async function onAddSubject(subjectId: string) {
    if (!selectedId) return;
    try {
      await addSubjectToStarterPack(supabase, selectedId, subjectId);
      await loadDetail(selectedId);
      await reloadList();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function onAddCompetency(competencyId: string) {
    if (!selectedId) return;
    try {
      await addCompetencyToStarterPack(supabase, selectedId, competencyId);
      await loadDetail(selectedId);
      await reloadList();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function onRemoveItem(itemId: string) {
    if (!detail) return;
    const it = detail.items.find((i) => i.id === itemId);
    if (!it) return;
    try {
      if (isReferenceStarterPackSubjectItem(it)) {
        await removeSubjectFromStarterPack(supabase, itemId);
      } else {
        await removeCompetencyFromStarterPack(supabase, itemId);
      }
      await loadDetail(selectedId!);
      await reloadList();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function moveItem(itemId: string, dir: -1 | 1) {
    if (!detail) return;
    const idx = detail.items.findIndex((i) => i.id === itemId);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= detail.items.length) return;
    const a = detail.items[idx]!;
    const b = detail.items[swap]!;
    const sa = a.sort_order;
    const sb = b.sort_order;
    try {
      await updateStarterPackItemSortOrder(supabase, a.id, sb);
      await updateStarterPackItemSortOrder(supabase, b.id, sa);
      await loadDetail(selectedId!);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleQuickLifecycle(
    packId: string,
    next: ReferenceLifecycleStatus,
  ) {
    const row = rows.find((r) => r.id === packId);
    if (!row) return;
    if (next === "published") {
      const msg = validatePublishStarterPack(
        {
          code: row.code,
          name: row.name,
          reference_framework_id: row.reference_framework_id ?? null,
          lifecycle_status: next,
        },
        row.subject_count + row.competency_count,
        { requireItems: true },
      );
      if (msg) {
        alert(msg);
        return;
      }
      if (
        !window.confirm(
          "Publish this starter pack? It will appear in the org Starter Packs browse list.",
        )
      ) {
        return;
      }
    } else if (next === "deprecated") {
      if (
        !window.confirm(
          "Mark this pack as deprecated? It can still be adopted until archived.",
        )
      ) {
        return;
      }
    } else if (next === "archived") {
      if (
        !window.confirm(
          "Archive this pack? Prefer deprecating first unless you intend to hide it from normal flows.",
        )
      ) {
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      await updateStarterPack(supabase, packId, { lifecycle_status: next });
      await reloadList();
      if (selectedId === packId) await loadDetail(packId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!isActive) return null;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          style={btnPrimary}
          onClick={() => {
            setNewOpen(true);
            setFormCode("");
            setFormName("");
            setFormDesc("");
            setFormFw("");
          }}
        >
          New starter pack
        </button>
      </div>

      {error ? (
        <p style={{ color: errorColor, margin: 0, fontSize: 13 }}>{error}</p>
      ) : null}

      {newOpen ? (
        <div
          style={{
            ...panelShell,
            padding: 14,
            border: `1px solid ${border}`,
            backgroundColor: bg,
          }}
        >
          <p style={{ margin: "0 0 10px", fontWeight: 600, color: text }}>
            Create starter pack
          </p>
          <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
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
              Framework
              <select
                value={formFw}
                onChange={(e) => setFormFw(e.target.value)}
                style={inp}
              >
                <option value="">—</option>
                {frameworks.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.code})
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 12, color: mutedColor }}>
              Description
              <textarea
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                rows={2}
                style={{ ...inp, resize: "vertical" as const }}
              />
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                style={btnPrimary}
                disabled={saving}
                onClick={() => void handleCreatePack()}
              >
                Create
              </button>
              <button
                type="button"
                style={btn}
                onClick={() => setNewOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p style={{ color: mutedColor }}>Loading packs…</p>
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
                <th style={{ padding: 8 }}>Framework</th>
                <th style={{ padding: 8 }}>Lifecycle</th>
                <th style={{ padding: 8 }}>Subjects</th>
                <th style={{ padding: 8 }}>Competencies</th>
                <th style={{ padding: 8 }}>Updated</th>
                <th style={{ padding: 8 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  style={{
                    borderTop: `1px solid ${borderSubtle}`,
                    backgroundColor:
                      selectedId === r.id ? "rgba(110,176,240,0.06)" : undefined,
                  }}
                >
                  <td style={{ padding: 8, color: text, fontWeight: 600 }}>
                    {r.code}
                  </td>
                  <td style={{ padding: 8, color: text }}>{r.name}</td>
                  <td style={{ padding: 8, color: mutedColor }}>
                    {r.framework_label ?? "—"}
                  </td>
                  <td style={{ padding: 8, color: mutedColor }}>
                    {r.lifecycle_status}
                  </td>
                  <td style={{ padding: 8, color: mutedColor }}>
                    {r.subject_count}
                  </td>
                  <td style={{ padding: 8, color: mutedColor }}>
                    {r.competency_count}
                  </td>
                  <td style={{ padding: 8, color: mutedColor, fontSize: 12 }}>
                    {r.updated_at
                      ? new Date(r.updated_at).toLocaleString()
                      : "—"}
                  </td>
                  <td style={{ padding: 8 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      <button
                        type="button"
                        style={{ ...btnGhost, fontSize: 11, padding: "4px 8px" }}
                        onClick={() => setSelectedId(r.id === selectedId ? null : r.id)}
                      >
                        {selectedId === r.id ? "Close" : "View / edit"}
                      </button>
                      <button
                        type="button"
                        style={{ ...btnGhost, fontSize: 11, padding: "4px 8px" }}
                        onClick={() => {
                          setDupOpen(r.id);
                          setDupCode(`${r.code}_COPY`);
                          setDupName(`Copy of ${r.name}`);
                        }}
                      >
                        Duplicate
                      </button>
                      {r.lifecycle_status !== "published" &&
                      r.lifecycle_status !== "deprecated" &&
                      r.lifecycle_status !== "archived" ? (
                        <button
                          type="button"
                          style={{ ...btnGhost, fontSize: 11, padding: "4px 8px" }}
                          disabled={saving}
                          onClick={() => void handleQuickLifecycle(r.id, "published")}
                        >
                          Publish
                        </button>
                      ) : null}
                      {r.lifecycle_status === "published" ? (
                        <button
                          type="button"
                          style={{ ...btnGhost, fontSize: 11, padding: "4px 8px" }}
                          disabled={saving}
                          onClick={() => void handleQuickLifecycle(r.id, "deprecated")}
                        >
                          Deprecate
                        </button>
                      ) : null}
                      {r.lifecycle_status !== "archived" ? (
                        <button
                          type="button"
                          style={{ ...btnGhost, fontSize: 11, padding: "4px 8px" }}
                          disabled={saving}
                          onClick={() => void handleQuickLifecycle(r.id, "archived")}
                        >
                          Archive
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dupOpen ? (
        <div
          style={{
            padding: 14,
            borderRadius: 10,
            border: `1px solid ${border}`,
            backgroundColor: surface,
          }}
        >
          <p style={{ margin: "0 0 8px", fontWeight: 600, color: text }}>
            Duplicate pack
          </p>
          <div style={{ display: "grid", gap: 8, maxWidth: 400 }}>
            <input
              placeholder="New code"
              value={dupCode}
              onChange={(e) => setDupCode(e.target.value)}
              style={inp}
            />
            <input
              placeholder="New name"
              value={dupName}
              onChange={(e) => setDupName(e.target.value)}
              style={inp}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                style={btnPrimary}
                disabled={saving}
                onClick={() => void handleDuplicate()}
              >
                Create copy
              </button>
              <button type="button" style={btn} onClick={() => setDupOpen(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedId && (
        <div
          style={{
            display: "grid",
            gap: 16,
            padding: 16,
            borderRadius: 10,
            border: `1px solid ${border}`,
            backgroundColor: bg,
          }}
        >
          {detailLoading || !detail ? (
            <p style={{ color: mutedColor }}>Loading editor…</p>
          ) : (
            <>
              <h3 style={{ margin: 0, fontSize: 16, color: text }}>
                Edit · {detail.pack.code}
              </h3>
              <section>
                <p style={{ margin: "0 0 8px", fontSize: 12, color: mutedColor }}>
                  Pack details
                </p>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                    gap: 10,
                  }}
                >
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
                    Framework
                    <select
                      value={formFw}
                      onChange={(e) => setFormFw(e.target.value)}
                      style={inp}
                    >
                      <option value="">—</option>
                      {frameworks.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ fontSize: 12, color: mutedColor }}>
                    Lifecycle
                    <select
                      value={formLife}
                      onChange={(e) => {
                        const v = e.target.value as ReferenceLifecycleStatus;
                        if (
                          v === "published" &&
                          !window.confirm(
                            "Set lifecycle to published? The pack will be visible for org adoption.",
                          )
                        ) {
                          return;
                        }
                        setFormLife(v);
                      }}
                      style={inp}
                    >
                      {LIFECYCLE_OPTIONS.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label
                  style={{
                    fontSize: 12,
                    color: mutedColor,
                    display: "block",
                    marginTop: 10,
                  }}
                >
                  Description
                  <textarea
                    value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value)}
                    rows={3}
                    style={{ ...inp, width: "100%", maxWidth: 560 }}
                  />
                </label>
                <button
                  type="button"
                  style={{ ...btnPrimary, marginTop: 10 }}
                  disabled={saving}
                  onClick={() => void handleSavePack()}
                >
                  Save pack
                </button>
              </section>

              <section>
                <p style={{ margin: "0 0 8px", fontSize: 12, color: mutedColor }}>
                  Included subjects
                </p>
                <input
                  type="search"
                  placeholder="Search subjects to add…"
                  value={subjectSearch}
                  onChange={(e) => setSubjectSearch(e.target.value)}
                  style={{ ...inp, marginBottom: 8, maxWidth: 360 }}
                />
                <ul
                  style={{
                    margin: "0 0 12px",
                    paddingLeft: 18,
                    fontSize: 12,
                    color: text,
                    maxHeight: 160,
                    overflowY: "auto",
                  }}
                >
                  {detail.items
                    .filter(isReferenceStarterPackSubjectItem)
                    .map((it) => {
                      const rs = it.reference_subjects;
                      const s = Array.isArray(rs) ? rs[0] : rs;
                      return (
                        <li key={it.id} style={{ marginBottom: 6 }}>
                          {s?.name ?? it.reference_subject_id}{" "}
                          <button
                            type="button"
                            style={{ ...btnGhost, fontSize: 10, marginLeft: 6 }}
                            onClick={() => void onRemoveItem(it.id)}
                          >
                            Remove
                          </button>
                          <button
                            type="button"
                            style={{ ...btnGhost, fontSize: 10, marginLeft: 4 }}
                            onClick={() => void moveItem(it.id, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            style={{ ...btnGhost, fontSize: 10 }}
                            onClick={() => void moveItem(it.id, 1)}
                          >
                            ↓
                          </button>
                        </li>
                      );
                    })}
                </ul>
                <p style={{ fontSize: 11, color: mutedColor, margin: "0 0 6px" }}>
                  Add subject
                </p>
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value;
                    e.target.selectedIndex = 0;
                    if (v) void onAddSubject(v);
                  }}
                  style={inp}
                >
                  <option value="">Select subject…</option>
                  {filteredSubjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {(s.code ? `${s.code} · ` : "") + s.name}
                    </option>
                  ))}
                </select>
              </section>

              <section>
                <p style={{ margin: "0 0 8px", fontSize: 12, color: mutedColor }}>
                  Included competencies
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                  <input
                    type="search"
                    placeholder="Search…"
                    value={compSearch}
                    onChange={(e) => setCompSearch(e.target.value)}
                    style={inp}
                  />
                  <select
                    value={compSubjectFilter}
                    onChange={(e) => setCompSubjectFilter(e.target.value)}
                    style={inp}
                  >
                    <option value="">All subjects</option>
                    {allSubjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <ul
                  style={{
                    margin: "0 0 12px",
                    paddingLeft: 18,
                    fontSize: 12,
                    maxHeight: 200,
                    overflowY: "auto",
                  }}
                >
                  {detail.items
                    .filter(isReferenceStarterPackCompetencyItem)
                    .map((it) => {
                      const rc = it.reference_competencies;
                      const c = Array.isArray(rc) ? rc[0] : rc;
                      return (
                        <li key={it.id} style={{ marginBottom: 6, color: text }}>
                          {c?.name ?? it.reference_competency_id}{" "}
                          <button
                            type="button"
                            style={{ ...btnGhost, fontSize: 10, marginLeft: 6 }}
                            onClick={() => void onRemoveItem(it.id)}
                          >
                            Remove
                          </button>
                          <button
                            type="button"
                            style={{ ...btnGhost, fontSize: 10, marginLeft: 4 }}
                            onClick={() => void moveItem(it.id, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            style={{ ...btnGhost, fontSize: 10 }}
                            onClick={() => void moveItem(it.id, 1)}
                          >
                            ↓
                          </button>
                        </li>
                      );
                    })}
                </ul>
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value;
                    e.target.selectedIndex = 0;
                    if (v) void onAddCompetency(v);
                  }}
                  style={inp}
                >
                  <option value="">Add competency…</option>
                  {filteredComps.map((c) => (
                    <option key={c.id} value={c.id}>
                      {(c.code ? `${c.code} · ` : "") + c.name}
                    </option>
                  ))}
                </select>
              </section>

              <section>
                <p style={{ margin: "0 0 8px", fontSize: 12, color: mutedColor }}>
                  Preview (grouped)
                </p>
                <div
                  style={{
                    padding: 12,
                    borderRadius: 8,
                    border: `1px solid ${borderSubtle}`,
                    fontSize: 12,
                    color: text,
                  }}
                >
                  {previewGroups.length === 0 ? (
                    <span style={{ color: mutedColor }}>No items yet.</span>
                  ) : (
                    previewGroups.map((g) => (
                      <div key={g.subjectId} style={{ marginBottom: 12 }}>
                        <div style={{ fontWeight: 600 }}>{g.subject.name}</div>
                        <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                          {g.competencies.map((c) => (
                            <li key={c.itemId}>{c.name}</li>
                          ))}
                        </ul>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}
