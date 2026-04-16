import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "../lib/supabase";
import styles from "./MyCareerSection.module.css";
import type {
  UserCareerPlanRow,
  UserExperienceProject,
  UserExperienceRow,
} from "./hub/types";
import {
  buildPersonalCareerEvidenceSnapshot,
  inferCurrentRoleFromExperiences,
} from "./hub/personalCareerSnapshot";
import {
  bg,
  border,
  borderSubtle,
  btn,
  btnGhost,
  errorColor,
  muted,
  mutedColor,
  panelShell,
  sectionEyebrow,
  surface,
  text,
} from "./hub/hubTheme";
import {
  getSuggestedDevelopmentFocus,
  type DevelopmentFocusItem,
} from "./hub/careerFocusSuggestions";
import { CareerCoachModal } from "./hub/careerCoach/CareerCoachModal";
import type { CareerFocusArea } from "./hub/careerCoach/types";
import { buildCareerRefinementContext } from "./hub/careerCoach/buildCareerRefinementContext";
import { addDevelopmentFocusItem } from "./hub/developmentFocusItemsApi";

type Props = {
  activeOrgId: string | null;
  isActive: boolean;
  primaryAccountType: string | null;
  primaryAccountTypeReady: boolean;
};

export function MyCareerSection({
  activeOrgId,
  isActive,
  primaryAccountType,
  primaryAccountTypeReady,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [currentRoleLine, setCurrentRoleLine] = useState<string | null>(null);
  const [nextRole, setNextRole] = useState("");
  const [nextRoleHorizon, setNextRoleHorizon] = useState("");
  const [futureRole, setFutureRole] = useState("");
  const [futureRoleHorizon, setFutureRoleHorizon] = useState("");
  const [careerNotes, setCareerNotes] = useState("");

  const [readinessCompetencyCount, setReadinessCompetencyCount] = useState(0);
  const [readinessExperienceCount, setReadinessExperienceCount] = useState(0);

  /** Career focus ids already saved as development backlog rows. */
  const [devFocusQueued, setDevFocusQueued] = useState<Record<string, boolean>>(
    {}
  );
  const [savingFocusId, setSavingFocusId] = useState<string | null>(null);
  const [careerCoachOpen, setCareerCoachOpen] = useState(false);
  const [careerCoachResult, setCareerCoachResult] = useState<string | null>(
    null,
  );
  const [catalogueBacklogKeys, setCatalogueBacklogKeys] = useState<Set<string>>(
    new Set(),
  );
  const [catalogueSavingId, setCatalogueSavingId] = useState<string | null>(null);
  const [showAddedCatalogueFocus, setShowAddedCatalogueFocus] = useState(false);

  const [personalProfileSummary, setPersonalProfileSummary] = useState<
    string | null
  >(null);
  const [personalExperiences, setPersonalExperiences] = useState<
    UserExperienceRow[]
  >([]);
  const [personalProjects, setPersonalProjects] = useState<
    UserExperienceProject[]
  >([]);
  const [personalQualificationCount, setPersonalQualificationCount] =
    useState(0);
  const [personalCertificationCount, setPersonalCertificationCount] =
    useState(0);

  const isPersonalCareer =
    primaryAccountType === "personal" && !activeOrgId;

  const personalEvidenceSnapshot = useMemo(() => {
    if (!isPersonalCareer) return null;
    return buildPersonalCareerEvidenceSnapshot(
      personalExperiences,
      personalProjects,
      personalQualificationCount,
      personalCertificationCount,
    );
  }, [
    isPersonalCareer,
    personalExperiences,
    personalProjects,
    personalQualificationCount,
    personalCertificationCount,
  ]);

  const careerCoachContext = useMemo(() => {
    if (!isPersonalCareer) return null;
    if (!personalEvidenceSnapshot) return null;
    return buildCareerRefinementContext({
      profileSummary: personalProfileSummary,
      currentRoleLine,
      careerVision: {
        nextRole,
        nextRoleHorizon,
        futureRole,
        futureRoleHorizon,
      },
      careerNotes,
      evidenceSnapshot: personalEvidenceSnapshot,
      client: "web:MyCareerSection",
    });
  }, [
    isPersonalCareer,
    personalEvidenceSnapshot,
    personalProfileSummary,
    currentRoleLine,
    nextRole,
    nextRoleHorizon,
    futureRole,
    futureRoleHorizon,
    careerNotes,
  ]);

  const suggestedFocus = useMemo(
    () => getSuggestedDevelopmentFocus(nextRole, futureRole),
    [nextRole, futureRole]
  );

  const visibleSuggestedFocus = useMemo(() => {
    if (!isPersonalCareer) return suggestedFocus;
    if (showAddedCatalogueFocus) return suggestedFocus;
    return suggestedFocus.filter((x) => {
      const k = x.title.trim().toLowerCase();
      return !k || !catalogueBacklogKeys.has(k);
    });
  }, [
    isPersonalCareer,
    showAddedCatalogueFocus,
    suggestedFocus,
    catalogueBacklogKeys,
  ]);

  // Preload personal catalogue backlog titles so buttons can show "Added".
  useEffect(() => {
    if (!isPersonalCareer || !userId) return;
    if (suggestedFocus.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("development_focus_items")
        .select("title")
        .eq("user_id", userId)
        .is("organisation_id", null)
        .eq("source", "catalogue");

      if (cancelled) return;
      if (error) {
        console.warn("development_focus_items catalogue preload:", error.message);
        return;
      }
      const keys = new Set(
        ((data ?? []) as { title: string | null }[])
          .map((r) => (r.title ?? "").trim().toLowerCase())
          .filter(Boolean),
      );
      setCatalogueBacklogKeys(keys);
    })();
    return () => {
      cancelled = true;
    };
  }, [isPersonalCareer, userId, suggestedFocus.length]);

  const loadData = useCallback(async () => {
    if (!isActive) {
      setLoading(false);
      return;
    }

    const isPersonalStandalone =
      primaryAccountType === "personal" && !activeOrgId;

    if (isPersonalStandalone) {
      setLoading(true);
      setLoadError(null);
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) {
        setLoadError("Not signed in.");
        setLoading(false);
        return;
      }
      setUserId(uid);
      setReadinessCompetencyCount(0);
      setDevFocusQueued({});

      const [
        profileRes,
        expRes,
        projRes,
        planRes,
        qualCountRes,
        certCountRes,
      ] = await Promise.all([
        supabase
          .from("profiles")
          .select("summary")
          .eq("id", uid)
          .maybeSingle(),
        supabase
          .from("user_experience")
          .select("*")
          .eq("user_id", uid)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: false }),
        supabase
          .from("user_experience_projects")
          .select("*")
          .eq("user_id", uid)
          .order("created_at", { ascending: true }),
        supabase
          .from("user_career_plans")
          .select("*")
          .eq("user_id", uid)
          .is("organisation_id", null)
          .maybeSingle(),
        supabase
          .from("user_qualifications")
          .select("id", { count: "exact", head: true })
          .is("organisation_id", null)
          .eq("user_id", uid),
        supabase
          .from("user_certifications")
          .select("id", { count: "exact", head: true })
          .is("organisation_id", null)
          .eq("user_id", uid),
      ]);

      if (profileRes.error) {
        console.warn("profiles:", profileRes.error.message);
        setPersonalProfileSummary(null);
      } else {
        setPersonalProfileSummary(
          (profileRes.data as { summary?: string | null } | null)?.summary
            ?.trim() || null,
        );
      }

      const experiences = !expRes.error
        ? ((expRes.data as UserExperienceRow[]) ?? [])
        : [];
      if (expRes.error) {
        console.error(expRes.error);
        setLoadError(expRes.error.message);
      }
      setPersonalExperiences(experiences);
      setReadinessExperienceCount(experiences.length);
      setCurrentRoleLine(inferCurrentRoleFromExperiences(experiences));

      if (projRes.error) {
        console.error(projRes.error);
        if (!expRes.error) setLoadError(projRes.error.message);
        setPersonalProjects([]);
      } else {
        setPersonalProjects((projRes.data as UserExperienceProject[]) ?? []);
      }

      setPersonalQualificationCount(
        !qualCountRes.error && qualCountRes.count != null
          ? qualCountRes.count
          : 0,
      );
      setPersonalCertificationCount(
        !certCountRes.error && certCountRes.count != null
          ? certCountRes.count
          : 0,
      );

      if (planRes.error) {
        console.error(planRes.error);
        setLoadError(planRes.error.message);
        setNextRole("");
        setNextRoleHorizon("");
        setFutureRole("");
        setFutureRoleHorizon("");
        setCareerNotes("");
      } else if (planRes.data) {
        const p = planRes.data as UserCareerPlanRow;
        setNextRole(p.next_role ?? "");
        setNextRoleHorizon(p.next_role_horizon ?? "");
        setFutureRole(p.future_role ?? "");
        setFutureRoleHorizon(p.future_role_horizon ?? "");
        setCareerNotes(p.career_notes ?? "");
      } else {
        setNextRole("");
        setNextRoleHorizon("");
        setFutureRole("");
        setFutureRoleHorizon("");
        setCareerNotes("");
      }

      setLoading(false);
      return;
    }

    if (!activeOrgId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);
    setPersonalProfileSummary(null);
    setPersonalExperiences([]);
    setPersonalProjects([]);
    setPersonalQualificationCount(0);
    setPersonalCertificationCount(0);

    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) {
      setLoadError("Not signed in.");
      setLoading(false);
      return;
    }
    setUserId(uid);

    const [ujpRes, planRes, expCountRes, backlogCareerRes] = await Promise.all([
      supabase
        .from("user_job_profiles")
        .select("job_profile_id")
        .eq("organisation_id", activeOrgId)
        .eq("user_id", uid)
        .maybeSingle(),
      supabase
        .from("user_career_plans")
        .select("*")
        .eq("user_id", uid)
        .eq("organisation_id", activeOrgId)
        .maybeSingle(),
      supabase
        .from("user_experience")
        .select("id", { count: "exact", head: true })
        .eq("user_id", uid),
      supabase
        .from("development_goals")
        .select("career_focus_source_id")
        .eq("organisation_id", activeOrgId)
        .eq("user_id", uid)
        .eq("lifecycle_status", "backlog")
        .not("career_focus_source_id", "is", null),
    ]);

    let jobLine: string | null = null;
    let compCount = 0;

    if (!ujpRes.error && ujpRes.data) {
      const jid = (ujpRes.data as { job_profile_id: string | null })
        .job_profile_id;
      if (jid) {
        const jpRes = await supabase
          .from("job_profiles")
          .select("title, level_name")
          .eq("id", jid)
          .maybeSingle();
        if (!jpRes.error && jpRes.data) {
          const jp = jpRes.data as {
            title: string;
            level_name: string | null;
          };
          jobLine = jp.level_name
            ? `${jp.title} · ${jp.level_name}`
            : jp.title;
        }

        const jcRes = await supabase
          .from("job_profile_competencies")
          .select("id", { count: "exact", head: true })
          .eq("job_profile_id", jid);
        if (!jcRes.error && jcRes.count != null) {
          compCount = jcRes.count;
        }
      }
    } else if (ujpRes.error) {
      console.warn("user_job_profiles:", ujpRes.error.message);
    }

    setCurrentRoleLine(jobLine);
    setReadinessCompetencyCount(compCount);

    if (!expCountRes.error && expCountRes.count != null) {
      setReadinessExperienceCount(expCountRes.count);
    } else {
      setReadinessExperienceCount(0);
    }

    if (planRes.error) {
      console.error(planRes.error);
      setLoadError(planRes.error.message);
    } else if (planRes.data) {
      const p = planRes.data as UserCareerPlanRow;
      setNextRole(p.next_role ?? "");
      setNextRoleHorizon(p.next_role_horizon ?? "");
      setFutureRole(p.future_role ?? "");
      setFutureRoleHorizon(p.future_role_horizon ?? "");
      setCareerNotes(p.career_notes ?? "");
    } else {
      setNextRole("");
      setNextRoleHorizon("");
      setFutureRole("");
      setFutureRoleHorizon("");
      setCareerNotes("");
    }

    const queued: Record<string, boolean> = {};
    if (!backlogCareerRes.error && backlogCareerRes.data) {
      for (const row of backlogCareerRes.data as {
        career_focus_source_id: string | null;
      }[]) {
        if (row.career_focus_source_id) {
          queued[row.career_focus_source_id] = true;
        }
      }
    } else if (backlogCareerRes.error) {
      console.warn("development_goals backlog:", backlogCareerRes.error.message);
    }
    setDevFocusQueued(queued);

    setLoading(false);
  }, [isActive, activeOrgId, primaryAccountType]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function persistCareerPlan() {
    if (!userId) return;

    setSaving(true);
    setLoadError(null);

    const payloadBase = {
      next_role: nextRole.trim() || null,
      next_role_horizon: nextRoleHorizon.trim() || null,
      future_role: futureRole.trim() || null,
      future_role_horizon: futureRoleHorizon.trim() || null,
      career_notes: careerNotes.trim() || null,
      updated_at: new Date().toISOString(),
    };

    if (isPersonalCareer) {
      const payload = {
        user_id: userId,
        organisation_id: null as string | null,
        ...payloadBase,
      };
      const { data: existing } = await supabase
        .from("user_career_plans")
        .select("id")
        .eq("user_id", userId)
        .is("organisation_id", null)
        .maybeSingle();

      let error = null as { message?: string } | null;
      if (existing?.id) {
        const res = await supabase
          .from("user_career_plans")
          .update(payload)
          .eq("id", existing.id);
        error = res.error;
      } else {
        const res = await supabase.from("user_career_plans").insert(payload);
        error = res.error;
      }

      setSaving(false);
      if (error) {
        console.error(error);
        setLoadError(error.message || "Could not save.");
        return;
      }
      await loadData();
      return;
    }

    if (!activeOrgId) {
      setSaving(false);
      return;
    }

    const payload = {
      user_id: userId,
      organisation_id: activeOrgId,
      ...payloadBase,
    };

    const { error } = await supabase.from("user_career_plans").upsert(payload, {
      onConflict: "user_id,organisation_id",
    });

    setSaving(false);
    if (error) {
      console.error(error);
      setLoadError(error.message || "Could not save.");
      return;
    }
    await loadData();
  }

  async function handleSaveVision(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await persistCareerPlan();
  }

  async function handleSaveNotes(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await persistCareerPlan();
  }

  async function handleSaveToDevelopmentBacklog(item: DevelopmentFocusItem) {
    if (!userId || !activeOrgId || isPersonalCareer) return;
    setSavingFocusId(item.id);
    setLoadError(null);

    const { data: existing } = await supabase
      .from("development_goals")
      .select("id")
      .eq("organisation_id", activeOrgId)
      .eq("user_id", userId)
      .eq("career_focus_source_id", item.id)
      .maybeSingle();

    if (existing) {
      setDevFocusQueued((prev) => ({ ...prev, [item.id]: true }));
      setSavingFocusId(null);
      return;
    }

    const { error } = await supabase.from("development_goals").insert({
      organisation_id: activeOrgId,
      user_id: userId,
      competency_id: null,
      current_level: "—",
      target_level: "—",
      relevance: "medium",
      title: item.title,
      description: item.explanation,
      suggested_actions: [],
      status: "not_started",
      progress: 0,
      lifecycle_status: "backlog",
      career_focus_source_id: item.id,
    });

    setSavingFocusId(null);
    if (error) {
      console.error(error);
      setLoadError(error.message || "Could not save to development backlog.");
      return;
    }
    setDevFocusQueued((prev) => ({ ...prev, [item.id]: true }));
  }

  async function applyCareerCoachAreas(areas: CareerFocusArea[]) {
    if (!userId) return;
    setLoadError(null);
    setCareerCoachResult(null);
    if (!isPersonalCareer) return;

    const cleaned = (areas ?? [])
      .map((a) => ({
        title: a.title?.trim() ?? "",
        description: a.description?.trim() ?? "",
        related_signals:
          (a.related_signals as unknown as Record<string, unknown> | undefined) ??
          {},
      }))
      .filter((a) => a.title.length > 0 && a.description.length > 0)
      .slice(0, 8);

    if (cleaned.length === 0) return;

    // Duplicate prevention: skip if a personal AI item already exists with same title (case-insensitive).
    const { data: existing, error } = await supabase
      .from("development_focus_items")
      .select("title")
      .eq("user_id", userId)
      .is("organisation_id", null)
      .eq("source", "ai");

    if (error) {
      console.error(error);
      throw new Error(error.message || "Could not check existing backlog items.");
    }

    const existingKeys = new Set(
      ((existing ?? []) as { title: string | null }[])
        .map((r) => (r.title ?? "").trim().toLowerCase())
        .filter(Boolean),
    );

    let added = 0;
    let skipped = 0;

    for (const a of cleaned) {
      const k = a.title.trim().toLowerCase();
      if (!k) continue;
      if (existingKeys.has(k)) {
        skipped += 1;
        continue;
      }
      await addDevelopmentFocusItem({
        organisation_id: null,
        title: a.title,
        description: a.description,
        source: "ai",
        related_signals: a.related_signals,
        status: "backlog",
      });
      existingKeys.add(k);
      added += 1;
    }

    if (added === 0 && skipped > 0) {
      setCareerCoachResult(
        `All ${skipped} focus area${skipped === 1 ? "" : "s"} already existed in your Development Backlog.`,
      );
      return;
    }

    setCareerCoachResult(
      skipped > 0
        ? `Added ${added} focus area${added === 1 ? "" : "s"} to Development Backlog (skipped ${skipped} duplicate${skipped === 1 ? "" : "s"}).`
        : `Added ${added} focus area${added === 1 ? "" : "s"} to Development Backlog.`,
    );
  }

  if (!isActive) {
    return null;
  }

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

  if (!activeOrgId && !primaryAccountTypeReady) {
    return (
      <div style={{ ...panelShell, marginTop: 0 }}>
        <p style={{ ...muted, margin: 0 }}>Loading…</p>
      </div>
    );
  }

  if (!activeOrgId && primaryAccountType !== "personal") {
    return (
      <div style={{ ...panelShell, marginTop: 0 }}>
        <p style={{ ...muted, margin: 0 }}>
          Select a workspace to plan your career in context.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ ...panelShell, marginTop: 0 }}>
        <p style={{ ...muted, margin: 0 }}>Loading…</p>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
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
          My Career
        </h2>
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 14,
            color: mutedColor,
            lineHeight: 1.5,
          }}
        >
          {isPersonalCareer ? (
            <>
              Your career view, built from the profile and evidence you already
              save in Capability Studio — no workspace required. If you join an
              organisation later, you can layer workspace job context on top of
              this.
            </>
          ) : (
            <>Plan your next career moves and longer-term growth.</>
          )}
        </p>
      </header>

      {loadError ? (
        <p style={{ margin: 0, fontSize: 14, color: errorColor }}>{loadError}</p>
      ) : null}

      <div
        className={`${styles.grid} ${!isPersonalCareer ? styles.gridSingle : ""}`}
      >
        {isPersonalCareer && personalEvidenceSnapshot ? (
          <>
            <div className={styles.colLabel}>
              <p style={{ ...sectionEyebrow, margin: 0 }}>Your Evidence</p>
            </div>
            <div className={styles.colLabel}>
              <p style={{ ...sectionEyebrow, margin: 0 }}>Your Career Direction</p>
            </div>
          </>
        ) : null}
        {isPersonalCareer && personalEvidenceSnapshot ? (
          <div className={styles.col}>
            <section>
              <div style={{ ...card, marginTop: 0, display: "grid", gap: 14 }}>
                <div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 13,
                      fontWeight: 600,
                      color: text,
                    }}
                  >
                    Profile summary
                  </p>
                  <p
                    style={{
                      margin: "8px 0 0",
                      fontSize: 14,
                      color: personalProfileSummary ? text : mutedColor,
                      lineHeight: 1.55,
                    }}
                  >
                    {personalProfileSummary ? (
                      personalProfileSummary
                    ) : (
                      <>
                        No summary on your profile yet — add one in{" "}
                        <strong style={{ color: text }}>My Dashboard</strong> so
                        this section reflects how you describe yourself.
                      </>
                    )}
                  </p>
                </div>

                <div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 13,
                      fontWeight: 600,
                      color: text,
                    }}
                  >
                    Evidence snapshot
                  </p>
                  <ul
                    style={{
                      margin: "8px 0 0",
                      paddingLeft: 18,
                      fontSize: 14,
                      color: text,
                      lineHeight: 1.6,
                    }}
                  >
                    <li>
                      Work roles:{" "}
                      <strong>{personalEvidenceSnapshot.experienceCount}</strong>
                    </li>
                    <li>
                      Projects under those roles:{" "}
                      <strong>{personalEvidenceSnapshot.projectCount}</strong>
                    </li>
                    <li>
                      Qualifications:{" "}
                      <strong>
                        {personalEvidenceSnapshot.qualificationCount}
                      </strong>
                    </li>
                    <li>
                      Certifications:{" "}
                      <strong>
                        {personalEvidenceSnapshot.certificationCount}
                      </strong>
                    </li>
                  </ul>
                </div>

                {personalEvidenceSnapshot.domainSummary ? (
                  <div>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 13,
                        fontWeight: 600,
                        color: text,
                      }}
                    >
                      Domains and industries (from your roles and projects)
                    </p>
                    <p
                      style={{
                        margin: "8px 0 0",
                        fontSize: 14,
                        color: mutedColor,
                        lineHeight: 1.55,
                      }}
                    >
                      {personalEvidenceSnapshot.domainSummary}
                    </p>
                  </div>
                ) : null}

                {personalEvidenceSnapshot.topSkills.length > 0 ? (
                  <div>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 13,
                        fontWeight: 600,
                        color: text,
                      }}
                    >
                      Skills recorded most often
                    </p>
                    <div
                      style={{
                        marginTop: 10,
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 8,
                      }}
                    >
                      {personalEvidenceSnapshot.topSkills
                        .slice(0, 10)
                        .map((s) => (
                          <span
                            key={s.label}
                            style={{
                              padding: "5px 10px",
                              borderRadius: 999,
                              fontSize: 12,
                              color: text,
                              border: `1px solid ${borderSubtle}`,
                              backgroundColor: bg,
                            }}
                          >
                            {s.label}
                            <span style={{ color: mutedColor }}> · {s.count}</span>
                          </span>
                        ))}
                    </div>
                  </div>
                ) : null}

                {(personalEvidenceSnapshot.topMethods.length > 0 ||
                  personalEvidenceSnapshot.topTools.length > 0) && (
                  <div>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 13,
                        fontWeight: 600,
                        color: text,
                      }}
                    >
                      How you work (methods and tools)
                    </p>
                    {personalEvidenceSnapshot.topMethods.length > 0 ? (
                      <p
                        style={{
                          margin: "8px 0 0",
                          fontSize: 13,
                          color: text,
                          lineHeight: 1.5,
                        }}
                      >
                        <span style={{ color: mutedColor }}>Methods: </span>
                        {personalEvidenceSnapshot.topMethods
                          .map((m) => m.label)
                          .join(", ")}
                      </p>
                    ) : null}
                    {personalEvidenceSnapshot.topTools.length > 0 ? (
                      <p
                        style={{
                          margin: "6px 0 0",
                          fontSize: 13,
                          color: text,
                          lineHeight: 1.5,
                        }}
                      >
                        <span style={{ color: mutedColor }}>Tools: </span>
                        {personalEvidenceSnapshot.topTools
                          .map((t) => t.label)
                          .join(", ")}
                      </p>
                    ) : null}
                  </div>
                )}

                {personalEvidenceSnapshot.strengthLines.length > 0 ? (
                  <div>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 13,
                        fontWeight: 600,
                        color: text,
                      }}
                    >
                      Strengths suggested by repetition in your evidence
                    </p>
                    <ul
                      style={{
                        margin: "8px 0 0",
                        paddingLeft: 18,
                        fontSize: 14,
                        color: mutedColor,
                        lineHeight: 1.55,
                      }}
                    >
                      {personalEvidenceSnapshot.strengthLines.map((line, idx) => (
                        <li key={idx}>{line}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {personalEvidenceSnapshot.gapHints.length > 0 ? (
                  <div>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 13,
                        fontWeight: 600,
                        color: text,
                      }}
                    >
                      Gaps to strengthen (heuristic, not a score)
                    </p>
                    <ul
                      style={{
                        margin: "8px 0 0",
                        paddingLeft: 18,
                        fontSize: 14,
                        color: mutedColor,
                        lineHeight: 1.55,
                      }}
                    >
                      {personalEvidenceSnapshot.gapHints.map((g) => (
                        <li key={g}>{g}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        ) : null}

        <div className={styles.col}>
          <section>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <p style={{ ...sectionEyebrow, marginTop: 0 }}>Career vision</p>
              {isPersonalCareer ? (
                <button
                  type="button"
                  onClick={() => setCareerCoachOpen(true)}
                  disabled={!careerCoachContext}
                  style={{
                    ...btnGhost,
                    fontSize: 12,
                    padding: "6px 10px",
                    opacity: careerCoachContext ? 1 : 0.5,
                  }}
                >
                  AI Coach
                </button>
              ) : null}
            </div>
            <form
              onSubmit={handleSaveVision}
              style={{ ...card, marginTop: 8, display: "grid", gap: 14 }}
            >
              <div>
                <div style={{ fontSize: 12, color: mutedColor, marginBottom: 6 }}>
                  Current role
                </div>
                <div style={{ fontSize: 15, color: text, fontWeight: 500 }}>
                  {currentRoleLine ??
                    (isPersonalCareer
                      ? "Add a current role in My Experience to show a baseline here."
                      : "No job profile assigned in this workspace.")}
                </div>
              </div>

              <label style={labelStyle}>
                Next role
                <input
                  value={nextRole}
                  onChange={(e) => setNextRole(e.target.value)}
                  placeholder="e.g. Senior consultant"
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                Next role timeframe
                <input
                  value={nextRoleHorizon}
                  onChange={(e) => setNextRoleHorizon(e.target.value)}
                  placeholder="e.g. 1–2 years"
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                Future role
                <input
                  value={futureRole}
                  onChange={(e) => setFutureRole(e.target.value)}
                  placeholder="e.g. Practice lead"
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                Future role timeframe
                <input
                  value={futureRoleHorizon}
                  onChange={(e) => setFutureRoleHorizon(e.target.value)}
                  placeholder="e.g. 3–5 years"
                  style={inputStyle}
                />
              </label>
              <button
                type="submit"
                disabled={saving}
                style={{ ...btn, fontSize: 13, justifySelf: "start" }}
              >
                {saving ? "Saving…" : "Save vision"}
              </button>
            </form>
          </section>

          <section>
            <p style={{ ...sectionEyebrow, marginTop: 0 }}>Career notes</p>
            <form
              onSubmit={handleSaveNotes}
              style={{ ...card, marginTop: 8, display: "grid", gap: 12 }}
            >
              <label style={{ ...labelStyle, marginBottom: 4 }}>
                What career direction are you aiming for?
                <textarea
                  value={careerNotes}
                  onChange={(e) => setCareerNotes(e.target.value)}
                  rows={5}
                  placeholder="Direction, industries, motivations, trade-offs…"
                  style={{
                    ...inputStyle,
                    resize: "vertical" as const,
                    fontFamily: "inherit",
                    lineHeight: 1.5,
                  }}
                />
              </label>
              <button
                type="submit"
                disabled={saving}
                style={{ ...btn, fontSize: 13, justifySelf: "start" }}
              >
                {saving ? "Saving…" : "Save notes"}
              </button>
            </form>
          </section>

          <section>
            <p style={{ ...sectionEyebrow, marginTop: 0 }}>Career readiness</p>
            <div style={{ ...card, marginTop: 8 }}>
              <p style={{ margin: 0, fontSize: 14, color: mutedColor, lineHeight: 1.55 }}>
                {isPersonalCareer
                  ? "Individual accounts anchor readiness on your saved experience, projects, and profile — not on a workspace job profile."
                  : "Career insights will use your competencies and experience data."}
              </p>
              <ul
                style={{
                  margin: "12px 0 0",
                  paddingLeft: 18,
                  fontSize: 14,
                  color: text,
                  lineHeight: 1.6,
                }}
              >
                {isPersonalCareer ? (
                  <li>
                    Workspace role competencies:{" "}
                    <strong>not applicable</strong> until you join or select a
                    workspace with job profiles.
                  </li>
                ) : (
                  <li>
                    Role competencies in this workspace:{" "}
                    <strong>{readinessCompetencyCount}</strong>
                  </li>
                )}
                <li>
                  Work experience entries: <strong>{readinessExperienceCount}</strong>
                </li>
                {isPersonalCareer && personalEvidenceSnapshot ? (
                  <li>
                    Projects captured:{" "}
                    <strong>{personalEvidenceSnapshot.projectCount}</strong>
                  </li>
                ) : null}
              </ul>
            </div>
          </section>

          <section>
            <p style={{ ...sectionEyebrow, marginTop: 0 }}>
              Suggested Development Focus
            </p>
            <p
              style={{
                margin: "6px 0 0",
                fontSize: 13,
                color: mutedColor,
                lineHeight: 1.5,
              }}
            >
              {isPersonalCareer
                ? "Based on the target roles you enter above, these are structured practice areas to consider — the same catalogue as workspace mode, without automated scoring."
                : "Based on your target roles, these are likely areas to strengthen next."}
            </p>
            {isPersonalCareer ? (
              <p
                style={{
                  margin: "8px 0 0",
                  fontSize: 12,
                  color: mutedColor,
                  lineHeight: 1.5,
                }}
              >
                Add these catalogue focus areas to your personal Development Backlog
                for tracking.
              </p>
            ) : null}
            <div style={{ ...card, marginTop: 8, padding: "14px 16px" }}>
              {visibleSuggestedFocus.length === 0 ? (
                <p style={{ margin: 0, fontSize: 14, color: mutedColor, lineHeight: 1.55 }}>
                  Add target roles above (e.g. containing programme, portfolio, director,
                  manager, or lead) to see tailored focus suggestions.
                </p>
              ) : (
                <ul
                  style={{
                    listStyle: "none",
                    margin: 0,
                    padding: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  {visibleSuggestedFocus.map((item) => (
                    <li
                      key={item.id}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        padding: "12px 12px",
                        borderRadius: 8,
                        border: `1px solid ${borderSubtle}`,
                        backgroundColor: bg,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "center",
                          gap: 8,
                          justifyContent: "space-between",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 14,
                              fontWeight: 600,
                              color: text,
                              lineHeight: 1.35,
                            }}
                          >
                            {item.title}
                          </span>
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              textTransform: "uppercase",
                              letterSpacing: "0.04em",
                              padding: "3px 8px",
                              borderRadius: 6,
                              border: `1px solid ${borderSubtle}`,
                              color: mutedColor,
                              flexShrink: 0,
                            }}
                          >
                            Career-linked
                          </span>
                        </div>
                    {isPersonalCareer ? (() => {
                      const k = item.title.trim().toLowerCase();
                      const alreadyAdded = k.length > 0 && catalogueBacklogKeys.has(k);
                      const saving = catalogueSavingId === item.id;
                      return (
                        <button
                          type="button"
                          disabled={alreadyAdded || saving}
                          onClick={async () => {
                            if (alreadyAdded || saving) return;
                            setCatalogueSavingId(item.id);
                            setLoadError(null);
                            try {
                              // Duplicate prevention (V1): title match (case-insensitive), source=catalogue, personal only.
                              const { data, error } = await supabase
                                .from("development_focus_items")
                                .select("id,title")
                                .eq("user_id", userId ?? "")
                                .is("organisation_id", null)
                                .eq("source", "catalogue");
                              if (error) throw new Error(error.message);
                              const exists = ((data ?? []) as { title: string | null }[])
                                .some((r) => (r.title ?? "").trim().toLowerCase() === k);
                              if (exists) {
                                setCatalogueBacklogKeys((prev) => {
                                  const next = new Set(prev);
                                  next.add(k);
                                  return next;
                                });
                                return;
                              }

                              await addDevelopmentFocusItem({
                                organisation_id: null,
                                title: item.title,
                                description: item.explanation,
                                source: "catalogue",
                                related_signals: {},
                                status: "backlog",
                              });
                              setCatalogueBacklogKeys((prev) => {
                                const next = new Set(prev);
                                next.add(k);
                                return next;
                              });
                            } catch (e) {
                              setLoadError(
                                e instanceof Error
                                  ? e.message
                                  : "Could not add to backlog.",
                              );
                            } finally {
                              setCatalogueSavingId(null);
                            }
                          }}
                          style={{
                            ...btnGhost,
                            fontSize: 12,
                            padding: "6px 12px",
                            flexShrink: 0,
                            opacity: alreadyAdded ? 0.6 : 1,
                          }}
                        >
                          {alreadyAdded ? "Added" : saving ? "Adding…" : "Add to backlog"}
                        </button>
                      );
                    })() : (
                          <button
                            type="button"
                            disabled={
                              !!devFocusQueued[item.id] ||
                              savingFocusId === item.id
                            }
                            onClick={() =>
                              void handleSaveToDevelopmentBacklog(item)
                            }
                            style={{
                              ...btnGhost,
                              fontSize: 12,
                              padding: "6px 12px",
                              flexShrink: 0,
                            }}
                          >
                            {devFocusQueued[item.id]
                              ? "Saved to backlog"
                              : savingFocusId === item.id
                                ? "Saving…"
                                : "Save to Development Backlog"}
                          </button>
                        )}
                      </div>
                      <p
                        style={{
                          margin: 0,
                          fontSize: 13,
                          color: mutedColor,
                          lineHeight: 1.5,
                        }}
                      >
                        {item.explanation}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {isPersonalCareer &&
            suggestedFocus.length > 0 &&
            catalogueBacklogKeys.size > 0 ? (
              <button
                type="button"
                onClick={() => setShowAddedCatalogueFocus((v) => !v)}
                style={{
                  ...btnGhost,
                  fontSize: 12,
                  padding: "6px 10px",
                  marginTop: 10,
                  justifySelf: "start",
                }}
              >
                {showAddedCatalogueFocus ? "Hide added items" : "Show added items"}
              </button>
            ) : null}

            {careerCoachResult ? (
              <div
                style={{
                  ...card,
                  marginTop: 12,
                  borderStyle: "dashed",
                  borderColor: borderSubtle,
                }}
              >
                <p
                  style={{
                    margin: 0,
                    fontSize: 13,
                    color: text,
                    lineHeight: 1.5,
                  }}
                >
                  {careerCoachResult}
                </p>
                <p
                  style={{
                    margin: "8px 0 0",
                    fontSize: 12,
                    color: mutedColor,
                    lineHeight: 1.5,
                  }}
                >
                  View them in <strong style={{ color: text }}>My Development</strong>{" "}
                  under Backlog.
                </p>
              </div>
            ) : null}
          </section>
        </div>
      </div>

      {isPersonalCareer ? (
        <CareerCoachModal
          open={careerCoachOpen}
          onClose={() => setCareerCoachOpen(false)}
          context={careerCoachContext}
          contextLabel={currentRoleLine ?? "Personal career"}
          applyModeLabel="your personal focus list for review"
          onApplySuggestions={applyCareerCoachAreas}
        />
      ) : null}
    </div>
  );
}
