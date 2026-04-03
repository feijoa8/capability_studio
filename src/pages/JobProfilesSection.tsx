import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "../lib/supabase";
import {
  refineJobProfileWithCompanyContext,
  type JobProfileRefinementResult,
} from "../lib/jobProfileRefinement";
import type {
  JobFamilyRow,
  JobProfileRow,
  JobProfileCompetencyMappingRow,
  JobProfileCompetencyRelevance,
  JobProfileRequirementRow,
  JobProfileResponsibilityRow,
  JobProfileSkillRow,
  CompetencyLevelDefinitionRow,
  OrganisationProfileRow,
} from "./hub/types";
import {
  normalizeJobProfileCompetencyRows,
  normalizeJobProfileLevelName,
  uncategorisedJobProfiles,
  UNCATEGORISED_HEADING,
} from "./hub/hubUtils";
import { AccordionCollapsible } from "./hub/AccordionCollapsible";
import {
  accent,
  bg,
  border,
  borderSubtle,
  btn,
  btnGhost,
  btnPrimary,
  errorColor,
  muted,
  mutedColor,
  panelShell,
  profileCardShell,
  sectionEyebrow,
  surface,
  surfaceHover,
  text,
} from "./hub/hubTheme";

export type JobProfilesSectionProps = {
  activeOrgId: string | null;
  isActive: boolean;
};

/** Pseudo-id for the uncategorised job profiles accordion section */
const UNCATEGORISED_ACCORDION_ID = "__uncategorised__";

function nextOrderIndex(rows: { order_index: number }[]): number {
  if (rows.length === 0) return 0;
  return Math.max(...rows.map((r) => r.order_index)) + 1;
}

/** Fields from company profile that ground job profile work (read-only in Job Profiles UI). */
function organisationProfileJobContextRows(
  row: OrganisationProfileRow | null
): { label: string; value: string }[] {
  if (!row) return [];
  const out: { label: string; value: string }[] = [];
  const add = (label: string, v: string | null | undefined) => {
    const t = v?.trim();
    if (t) out.push({ label, value: t });
  };
  add("Sector", row.sector);
  add("Industry", row.industry);
  add("Delivery context", row.delivery_context);
  add("Capability emphasis", row.capability_emphasis);
  add("Role interpretation guidance", row.role_interpretation_guidance);
  add("Terminology guidance", row.terminology_guidance);
  return out;
}

export function JobProfilesSection({
  activeOrgId,
  isActive,
}: JobProfilesSectionProps) {
  const [jobProfiles, setJobProfiles] = useState<JobProfileRow[]>([]);
  const [jobProfilesLoading, setJobProfilesLoading] = useState(false);
  const [jobProfilesError, setJobProfilesError] = useState<string | null>(null);
  const [jobFamiliesError, setJobFamiliesError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newLevel, setNewLevel] = useState("");
  const [jobFamilies, setJobFamilies] = useState<JobFamilyRow[]>([]);
  const [selectedJobFamilyId, setSelectedJobFamilyId] = useState("");
  const [jobProfileSaving, setJobProfileSaving] = useState(false);
  const [showCreateFamilyForm, setShowCreateFamilyForm] = useState(false);
  const [newFamilyName, setNewFamilyName] = useState("");
  const [isSavingFamily, setIsSavingFamily] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editLevel, setEditLevel] = useState("");
  const [editJobFamilyId, setEditJobFamilyId] = useState("");
  const [editProfileSaving, setEditProfileSaving] = useState(false);
  const [showArchivedJobProfiles, setShowArchivedJobProfiles] = useState(false);
  const [archivingProfileId, setArchivingProfileId] = useState<string | null>(
    null
  );
  const [restoringProfileId, setRestoringProfileId] = useState<string | null>(
    null
  );
  const [selectedJobProfileId, setSelectedJobProfileId] = useState<string | null>(
    null
  );
  const [mappingCompetencies, setMappingCompetencies] = useState<
    { id: string; name: string }[]
  >([]);
  const [jobProfileCompetencies, setJobProfileCompetencies] = useState<
    JobProfileCompetencyMappingRow[]
  >([]);
  const [mappingPanelLoading, setMappingPanelLoading] = useState(false);
  const [selectedCompetencyId, setSelectedCompetencyId] = useState("");
  const [availableLevelDefinitions, setAvailableLevelDefinitions] = useState<
    CompetencyLevelDefinitionRow[]
  >([]);
  const [assignmentLevelDefinitionsLoading, setAssignmentLevelDefinitionsLoading] =
    useState(false);
  const [selectedRequiredLevel, setSelectedRequiredLevel] = useState("");
  const [selectedRelevance, setSelectedRelevance] =
    useState<JobProfileCompetencyRelevance>("medium");
  const [mapIsRequired, setMapIsRequired] = useState(true);
  const [isSavingMapping, setIsSavingMapping] = useState(false);
  /** Add-new competency expectation form (hidden until user clicks Add) */
  const [showAddCompetencyExpectationForm, setShowAddCompetencyExpectationForm] =
    useState(false);
  const [removingMappingId, setRemovingMappingId] = useState<string | null>(
    null
  );
  /** Row currently saving (required level, relevance, or is_required) */
  const [updatingMappingId, setUpdatingMappingId] = useState<string | null>(
    null
  );
  /** Brief “Saved” flash after autosave succeeds (`key` restarts animation on repeat) */
  const [competencyMappingSavedFlash, setCompetencyMappingSavedFlash] =
    useState<{ id: string; key: number } | null>(null);
  const [hoveredMappingId, setHoveredMappingId] = useState<string | null>(null);
  /** Level definitions keyed by competency_id for expectation rows */
  const [levelDefsByCompetencyId, setLevelDefsByCompetencyId] = useState<
    Record<string, CompetencyLevelDefinitionRow[]>
  >({});

  const [profileResponsibilities, setProfileResponsibilities] = useState<
    JobProfileResponsibilityRow[]
  >([]);
  const [profileRequirements, setProfileRequirements] = useState<
    JobProfileRequirementRow[]
  >([]);
  const [profileSkills, setProfileSkills] = useState<JobProfileSkillRow[]>([]);
  const [jobProfileHrLoading, setJobProfileHrLoading] = useState(false);
  const [hrMutating, setHrMutating] = useState(false);
  const [draftResponsibility, setDraftResponsibility] = useState("");
  const [draftRequirement, setDraftRequirement] = useState("");
  const [draftSkill, setDraftSkill] = useState("");

  const [companyProfile, setCompanyProfile] = useState<OrganisationProfileRow | null>(
    null
  );
  const [companyProfileLoading, setCompanyProfileLoading] = useState(false);

  const [refineModalOpen, setRefineModalOpen] = useState(false);
  const [refinementPreview, setRefinementPreview] =
    useState<JobProfileRefinementResult | null>(null);
  const [refinementJobProfileId, setRefinementJobProfileId] = useState<
    string | null
  >(null);
  const [refinementLoading, setRefinementLoading] = useState(false);
  const [refiningTargetId, setRefiningTargetId] = useState<string | null>(null);
  const [acceptingRefinement, setAcceptingRefinement] = useState(false);

  /** Which job family accordion is open (only one). Uncategorised uses UNCATEGORISED_ACCORDION_ID */
  const [expandedFamilyId, setExpandedFamilyId] = useState<string | null>(null);
  /** After first default expand, allow user to collapse all families without auto-reopening */
  const jobFamilyAccordionInitRef = useRef(false);

  useEffect(() => {
    jobFamilyAccordionInitRef.current = false;
    setExpandedFamilyId(null);
  }, [activeOrgId]);

  const reloadJobProfileMappingPanelData = useCallback(async (orgId: string) => {
    setMappingPanelLoading(true);
    const compRes = await supabase
      .from("competencies")
      .select("id, name")
      .eq("organisation_id", orgId)
      .eq("status", "active")
      .order("name");

    if (compRes.error) {
      console.error(compRes.error);
      setMappingCompetencies([]);
    } else {
      setMappingCompetencies(
        (compRes.data as { id: string; name: string }[] | null) ?? []
      );
    }

    setMappingPanelLoading(false);
  }, []);

  const loadJobProfileCompetencies = useCallback(
    async (jobProfileId: string) => {
      console.log(
        "[loadJobProfileCompetencies] selected jobProfileId:",
        jobProfileId
      );

      const linkRes = await supabase
        .from("job_profile_competencies")
        .select(
          "id, job_profile_id, competency_id, required_level, is_required, relevance, competencies ( id, name, status )"
        )
        .eq("job_profile_id", jobProfileId);

      if (linkRes.error) {
        console.error(linkRes.error);
        setJobProfileCompetencies([]);
        return;
      }

      console.log("[loadJobProfileCompetencies] returned rows:", linkRes.data);

      setJobProfileCompetencies(
        normalizeJobProfileCompetencyRows(linkRes.data)
      );
    },
    []
  );

  const loadJobProfileHr = useCallback(async (jobProfileId: string) => {
    setJobProfileHrLoading(true);
    const [r1, r2, r3] = await Promise.all([
      supabase
        .from("job_profile_responsibilities")
        .select("id, job_profile_id, description, order_index, created_at")
        .eq("job_profile_id", jobProfileId)
        .order("order_index", { ascending: true }),
      supabase
        .from("job_profile_requirements")
        .select("id, job_profile_id, description, order_index, created_at")
        .eq("job_profile_id", jobProfileId)
        .order("order_index", { ascending: true }),
      supabase
        .from("job_profile_skills")
        .select("id, job_profile_id, name, created_at")
        .eq("job_profile_id", jobProfileId)
        .order("created_at", { ascending: true }),
    ]);

    if (r1.error) console.error(r1.error);
    if (r2.error) console.error(r2.error);
    if (r3.error) console.error(r3.error);

    setProfileResponsibilities(
      (r1.data as JobProfileResponsibilityRow[] | null) ?? []
    );
    setProfileRequirements(
      (r2.data as JobProfileRequirementRow[] | null) ?? []
    );
    setProfileSkills((r3.data as JobProfileSkillRow[] | null) ?? []);
    setJobProfileHrLoading(false);
  }, []);

  useEffect(() => {
    if (!isActive || activeOrgId === null) {
      setProfileResponsibilities([]);
      setProfileRequirements([]);
      setProfileSkills([]);
      return;
    }
    if (!selectedJobProfileId) {
      setProfileResponsibilities([]);
      setProfileRequirements([]);
      setProfileSkills([]);
      return;
    }
    void loadJobProfileHr(selectedJobProfileId);
  }, [isActive, activeOrgId, selectedJobProfileId, loadJobProfileHr]);

  useEffect(() => {
    setDraftResponsibility("");
    setDraftRequirement("");
    setDraftSkill("");
  }, [selectedJobProfileId]);

  useEffect(() => {
    if (!isActive || activeOrgId === null) {
      setCompanyProfile(null);
      setCompanyProfileLoading(false);
      return;
    }

    let cancelled = false;
    setCompanyProfileLoading(true);

    void (async () => {
      const res = await supabase
        .from("organisation_profiles")
        .select("*")
        .eq("organisation_id", activeOrgId)
        .maybeSingle();

      if (cancelled) return;

      setCompanyProfileLoading(false);
      if (res.error) {
        console.warn(
          "[job_profiles] organisation_profiles:",
          res.error.message
        );
        setCompanyProfile(null);
        return;
      }
      setCompanyProfile((res.data as OrganisationProfileRow | null) ?? null);
    })();

    return () => {
      cancelled = true;
    };
  }, [isActive, activeOrgId]);

  useEffect(() => {
    if (!isActive || activeOrgId === null) {
      return;
    }

    let cancelled = false;
    const orgId = activeOrgId;

    async function loadJobProfiles() {
      setJobProfilesLoading(true);
      setJobProfilesError(null);
      setJobFamiliesError(null);
      setJobProfiles([]);
      setJobFamilies([]);
      setSelectedJobFamilyId("");
      setEditingProfileId(null);
      setEditTitle("");
      setEditLevel("");
      setEditJobFamilyId("");
      setArchivingProfileId(null);
      setRestoringProfileId(null);
      setSelectedJobProfileId(null);
      setMappingCompetencies([]);
      setJobProfileCompetencies([]);
      setProfileResponsibilities([]);
      setProfileRequirements([]);
      setProfileSkills([]);
      setDraftResponsibility("");
      setDraftRequirement("");
      setDraftSkill("");
      setSelectedCompetencyId("");
      setAvailableLevelDefinitions([]);
      setSelectedRequiredLevel("");
      setAssignmentLevelDefinitionsLoading(false);
      setMapIsRequired(true);
      setSelectedRelevance("medium");
      setShowAddCompetencyExpectationForm(false);

      let profilesQuery = supabase
        .from("job_profiles")
        .select("id, title, level_name, is_active, job_family_id, role_summary")
        .eq("organisation_id", orgId);
      if (!showArchivedJobProfiles) {
        profilesQuery = profilesQuery.eq("is_active", true);
      }

      const [profilesRes, familiesRes] = await Promise.all([
        profilesQuery,
        supabase
          .from("job_families")
          .select("id, name, is_active")
          .eq("organisation_id", orgId)
          .order("name"),
      ]);

      if (cancelled) return;

      if (profilesRes.error) {
        setJobProfilesError(profilesRes.error.message);
        setJobProfiles([]);
      } else {
        setJobProfiles((profilesRes.data as JobProfileRow[] | null) ?? []);
        setJobProfilesError(null);
      }

      if (familiesRes.error) {
        setJobFamiliesError(familiesRes.error.message);
        setJobFamilies([]);
      } else {
        setJobFamilies((familiesRes.data as JobFamilyRow[] | null) ?? []);
        setJobFamiliesError(null);
      }

      setJobProfilesLoading(false);
    }

    void loadJobProfiles();
    return () => {
      cancelled = true;
    };
  }, [isActive, activeOrgId, showArchivedJobProfiles]);
  useEffect(() => {
    if (!isActive || activeOrgId === null) {
      setMappingCompetencies([]);
      return;
    }

    if (selectedJobProfileId === null) {
      setMappingCompetencies([]);
      return;
    }

    void reloadJobProfileMappingPanelData(activeOrgId);
  }, [
    isActive,
    activeOrgId,
    selectedJobProfileId,
    reloadJobProfileMappingPanelData,
  ]);
  useEffect(() => {
    if (!isActive || activeOrgId === null) {
      setJobProfileCompetencies([]);
      return;
    }

    if (!selectedJobProfileId) {
      setJobProfileCompetencies([]);
      return;
    }

    void loadJobProfileCompetencies(selectedJobProfileId);
  }, [
    isActive,
    activeOrgId,
    selectedJobProfileId,
    loadJobProfileCompetencies,
  ]);

  useEffect(() => {
    if (jobProfileCompetencies.length === 0) {
      setLevelDefsByCompetencyId({});
      return;
    }
    const ids = [
      ...new Set(jobProfileCompetencies.map((m) => m.competency_id)),
    ];
    let cancelled = false;
    async function loadLevelDefsForMappings() {
      const res = await supabase
        .from("competency_level_definitions")
        .select(
          "id, competency_id, level_name, level_order, description, is_active"
        )
        .in("competency_id", ids)
        .eq("is_active", true)
        .order("level_order", { ascending: true });
      if (cancelled) return;
      if (res.error) {
        console.error(res.error);
        setLevelDefsByCompetencyId({});
        return;
      }
      const rows = (res.data as CompetencyLevelDefinitionRow[] | null) ?? [];
      const by: Record<string, CompetencyLevelDefinitionRow[]> = {};
      for (const r of rows) {
        if (!by[r.competency_id]) by[r.competency_id] = [];
        by[r.competency_id].push(r);
      }
      setLevelDefsByCompetencyId(by);
    }
    void loadLevelDefsForMappings();
    return () => {
      cancelled = true;
    };
  }, [jobProfileCompetencies]);

  useEffect(() => {
    setCompetencyMappingSavedFlash(null);
    setHoveredMappingId(null);
  }, [selectedJobProfileId]);

  useEffect(() => {
    if (!selectedCompetencyId) {
      setAvailableLevelDefinitions([]);
      setSelectedRequiredLevel("");
      setAssignmentLevelDefinitionsLoading(false);
      return;
    }

    let cancelled = false;

    async function loadAssignmentLevelDefinitions() {
      setAssignmentLevelDefinitionsLoading(true);
      const res = await supabase
        .from("competency_level_definitions")
        .select(
          "id, competency_id, level_name, level_order, description, is_active"
        )
        .eq("competency_id", selectedCompetencyId)
        .eq("is_active", true)
        .order("level_order", { ascending: true });

      if (cancelled) return;

      if (res.error) {
        console.error(res.error);
        setAvailableLevelDefinitions([]);
      } else {
        setAvailableLevelDefinitions(
          (res.data as CompetencyLevelDefinitionRow[] | null) ?? []
        );
      }
      setSelectedRequiredLevel("");
      setAssignmentLevelDefinitionsLoading(false);
    }

    void loadAssignmentLevelDefinitions();
    return () => {
      cancelled = true;
    };
  }, [selectedCompetencyId]);

  function resetAddCompetencyExpectationFormFields() {
    setSelectedCompetencyId("");
    setAvailableLevelDefinitions([]);
    setSelectedRequiredLevel("");
    setSelectedRelevance("medium");
    setMapIsRequired(true);
  }

  function handleCancelAddCompetencyExpectation() {
    resetAddCompetencyExpectationFormFields();
    setShowAddCompetencyExpectationForm(false);
  }

  function toggleJobProfileExpanded(row: JobProfileRow) {
    setSelectedJobProfileId((prev) => (prev === row.id ? null : row.id));
    setShowAddCompetencyExpectationForm(false);
    resetAddCompetencyExpectationFormFields();
  }

  async function handleSaveJobProfileCompetency(
    e: FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    if (activeOrgId === null || selectedJobProfileId === null) {
      alert("No active workspace selected");
      return;
    }

    if (!selectedCompetencyId) {
      alert("Please select a competency");
      return;
    }

    const alreadyAssigned = jobProfileCompetencies.some(
      (m) => m.competency_id === selectedCompetencyId
    );
    if (alreadyAssigned) {
      alert("This competency is already assigned to this job profile");
      return;
    }

    const required_level = selectedRequiredLevel.trim();
    if (!required_level) {
      alert("Please select a required level");
      return;
    }

    setIsSavingMapping(true);
    const { error } = await supabase.from("job_profile_competencies").insert({
      job_profile_id: selectedJobProfileId,
      competency_id: selectedCompetencyId,
      required_level,
      is_required: mapIsRequired,
      relevance: selectedRelevance,
    });

    if (error) {
      console.error("Job profile competency insert error:", error);
      const duplicateMsg =
        "This competency is already assigned to this job profile";
      const msg =
        error.code === "23505"
          ? duplicateMsg
          : error.message || "Failed to save competency assignment";
      alert(msg);
      setIsSavingMapping(false);
      return;
    }

    resetAddCompetencyExpectationFormFields();
    setShowAddCompetencyExpectationForm(false);
    setIsSavingMapping(false);

    await loadJobProfileCompetencies(selectedJobProfileId);
  }

  async function handleUpdateMappingRelevance(
    mappingId: string,
    relevance: JobProfileCompetencyRelevance
  ) {
    if (activeOrgId === null || selectedJobProfileId === null) return;

    setUpdatingMappingId(mappingId);
    const { error } = await supabase
      .from("job_profile_competencies")
      .update({ relevance })
      .eq("id", mappingId);

    if (error) {
      console.error(error);
      alert(error.message || "Failed to update relevance");
      setUpdatingMappingId(null);
      return;
    }

    setUpdatingMappingId(null);
    await loadJobProfileCompetencies(selectedJobProfileId);
    setCompetencyMappingSavedFlash((prev) => ({
      id: mappingId,
      key: (prev?.key ?? 0) + 1,
    }));
  }

  async function handleUpdateMappingRequiredLevel(
    mappingId: string,
    required_level: string
  ) {
    if (activeOrgId === null || selectedJobProfileId === null) return;
    const trimmed = required_level.trim();
    if (!trimmed) return;

    setUpdatingMappingId(mappingId);
    const { error } = await supabase
      .from("job_profile_competencies")
      .update({ required_level: trimmed })
      .eq("id", mappingId);

    if (error) {
      console.error(error);
      alert(error.message || "Failed to update required level");
      setUpdatingMappingId(null);
      return;
    }

    setUpdatingMappingId(null);
    await loadJobProfileCompetencies(selectedJobProfileId);
    setCompetencyMappingSavedFlash((prev) => ({
      id: mappingId,
      key: (prev?.key ?? 0) + 1,
    }));
  }

  async function handleUpdateMappingIsRequired(
    mappingId: string,
    is_required: boolean
  ) {
    if (activeOrgId === null || selectedJobProfileId === null) return;

    setUpdatingMappingId(mappingId);
    const { error } = await supabase
      .from("job_profile_competencies")
      .update({ is_required })
      .eq("id", mappingId);

    if (error) {
      console.error(error);
      alert(error.message || "Failed to update required / optional");
      setUpdatingMappingId(null);
      return;
    }

    setUpdatingMappingId(null);
    await loadJobProfileCompetencies(selectedJobProfileId);
    setCompetencyMappingSavedFlash((prev) => ({
      id: mappingId,
      key: (prev?.key ?? 0) + 1,
    }));
  }

  async function handleRemoveJobProfileCompetency(mappingId: string) {
    if (activeOrgId === null || selectedJobProfileId === null) {
      return;
    }

    if (
      !window.confirm(
        "Remove this competency from the job profile?"
      )
    ) {
      return;
    }

    setRemovingMappingId(mappingId);
    const { error } = await supabase
      .from("job_profile_competencies")
      .delete()
      .eq("id", mappingId);

    if (error) {
      console.error(error);
      alert("Failed to remove competency assignment");
      setRemovingMappingId(null);
      return;
    }

    setRemovingMappingId(null);
    await loadJobProfileCompetencies(selectedJobProfileId);
  }

  async function handleAddResponsibility(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedJobProfileId || !activeOrgId) return;
    const text = draftResponsibility.trim();
    if (!text) {
      alert("Enter a responsibility");
      return;
    }
    setHrMutating(true);
    const order_index = nextOrderIndex(profileResponsibilities);
    const { error } = await supabase.from("job_profile_responsibilities").insert({
      job_profile_id: selectedJobProfileId,
      description: text,
      order_index,
    });
    if (error) {
      console.error(error);
      alert(error.message || "Failed to add responsibility");
      setHrMutating(false);
      return;
    }
    setDraftResponsibility("");
    setHrMutating(false);
    await loadJobProfileHr(selectedJobProfileId);
  }

  async function handleDeleteResponsibility(id: string) {
    if (!selectedJobProfileId || !confirm("Remove this responsibility?")) return;
    setHrMutating(true);
    const { error } = await supabase
      .from("job_profile_responsibilities")
      .delete()
      .eq("id", id);
    if (error) {
      console.error(error);
      alert("Failed to remove");
      setHrMutating(false);
      return;
    }
    setHrMutating(false);
    await loadJobProfileHr(selectedJobProfileId);
  }

  async function handleAddRequirement(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedJobProfileId || !activeOrgId) return;
    const text = draftRequirement.trim();
    if (!text) {
      alert("Enter a requirement");
      return;
    }
    setHrMutating(true);
    const order_index = nextOrderIndex(profileRequirements);
    const { error } = await supabase.from("job_profile_requirements").insert({
      job_profile_id: selectedJobProfileId,
      description: text,
      order_index,
    });
    if (error) {
      console.error(error);
      alert(error.message || "Failed to add requirement");
      setHrMutating(false);
      return;
    }
    setDraftRequirement("");
    setHrMutating(false);
    await loadJobProfileHr(selectedJobProfileId);
  }

  async function handleDeleteRequirement(id: string) {
    if (!selectedJobProfileId || !confirm("Remove this requirement?")) return;
    setHrMutating(true);
    const { error } = await supabase
      .from("job_profile_requirements")
      .delete()
      .eq("id", id);
    if (error) {
      console.error(error);
      alert("Failed to remove");
      setHrMutating(false);
      return;
    }
    setHrMutating(false);
    await loadJobProfileHr(selectedJobProfileId);
  }

  async function handleAddSkill(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedJobProfileId || !activeOrgId) return;
    const name = draftSkill.trim();
    if (!name) {
      alert("Enter a skill");
      return;
    }
    setHrMutating(true);
    const { error } = await supabase.from("job_profile_skills").insert({
      job_profile_id: selectedJobProfileId,
      name,
    });
    if (error) {
      console.error(error);
      alert(error.message || "Failed to add skill");
      setHrMutating(false);
      return;
    }
    setDraftSkill("");
    setHrMutating(false);
    await loadJobProfileHr(selectedJobProfileId);
  }

  async function handleDeleteSkill(id: string) {
    if (!selectedJobProfileId || !confirm("Remove this skill?")) return;
    setHrMutating(true);
    const { error } = await supabase.from("job_profile_skills").delete().eq("id", id);
    if (error) {
      console.error(error);
      alert("Failed to remove");
      setHrMutating(false);
      return;
    }
    setHrMutating(false);
    await loadJobProfileHr(selectedJobProfileId);
  }

  async function reloadJobProfilesForOrg(orgId: string) {
    let q = supabase
      .from("job_profiles")
      .select("id, title, level_name, is_active, job_family_id, role_summary")
      .eq("organisation_id", orgId);
    if (!showArchivedJobProfiles) {
      q = q.eq("is_active", true);
    }
    const { data: rows, error: fetchError } = await q;

    if (fetchError) {
      console.error(fetchError);
      alert(fetchError.message);
      setJobProfilesError(fetchError.message);
      return;
    }
    setJobProfiles((rows as JobProfileRow[] | null) ?? []);
    setJobProfilesError(null);
  }

  function handleStartEditProfile(row: JobProfileRow) {
    setShowCreateForm(false);
    setNewTitle("");
    setNewLevel("");
    setSelectedJobFamilyId("");
    setEditingProfileId(row.id);
    setEditTitle(row.title);
    setEditLevel(row.level_name ?? "");
    setEditJobFamilyId(row.job_family_id ?? "");
  }

  function handleCancelEditProfile() {
    setEditingProfileId(null);
    setEditTitle("");
    setEditLevel("");
    setEditJobFamilyId("");
  }

  async function handleArchiveJobProfile(row: JobProfileRow) {
    if (!row.is_active) return;
    if (
      !confirm("Are you sure you want to archive this Job Profile?")
    ) {
      return;
    }
    if (activeOrgId === null) {
      alert("No active workspace selected");
      return;
    }

    setArchivingProfileId(row.id);
    const { error } = await supabase
      .from("job_profiles")
      .update({ is_active: false })
      .eq("id", row.id);

    if (error) {
      console.error(error);
      alert("Failed to archive Job Profile. Please try again.");
      setArchivingProfileId(null);
      return;
    }

    setArchivingProfileId(null);
    await reloadJobProfilesForOrg(activeOrgId);
  }

  async function handleRestoreJobProfile(row: JobProfileRow) {
    if (row.is_active) return;
    if (!confirm("Restore this Job Profile?")) {
      return;
    }
    if (activeOrgId === null) {
      alert("No active workspace selected");
      return;
    }

    setRestoringProfileId(row.id);
    const { error } = await supabase
      .from("job_profiles")
      .update({ is_active: true })
      .eq("id", row.id);

    if (error) {
      console.error(error);
      alert("Failed to restore Job Profile. Please try again.");
      setRestoringProfileId(null);
      return;
    }

    setRestoringProfileId(null);
    await reloadJobProfilesForOrg(activeOrgId);
  }

  async function handleSaveEditProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (activeOrgId === null || editingProfileId === null) {
      alert("No active workspace selected");
      return;
    }

    if (!editJobFamilyId) {
      alert("Please select a Job Family");
      return;
    }

    const title = editTitle.trim();
    if (!title) {
      alert("Please enter a title");
      return;
    }

    const levelTrimmed = editLevel.trim();
    if (!levelTrimmed) {
      alert("Please enter a level");
      return;
    }

    const level_name = normalizeJobProfileLevelName(levelTrimmed);

    setEditProfileSaving(true);
    const { error } = await supabase
      .from("job_profiles")
      .update({
        title,
        level_name,
        job_family_id: editJobFamilyId,
      })
      .eq("id", editingProfileId);

    if (error) {
      console.error(error);

      if (error.code === "23505") {
        alert(
          "A Job Profile with this title and level already exists in this family."
        );
      } else {
        alert("Failed to update Job Profile. Please try again.");
      }

      setEditProfileSaving(false);
      return;
    }

    setEditingProfileId(null);
    setEditTitle("");
    setEditLevel("");
    setEditJobFamilyId("");
    setEditProfileSaving(false);

    await reloadJobProfilesForOrg(activeOrgId);
  }

  async function reloadJobFamiliesList(orgId: string) {
    const { data, error } = await supabase
      .from("job_families")
      .select("id, name, is_active")
      .eq("organisation_id", orgId)
      .order("name");

    if (error) {
      console.error(error);
      alert(error.message);
      setJobFamiliesError(error.message);
      return;
    }
    setJobFamilies((data as JobFamilyRow[] | null) ?? []);
    setJobFamiliesError(null);
  }

  async function handleSaveNewJobFamily(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (activeOrgId === null) {
      alert("No active workspace selected");
      return;
    }

    const name = newFamilyName.trim();
    if (!name) {
      alert("Please enter a job family name");
      return;
    }

    setIsSavingFamily(true);
    const { error } = await supabase.from("job_families").insert({
      organisation_id: activeOrgId,
      name,
      is_active: true,
    });

    if (error) {
      console.error(error);

      if (error.code === "23505") {
        alert("A Job Family with this name already exists in this workspace.");
      } else {
        alert("Failed to create Job Family. Please try again.");
      }

      setIsSavingFamily(false);
      return;
    }

    setNewFamilyName("");
    setShowCreateFamilyForm(false);
    setIsSavingFamily(false);

    await reloadJobFamiliesList(activeOrgId);
  }

  function handleCancelCreateJobFamily() {
    setShowCreateFamilyForm(false);
    setNewFamilyName("");
  }

  async function handleSaveNewJobProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (activeOrgId === null) {
      alert("No active workspace selected");
      return;
    }

    if (!selectedJobFamilyId) {
      alert("Please select a Job Family");
      return;
    }

    const title = newTitle.trim();
    if (!title) {
      alert("Please enter a title");
      return;
    }

    const levelTrimmed = newLevel.trim();
    if (!levelTrimmed) {
      alert("Please enter a level");
      return;
    }

    const level_name = normalizeJobProfileLevelName(levelTrimmed);

    const payload = {
      organisation_id: activeOrgId,
      job_family_id: selectedJobFamilyId,
      title,
      level_name,
      is_active: true as const,
    };

    setJobProfileSaving(true);
    const { error } = await supabase.from("job_profiles").insert(payload);

    if (error) {
      console.error(error);

      if (error.code === "23505") {
        alert(
          "A Job Profile with this title and level already exists in this family."
        );
      } else {
        alert("Failed to create Job Profile. Please try again.");
      }

      setJobProfileSaving(false);
      return;
    }

    setNewTitle("");
    setNewLevel("");
    setSelectedJobFamilyId("");
    setShowCreateForm(false);
    setJobProfileSaving(false);

    await reloadJobProfilesForOrg(activeOrgId);
  }

  function handleCancelCreateJobProfile() {
    setShowCreateForm(false);
    setNewTitle("");
    setNewLevel("");
    setSelectedJobFamilyId("");
  }


  const uncategorisedProfiles = isActive
    ? uncategorisedJobProfiles(jobProfiles, jobFamilies)
    : [];

  useEffect(() => {
    if (!isActive) return;
    setExpandedFamilyId((prev) => {
      if (prev === UNCATEGORISED_ACCORDION_ID) {
        if (uncategorisedProfiles.length > 0) return prev;
        return jobFamilies.length > 0 ? jobFamilies[0].id : null;
      }
      if (prev !== null && jobFamilies.some((f) => f.id === prev)) {
        return prev;
      }
      if (
        prev !== null &&
        prev !== UNCATEGORISED_ACCORDION_ID &&
        !jobFamilies.some((f) => f.id === prev)
      ) {
        if (jobFamilies.length > 0) return jobFamilies[0].id;
        if (uncategorisedProfiles.length > 0) return UNCATEGORISED_ACCORDION_ID;
        return null;
      }
      if (!jobFamilyAccordionInitRef.current && prev === null) {
        jobFamilyAccordionInitRef.current = true;
        if (jobFamilies.length > 0) return jobFamilies[0].id;
        if (uncategorisedProfiles.length > 0) return UNCATEGORISED_ACCORDION_ID;
      }
      return prev;
    });
  }, [isActive, jobFamilies, uncategorisedProfiles.length]);

  const profileControlsDisabled =
    jobProfileSaving ||
    isSavingFamily ||
    editProfileSaving ||
    archivingProfileId !== null ||
    restoringProfileId !== null ||
    hrMutating ||
    refinementLoading ||
    acceptingRefinement;

  async function handleRefineWithCompanyContext(row: JobProfileRow) {
    if (!activeOrgId) return;
    setRefiningTargetId(row.id);
    setRefinementLoading(true);
    try {
      const profRes = await supabase
        .from("organisation_profiles")
        .select("*")
        .eq("organisation_id", activeOrgId)
        .maybeSingle();

      if (profRes.error) {
        throw new Error(profRes.error.message);
      }

      const companyProfile =
        (profRes.data as OrganisationProfileRow | null) ?? null;

      const responsibilities = profileResponsibilities.map((r) => r.description);

      const result = await refineJobProfileWithCompanyContext({
        companyProfile,
        jobTitle: row.title,
        levelName: row.level_name,
        description: row.role_summary?.trim() || null,
        responsibilities,
      });

      setRefinementJobProfileId(row.id);
      setRefinementPreview(result);
      setRefineModalOpen(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(msg);
    } finally {
      setRefinementLoading(false);
      setRefiningTargetId(null);
    }
  }

  function handleCloseRefineModal() {
    if (acceptingRefinement) return;
    setRefineModalOpen(false);
    setRefinementPreview(null);
    setRefinementJobProfileId(null);
  }

  async function handleAcceptRefinement() {
    if (!activeOrgId || !refinementJobProfileId || !refinementPreview) return;

    if (refinementPreview.improved_responsibilities.length === 0) {
      alert(
        "The AI did not return any responsibilities. Nothing was saved. Try again or edit manually."
      );
      return;
    }

    setAcceptingRefinement(true);
    try {
      const { error: uErr } = await supabase
        .from("job_profiles")
        .update({ role_summary: refinementPreview.refined_role_summary })
        .eq("id", refinementJobProfileId);
      if (uErr) throw uErr;

      const { error: delR } = await supabase
        .from("job_profile_responsibilities")
        .delete()
        .eq("job_profile_id", refinementJobProfileId);
      if (delR) throw delR;

      const respRows = refinementPreview.improved_responsibilities.map(
        (description, order_index) => ({
          job_profile_id: refinementJobProfileId,
          description,
          order_index,
        })
      );
      const { error: insR } = await supabase
        .from("job_profile_responsibilities")
        .insert(respRows);
      if (insR) throw insR;

      const { error: delReq } = await supabase
        .from("job_profile_requirements")
        .delete()
        .eq("job_profile_id", refinementJobProfileId);
      if (delReq) throw delReq;

      const reqRows = refinementPreview.suggested_requirements.map(
        (description, order_index) => ({
          job_profile_id: refinementJobProfileId,
          description,
          order_index,
        })
      );
      if (reqRows.length > 0) {
        const { error: insReq } = await supabase
          .from("job_profile_requirements")
          .insert(reqRows);
        if (insReq) throw insReq;
      }

      await reloadJobProfilesForOrg(activeOrgId);
      await loadJobProfileHr(refinementJobProfileId);
      setRefineModalOpen(false);
      setRefinementPreview(null);
      setRefinementJobProfileId(null);
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Failed to apply refinement");
    } finally {
      setAcceptingRefinement(false);
    }
  }

  const renderJobProfileCard = (row: JobProfileRow) => {
    const archivedDimmed = showArchivedJobProfiles && !row.is_active;
    const cardStyle = {
      ...profileCardShell,
      opacity: archivedDimmed ? 0.55 : 1,
      border:
        selectedJobProfileId === row.id
          ? `1px solid ${accent}`
          : `1px solid ${border}`,
    };

    if (editingProfileId === row.id) {
      return (
        <li key={row.id} style={cardStyle}>
          <form
            onSubmit={handleSaveEditProfile}
            style={{ display: "grid", gap: 12 }}
          >
            <label
              style={{
                display: "grid",
                gap: 6,
                fontSize: 13,
                color: mutedColor,
              }}
            >
              Job Family
              <select
                required
                value={editJobFamilyId}
                onChange={(e) => setEditJobFamilyId(e.target.value)}
                disabled={profileControlsDisabled}
                style={{
                  padding: "10px 12px",
                  fontSize: 15,
                  color: text,
                  backgroundColor: surface,
                  border: `1px solid ${border}`,
                  borderRadius: 8,
                }}
              >
                <option value="">Select a Job Family...</option>
                {jobFamilies.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
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
              Title
              <input
                required
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                disabled={profileControlsDisabled}
                style={{
                  padding: "10px 12px",
                  fontSize: 15,
                  color: text,
                  backgroundColor: surface,
                  border: `1px solid ${border}`,
                  borderRadius: 8,
                }}
              />
            </label>
            <label
              style={{
                display: "grid",
                gap: 6,
                fontSize: 13,
                color: mutedColor,
              }}
            >
              Level
              <input
                required
                value={editLevel}
                onChange={(e) => setEditLevel(e.target.value)}
                disabled={profileControlsDisabled}
                style={{
                  padding: "10px 12px",
                  fontSize: 15,
                  color: text,
                  backgroundColor: surface,
                  border: `1px solid ${border}`,
                  borderRadius: 8,
                }}
              />
            </label>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                marginTop: 4,
              }}
            >
              <button
                type="submit"
                disabled={profileControlsDisabled}
                style={btn}
              >
                {editProfileSaving ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                disabled={profileControlsDisabled}
                onClick={handleCancelEditProfile}
                style={btn}
              >
                Cancel
              </button>
            </div>
          </form>
        </li>
      );
    }

    const isProfileExpanded = selectedJobProfileId === row.id;

    return (
      <li key={row.id} style={{ ...cardStyle, cursor: "default" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            justifyContent: "space-between",
          }}
        >
          <button
            type="button"
            aria-expanded={isProfileExpanded}
            onClick={() => toggleJobProfileExpanded(row)}
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: 0,
              margin: 0,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: text,
              textAlign: "left",
              borderRadius: 6,
            }}
          >
            <span
              aria-hidden
              style={{
                display: "inline-flex",
                marginTop: 2,
                fontSize: 12,
                color: mutedColor,
                transform: isProfileExpanded ? "rotate(90deg)" : "rotate(0deg)",
                transition: "transform 0.22s ease",
              }}
            >
              ▸
            </span>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 600,
                  color: text,
                  fontSize: 15,
                }}
              >
                {row.title}
                {!row.is_active && (
                  <span
                    style={{
                      marginLeft: 8,
                      fontWeight: 500,
                      fontSize: 12,
                      color: mutedColor,
                    }}
                  >
                    (inactive)
                  </span>
                )}
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontSize: 13,
                  color: mutedColor,
                }}
              >
                {row.level_name ?? "—"}
              </div>
            </div>
          </button>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              flexShrink: 0,
              justifyContent: "flex-end",
            }}
          >
            <button
              type="button"
              onClick={() => handleStartEditProfile(row)}
              disabled={profileControlsDisabled}
              style={{
                ...btn,
                padding: "6px 12px",
                fontSize: 13,
              }}
            >
              Edit
            </button>
            {row.is_active ? (
              <button
                type="button"
                onClick={() => void handleArchiveJobProfile(row)}
                disabled={profileControlsDisabled}
                style={{
                  ...btn,
                  padding: "6px 12px",
                  fontSize: 13,
                }}
              >
                {archivingProfileId === row.id ? "Archiving..." : "Archive"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleRestoreJobProfile(row)}
                disabled={profileControlsDisabled}
                style={{
                  ...btn,
                  padding: "6px 12px",
                  fontSize: 13,
                }}
              >
                {restoringProfileId === row.id ? "Restoring..." : "Restore"}
              </button>
            )}
          </div>
        </div>
        <AccordionCollapsible open={isProfileExpanded}>
          <div
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: `1px solid ${border}`,
            }}
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 10,
                marginBottom: 12,
              }}
            >
              <button
                type="button"
                onClick={() => void handleRefineWithCompanyContext(row)}
                disabled={profileControlsDisabled}
                style={{
                  ...btnPrimary,
                  padding: "8px 14px",
                  fontSize: 13,
                }}
              >
                {refiningTargetId === row.id ? "Refining…" : "Refine with company context"}
              </button>
              <span style={{ fontSize: 12, color: mutedColor, lineHeight: 1.4 }}>
                Uses the workspace company profile and this role&apos;s title,
                level, summary, and responsibilities.
              </span>
            </div>
            {jobProfileHrLoading ? (
              <p style={{ margin: "0 0 12px", fontSize: 13, color: mutedColor }}>
                Loading role details...
              </p>
            ) : null}
            <p
              style={{
                margin: "0 0 8px",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase" as const,
                color: mutedColor,
              }}
            >
              Responsibilities
            </p>
            <p style={{ ...muted, margin: "0 0 10px", fontSize: 12 }}>
              Key duties and outcomes for this role.
            </p>
            <form
              onSubmit={(e) => void handleAddResponsibility(e)}
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 10,
                alignItems: "center",
              }}
            >
              <input
                value={draftResponsibility}
                onChange={(e) => setDraftResponsibility(e.target.value)}
                placeholder="Add a responsibility..."
                disabled={hrMutating || jobProfileHrLoading}
                style={{
                  flex: "1 1 220px",
                  minWidth: 0,
                  padding: "8px 10px",
                  fontSize: 14,
                  color: text,
                  backgroundColor: bg,
                  border: `1px solid ${border}`,
                  borderRadius: 8,
                }}
              />
              <button
                type="submit"
                disabled={hrMutating || jobProfileHrLoading}
                style={{ ...btn, flexShrink: 0 }}
              >
                Add
              </button>
            </form>
            <ul
              style={{
                margin: "0 0 20px",
                padding: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {profileResponsibilities.map((r) => (
                <li
                  key={r.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "flex-start",
                    padding: "10px 12px",
                    borderRadius: 8,
                    backgroundColor: bg,
                    border: `1px solid ${border}`,
                  }}
                >
                  <span
                    style={{
                      fontSize: 14,
                      color: text,
                      lineHeight: 1.45,
                    }}
                  >
                    {r.description}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleDeleteResponsibility(r.id)}
                    disabled={hrMutating}
                    style={{
                      ...btn,
                      flexShrink: 0,
                      padding: "4px 10px",
                      fontSize: 12,
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <p
              style={{
                margin: "0 0 8px",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase" as const,
                color: mutedColor,
              }}
            >
              Requirements
            </p>
            <p style={{ ...muted, margin: "0 0 10px", fontSize: 12 }}>
              Qualifications, education, and experience.
            </p>
            <form
              onSubmit={(e) => void handleAddRequirement(e)}
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 10,
                alignItems: "center",
              }}
            >
              <input
                value={draftRequirement}
                onChange={(e) => setDraftRequirement(e.target.value)}
                placeholder="Add a requirement..."
                disabled={hrMutating || jobProfileHrLoading}
                style={{
                  flex: "1 1 220px",
                  minWidth: 0,
                  padding: "8px 10px",
                  fontSize: 14,
                  color: text,
                  backgroundColor: bg,
                  border: `1px solid ${border}`,
                  borderRadius: 8,
                }}
              />
              <button
                type="submit"
                disabled={hrMutating || jobProfileHrLoading}
                style={{ ...btn, flexShrink: 0 }}
              >
                Add
              </button>
            </form>
            <ul
              style={{
                margin: "0 0 20px",
                padding: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {profileRequirements.map((r) => (
                <li
                  key={r.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "flex-start",
                    padding: "10px 12px",
                    borderRadius: 8,
                    backgroundColor: bg,
                    border: `1px solid ${border}`,
                  }}
                >
                  <span
                    style={{
                      fontSize: 14,
                      color: text,
                      lineHeight: 1.45,
                    }}
                  >
                    {r.description}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleDeleteRequirement(r.id)}
                    disabled={hrMutating}
                    style={{
                      ...btn,
                      flexShrink: 0,
                      padding: "4px 10px",
                      fontSize: 12,
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <p
              style={{
                margin: "0 0 8px",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase" as const,
                color: mutedColor,
              }}
            >
              Competency expectations
            </p>
            <p style={{ ...muted, margin: "0 0 10px", fontSize: 12 }}>
              Linked from your practice library (reusable across roles). Separate
              from Skills below.
            </p>
            {mappingPanelLoading ? (
              <p style={{ margin: 0, fontSize: 13, color: mutedColor }}>
                Loading assignments...
              </p>
            ) : jobProfileCompetencies.length === 0 ? (
              <p style={{ margin: "0 0 12px", fontSize: 13, color: mutedColor }}>
                No competencies assigned yet.
              </p>
            ) : (
              <ul
                style={{
                  margin: "0 0 14px",
                  padding: 0,
                  listStyle: "none",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {jobProfileCompetencies.map((m) => (
                  <li
                    key={m.id}
                    onMouseEnter={() => setHoveredMappingId(m.id)}
                    onMouseLeave={() =>
                      setHoveredMappingId((prev) =>
                        prev === m.id ? null : prev
                      )
                    }
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: 10,
                      padding: "10px 12px",
                      borderRadius: 8,
                      backgroundColor:
                        hoveredMappingId === m.id ? surfaceHover : surface,
                      border: `1px solid ${
                        hoveredMappingId === m.id
                          ? "rgba(74, 88, 110, 0.55)"
                          : border
                      }`,
                      transition:
                        "background-color 0.15s ease, border-color 0.15s ease",
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                          gap: 10,
                          minWidth: 0,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            alignItems: "center",
                            gap: "6px 8px",
                            minWidth: 0,
                            flex: 1,
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 600,
                              color: text,
                              fontSize: 14,
                              minWidth: 0,
                            }}
                          >
                            {m.competency_name || "Unknown competency"}
                          </div>
                          {m.competency_status === "deprecated" ? (
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 600,
                                letterSpacing: "0.06em",
                                textTransform: "uppercase",
                                padding: "3px 8px",
                                borderRadius: 5,
                                border: "1px solid rgba(212, 168, 75, 0.45)",
                                color: "#d4a84b",
                                backgroundColor: "rgba(212, 168, 75, 0.12)",
                                flexShrink: 0,
                              }}
                            >
                              Deprecated
                            </span>
                          ) : null}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            flexShrink: 0,
                          }}
                        >
                          {updatingMappingId === m.id ? (
                            <span
                              style={{ fontSize: 12, color: mutedColor }}
                            >
                              Saving…
                            </span>
                          ) : null}
                          {competencyMappingSavedFlash?.id === m.id &&
                          updatingMappingId !== m.id ? (
                            <span
                              key={competencyMappingSavedFlash.key}
                              className="job-profile-mapping-saved"
                              onAnimationEnd={() => {
                                setCompetencyMappingSavedFlash((prev) =>
                                  prev?.id === m.id ? null : prev
                                );
                              }}
                            >
                              Saved
                            </span>
                          ) : null}
                        </div>
                      </div>
                      {m.competency_status === "deprecated" ? (
                        <p
                          style={{
                            margin: "8px 0 0",
                            fontSize: 12,
                            color: "#c9a227",
                            lineHeight: 1.45,
                          }}
                        >
                          This competency is deprecated. It remains on this
                          profile for existing expectations; choose a replacement
                          competency for new requirements.
                        </p>
                      ) : null}
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 13,
                          color: mutedColor,
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span style={{ flexShrink: 0 }}>Required level:</span>
                        <select
                          aria-label={`Required level for ${m.competency_name}`}
                          value={m.required_level ?? ""}
                          onChange={(e) =>
                            void handleUpdateMappingRequiredLevel(
                              m.id,
                              e.target.value
                            )
                          }
                          disabled={
                            updatingMappingId === m.id ||
                            removingMappingId !== null ||
                            isSavingMapping ||
                            hrMutating
                          }
                          style={{
                            padding: "4px 8px",
                            fontSize: 13,
                            color: text,
                            backgroundColor: bg,
                            border: `1px solid ${border}`,
                            borderRadius: 6,
                            minWidth: 160,
                            maxWidth: "100%",
                          }}
                        >
                          {(levelDefsByCompetencyId[m.competency_id] ?? [])
                            .length === 0 ? (
                            <option value={m.required_level ?? ""}>
                              {m.required_level ?? "No levels defined"}
                            </option>
                          ) : (
                            <>
                              {!m.required_level ? (
                                <option value="">
                                  Select required level…
                                </option>
                              ) : null}
                              {m.required_level &&
                              !(levelDefsByCompetencyId[m.competency_id] ?? []).some(
                                (ld) => ld.level_name === m.required_level
                              ) ? (
                                <option value={m.required_level}>
                                  {m.required_level} (current)
                                </option>
                              ) : null}
                              {(levelDefsByCompetencyId[m.competency_id] ?? []).map(
                                (ld) => (
                                  <option
                                    key={ld.id}
                                    value={ld.level_name}
                                  >
                                    {ld.level_order}. {ld.level_name}
                                  </option>
                                )
                              )}
                            </>
                          )}
                        </select>
                      </div>
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 13,
                          color: mutedColor,
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span style={{ flexShrink: 0 }}>Relevance:</span>
                        <select
                          aria-label={`Relevance for ${m.competency_name}`}
                          value={m.relevance}
                          onChange={(e) =>
                            void handleUpdateMappingRelevance(
                              m.id,
                              e.target.value as JobProfileCompetencyRelevance
                            )
                          }
                          disabled={
                            updatingMappingId === m.id ||
                            removingMappingId !== null ||
                            isSavingMapping ||
                            hrMutating
                          }
                          style={{
                            padding: "4px 8px",
                            fontSize: 13,
                            color: text,
                            backgroundColor: bg,
                            border: `1px solid ${border}`,
                            borderRadius: 6,
                            minWidth: 120,
                          }}
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                        </select>
                      </div>
                      <label
                        style={{
                          marginTop: 6,
                          fontSize: 13,
                          color: mutedColor,
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          cursor:
                            updatingMappingId === m.id ||
                            removingMappingId !== null ||
                            isSavingMapping ||
                            hrMutating
                              ? "not-allowed"
                              : "pointer",
                          userSelect: "none",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={m.is_required}
                          onChange={(e) =>
                            void handleUpdateMappingIsRequired(
                              m.id,
                              e.target.checked
                            )
                          }
                          disabled={
                            updatingMappingId === m.id ||
                            removingMappingId !== null ||
                            isSavingMapping ||
                            hrMutating
                          }
                          style={{
                            width: 16,
                            height: 16,
                            cursor: "inherit",
                          }}
                        />
                        Required for this role
                      </label>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void handleRemoveJobProfileCompetency(m.id)
                      }
                      disabled={
                        removingMappingId !== null ||
                        updatingMappingId !== null ||
                        isSavingMapping ||
                        hrMutating
                      }
                      style={{
                        ...btn,
                        flexShrink: 0,
                        padding: "6px 12px",
                        fontSize: 13,
                      }}
                    >
                      {removingMappingId === m.id
                        ? "Removing..."
                        : "Remove"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {mappingPanelLoading ? null : !showAddCompetencyExpectationForm ? (
              <>
                <p
                  style={{
                    ...muted,
                    margin: "14px 0 8px",
                    fontSize: 12,
                  }}
                >
                  Changes save automatically. Use the button below to add
                  another competency.
                </p>
                <button
                  type="button"
                  onClick={() => setShowAddCompetencyExpectationForm(true)}
                  disabled={
                    isSavingMapping || mappingPanelLoading || hrMutating
                  }
                  style={{
                    ...btn,
                    width: "100%",
                    boxSizing: "border-box" as const,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    aria-hidden
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.25"
                    strokeLinecap="round"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Add competency expectation
                </button>
              </>
            ) : (
              <form
                onSubmit={(e) => {
                  void handleSaveJobProfileCompetency(e);
                }}
                style={{
                  marginTop: 12,
                  padding: "12px 12px",
                  borderRadius: 8,
                  backgroundColor: bg,
                  border: `1px solid ${border}`,
                  display: "grid",
                  gap: 12,
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
                    value={selectedCompetencyId}
                    onChange={(e) =>
                      setSelectedCompetencyId(e.target.value)
                    }
                    disabled={
                      isSavingMapping ||
                      mappingPanelLoading ||
                      hrMutating
                    }
                    style={{
                      padding: "10px 12px",
                      fontSize: 15,
                      color: text,
                      backgroundColor: surface,
                      border: `1px solid ${border}`,
                      borderRadius: 8,
                    }}
                  >
                    <option value="">
                      Select a competency...
                    </option>
                    {mappingCompetencies.map((c) => (
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
                  Required level
                  <select
                    required
                    value={selectedRequiredLevel}
                    onChange={(e) =>
                      setSelectedRequiredLevel(e.target.value)
                    }
                    disabled={
                      isSavingMapping ||
                      mappingPanelLoading ||
                      assignmentLevelDefinitionsLoading ||
                      !selectedCompetencyId ||
                      availableLevelDefinitions.length === 0 ||
                      hrMutating
                    }
                    style={{
                      padding: "10px 12px",
                      fontSize: 15,
                      color: text,
                      backgroundColor: surface,
                      border: `1px solid ${border}`,
                      borderRadius: 8,
                    }}
                  >
                    <option value="">
                      {assignmentLevelDefinitionsLoading
                        ? "Loading levels..."
                        : !selectedCompetencyId
                          ? "Select a competency first..."
                          : availableLevelDefinitions.length === 0
                            ? "No levels defined for this competency"
                            : "Select a required level..."}
                    </option>
                    {availableLevelDefinitions.map((ld) => (
                      <option key={ld.id} value={ld.level_name}>
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
                  Relevance
                  <select
                    value={selectedRelevance}
                    onChange={(e) =>
                      setSelectedRelevance(
                        e.target.value as JobProfileCompetencyRelevance
                      )
                    }
                    disabled={
                      isSavingMapping ||
                      mappingPanelLoading ||
                      hrMutating
                    }
                    style={{
                      padding: "10px 12px",
                      fontSize: 15,
                      color: text,
                      backgroundColor: surface,
                      border: `1px solid ${border}`,
                      borderRadius: 8,
                    }}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
                    color: mutedColor,
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={mapIsRequired}
                    onChange={(e) =>
                      setMapIsRequired(e.target.checked)
                    }
                    disabled={
                      isSavingMapping || mappingPanelLoading || hrMutating
                    }
                    style={{
                      width: 16,
                      height: 16,
                      cursor: "pointer",
                    }}
                  />
                  Required
                </label>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                    marginTop: 4,
                  }}
                >
                  <button
                    type="submit"
                    disabled={
                      isSavingMapping || mappingPanelLoading || hrMutating
                    }
                    style={btn}
                  >
                    {isSavingMapping ? "Saving..." : "Save"}
                  </button>
                  <button
                    type="button"
                    disabled={
                      isSavingMapping || mappingPanelLoading || hrMutating
                    }
                    onClick={handleCancelAddCompetencyExpectation}
                    style={btn}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
            <p
              style={{
                margin: "20px 0 8px",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase" as const,
                color: mutedColor,
              }}
            >
              Skills
            </p>
            <p style={{ ...muted, margin: "0 0 10px", fontSize: 12 }}>
              Role-facing tools, technologies, and methods — separate from
              competency expectations above.
            </p>
            <form
              onSubmit={(e) => void handleAddSkill(e)}
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 10,
                alignItems: "center",
              }}
            >
              <input
                value={draftSkill}
                onChange={(e) => setDraftSkill(e.target.value)}
                placeholder="Add a skill..."
                disabled={hrMutating || jobProfileHrLoading}
                style={{
                  flex: "1 1 220px",
                  minWidth: 0,
                  padding: "8px 10px",
                  fontSize: 14,
                  color: text,
                  backgroundColor: bg,
                  border: `1px solid ${border}`,
                  borderRadius: 8,
                }}
              />
              <button
                type="submit"
                disabled={hrMutating || jobProfileHrLoading}
                style={{ ...btn, flexShrink: 0 }}
              >
                Add
              </button>
            </form>
            <div
              style={{
                margin: "0 0 20px",
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              {profileSkills.map((s) => (
                <span
                  key={s.id}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 10px",
                    borderRadius: 999,
                    fontSize: 13,
                    color: text,
                    backgroundColor: surface,
                    border: `1px solid ${border}`,
                  }}
                >
                  {s.name}
                  <button
                    type="button"
                    onClick={() => void handleDeleteSkill(s.id)}
                    disabled={hrMutating}
                    style={{
                      ...btnGhost,
                      padding: "0 6px",
                      fontSize: 14,
                      lineHeight: 1,
                      border: "none",
                      color: mutedColor,
                    }}
                    aria-label={`Remove ${s.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        </AccordionCollapsible>
      </li>
    );
  };

  const companyContextRows = organisationProfileJobContextRows(companyProfile);

  return (
    <>
      {!activeOrgId ? (
        <div style={panelShell}>
          <p style={{ margin: 0 }}>No workspaces yet.</p>
        </div>
      ) : (
        <div style={panelShell}>
          <div
            style={{
              margin: "0 0 14px",
              padding: "12px 14px",
              borderRadius: 8,
              backgroundColor: bg,
              border: `1px solid ${borderSubtle}`,
            }}
          >
            <p
              style={{
                ...sectionEyebrow,
                marginBottom: 8,
              }}
            >
              Company context
            </p>
            {companyProfileLoading ? (
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  color: mutedColor,
                }}
              >
                Loading company profile…
              </p>
            ) : !companyProfile ? (
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  color: mutedColor,
                  lineHeight: 1.45,
                }}
              >
                No company profile has been completed yet.
              </p>
            ) : companyContextRows.length === 0 ? (
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  color: mutedColor,
                  lineHeight: 1.45,
                }}
              >
                No company context fields are filled in yet.
              </p>
            ) : (
              <dl
                style={{
                  margin: 0,
                  display: "grid",
                  gap: 10,
                }}
              >
                {companyContextRows.map(({ label, value }) => (
                  <div key={label}>
                    <dt
                      style={{
                        margin: 0,
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: mutedColor,
                      }}
                    >
                      {label}
                    </dt>
                    <dd
                      style={{
                        margin: "4px 0 0",
                        fontSize: 13,
                        color: text,
                        lineHeight: 1.45,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

                      {jobProfilesLoading ? (
                      <p style={{ margin: 0 }}>Loading job profiles...</p>
                    ) : jobProfilesError ? (
                      <p style={{ margin: 0, color: errorColor }}>
                        {jobProfilesError}
                      </p>
                    ) : (
                      <>
                        {jobFamiliesError && (
                          <p
                            style={{
                              margin: "0 0 12px",
                              color: errorColor,
                              fontSize: 14,
                            }}
                          >
                            Job families: {jobFamiliesError}
                          </p>
                        )}

                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            margin: "0 0 12px",
                            fontSize: 13,
                            color: mutedColor,
                            cursor: "pointer",
                            userSelect: "none",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={showArchivedJobProfiles}
                            onChange={(e) =>
                              setShowArchivedJobProfiles(e.target.checked)
                            }
                            disabled={
                              jobProfileSaving ||
                              editProfileSaving ||
                              archivingProfileId !== null || restoringProfileId !== null
                            }
                            style={{ width: 16, height: 16, cursor: "pointer" }}
                          />
                          Show archived
                        </label>

                        <button
                          type="button"
                          onClick={() =>
                            setShowCreateForm((s) => {
                              const next = !s;
                              if (next) {
                                setEditingProfileId(null);
                                setEditTitle("");
                                setEditLevel("");
                                setEditJobFamilyId("");
                              }
                              return next;
                            })
                          }
                          disabled={
                            jobProfileSaving ||
                            isSavingFamily ||
                            editProfileSaving ||
                            archivingProfileId !== null || restoringProfileId !== null
                          }
                          style={{
                            ...btn,
                            marginTop: 0,
                            marginBottom: 0,
                            width: "100%",
                            boxSizing: "border-box" as const,
                          }}
                        >
                          + Add Job Profile
                        </button>

                        {showCreateForm && (
                          <form
                            onSubmit={handleSaveNewJobProfile}
                            style={{
                              marginTop: 14,
                              padding: "14px 14px",
                              borderRadius: 8,
                              backgroundColor: bg,
                              border: `1px solid ${border}`,
                              display: "grid",
                              gap: 12,
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
                              Job Family
                              <select
                                required
                                value={selectedJobFamilyId}
                                onChange={(e) =>
                                  setSelectedJobFamilyId(e.target.value)
                                }
                                disabled={
                                  jobProfileSaving ||
                                  isSavingFamily ||
                                  editProfileSaving ||
                                  archivingProfileId !== null || restoringProfileId !== null
                                }
                                style={{
                                  padding: "10px 12px",
                                  fontSize: 15,
                                  color: text,
                                  backgroundColor: surface,
                                  border: `1px solid ${border}`,
                                  borderRadius: 8,
                                }}
                              >
                                <option value="">Select a Job Family...</option>
                                {jobFamilies.map((f) => (
                                  <option key={f.id} value={f.id}>
                                    {f.name}
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
                              Title
                              <input
                                required
                                value={newTitle}
                                onChange={(e) => setNewTitle(e.target.value)}
                                disabled={
                                  jobProfileSaving ||
                                  isSavingFamily ||
                                  editProfileSaving ||
                                  archivingProfileId !== null || restoringProfileId !== null
                                }
                                style={{
                                  padding: "10px 12px",
                                  fontSize: 15,
                                  color: text,
                                  backgroundColor: surface,
                                  border: `1px solid ${border}`,
                                  borderRadius: 8,
                                }}
                              />
                            </label>
                            <label
                              style={{
                                display: "grid",
                                gap: 6,
                                fontSize: 13,
                                color: mutedColor,
                              }}
                            >
                              Level
                              <input
                                required
                                value={newLevel}
                                onChange={(e) => setNewLevel(e.target.value)}
                                disabled={
                                  jobProfileSaving ||
                                  isSavingFamily ||
                                  editProfileSaving ||
                                  archivingProfileId !== null || restoringProfileId !== null
                                }
                                style={{
                                  padding: "10px 12px",
                                  fontSize: 15,
                                  color: text,
                                  backgroundColor: surface,
                                  border: `1px solid ${border}`,
                                  borderRadius: 8,
                                }}
                              />
                            </label>
                            <div
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: 10,
                                marginTop: 4,
                              }}
                            >
                              <button
                                type="submit"
                                disabled={
                                  jobProfileSaving ||
                                  isSavingFamily ||
                                  editProfileSaving ||
                                  archivingProfileId !== null || restoringProfileId !== null
                                }
                                style={btn}
                              >
                                {jobProfileSaving ? "Saving..." : "Save"}
                              </button>
                              <button
                                type="button"
                                disabled={
                                  jobProfileSaving ||
                                  isSavingFamily ||
                                  editProfileSaving ||
                                  archivingProfileId !== null || restoringProfileId !== null
                                }
                                onClick={handleCancelCreateJobProfile}
                                style={btn}
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        )}

                        <p
                          style={{
                            ...sectionEyebrow,
                            margin: "20px 0 0",
                          }}
                        >
                          Job Families
                        </p>

                        <button
                          type="button"
                          onClick={() => setShowCreateFamilyForm((s) => !s)}
                          disabled={
                            isSavingFamily ||
                            jobProfileSaving ||
                            editProfileSaving ||
                            archivingProfileId !== null || restoringProfileId !== null
                          }
                          style={{
                            ...btn,
                            marginTop: 10,
                            marginBottom: 0,
                            width: "100%",
                            boxSizing: "border-box" as const,
                          }}
                        >
                          + Add Job Family
                        </button>

                        {showCreateFamilyForm && (
                          <form
                            onSubmit={handleSaveNewJobFamily}
                            style={{
                              marginTop: 14,
                              padding: "14px 14px",
                              borderRadius: 8,
                              backgroundColor: bg,
                              border: `1px solid ${border}`,
                              display: "grid",
                              gap: 12,
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
                              Job Family Name
                              <input
                                value={newFamilyName}
                                onChange={(e) => setNewFamilyName(e.target.value)}
                                disabled={isSavingFamily}
                                style={{
                                  padding: "10px 12px",
                                  fontSize: 15,
                                  color: text,
                                  backgroundColor: surface,
                                  border: `1px solid ${border}`,
                                  borderRadius: 8,
                                }}
                              />
                            </label>
                            <div
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: 10,
                                marginTop: 4,
                              }}
                            >
                              <button
                                type="submit"
                                disabled={isSavingFamily}
                                style={btn}
                              >
                                {isSavingFamily ? "Saving..." : "Save"}
                              </button>
                              <button
                                type="button"
                                disabled={isSavingFamily}
                                onClick={handleCancelCreateJobFamily}
                                style={btn}
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        )}

                        {jobFamilies.length === 0 &&
                        uncategorisedProfiles.length === 0 ? (
                          <p style={{ margin: "14px 0 0", marginBottom: 0 }}>
                            No job families yet
                          </p>
                        ) : (
                          <div
                            style={{
                              marginTop: 14,
                              display: "flex",
                              flexDirection: "column",
                              gap: 22,
                            }}
                          >
                            {jobFamilies.map((family) => {
                              const rows = jobProfiles.filter(
                                (p) => p.job_family_id === family.id
                              );
                              const isFamilyOpen =
                                expandedFamilyId === family.id;
                              return (
                                <div
                                  key={family.id}
                                  style={{
                                    borderRadius: 10,
                                    border: `1px solid ${border}`,
                                    overflow: "hidden",
                                    backgroundColor: surface,
                                  }}
                                >
                                  <button
                                    type="button"
                                    aria-expanded={isFamilyOpen}
                                    onClick={() =>
                                      setExpandedFamilyId((prev) =>
                                        prev === family.id ? null : family.id
                                      )
                                    }
                                    style={{
                                      width: "100%",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      gap: 12,
                                      padding: "12px 14px",
                                      margin: 0,
                                      border: "none",
                                      cursor: "pointer",
                                      textAlign: "left",
                                      backgroundColor: isFamilyOpen
                                        ? bg
                                        : surface,
                                      color: text,
                                      transition: "background-color 0.18s ease",
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.backgroundColor =
                                        surfaceHover;
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.backgroundColor =
                                        isFamilyOpen ? bg : surface;
                                    }}
                                  >
                                    <span
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 10,
                                        minWidth: 0,
                                      }}
                                    >
                                      <span
                                        aria-hidden
                                        style={{
                                          fontSize: 12,
                                          color: mutedColor,
                                          transform: isFamilyOpen
                                            ? "rotate(90deg)"
                                            : "rotate(0deg)",
                                          transition: "transform 0.22s ease",
                                          flexShrink: 0,
                                        }}
                                      >
                                        ▸
                                      </span>
                                      <span
                                        style={{
                                          fontSize: 15,
                                          fontWeight: 600,
                                          letterSpacing: "0.02em",
                                        }}
                                      >
                                        {family.name}
                                        {!family.is_active && (
                                          <span
                                            style={{
                                              marginLeft: 8,
                                              fontWeight: 500,
                                              fontSize: 12,
                                              color: mutedColor,
                                            }}
                                          >
                                            (inactive)
                                          </span>
                                        )}
                                      </span>
                                    </span>
                                    <span
                                      style={{
                                        fontSize: 12,
                                        color: mutedColor,
                                        flexShrink: 0,
                                      }}
                                    >
                                      {rows.length} role
                                      {rows.length !== 1 ? "s" : ""}
                                    </span>
                                  </button>
                                  <AccordionCollapsible open={isFamilyOpen}>
                                    <div
                                      style={{
                                        padding: "0 14px 14px",
                                        borderTop: `1px solid ${borderSubtle}`,
                                      }}
                                    >
                                      {rows.length === 0 ? (
                                        <p
                                          style={{
                                            margin: "12px 0 0",
                                            marginBottom: 0,
                                            fontSize: 13,
                                            color: mutedColor,
                                          }}
                                        >
                                          No job profiles in this family yet
                                        </p>
                                      ) : (
                                        <ul
                                          style={{
                                            margin: "12px 0 0",
                                            padding: 0,
                                            listStyle: "none",
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 12,
                                          }}
                                        >
                                          {rows.map((row) =>
                                            renderJobProfileCard(row)
                                          )}
                                        </ul>
                                      )}
                                    </div>
                                  </AccordionCollapsible>
                                </div>
                              );
                            })}

                            {uncategorisedProfiles.length > 0 && (
                              <div
                                key={UNCATEGORISED_HEADING}
                                style={{
                                  borderRadius: 10,
                                  border: `1px solid ${border}`,
                                  overflow: "hidden",
                                  backgroundColor: surface,
                                }}
                              >
                                <button
                                  type="button"
                                  aria-expanded={
                                    expandedFamilyId ===
                                    UNCATEGORISED_ACCORDION_ID
                                  }
                                  onClick={() =>
                                    setExpandedFamilyId((prev) =>
                                      prev === UNCATEGORISED_ACCORDION_ID
                                        ? null
                                        : UNCATEGORISED_ACCORDION_ID
                                    )
                                  }
                                  style={{
                                    width: "100%",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 12,
                                    padding: "12px 14px",
                                    margin: 0,
                                    border: "none",
                                    cursor: "pointer",
                                    textAlign: "left",
                                    backgroundColor:
                                      expandedFamilyId ===
                                      UNCATEGORISED_ACCORDION_ID
                                        ? bg
                                        : surface,
                                    color: text,
                                    transition: "background-color 0.18s ease",
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor =
                                      surfaceHover;
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor =
                                      expandedFamilyId ===
                                      UNCATEGORISED_ACCORDION_ID
                                        ? bg
                                        : surface;
                                  }}
                                >
                                  <span
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 10,
                                      minWidth: 0,
                                    }}
                                  >
                                    <span
                                      aria-hidden
                                      style={{
                                        fontSize: 12,
                                        color: mutedColor,
                                        transform:
                                          expandedFamilyId ===
                                          UNCATEGORISED_ACCORDION_ID
                                            ? "rotate(90deg)"
                                            : "rotate(0deg)",
                                        transition: "transform 0.22s ease",
                                        flexShrink: 0,
                                      }}
                                    >
                                      ▸
                                    </span>
                                    <span
                                      style={{
                                        fontSize: 15,
                                        fontWeight: 600,
                                        letterSpacing: "0.02em",
                                      }}
                                    >
                                      {UNCATEGORISED_HEADING}
                                    </span>
                                  </span>
                                  <span
                                    style={{
                                      fontSize: 12,
                                      color: mutedColor,
                                      flexShrink: 0,
                                    }}
                                  >
                                    {uncategorisedProfiles.length} role
                                    {uncategorisedProfiles.length !== 1
                                      ? "s"
                                      : ""}
                                  </span>
                                </button>
                                <AccordionCollapsible
                                  open={
                                    expandedFamilyId ===
                                    UNCATEGORISED_ACCORDION_ID
                                  }
                                >
                                  <div
                                    style={{
                                      padding: "0 14px 14px",
                                      borderTop: `1px solid ${borderSubtle}`,
                                    }}
                                  >
                                    <ul
                                      style={{
                                        margin: "12px 0 0",
                                        padding: 0,
                                        listStyle: "none",
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: 12,
                                      }}
                                    >
                                      {uncategorisedProfiles.map((row) =>
                                        renderJobProfileCard(row)
                                      )}
                                    </ul>
                                  </div>
                                </AccordionCollapsible>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}


        </div>
      )}

      {refineModalOpen && refinementPreview ? (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="refine-modal-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "24px 16px",
            overflow: "auto",
            backgroundColor: "rgba(0,0,0,0.6)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseRefineModal();
          }}
        >
          <div
            style={{
              ...panelShell,
              width: "100%",
              maxWidth: 560,
              marginTop: 40,
              maxHeight: "min(78vh, 720px)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="refine-modal-title"
              style={{
                margin: "0 0 8px",
                fontSize: 17,
                fontWeight: 600,
                color: text,
                letterSpacing: "-0.02em",
              }}
            >
              Refined with company context
            </h3>
            <p style={{ ...muted, margin: "0 0 14px", fontSize: 12, lineHeight: 1.45 }}>
              Preview only. Accept updates the role summary and replaces responsibilities
              and requirements. Your Skills list and competency library assignments on this
              profile are not changed. Nothing is saved until you accept.
            </p>
            <div
              style={{
                flex: 1,
                overflow: "auto",
                display: "grid",
                gap: 16,
                paddingRight: 4,
              }}
            >
              <div>
                <p
                  style={{
                    margin: "0 0 6px",
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: mutedColor,
                  }}
                >
                  Refined role summary
                </p>
                <p
                  style={{
                    margin: 0,
                    fontSize: 14,
                    color: text,
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {refinementPreview.refined_role_summary}
                </p>
              </div>
              <div>
                <p
                  style={{
                    margin: "0 0 6px",
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: mutedColor,
                  }}
                >
                  Improved responsibilities
                </p>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 18,
                    fontSize: 14,
                    color: text,
                    lineHeight: 1.45,
                  }}
                >
                  {refinementPreview.improved_responsibilities.map((line, i) => (
                    <li key={i} style={{ marginBottom: 6 }}>
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p
                  style={{
                    margin: "0 0 6px",
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: mutedColor,
                  }}
                >
                  Suggested requirements
                </p>
                {refinementPreview.suggested_requirements.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 13, color: mutedColor }}>
                    None suggested.
                  </p>
                ) : (
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: 18,
                      fontSize: 14,
                      color: text,
                      lineHeight: 1.45,
                    }}
                  >
                    {refinementPreview.suggested_requirements.map((line, i) => (
                      <li key={i} style={{ marginBottom: 6 }}>
                        {line}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p
                  style={{
                    margin: "0 0 6px",
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: mutedColor,
                  }}
                >
                  Suggested capability themes (reference only)
                </p>
                <p style={{ ...muted, margin: "0 0 8px", fontSize: 12, lineHeight: 1.45 }}>
                  For your review only — not applied to Skills or competency expectations.
                </p>
                {refinementPreview.suggested_capabilities.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 13, color: mutedColor }}>
                    None suggested.
                  </p>
                ) : (
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: 18,
                      fontSize: 14,
                      color: text,
                      lineHeight: 1.45,
                    }}
                  >
                    {refinementPreview.suggested_capabilities.map((line, i) => (
                      <li key={i} style={{ marginBottom: 6 }}>
                        {line}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                marginTop: 18,
                paddingTop: 14,
                borderTop: `1px solid ${border}`,
              }}
            >
              <button
                type="button"
                disabled={acceptingRefinement}
                onClick={() => handleCloseRefineModal()}
                style={btn}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={acceptingRefinement}
                onClick={() => void handleAcceptRefinement()}
                style={{ ...btnPrimary, opacity: acceptingRefinement ? 0.7 : 1 }}
              >
                {acceptingRefinement ? "Applying…" : "Accept"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
