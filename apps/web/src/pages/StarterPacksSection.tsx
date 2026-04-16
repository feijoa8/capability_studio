import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  adoptReferenceStarterPackToOrganisation,
  getReferenceStarterPackDetail,
  isReferenceStarterPackCompetencyItem,
  isReferenceStarterPackSubjectItem,
  listReferenceStarterPacks,
  type ReferenceStarterPackItemRow,
  type ReferenceStarterPackRow,
  type ReferenceSubjectRow,
} from "../lib/referenceLibrary";
import { buildPackSubjectGroups } from "./referenceLibrary/referencePackPreview";
import type { CapabilityAreaRow } from "./hub/types";
import { canAccessWorkspaceManagementNav } from "./hub/workspaceRoles";
import {
  bg,
  border,
  borderSubtle,
  btn,
  btnPrimary,
  errorColor,
  mutedColor,
  panelShell,
  surface,
  text,
} from "./hub/hubTheme";

type Props = {
  activeOrgId: string | null;
  isActive: boolean;
  workspaceRole: string | null;
};

function countPackSubjects(items: ReferenceStarterPackItemRow[]): number {
  return items.filter(isReferenceStarterPackSubjectItem).length;
}

function countPackCompetencies(items: ReferenceStarterPackItemRow[]): number {
  return items.filter(isReferenceStarterPackCompetencyItem).length;
}

function unwrapSubject(
  s: ReferenceStarterPackItemRow["reference_subjects"],
): ReferenceSubjectRow | null {
  if (!s) return null;
  return Array.isArray(s) ? s[0] ?? null : s;
}

function unwrapCompetency(
  c: ReferenceStarterPackItemRow["reference_competencies"],
): NonNullable<ReferenceStarterPackItemRow["reference_competencies"]> | null {
  if (!c) return null;
  return Array.isArray(c) ? c[0] ?? null : c;
}

export function StarterPacksSection({
  activeOrgId,
  isActive,
  workspaceRole,
}: Props) {
  const [packs, setPacks] = useState<ReferenceStarterPackRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capabilityAreas, setCapabilityAreas] = useState<CapabilityAreaRow[]>(
    [],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    pack: ReferenceStarterPackRow;
    items: ReferenceStarterPackItemRow[];
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [adoptSummary, setAdoptSummary] = useState<string | null>(null);
  const [packContentsView, setPackContentsView] = useState<"grouped" | "flat">(
    "grouped",
  );
  const [packCounts, setPackCounts] = useState<
    Record<string, { subjects: number; competencies: number }>
  >({});

  const canAdopt = canAccessWorkspaceManagementNav(workspaceRole);

  useEffect(() => {
    if (!isActive || !activeOrgId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [pList, capRes] = await Promise.all([
          listReferenceStarterPacks(supabase, { publishedOnly: true }),
          supabase
            .from("capability_areas")
            .select("id, organisation_id, name, description")
            .eq("organisation_id", activeOrgId)
            .order("name"),
        ]);
        if (cancelled) return;
        setPacks(pList);
        if (capRes.error) throw new Error(capRes.error.message);
        setCapabilityAreas((capRes.data as CapabilityAreaRow[]) ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load starter packs.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isActive, activeOrgId]);

  useEffect(() => {
    if (!isActive || packs.length === 0) {
      setPackCounts({});
      return;
    }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        packs.map(async (p) => {
          try {
            const { items } = await getReferenceStarterPackDetail(supabase, p.id);
            return [
              p.id,
              {
                subjects: countPackSubjects(items),
                competencies: countPackCompetencies(items),
              },
            ] as const;
          } catch {
            return [p.id, { subjects: 0, competencies: 0 }] as const;
          }
        }),
      );
      if (!cancelled) {
        setPackCounts(Object.fromEntries(entries));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isActive, packs]);

  useEffect(() => {
    if (!selectedId || !isActive) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setDetailLoading(true);
      try {
        const d = await getReferenceStarterPackDetail(supabase, selectedId);
        if (!cancelled) setDetail(d);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load pack detail.");
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, isActive]);

  async function handleAdopt() {
    if (!activeOrgId || !selectedId || !detail) return;
    setAdopting(true);
    setAdoptSummary(null);
    setError(null);
    try {
      const res = await adoptReferenceStarterPackToOrganisation(
        supabase,
        selectedId,
        activeOrgId,
        capabilityAreas,
      );
      const lines: string[] = [];
      if (res.unassignedCapabilityAreaWarning) {
        lines.push(res.unassignedCapabilityAreaWarning);
      }
      if (res.subjectCapabilityAreaMappingNote) {
        lines.push(res.subjectCapabilityAreaMappingNote);
      }
      if (res.practiceLinkingNote) {
        lines.push(res.practiceLinkingNote);
      }
      lines.push(
        `Subjects added: ${res.subjectsAdded}, skipped (already in org): ${res.subjectsSkipped}.`,
        `Competencies added: ${res.competenciesAdded}, unchanged (already matched): ${res.competenciesSkipped}.`,
      );
      if (res.competenciesReused > 0) {
        lines.push(
          `Competencies reused or relinked (existing org rows): ${res.competenciesReused}.`,
        );
      }
      if (res.competenciesReactivated > 0) {
        lines.push(
          `Competencies reactivated from archived/inactive: ${res.competenciesReactivated}.`,
        );
      }
      const skippedTotal = res.subjectsSkipped + res.competenciesSkipped;
      lines.push(`Total skipped / no-change (subjects + competencies): ${skippedTotal}.`);
      if (res.subjectsUnassignedCount > 0) {
        lines.push(
          `${res.subjectsUnassignedCount} subject(s) fell back to Unassigned (no matching org Capability Area).`,
        );
        if (res.subjectsUnassignedNames.length > 0) {
          lines.push(`Unassigned subjects: ${res.subjectsUnassignedNames.join(", ")}.`);
        }
      }
      if (res.errors.length) {
        lines.push(...res.errors.slice(0, 8));
      }
      setAdoptSummary(lines.join("\n"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Adopt failed.");
    } finally {
      setAdopting(false);
    }
  }

  if (!activeOrgId) {
    return (
      <div style={panelShell}>
        <p style={{ margin: 0, color: mutedColor }}>Select a workspace.</p>
      </div>
    );
  }

  return (
    <div style={{ ...panelShell, maxWidth: 960 }}>
      <h2 style={{ margin: "0 0 8px", fontSize: 20, color: text }}>
        Taxonomy · Starter packs
      </h2>
      <p style={{ margin: "0 0 16px", fontSize: 14, color: mutedColor, lineHeight: 1.5 }}>
        Browse published shared starter packs and adopt them into your organisation’s
        competency_subjects and competencies. Adoption preserves reference traceability
        and skips items you already have.
      </p>

      {error ? (
        <p style={{ color: errorColor, marginBottom: 12 }}>{error}</p>
      ) : null}
      {adoptSummary ? (
        <pre
          style={{
            whiteSpace: "pre-wrap",
            fontSize: 13,
            padding: 12,
            borderRadius: 8,
            border: `1px solid ${borderSubtle}`,
            backgroundColor: bg,
            color: text,
            marginBottom: 16,
          }}
        >
          {adoptSummary}
        </pre>
      ) : null}

      {loading ? (
        <p style={{ color: mutedColor }}>Loading packs…</p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 12,
            marginBottom: 20,
          }}
        >
          {packs.map((p) => {
            const fw = p.reference_frameworks as { name?: string } | null;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setSelectedId(p.id);
                  setAdoptSummary(null);
                  setPackContentsView("grouped");
                }}
                style={{
                  textAlign: "left",
                  padding: 14,
                  borderRadius: 10,
                  border: `1px solid ${
                    selectedId === p.id ? text : border
                  }`,
                  backgroundColor: selectedId === p.id ? bg : surface,
                  cursor: "pointer",
                  color: text,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 6 }}>{p.name}</div>
                <div style={{ fontSize: 12, color: mutedColor, marginBottom: 8 }}>
                  {fw?.name ?? "Framework"}
                </div>
                <div style={{ fontSize: 13, color: mutedColor, lineHeight: 1.4 }}>
                  {p.description?.trim() || "—"}
                </div>
                <div
                  style={{
                    marginTop: 10,
                    fontSize: 12,
                    color: mutedColor,
                  }}
                >
                  Code: {p.code}
                  {packCounts[p.id] ? (
                    <span>
                      {" "}
                      · {packCounts[p.id]!.subjects} reference subjects,{" "}
                      {packCounts[p.id]!.competencies} reference competencies
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selectedId && detailLoading ? (
        <p style={{ color: mutedColor }}>Loading pack contents…</p>
      ) : null}

      {detail ? (
        <div
          style={{
            border: `1px solid ${border}`,
            borderRadius: 10,
            padding: 16,
            backgroundColor: surface,
          }}
        >
          <h3 style={{ margin: "0 0 8px", fontSize: 17, color: text }}>
            {detail.pack.name}
          </h3>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: mutedColor }}>
            {(detail.pack.reference_frameworks as { name?: string } | null)?.name ??
              "—"}{" "}
            · Status: {detail.pack.lifecycle_status}
          </p>
          <p style={{ margin: "0 0 12px", fontSize: 14, color: text }}>
            {detail.pack.description?.trim() || "—"}
          </p>
          <p style={{ fontSize: 13, color: mutedColor, marginBottom: 12 }}>
            Includes {countPackSubjects(detail.items)} reference subjects and{" "}
            {countPackCompetencies(detail.items)} reference competencies in this pack.
          </p>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
            <button
              type="button"
              disabled={!canAdopt || adopting}
              onClick={() => void handleAdopt()}
              style={btnPrimary}
            >
              {adopting ? "Adopting…" : "Adopt pack into organisation"}
            </button>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              style={btn}
              disabled={adopting}
            >
              Close detail
            </button>
          </div>
          {!canAdopt ? (
            <p style={{ fontSize: 12, color: mutedColor }}>
              Only organisation admins and learning leads can adopt packs.
            </p>
          ) : null}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 8,
              margin: "16px 0 8px",
            }}
          >
            <h4 style={{ fontSize: 14, color: text, margin: 0 }}>Contents</h4>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                onClick={() => setPackContentsView("grouped")}
                style={{
                  ...btn,
                  fontSize: 12,
                  padding: "4px 10px",
                  border:
                    packContentsView === "grouped"
                      ? `1px solid ${text}`
                      : `1px solid ${border}`,
                }}
              >
                By subject
              </button>
              <button
                type="button"
                onClick={() => setPackContentsView("flat")}
                style={{
                  ...btn,
                  fontSize: 12,
                  padding: "4px 10px",
                  border:
                    packContentsView === "flat"
                      ? `1px solid ${text}`
                      : `1px solid ${border}`,
                }}
              >
                Flat list
              </button>
            </div>
          </div>

          {packContentsView === "grouped" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {buildPackSubjectGroups(detail.items).map((g) => (
                <div
                  key={g.subjectId}
                  style={{
                    border: `1px solid ${borderSubtle}`,
                    borderRadius: 8,
                    padding: 12,
                    backgroundColor: bg,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 600,
                      color: text,
                      fontSize: 14,
                      marginBottom: 4,
                    }}
                  >
                    {g.subject.name}
                  </div>
                  {g.capabilityAreaLabel ? (
                    <div style={{ fontSize: 12, color: mutedColor, marginBottom: 6 }}>
                      Reference capability area: {g.capabilityAreaLabel}
                    </div>
                  ) : null}
                  {g.subject.description?.trim() ? (
                    <p
                      style={{
                        margin: "0 0 10px",
                        fontSize: 13,
                        color: mutedColor,
                        lineHeight: 1.45,
                      }}
                    >
                      {g.subject.description.trim()}
                    </p>
                  ) : null}
                  {g.competencies.length > 0 ? (
                    <ul
                      style={{
                        margin: 0,
                        paddingLeft: 18,
                        color: mutedColor,
                        fontSize: 13,
                      }}
                    >
                      {g.competencies.map((c) => (
                        <li key={c.itemId} style={{ marginBottom: 4 }}>
                          <span style={{ color: text }}>{c.name}</span>
                          {c.description?.trim()
                            ? ` — ${c.description.trim().slice(0, 160)}`
                            : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p style={{ margin: 0, fontSize: 12, color: mutedColor }}>
                      No competencies listed in this pack for this subject.
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, color: mutedColor, fontSize: 13 }}>
              {detail.items.map((it) => {
                const subj = unwrapSubject(it.reference_subjects);
                if (subj) {
                  return (
                    <li key={it.id} style={{ marginBottom: 6 }}>
                      <strong style={{ color: text }}>Subject:</strong> {subj.name}
                      {subj.description ? ` — ${subj.description.slice(0, 120)}` : ""}
                    </li>
                  );
                }
                const comp = unwrapCompetency(it.reference_competencies);
                if (comp) {
                  const ps = comp.reference_subjects;
                  const psub = Array.isArray(ps) ? ps[0] : ps;
                  return (
                    <li key={it.id} style={{ marginBottom: 6 }}>
                      <strong style={{ color: text }}>Competency:</strong> {comp.name}
                      {psub ? (
                        <span>
                          {" "}
                          (reference subject: {psub.name})
                        </span>
                      ) : null}
                      {comp.description ? ` — ${comp.description.slice(0, 100)}` : ""}
                    </li>
                  );
                }
                return null;
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
