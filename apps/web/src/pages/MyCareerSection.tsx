import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "../lib/supabase";
import type { UserCareerPlanRow } from "./hub/types";
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

type Props = {
  activeOrgId: string | null;
  isActive: boolean;
};

export function MyCareerSection({ activeOrgId, isActive }: Props) {
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

  const suggestedFocus = useMemo(
    () => getSuggestedDevelopmentFocus(nextRole, futureRole),
    [nextRole, futureRole]
  );

  const loadData = useCallback(async () => {
    if (!isActive || !activeOrgId) {
      setLoading(false);
      return;
    }

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
  }, [isActive, activeOrgId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function persistCareerPlan() {
    if (!userId || !activeOrgId) return;

    setSaving(true);
    setLoadError(null);

    const payload = {
      user_id: userId,
      organisation_id: activeOrgId,
      next_role: nextRole.trim() || null,
      next_role_horizon: nextRoleHorizon.trim() || null,
      future_role: futureRole.trim() || null,
      future_role_horizon: futureRoleHorizon.trim() || null,
      career_notes: careerNotes.trim() || null,
      updated_at: new Date().toISOString(),
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
    if (!userId || !activeOrgId) return;
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

  if (!activeOrgId) {
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
    <div
      style={{
        maxWidth: 720,
        display: "flex",
        flexDirection: "column",
        gap: 22,
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
          Plan your next career moves and longer-term growth.
        </p>
      </header>

      {loadError ? (
        <p style={{ margin: 0, fontSize: 14, color: errorColor }}>{loadError}</p>
      ) : null}

      <section>
        <p style={{ ...sectionEyebrow, marginTop: 0 }}>Career vision</p>
        <form
          onSubmit={handleSaveVision}
          style={{ ...card, marginTop: 8, display: "grid", gap: 14 }}
        >
          <div>
            <div style={{ fontSize: 12, color: mutedColor, marginBottom: 6 }}>
              Current role
            </div>
            <div style={{ fontSize: 15, color: text, fontWeight: 500 }}>
              {currentRoleLine ?? "No job profile assigned in this workspace."}
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
          <button type="submit" disabled={saving} style={{ ...btn, fontSize: 13, justifySelf: "start" }}>
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
          <button type="submit" disabled={saving} style={{ ...btn, fontSize: 13, justifySelf: "start" }}>
            {saving ? "Saving…" : "Save notes"}
          </button>
        </form>
      </section>

      <section>
        <p style={{ ...sectionEyebrow, marginTop: 0 }}>Career readiness</p>
        <div style={{ ...card, marginTop: 8 }}>
          <p style={{ margin: 0, fontSize: 14, color: mutedColor, lineHeight: 1.55 }}>
            Career insights will use your competencies and experience data.
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
            <li>
              Role competencies in this workspace:{" "}
              <strong>{readinessCompetencyCount}</strong>
            </li>
            <li>
              Work experience entries: <strong>{readinessExperienceCount}</strong>
            </li>
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
          Based on your target roles, these are likely areas to strengthen next.
        </p>
        <div style={{ ...card, marginTop: 8, padding: "14px 16px" }}>
          {suggestedFocus.length === 0 ? (
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
              {suggestedFocus.map((item) => (
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
                    <button
                      type="button"
                      disabled={
                        !!devFocusQueued[item.id] || savingFocusId === item.id
                      }
                      onClick={() => void handleSaveToDevelopmentBacklog(item)}
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
      </section>
    </div>
  );
}
