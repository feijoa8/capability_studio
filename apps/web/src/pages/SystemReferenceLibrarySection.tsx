import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  countReferenceDashboardStats,
  listReferenceSubjects,
  type ReferenceSubjectRow,
} from "../lib/referenceLibrary";
import {
  bg,
  border,
  borderSubtle,
  btn,
  errorColor,
  mutedColor,
  panelShell,
  text,
} from "./hub/hubTheme";
import { ReferenceCapabilityAreasAdmin } from "./referenceLibrary/ReferenceCapabilityAreasAdmin";
import { ReferenceCompetenciesAdmin } from "./referenceLibrary/ReferenceCompetenciesAdmin";
import { ReferenceFrameworksAdmin } from "./referenceLibrary/ReferenceFrameworksAdmin";
import { ReferenceStarterPacksAdmin } from "./referenceLibrary/ReferenceStarterPacksAdmin";
import { ReferenceSubjectsAdmin } from "./referenceLibrary/ReferenceSubjectsAdmin";

type Tab =
  | "dashboard"
  | "frameworks"
  | "capability_areas"
  | "subjects"
  | "competencies"
  | "starter_packs"
  | "review";

type Props = {
  isActive: boolean;
};

export function SystemReferenceLibrarySection({ isActive }: Props) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Awaited<
    ReturnType<typeof countReferenceDashboardStats>
  > | null>(null);
  const [draftSubjects, setDraftSubjects] = useState<ReferenceSubjectRow[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);

  useEffect(() => {
    if (!isActive || tab !== "dashboard") return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const s = await countReferenceDashboardStats(supabase);
        if (!cancelled) setStats(s);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Failed to load reference library.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isActive, tab]);

  useEffect(() => {
    if (!isActive || tab !== "review") return;
    let cancelled = false;
    (async () => {
      setReviewLoading(true);
      setError(null);
      try {
        const drafts = await listReferenceSubjects(supabase, {
          lifecycle: ["draft"],
        });
        if (!cancelled) setDraftSubjects(drafts);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Failed to load draft subjects.",
          );
        }
      } finally {
        if (!cancelled) setReviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isActive, tab]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "dashboard", label: "Dashboard" },
    { id: "frameworks", label: "Frameworks" },
    { id: "capability_areas", label: "Capability areas" },
    { id: "subjects", label: "Reference subjects" },
    { id: "competencies", label: "Reference competencies" },
    { id: "starter_packs", label: "Starter packs" },
    { id: "review", label: "Review queue" },
  ];

  const adminActive = (t: Tab) => isActive && tab === t;

  return (
    <div style={{ ...panelShell, maxWidth: 1100 }}>
      <h2 style={{ margin: "0 0 8px", fontSize: 20, color: text }}>
        System · Reference library
      </h2>
      <p style={{ margin: "0 0 16px", fontSize: 14, color: mutedColor, lineHeight: 1.5 }}>
        Shared reference layer for frameworks, taxonomy, and starter packs. Editing requires
        an active membership with <code>system_role = system_admin</code> and a sign-in email
        on the <code>@feijoa8.com</code> domain (see <code>is_reference_library_admin()</code>{" "}
        in the database). Use lifecycle deprecate/archive instead of hard deletes.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{
              ...btn,
              fontWeight: tab === t.id ? 600 : 400,
              border: `1px solid ${tab === t.id ? text : border}`,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error ? (
        <p style={{ color: errorColor, marginBottom: 12 }}>{error}</p>
      ) : null}

      {tab === "dashboard" && loading ? (
        <p style={{ color: mutedColor }}>Loading…</p>
      ) : null}

      {!loading && tab === "dashboard" && stats ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 12,
          }}
        >
          {[
            ["Frameworks", stats.frameworks],
            ["Published subjects", stats.publishedSubjects],
            ["Published competencies", stats.publishedCompetencies],
            ["Published starter packs", stats.publishedPacks],
            ["Draft subjects", stats.draftSubjects],
            ["Deprecated subjects", stats.deprecatedSubjects],
          ].map(([label, n]) => (
            <div
              key={String(label)}
              style={{
                padding: 14,
                borderRadius: 10,
                border: `1px solid ${borderSubtle}`,
                backgroundColor: bg,
              }}
            >
              <div style={{ fontSize: 12, color: mutedColor }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: text }}>{n}</div>
            </div>
          ))}
        </div>
      ) : null}

      <ReferenceFrameworksAdmin isActive={adminActive("frameworks")} />
      <ReferenceCapabilityAreasAdmin isActive={adminActive("capability_areas")} />
      <ReferenceSubjectsAdmin isActive={adminActive("subjects")} />
      <ReferenceCompetenciesAdmin isActive={adminActive("competencies")} />
      <ReferenceStarterPacksAdmin isActive={adminActive("starter_packs")} />

      {tab === "review" ? (
        <div>
          <p style={{ fontSize: 13, color: mutedColor, marginBottom: 12 }}>
            Draft reference subjects — transition lifecycle using the Reference subjects
            tab or SQL.
          </p>
          {reviewLoading ? (
            <p style={{ color: mutedColor }}>Loading…</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, color: text, fontSize: 13 }}>
              {draftSubjects.map((s) => (
                <li key={s.id} style={{ marginBottom: 6 }}>
                  {s.name}{" "}
                  <span style={{ color: mutedColor }}>({s.lifecycle_status})</span>
                </li>
              ))}
            </ul>
          )}
          {!reviewLoading && draftSubjects.length === 0 ? (
            <p style={{ color: mutedColor }}>No draft subjects.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
