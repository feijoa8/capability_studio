import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  border,
  btnGhost,
  btnPrimary,
  errorColor,
  fieldBg,
  mutedColor,
  surface,
  text,
} from "../hub/hubTheme";
import { AddCandidateModal } from "./AddCandidateModal";
import { CreateRoleModal } from "./CreateRoleModal";
import { EvaluateCandidateModal } from "./EvaluateCandidateModal";
import { HiringCandidateExpandPanel } from "./HiringCandidateExpandPanel";
import { InternalHiringApplicationModal } from "./InternalHiringApplicationModal";
import {
  coverLetterEditableForCandidateStage,
  fetchApplicationsForOpening,
  fetchHiringOpening,
  fetchManagedHiringForOpening,
  hiringCandidateDisplayName,
  hiringCandidateEmailLine,
  KANBAN_STAGES,
  resolveJobProfileTitle,
  STAGE_LABEL,
  type HiringApplicationRow,
  type HiringApplicationStage,
  type HiringOpeningRow,
} from "./hiringApi";
import type { GenerateRejectionFeedbackInput } from "./generateRejectionFeedback";
import { inferReachedInterviewStage } from "./rejectionFeedbackStage";
import { fetchJobProfilePreviewData } from "./jobProfilePreview";
import { parseEvaluationSnapshot, resolveFitIndicator } from "./hiringEvaluationDisplay";
import { firstRecommendedLabel } from "./hiringRecommendedActions";
import { RejectCandidateModal } from "./RejectCandidateModal";
import { HiringViewCvLink } from "./HiringViewCvLink";

type ProfileMini = {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

function displayName(p: ProfileMini): string {
  const dn = p.display_name?.trim();
  if (dn) return dn;
  const fn = (p.first_name ?? "").trim();
  const ln = (p.last_name ?? "").trim();
  const c = [fn, ln].filter(Boolean).join(" ");
  if (c) return c;
  return p.email?.trim() || "Member";
}

type Props = {
  organisationId: string;
  openingId: string;
  onBack: () => void;
};

/**
 * Loading hierarchy (Hiring role + candidate board):
 * - `loading` — page-level: initial open / openingId+org change only (`load()` without silent).
 * - `sectionRefreshing` — section-level: silent refetch after evaluate / stage change / add candidate (`load({ silent: true })`).
 * - `actionLoadingId` — action-level: per-row stage mutation in flight. Evaluate uses modal-local `loading` only; the Evaluate button is disabled while that modal is open for the same row.
 * - EvaluateCandidateModal — modal-level loading only; never touches `loading` / `sectionRefreshing`.
 */
const INITIAL_EXPAND: Record<HiringApplicationStage, string | null> = {
  applied: null,
  reviewed: null,
  shortlisted: null,
  interview: null,
  offer: null,
  hired: null,
  rejected: null,
  withdrawn: null,
};

function HiringFitBadge({ row }: { row: HiringApplicationRow }) {
  const fit = resolveFitIndicator(row);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexShrink: 0,
        textAlign: "right",
      }}
      aria-label={fit.label}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          background: fit.dotColor,
          boxShadow: "0 0 0 1px rgba(0,0,0,0.35)",
        }}
      />
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: fit.labelColor,
          lineHeight: 1.2,
          whiteSpace: "nowrap",
        }}
      >
        {fit.label}
      </span>
    </div>
  );
}

export function HiringRoleDetail({ organisationId, openingId, onBack }: Props) {
  const [opening, setOpening] = useState<HiringOpeningRow | null>(null);
  const [jpTitle, setJpTitle] = useState<string | null>(null);
  const [applications, setApplications] = useState<HiringApplicationRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileMini>>({});
  const [jobTitleByUser, setJobTitleByUser] = useState<Record<string, string | null>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [sectionRefreshing, setSectionRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [expandedByStage, setExpandedByStage] = useState<
    Record<HiringApplicationStage, string | null>
  >(() => ({ ...INITIAL_EXPAND }));
  const [evaluateTarget, setEvaluateTarget] = useState<{
    applicationId: string;
    userId: string;
    name: string;
    stage: HiringApplicationStage;
    cvExtractSnapshot: Record<string, unknown> | null;
  } | null>(null);
  const [ownershipProfiles, setOwnershipProfiles] = useState<
    Record<string, ProfileMini>
  >({});
  const [editRoleOpen, setEditRoleOpen] = useState(false);
  const [managedHiring, setManagedHiring] = useState<
    Awaited<ReturnType<typeof fetchManagedHiringForOpening>>
  >(null);
  const [orgCareersSlug, setOrgCareersSlug] = useState<string | null>(null);
  const [rejectOutcomeAppId, setRejectOutcomeAppId] = useState<string | null>(null);
  const [rejectModalJobReqs, setRejectModalJobReqs] = useState<string[]>([]);
  const [outcomeToast, setOutcomeToast] = useState<string | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [internalApplyOpen, setInternalApplyOpen] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSessionUserId(data.session?.user?.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSessionUserId(session?.user?.id ?? null);
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!outcomeToast) return;
    const t = window.setTimeout(() => setOutcomeToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [outcomeToast]);

  useEffect(() => {
    let cancelled = false;
    void supabase
      .from("organisations")
      .select("public_slug")
      .eq("id", organisationId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const s = (data as { public_slug?: string | null } | null)?.public_slug?.trim();
        setOrgCareersSlug(s && s.length > 0 ? s : null);
      });
    return () => {
      cancelled = true;
    };
  }, [organisationId]);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    setLoadError(null);
    if (silent) setSectionRefreshing(true);
    else setLoading(true);
    try {
      const op = await fetchHiringOpening(supabase, openingId);
      if (!op || op.organisation_id !== organisationId) {
        setOpening(null);
        setLoadError("Role not found.");
        return;
      }
      setOpening(op);
      setJpTitle(await resolveJobProfileTitle(supabase, op.job_profile_id));
      setManagedHiring(
        (await fetchManagedHiringForOpening(supabase, openingId)) ?? null,
      );

      const ownerIds = [op.hiring_manager_user_id, op.hiring_lead_user_id].filter(
        (x): x is string => Boolean(x),
      );
      if (ownerIds.length > 0) {
        const { data: oProfs } = await supabase
          .from("profiles")
          .select("id, display_name, first_name, last_name, email")
          .in("id", ownerIds);
        const opMap: Record<string, ProfileMini> = {};
        for (const r of oProfs ?? []) {
          const row = r as ProfileMini;
          opMap[row.id] = row;
        }
        setOwnershipProfiles(opMap);
      } else {
        setOwnershipProfiles({});
      }

      const apps = await fetchApplicationsForOpening(supabase, openingId);
      setApplications(apps);

      const uids = [...new Set(apps.map((a) => a.candidate_user_id))];
      if (uids.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, display_name, first_name, last_name, email")
          .in("id", uids);
        const pmap: Record<string, ProfileMini> = {};
        for (const r of profs ?? []) {
          const row = r as ProfileMini;
          pmap[row.id] = row;
        }
        setProfiles(pmap);

        const { data: ujp } = await supabase
          .from("user_job_profiles")
          .select("user_id, job_profile_id")
          .eq("organisation_id", organisationId)
          .in("user_id", uids);

        const jpIds = [
          ...new Set(
            (ujp ?? [])
              .map((x) => (x as { job_profile_id: string | null }).job_profile_id)
              .filter((id): id is string => Boolean(id)),
          ),
        ];
        const titles: Record<string, string> = {};
        if (jpIds.length > 0) {
          const { data: jps } = await supabase
            .from("job_profiles")
            .select("id, title")
            .in("id", jpIds);
          for (const j of jps ?? []) {
            const row = j as { id: string; title: string };
            titles[row.id] = row.title;
          }
        }
        const jt: Record<string, string | null> = {};
        for (const raw of ujp ?? []) {
          const r = raw as { user_id: string; job_profile_id: string | null };
          if (r.job_profile_id && titles[r.job_profile_id]) {
            jt[r.user_id] = titles[r.job_profile_id];
          }
        }
        setJobTitleByUser(jt);
      } else {
        setProfiles({});
        setJobTitleByUser({});
      }
    } catch (e) {
      console.warn("HiringRoleDetail load:", e);
      setOpening(null);
      setLoadError("Could not load this role.");
    } finally {
      if (!silent) setLoading(false);
      if (silent) setSectionRefreshing(false);
    }
  }, [openingId, organisationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!rejectOutcomeAppId || !opening?.job_profile_id) {
      setRejectModalJobReqs([]);
      return;
    }
    let cancelled = false;
    void fetchJobProfilePreviewData(supabase, opening.job_profile_id).then((d) => {
      if (!cancelled) setRejectModalJobReqs(d?.requirements ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [rejectOutcomeAppId, opening?.job_profile_id]);

  const existingCandidateIds = useMemo(
    () => new Set(applications.map((a) => a.candidate_user_id)),
    [applications],
  );

  const myInternalApplication = useMemo(() => {
    if (!sessionUserId) return null;
    return (
      applications.find(
        (a) =>
          a.candidate_user_id === sessionUserId &&
          a.candidate_source === "internal",
      ) ?? null
    );
  }, [applications, sessionUserId]);

  const canSelfApplyToOpenRole = Boolean(
    opening &&
      opening.status === "open" &&
      sessionUserId &&
      !existingCandidateIds.has(sessionUserId),
  );

  const canEditOwnCoverLetter = Boolean(
    myInternalApplication &&
      coverLetterEditableForCandidateStage(myInternalApplication.stage),
  );

  const rejectOutcomeRow = useMemo(
    () => applications.find((a) => a.id === rejectOutcomeAppId) ?? null,
    [applications, rejectOutcomeAppId],
  );

  const roleTitle =
    opening?.title?.trim() ||
    jpTitle ||
    "Hiring role";

  const rejectFeedbackGeneration = useMemo((): GenerateRejectionFeedbackInput | null => {
    if (!rejectOutcomeRow) return null;
    const snap = parseEvaluationSnapshot(rejectOutcomeRow.evaluation_snapshot);
    const strengths = snap.strengths ?? [];
    const gaps = [...(snap.gaps ?? []), ...(snap.partialCoverage ?? [])].slice(0, 8);
    const hasEvaluationSignals = Boolean(
      rejectOutcomeRow.evaluation_summary?.trim() ||
        strengths.length > 0 ||
        gaps.length > 0,
    );
    return {
      stage: rejectOutcomeRow.stage,
      hasEvaluationSignals,
      reachedInterviewStage: inferReachedInterviewStage(rejectOutcomeRow),
      evaluationSummary: rejectOutcomeRow.evaluation_summary ?? null,
      strengths,
      gaps,
      jobProfileRequirements: rejectModalJobReqs,
      roleTitle,
    };
  }, [rejectOutcomeRow, rejectModalJobReqs, roleTitle]);

  function ownerDisplayName(userId: string | null | undefined): string {
    if (!userId) return "—";
    const p = ownershipProfiles[userId];
    return p ? displayName(p) : "—";
  }

  const byStage = useMemo(() => {
    const m: Record<HiringApplicationStage, HiringApplicationRow[]> = {
      applied: [],
      reviewed: [],
      shortlisted: [],
      interview: [],
      offer: [],
      hired: [],
      rejected: [],
      withdrawn: [],
    };
    for (const a of applications) {
      const st = a.stage as HiringApplicationStage;
      if (m[st]) m[st].push(a);
    }
    return m;
  }, [applications]);

  async function setStage(
    appId: string,
    stage: HiringApplicationStage,
  ): Promise<boolean> {
    setActionLoadingId(appId);
    try {
      const { error: err } = await supabase
        .from("hiring_applications")
        .update({ stage })
        .eq("id", appId);
      if (err) {
        console.warn("hiring_applications update:", err.message);
        return false;
      }
      await load({ silent: true });
      return true;
    } finally {
      setActionLoadingId(null);
    }
  }

  function toggleExpand(stage: HiringApplicationStage, applicationId: string) {
    setExpandedByStage((prev) => ({
      ...prev,
      [stage]: prev[stage] === applicationId ? null : applicationId,
    }));
  }

  function renderCandidateBlock(
    stage: HiringApplicationStage,
    row: HiringApplicationRow,
  ) {
    const p = profiles[row.candidate_user_id];
    const name = hiringCandidateDisplayName(row, p);
    const email = hiringCandidateEmailLine(row, p);
    const jt = jobTitleByUser[row.candidate_user_id] ?? null;
    const rowStageActionLoading = actionLoadingId === row.id;
    const isEvaluateModalForRow = evaluateTarget?.applicationId === row.id;
    const canEvaluate =
      Boolean(opening?.job_profile_id) &&
      row.stage !== "withdrawn" &&
      row.stage !== "rejected";
    const expanded = expandedByStage[stage] === row.id;
    const hasEvaluation = Boolean(
      row.evaluation_updated_at ||
        (typeof row.evaluation_summary === "string" && row.evaluation_summary.trim()) ||
        row.evaluation_score != null,
    );
    const rejectedNeedsOutcome =
      row.stage === "rejected" &&
      (row.outcome_sent_at == null || row.outcome_sent_at === "");
    const rejectedOutcomeSent = row.stage === "rejected" && Boolean(row.outcome_sent_at);

    return (
      <div
        key={row.id}
        style={{ marginBottom: 12 }}
        data-hiring-eval={hasEvaluation ? "1" : "0"}
      >
        <div
          style={{
            borderRadius: expanded ? "8px 8px 0 0" : 8,
            border: `1px solid ${
              expanded ? "rgba(59, 130, 246, 0.5)" : border
            }`,
            background: fieldBg,
            overflow: "hidden",
          }}
        >
          <div
            role="button"
            tabIndex={0}
            onClick={() => toggleExpand(stage, row.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleExpand(stage, row.id);
              }
            }}
            style={{
              padding: "12px 12px 8px",
              cursor: "pointer",
              outline: "none",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 8,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    color: text,
                    fontSize: 14,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  {name}
                  {row.candidate_source === "external" ? (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        color: "#8eb8e8",
                        border: `1px solid ${border}`,
                        borderRadius: 4,
                        padding: "2px 6px",
                      }}
                    >
                      External
                    </span>
                  ) : null}
                </div>
                <div style={{ fontSize: 12, color: mutedColor, marginTop: 4 }}>
                  {email}
                </div>
              </div>
              <HiringFitBadge row={row} />
            </div>
            {jt ? (
              <div style={{ fontSize: 12, color: text, marginTop: 6 }}>
                Job: {jt}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: mutedColor, marginTop: 6 }}>
                Job profile (org): —
              </div>
            )}
            {hasEvaluation && firstRecommendedLabel(row) ? (
              <div
                style={{
                  fontSize: 11,
                  color: mutedColor,
                  marginTop: 6,
                  lineHeight: 1.35,
                }}
              >
                Next recommended: {firstRecommendedLabel(row)}
              </div>
            ) : null}
          </div>

          <div style={{ padding: "0 12px 12px" }} onClick={(e) => e.stopPropagation()}>
            <HiringViewCvLink row={row} variant="card" />
            {rejectedNeedsOutcome ? (
              <button
                type="button"
                style={{
                  ...btnPrimary,
                  marginTop: 8,
                  fontSize: 13,
                  width: "100%",
                }}
                disabled={rowStageActionLoading}
                onClick={() => setRejectOutcomeAppId(row.id)}
              >
                Provide feedback & notify
              </button>
            ) : null}
            {rejectedOutcomeSent ? (
              <p
                style={{
                  margin: "8px 0 0",
                  fontSize: 12,
                  color: mutedColor,
                  lineHeight: 1.4,
                }}
              >
                Rejected — candidate notified
              </p>
            ) : null}
            <button
              type="button"
              style={{
                ...btnPrimary,
                marginTop: 6,
                fontSize: 13,
                width: "100%",
              }}
              disabled={
                rowStageActionLoading || !canEvaluate || isEvaluateModalForRow
              }
              title={
                canEvaluate
                  ? "Full evaluation (saved to this application)"
                  : "This role needs a job profile to run evaluation"
              }
              onClick={() =>
                setEvaluateTarget({
                  applicationId: row.id,
                  userId: row.candidate_user_id,
                  name,
                  stage: row.stage,
                  cvExtractSnapshot: row.cv_extract_snapshot ?? null,
                })
              }
            >
              {hasEvaluation ? "Re-evaluate" : "Evaluate"}
            </button>
            <div
              style={{
                marginTop: 10,
                paddingTop: 10,
                borderTop: `1px dashed ${border}`,
              }}
            >
              <label
                style={{
                  display: "block",
                  fontSize: 10,
                  color: mutedColor,
                  marginBottom: 6,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                Adjust stage
              </label>
              <select
                disabled={rowStageActionLoading}
                value={row.stage}
                onChange={(e) =>
                  void setStage(row.id, e.target.value as HiringApplicationStage)
                }
                style={{
                  padding: "5px 8px",
                  borderRadius: 6,
                  border: `1px solid ${border}`,
                  background: surface,
                  color: mutedColor,
                  fontSize: 11,
                  maxWidth: "100%",
                  opacity: 0.92,
                }}
              >
                {(Object.keys(STAGE_LABEL) as HiringApplicationStage[]).map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {expanded ? (
          <HiringCandidateExpandPanel
            row={row}
            jobProfileId={opening?.job_profile_id ?? null}
            onReevaluate={() =>
              setEvaluateTarget({
                applicationId: row.id,
                userId: row.candidate_user_id,
                name,
                stage: row.stage,
                cvExtractSnapshot: row.cv_extract_snapshot ?? null,
              })
            }
            onStageChange={(s) => void setStage(row.id, s)}
            actionLoading={rowStageActionLoading}
          />
        ) : null}
      </div>
    );
  }

  if (loading) {
    return (
      <p style={{ color: mutedColor, marginTop: 0 }}>Loading…</p>
    );
  }

  if (loadError || !opening) {
    return (
      <div>
        <button type="button" style={btnGhost} onClick={onBack}>
          ← Back
        </button>
        <p style={{ color: errorColor }}>{loadError ?? "Not found."}</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1400 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 20,
        }}
      >
        <div>
          <button type="button" style={{ ...btnGhost, marginBottom: 10 }} onClick={onBack}>
            ← All roles
          </button>
          <h2
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 600,
              color: text,
              letterSpacing: "-0.02em",
            }}
          >
            {roleTitle}
          </h2>
          {managedHiring ? (
            <p style={{ margin: "8px 0 0", fontSize: 12, color: mutedColor, lineHeight: 1.45 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: "#8eb8e8",
                }}
              >
                Managed
              </span>{" "}
              for <strong style={{ color: text }}>{managedHiring.clientOrgName}</strong>
              {managedHiring.role.is_anonymous
                ? " (anonymous in external-facing copy where supported)"
                : null}
              {!managedHiring.role.is_anonymous && managedHiring.role.public_name?.trim() ? (
                <>
                  {" "}
                  · Public label: {managedHiring.role.public_name.trim()}
                </>
              ) : null}
            </p>
          ) : null}
          <p style={{ margin: "8px 0 0", fontSize: 13, color: mutedColor }}>
            Status:{" "}
            <strong style={{ color: text }}>{opening.status}</strong>
            {jpTitle ? (
              <>
                {" "}
                · Job profile: <strong style={{ color: text }}>{jpTitle}</strong>
              </>
            ) : null}
          </p>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: mutedColor }}>
            Hiring Manager:{" "}
            <strong style={{ color: text }}>
              {ownerDisplayName(opening.hiring_manager_user_id)}
            </strong>
            {" · "}
            Hiring Lead:{" "}
            <strong style={{ color: text }}>
              {opening.hiring_lead_user_id
                ? ownerDisplayName(opening.hiring_lead_user_id)
                : "—"}
            </strong>
          </p>
          {opening.visibility === "public_hosted" &&
          orgCareersSlug &&
          opening.public_slug?.trim() ? (
            <p style={{ margin: "8px 0 0", fontSize: 12, color: mutedColor }}>
              Public listing:{" "}
              <a
                href={`/careers/${encodeURIComponent(orgCareersSlug)}/${encodeURIComponent(opening.public_slug.trim())}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: "#8eb8e8" }}
              >
                Open hosted page
              </a>
            </p>
          ) : null}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <button type="button" style={btnGhost} onClick={() => setEditRoleOpen(true)}>
            Edit role
          </button>
          {canSelfApplyToOpenRole ? (
            <button
              type="button"
              style={btnPrimary}
              onClick={() => setInternalApplyOpen(true)}
            >
              Apply to this role
            </button>
          ) : null}
          {myInternalApplication && canEditOwnCoverLetter ? (
            <button
              type="button"
              style={btnGhost}
              onClick={() => setInternalApplyOpen(true)}
            >
              {myInternalApplication.cover_letter_text?.trim()
                ? "Update cover letter"
                : "Add cover letter"}
            </button>
          ) : null}
          <button type="button" style={btnPrimary} onClick={() => setAddOpen(true)}>
            Add internal candidate
          </button>
        </div>
      </div>

      {outcomeToast ? (
        <p
          style={{
            margin: "0 0 12px",
            padding: "10px 14px",
            fontSize: 13,
            color: "#c4f542",
            background: "rgba(196, 245, 66, 0.08)",
            border: "1px solid rgba(196, 245, 66, 0.35)",
            borderRadius: 8,
          }}
          role="status"
        >
          {outcomeToast}
        </p>
      ) : null}

      {sectionRefreshing ? (
        <p
          style={{
            margin: "0 0 12px",
            fontSize: 12,
            color: mutedColor,
          }}
        >
          Updating board…
        </p>
      ) : null}

      <div
        style={{
          overflowX: "auto",
          paddingBottom: 8,
        }}
      >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6, minmax(160px, 1fr))",
          gap: 12,
          alignItems: "start",
          minWidth: 960,
        }}
      >
        {KANBAN_STAGES.map((stage) => (
          <div key={stage}>
            <p
              style={{
                margin: "0 0 10px",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: mutedColor,
              }}
            >
              {STAGE_LABEL[stage]}{" "}
              <span style={{ fontWeight: 500, opacity: 0.85 }}>
                ({byStage[stage].length})
              </span>
            </p>
            <div>
              {byStage[stage].map((row) => renderCandidateBlock(stage, row))}
            </div>
          </div>
        ))}
      </div>
      </div>

      {byStage.rejected.length > 0 ? (
        <div style={{ marginTop: 28 }}>
          <p
            style={{
              margin: "0 0 10px",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: mutedColor,
            }}
          >
            Rejected{" "}
            <span style={{ fontWeight: 500, opacity: 0.85 }}>
              ({byStage.rejected.length})
            </span>
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: 10,
            }}
          >
            {byStage.rejected.map((row) => renderCandidateBlock("rejected", row))}
          </div>
        </div>
      ) : null}

      {byStage.withdrawn.length > 0 ? (
        <div style={{ marginTop: 28 }}>
          <p
            style={{
              margin: "0 0 10px",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: mutedColor,
            }}
          >
            Withdrawn by candidate{" "}
            <span style={{ fontWeight: 500, opacity: 0.85 }}>
              ({byStage.withdrawn.length})
            </span>
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: 10,
            }}
          >
            {byStage.withdrawn.map((row) =>
              renderCandidateBlock("withdrawn", row),
            )}
          </div>
        </div>
      ) : null}

      <InternalHiringApplicationModal
        open={internalApplyOpen}
        onClose={() => setInternalApplyOpen(false)}
        openingId={openingId}
        roleTitle={roleTitle}
        hasJobProfile={Boolean(opening.job_profile_id)}
        userId={sessionUserId ?? ""}
        existingApplication={myInternalApplication}
        onSuccess={() => void load({ silent: true })}
      />

      <AddCandidateModal
        open={addOpen}
        organisationId={organisationId}
        openingId={openingId}
        existingCandidateIds={existingCandidateIds}
        onClose={() => setAddOpen(false)}
        onAdded={() => void load({ silent: true })}
      />

      <CreateRoleModal
        open={editRoleOpen}
        organisationId={organisationId}
        openingToEdit={opening}
        onClose={() => setEditRoleOpen(false)}
        onCreated={() => {
          setEditRoleOpen(false);
          void load({ silent: true });
        }}
      />

      <EvaluateCandidateModal
        open={evaluateTarget != null}
        organisationId={organisationId}
        jobProfileId={opening.job_profile_id}
        candidateUserId={evaluateTarget?.userId ?? null}
        candidateName={evaluateTarget?.name ?? ""}
        applicationId={evaluateTarget?.applicationId ?? null}
        cvExtractSnapshot={evaluateTarget?.cvExtractSnapshot ?? null}
        currentStage={evaluateTarget?.stage ?? null}
        onEvaluationSaved={() => void load({ silent: true })}
        onShortlist={
          evaluateTarget
            ? async () => {
                const ok = await setStage(evaluateTarget.applicationId, "shortlisted");
                if (ok) setEvaluateTarget(null);
              }
            : undefined
        }
        onReject={
          evaluateTarget
            ? async () => {
                const ok = await setStage(evaluateTarget.applicationId, "rejected");
                if (ok) setEvaluateTarget(null);
              }
            : undefined
        }
        onClose={() => setEvaluateTarget(null)}
      />

      <RejectCandidateModal
        open={rejectOutcomeAppId != null}
        client={supabase}
        applicationId={rejectOutcomeAppId}
        cvExtractSnapshot={rejectOutcomeRow?.cv_extract_snapshot ?? null}
        feedbackGeneration={rejectFeedbackGeneration}
        onClose={() => setRejectOutcomeAppId(null)}
        onSent={() => {
          setOutcomeToast("Outcome sent to candidate.");
          void load({ silent: true });
        }}
      />
    </div>
  );
}
