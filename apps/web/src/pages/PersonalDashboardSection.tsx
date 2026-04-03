import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { getMockSuggestions } from "./hub/mockGoals";
import {
  gapTriLabel,
  gapTriState,
  levelNameToNumericScore,
  levelOrder,
  normalizeAssessmentRows,
  normalizeJobRequirementRows,
  normalizeOrgUserCompetencyRows,
  relevanceLabel,
  resolveCurrentLevelSource,
  type JobProfileRelevance,
  type JobRequirementRow,
  type LevelDef,
  type OrgUserCompetencyAssessmentRow,
  type OrgUserCompetencyRow,
} from "./hub/competencyComparison";
import { OrganisationLinkedInsightsPanel } from "./OrganisationLinkedInsightsPanel";
import {
  accent,
  accentMuted,
  bg,
  border,
  btn,
  gapTriPillStyle,
  muted,
  mutedColor,
  surface,
  text,
} from "./hub/hubTheme";

type Props = {
  activeOrgId: string | null;
  isActive: boolean;
  userEmail: string;
  workspaceRole?: string | null;
  onNavigateToMyDevelopment?: () => void;
};

type ActiveGoalMini = { id: string; competency_id: string | null };

type FocusRow = {
  competency_id: string;
  name: string;
  relevance: JobProfileRelevance;
  relevance_label: string;
  current_level: string | null;
  required_level: string | null;
};

type CreateGoalDraft = {
  competency_id: string;
  name: string;
  current_level: string | null;
  required_level: string | null;
  relevance: JobProfileRelevance;
};

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
  return p.email?.trim() || "there";
}

const relevanceRank: Record<JobProfileRelevance, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

function defaultTargetLevel(
  defs: LevelDef[],
  competencyId: string,
  currentLevel: string | null,
  requiredLevel: string | null
): string {
  const sorted = defs
    .filter((d) => d.competency_id === competencyId)
    .sort((a, b) => a.level_order - b.level_order);
  if (sorted.length === 0) return requiredLevel ?? "";
  const cur = currentLevel?.trim();
  if (!cur) return sorted[0].level_name;
  const idx = sorted.findIndex(
    (d) => d.level_name.trim().toLowerCase() === cur.toLowerCase()
  );
  if (idx === -1) return sorted[0].level_name;
  if (idx + 1 < sorted.length) return sorted[idx + 1].level_name;
  return requiredLevel ?? sorted[idx].level_name;
}

export function PersonalDashboardSection({
  activeOrgId,
  isActive,
  userEmail,
  workspaceRole = null,
  onNavigateToMyDevelopment,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [welcomeName, setWelcomeName] = useState<string>("there");
  const [roleTitle, setRoleTitle] = useState<string | null>(null);
  const [roleLevel, setRoleLevel] = useState<string | null>(null);
  const [completionPct, setCompletionPct] = useState<number | null>(null);
  const [companyCompCount, setCompanyCompCount] = useState<number>(0);
  const [roleCompCount, setRoleCompCount] = useState<number>(0);
  const [individualCompCount, setIndividualCompCount] = useState<number>(0);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [focusRows, setFocusRows] = useState<FocusRow[]>([]);
  const [insightHighPriority, setInsightHighPriority] = useState(false);
  const [levelDefsList, setLevelDefsList] = useState<LevelDef[]>([]);
  const [backlogCount, setBacklogCount] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [activeGoalsMinimal, setActiveGoalsMinimal] = useState<ActiveGoalMini[]>(
    []
  );
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [createDraft, setCreateDraft] = useState<CreateGoalDraft | null>(null);
  const [createTitle, setCreateTitle] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createTargetLevel, setCreateTargetLevel] = useState("");
  const [createSaving, setCreateSaving] = useState(false);

  const levelDefsByCompetencyId = useMemo(() => {
    const by: Record<string, LevelDef[]> = {};
    for (const d of levelDefsList) {
      if (!by[d.competency_id]) by[d.competency_id] = [];
      by[d.competency_id].push(d);
    }
    for (const k of Object.keys(by)) {
      by[k].sort((a, b) => a.level_order - b.level_order);
    }
    return by;
  }, [levelDefsList]);

  const fetchDevelopmentSummary = useCallback(async (orgId: string, uid: string) => {
    const [backlogRes, activeRes, completedRes] = await Promise.all([
      supabase
        .from("development_goals")
        .select("id", { count: "exact", head: true })
        .eq("organisation_id", orgId)
        .eq("user_id", uid)
        .eq("lifecycle_status", "backlog"),
      supabase
        .from("development_goals")
        .select("id, competency_id")
        .eq("organisation_id", orgId)
        .eq("user_id", uid)
        .eq("lifecycle_status", "active")
        .in("status", ["not_started", "in_progress"]),
      supabase
        .from("development_goals")
        .select("id", { count: "exact", head: true })
        .eq("organisation_id", orgId)
        .eq("user_id", uid)
        .eq("lifecycle_status", "completed"),
    ]);

    if (backlogRes.error) console.error(backlogRes.error);
    if (activeRes.error) console.error(activeRes.error);
    if (completedRes.error) console.error(completedRes.error);

    setBacklogCount(backlogRes.count ?? 0);
    setActiveGoalsMinimal((activeRes.data ?? []) as ActiveGoalMini[]);
    setCompletedCount(completedRes.count ?? 0);
  }, []);

  const loadDashboard = useCallback(async () => {
    if (!activeOrgId || !isActive) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);

    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) {
      setLoadError("Not signed in.");
      setLoading(false);
      return;
    }
    const uid = user.id;
    setCurrentUserId(uid);

    const [
      profileRes,
      ujpRes,
      ucRes,
      assessRes,
      compCountRes,
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select("display_name, first_name, last_name, email")
        .eq("id", uid)
        .maybeSingle(),
      supabase
        .from("user_job_profiles")
        .select("job_profile_id")
        .eq("organisation_id", activeOrgId)
        .eq("user_id", uid)
        .maybeSingle(),
      supabase
        .from("org_user_competencies")
        .select(
          "id, competency_id, current_level, assessment_source, updated_at, last_updated_by, competencies ( id, name )"
        )
        .eq("organisation_id", activeOrgId)
        .eq("user_id", uid),
      supabase
        .from("org_user_competency_assessments")
        .select(
          "id, competency_id, contributor_type, contributor_user_id, assessed_level, created_at, competencies ( id, name )"
        )
        .eq("organisation_id", activeOrgId)
        .eq("user_id", uid)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("competencies")
        .select("id", { count: "exact", head: true })
        .eq("organisation_id", activeOrgId)
        .eq("status", "active"),
    ]);

    const profileRow = profileRes.data as {
      display_name?: string | null;
      first_name?: string | null;
      last_name?: string | null;
      email?: string | null;
    } | null;
    setWelcomeName(
      displayNameFromProfile({
        display_name: profileRow?.display_name,
        first_name: profileRow?.first_name,
        last_name: profileRow?.last_name,
        email: profileRow?.email ?? userEmail,
      })
    );

    if (profileRes.error) {
      console.error(profileRes.error);
    }

    const ucData: OrgUserCompetencyRow[] = ucRes.error
      ? []
      : normalizeOrgUserCompetencyRows(ucRes.data);
    if (ucRes.error) {
      setLoadError(ucRes.error.message);
    }
    setIndividualCompCount(ucData.length);

    const assessData: OrgUserCompetencyAssessmentRow[] = assessRes.error
      ? []
      : normalizeAssessmentRows(assessRes.data);
    if (assessRes.error) {
      console.error(assessRes.error);
    }

    const companyCount = compCountRes.count ?? 0;
    setCompanyCompCount(companyCount);
    if (compCountRes.error) {
      console.error(compCountRes.error);
    }

    let jobId: string | null = null;
    if (ujpRes.error) {
      console.error(ujpRes.error);
      setRoleTitle(null);
      setRoleLevel(null);
    } else {
      jobId =
        (ujpRes.data as { job_profile_id: string | null } | null)
          ?.job_profile_id ?? null;
    }

    let reqRows: JobRequirementRow[] = [];
    let jpTitle: string | null = null;
    let jpLevel: string | null = null;

    if (jobId) {
      const [jpRes, reqRes] = await Promise.all([
        supabase
          .from("job_profiles")
          .select("title, level_name")
          .eq("id", jobId)
          .maybeSingle(),
        supabase
          .from("job_profile_competencies")
          .select(
            "competency_id, required_level, is_required, relevance, competencies ( id, name )"
          )
          .eq("job_profile_id", jobId),
      ]);

      if (!jpRes.error && jpRes.data) {
        const jp = jpRes.data as { title: string; level_name: string | null };
        jpTitle = jp.title;
        jpLevel = jp.level_name;
      }
      if (reqRes.error) {
        setLoadError((prev) =>
          prev ? `${prev}; ${reqRes.error.message}` : reqRes.error.message
        );
      } else {
        reqRows = normalizeJobRequirementRows(reqRes.data);
      }
    }

    setRoleTitle(jpTitle);
    setRoleLevel(jpLevel);
    setRoleCompCount(reqRows.length);

    const compIds = new Set<string>();
    for (const r of reqRows) compIds.add(r.competency_id);
    for (const u of ucData) compIds.add(u.competency_id);
    for (const a of assessData) compIds.add(a.competency_id);

    let levelDefs: LevelDef[] = [];
    if (compIds.size > 0) {
      const ldRes = await supabase
        .from("competency_level_definitions")
        .select("competency_id, level_name, level_order")
        .in("competency_id", [...compIds])
        .eq("is_active", true)
        .order("level_order", { ascending: true });
      if (ldRes.error) {
        console.error(ldRes.error);
      } else {
        levelDefs = (ldRes.data as LevelDef[] | null) ?? [];
      }
    }
    setLevelDefsList(levelDefs);

    type RowCalc = {
      competency_id: string;
      name: string;
      relevance: JobProfileRelevance;
      relevance_label: string;
      gap_tri: ReturnType<typeof gapTriState>;
      reqOrder: number | null;
      curOrder: number | null;
      hasCurrentLevel: boolean;
      effectiveLevel: string | null;
      required_level: string | null;
    };

    const calculated: RowCalc[] = reqRows.map((req) => {
      const uc = ucData.find((u) => u.competency_id === req.competency_id);
      const { level: effectiveLevel } = resolveCurrentLevelSource(
        req.competency_id,
        uc,
        assessData
      );
      const hasCurrentLevel = Boolean(effectiveLevel?.length);
      const curOrder = levelOrder(
        req.competency_id,
        hasCurrentLevel ? effectiveLevel : null,
        levelDefs
      );
      const reqOrder = levelOrder(
        req.competency_id,
        req.required_level,
        levelDefs
      );
      const gap_tri = gapTriState(curOrder, reqOrder, hasCurrentLevel);
      const name =
        req.competencies?.name?.trim() ||
        uc?.competency_name?.trim() ||
        "Unknown competency";
      return {
        competency_id: req.competency_id,
        name,
        relevance: req.relevance,
        relevance_label: relevanceLabel(req.relevance),
        gap_tri,
        reqOrder,
        curOrder,
        hasCurrentLevel,
        effectiveLevel: hasCurrentLevel ? effectiveLevel : null,
        required_level: req.required_level,
      };
    });

    let meets = 0;
    let above = 0;
    const scores: number[] = [];
    for (const r of calculated) {
      if (r.gap_tri === "meets") meets++;
      if (r.gap_tri === "above") above++;
      if (r.effectiveLevel) {
        const s = levelNameToNumericScore(r.effectiveLevel);
        if (s != null) scores.push(s);
      }
    }
    const totalReq = calculated.length;
    if (totalReq > 0) {
      setCompletionPct(
        Math.round(((meets + above) / totalReq) * 100)
      );
    } else {
      setCompletionPct(null);
    }

    if (scores.length > 0) {
      setAvgRating(
        Math.round(
          (scores.reduce((a, b) => a + b, 0) / scores.length) * 10
        ) / 10
      );
    } else {
      setAvgRating(null);
    }

    const belowRows = calculated.filter(
      (r): r is RowCalc & { gap_tri: "below" } => r.gap_tri === "below"
    );
    belowRows.sort((a, b) => {
      const rel =
        relevanceRank[b.relevance] - relevanceRank[a.relevance];
      if (rel !== 0) return rel;
      const sevA =
        (a.reqOrder ?? 0) - (a.curOrder ?? 0);
      const sevB =
        (b.reqOrder ?? 0) - (b.curOrder ?? 0);
      return sevB - sevA;
    });

    const focus: FocusRow[] = belowRows.slice(0, 5).map((r) => ({
      competency_id: r.competency_id,
      name: r.name,
      relevance: r.relevance,
      relevance_label: r.relevance_label,
      current_level: r.effectiveLevel,
      required_level: r.required_level,
    }));
    setFocusRows(focus);
    setInsightHighPriority(
      belowRows.some((r) => r.relevance === "high")
    );

    await fetchDevelopmentSummary(activeOrgId, uid);
    setLoading(false);
  }, [activeOrgId, isActive, userEmail, fetchDevelopmentSummary]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!createDraft) return;
    const opts = levelDefsByCompetencyId[createDraft.competency_id] ?? [];
    if (opts.length === 0) return;
    const names = opts.map((d) => d.level_name);
    if (!names.includes(createTargetLevel)) {
      setCreateTargetLevel(opts[0].level_name);
    }
  }, [createDraft, createTargetLevel, levelDefsByCompetencyId]);

  function openCreateGoal(row: FocusRow) {
    const target = defaultTargetLevel(
      levelDefsList,
      row.competency_id,
      row.current_level,
      row.required_level
    );
    setCreateDraft({
      competency_id: row.competency_id,
      name: row.name,
      current_level: row.current_level,
      required_level: row.required_level,
      relevance: row.relevance,
    });
    setCreateTitle(`Improve ${row.name}`);
    setCreateDescription("");
    setCreateTargetLevel(target);
  }

  function closeCreateGoal() {
    setCreateDraft(null);
    setCreateTitle("");
    setCreateDescription("");
    setCreateTargetLevel("");
    setCreateSaving(false);
  }

  async function handleSaveGoal(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!createDraft || !activeOrgId || !currentUserId) return;
    const target = createTargetLevel.trim();
    if (!target) {
      alert("Please set a target level.");
      return;
    }
    const title = createTitle.trim();
    if (!title) {
      alert("Please enter a title.");
      return;
    }

    setCreateSaving(true);
    const suggestions = getMockSuggestions(createDraft.name);
    const { error } = await supabase.from("development_goals").insert({
      organisation_id: activeOrgId,
      user_id: currentUserId,
      competency_id: createDraft.competency_id,
      current_level: createDraft.current_level?.trim() || "Not assessed",
      target_level: target,
      relevance: createDraft.relevance,
      title,
      description: createDescription.trim() || null,
      suggested_actions: suggestions,
      status: "not_started",
      progress: 0,
      lifecycle_status: "active",
    });
    setCreateSaving(false);
    if (error) {
      console.error(error);
      alert(error.message || "Could not save goal.");
      return;
    }
    closeCreateGoal();
    await fetchDevelopmentSummary(activeOrgId, currentUserId);
  }

  function hasActiveGoalForCompetency(competencyId: string): boolean {
    return activeGoalsMinimal.some((g) => g.competency_id === competencyId);
  }

  if (!isActive) {
    return null;
  }

  if (!activeOrgId) {
    return (
      <div style={{ ...muted, marginTop: 0 }}>
        Select a workspace to see your dashboard.
      </div>
    );
  }

  if (loading) {
    return (
      <p style={{ ...muted, marginTop: 0 }}>Loading your dashboard…</p>
    );
  }

  if (loadError) {
    return (
      <p style={{ marginTop: 0, fontSize: 14, color: "#e87878" }}>
        {loadError}
      </p>
    );
  }

  const sectionGap = 28;
  const card = {
    padding: "16px 18px",
    borderRadius: 10,
    backgroundColor: surface,
    border: `1px solid ${border}`,
    boxSizing: "border-box" as const,
  };

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    fontSize: 14,
    color: text,
    backgroundColor: bg,
    border: `1px solid ${border}`,
    borderRadius: 8,
    boxSizing: "border-box" as const,
  } as const;

  const labelStyle = {
    display: "grid" as const,
    gap: 6,
    fontSize: 13,
    color: mutedColor,
  };

  const targetOptions =
    createDraft != null
      ? levelDefsByCompetencyId[createDraft.competency_id] ?? []
      : [];

  const atGoalCap = activeGoalsMinimal.length >= 5;

  return (
    <div
      style={{
        maxWidth: 720,
        display: "flex",
        flexDirection: "column",
        gap: sectionGap,
      }}
    >
      <header>
        <h2
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 600,
            color: text,
            letterSpacing: "-0.02em",
          }}
        >
          Welcome back, {welcomeName}
        </h2>
        <p
          style={{
            margin: "10px 0 0",
            fontSize: 14,
            color: mutedColor,
            lineHeight: 1.55,
          }}
        >
          <span style={{ color: text, fontWeight: 500 }}>
            {roleTitle ?? "No role assigned"}
          </span>
          {roleLevel ? (
            <>
              {" "}
              · Level{" "}
              <span style={{ color: text, fontWeight: 500 }}>{roleLevel}</span>
            </>
          ) : null}
          {completionPct != null ? (
            <>
              {" "}
              ·{" "}
              <span style={{ color: text, fontWeight: 500 }}>
                {completionPct}% role match
              </span>
            </>
          ) : (
            <>
              {" "}
              ·{" "}
              <span style={{ color: mutedColor }}>
                Role completion not available
              </span>
            </>
          )}
        </p>
      </header>

      <OrganisationLinkedInsightsPanel
        activeOrgId={activeOrgId}
        isActive={isActive}
        workspaceRole={workspaceRole}
        title="Linked industry insights"
      />

      {insightHighPriority && focusRows.length > 0 ? (
        <p
          style={{
            margin: 0,
            padding: "12px 14px",
            borderRadius: 8,
            fontSize: 13,
            lineHeight: 1.5,
            color: text,
            backgroundColor: accentMuted,
            borderLeft: `3px solid ${accent}`,
          }}
        >
          You have high-importance gaps for your role. Address the focus areas
          below first.
        </p>
      ) : null}

      <section>
        <p
          style={{
            margin: "0 0 8px",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: mutedColor,
          }}
        >
          Capability summary
        </p>
        <div
          style={{
            ...card,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
          }}
        >
          <div>
            <div style={{ fontSize: 12, color: mutedColor }}>Company</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: text }}>
              {companyCompCount}
            </div>
            <div style={{ fontSize: 12, color: mutedColor, marginTop: 2 }}>
              competencies in library
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: mutedColor }}>Your role</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: text }}>
              {roleCompCount}
            </div>
            <div style={{ fontSize: 12, color: mutedColor, marginTop: 2 }}>
              expected in profile
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: mutedColor }}>Individual</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: text }}>
              {individualCompCount}
            </div>
            <div style={{ fontSize: 12, color: mutedColor, marginTop: 2 }}>
              levels recorded
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: mutedColor }}>
              Completion
            </div>
            <div style={{ fontSize: 20, fontWeight: 600, color: text }}>
              {completionPct != null ? `${completionPct}%` : "—"}
            </div>
            <div style={{ fontSize: 12, color: mutedColor, marginTop: 2 }}>
              meets or above vs role
            </div>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ fontSize: 12, color: mutedColor }}>
              Average level (1–4 scale)
            </div>
            <div style={{ fontSize: 20, fontWeight: 600, color: text }}>
              {avgRating != null ? `${avgRating} / 4` : "—"}
            </div>
            <div style={{ fontSize: 12, color: mutedColor, marginTop: 2 }}>
              across assessed role competencies
            </div>
          </div>
        </div>
      </section>

      <section>
        <p
          style={{
            margin: "0 0 8px",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: mutedColor,
          }}
        >
          Focus areas
        </p>
        <p style={{ ...muted, margin: "0 0 12px", fontSize: 13 }}>
          Competencies below your role expectation (highest relevance first).
        </p>
        {focusRows.length === 0 ? (
          <div style={{ ...card, margin: 0 }}>
            <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>
              No gaps below your role requirements right now.
            </p>
          </div>
        ) : (
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {focusRows.map((row) => {
              const high = row.relevance === "high";
              const blocked =
                hasActiveGoalForCompetency(row.competency_id) || atGoalCap;
              return (
                <li
                  key={row.competency_id}
                  style={{
                    ...card,
                    margin: 0,
                    backgroundColor: high
                      ? "rgba(110, 176, 240, 0.06)"
                      : surface,
                    borderColor: high
                      ? "rgba(110, 176, 240, 0.22)"
                      : border,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 15,
                      color: text,
                      marginBottom: 8,
                    }}
                  >
                    {row.name}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: 10,
                      fontSize: 13,
                      color: mutedColor,
                      marginBottom: 12,
                    }}
                  >
                    <span
                      style={{
                        display: "inline-block",
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                        padding: "5px 10px",
                        borderRadius: 6,
                        ...gapTriPillStyle("below"),
                      }}
                    >
                      {gapTriLabel("below")}
                    </span>
                    <span>
                      Relevance:{" "}
                      <span style={{ color: text, fontWeight: 500 }}>
                        {row.relevance_label}
                      </span>
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={blocked}
                    onClick={() => openCreateGoal(row)}
                    style={{
                      ...btn,
                      fontSize: 13,
                      padding: "8px 14px",
                      opacity: blocked ? 0.5 : 1,
                      cursor: blocked ? "not-allowed" : "pointer",
                    }}
                  >
                    Improve this
                  </button>
                  {hasActiveGoalForCompetency(row.competency_id) ? (
                    <p
                      style={{
                        margin: "8px 0 0",
                        fontSize: 12,
                        color: mutedColor,
                      }}
                    >
                      You already have an active goal for this competency.
                    </p>
                  ) : null}
                  {atGoalCap && !hasActiveGoalForCompetency(row.competency_id) ? (
                    <p
                      style={{
                        margin: "8px 0 0",
                        fontSize: 12,
                        color: mutedColor,
                      }}
                    >
                      Maximum of five active goals reached. Complete or clear a
                      goal to add another.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <p
          style={{
            margin: "0 0 8px",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: mutedColor,
          }}
        >
          My Development
        </p>
        <p
          style={{
            margin: "0 0 12px",
            fontSize: 13,
            color: mutedColor,
            lineHeight: 1.5,
          }}
        >
          View backlog, active goals, and completed history in one place. Create
          new goals from focus areas below.
        </p>
        <div style={{ ...card, margin: 0 }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "16px 28px",
              alignItems: "flex-end",
            }}
          >
            <div>
              <div style={{ fontSize: 12, color: mutedColor }}>Backlog</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: text }}>
                {backlogCount}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: mutedColor }}>Active</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: text }}>
                {activeGoalsMinimal.length}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: mutedColor }}>Completed</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: text }}>
                {completedCount}
              </div>
            </div>
          </div>
          <p style={{ margin: "12px 0 0", fontSize: 13, color: mutedColor }}>
            {activeGoalsMinimal.length > 0
              ? `${activeGoalsMinimal.length} active goal${activeGoalsMinimal.length === 1 ? "" : "s"} in this workspace.`
              : "No active goals yet — use Improve this on a focus area when you are ready."}
          </p>
          <button
            type="button"
            onClick={() => onNavigateToMyDevelopment?.()}
            style={{ ...btn, fontSize: 13, marginTop: 14 }}
          >
            View My Development
          </button>
        </div>
      </section>

      {createDraft ? (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="create-goal-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "24px 16px",
            overflow: "auto",
            backgroundColor: "rgba(0,0,0,0.55)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeCreateGoal();
          }}
        >
          <form
            onSubmit={handleSaveGoal}
            style={{
              ...card,
              width: "100%",
              maxWidth: 440,
              marginTop: 32,
              display: "grid",
              gap: 14,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="create-goal-title"
              style={{
                margin: 0,
                fontSize: 17,
                fontWeight: 600,
                color: text,
              }}
            >
              Create development goal
            </h3>
            <label style={labelStyle}>
              Competency
              <input
                readOnly
                value={createDraft.name}
                style={{ ...inputStyle, opacity: 0.85 }}
              />
            </label>
            <label style={labelStyle}>
              Current level
              <input
                readOnly
                value={
                  createDraft.current_level?.trim() || "Not assessed"
                }
                style={{ ...inputStyle, opacity: 0.85 }}
              />
            </label>
            <label style={labelStyle}>
              Target level
              {targetOptions.length > 0 ? (
                <select
                  required
                  value={createTargetLevel}
                  onChange={(e) => setCreateTargetLevel(e.target.value)}
                  style={inputStyle}
                >
                  {targetOptions.map((d) => (
                    <option key={d.level_name} value={d.level_name}>
                      {d.level_order}. {d.level_name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  required
                  value={createTargetLevel}
                  onChange={(e) => setCreateTargetLevel(e.target.value)}
                  placeholder="e.g. Intermediate"
                  style={inputStyle}
                />
              )}
            </label>
            <label style={labelStyle}>
              Relevance
              <input
                readOnly
                value={relevanceLabel(createDraft.relevance)}
                style={{ ...inputStyle, opacity: 0.85 }}
              />
            </label>
            <label style={labelStyle}>
              Title
              <input
                required
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Description (optional)
              <textarea
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                rows={3}
                style={{
                  ...inputStyle,
                  resize: "vertical" as const,
                  fontFamily: "inherit",
                }}
              />
            </label>
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: mutedColor,
                  marginBottom: 8,
                }}
              >
                Suggested actions
              </div>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 18,
                  fontSize: 13,
                  color: text,
                  lineHeight: 1.5,
                }}
              >
                {getMockSuggestions(createDraft.name).map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <button
                type="submit"
                disabled={createSaving}
                style={{ ...btn, fontSize: 13 }}
              >
                {createSaving ? "Saving…" : "Save goal"}
              </button>
              <button
                type="button"
                disabled={createSaving}
                onClick={closeCreateGoal}
                style={{ ...btn, fontSize: 13 }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
