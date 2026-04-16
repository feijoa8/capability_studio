import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./MyExperienceSection.module.css";
import type { FormEvent } from "react";
import { supabase } from "../lib/supabase";
import {
  certificationRenewalStatus,
  certificationStatusLabel,
  sortCertificationsByRenewalUrgency,
} from "./hub/certificationStatus";
import type {
  UserCertificationRow,
  UserExperienceProject,
  UserExperienceRow,
  UserQualificationRow,
  WorkspaceMembership,
} from "./hub/types";
import {
  CurrentCvReference,
  type StoredCvRow,
} from "./CurrentCvReference";
import { CvImportFlow } from "./CvImportFlow";
import {
  WorkExperienceRefinerModal,
  type RefinementSuggestionPayload,
} from "./hub/contextualRefinement";
import { SkillTagInput } from "./hub/SkillTagInput";
import {
  aggregateIndustriesFromEvidence,
  aggregateMethodsFromEvidence,
  aggregateSkillsFromEvidence,
  aggregateToolsFromEvidence,
  buildIndustryEvidenceDetails,
  buildMethodEvidenceDetails,
  buildSkillEvidenceDetails,
  buildToolEvidenceDetails,
  type EvidenceTagDetail,
  PERSONAL_EVIDENCE_SKILL_TOP_N,
} from "./hub/personalEvidenceDerivation";
import { dedupeSkillsNormalized, normalizeSkillLabel } from "./hub/skillNormalization";
import {
  accent,
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
  surfaceHover,
  text,
} from "./hub/hubTheme";

/** Stable empty array for refiner `relatedProjects` when a role has no projects (avoids refetch loops). */
const EMPTY_RELATED_PROJECTS: UserExperienceProject[] = [];

type Props = {
  activeOrgId: string | null;
  /** Effective membership for `activeOrgId` from shell (`pickEffectiveMembershipForOrganisation`). */
  activeWorkspaceMembership: WorkspaceMembership | undefined;
  isActive: boolean;
  /** Bumped from profile (e.g. after CV import) to reload experience rows without switching tabs. */
  reloadToken?: number;
  /** From `profiles.primary_account_type` (shell); used to allow My Experience without a workspace. */
  primaryAccountType: string | null;
  /** False until header/shell has loaded profile — avoids flashing the workspace-only blocker. */
  primaryAccountTypeReady: boolean;
};

type EvidenceTagListField = "skills" | "methods" | "tools";

type EvidenceTagCategoryTab = "skills" | "methods" | "tools" | "industries";

/** Tabbed chip grid + optional “where” provenance (read-only). */
function EvidenceTagChipPanel(props: {
  rows: { label: string; count: number }[];
  details: Map<string, EvidenceTagDetail>;
  expandedKey: string | null;
  onToggleKey: (key: string | null) => void;
  onRevealRole: (experienceId: string) => void;
  /** Normalized map key for `details` (skills/methods/tools vs industry). */
  detailKeyForLabel: (label: string) => string;
  emptyHint: string;
  whereBlurb: string;
}) {
  const {
    rows,
    details,
    expandedKey,
    onToggleKey,
    onRevealRole,
    detailKeyForLabel,
    emptyHint,
    whereBlurb,
  } = props;

  if (rows.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: 12, color: mutedColor, lineHeight: 1.5 }}>
        {emptyHint}
      </p>
    );
  }

  const expandedDetail =
    expandedKey != null ? details.get(expandedKey) : undefined;

  return (
    <div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "flex-start",
        }}
      >
        {rows.map((s) => {
          const sk = detailKeyForLabel(s.label);
          const detail = details.get(sk);
          const open = expandedKey === sk;
          const whereLen = detail?.where?.length ?? 0;
          const count = detail?.mentionCount ?? s.count;
          const tooltip =
            whereLen > 0
              ? (detail?.where ?? [])
                  .slice(0, 2)
                  .map((w) => w.caption)
                  .join(" · ")
              : undefined;
          const chipShell = {
            display: "inline-flex" as const,
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap" as const,
            maxWidth: "100%" as const,
            padding: "6px 10px",
            borderRadius: 999,
            border: `1px solid ${
              whereLen > 0 && open
                ? "rgba(110, 176, 240, 0.45)"
                : borderSubtle
            }`,
            backgroundColor:
              whereLen > 0 ? (open ? surfaceHover : surface) : bg,
            color: text,
            fontSize: 12,
            fontWeight: 500,
            lineHeight: 1.35,
            transition: "background-color 0.15s ease, border-color 0.15s ease",
          };

          return (
            <div
              key={s.label}
              style={{
                display: "inline-flex",
                flexDirection: "column",
                alignItems: "stretch",
                maxWidth: "100%",
              }}
            >
              {whereLen > 0 ? (
                <button
                  type="button"
                  title={tooltip}
                  aria-expanded={open}
                  onClick={() => onToggleKey(open ? null : sk)}
                  style={{
                    ...chipShell,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span
                    style={{
                      wordBreak: "break-word",
                      minWidth: 0,
                    }}
                  >
                    {s.label}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "2px 7px",
                      borderRadius: 999,
                      backgroundColor: bg,
                      border: `1px solid ${borderSubtle}`,
                      color: mutedColor,
                      flexShrink: 0,
                    }}
                  >
                    {count}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: mutedColor,
                      flexShrink: 0,
                    }}
                  >
                    {open ? "Hide" : "Where"}
                  </span>
                </button>
              ) : (
                <span
                  style={{
                    ...chipShell,
                    cursor: "default",
                  }}
                >
                  <span
                    style={{
                      wordBreak: "break-word",
                      minWidth: 0,
                    }}
                  >
                    {s.label}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "2px 7px",
                      borderRadius: 999,
                      backgroundColor: bg,
                      border: `1px solid ${borderSubtle}`,
                      color: mutedColor,
                      flexShrink: 0,
                    }}
                  >
                    {count}
                  </span>
                </span>
              )}
            </div>
          );
        })}
      </div>
      {expandedDetail &&
      expandedKey != null &&
      (expandedDetail.where?.length ?? 0) > 0 ? (
        <div
          style={{
            marginTop: 12,
            padding: "10px 12px",
            borderRadius: 8,
            border: `1px solid ${borderSubtle}`,
            backgroundColor: bg,
          }}
          className={styles.evidenceTagWherePanel}
        >
          <p
            style={{
              margin: "0 0 8px",
              fontSize: 11,
              color: mutedColor,
              lineHeight: 1.4,
            }}
          >
            {whereBlurb}
          </p>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {expandedDetail.where!.map((w) => (
              <button
                key={`${w.kind}-${w.experienceId}-${w.projectId ?? ""}`}
                type="button"
                onClick={() => onRevealRole(w.experienceId)}
                style={{
                  ...btnGhost,
                  fontSize: 12,
                  padding: "6px 10px",
                  textAlign: "left",
                  width: "100%",
                  justifyContent: "flex-start",
                }}
              >
                <span style={{ color: mutedColor, marginRight: 6 }}>
                  {w.kind === "project" ? "Project" : "Role"}
                </span>
                {w.caption}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buildTagSuggestionPool(
  experienceRows: UserExperienceRow[],
  projectRows: UserExperienceProject[],
  field: EvidenceTagListField
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const pull = (row: UserExperienceRow | UserExperienceProject) => {
    const v = row[field];
    return Array.isArray(v) ? v : [];
  };
  for (const e of experienceRows) {
    for (const t of pull(e)) {
      const n = normalizeSkillLabel(String(t));
      if (!n) continue;
      const k = n.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(n);
    }
  }
  for (const p of projectRows) {
    for (const t of pull(p)) {
      const n = normalizeSkillLabel(String(t));
      if (!n) continue;
      const k = n.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(n);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function buildSkillSuggestionPool(
  experienceRows: UserExperienceRow[],
  projectRows: UserExperienceProject[]
): string[] {
  return buildTagSuggestionPool(experienceRows, projectRows, "skills");
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T12:00:00" : ""));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short" });
}

function dateRangeLabel(row: UserExperienceRow): string {
  const start = formatDate(row.start_date);
  const end =
    row.is_current
      ? "Present"
      : formatDate(row.end_date);
  if (start === "—" && end === "—") return "—";
  if (start === "—") return end;
  if (end === "—") return start;
  return `${start} – ${end}`;
}

function projectDateRangeLabel(p: UserExperienceProject): string {
  const start = formatDate(p.start_date);
  const end = formatDate(p.end_date);
  if (start === "—" && end === "—") return "";
  if (start === "—") return end;
  if (end === "—") return start;
  return `${start} – ${end}`;
}

function truncateText(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1)).trim()}…`;
}

type ExpForm = {
  role_title: string;
  organisation_name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
  description: string;
  industry: string;
  skills: string[];
  methods: string[];
  tools: string[];
};

function emptyExpForm(): ExpForm {
  return {
    role_title: "",
    organisation_name: "",
    start_date: "",
    end_date: "",
    is_current: false,
    description: "",
    industry: "",
    skills: [],
    methods: [],
    tools: [],
  };
}

function rowToExpForm(row: UserExperienceRow): ExpForm {
  return {
    role_title: row.role_title?.trim() ?? "",
    organisation_name: row.organisation_name?.trim() ?? "",
    start_date: row.start_date?.slice(0, 10) ?? "",
    end_date: row.end_date?.slice(0, 10) ?? "",
    is_current: Boolean(row.is_current),
    description: row.description?.trim() ?? "",
    industry: row.industry?.trim() ?? "",
    skills: dedupeSkillsNormalized(row.skills ?? []),
    methods: dedupeSkillsNormalized(row.methods ?? []),
    tools: dedupeSkillsNormalized(row.tools ?? []),
  };
}

type QualForm = {
  title: string;
  issuer: string;
  qualification_type: string;
  date_achieved: string;
  notes: string;
  credential_url: string;
};

function emptyQualForm(): QualForm {
  return {
    title: "",
    issuer: "",
    qualification_type: "",
    date_achieved: "",
    notes: "",
    credential_url: "",
  };
}

function rowToQualForm(row: UserQualificationRow): QualForm {
  return {
    title: row.title.trim(),
    issuer: row.issuer?.trim() ?? "",
    qualification_type: row.qualification_type?.trim() ?? "",
    date_achieved: row.date_achieved?.slice(0, 10) ?? "",
    notes: row.notes?.trim() ?? "",
    credential_url: row.credential_url?.trim() ?? "",
  };
}

type CertForm = {
  title: string;
  issuer: string;
  issue_date: string;
  expiry_date: string;
  renewal_required: boolean;
  notes: string;
  credential_url: string;
};

function emptyCertForm(): CertForm {
  return {
    title: "",
    issuer: "",
    issue_date: "",
    expiry_date: "",
    renewal_required: true,
    notes: "",
    credential_url: "",
  };
}

function rowToCertForm(row: UserCertificationRow): CertForm {
  return {
    title: row.title.trim(),
    issuer: row.issuer?.trim() ?? "",
    issue_date: row.issue_date?.slice(0, 10) ?? "",
    expiry_date: row.expiry_date?.slice(0, 10) ?? "",
    renewal_required: row.renewal_required,
    notes: row.notes?.trim() ?? "",
    credential_url: row.credential_url?.trim() ?? "",
  };
}

type ProjForm = {
  project_name: string;
  client: string;
  role: string;
  description: string;
  start_date: string;
  end_date: string;
  industry: string;
  skills: string[];
  methods: string[];
  tools: string[];
};

function emptyProjForm(): ProjForm {
  return {
    project_name: "",
    client: "",
    role: "",
    description: "",
    start_date: "",
    end_date: "",
    industry: "",
    skills: [],
    methods: [],
    tools: [],
  };
}

function rowToProjForm(row: UserExperienceProject): ProjForm {
  return {
    project_name: row.project_name?.trim() ?? "",
    client: row.client?.trim() ?? "",
    role: row.role?.trim() ?? "",
    description: row.description?.trim() ?? "",
    start_date: row.start_date?.slice(0, 10) ?? "",
    end_date: row.end_date?.slice(0, 10) ?? "",
    industry: row.industry?.trim() ?? "",
    skills: dedupeSkillsNormalized((row.skills ?? []).map(String)),
    methods: dedupeSkillsNormalized((row.methods ?? []).map(String)),
    tools: dedupeSkillsNormalized((row.tools ?? []).map(String)),
  };
}

export function MyExperienceSection({
  activeOrgId,
  activeWorkspaceMembership,
  isActive,
  reloadToken = 0,
  primaryAccountType,
  primaryAccountTypeReady,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [experiences, setExperiences] = useState<UserExperienceRow[]>([]);
  const [qualifications, setQualifications] = useState<UserQualificationRow[]>(
    []
  );
  const [certifications, setCertifications] = useState<UserCertificationRow[]>(
    []
  );
  const [projects, setProjects] = useState<UserExperienceProject[]>([]);
  const [storedCv, setStoredCv] = useState<StoredCvRow | null>(null);
  const [cvImportOpenRequest, setCvImportOpenRequest] = useState(0);
  const [removingCv, setRemovingCv] = useState(false);
  const [saving, setSaving] = useState(false);
  /** At most one work entry expanded (accordion). */
  const [expandedExperienceId, setExpandedExperienceId] = useState<
    string | null
  >(null);
  const [expandedQualificationId, setExpandedQualificationId] = useState<
    string | null
  >(null);
  const [expandedCertificationId, setExpandedCertificationId] = useState<
    string | null
  >(null);
  const [qualificationsSectionOpen, setQualificationsSectionOpen] =
    useState(false);
  const [certificationsSectionOpen, setCertificationsSectionOpen] =
    useState(false);
  /** Applies to skills, methods, and tools summary lists. */
  const [evidenceTagSummaryScope, setEvidenceTagSummaryScope] = useState<
    "top" | "all"
  >("top");

  const [expModal, setExpModal] = useState<"closed" | "add" | "edit">(
    "closed"
  );
  const [editingExpId, setEditingExpId] = useState<string | null>(null);
  const [expForm, setExpForm] = useState<ExpForm>(emptyExpForm());

  const [qualModal, setQualModal] = useState<"closed" | "add" | "edit">(
    "closed"
  );
  const [editingQualId, setEditingQualId] = useState<string | null>(null);
  const [qualForm, setQualForm] = useState<QualForm>(emptyQualForm());

  const [certModal, setCertModal] = useState<"closed" | "add" | "edit">(
    "closed"
  );
  const [editingCertId, setEditingCertId] = useState<string | null>(null);
  const [certForm, setCertForm] = useState<CertForm>(emptyCertForm());

  const [projectModal, setProjectModal] = useState<
    | { mode: "closed" }
    | { mode: "add"; experienceId: string }
    | { mode: "edit"; experienceId: string; projectId: string }
  >({ mode: "closed" });
  const [projForm, setProjForm] = useState<ProjForm>(emptyProjForm());
  /** Contextual refiner (AI prep): bounded modal for one work experience row. */
  const [refinerExperience, setRefinerExperience] =
    useState<UserExperienceRow | null>(null);

  const projectsByExperienceId = useMemo(() => {
    const r: Record<string, UserExperienceProject[]> = {};
    for (const p of projects) {
      const key = p.experience_id;
      if (!r[key]) r[key] = [];
      r[key].push(p);
    }
    for (const k of Object.keys(r)) {
      r[k].sort((a, b) => {
        const as = a.start_date ?? "";
        const bs = b.start_date ?? "";
        if (as !== bs) return bs.localeCompare(as);
        return (b.created_at ?? "").localeCompare(a.created_at ?? "");
      });
    }
    return r;
  }, [projects]);

  const skillSuggestionPool = useMemo(
    () => buildSkillSuggestionPool(experiences, projects),
    [experiences, projects]
  );
  const methodSuggestionPool = useMemo(
    () => buildTagSuggestionPool(experiences, projects, "methods"),
    [experiences, projects]
  );
  const toolSuggestionPool = useMemo(
    () => buildTagSuggestionPool(experiences, projects, "tools"),
    [experiences, projects]
  );

  const skillSummary = useMemo(
    () => aggregateSkillsFromEvidence(experiences, projects),
    [experiences, projects]
  );
  const methodSummary = useMemo(
    () => aggregateMethodsFromEvidence(experiences, projects),
    [experiences, projects]
  );
  const toolSummary = useMemo(
    () => aggregateToolsFromEvidence(experiences, projects),
    [experiences, projects]
  );
  const industrySummary = useMemo(
    () => aggregateIndustriesFromEvidence(experiences, projects),
    [experiences, projects]
  );

  const skillEvidenceDetails = useMemo(
    () => buildSkillEvidenceDetails(experiences, projects),
    [experiences, projects]
  );
  const methodEvidenceDetails = useMemo(
    () => buildMethodEvidenceDetails(experiences, projects),
    [experiences, projects]
  );
  const toolEvidenceDetails = useMemo(
    () => buildToolEvidenceDetails(experiences, projects),
    [experiences, projects]
  );
  const industryEvidenceDetails = useMemo(
    () => buildIndustryEvidenceDetails(experiences, projects),
    [experiences, projects]
  );

  const [expandedSkillDetailKey, setExpandedSkillDetailKey] = useState<
    string | null
  >(null);
  const [expandedMethodDetailKey, setExpandedMethodDetailKey] = useState<
    string | null
  >(null);
  const [expandedToolDetailKey, setExpandedToolDetailKey] = useState<
    string | null
  >(null);
  const [expandedIndustryDetailKey, setExpandedIndustryDetailKey] = useState<
    string | null
  >(null);
  const [evidenceTagTab, setEvidenceTagTab] =
    useState<EvidenceTagCategoryTab>("skills");

  const selectEvidenceTagTab = useCallback((tab: EvidenceTagCategoryTab) => {
    setEvidenceTagTab(tab);
    setExpandedSkillDetailKey(null);
    setExpandedMethodDetailKey(null);
    setExpandedToolDetailKey(null);
    setExpandedIndustryDetailKey(null);
  }, []);

  const revealExperienceRow = useCallback((experienceId: string) => {
    setExpandedExperienceId(experienceId);
    queueMicrotask(() => {
      document
        .getElementById(`my-exp-evidence-${experienceId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, []);

  const sortedCertifications = useMemo(
    () => sortCertificationsByRenewalUrgency(certifications),
    [certifications]
  );

  const skillSummaryDisplayed = useMemo(() => {
    if (
      evidenceTagSummaryScope === "all" ||
      skillSummary.length <= PERSONAL_EVIDENCE_SKILL_TOP_N
    ) {
      return skillSummary;
    }
    return skillSummary.slice(0, PERSONAL_EVIDENCE_SKILL_TOP_N);
  }, [skillSummary, evidenceTagSummaryScope]);

  const methodSummaryDisplayed = useMemo(() => {
    if (
      evidenceTagSummaryScope === "all" ||
      methodSummary.length <= PERSONAL_EVIDENCE_SKILL_TOP_N
    ) {
      return methodSummary;
    }
    return methodSummary.slice(0, PERSONAL_EVIDENCE_SKILL_TOP_N);
  }, [methodSummary, evidenceTagSummaryScope]);

  const toolSummaryDisplayed = useMemo(() => {
    if (
      evidenceTagSummaryScope === "all" ||
      toolSummary.length <= PERSONAL_EVIDENCE_SKILL_TOP_N
    ) {
      return toolSummary;
    }
    return toolSummary.slice(0, PERSONAL_EVIDENCE_SKILL_TOP_N);
  }, [toolSummary, evidenceTagSummaryScope]);

  const industrySummaryDisplayed = useMemo(() => {
    if (
      evidenceTagSummaryScope === "all" ||
      industrySummary.length <= PERSONAL_EVIDENCE_SKILL_TOP_N
    ) {
      return industrySummary;
    }
    return industrySummary.slice(0, PERSONAL_EVIDENCE_SKILL_TOP_N);
  }, [industrySummary, evidenceTagSummaryScope]);

  const evidenceTagCurrentCategoryFullCount = useMemo(() => {
    switch (evidenceTagTab) {
      case "skills":
        return skillSummary.length;
      case "methods":
        return methodSummary.length;
      case "tools":
        return toolSummary.length;
      case "industries":
        return industrySummary.length;
      default:
        return 0;
    }
  }, [
    evidenceTagTab,
    skillSummary.length,
    methodSummary.length,
    toolSummary.length,
    industrySummary.length,
  ]);

  const showEvidenceTagTopAllToggle =
    evidenceTagCurrentCategoryFullCount > PERSONAL_EVIDENCE_SKILL_TOP_N;

  const hasAnyEvidenceTags = useMemo(
    () =>
      skillSummary.length > 0 ||
      methodSummary.length > 0 ||
      toolSummary.length > 0 ||
      industrySummary.length > 0,
    [
      skillSummary.length,
      methodSummary.length,
      toolSummary.length,
      industrySummary.length,
    ],
  );

  const certExpiringSoonCount = useMemo(
    () =>
      certifications.filter(
        (c) => certificationRenewalStatus(c.expiry_date) === "expiring_soon",
      ).length,
    [certifications],
  );

  const loadData = useCallback(async () => {
    if (!isActive) {
      setLoading(false);
      setStoredCv(null);
      return;
    }

    setLoading(true);
    setLoadError(null);

    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) {
      setLoadError("Not signed in.");
      setLoading(false);
      setStoredCv(null);
      return;
    }
    setUserId(uid);

    const expProj = await Promise.all([
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
    ]);
    const expRes = expProj[0];
    const projRes = expProj[1];

    let qualRes: {
      data: unknown;
      error: { message: string } | null;
    };
    let certRes: {
      data: unknown;
      error: { message: string } | null;
    };
    const evidenceOrgId = activeOrgId?.trim() ? activeOrgId.trim() : null;
    if (evidenceOrgId) {
      const qc = await Promise.all([
        supabase
          .from("user_qualifications")
          .select("*")
          .eq("organisation_id", evidenceOrgId)
          .eq("user_id", uid)
          .order("created_at", { ascending: false }),
        supabase
          .from("user_certifications")
          .select("*")
          .eq("organisation_id", evidenceOrgId)
          .eq("user_id", uid)
          .order("created_at", { ascending: false }),
      ]);
      qualRes = qc[0];
      certRes = qc[1];
    } else {
      const qc = await Promise.all([
        supabase
          .from("user_qualifications")
          .select("*")
          .is("organisation_id", null)
          .eq("user_id", uid)
          .order("created_at", { ascending: false }),
        supabase
          .from("user_certifications")
          .select("*")
          .is("organisation_id", null)
          .eq("user_id", uid)
          .order("created_at", { ascending: false }),
      ]);
      qualRes = qc[0];
      certRes = qc[1];
    }

    const cvRes = evidenceOrgId
      ? await supabase
        .from("user_cv_uploads")
        .select("id,storage_path,original_filename,mime_type,uploaded_at")
        .eq("user_id", uid)
        .eq("organisation_id", evidenceOrgId)
        .order("uploaded_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      : await supabase
        .from("user_cv_uploads")
        .select("id,storage_path,original_filename,mime_type,uploaded_at")
        .eq("user_id", uid)
        .is("organisation_id", null)
        .order("uploaded_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (expRes.error) {
      console.error(expRes.error);
      setLoadError(expRes.error.message);
      setExperiences([]);
    } else {
      setExperiences((expRes.data as UserExperienceRow[]) ?? []);
    }

    if (qualRes.error) {
      console.error(qualRes.error);
      if (!expRes.error) setLoadError(qualRes.error.message);
      setQualifications([]);
    } else {
      setQualifications((qualRes.data as UserQualificationRow[]) ?? []);
    }

    if (certRes.error) {
      console.error(certRes.error);
      if (!expRes.error && !qualRes.error) setLoadError(certRes.error.message);
      setCertifications([]);
    } else {
      setCertifications((certRes.data as UserCertificationRow[]) ?? []);
    }

    if (projRes.error) {
      console.error(projRes.error);
      if (!expRes.error && !qualRes.error && !certRes.error)
        setLoadError(projRes.error.message);
      setProjects([]);
    } else {
      setProjects((projRes.data as UserExperienceProject[]) ?? []);
    }

    if (cvRes.error) {
      console.error(cvRes.error);
      setStoredCv(null);
    } else {
      setStoredCv((cvRes.data as StoredCvRow | null) ?? null);
    }

    setLoading(false);
  }, [isActive, activeOrgId, reloadToken]);

  const removeStoredCv = useCallback(async () => {
    if (!storedCv || !userId) return;
    if (
      !confirm(
        "Remove this stored CV? The file will be deleted. You can upload a new one anytime."
      )
    ) {
      return;
    }
    setRemovingCv(true);
    try {
      const { error: stErr } = await supabase.storage
        .from("cv-uploads")
        .remove([storedCv.storage_path]);
      if (stErr) console.warn("[Current CV] storage remove:", stErr.message);

      let dErr;
      if (activeOrgId) {
        const r = await supabase
          .from("user_cv_uploads")
          .delete()
          .eq("id", storedCv.id)
          .eq("user_id", userId)
          .eq("organisation_id", activeOrgId);
        dErr = r.error;
      } else {
        const r = await supabase
          .from("user_cv_uploads")
          .delete()
          .eq("id", storedCv.id)
          .eq("user_id", userId)
          .is("organisation_id", null);
        dErr = r.error;
      }

      if (dErr) throw dErr;

      const { data: next, error: qErr } = activeOrgId
        ? await supabase
            .from("user_cv_uploads")
            .select(
              "id,storage_path,original_filename,mime_type,uploaded_at",
            )
            .eq("user_id", userId)
            .eq("organisation_id", activeOrgId)
            .order("uploaded_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : await supabase
            .from("user_cv_uploads")
            .select(
              "id,storage_path,original_filename,mime_type,uploaded_at",
            )
            .eq("user_id", userId)
            .is("organisation_id", null)
            .order("uploaded_at", { ascending: false })
            .limit(1)
            .maybeSingle();

      if (qErr) {
        console.error(qErr);
        setStoredCv(null);
      } else {
        setStoredCv((next as StoredCvRow | null) ?? null);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not remove stored CV.");
    } finally {
      setRemovingCv(false);
    }
  }, [storedCv, activeOrgId, userId]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      await loadData();
    });
    return () => {
      cancelled = true;
    };
  }, [loadData]);

  function closeCertModal() {
    setCertModal("closed");
    setEditingCertId(null);
  }

  function openAddExperience() {
    closeProjectModal();
    setQualModal("closed");
    closeCertModal();
    setEditingExpId(null);
    setExpForm(emptyExpForm());
    setExpModal("add");
  }

  function openEditExperience(row: UserExperienceRow) {
    closeProjectModal();
    setQualModal("closed");
    closeCertModal();
    setEditingExpId(row.id);
    setExpForm(rowToExpForm(row));
    setExpModal("edit");
  }

  function applyRefinementSuggestionToEditForm(
    row: UserExperienceRow,
    s: RefinementSuggestionPayload,
  ) {
    const next = rowToExpForm(row);
    if (s.suggestedDescription?.trim()) {
      next.description = s.suggestedDescription.trim();
    }
    if (s.suggestedSkills.length > 0) {
      next.skills = dedupeSkillsNormalized(s.suggestedSkills);
    }
    if (s.suggestedMethods.length > 0) {
      next.methods = dedupeSkillsNormalized(s.suggestedMethods);
    }
    if (s.suggestedTools.length > 0) {
      next.tools = dedupeSkillsNormalized(s.suggestedTools);
    }
    if (s.suggestedIndustry !== null && s.suggestedIndustry !== undefined) {
      next.industry = s.suggestedIndustry.trim();
    }
    closeProjectModal();
    setQualModal("closed");
    closeCertModal();
    setEditingExpId(row.id);
    setExpForm(next);
    setExpModal("edit");
    setRefinerExperience(null);
  }

  function closeExpModal() {
    setExpModal("closed");
    setEditingExpId(null);
  }

  async function submitExperience(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!userId) return;
    const title = expForm.role_title.trim();
    const org = expForm.organisation_name.trim();
    if (!title || !org) {
      alert("Role title and company are required.");
      return;
    }

    setSaving(true);
    const skills = dedupeSkillsNormalized(expForm.skills);
    const methods = dedupeSkillsNormalized(expForm.methods);
    const tools = dedupeSkillsNormalized(expForm.tools);
    const payload = {
      role_title: title,
      organisation_name: org,
      description: expForm.description.trim() || null,
      start_date: expForm.start_date.trim() || null,
      end_date: expForm.is_current ? null : expForm.end_date.trim() || null,
      is_current: expForm.is_current,
      industry: expForm.industry.trim() || null,
      skills,
      methods,
      tools,
      updated_at: new Date().toISOString(),
    };

    if (expModal === "add") {
      console.log("[MyExperience save]", {
        mode: "insert",
        experienceRowId: null,
        payload,
      });
      const nextSort =
        experiences.reduce((m, r) => Math.max(m, r.sort_order ?? 0), 0) + 1;
      const { error } = await supabase.from("user_experience").insert({
        user_id: userId,
        ...payload,
        sort_order: nextSort,
      });
      setSaving(false);
      if (error) {
        console.error(error);
        alert(error.message || "Could not add experience.");
        return;
      }
    } else if (editingExpId) {
      console.log("[MyExperience save]", {
        mode: "update",
        experienceRowId: editingExpId,
        payload,
      });
      const { error } = await supabase
        .from("user_experience")
        .update(payload)
        .eq("id", editingExpId)
        .eq("user_id", userId);
      setSaving(false);
      if (error) {
        console.error(error);
        alert(error.message || "Could not update experience.");
        return;
      }
    }

    closeExpModal();
    await loadData();
  }

  async function deleteExperience(id: string) {
    if (!userId) return;
    if (!confirm("Remove this experience entry?")) return;
    const { error } = await supabase
      .from("user_experience")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (error) {
      console.error(error);
      alert(error.message || "Could not delete.");
      return;
    }
    setExpandedExperienceId((prev) => (prev === id ? null : prev));
    await loadData();
  }

  function openAddQualification() {
    closeProjectModal();
    closeCertModal();
    setEditingQualId(null);
    setQualForm(emptyQualForm());
    setQualModal("add");
  }

  function openEditQualification(row: UserQualificationRow) {
    closeProjectModal();
    closeCertModal();
    setEditingQualId(row.id);
    setQualForm(rowToQualForm(row));
    setQualModal("edit");
  }

  function openAddCertification() {
    closeProjectModal();
    setQualModal("closed");
    setEditingCertId(null);
    setCertForm(emptyCertForm());
    setCertModal("add");
  }

  function openEditCertification(row: UserCertificationRow) {
    closeProjectModal();
    setQualModal("closed");
    setEditingCertId(row.id);
    setCertForm(rowToCertForm(row));
    setCertModal("edit");
  }

  function closeQualModal() {
    setQualModal("closed");
    setEditingQualId(null);
  }

  async function submitQualification(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!userId) return;
    const evidenceOrgId = activeOrgId?.trim() ? activeOrgId.trim() : null;
    const title = qualForm.title.trim();
    if (!title) {
      alert("Title is required.");
      return;
    }

    setSaving(true);
    const payload = {
      title,
      issuer: qualForm.issuer.trim() || null,
      qualification_type: qualForm.qualification_type.trim() || null,
      date_achieved: qualForm.date_achieved.trim() || null,
      notes: qualForm.notes.trim() || null,
      credential_url: qualForm.credential_url.trim() || null,
      updated_at: new Date().toISOString(),
    };

    if (qualModal === "add") {
      const { error } = await supabase.from("user_qualifications").insert({
        user_id: userId,
        organisation_id: evidenceOrgId,
        ...payload,
      });
      setSaving(false);
      if (error) {
        console.error(error);
        alert(error.message || "Could not add qualification.");
        return;
      }
    } else if (editingQualId) {
      let q = supabase
        .from("user_qualifications")
        .update(payload)
        .eq("id", editingQualId)
        .eq("user_id", userId);
      q =
        evidenceOrgId === null
          ? q.is("organisation_id", null)
          : q.eq("organisation_id", evidenceOrgId);
      const { error } = await q;
      setSaving(false);
      if (error) {
        console.error(error);
        alert(error.message || "Could not update qualification.");
        return;
      }
    }

    closeQualModal();
    await loadData();
  }

  async function deleteQualification(id: string) {
    if (!userId) return;
    if (!confirm("Remove this qualification?")) return;
    const evidenceOrgId = activeOrgId?.trim() ? activeOrgId.trim() : null;
    let q = supabase
      .from("user_qualifications")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    q =
      evidenceOrgId === null
        ? q.is("organisation_id", null)
        : q.eq("organisation_id", evidenceOrgId);
    const { error } = await q;
    if (error) {
      console.error(error);
      alert(error.message || "Could not delete.");
      return;
    }
    setExpandedQualificationId((prev) => (prev === id ? null : prev));
    await loadData();
  }

  async function submitCertification(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!userId) return;
    const evidenceOrgId = activeOrgId?.trim() ? activeOrgId.trim() : null;
    const title = certForm.title.trim();
    if (!title) {
      alert("Title is required.");
      return;
    }

    setSaving(true);
    const payload = {
      title,
      issuer: certForm.issuer.trim() || null,
      issue_date: certForm.issue_date.trim() || null,
      expiry_date: certForm.expiry_date.trim() || null,
      renewal_required: certForm.renewal_required,
      notes: certForm.notes.trim() || null,
      credential_url: certForm.credential_url.trim() || null,
      updated_at: new Date().toISOString(),
    };

    if (certModal === "add") {
      const { error } = await supabase.from("user_certifications").insert({
        user_id: userId,
        organisation_id: evidenceOrgId,
        ...payload,
      });
      setSaving(false);
      if (error) {
        console.error(error);
        alert(error.message || "Could not add certification.");
        return;
      }
    } else if (editingCertId) {
      let q = supabase
        .from("user_certifications")
        .update(payload)
        .eq("id", editingCertId)
        .eq("user_id", userId);
      q =
        evidenceOrgId === null
          ? q.is("organisation_id", null)
          : q.eq("organisation_id", evidenceOrgId);
      const { error } = await q;
      setSaving(false);
      if (error) {
        console.error(error);
        alert(error.message || "Could not update certification.");
        return;
      }
    }

    closeCertModal();
    await loadData();
  }

  async function deleteCertification(id: string) {
    if (!userId) return;
    if (!confirm("Remove this certification?")) return;
    const evidenceOrgId = activeOrgId?.trim() ? activeOrgId.trim() : null;
    let q = supabase
      .from("user_certifications")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    q =
      evidenceOrgId === null
        ? q.is("organisation_id", null)
        : q.eq("organisation_id", evidenceOrgId);
    const { error } = await q;
    if (error) {
      console.error(error);
      alert(error.message || "Could not delete.");
      return;
    }
    setExpandedCertificationId((prev) => (prev === id ? null : prev));
    await loadData();
  }

  function openAddProject(experienceId: string) {
    setExpModal("closed");
    setEditingExpId(null);
    setQualModal("closed");
    closeCertModal();
    setProjectModal({ mode: "add", experienceId });
    setProjForm(emptyProjForm());
  }

  function openEditProject(p: UserExperienceProject) {
    setExpModal("closed");
    setEditingExpId(null);
    setQualModal("closed");
    closeCertModal();
    setProjectModal({
      mode: "edit",
      experienceId: p.experience_id,
      projectId: p.id,
    });
    setProjForm(rowToProjForm(p));
  }

  function closeProjectModal() {
    setProjectModal({ mode: "closed" });
  }

  async function submitProject(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!userId || projectModal.mode === "closed") return;
    const pname = projForm.project_name.trim();
    if (!pname) {
      alert("Project name is required.");
      return;
    }

    setSaving(true);
    const skills = dedupeSkillsNormalized(projForm.skills);
    const methods = dedupeSkillsNormalized(projForm.methods);
    const tools = dedupeSkillsNormalized(projForm.tools);
    const payload = {
      project_name: pname,
      client: projForm.client.trim() || null,
      role: projForm.role.trim() || null,
      description: projForm.description.trim() || null,
      start_date: projForm.start_date.trim() || null,
      end_date: projForm.end_date.trim() || null,
      industry: projForm.industry.trim() || null,
      skills,
      methods,
      tools,
      updated_at: new Date().toISOString(),
    };

    if (projectModal.mode === "add") {
      const { error } = await supabase.from("user_experience_projects").insert({
        user_id: userId,
        experience_id: projectModal.experienceId,
        ...payload,
      });
      setSaving(false);
      if (error) {
        console.error(error);
        alert(error.message || "Could not add project.");
        return;
      }
    } else {
      const { error } = await supabase
        .from("user_experience_projects")
        .update(payload)
        .eq("id", projectModal.projectId)
        .eq("user_id", userId);
      setSaving(false);
      if (error) {
        console.error(error);
        alert(error.message || "Could not update project.");
        return;
      }
    }

    closeProjectModal();
    await loadData();
  }

  async function deleteProject(projectId: string) {
    if (!userId) return;
    if (!confirm("Remove this project?")) return;
    const { error } = await supabase
      .from("user_experience_projects")
      .delete()
      .eq("id", projectId)
      .eq("user_id", userId);
    if (error) {
      console.error(error);
      alert(error.message || "Could not delete.");
      return;
    }
    if (
      projectModal.mode !== "closed" &&
      projectModal.mode === "edit" &&
      projectModal.projectId === projectId
    ) {
      closeProjectModal();
    }
    await loadData();
  }

  if (!isActive) {
    return null;
  }

  /** Non-empty org id; whitespace-only must not count as workspace (JS truthiness bug). */
  const hasWorkspaceOrg = Boolean(activeOrgId?.trim());

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

  if (!hasWorkspaceOrg && !primaryAccountTypeReady) {
    return (
      <div style={{ ...panelShell, marginTop: 0 }}>
        <p style={{ ...muted, margin: 0 }}>Loading experience…</p>
      </div>
    );
  }

  if (!hasWorkspaceOrg && primaryAccountType !== "personal") {
    return (
      <div style={{ ...panelShell, marginTop: 0 }}>
        <p style={{ ...muted, margin: 0 }}>
          Select a workspace to manage your experience evidence.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ ...panelShell, marginTop: 0 }}>
        <p style={{ ...muted, margin: 0 }}>Loading experience…</p>
      </div>
    );
  }

  const isPersonalNoWorkspace =
    primaryAccountType === "personal" && !hasWorkspaceOrg;

  /**
   * CV extract must not use the workspace edge function for personal-primary users who have no
   * effective workspace membership — even if `activeOrgId` is stale/truthy in shell state.
   * Workspace users (or personal users in an org context) use `workspace` + organisationId.
   */
  const cvImportMode: "workspace" | "personal" =
    primaryAccountType === "personal" && !activeWorkspaceMembership
      ? "personal"
      : hasWorkspaceOrg
        ? "workspace"
        : "personal";
  const cvImportActiveOrgId =
    cvImportMode === "personal" ? null : activeOrgId?.trim() ?? null;
  /** Null = personal-account evidence rows (organisation_id IS NULL). */
  const qualCertOrgKey = activeOrgId?.trim() ? activeOrgId.trim() : null;

  return (
    <div
      className={styles.shell}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 24,
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
          My Experience
        </h2>
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 14,
            color: mutedColor,
            lineHeight: 1.5,
          }}
        >
          A lightweight record of roles and evidence to support future matching
          and profile context.
        </p>
      </header>

      {isPersonalNoWorkspace && experiences.length === 0 ? (
        <div
          style={{
            ...card,
            borderStyle: "dashed",
            borderColor: borderSubtle,
          }}
        >
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: text }}>
            You have not added any experience yet.
          </p>
          <p
            style={{
              margin: "10px 0 0",
              fontSize: 14,
              color: mutedColor,
              lineHeight: 1.55,
            }}
          >
            Use <strong style={{ color: text }}>Import from CV</strong> below to
            extract roles from a PDF or DOCX, or add a role with{" "}
            <strong style={{ color: text }}>Add entry</strong> under Work
            experience. You can also add roles from{" "}
            <strong style={{ color: text }}>My profile → Add from CV</strong> to
            prefill your profile.
          </p>
        </div>
      ) : null}

      {loadError ? (
        <p style={{ margin: 0, fontSize: 14, color: errorColor }}>{loadError}</p>
      ) : null}

      <div className={styles.grid}>
        <div className={styles.col}>
      {storedCv ? (
        <CurrentCvReference
          storedCv={storedCv}
          onReplace={() => setCvImportOpenRequest((n) => n + 1)}
          onRemove={() => void removeStoredCv()}
          removing={removingCv}
        />
      ) : null}

      <CvImportFlow
        importMode={cvImportMode}
        activeOrgId={cvImportActiveOrgId}
        userId={userId}
        experiences={experiences}
        qualifications={qualifications}
        certifications={certifications}
        projects={projects}
        onReload={loadData}
        openImportRequest={cvImportOpenRequest}
        storedCv={storedCv}
      />

      {/* Qualifications (enduring credentials) */}
      <section>
        <div style={{ ...card, marginTop: 8 }}>
          <button
            type="button"
            aria-expanded={qualificationsSectionOpen}
            aria-controls="qualifications-section-panel"
            id="qualifications-section-heading"
            onClick={() => setQualificationsSectionOpen((o) => !o)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: 0,
              margin: 0,
              cursor: "pointer",
              textAlign: "left",
              background: "transparent",
              border: "none",
              color: "inherit",
              boxSizing: "border-box",
            }}
          >
            <span
              style={{
                margin: 0,
                fontSize: 17,
                fontWeight: 600,
                color: text,
                letterSpacing: "-0.02em",
              }}
            >
              Qualifications
            </span>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 13, color: mutedColor }}>
                {qualifications.length}{" "}
                {qualifications.length === 1 ? "item" : "items"}
              </span>
              <span
                aria-hidden
                style={{
                  fontSize: 12,
                  color: mutedColor,
                  fontFamily: "system-ui, sans-serif",
                }}
              >
                {qualificationsSectionOpen ? "\u25BC" : "\u25B6"}
              </span>
            </span>
          </button>
          {qualificationsSectionOpen ? (
            <div
              id="qualifications-section-panel"
              role="region"
              aria-labelledby="qualifications-section-heading"
              style={{
                marginTop: 12,
                paddingTop: 12,
                borderTop: `1px solid ${borderSubtle}`,
              }}
            >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "space-between",
              gap: 10,
              marginBottom: qualifications.length ? 14 : 0,
            }}
          >
            <p style={{ margin: 0, fontSize: 13, color: mutedColor }}>
              {qualCertOrgKey === null
                ? "Personal qualifications live on your account (no workspace). Degrees, diplomas, professional courses, and other enduring credentials."
                : "Degrees, diplomas, professional courses, and other enduring credentials (Scrum, PRINCE2, etc.)."}
            </p>
            <button
              type="button"
              onClick={openAddQualification}
              style={{ ...btn, fontSize: 13 }}
            >
              Add qualification
            </button>
          </div>
          {qualifications.length === 0 ? (
            <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>
              {qualCertOrgKey === null
                ? "No personal qualifications yet. Add one here or include them when you import a CV."
                : "No qualifications recorded for this workspace yet."}
            </p>
          ) : (
            <ul
              style={{
                margin: 0,
                padding: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 0,
              }}
            >
              {qualifications.map((q) => {
                const expanded = expandedQualificationId === q.id;
                return (
                  <li
                    key={q.id}
                    style={{
                      borderBottom: `1px solid ${border}`,
                    }}
                  >
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={
                        expanded
                          ? `Collapse ${q.title ?? "qualification"}`
                          : `Expand ${q.title ?? "qualification"}`
                      }
                      onClick={() =>
                        setExpandedQualificationId((prev) =>
                          prev === q.id ? null : q.id
                        )
                      }
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "12px 0",
                        cursor: "pointer",
                        textAlign: "left",
                        color: "inherit",
                        background: "transparent",
                        border: "none",
                        boxSizing: "border-box",
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: 14,
                            color: text,
                            lineHeight: 1.35,
                          }}
                        >
                          {q.title}
                        </div>
                        {q.issuer ? (
                          <div
                            style={{
                              fontSize: 13,
                              color: mutedColor,
                              marginTop: 4,
                            }}
                          >
                            {q.issuer}
                          </div>
                        ) : null}
                        {q.date_achieved ? (
                          <div
                            style={{
                              fontSize: 12,
                              color: mutedColor,
                              marginTop: 6,
                            }}
                          >
                            Achieved {formatDate(q.date_achieved)}
                          </div>
                        ) : null}
                      </div>
                      <span
                        aria-hidden
                        style={{
                          fontSize: 12,
                          color: mutedColor,
                          lineHeight: 1.4,
                          flexShrink: 0,
                          marginTop: 2,
                          fontFamily: "system-ui, sans-serif",
                        }}
                      >
                        {expanded ? "\u25BC" : "\u25B6"}
                      </span>
                    </button>
                    {expanded ? (
                      <div style={{ paddingBottom: 14, paddingTop: 2 }}>
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            justifyContent: "space-between",
                            gap: 10,
                            alignItems: "flex-start",
                          }}
                        >
                          <div style={{ minWidth: 0, flex: "1 1 200px" }}>
                            {!q.date_achieved ? (
                              <div
                                style={{
                                  fontSize: 12,
                                  color: mutedColor,
                                  marginBottom: 8,
                                }}
                              >
                                Date not set
                              </div>
                            ) : null}
                            {q.qualification_type ? (
                              <div
                                style={{
                                  fontSize: 12,
                                  color: mutedColor,
                                  marginBottom: 8,
                                }}
                              >
                                Type:{" "}
                                <span style={{ color: text }}>
                                  {q.qualification_type}
                                </span>
                              </div>
                            ) : null}
                            {q.notes ? (
                              <p
                                style={{
                                  margin: "0 0 8px",
                                  fontSize: 13,
                                  color: text,
                                  lineHeight: 1.45,
                                }}
                              >
                                {q.notes}
                              </p>
                            ) : null}
                            {q.credential_url?.trim() ? (
                              <a
                                href={
                                  /^https?:\/\//i.test(q.credential_url.trim())
                                    ? q.credential_url.trim()
                                    : `https://${q.credential_url.trim()}`
                                }
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  display: "inline-block",
                                  fontSize: 12,
                                  color: accent,
                                }}
                              >
                                View credential link
                              </a>
                            ) : null}
                          </div>
                          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                            <button
                              type="button"
                              onClick={() => openEditQualification(q)}
                              style={{
                                ...btnGhost,
                                fontSize: 12,
                                padding: "6px 10px",
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteQualification(q.id)}
                              style={{
                                ...btnGhost,
                                fontSize: 12,
                                padding: "6px 10px",
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
            </div>
          ) : null}
        </div>
      </section>

      {/* Certifications (renewable) */}
      <section>
        <div style={{ ...card, marginTop: 8 }}>
          <button
            type="button"
            aria-expanded={certificationsSectionOpen}
            aria-controls="certifications-section-panel"
            id="certifications-section-heading"
            onClick={() => setCertificationsSectionOpen((o) => !o)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: 0,
              margin: 0,
              cursor: "pointer",
              textAlign: "left",
              background: "transparent",
              border: "none",
              color: "inherit",
              boxSizing: "border-box",
            }}
          >
            <span
              style={{
                margin: 0,
                fontSize: 17,
                fontWeight: 600,
                color: text,
                letterSpacing: "-0.02em",
              }}
            >
              Certifications
            </span>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexShrink: 0,
                flexWrap: "wrap",
                justifyContent: "flex-end",
              }}
            >
              <span style={{ fontSize: 13, color: mutedColor }}>
                {certifications.length}{" "}
                {certifications.length === 1 ? "item" : "items"}
                {certExpiringSoonCount > 0 ? (
                  <>
                    {" · "}
                    <span style={{ color: "#e8c96a" }}>
                      {certExpiringSoonCount} expiring soon
                    </span>
                  </>
                ) : null}
              </span>
              <span
                aria-hidden
                style={{
                  fontSize: 12,
                  color: mutedColor,
                  fontFamily: "system-ui, sans-serif",
                }}
              >
                {certificationsSectionOpen ? "\u25BC" : "\u25B6"}
              </span>
            </span>
          </button>
          {certificationsSectionOpen ? (
            <div
              id="certifications-section-panel"
              role="region"
              aria-labelledby="certifications-section-heading"
              style={{
                marginTop: 12,
                paddingTop: 12,
                borderTop: `1px solid ${borderSubtle}`,
              }}
            >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "space-between",
              gap: 10,
              marginBottom: sortedCertifications.length ? 14 : 0,
            }}
          >
            <p style={{ margin: 0, fontSize: 13, color: mutedColor }}>
              {qualCertOrgKey === null
                ? "Personal certifications: safety, compliance, and other credentials that may expire. Separate from qualifications above."
                : "Safety, compliance, and other credentials that may expire and require renewal."}
            </p>
            <button
              type="button"
              onClick={openAddCertification}
              style={{ ...btn, fontSize: 13 }}
            >
              Add certification
            </button>
          </div>
          {certifications.length === 0 ? (
            <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>
              {qualCertOrgKey === null
                ? "No personal certifications yet. Add one here or include them when you import a CV."
                : "No certifications recorded for this workspace yet."}
            </p>
          ) : (
            <ul
              style={{
                margin: 0,
                padding: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 0,
              }}
            >
              {sortedCertifications.map((c) => {
                const st = certificationRenewalStatus(c.expiry_date);
                const badgeLabel = certificationStatusLabel(st);
                const badgeColor =
                  st === "expired"
                    ? "#e87878"
                    : st === "expiring_soon"
                      ? "#e8c96a"
                      : mutedColor;
                const expanded = expandedCertificationId === c.id;
                return (
                  <li
                    key={c.id}
                    style={{
                      borderBottom: `1px solid ${border}`,
                    }}
                  >
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={
                        expanded
                          ? `Collapse ${c.title ?? "certification"}`
                          : `Expand ${c.title ?? "certification"}`
                      }
                      onClick={() =>
                        setExpandedCertificationId((prev) =>
                          prev === c.id ? null : c.id
                        )
                      }
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "12px 0",
                        cursor: "pointer",
                        textAlign: "left",
                        color: "inherit",
                        background: "transparent",
                        border: "none",
                        boxSizing: "border-box",
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
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
                              fontWeight: 600,
                              fontSize: 14,
                              color: text,
                              lineHeight: 1.35,
                            }}
                          >
                            {c.title}
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              padding: "2px 8px",
                              borderRadius: 6,
                              border: `1px solid ${border}`,
                              color: badgeColor,
                            }}
                          >
                            {badgeLabel}
                          </span>
                        </div>
                        {c.issuer ? (
                          <div
                            style={{
                              fontSize: 13,
                              color: mutedColor,
                              marginTop: 4,
                            }}
                          >
                            {c.issuer}
                          </div>
                        ) : null}
                        <div
                          style={{
                            fontSize: 12,
                            color: mutedColor,
                            marginTop: 6,
                            lineHeight: 1.45,
                          }}
                        >
                          {c.issue_date
                            ? `Issued ${formatDate(c.issue_date)}`
                            : "Issue date not set"}
                          {c.expiry_date
                            ? ` · Expires ${formatDate(c.expiry_date)}`
                            : " · No expiry date"}
                          {!c.renewal_required ? " · Renewal not required" : ""}
                        </div>
                      </div>
                      <span
                        aria-hidden
                        style={{
                          fontSize: 12,
                          color: mutedColor,
                          lineHeight: 1.4,
                          flexShrink: 0,
                          marginTop: 2,
                          fontFamily: "system-ui, sans-serif",
                        }}
                      >
                        {expanded ? "\u25BC" : "\u25B6"}
                      </span>
                    </button>
                    {expanded ? (
                      <div style={{ paddingBottom: 14, paddingTop: 2 }}>
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            justifyContent: "space-between",
                            gap: 10,
                            alignItems: "flex-start",
                          }}
                        >
                          <div style={{ minWidth: 0, flex: "1 1 200px" }}>
                            {c.notes ? (
                              <p
                                style={{
                                  margin: "0 0 8px",
                                  fontSize: 13,
                                  color: text,
                                  lineHeight: 1.45,
                                }}
                              >
                                {c.notes}
                              </p>
                            ) : null}
                            {c.credential_url?.trim() ? (
                              <a
                                href={
                                  /^https?:\/\//i.test(c.credential_url.trim())
                                    ? c.credential_url.trim()
                                    : `https://${c.credential_url.trim()}`
                                }
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  display: "inline-block",
                                  fontSize: 12,
                                  color: accent,
                                }}
                              >
                                View credential link
                              </a>
                            ) : null}
                          </div>
                          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                            <button
                              type="button"
                              onClick={() => openEditCertification(c)}
                              style={{
                                ...btnGhost,
                                fontSize: 12,
                                padding: "6px 10px",
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteCertification(c.id)}
                              style={{
                                ...btnGhost,
                                fontSize: 12,
                                padding: "6px 10px",
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
            </div>
          ) : null}
        </div>
      </section>

        </div>
        <div className={styles.col}>
      {/* Work experience */}
      <section>
        <p style={{ ...sectionEyebrow, marginTop: 0 }}>Work experience</p>
        <div style={{ ...card, marginTop: 8 }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
              marginBottom: experiences.length ? 14 : 0,
            }}
          >
            <p style={{ margin: 0, fontSize: 13, color: mutedColor }}>
              Roles you have held, with skills and context.
            </p>
            <button
              type="button"
              onClick={openAddExperience}
              style={{ ...btn, fontSize: 13 }}
            >
              Add entry
            </button>
          </div>
          {experiences.length === 0 ? (
            <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>
              {isPersonalNoWorkspace
                ? "No roles yet. Import from CV above or use Add entry."
                : "No entries yet. Add a role to build your evidence layer."}
            </p>
          ) : (
            <ul
              style={{
                margin: 0,
                padding: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 0,
              }}
            >
              {experiences.map((row) => {
                const expanded = expandedExperienceId === row.id;
                return (
                  <li
                    id={`my-exp-evidence-${row.id}`}
                    key={row.id}
                    style={{
                      borderBottom: `1px solid ${border}`,
                    }}
                  >
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={
                        expanded
                          ? `Collapse ${row.role_title ?? "role"}`
                          : `Expand ${row.role_title ?? "role"}`
                      }
                      onClick={() =>
                        setExpandedExperienceId((prev) =>
                          prev === row.id ? null : row.id
                        )
                      }
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "12px 0",
                        cursor: "pointer",
                        textAlign: "left",
                        color: "inherit",
                        background: "transparent",
                        border: "none",
                        boxSizing: "border-box",
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: 15,
                            color: text,
                            lineHeight: 1.35,
                          }}
                        >
                          {row.role_title}
                          {row.organisation_name
                            ? ` · ${row.organisation_name}`
                            : ""}
                        </div>
                        <div
                          style={{
                            fontSize: 13,
                            color: mutedColor,
                            marginTop: 4,
                          }}
                        >
                          {dateRangeLabel(row)}
                        </div>
                      </div>
                      <span
                        aria-hidden
                        style={{
                          fontSize: 12,
                          color: mutedColor,
                          lineHeight: 1.4,
                          flexShrink: 0,
                          marginTop: 2,
                          fontFamily: "system-ui, sans-serif",
                        }}
                      >
                        {expanded ? "\u25BC" : "\u25B6"}
                      </span>
                    </button>
                    {expanded ? (
                      <div
                        style={{
                          paddingBottom: 14,
                          paddingTop: 2,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            justifyContent: "space-between",
                            gap: 8,
                            alignItems: "flex-start",
                          }}
                        >
                          <div style={{ minWidth: 0, flex: "1 1 200px" }}>
                            {row.description ? (
                              <p
                                style={{
                                  margin: "0 0 8px",
                                  fontSize: 14,
                                  color: text,
                                  lineHeight: 1.45,
                                }}
                              >
                                {row.description}
                              </p>
                            ) : null}
                            {row.industry?.trim() ? (
                              <p
                                style={{
                                  margin: "0 0 8px",
                                  fontSize: 12,
                                  color: mutedColor,
                                }}
                              >
                                Industry:{" "}
                                <span style={{ color: text }}>
                                  {row.industry}
                                </span>
                              </p>
                            ) : null}
                            {(row.skills?.length ?? 0) > 0 ? (
                              <div
                                style={{
                                  display: "flex",
                                  flexWrap: "wrap",
                                  gap: 6,
                                  marginBottom: 6,
                                }}
                              >
                                {(row.skills ?? []).map((t) => (
                                  <span
                                    key={`sk-${t}`}
                                    style={{
                                      fontSize: 11,
                                      padding: "4px 8px",
                                      borderRadius: 6,
                                      backgroundColor: bg,
                                      border: `1px solid ${border}`,
                                      color: text,
                                    }}
                                  >
                                    {t}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            {(row.methods?.length ?? 0) > 0 ? (
                              <div
                                style={{
                                  display: "flex",
                                  flexWrap: "wrap",
                                  gap: 6,
                                  marginBottom: 6,
                                }}
                              >
                                {(row.methods ?? []).map((t) => (
                                  <span
                                    key={`m-${t}`}
                                    style={{
                                      fontSize: 11,
                                      padding: "4px 8px",
                                      borderRadius: 6,
                                      backgroundColor: surface,
                                      border: `1px solid ${borderSubtle}`,
                                      color: text,
                                    }}
                                  >
                                    {t}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            {(row.tools?.length ?? 0) > 0 ? (
                              <div
                                style={{
                                  display: "flex",
                                  flexWrap: "wrap",
                                  gap: 6,
                                  marginBottom: 10,
                                }}
                              >
                                {(row.tools ?? []).map((t) => (
                                  <span
                                    key={`to-${t}`}
                                    style={{
                                      fontSize: 11,
                                      padding: "4px 8px",
                                      borderRadius: 6,
                                      backgroundColor: bg,
                                      border: `1px dashed ${borderSubtle}`,
                                      color: text,
                                    }}
                                  >
                                    {t}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              flexShrink: 0,
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => openEditExperience(row)}
                              style={{
                                ...btnGhost,
                                fontSize: 12,
                                padding: "6px 10px",
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setRefinerExperience(row)}
                              style={{
                                ...btnGhost,
                                fontSize: 12,
                                padding: "6px 10px",
                              }}
                            >
                              Refine evidence
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteExperience(row.id)}
                              style={{
                                ...btnGhost,
                                fontSize: 12,
                                padding: "6px 10px",
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                        <div
                          style={{
                            marginTop: 4,
                            paddingLeft: 12,
                            marginLeft: 4,
                            borderLeft: `2px solid ${borderSubtle}`,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              justifyContent: "space-between",
                              alignItems: "center",
                              gap: 8,
                              marginBottom: 8,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                letterSpacing: "0.05em",
                                textTransform: "uppercase",
                                color: mutedColor,
                              }}
                            >
                              Projects
                            </span>
                            <button
                              type="button"
                              onClick={() => openAddProject(row.id)}
                              style={{
                                ...btnGhost,
                                fontSize: 12,
                                padding: "5px 10px",
                              }}
                            >
                              + Add project
                            </button>
                          </div>
                          {(projectsByExperienceId[row.id] ?? []).length ===
                          0 ? (
                            <p
                              style={{
                                margin: 0,
                                fontSize: 13,
                                color: mutedColor,
                              }}
                            >
                              No projects added yet.
                            </p>
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
                              {(projectsByExperienceId[row.id] ?? []).map(
                                (proj) => (
                                  <li
                                    key={proj.id}
                                    style={{
                                      padding: "10px 12px",
                                      borderRadius: 8,
                                      backgroundColor: bg,
                                      border: `1px solid ${border}`,
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: "flex",
                                        flexWrap: "wrap",
                                        justifyContent: "space-between",
                                        gap: 8,
                                        alignItems: "flex-start",
                                      }}
                                    >
                                      <div style={{ minWidth: 0 }}>
                                        <div
                                          style={{
                                            fontWeight: 600,
                                            fontSize: 14,
                                            color: text,
                                          }}
                                        >
                                          {proj.project_name?.trim() ||
                                            "Untitled project"}
                                        </div>
                                        {proj.client?.trim() ? (
                                          <div
                                            style={{
                                              fontSize: 12,
                                              color: mutedColor,
                                              marginTop: 4,
                                            }}
                                          >
                                            Client:{" "}
                                            <span style={{ color: text }}>
                                              {proj.client}
                                            </span>
                                          </div>
                                        ) : null}
                                        {proj.role?.trim() ? (
                                          <div
                                            style={{
                                              fontSize: 12,
                                              color: mutedColor,
                                              marginTop: 4,
                                            }}
                                          >
                                            Role:{" "}
                                            <span style={{ color: text }}>
                                              {proj.role}
                                            </span>
                                          </div>
                                        ) : null}
                                        {projectDateRangeLabel(proj) ? (
                                          <div
                                            style={{
                                              fontSize: 12,
                                              color: mutedColor,
                                              marginTop: 4,
                                            }}
                                          >
                                            {projectDateRangeLabel(proj)}
                                          </div>
                                        ) : null}
                                        {proj.description?.trim() ? (
                                          <p
                                            style={{
                                              margin: "8px 0 0",
                                              fontSize: 13,
                                              color: text,
                                              lineHeight: 1.45,
                                            }}
                                          >
                                            {truncateText(
                                              proj.description,
                                              220
                                            )}
                                          </p>
                                        ) : null}
                                        {proj.industry?.trim() ? (
                                          <p
                                            style={{
                                              margin: "6px 0 0",
                                              fontSize: 11,
                                              color: mutedColor,
                                            }}
                                          >
                                            Industry:{" "}
                                            <span style={{ color: text }}>
                                              {proj.industry}
                                            </span>
                                          </p>
                                        ) : null}
                                        {(proj.skills?.length ?? 0) > 0 ? (
                                          <div
                                            style={{
                                              display: "flex",
                                              flexWrap: "wrap",
                                              gap: 6,
                                              marginTop: 8,
                                            }}
                                          >
                                            {(proj.skills ?? []).map((t) => (
                                              <span
                                                key={`psk-${t}`}
                                                style={{
                                                  fontSize: 10,
                                                  padding: "3px 7px",
                                                  borderRadius: 6,
                                                  backgroundColor: surface,
                                                  border: `1px solid ${borderSubtle}`,
                                                  color: text,
                                                }}
                                              >
                                                {t}
                                              </span>
                                            ))}
                                          </div>
                                        ) : null}
                                        {(proj.methods?.length ?? 0) > 0 ? (
                                          <div
                                            style={{
                                              display: "flex",
                                              flexWrap: "wrap",
                                              gap: 6,
                                              marginTop: 6,
                                            }}
                                          >
                                            {(proj.methods ?? []).map((t) => (
                                              <span
                                                key={`pm-${t}`}
                                                style={{
                                                  fontSize: 10,
                                                  padding: "3px 7px",
                                                  borderRadius: 6,
                                                  backgroundColor: bg,
                                                  border: `1px solid ${borderSubtle}`,
                                                  color: text,
                                                }}
                                              >
                                                {t}
                                              </span>
                                            ))}
                                          </div>
                                        ) : null}
                                        {(proj.tools?.length ?? 0) > 0 ? (
                                          <div
                                            style={{
                                              display: "flex",
                                              flexWrap: "wrap",
                                              gap: 6,
                                              marginTop: 6,
                                            }}
                                          >
                                            {(proj.tools ?? []).map((t) => (
                                              <span
                                                key={`pto-${t}`}
                                                style={{
                                                  fontSize: 10,
                                                  padding: "3px 7px",
                                                  borderRadius: 6,
                                                  backgroundColor: surface,
                                                  border: `1px dashed ${borderSubtle}`,
                                                  color: text,
                                                }}
                                              >
                                                {t}
                                              </span>
                                            ))}
                                          </div>
                                        ) : null}
                                      </div>
                                      <div
                                        style={{
                                          display: "flex",
                                          gap: 4,
                                          flexShrink: 0,
                                        }}
                                      >
                                        <button
                                          type="button"
                                          onClick={() =>
                                            openEditProject(proj)
                                          }
                                          style={{
                                            ...btnGhost,
                                            fontSize: 11,
                                            padding: "5px 8px",
                                          }}
                                        >
                                          Edit
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            void deleteProject(proj.id)
                                          }
                                          style={{
                                            ...btnGhost,
                                            fontSize: 11,
                                            padding: "5px 8px",
                                          }}
                                        >
                                          Delete
                                        </button>
                                      </div>
                                    </div>
                                  </li>
                                )
                              )}
                            </ul>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Evidence tags: skills, methods, tools (arrays) + industries (domain context) */}
      <section>
        <p style={{ ...sectionEyebrow, marginTop: 0 }}>
          Evidence tags
        </p>
        <p style={{ margin: "4px 0 10px", fontSize: 12, color: mutedColor }}>
          Analytical tags linked to roles and projects (including CV import). Four
          categories: specific <strong style={{ color: text }}>skills</strong>,
          transferable <strong style={{ color: text }}>methods</strong>, named{" "}
          <strong style={{ color: text }}>tools</strong>, and{" "}
          <strong style={{ color: text }}>industry</strong> context. Read-only here
          — edit the evidence row to change values. Suitable for later AI
          suggestions tied to a single role or project.
        </p>
        <div
          style={{
            ...card,
            marginTop: 0,
            padding: "12px 14px",
          }}
        >
          {!hasAnyEvidenceTags ? (
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: mutedColor,
                lineHeight: 1.55,
              }}
            >
              No tags yet. Add skills, methods, tools, or industries to your
              roles or import a CV.
            </p>
          ) : (
            <>
              {showEvidenceTagTopAllToggle ? (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: "flex-end",
                    gap: 6,
                    marginBottom: 12,
                  }}
                  role="group"
                  aria-label="Tag list scope"
                >
                  <button
                    type="button"
                    aria-pressed={evidenceTagSummaryScope === "top"}
                    onClick={() => setEvidenceTagSummaryScope("top")}
                    style={{
                      ...btnGhost,
                      fontSize: 11,
                      padding: "4px 9px",
                      opacity: evidenceTagSummaryScope === "top" ? 1 : 0.65,
                      borderColor:
                        evidenceTagSummaryScope === "top"
                          ? "rgba(110, 176, 240, 0.45)"
                          : borderSubtle,
                    }}
                  >
                    Top tags
                  </button>
                  <button
                    type="button"
                    aria-pressed={evidenceTagSummaryScope === "all"}
                    onClick={() => setEvidenceTagSummaryScope("all")}
                    style={{
                      ...btnGhost,
                      fontSize: 11,
                      padding: "4px 9px",
                      opacity: evidenceTagSummaryScope === "all" ? 1 : 0.65,
                      borderColor:
                        evidenceTagSummaryScope === "all"
                          ? "rgba(110, 176, 240, 0.45)"
                          : borderSubtle,
                    }}
                  >
                    All tags
                  </button>
                </div>
              ) : null}

              <div
                role="tablist"
                aria-label="Evidence tag categories"
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginBottom: 14,
                  rowGap: 8,
                }}
              >
                {(
                  [
                    ["skills", "Skills", skillSummary.length],
                    ["methods", "Methods", methodSummary.length],
                    ["tools", "Tools", toolSummary.length],
                    ["industries", "Industries", industrySummary.length],
                  ] as const
                ).map(([id, label, count]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={evidenceTagTab === id}
                    id={`evidence-tag-tab-${id}`}
                    onClick={() => selectEvidenceTagTab(id)}
                    style={{
                      ...btnGhost,
                      fontSize: 12,
                      padding: "6px 12px",
                      fontWeight: evidenceTagTab === id ? 600 : 500,
                      borderColor:
                        evidenceTagTab === id ? accent : borderSubtle,
                      opacity: evidenceTagTab === id ? 1 : 0.8,
                    }}
                  >
                    {label} ({count})
                  </button>
                ))}
              </div>

              <div
                key={evidenceTagTab}
                role="tabpanel"
                aria-labelledby={`evidence-tag-tab-${evidenceTagTab}`}
                className={styles.evidenceTagTabPanel}
              >
                {evidenceTagTab === "skills" ? (
                  <EvidenceTagChipPanel
                    rows={skillSummaryDisplayed}
                    details={skillEvidenceDetails}
                    expandedKey={expandedSkillDetailKey}
                    onToggleKey={setExpandedSkillDetailKey}
                    onRevealRole={revealExperienceRow}
                    detailKeyForLabel={(l) =>
                      normalizeSkillLabel(l).toLowerCase()
                    }
                    emptyHint="No skills in this view. Add tags on a role or project, switch to All tags, or import a CV."
                    whereBlurb="Appears on — open the role or project to edit tags."
                  />
                ) : null}
                {evidenceTagTab === "methods" ? (
                  <EvidenceTagChipPanel
                    rows={methodSummaryDisplayed}
                    details={methodEvidenceDetails}
                    expandedKey={expandedMethodDetailKey}
                    onToggleKey={setExpandedMethodDetailKey}
                    onRevealRole={revealExperienceRow}
                    detailKeyForLabel={(l) =>
                      normalizeSkillLabel(l).toLowerCase()
                    }
                    emptyHint="No methods in this view. Add methods on a role or project, switch to All tags, or import a CV."
                    whereBlurb="Appears on — open the role or project to edit tags."
                  />
                ) : null}
                {evidenceTagTab === "tools" ? (
                  <EvidenceTagChipPanel
                    rows={toolSummaryDisplayed}
                    details={toolEvidenceDetails}
                    expandedKey={expandedToolDetailKey}
                    onToggleKey={setExpandedToolDetailKey}
                    onRevealRole={revealExperienceRow}
                    detailKeyForLabel={(l) =>
                      normalizeSkillLabel(l).toLowerCase()
                    }
                    emptyHint="No tools in this view. Add tools on a role or project, switch to All tags, or import a CV."
                    whereBlurb="Appears on — open the role or project to edit tags."
                  />
                ) : null}
                {evidenceTagTab === "industries" ? (
                  <EvidenceTagChipPanel
                    rows={industrySummaryDisplayed}
                    details={industryEvidenceDetails}
                    expandedKey={expandedIndustryDetailKey}
                    onToggleKey={setExpandedIndustryDetailKey}
                    onRevealRole={revealExperienceRow}
                    detailKeyForLabel={(l) => l.trim().toLowerCase()}
                    emptyHint="No industries in this view. Set an industry on a role or project, or switch to All tags."
                    whereBlurb="Appears on — edit industry on the role or project."
                  />
                ) : null}
              </div>
            </>
          )}
        </div>
      </section>

        </div>
      </div>

      {/* Experience modal */}
      {expModal !== "closed" ? (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="exp-modal-title"
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
            if (e.target === e.currentTarget) closeExpModal();
          }}
        >
          <form
            onSubmit={submitExperience}
            style={{
              ...card,
              width: "100%",
              maxWidth: 440,
              marginTop: 24,
              display: "grid",
              gap: 12,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="exp-modal-title"
              style={{
                margin: 0,
                fontSize: 17,
                fontWeight: 600,
                color: text,
              }}
            >
              {expModal === "add" ? "Add experience" : "Edit experience"}
            </h3>
            <label style={labelStyle}>
              Role title *
              <input
                required
                value={expForm.role_title}
                onChange={(e) =>
                  setExpForm((f) => ({ ...f, role_title: e.target.value }))
                }
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Company / organisation *
              <input
                required
                value={expForm.organisation_name}
                onChange={(e) =>
                  setExpForm((f) => ({
                    ...f,
                    organisation_name: e.target.value,
                  }))
                }
                style={inputStyle}
              />
            </label>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
              }}
            >
              <label style={labelStyle}>
                Start date
                <input
                  type="date"
                  value={expForm.start_date}
                  onChange={(e) =>
                    setExpForm((f) => ({ ...f, start_date: e.target.value }))
                  }
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                End date
                <input
                  type="date"
                  value={expForm.end_date}
                  disabled={expForm.is_current}
                  onChange={(e) =>
                    setExpForm((f) => ({ ...f, end_date: e.target.value }))
                  }
                  style={{ ...inputStyle, opacity: expForm.is_current ? 0.5 : 1 }}
                />
              </label>
            </div>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                color: text,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={expForm.is_current}
                onChange={(e) =>
                  setExpForm((f) => ({
                    ...f,
                    is_current: e.target.checked,
                    end_date: e.target.checked ? "" : f.end_date,
                  }))
                }
              />
              I currently work here
            </label>
            <label style={labelStyle}>
              Summary
              <textarea
                value={expForm.description}
                onChange={(e) =>
                  setExpForm((f) => ({ ...f, description: e.target.value }))
                }
                rows={4}
                placeholder="What you did, scope, outcomes…"
                style={{
                  ...inputStyle,
                  resize: "vertical" as const,
                  fontFamily: "inherit",
                  lineHeight: 1.45,
                }}
              />
            </label>
            <label style={labelStyle}>
              Industry <span style={{ fontWeight: 400 }}>(optional)</span>
              <input
                value={expForm.industry}
                onChange={(e) =>
                  setExpForm((f) => ({ ...f, industry: e.target.value }))
                }
                placeholder="e.g. Healthcare, Financial services"
                style={inputStyle}
              />
            </label>
            <SkillTagInput
              label={
                <>
                  Skills{" "}
                  <span style={{ fontWeight: 400 }}>
                    (optional — specific capabilities)
                  </span>
                </>
              }
              skills={expForm.skills}
              onSkillsChange={(skills) =>
                setExpForm((f) => ({ ...f, skills }))
              }
              suggestionPool={skillSuggestionPool}
              placeholder="e.g. Requirements workshops, User story mapping"
            />
            <SkillTagInput
              label={
                <>
                  Methods / practices{" "}
                  <span style={{ fontWeight: 400 }}>(optional)</span>
                </>
              }
              skills={expForm.methods}
              onSkillsChange={(methods) =>
                setExpForm((f) => ({ ...f, methods }))
              }
              suggestionPool={methodSuggestionPool}
              placeholder="e.g. Scrum, Design Thinking"
            />
            <SkillTagInput
              label={
                <>
                  Tools / platforms{" "}
                  <span style={{ fontWeight: 400 }}>(optional)</span>
                </>
              }
              skills={expForm.tools}
              onSkillsChange={(tools) =>
                setExpForm((f) => ({ ...f, tools }))
              }
              suggestionPool={toolSuggestionPool}
              placeholder="e.g. Jira, Miro, Azure DevOps"
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <button type="submit" disabled={saving} style={{ ...btn, fontSize: 13 }}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={closeExpModal}
                style={{ ...btnGhost, fontSize: 13 }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {/* Qualification modal */}
      {qualModal !== "closed" ? (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="qual-modal-title"
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
            if (e.target === e.currentTarget) closeQualModal();
          }}
        >
          <form
            onSubmit={submitQualification}
            style={{
              ...card,
              width: "100%",
              maxWidth: 440,
              marginTop: 24,
              display: "grid",
              gap: 12,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="qual-modal-title"
              style={{
                margin: 0,
                fontSize: 17,
                fontWeight: 600,
                color: text,
              }}
            >
              {qualModal === "add"
                ? "Add qualification"
                : "Edit qualification"}
            </h3>
            <label style={labelStyle}>
              Title *
              <input
                required
                value={qualForm.title}
                onChange={(e) =>
                  setQualForm((f) => ({ ...f, title: e.target.value }))
                }
                placeholder="e.g. BSc Computer Science, Certified Scrum Master"
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Issuer / institution{" "}
              <span style={{ fontWeight: 400 }}>(optional)</span>
              <input
                value={qualForm.issuer}
                onChange={(e) =>
                  setQualForm((f) => ({ ...f, issuer: e.target.value }))
                }
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Type{" "}
              <span style={{ fontWeight: 400 }}>(optional)</span>
              <input
                value={qualForm.qualification_type}
                onChange={(e) =>
                  setQualForm((f) => ({
                    ...f,
                    qualification_type: e.target.value,
                  }))
                }
                placeholder="e.g. Degree, Professional diploma, Course"
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Date achieved{" "}
              <span style={{ fontWeight: 400 }}>(optional)</span>
              <input
                type="date"
                value={qualForm.date_achieved}
                onChange={(e) =>
                  setQualForm((f) => ({ ...f, date_achieved: e.target.value }))
                }
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Notes <span style={{ fontWeight: 400 }}>(optional)</span>
              <textarea
                value={qualForm.notes}
                onChange={(e) =>
                  setQualForm((f) => ({ ...f, notes: e.target.value }))
                }
                rows={3}
                style={{
                  ...inputStyle,
                  resize: "vertical" as const,
                  fontFamily: "inherit",
                  lineHeight: 1.45,
                }}
              />
            </label>
            <label style={labelStyle}>
              Credential URL{" "}
              <span style={{ fontWeight: 400 }}>(optional)</span>
              <input
                value={qualForm.credential_url}
                onChange={(e) =>
                  setQualForm((f) => ({ ...f, credential_url: e.target.value }))
                }
                placeholder="https://…"
                style={inputStyle}
              />
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <button type="submit" disabled={saving} style={{ ...btn, fontSize: 13 }}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={closeQualModal}
                style={{ ...btnGhost, fontSize: 13 }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {/* Certification modal */}
      {certModal !== "closed" ? (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="cert-modal-title"
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
            if (e.target === e.currentTarget) closeCertModal();
          }}
        >
          <form
            onSubmit={submitCertification}
            style={{
              ...card,
              width: "100%",
              maxWidth: 440,
              marginTop: 24,
              display: "grid",
              gap: 12,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="cert-modal-title"
              style={{
                margin: 0,
                fontSize: 17,
                fontWeight: 600,
                color: text,
              }}
            >
              {certModal === "add" ? "Add certification" : "Edit certification"}
            </h3>
            <label style={labelStyle}>
              Title *
              <input
                required
                value={certForm.title}
                onChange={(e) =>
                  setCertForm((f) => ({ ...f, title: e.target.value }))
                }
                placeholder="e.g. First aid, Site safety induction"
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Issuer{" "}
              <span style={{ fontWeight: 400 }}>(optional)</span>
              <input
                value={certForm.issuer}
                onChange={(e) =>
                  setCertForm((f) => ({ ...f, issuer: e.target.value }))
                }
                style={inputStyle}
              />
            </label>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
              }}
            >
              <label style={labelStyle}>
                Issue date{" "}
                <span style={{ fontWeight: 400 }}>(optional)</span>
                <input
                  type="date"
                  value={certForm.issue_date}
                  onChange={(e) =>
                    setCertForm((f) => ({ ...f, issue_date: e.target.value }))
                  }
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                Expiry date{" "}
                <span style={{ fontWeight: 400 }}>(optional)</span>
                <input
                  type="date"
                  value={certForm.expiry_date}
                  onChange={(e) =>
                    setCertForm((f) => ({ ...f, expiry_date: e.target.value }))
                  }
                  style={inputStyle}
                />
              </label>
            </div>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                color: text,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={certForm.renewal_required}
                onChange={(e) =>
                  setCertForm((f) => ({
                    ...f,
                    renewal_required: e.target.checked,
                  }))
                }
              />
              Renewal may be required
            </label>
            <label style={labelStyle}>
              Notes <span style={{ fontWeight: 400 }}>(optional)</span>
              <textarea
                value={certForm.notes}
                onChange={(e) =>
                  setCertForm((f) => ({ ...f, notes: e.target.value }))
                }
                rows={3}
                style={{
                  ...inputStyle,
                  resize: "vertical" as const,
                  fontFamily: "inherit",
                  lineHeight: 1.45,
                }}
              />
            </label>
            <label style={labelStyle}>
              Credential URL{" "}
              <span style={{ fontWeight: 400 }}>(optional)</span>
              <input
                value={certForm.credential_url}
                onChange={(e) =>
                  setCertForm((f) => ({ ...f, credential_url: e.target.value }))
                }
                placeholder="https://…"
                style={inputStyle}
              />
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <button type="submit" disabled={saving} style={{ ...btn, fontSize: 13 }}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={closeCertModal}
                style={{ ...btnGhost, fontSize: 13 }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {/* Project modal (one at a time; nested under a work experience) */}
      {projectModal.mode !== "closed" ? (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="project-modal-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "24px 16px",
            overflow: "auto",
            backgroundColor: "rgba(0,0,0,0.55)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeProjectModal();
          }}
        >
          <form
            onSubmit={submitProject}
            style={{
              ...card,
              width: "100%",
              maxWidth: 440,
              marginTop: 24,
              display: "grid",
              gap: 12,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="project-modal-title"
              style={{
                margin: 0,
                fontSize: 17,
                fontWeight: 600,
                color: text,
              }}
            >
              {projectModal.mode === "add" ? "Add project" : "Edit project"}
            </h3>
            <label style={labelStyle}>
              Project name *
              <input
                required
                value={projForm.project_name}
                onChange={(e) =>
                  setProjForm((f) => ({ ...f, project_name: e.target.value }))
                }
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Client <span style={{ fontWeight: 400 }}>(optional)</span>
              <input
                value={projForm.client}
                onChange={(e) =>
                  setProjForm((f) => ({ ...f, client: e.target.value }))
                }
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Your role on project{" "}
              <span style={{ fontWeight: 400 }}>(optional)</span>
              <input
                value={projForm.role}
                onChange={(e) =>
                  setProjForm((f) => ({ ...f, role: e.target.value }))
                }
                placeholder="e.g. Lead consultant"
                style={inputStyle}
              />
            </label>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
              }}
            >
              <label style={labelStyle}>
                Start date
                <input
                  type="date"
                  value={projForm.start_date}
                  onChange={(e) =>
                    setProjForm((f) => ({ ...f, start_date: e.target.value }))
                  }
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                End date
                <input
                  type="date"
                  value={projForm.end_date}
                  onChange={(e) =>
                    setProjForm((f) => ({ ...f, end_date: e.target.value }))
                  }
                  style={inputStyle}
                />
              </label>
            </div>
            <label style={labelStyle}>
              Description <span style={{ fontWeight: 400 }}>(optional)</span>
              <textarea
                value={projForm.description}
                onChange={(e) =>
                  setProjForm((f) => ({ ...f, description: e.target.value }))
                }
                rows={3}
                style={{
                  ...inputStyle,
                  resize: "vertical" as const,
                  fontFamily: "inherit",
                  lineHeight: 1.45,
                }}
              />
            </label>
            <label style={labelStyle}>
              Industry <span style={{ fontWeight: 400 }}>(optional)</span>
              <input
                value={projForm.industry}
                onChange={(e) =>
                  setProjForm((f) => ({ ...f, industry: e.target.value }))
                }
                style={inputStyle}
              />
            </label>
            <SkillTagInput
              label={
                <>
                  Skills{" "}
                  <span style={{ fontWeight: 400 }}>
                    (optional — specific capabilities)
                  </span>
                </>
              }
              skills={projForm.skills}
              onSkillsChange={(skills) =>
                setProjForm((f) => ({ ...f, skills }))
              }
              suggestionPool={skillSuggestionPool}
              placeholder="e.g. Workshop facilitation"
            />
            <SkillTagInput
              label={
                <>
                  Methods / practices{" "}
                  <span style={{ fontWeight: 400 }}>(optional)</span>
                </>
              }
              skills={projForm.methods}
              onSkillsChange={(methods) =>
                setProjForm((f) => ({ ...f, methods }))
              }
              suggestionPool={methodSuggestionPool}
              placeholder="e.g. Kanban"
            />
            <SkillTagInput
              label={
                <>
                  Tools / platforms{" "}
                  <span style={{ fontWeight: 400 }}>(optional)</span>
                </>
              }
              skills={projForm.tools}
              onSkillsChange={(tools) =>
                setProjForm((f) => ({ ...f, tools }))
              }
              suggestionPool={toolSuggestionPool}
              placeholder="e.g. Jira"
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <button type="submit" disabled={saving} style={{ ...btn, fontSize: 13 }}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={closeProjectModal}
                style={{ ...btnGhost, fontSize: 13 }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <WorkExperienceRefinerModal
        open={refinerExperience !== null}
        onClose={() => setRefinerExperience(null)}
        experience={refinerExperience}
        relatedProjects={
          refinerExperience
            ? (projectsByExperienceId[refinerExperience.id] ??
                EMPTY_RELATED_PROJECTS)
            : EMPTY_RELATED_PROJECTS
        }
        primaryAccountType={primaryAccountType}
        onApplySuggestions={(s) => {
          if (!refinerExperience) return;
          applyRefinementSuggestionToEditForm(refinerExperience, s);
        }}
      />
    </div>
  );
}
