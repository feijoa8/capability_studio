import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import type { FormEvent } from "react";
import { supabase } from "../lib/supabase";
import {
  bg,
  border,
  borderSubtle,
  btnPrimary,
  btnSecondary,
  errorColor,
  inputField,
  muted,
  mutedColor,
  panelShell,
  sectionSubtitle,
  gapTriPillStyle,
  surface,
  text,
} from "./hub/hubTheme";
import {
  COMPARISON_GRID,
  type JobRequirementRow,
  type LevelDef,
  type OrgUserCompetencyAssessmentRow,
  type OrgUserCompetencyRow,
  computeConfidence,
  confidenceTierColor,
  contributorConflictForCompetency,
  gapTriLabel,
  gapTriState,
  levelOrder,
  normalizeAssessmentRows,
  normalizeJobRequirementRows,
  normalizeOrgUserCompetencyRows,
  relevanceLabel,
  resolveCurrentLevelSource,
} from "./hub/competencyComparison";
import { canAccessWorkspaceAdminSurfaces } from "./hub/workspaceRoles";

type WorkspaceMemberRow = {
  id: string;
  user_id: string;
  workspace_role: string;
  membership_status: string;
  /** From optional `profiles` lookup */
  profile_email?: string | null;
  profile_display_name?: string | null;
  profile_first_name?: string | null;
  profile_last_name?: string | null;
  /** From `user_job_profiles` + `job_profiles` (same org) */
  assigned_job_profile_id?: string | null;
  assigned_job_profile_title?: string | null;
};

type ProfileLookupRow = {
  id: string;
  email?: string | null;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

type ProfileLike = {
  profile_display_name?: string | null;
  profile_first_name?: string | null;
  profile_last_name?: string | null;
  profile_email?: string | null;
  user_id: string;
};

/** Name-first: display_name → first+last → email → short id */
function getUserDisplayName(profile: ProfileLike): string {
  const displayName = profile.profile_display_name?.trim();
  if (displayName) return displayName;
  const fn = (profile.profile_first_name ?? "").trim();
  const ln = (profile.profile_last_name ?? "").trim();
  const combined = [fn, ln].filter(Boolean).join(" ");
  if (combined) return combined;
  const email = profile.profile_email?.trim();
  if (email) return email;
  return `${profile.user_id.slice(0, 8)}…`;
}

function getUserJobProfileLabel(user: WorkspaceMemberRow): string {
  const t = user.assigned_job_profile_title?.trim();
  if (t) return t;
  return "No assigned role";
}

/**
 * Dropdown: `You — {Name} — {Job}` or `{Name} — {Job}` (no workspace role).
 */
function buildMemberSelectorLabel(
  m: WorkspaceMemberRow,
  currentUserId: string | null
): string {
  const name = getUserDisplayName(m);
  const job = getUserJobProfileLabel(m);
  if (currentUserId && m.user_id === currentUserId) {
    return `You — ${name} — ${job}`;
  }
  return `${name} — ${job}`;
}

function canViewAllWorkspaceMembers(workspaceRole: string | null): boolean {
  return canAccessWorkspaceAdminSurfaces(workspaceRole);
}

const MANAGEMENT_PERMISSION_NOTE =
  "You can only manage your own profile unless you are a company admin or learning lead.";

function formatAssessedLevelDisplay(level: string | null | undefined): string {
  const t = level?.trim();
  return t ? t : "Not assessed";
}

function levelsDiffer(a: string | null, b: string | null): boolean {
  if (!a?.trim() || !b?.trim()) return false;
  return a.trim().toLowerCase() !== b.trim().toLowerCase();
}

function agreedByLabelFromProfile(p: {
  id: string;
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
  return p.email?.trim() || `${p.id.slice(0, 8)}…`;
}

function formatAgreedAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

type JobProfileRow = {
  id: string;
  title: string;
  level_name: string | null;
};

export type UsersSectionProps = {
  activeOrgId: string | null;
  isActive: boolean;
  workspaceRole: string | null;
};

export function UsersSection({
  activeOrgId,
  isActive,
  workspaceRole,
}: UsersSectionProps) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [members, setMembers] = useState<WorkspaceMemberRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const [jobProfiles, setJobProfiles] = useState<JobProfileRow[]>([]);
  const [assignedJobProfileId, setAssignedJobProfileId] = useState<
    string | null
  >(null);
  const [savingJobProfile, setSavingJobProfile] = useState(false);

  const [userCompetencies, setUserCompetencies] = useState<
    OrgUserCompetencyRow[]
  >([]);
  const [requiredCompetencies, setRequiredCompetencies] = useState<
    JobRequirementRow[]
  >([]);
  const [levelDefs, setLevelDefs] = useState<LevelDef[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [orgCompetencies, setOrgCompetencies] = useState<
    { id: string; name: string }[]
  >([]);
  const [selectedCompetencyId, setSelectedCompetencyId] = useState<
    string | null
  >(null);
  const [selectedUserLevel, setSelectedUserLevel] = useState<string | null>(
    null
  );
  const [managementContributorType, setManagementContributorType] = useState<
    "self" | "manager" | "learning_lead" | "admin"
  >("self");
  const [formLevelsLoading, setFormLevelsLoading] = useState(false);
  const [formLevelOptions, setFormLevelOptions] = useState<LevelDef[]>([]);
  const [savingCompetency, setSavingCompetency] = useState(false);
  const [savingAgreedCompetencyId, setSavingAgreedCompetencyId] = useState<
    string | null
  >(null);
  const [assessmentInputs, setAssessmentInputs] = useState<
    OrgUserCompetencyAssessmentRow[]
  >([]);
  const [agreedByDisplayNames, setAgreedByDisplayNames] = useState<
    Record<string, string>
  >({});
  const [selectedMemberTeamName, setSelectedMemberTeamName] = useState<
    string | null
  >(null);

  const currentWorkspaceRole = workspaceRole;

  const isSelf = useMemo(
    () =>
      Boolean(
        selectedUserId &&
          currentUserId &&
          selectedUserId === currentUserId
      ),
    [selectedUserId, currentUserId]
  );

  const isElevatedRole = useMemo(
    () => canAccessWorkspaceAdminSurfaces(workspaceRole),
    [workspaceRole]
  );

  const canManageSelectedMember = useMemo(
    () =>
      Boolean(
        selectedUserId &&
          currentUserId &&
          (isSelf || isElevatedRole)
      ),
    [selectedUserId, currentUserId, isSelf, isElevatedRole]
  );

  useEffect(() => {
    console.log(
      "[member_capability] currentWorkspaceRole:",
      currentWorkspaceRole
    );
    console.log("[member_capability] selectedUserId:", selectedUserId);
    console.log("[member_capability] currentUserId:", currentUserId);
    console.log(
      "[member_capability] canManageSelectedMember:",
      canManageSelectedMember
    );
  }, [
    currentWorkspaceRole,
    selectedUserId,
    currentUserId,
    canManageSelectedMember,
  ]);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id ?? null);
    });
  }, []);

  useEffect(() => {
    if (!activeOrgId || !selectedUserId || !isActive) {
      setSelectedMemberTeamName(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("user_team_assignments")
        .select("team_id")
        .eq("organisation_id", activeOrgId)
        .eq("user_id", selectedUserId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setSelectedMemberTeamName(null);
        return;
      }
      const tid = (data as { team_id: string }).team_id;
      const { data: team } = await supabase
        .from("teams")
        .select("name")
        .eq("id", tid)
        .maybeSingle();
      if (cancelled) return;
      setSelectedMemberTeamName(
        team && (team as { name: string }).name != null
          ? String((team as { name: string }).name)
          : null
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [activeOrgId, selectedUserId, isActive]);

  const loadMembersAndLists = useCallback(async () => {
    if (!activeOrgId || !isActive) return;

    setMembersLoading(true);
    setMembersError(null);
    setMembers([]);

    // 1) All active memberships for this org only — no auth.uid() filter
    const memRes = await supabase
      .from("workspace_memberships")
      .select("id, user_id, workspace_role, membership_status")
      .eq("organisation_id", activeOrgId)
      .eq("membership_status", "active")
      .order("user_id", { ascending: true })
      .limit(1000);

    const rawMemberships = (memRes.data as WorkspaceMemberRow[] | null) ?? [];
    console.log("[members] raw memberships:", rawMemberships);

    if (memRes.error) {
      console.error("[members] membership query error:", memRes.error);
      setMembersError(memRes.error.message);
      setMembers([]);
    } else {
      const seenUser = new Set<string>();
      let rows = rawMemberships.filter((r) => {
        if (seenUser.has(r.user_id)) return false;
        seenUser.add(r.user_id);
        return true;
      });

      const userIds = rows.map((r) => r.user_id);
      console.log("[members] userIds:", userIds);

      let rawProfiles: unknown = null;
      if (userIds.length > 0) {
        const profRes = await supabase
          .from("profiles")
          .select("id,email,display_name,first_name,last_name")
          .in("id", userIds);

        rawProfiles = profRes.data;
        console.log("[members] raw profiles:", rawProfiles);

        if (profRes.error) {
          console.warn(
            "[members] profiles query (optional):",
            profRes.error.message
          );
        } else if (profRes.data) {
          const pmap = new Map<string, ProfileLookupRow>(
            (profRes.data as ProfileLookupRow[]).map((p) => [p.id, p])
          );
          rows = rows.map((r) => {
            const p = pmap.get(r.user_id);
            return {
              ...r,
              profile_email: p?.email ?? undefined,
              profile_display_name: p?.display_name ?? undefined,
              profile_first_name: p?.first_name ?? undefined,
              profile_last_name: p?.last_name ?? undefined,
            };
          });
        }
      } else {
        console.log("[members] raw profiles:", null);
      }

      const [jpRes, compRes, ujpRes] = await Promise.all([
        supabase
          .from("job_profiles")
          .select("id, title, level_name")
          .eq("organisation_id", activeOrgId)
          .eq("is_active", true)
          .order("title"),
        supabase
          .from("competencies")
          .select("id, name")
          .eq("organisation_id", activeOrgId)
          .eq("status", "active")
          .order("name"),
        userIds.length > 0
          ? supabase
              .from("user_job_profiles")
              .select("user_id, job_profile_id")
              .eq("organisation_id", activeOrgId)
              .in("user_id", userIds)
          : Promise.resolve({
              data: [] as { user_id: string; job_profile_id: string | null }[],
              error: null as null,
            }),
      ]);

      const jobList = (jpRes.data as JobProfileRow[] | null) ?? [];
      const titleByJobId = new Map(
        jobList.map((j) => [j.id, j.title] as const)
      );

      if (!ujpRes.error && ujpRes.data) {
        const byUser = new Map<string, string | null>();
        for (const row of ujpRes.data as {
          user_id: string;
          job_profile_id: string | null;
        }[]) {
          byUser.set(row.user_id, row.job_profile_id);
        }
        rows = rows.map((r) => {
          const jid = byUser.get(r.user_id) ?? null;
          const title = jid ? titleByJobId.get(jid) ?? null : null;
          return {
            ...r,
            assigned_job_profile_id: jid,
            assigned_job_profile_title: title ?? undefined,
          };
        });
      }

      setMembers(rows);

      if (!jpRes.error) {
        setJobProfiles(jobList);
      } else {
        console.error(jpRes.error);
        setJobProfiles([]);
      }

      if (ujpRes.error) {
        console.warn("[members] user_job_profiles:", ujpRes.error.message);
      }

      if (!compRes.error) {
        setOrgCompetencies(
          (compRes.data as { id: string; name: string }[] | null) ?? []
        );
      } else {
        console.error(compRes.error);
        setOrgCompetencies([]);
      }
    }

    if (memRes.error) {
      const [jpRes, compRes] = await Promise.all([
        supabase
          .from("job_profiles")
          .select("id, title, level_name")
          .eq("organisation_id", activeOrgId)
          .eq("is_active", true)
          .order("title"),
        supabase
          .from("competencies")
          .select("id, name")
          .eq("organisation_id", activeOrgId)
          .eq("status", "active")
          .order("name"),
      ]);

      if (!jpRes.error) {
        setJobProfiles((jpRes.data as JobProfileRow[] | null) ?? []);
      } else {
        console.error(jpRes.error);
        setJobProfiles([]);
      }

      if (!compRes.error) {
        setOrgCompetencies(
          (compRes.data as { id: string; name: string }[] | null) ?? []
        );
      } else {
        console.error(compRes.error);
        setOrgCompetencies([]);
      }
    }

    setMembersLoading(false);
  }, [activeOrgId, isActive]);

  useEffect(() => {
    void loadMembersAndLists();
  }, [loadMembersAndLists]);

  const visibleMembers = useMemo(() => {
    if (canViewAllWorkspaceMembers(workspaceRole)) return members;
    if (!currentUserId) return [];
    return members.filter((m) => m.user_id === currentUserId);
  }, [members, workspaceRole, currentUserId]);

  useEffect(() => {
    if (visibleMembers.length === 0) return;
    const options = visibleMembers.map((m) => ({
      value: m.user_id,
      label: buildMemberSelectorLabel(m, currentUserId),
    }));
    console.log("[members] final member options:", options);
  }, [visibleMembers, currentUserId]);

  useEffect(() => {
    setSelectedUserId(null);
  }, [activeOrgId]);

  useLayoutEffect(() => {
    if (visibleMembers.length === 0) return;
    setSelectedUserId((prev) => {
      if (prev !== null && visibleMembers.some((m) => m.user_id === prev)) {
        return prev;
      }
      const me = visibleMembers.find((m) => m.user_id === currentUserId);
      return me?.user_id ?? visibleMembers[0].user_id;
    });
  }, [visibleMembers, currentUserId]);

  const loadUserDetail = useCallback(async () => {
    if (!activeOrgId || !selectedUserId) {
      setUserCompetencies([]);
      setAssessmentInputs([]);
      setRequiredCompetencies([]);
      setLevelDefs([]);
      setAssignedJobProfileId(null);
      return;
    }

    setDetailLoading(true);
    setDetailError(null);
    setUserCompetencies([]);
    setAssessmentInputs([]);
    setRequiredCompetencies([]);
    setLevelDefs([]);
    setAssignedJobProfileId(null);
    setAgreedByDisplayNames({});

    const [ucRes, jpAssignRes, assessRes] = await Promise.all([
      supabase
        .from("org_user_competencies")
        .select(
          "id, competency_id, current_level, assessment_source, updated_at, last_updated_by, competencies ( id, name )"
        )
        .eq("organisation_id", activeOrgId)
        .eq("user_id", selectedUserId),
      supabase
        .from("user_job_profiles")
        .select("job_profile_id")
        .eq("organisation_id", activeOrgId)
        .eq("user_id", selectedUserId)
        .maybeSingle(),
      supabase
        .from("org_user_competency_assessments")
        .select(
          "id, competency_id, contributor_type, contributor_user_id, assessed_level, created_at, competencies ( id, name )"
        )
        .eq("organisation_id", activeOrgId)
        .eq("user_id", selectedUserId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

    const ucData: OrgUserCompetencyRow[] = ucRes.error
      ? []
      : normalizeOrgUserCompetencyRows(ucRes.data);

    if (ucRes.error) {
      setDetailError(ucRes.error.message);
    }
    setUserCompetencies(ucData);

    const agreedByIds = [
      ...new Set(
        ucData
          .map((u) => u.last_updated_by)
          .filter((id): id is string => Boolean(id))
      ),
    ];
    if (agreedByIds.length > 0) {
      const pr = await supabase
        .from("profiles")
        .select("id, email, display_name, first_name, last_name")
        .in("id", agreedByIds);
      if (!pr.error && pr.data) {
        const map: Record<string, string> = {};
        for (const p of pr.data as ProfileLookupRow[]) {
          map[p.id] = agreedByLabelFromProfile({
            id: p.id,
            display_name: p.display_name,
            first_name: p.first_name,
            last_name: p.last_name,
            email: p.email,
          });
        }
        setAgreedByDisplayNames(map);
      }
    }

    const assessData: OrgUserCompetencyAssessmentRow[] = assessRes.error
      ? []
      : normalizeAssessmentRows(assessRes.data);
    if (assessRes.error) {
      console.error("Load assessments error:", assessRes.error);
      setDetailError((prev) =>
        prev
          ? `${prev}; ${assessRes.error!.message}`
          : assessRes.error!.message
      );
    }
    setAssessmentInputs(assessData);

    let jobId: string | null = null;
    if (jpAssignRes.error) {
      console.error(jpAssignRes.error);
      setDetailError((prev) =>
        prev
          ? `${prev}; ${jpAssignRes.error!.message}`
          : jpAssignRes.error!.message
      );
      setAssignedJobProfileId(null);
    } else {
      jobId = (jpAssignRes.data as { job_profile_id: string | null } | null)
        ?.job_profile_id ?? null;
      setAssignedJobProfileId(jobId);
    }

    let reqRows: JobRequirementRow[] = [];
    if (jobId) {
      const reqRes = await supabase
        .from("job_profile_competencies")
        .select(
          "competency_id, required_level, is_required, relevance, competencies ( id, name )"
        )
        .eq("job_profile_id", jobId);

      if (reqRes.error) {
        setDetailError((prev) =>
          prev ? `${prev}; ${reqRes.error!.message}` : reqRes.error!.message
        );
      } else {
        reqRows = normalizeJobRequirementRows(reqRes.data);
      }
    }
    setRequiredCompetencies(reqRows);

    const compIds = new Set<string>();
    for (const r of reqRows) compIds.add(r.competency_id);
    for (const u of ucData) compIds.add(u.competency_id);
    for (const a of assessData) compIds.add(a.competency_id);

    if (compIds.size === 0) {
      setLevelDefs([]);
      setDetailLoading(false);
      return;
    }

    const ldRes = await supabase
      .from("competency_level_definitions")
      .select("competency_id, level_name, level_order")
      .in("competency_id", [...compIds])
      .eq("is_active", true)
      .order("level_order", { ascending: true });

    if (ldRes.error) {
      console.error(ldRes.error);
      setLevelDefs([]);
    } else {
      setLevelDefs((ldRes.data as LevelDef[] | null) ?? []);
    }

    setDetailLoading(false);
  }, [activeOrgId, selectedUserId]);

  useEffect(() => {
    void loadUserDetail();
  }, [loadUserDetail]);

  useEffect(() => {
    if (!selectedCompetencyId) {
      setFormLevelOptions([]);
      setSelectedUserLevel(null);
      setFormLevelsLoading(false);
      return;
    }

    let cancelled = false;
    async function load() {
      setFormLevelsLoading(true);
      const res = await supabase
        .from("competency_level_definitions")
        .select("competency_id, level_name, level_order")
        .eq("competency_id", selectedCompetencyId)
        .eq("is_active", true)
        .order("level_order", { ascending: true });
      if (cancelled) return;
      if (res.error) {
        setFormLevelOptions([]);
      } else {
        setFormLevelOptions((res.data as LevelDef[] | null) ?? []);
      }
      setSelectedUserLevel(null);
      setFormLevelsLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedCompetencyId]);

  async function handleSaveJobProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeOrgId || !selectedUserId) return;
    if (!canManageSelectedMember) {
      alert(MANAGEMENT_PERMISSION_NOTE);
      return;
    }

    setSavingJobProfile(true);
    const { error } = await supabase.from("user_job_profiles").upsert(
      {
        organisation_id: activeOrgId,
        user_id: selectedUserId,
        job_profile_id: assignedJobProfileId || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organisation_id,user_id" }
    );
    setSavingJobProfile(false);
    if (error) {
      alert(error.message);
      return;
    }
    await loadUserDetail();
    await loadMembersAndLists();
  }

  async function handleSaveUserCompetency(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canManageSelectedMember) {
      alert(MANAGEMENT_PERMISSION_NOTE);
      return;
    }

    if (
      !selectedUserId ||
      !selectedCompetencyId ||
      !activeOrgId ||
      !currentUserId
    ) {
      alert("Please select a competency");
      return;
    }

    const contributor_type = managementContributorType;
    const assessedLevelStored = selectedUserLevel?.trim() ?? "";

    setSavingCompetency(true);
    const { error } = await supabase
      .from("org_user_competency_assessments")
      .insert({
        organisation_id: activeOrgId,
        user_id: selectedUserId,
        competency_id: selectedCompetencyId,
        contributor_type,
        contributor_user_id: currentUserId,
        assessed_level: assessedLevelStored,
        notes: null,
        is_active: true,
      });
    setSavingCompetency(false);

    if (error) {
      console.error("Save competency error:", error);
      alert(error.message || "Failed to save competency assessment");
      return;
    }

    setSelectedCompetencyId(null);
    setSelectedUserLevel(null);
    setManagementContributorType("self");
    await loadUserDetail();
  }

  async function handleSetAgreedLevel(competencyId: string, levelToStore: string) {
    if (!activeOrgId || !selectedUserId || !currentUserId) return;
    if (!canManageSelectedMember) {
      alert(MANAGEMENT_PERMISSION_NOTE);
      return;
    }
    const trimmed = levelToStore.trim();
    if (!trimmed) return;

    setSavingAgreedCompetencyId(competencyId);
    const now = new Date().toISOString();
    const { error } = await supabase.from("org_user_competencies").upsert(
      {
        organisation_id: activeOrgId,
        user_id: selectedUserId,
        competency_id: competencyId,
        current_level: trimmed,
        assessment_source: "agreed",
        last_updated_by: currentUserId,
        updated_at: now,
      },
      { onConflict: "organisation_id,user_id,competency_id" }
    );
    setSavingAgreedCompetencyId(null);

    if (error) {
      console.error("Set agreed level error:", error);
      alert(error.message || "Failed to save agreed level");
      return;
    }
    await loadUserDetail();
  }

  const requirementRows = useMemo(() => {
    return requiredCompetencies.map((req) => {
      const uc = userCompetencies.find(
        (u) => u.competency_id === req.competency_id
      );
      const {
        level: effectiveLevel,
        derivedLevel,
        isAgreed,
        weightedInputCount,
      } = resolveCurrentLevelSource(req.competency_id, uc, assessmentInputs);
      const confidence = computeConfidence(
        req.competency_id,
        isAgreed,
        assessmentInputs
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
      const hasDerived = Boolean(derivedLevel?.length);
      const canSetAgreed =
        !isAgreed && hasDerived && canManageSelectedMember;
      const currentLevelSubtext =
        !isAgreed && weightedInputCount > 0
          ? `Weighted from ${weightedInputCount} input${weightedInputCount === 1 ? "" : "s"}`
          : null;
      const conflict = contributorConflictForCompetency(
        req.competency_id,
        assessmentInputs
      );
      const agreedById = uc?.last_updated_by ?? null;
      const agreedByResolved = agreedById
        ? agreedByDisplayNames[agreedById] ?? `${agreedById.slice(0, 8)}…`
        : null;
      const agreedAtLabel = formatAgreedAt(uc?.updated_at);
      const agreedByLine = isAgreed
        ? `Agreed by ${agreedByResolved ?? "—"}`
        : null;
      const inputsDifferFromAgreed =
        isAgreed &&
        Boolean(derivedLevel?.length) &&
        levelsDiffer(derivedLevel, effectiveLevel);
      return {
        competency_id: req.competency_id,
        name,
        is_required: req.is_required,
        required_level: req.required_level,
        current_level: hasCurrentLevel ? effectiveLevel : null,
        derived_level: derivedLevel,
        current_level_subtext: currentLevelSubtext,
        confidence_tier: confidence.tier,
        confidence_label: confidence.label,
        is_agreed: isAgreed,
        can_set_agreed: canSetAgreed,
        level_for_agreed_save: hasDerived ? derivedLevel : null,
        gap_tri,
        relevance: req.relevance,
        relevance_label: relevanceLabel(req.relevance),
        input_conflict: conflict.hasConflict,
        input_conflict_detail: conflict.detailLine,
        agreed_by_line: agreedByLine,
        agreed_at_label: agreedAtLabel,
        inputs_differ_from_agreed: inputsDifferFromAgreed,
      };
    });
  }, [
    requiredCompetencies,
    userCompetencies,
    assessmentInputs,
    levelDefs,
    agreedByDisplayNames,
    selectedUserId,
    currentUserId,
    canManageSelectedMember,
  ]);

  const comparisonSummary = useMemo(() => {
    const rows = requirementRows;
    let below = 0;
    let meets = 0;
    let above = 0;
    let unassessed = 0;
    for (const r of rows) {
      switch (r.gap_tri) {
        case "below":
          below++;
          break;
        case "meets":
          meets++;
          break;
        case "above":
          above++;
          break;
        case "unassessed":
          unassessed++;
          break;
        default:
          break;
      }
    }
    return {
      total: rows.length,
      below,
      meets,
      above,
      unassessed,
    };
  }, [requirementRows]);

  const extraUserCompetencies = useMemo(() => {
    const reqIds = new Set(
      requiredCompetencies.map((r) => r.competency_id)
    );
    return userCompetencies.filter((u) => !reqIds.has(u.competency_id));
  }, [userCompetencies, requiredCompetencies]);

  const selectedMember = useMemo(
    () =>
      visibleMembers.find((m) => m.user_id === selectedUserId) ??
      members.find((m) => m.user_id === selectedUserId) ??
      null,
    [visibleMembers, members, selectedUserId]
  );

  const recentAssessmentInputs = useMemo(
    () => assessmentInputs.slice(0, 5),
    [assessmentInputs]
  );

  const scopeLimitedToSelf =
    !canViewAllWorkspaceMembers(workspaceRole) && members.length > 0;

  const assignedJobProfileLabel = useMemo(() => {
    if (!assignedJobProfileId) return null;
    const jp = jobProfiles.find((j) => j.id === assignedJobProfileId);
    if (!jp) return null;
    return jp.level_name ? `${jp.title} (${jp.level_name})` : jp.title;
  }, [assignedJobProfileId, jobProfiles]);

  const summaryJobLine = useMemo(() => {
    if (!selectedMember) return null;
    if (
      detailLoading &&
      !assignedJobProfileLabel &&
      !selectedMember.assigned_job_profile_title
    ) {
      return "Loading…";
    }
    if (assignedJobProfileLabel) return assignedJobProfileLabel;
    return getUserJobProfileLabel(selectedMember);
  }, [selectedMember, assignedJobProfileLabel, detailLoading]);

  if (!activeOrgId) {
    return (
      <div style={panelShell}>
        <p style={{ margin: 0 }}>No workspace selected.</p>
      </div>
    );
  }

  return (
    <div style={{ ...panelShell, marginTop: 0 }}>
      <p style={{ margin: "0 0 8px", fontWeight: 600, color: text, fontSize: 15.5, letterSpacing: "-0.02em" }}>
        Member Capability
      </p>
      <p style={{ ...sectionSubtitle, marginBottom: 16 }}>
        Review role alignment, competency evidence, and assessment inputs for
        members.
      </p>
      {membersLoading ? (
        <p style={{ ...muted, margin: 0 }}>Loading members…</p>
      ) : membersError ? (
        <p style={{ margin: 0, color: errorColor }}>{membersError}</p>
      ) : members.length === 0 ? (
        <p style={{ ...muted, margin: 0 }}>No active members in this workspace.</p>
      ) : visibleMembers.length === 0 ? (
        <p style={{ ...muted, margin: 0 }}>
          {!currentUserId
            ? "Loading…"
            : "No members available for your access scope."}
        </p>
      ) : (
        <label
          style={{
            display: "grid",
            gap: 8,
            marginBottom: 12,
            maxWidth: 480,
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: text,
            }}
          >
            Selected workspace member
          </span>
          <select
            value={selectedUserId ?? ""}
            onChange={(e) => setSelectedUserId(e.target.value || null)}
            disabled={membersLoading}
            style={{
              ...inputField,
              width: "100%",
              maxWidth: 480,
              cursor: "pointer",
            }}
          >
            {visibleMembers.map((m) => (
              <option key={m.id} value={m.user_id}>
                {buildMemberSelectorLabel(m, currentUserId)}
              </option>
            ))}
          </select>
          {scopeLimitedToSelf && (
            <span style={{ fontSize: 12, color: mutedColor, lineHeight: 1.45 }}>
              Only your own profile is shown. Company admins and learning leads
              can view all workspace members.
            </span>
          )}
        </label>
      )}

      {!membersLoading &&
        visibleMembers.length > 0 &&
        !selectedUserId && (
          <p
            style={{
              margin: "12px 0 0",
              padding: "14px 16px",
              borderRadius: 10,
              border: `1px solid ${borderSubtle}`,
              backgroundColor: surface,
              color: mutedColor,
              fontSize: 14,
              lineHeight: 1.5,
              maxWidth: 520,
            }}
          >
            Select a workspace member to view role requirements and assessments.
          </p>
        )}

      {selectedUserId && (
        <>
          <div
            style={{
              marginBottom: 16,
              padding: "12px 14px",
              borderRadius: 10,
              border: `1px solid ${border}`,
              backgroundColor: surface,
              maxWidth: 560,
            }}
          >
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
              Selected member
            </p>
            <p
              style={{
                margin: 0,
                fontSize: 17,
                fontWeight: 600,
                color: text,
                lineHeight: 1.35,
                letterSpacing: "-0.02em",
              }}
            >
              {selectedMember
                ? getUserDisplayName(selectedMember)
                : `${selectedUserId.slice(0, 8)}…`}
              {selectedUserId === currentUserId ? (
                <span style={{ color: mutedColor, fontWeight: 500, fontSize: 14 }}>
                  {" "}
                  (you)
                </span>
              ) : null}
            </p>
            <p
              style={{
                margin: "8px 0 0",
                fontSize: 14,
                fontWeight: 500,
                color: text,
                lineHeight: 1.4,
              }}
            >
              {summaryJobLine ?? "—"}
            </p>
            {selectedMember?.profile_email?.trim() ? (
              <p
                style={{
                  margin: "6px 0 0",
                  fontSize: 12,
                  color: mutedColor,
                  lineHeight: 1.4,
                }}
              >
                {selectedMember.profile_email.trim()}
              </p>
            ) : null}
            <p
              style={{
                margin: "8px 0 0",
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: mutedColor,
              }}
            >
              Workspace role: {selectedMember?.workspace_role ?? "—"}
            </p>
            {selectedMemberTeamName ? (
              <p
                style={{
                  margin: "6px 0 0",
                  fontSize: 12,
                  color: mutedColor,
                  lineHeight: 1.4,
                }}
              >
                Primary team:{" "}
                <span style={{ color: text, fontWeight: 500 }}>
                  {selectedMemberTeamName}
                </span>
              </p>
            ) : null}
            <p
              style={{
                margin: "10px 0 0",
                fontSize: 11,
                fontWeight: 500,
                color: canManageSelectedMember ? "#8fd4a8" : mutedColor,
                lineHeight: 1.4,
              }}
            >
              {canManageSelectedMember
                ? "Management access: enabled"
                : "Management access: restricted"}
            </p>
          </div>

          <div
            style={{
              marginTop: 0,
              paddingTop: 12,
              borderTop: `1px solid ${border}`,
            }}
          >
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
              Job profile assignment
            </p>
            <form
              onSubmit={(e) => void handleSaveJobProfile(e)}
              style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}
            >
              <label
                style={{
                  display: "grid",
                  gap: 6,
                  fontSize: 13,
                  color: mutedColor,
                  minWidth: 200,
                }}
              >
                Assigned profile
                <select
                  value={assignedJobProfileId ?? ""}
                  onChange={(e) =>
                    setAssignedJobProfileId(e.target.value || null)
                  }
                  disabled={!canManageSelectedMember || savingJobProfile}
                  style={{
                    padding: "8px 10px",
                    fontSize: 14,
                    color: text,
                    backgroundColor: bg,
                    border: `1px solid ${border}`,
                    borderRadius: 8,
                  }}
                >
                  <option value="">— None —</option>
                  {jobProfiles.map((jp) => (
                    <option key={jp.id} value={jp.id}>
                      {jp.title}
                      {jp.level_name ? ` (${jp.level_name})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={!canManageSelectedMember || savingJobProfile}
                style={btnPrimary}
              >
                {savingJobProfile ? "Saving…" : "Save assignment"}
              </button>
            </form>
            {!canManageSelectedMember && (
              <p style={{ ...muted, margin: "8px 0 0", fontSize: 13 }}>
                {MANAGEMENT_PERMISSION_NOTE}
              </p>
            )}
          </div>

          {detailLoading ? (
            <p style={{ ...muted, marginTop: 16 }}>Loading competency data…</p>
          ) : (
            <>
              {detailError && (
                <p style={{ color: errorColor, marginTop: 16 }}>{detailError}</p>
              )}
              <p
                style={{
                  margin: "18px 0 6px",
                  fontSize: 15,
                  fontWeight: 600,
                  color: text,
                  letterSpacing: "-0.02em",
                }}
              >
                Role requirements vs current
              </p>
              {requiredCompetencies.length > 0 && (
                <p
                  style={{
                    margin: "0 0 14px",
                    fontSize: 12,
                    color: mutedColor,
                    lineHeight: 1.5,
                  }}
                >
                  {comparisonSummary.total} required · Below{" "}
                  {comparisonSummary.below} · Meets {comparisonSummary.meets} ·
                  Above {comparisonSummary.above}
                  {comparisonSummary.unassessed > 0
                    ? ` · Unassessed ${comparisonSummary.unassessed}`
                    : ""}
                </p>
              )}
              {requiredCompetencies.length === 0 ? (
                <p style={{ ...muted, margin: 0, fontSize: 13 }}>
                  {assignedJobProfileId
                    ? "No competencies linked to this job profile yet."
                    : "Assign a job profile to compare required competencies."}
                </p>
              ) : (
                <div
                  style={{
                    border: `1px solid ${border}`,
                    borderRadius: 10,
                    overflow: "hidden",
                    backgroundColor: surface,
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: COMPARISON_GRID,
                      gap: 12,
                      alignItems: "center",
                      padding: "10px 14px",
                      borderBottom: `1px solid ${border}`,
                      backgroundColor: "rgba(255,255,255,0.03)",
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: "#6b7588",
                    }}
                  >
                    <span>Competency</span>
                    <span>Required</span>
                    <span>Current</span>
                    <span>Gap</span>
                    <span>Relevance</span>
                    <span>Confidence</span>
                  </div>
                  {requirementRows.map((row, idx) => (
                    <div
                      key={row.competency_id}
                      style={{
                        borderBottom:
                          idx < requirementRows.length - 1
                            ? `1px solid ${borderSubtle}`
                            : "none",
                        backgroundColor: bg,
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: COMPARISON_GRID,
                          gap: 12,
                          alignItems: "start",
                          padding: "12px 14px",
                          fontSize: 13,
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontWeight: 600,
                              color: text,
                              fontSize: 13,
                              lineHeight: 1.35,
                            }}
                          >
                            {row.name}
                          </div>
                          <div
                            style={{
                              marginTop: 6,
                              display: "flex",
                              flexWrap: "wrap",
                              gap: 6,
                              alignItems: "center",
                            }}
                          >
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 600,
                                letterSpacing: "0.06em",
                                textTransform: "uppercase",
                                color: mutedColor,
                              }}
                            >
                              {row.is_required ? "Required" : "Optional"}
                            </span>
                            {row.is_agreed && (
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 600,
                                  letterSpacing: "0.06em",
                                  textTransform: "uppercase",
                                  color: "#8fd4a8",
                                  padding: "2px 7px",
                                  borderRadius: 5,
                                  border: `1px solid rgba(110, 200, 150, 0.28)`,
                                  backgroundColor: "rgba(110, 200, 150, 0.1)",
                                }}
                              >
                                Agreed
                              </span>
                            )}
                          </div>
                        </div>
                        <div style={{ color: text, paddingTop: 2 }}>
                          {row.required_level ?? "—"}
                        </div>
                        <div style={{ paddingTop: 2 }}>
                          {row.is_agreed ? (
                            <>
                              <div
                                style={{
                                  color: text,
                                  fontWeight: 600,
                                  lineHeight: 1.35,
                                }}
                              >
                                Agreed level: {row.current_level ?? "—"}
                              </div>
                              {row.agreed_by_line ? (
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: mutedColor,
                                    marginTop: 4,
                                    lineHeight: 1.35,
                                  }}
                                >
                                  {row.agreed_by_line}
                                </div>
                              ) : null}
                              {row.agreed_at_label ? (
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: mutedColor,
                                    marginTop: 2,
                                    lineHeight: 1.35,
                                  }}
                                >
                                  Recorded {row.agreed_at_label}
                                </div>
                              ) : null}
                              {row.inputs_differ_from_agreed ? (
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: "#c9a227",
                                    marginTop: 6,
                                    lineHeight: 1.35,
                                  }}
                                >
                                  New inputs differ from agreed level
                                </div>
                              ) : null}
                              {row.derived_level ? (
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: mutedColor,
                                    marginTop: 4,
                                    lineHeight: 1.35,
                                  }}
                                >
                                  Input-derived: {row.derived_level}
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <>
                              <div
                                style={{
                                  fontSize: 11,
                                  color: mutedColor,
                                  marginBottom: 4,
                                  lineHeight: 1.3,
                                }}
                              >
                                Current level (derived)
                              </div>
                              <div style={{ color: text }}>
                                {row.current_level ?? "—"}
                              </div>
                              {row.current_level_subtext ? (
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: mutedColor,
                                    marginTop: 4,
                                    lineHeight: 1.35,
                                  }}
                                >
                                  {row.current_level_subtext}
                                </div>
                              ) : null}
                            </>
                          )}
                        </div>
                        <div style={{ paddingTop: 2 }}>
                          <span
                            style={{
                              display: "inline-block",
                              fontSize: 10,
                              fontWeight: 600,
                              letterSpacing: "0.05em",
                              textTransform: "uppercase",
                              padding: "5px 10px",
                              borderRadius: 6,
                              ...gapTriPillStyle(row.gap_tri),
                            }}
                          >
                            {gapTriLabel(row.gap_tri)}
                          </span>
                        </div>
                        <div
                          style={{
                            paddingTop: 2,
                            color: text,
                            fontSize: 13,
                            fontWeight: 500,
                          }}
                        >
                          {row.relevance_label}
                        </div>
                        <div style={{ paddingTop: 2 }}>
                          <div
                            style={{
                              color: confidenceTierColor(row.confidence_tier),
                              fontWeight: 600,
                              fontSize: 13,
                            }}
                          >
                            {row.confidence_tier}
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: mutedColor,
                              marginTop: 2,
                              lineHeight: 1.3,
                            }}
                          >
                            {row.confidence_label}
                          </div>
                          {row.input_conflict && (
                            <>
                              <div
                                style={{
                                  marginTop: 8,
                                  fontSize: 10,
                                  fontWeight: 600,
                                  letterSpacing: "0.04em",
                                  textTransform: "uppercase",
                                  color: "#c9a227",
                                }}
                              >
                                Conflicting inputs
                              </div>
                              {row.input_conflict_detail ? (
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: mutedColor,
                                    marginTop: 4,
                                    lineHeight: 1.35,
                                  }}
                                >
                                  {row.input_conflict_detail}
                                </div>
                              ) : null}
                            </>
                          )}
                        </div>
                      </div>
                      {row.can_set_agreed ? (
                        <div
                          style={{
                            padding: "0 14px 12px 14px",
                          }}
                        >
                          <button
                            type="button"
                            disabled={
                              !canManageSelectedMember ||
                              savingAgreedCompetencyId === row.competency_id
                            }
                            onClick={() =>
                              void handleSetAgreedLevel(
                                row.competency_id,
                                row.level_for_agreed_save ?? ""
                              )
                            }
                            style={{
                              ...btnSecondary,
                              fontSize: 12,
                              padding: "6px 12px",
                            }}
                          >
                            {savingAgreedCompetencyId === row.competency_id
                              ? "Saving…"
                              : "Set as agreed level"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}

              <p
                style={{
                  margin: "20px 0 8px",
                  fontSize: 15,
                  fontWeight: 600,
                  color: text,
                  letterSpacing: "-0.02em",
                }}
              >
                Recent assessment inputs for this member
              </p>
              <p style={{ ...muted, margin: "0 0 10px", fontSize: 12 }}>
                Newest first · last five
              </p>
              {recentAssessmentInputs.length === 0 ? (
                <p style={{ ...muted, margin: "0 0 8px", fontSize: 13 }}>
                  No assessment inputs yet for this member.
                </p>
              ) : (
                <ul
                  style={{
                    margin: "0 0 16px",
                    padding: 0,
                    listStyle: "none",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  {recentAssessmentInputs.map((a) => {
                    const label =
                      a.competency_name?.trim() ||
                      orgCompetencies.find((c) => c.id === a.competency_id)
                        ?.name ||
                      `${a.competency_id.slice(0, 8)}…`;
                    const when = a.created_at
                      ? new Date(a.created_at).toLocaleString(undefined, {
                          dateStyle: "short",
                          timeStyle: "short",
                        })
                      : "—";
                    return (
                      <li
                        key={a.id}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 8,
                          backgroundColor: bg,
                          border: `1px solid ${border}`,
                          fontSize: 13,
                          color: text,
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{label}</span>
                        <span style={{ color: mutedColor }}>
                          {" "}
                          · {a.contributor_type} ·{" "}
                          {formatAssessedLevelDisplay(a.assessed_level)}
                        </span>
                        <div style={{ ...muted, marginTop: 4, fontSize: 12 }}>
                          {when}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {extraUserCompetencies.length > 0 && (
                <>
                  <p
                    style={{
                      margin: "20px 0 8px",
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: mutedColor,
                    }}
                  >
                    Additional competencies (not in role profile)
                  </p>
                  <ul
                    style={{
                      margin: 0,
                      padding: 0,
                      listStyle: "none",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    {extraUserCompetencies.map((u) => {
                      const label =
                        u.competency_name?.trim() ||
                        orgCompetencies.find((c) => c.id === u.competency_id)
                          ?.name ||
                        `${u.competency_id.slice(0, 8)}…`;
                      return (
                      <li
                        key={u.competency_id}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 8,
                          backgroundColor: bg,
                          border: `1px solid ${border}`,
                          fontSize: 13,
                          color: text,
                        }}
                      >
                        {label} · {u.current_level} ·{" "}
                        <span style={{ color: mutedColor }}>
                          {u.assessment_source}
                        </span>
                      </li>
                    );
                    })}
                  </ul>
                </>
              )}

              <p
                style={{
                  margin: "20px 0 6px",
                  fontSize: 15,
                  fontWeight: 600,
                  color: text,
                  letterSpacing: "-0.02em",
                }}
              >
                Add competency / assessment
              </p>
              <p
                style={{
                  margin: "0 0 12px",
                  fontSize: 12,
                  color: mutedColor,
                  lineHeight: 1.45,
                }}
              >
                You can assign a competency without assessing it yet. Applies to
                the member selected above; your contributor role is stored with
                each entry.
              </p>
              {!canManageSelectedMember ? (
                <p style={{ ...muted, margin: "0 0 12px", fontSize: 13 }}>
                  {MANAGEMENT_PERMISSION_NOTE}
                </p>
              ) : null}
              <form
                onSubmit={(e) => void handleSaveUserCompetency(e)}
                style={{
                  display: "grid",
                  gap: 10,
                  maxWidth: 420,
                  padding: 12,
                  borderRadius: 8,
                  backgroundColor: bg,
                  border: `1px solid ${border}`,
                }}
              >
                <label
                  style={{
                    display: "grid",
                    gap: 6,
                    fontSize: 13,
                    color: mutedColor,
                  }}
                >
                  Competency
                  <select
                    required
                    value={selectedCompetencyId ?? ""}
                    onChange={(e) =>
                      setSelectedCompetencyId(e.target.value || null)
                    }
                    disabled={!canManageSelectedMember || savingCompetency}
                    style={{
                      padding: "8px 10px",
                      fontSize: 14,
                      color: text,
                      backgroundColor: surface,
                      border: `1px solid ${border}`,
                      borderRadius: 8,
                    }}
                  >
                    <option value="">Select…</option>
                    {orgCompetencies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label
                  style={{
                    display: "grid",
                    gap: 6,
                    fontSize: 13,
                    color: mutedColor,
                  }}
                >
                  Level (optional)
                  <select
                    value={selectedUserLevel ?? ""}
                    onChange={(e) =>
                      setSelectedUserLevel(e.target.value || null)
                    }
                    disabled={
                      !canManageSelectedMember ||
                      savingCompetency ||
                      formLevelsLoading ||
                      !selectedCompetencyId
                    }
                    style={{
                      padding: "8px 10px",
                      fontSize: 14,
                      color: text,
                      backgroundColor: surface,
                      border: `1px solid ${border}`,
                      borderRadius: 8,
                    }}
                  >
                    <option value="">
                      {formLevelsLoading
                        ? "Loading levels…"
                        : "Not assessed (optional)"}
                    </option>
                    {formLevelOptions.map((ld) => (
                      <option key={ld.level_name} value={ld.level_name}>
                        {ld.level_order}. {ld.level_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label
                  style={{
                    display: "grid",
                    gap: 6,
                    fontSize: 13,
                    color: mutedColor,
                  }}
                >
                  Your role as assessor
                  <select
                    value={managementContributorType}
                    onChange={(e) =>
                      setManagementContributorType(
                        e.target.value as
                          | "self"
                          | "manager"
                          | "learning_lead"
                          | "admin"
                      )
                    }
                    disabled={!canManageSelectedMember || savingCompetency}
                    style={{
                      padding: "8px 10px",
                      fontSize: 14,
                      color: text,
                      backgroundColor: surface,
                      border: `1px solid ${border}`,
                      borderRadius: 8,
                      maxWidth: 280,
                    }}
                  >
                    <option value="self">Self</option>
                    <option value="manager">Manager</option>
                    <option value="learning_lead">Learning lead</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
                <button
                  type="submit"
                  disabled={
                    !canManageSelectedMember ||
                    savingCompetency ||
                    !selectedCompetencyId
                  }
                  style={{ ...btnPrimary, justifySelf: "start" }}
                >
                  {savingCompetency ? "Saving…" : "Save"}
                </button>
              </form>
            </>
          )}
        </>
      )}
    </div>
  );
}
