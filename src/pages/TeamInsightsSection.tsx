import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "../lib/supabase";
import { fetchMyTeamMemberIds } from "./hub/reportingLines";
import { levelNameToNumericScore } from "./hub/competencyComparison";
import { certificationRenewalStatus } from "./hub/certificationStatus";
import type {
  ProfileRow,
  UserCertificationRow,
  UserExperienceRow,
  UserQualificationRow,
} from "./hub/types";
import {
  border,
  borderSubtle,
  btnGhost,
  muted,
  mutedColor,
  panelShell,
  sectionEyebrow,
  text,
} from "./hub/hubTheme";

type Props = {
  activeOrgId: string | null;
  isActive: boolean;
};

type MainTab = "capability" | "experience";
type CapabilityView = "individual" | "team_average";

type MemberCol = { userId: string; displayName: string };

type CompetencyRow = { id: string; name: string };

function displayNameFromProfile(p: {
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
}): string {
  const dn = p.display_name?.trim();
  if (dn) return dn;
  const fn = (p.first_name ?? "").trim();
  const ln = (p.last_name ?? "").trim();
  const combined = [fn, ln].filter(Boolean).join(" ");
  if (combined) return combined;
  return p.email?.trim() || "Team member";
}

function parseYmd(s: string | null | undefined): Date | null {
  if (!s?.trim()) return null;
  const d = new Date(`${s.trim()}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Months of tenure for one experience row (overlap not merged across rows). */
function monthsForExperienceRow(
  start: string | null | undefined,
  end: string | null | undefined,
  isCurrent: boolean | undefined
): number {
  const s = parseYmd(start ?? null);
  if (!s) return 0;
  let e = parseYmd(end ?? null);
  if (isCurrent || !e) e = new Date();
  const months =
    (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  return Math.max(0, months);
}

function yearsLabel(months: number): string {
  if (months <= 0) return "0";
  const y = months / 12;
  return y >= 10 ? y.toFixed(0) : y.toFixed(1);
}

function normalizeAreaKey(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

function heatmapCellStyle(score: number | null): CSSProperties {
  if (score == null) {
    return {
      backgroundColor: "rgba(26, 32, 41, 0.85)",
      color: mutedColor,
    };
  }
  const t = (score - 1) / 3;
  const alpha = 0.1 + t * 0.38;
  return {
    backgroundColor: `rgba(110, 176, 240, ${alpha})`,
    color: text,
    fontWeight: 600,
  };
}

export function TeamInsightsSection({ activeOrgId, isActive }: Props) {
  const [mainTab, setMainTab] = useState<MainTab>("capability");
  const [capView, setCapView] = useState<CapabilityView>("individual");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [members, setMembers] = useState<MemberCol[]>([]);
  const [competencies, setCompetencies] = useState<CompetencyRow[]>([]);
  const [matrix, setMatrix] = useState<
    Record<string, Record<string, number | null>>
  >({});

  const [experienceRows, setExperienceRows] = useState<UserExperienceRow[]>(
    []
  );
  const [qualificationRows, setQualificationRows] = useState<
    UserQualificationRow[]
  >([]);
  const [certificationRows, setCertificationRows] = useState<
    UserCertificationRow[]
  >([]);

  useEffect(() => {
    if (!activeOrgId || !isActive) return;

    let cancelled = false;

    void Promise.resolve().then(async () => {
      if (cancelled) return;
      setLoading(true);
      setLoadError(null);

      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) {
        if (!cancelled) {
          setLoadError("Not signed in.");
          setLoading(false);
        }
        return;
      }

      const teamIds = await fetchMyTeamMemberIds(supabase, activeOrgId, uid);
      if (teamIds.length === 0) {
        if (!cancelled) {
          setMembers([]);
          setCompetencies([]);
          setMatrix({});
          setExperienceRows([]);
          setQualificationRows([]);
          setCertificationRows([]);
          setLoading(false);
        }
        return;
      }

      const [profilesRes, compsRes, oucRes, expRes, qualRes, certRes] =
        await Promise.all([
          supabase
            .from("profiles")
            .select("id, display_name, first_name, last_name, email")
            .in("id", teamIds),
          supabase
            .from("competencies")
            .select("id, name")
            .eq("organisation_id", activeOrgId)
            .in("status", ["active", "deprecated"])
            .order("name"),
          supabase
            .from("org_user_competencies")
            .select("user_id, competency_id, current_level")
            .eq("organisation_id", activeOrgId)
            .in("user_id", teamIds),
          supabase
            .from("user_experience")
            .select(
              "id, user_id, role_title, organisation_name, description, start_date, end_date, is_current, industry, skills"
            )
            .in("user_id", teamIds),
          supabase
            .from("user_qualifications")
            .select(
              "id, organisation_id, user_id, title, issuer, qualification_type, date_achieved, notes, credential_url, created_at, updated_at"
            )
            .eq("organisation_id", activeOrgId)
            .in("user_id", teamIds),
          supabase
            .from("user_certifications")
            .select(
              "id, organisation_id, user_id, title, issuer, issue_date, expiry_date, renewal_required, notes, credential_url, created_at, updated_at"
            )
            .eq("organisation_id", activeOrgId)
            .in("user_id", teamIds),
        ]);

      if (cancelled) return;

      if (profilesRes.error) {
        console.warn("profiles:", profilesRes.error.message);
      }
      const profileMap = new Map<string, ProfileRow>();
      for (const p of profilesRes.data ?? []) {
        const row = p as ProfileRow;
        profileMap.set(String(row.id), row);
      }
      const memberCols: MemberCol[] = teamIds.map((id) => ({
        userId: id,
        displayName: displayNameFromProfile(
          profileMap.get(id) ?? { email: id.slice(0, 8) }
        ),
      }));

      if (compsRes.error) {
        setLoadError(compsRes.error.message);
        setLoading(false);
        return;
      }

      const compRows: CompetencyRow[] = (compsRes.data ?? []).map((c) => ({
        id: String((c as { id: string }).id),
        name: String((c as { name: string }).name ?? ""),
      }));

      const nextMatrix: Record<string, Record<string, number | null>> = {};
      for (const c of compRows) {
        nextMatrix[c.id] = {};
        for (const m of memberCols) {
          nextMatrix[c.id][m.userId] = null;
        }
      }

      if (oucRes.error) {
        console.warn("org_user_competencies:", oucRes.error.message);
      } else {
        for (const raw of oucRes.data ?? []) {
          const r = raw as {
            user_id: string;
            competency_id: string;
            current_level: string | null;
          };
          const cid = String(r.competency_id);
          const uidRow = String(r.user_id);
          if (!nextMatrix[cid]) continue;
          nextMatrix[cid][uidRow] = levelNameToNumericScore(r.current_level);
        }
      }

      setMembers(memberCols);
      setCompetencies(compRows);
      setMatrix(nextMatrix);

      if (expRes.error) {
        console.warn("user_experience:", expRes.error.message);
        setExperienceRows([]);
      } else {
        setExperienceRows((expRes.data ?? []) as UserExperienceRow[]);
      }

      if (qualRes.error) {
        console.warn("user_qualifications:", qualRes.error.message);
        setQualificationRows([]);
      } else {
        setQualificationRows((qualRes.data ?? []) as UserQualificationRow[]);
      }

      if (certRes.error) {
        console.warn("user_certifications:", certRes.error.message);
        setCertificationRows([]);
      } else {
        setCertificationRows((certRes.data ?? []) as UserCertificationRow[]);
      }

      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [activeOrgId, isActive]);

  const competencyAverages = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const c of competencies) {
      const row = matrix[c.id];
      if (!row) {
        out[c.id] = null;
        continue;
      }
      const vals: number[] = [];
      for (const m of members) {
        const v = row[m.userId];
        if (v != null) vals.push(v);
      }
      if (vals.length === 0) out[c.id] = null;
      else
        out[c.id] = vals.reduce((a, b) => a + b, 0) / vals.length;
    }
    return out;
  }, [competencies, matrix, members]);

  const strengthsAndGaps = useMemo(() => {
    const scored = competencies
      .map((c) => ({
        id: c.id,
        name: c.name,
        avg: competencyAverages[c.id],
      }))
      .filter((x) => x.avg != null) as {
      id: string;
      name: string;
      avg: number;
    }[];
    const sorted = [...scored].sort((a, b) => b.avg - a.avg);
    const strengths = sorted.slice(0, 3);
    const gaps = [...scored].sort((a, b) => a.avg - b.avg).slice(0, 3);
    return { strengths, gaps };
  }, [competencies, competencyAverages]);

  const experienceStats = useMemo(() => {
    const n = members.length;
    if (n === 0)
      return {
        teamSize: 0,
        totalMonths: 0,
        avgYearsPerPerson: 0,
      };
    const perUserMonths = new Map<string, number>();
    for (const m of members) perUserMonths.set(m.userId, 0);
    for (const e of experienceRows) {
      const uid = e.user_id;
      if (!perUserMonths.has(uid)) continue;
      const mo = monthsForExperienceRow(
        e.start_date,
        e.end_date,
        e.is_current
      );
      perUserMonths.set(uid, (perUserMonths.get(uid) ?? 0) + mo);
    }
    let totalMonths = 0;
    for (const v of perUserMonths.values()) totalMonths += v;
    const avgMonths = totalMonths / n;
    return {
      teamSize: n,
      totalMonths,
      avgYearsPerPerson: avgMonths / 12,
    };
  }, [members, experienceRows]);

  /** Roles and skills from experience rows only (industries are summarized separately). */
  const topExperienceAreas = useMemo(() => {
    const areaCount = new Map<string, number>();
    const displayLabel = new Map<string, string>();

    const addCount = (raw: string) => {
      const t = raw.trim();
      if (!t) return;
      const k = normalizeAreaKey(t);
      areaCount.set(k, (areaCount.get(k) ?? 0) + 1);
      if (!displayLabel.has(k)) displayLabel.set(k, t);
    };

    for (const e of experienceRows) {
      if (e.role_title?.trim()) addCount(e.role_title);
      for (const t of e.skills ?? []) {
        if (typeof t === "string" && t.trim()) addCount(t);
      }
    }

    return [...areaCount.entries()]
      .map(([k, c]) => ({
        label: displayLabel.get(k) ?? k,
        count: c,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }, [experienceRows]);

  const industriesList = useMemo(() => {
    const m = new Map<string, { count: number; label: string }>();
    for (const e of experienceRows) {
      const ind = e.industry?.trim();
      if (!ind) continue;
      const k = normalizeAreaKey(ind);
      const prev = m.get(k);
      if (prev) {
        m.set(k, { count: prev.count + 1, label: prev.label });
      } else {
        m.set(k, { count: 1, label: ind });
      }
    }
    return [...m.values()]
      .sort((a, b) => b.count - a.count)
      .map((x) => ({ label: x.label, count: x.count }));
  }, [experienceRows]);

  const qualificationsAggregated = useMemo(() => {
    const byKey = new Map<string, { label: string; count: number }>();
    for (const q of qualificationRows) {
      const title = q.title?.trim();
      const qtype = q.qualification_type?.trim();
      const key = title
        ? normalizeAreaKey(title)
        : qtype
          ? `type:${normalizeAreaKey(qtype)}`
          : "untitled";
      const label = title || qtype || "Untitled";
      const prev = byKey.get(key);
      if (prev) prev.count += 1;
      else byKey.set(key, { label, count: 1 });
    }
    return [...byKey.values()].sort((a, b) => b.count - a.count);
  }, [qualificationRows]);

  const certBuckets = useMemo(() => {
    const active: UserCertificationRow[] = [];
    const soon: UserCertificationRow[] = [];
    const expired: UserCertificationRow[] = [];
    const noExpiry: UserCertificationRow[] = [];
    for (const q of certificationRows) {
      const b = certificationRenewalStatus(q.expiry_date);
      if (b === "expired") expired.push(q);
      else if (b === "expiring_soon") soon.push(q);
      else if (b === "active") active.push(q);
      else noExpiry.push(q);
    }
    const byTitle = (a: UserCertificationRow, b: UserCertificationRow) =>
      a.title.localeCompare(b.title);
    expired.sort(byTitle);
    soon.sort(byTitle);
    active.sort(byTitle);
    noExpiry.sort(byTitle);
    return { active, soon, expired, noExpiry };
  }, [certificationRows]);

  const showMatrix = members.length > 0 && competencies.length > 0;

  if (!isActive) {
    return null;
  }

  if (!activeOrgId) {
    return (
      <div style={{ ...panelShell, marginTop: 0 }}>
        <p style={{ ...muted, margin: 0 }}>
          Select a workspace to view team insights.
        </p>
      </div>
    );
  }

  return (
    <div style={{ ...panelShell, marginTop: 0 }}>
      <p style={{ margin: "0 0 6px", fontSize: 13, color: mutedColor }}>
        Direct team: competency levels and experience at a glance.
      </p>

      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 20,
          borderBottom: `1px solid ${border}`,
          paddingBottom: 2,
        }}
      >
        {(
          [
            ["capability", "Capability"],
            ["experience", "Experience"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMainTab(id)}
            style={{
              ...btnGhost,
              border: "none",
              borderBottom:
                mainTab === id
                  ? `2px solid rgba(110, 176, 240, 0.85)`
                  : "2px solid transparent",
              marginBottom: -3,
              borderRadius: 0,
              color: mainTab === id ? text : mutedColor,
              fontWeight: mainTab === id ? 600 : 400,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {loadError && (
        <p style={{ color: "#e87878", marginTop: 0, fontSize: 14 }}>
          {loadError}
        </p>
      )}

      {loading ? (
        <p style={{ ...muted, marginTop: 8 }}>Loading…</p>
      ) : members.length === 0 ? (
        <p style={{ ...muted, marginTop: 8, marginBottom: 0 }}>
          You don&apos;t have direct reports in this workspace, or reporting
          lines aren&apos;t set up yet. When your team is assigned, insights
          will appear here.
        </p>
      ) : mainTab === "capability" ? (
        <div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 10,
              marginBottom: 16,
            }}
          >
            <span style={{ fontSize: 12, color: mutedColor }}>View</span>
            <div style={{ display: "flex", gap: 6 }}>
              {(
                [
                  ["individual", "Individual"],
                  ["team_average", "Team average"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setCapView(id)}
                  style={{
                    ...btnGhost,
                    fontSize: 12,
                    backgroundColor:
                      capView === id
                        ? "rgba(110, 176, 240, 0.12)"
                        : "transparent",
                    borderColor:
                      capView === id
                        ? "rgba(110, 176, 240, 0.45)"
                        : borderSubtle,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {strengthsAndGaps.strengths.length > 0 ||
          strengthsAndGaps.gaps.length > 0 ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 16,
                marginBottom: 18,
              }}
            >
              <div>
                <p style={{ ...sectionEyebrow, marginBottom: 8 }}>
                  Top strengths
                </p>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 18,
                    color: mutedColor,
                    fontSize: 14,
                    lineHeight: 1.5,
                  }}
                >
                  {strengthsAndGaps.strengths.map((s) => (
                    <li key={s.id}>
                      {s.name}{" "}
                      <span style={{ color: text }}>
                        (avg {s.avg.toFixed(2)})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p style={{ ...sectionEyebrow, marginBottom: 8 }}>Top gaps</p>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 18,
                    color: mutedColor,
                    fontSize: 14,
                    lineHeight: 1.5,
                  }}
                >
                  {strengthsAndGaps.gaps.map((s) => (
                    <li key={s.id}>
                      {s.name}{" "}
                      <span style={{ color: text }}>
                        (avg {s.avg.toFixed(2)})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          {!showMatrix ? (
            <p style={{ ...muted, marginTop: 0 }}>
              No active competencies are defined for this workspace, or data is
              still loading.
            </p>
          ) : (
            <div style={{ overflowX: "auto", marginTop: 4 }}>
              <table
                style={{
                  borderCollapse: "collapse",
                  fontSize: 12,
                  minWidth: 480,
                }}
              >
                <thead>
                  <tr>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "8px 10px",
                        borderBottom: `1px solid ${border}`,
                        color: mutedColor,
                        fontWeight: 600,
                        position: "sticky",
                        left: 0,
                        background: "#151a22",
                        zIndex: 1,
                        minWidth: 160,
                      }}
                    >
                      Competency
                    </th>
                    {capView === "individual"
                      ? members.map((m) => (
                          <th
                            key={m.userId}
                            style={{
                              textAlign: "center",
                              padding: "8px 6px",
                              borderBottom: `1px solid ${border}`,
                              color: mutedColor,
                              fontWeight: 600,
                              maxWidth: 96,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={m.displayName}
                          >
                            {m.displayName.length > 14
                              ? `${m.displayName.slice(0, 12)}…`
                              : m.displayName}
                          </th>
                        ))
                      : null}
                    <th
                      style={{
                        textAlign: "center",
                        padding: "8px 10px",
                        borderBottom: `1px solid ${border}`,
                        color: text,
                        fontWeight: 600,
                        borderLeft:
                          capView === "individual"
                            ? `1px solid ${border}`
                            : undefined,
                      }}
                    >
                      Team avg
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {competencies.map((c) => (
                    <tr key={c.id}>
                      <td
                        style={{
                          padding: "8px 10px",
                          borderBottom: `1px solid ${borderSubtle}`,
                          color: text,
                          position: "sticky",
                          left: 0,
                          background: "#151a22",
                          maxWidth: 220,
                        }}
                      >
                        {c.name}
                      </td>
                      {capView === "individual"
                        ? members.map((m) => {
                            const sc = matrix[c.id]?.[m.userId] ?? null;
                            return (
                              <td
                                key={m.userId}
                                style={{
                                  padding: "6px 4px",
                                  borderBottom: `1px solid ${borderSubtle}`,
                                  textAlign: "center",
                                  ...heatmapCellStyle(sc),
                                }}
                              >
                                {sc ?? "—"}
                              </td>
                            );
                          })
                        : null}
                      <td
                        style={{
                          padding: "6px 8px",
                          borderBottom: `1px solid ${borderSubtle}`,
                          textAlign: "center",
                          borderLeft:
                            capView === "individual"
                              ? `1px solid ${border}`
                              : undefined,
                          ...heatmapCellStyle(competencyAverages[c.id] ?? null),
                        }}
                      >
                        {competencyAverages[c.id] != null
                          ? competencyAverages[c.id]!.toFixed(2)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p style={{ ...muted, marginTop: 14, fontSize: 12, marginBottom: 0 }}>
            Scores use agreed levels (1 Beginner – 4 Expert). Empty cells mean
            not assessed.
          </p>
        </div>
      ) : (
        <div>
          <p style={{ ...sectionEyebrow, marginBottom: 10 }}>Summary</p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
              gap: 10,
              marginBottom: 22,
            }}
          >
            {[
              ["Team size", String(experienceStats.teamSize)],
              [
                "Total experience",
                `${yearsLabel(experienceStats.totalMonths)} yrs`,
              ],
              [
                "Avg experience",
                `${yearsLabel(
                  experienceStats.avgYearsPerPerson * 12
                )} yrs / person`,
              ],
            ].map(([k, v]) => (
              <div
                key={k}
                style={{
                  padding: "10px 12px",
                  border: `1px solid ${border}`,
                  borderRadius: 8,
                  backgroundColor: "rgba(21, 26, 34, 0.55)",
                }}
              >
                <p
                  style={{
                    margin: 0,
                    fontSize: 10,
                    color: mutedColor,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  {k}
                </p>
                <p
                  style={{
                    margin: "4px 0 0",
                    fontSize: 17,
                    fontWeight: 600,
                    color: text,
                  }}
                >
                  {v}
                </p>
              </div>
            ))}
          </div>

          <p style={{ ...sectionEyebrow, marginBottom: 6 }}>
            Top experience areas
          </p>
          <p style={{ ...muted, marginTop: 0, marginBottom: 10, fontSize: 12 }}>
            Role titles and skills from team experience entries (see Industries
            for sector focus).
          </p>
          {topExperienceAreas.length === 0 ? (
            <p style={{ ...muted, marginTop: 0, marginBottom: 20 }}>
              Add roles and skills under each member&apos;s My Experience.
            </p>
          ) : (
            <ul
              style={{
                margin: "0 0 22px",
                paddingLeft: 18,
                color: mutedColor,
                fontSize: 14,
                lineHeight: 1.55,
              }}
            >
              {topExperienceAreas.map((a) => (
                <li key={a.label}>
                  <span style={{ color: text }}>{a.label}</span> — {a.count}{" "}
                  {a.count === 1 ? "mention" : "mentions"}
                </li>
              ))}
            </ul>
          )}

          <p style={{ ...sectionEyebrow, marginBottom: 6 }}>Industries</p>
          {industriesList.length === 0 ? (
            <p style={{ ...muted, margin: "0 0 20px", fontSize: 14 }}>
              None listed.
            </p>
          ) : (
            <ul
              style={{
                margin: "0 0 22px",
                paddingLeft: 18,
                color: mutedColor,
                fontSize: 14,
                lineHeight: 1.55,
              }}
            >
              {industriesList.map((a) => (
                <li key={a.label}>
                  <span style={{ color: text }}>{a.label}</span> — {a.count}{" "}
                  {a.count === 1 ? "entry" : "entries"}
                </li>
              ))}
            </ul>
          )}

          <p style={{ ...sectionEyebrow, marginBottom: 6 }}>
            Qualifications
          </p>
          <p style={{ ...muted, marginTop: 0, marginBottom: 10, fontSize: 12 }}>
            Counts by title, or by qualification type when title is missing.
          </p>
          {qualificationsAggregated.length === 0 ? (
            <p style={{ ...muted, margin: "0 0 20px", fontSize: 14 }}>
              None listed.
            </p>
          ) : (
            <ul
              style={{
                margin: "0 0 22px",
                paddingLeft: 18,
                color: mutedColor,
                fontSize: 14,
                lineHeight: 1.55,
              }}
            >
              {qualificationsAggregated.map((q) => (
                <li key={q.label}>
                  <span style={{ color: text }}>{q.label}</span> — {q.count}{" "}
                  {q.count === 1 ? "qualification" : "qualifications"}
                </li>
              ))}
            </ul>
          )}

          <p style={{ ...sectionEyebrow, marginBottom: 6 }}>
            Certifications
          </p>
          <p style={{ ...muted, marginTop: 0, marginBottom: 10, fontSize: 12 }}>
            Renewable credentials; status is derived from expiry dates.
          </p>
          {certificationRows.length === 0 ? (
            <p style={{ ...muted, margin: 0, fontSize: 14 }}>None listed.</p>
          ) : (
            <>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginBottom: 14,
                  fontSize: 12,
                  color: mutedColor,
                }}
              >
                <span>
                  Expired:{" "}
                  <strong style={{ color: "#e87878" }}>
                    {certBuckets.expired.length}
                  </strong>
                </span>
                <span>
                  Expiring soon:{" "}
                  <strong style={{ color: "#e8c96a" }}>
                    {certBuckets.soon.length}
                  </strong>
                </span>
                <span>
                  Active:{" "}
                  <strong style={{ color: text }}>
                    {certBuckets.active.length}
                  </strong>
                </span>
                <span>
                  No expiry set:{" "}
                  <strong style={{ color: text }}>
                    {certBuckets.noExpiry.length}
                  </strong>
                </span>
              </div>
              {(
                [
                  {
                    rows: certBuckets.expired,
                    title: "Expired",
                    accent: "#e87878",
                  },
                  {
                    rows: certBuckets.soon,
                    title: "Expiring soon",
                    accent: "#e8c96a",
                  },
                  {
                    rows: certBuckets.active,
                    title: "Active",
                    accent: text,
                  },
                  {
                    rows: certBuckets.noExpiry,
                    title: "No expiry set",
                    accent: mutedColor,
                  },
                ] as const
              ).map((group) =>
                group.rows.length === 0 ? null : (
                  <div key={group.title} style={{ marginBottom: 14 }}>
                    <p
                      style={{
                        margin: "0 0 6px",
                        fontSize: 12,
                        fontWeight: 600,
                        color: group.accent,
                      }}
                    >
                      {group.title}{" "}
                      <span style={{ color: mutedColor, fontWeight: 400 }}>
                        ({group.rows.length})
                      </span>
                    </p>
                    <ul
                      style={{
                        margin: 0,
                        paddingLeft: 18,
                        color: mutedColor,
                        fontSize: 13,
                        lineHeight: 1.55,
                      }}
                    >
                      {group.rows.map((q) => (
                        <li key={q.id}>
                          <span style={{ color: text }}>{q.title}</span>
                          {q.issuer ? ` — ${q.issuer}` : ""}
                          {q.expiry_date ? (
                            <span style={{ fontSize: 12 }}>
                              {" "}
                              · expires {q.expiry_date}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
