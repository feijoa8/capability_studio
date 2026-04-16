import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FormEvent } from "react";
import { supabase } from "../lib/supabase";
import {
  refineJobProfileWithCompanyContext,
  type JobProfileRefinementResult,
} from "../lib/jobProfileRefinement";
import { suggestJobProfileSkills } from "../lib/jobProfileSkillSuggestions";
import {
  buildCompetencySuggestionRequest,
  buildSubjectNameToIdMap,
  fetchLevelDefinitionsForCompetencyIds,
  fetchLevelNamesByCompetencyIds,
  fetchSubjectsAndCapabilityAreasForSuggestions,
  groupCompetencyAiRowsBySubject,
  resolveAiSuggestionsToReviewRows,
  snapRequiredLevel,
  suggestJobProfileCompetencies,
  type CompetencySuggestionReviewRow,
  type JobProfileCompetencyAiGaps,
} from "../lib/jobProfileCompetencySuggestions";
import {
  suggestJobProfileResponsibilities,
  suggestJobProfileRequirements,
  normalizeHrLineKey,
} from "../lib/jobProfileHrSuggestions";
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
  CompetencyRow,
  CompetencySubjectRow,
} from "./hub/types";
import {
  normalizeJobProfileCompetencyRows,
  normalizeJobProfileLevelName,
  uncategorisedJobProfiles,
  UNCATEGORISED_HEADING,
} from "./hub/hubUtils";
import {
  fetchSubjectPracticeLinksForOrg,
  practiceIdsForSubjectDisplay,
  type SubjectPracticeLinkRow,
} from "./hub/subjectPracticeLinks";
import {
  fetchCompetencyPracticeLinksForOrg,
  type CompetencyPracticeLinkRow,
} from "./hub/competencyPracticeLinks";
import {
  competencyIdsLinkedToPractice,
  defaultLevelNameForDefinitions,
  previewPracticeRoleImport,
  roleCapabilitySeniorityLabel,
  summarizeRoleCapabilityBuildResult,
  type RoleCapabilitySeniority,
} from "./hub/roleCapabilityBuild";
import { AccordionCollapsible } from "./hub/AccordionCollapsible";
import { JobProfileCompetencyAiReviewPanel } from "./hub/JobProfileCompetencyAiReviewPanel";
import {
  bg,
  border,
  borderSubtle,
  btn,
  btnGhost,
  btnPrimary,
  btnSecondary,
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

/** Subject bucket for competencies with no subject_id (edge case). */
const PICKER_NO_SUBJECT_ID = "__picker_no_subject__";

/** Group key for job profile expectations with no linked subject. */
const JOB_PROFILE_EXPECTATIONS_NO_SUBJECT_KEY = "__jp_expectations_no_subject__";

function normalizeCompetencyType(t: string | null | undefined): string {
  return (t || "").toLowerCase().trim();
}

function isPracticeScopeSubjectType(t: string | null | undefined): boolean {
  const n = normalizeCompetencyType(t);
  return n === "practice" || n === "stretch";
}

function subjectEmbedFromCompetency(
  row: CompetencyRow
): CompetencySubjectRow | null {
  const raw = row.competency_subjects;
  if (!raw) return null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw;
}

/** Resolved subject for picker: join row, or synthetic bucket when subject_id is null. */
function resolvedPickerSubject(
  row: CompetencyRow,
  links: SubjectPracticeLinkRow[]
): {
  id: string;
  name: string;
  type: string;
  practice_id: string | null;
  practice_ids: string[];
} | null {
  if (!row.subject_id) {
    return {
      id: PICKER_NO_SUBJECT_ID,
      name: "Competencies not linked to a subject",
      type: "practice",
      practice_id: null,
      practice_ids: [],
    };
  }
  const sub = subjectEmbedFromCompetency(row);
  if (!sub) return null;
  return {
    id: sub.id,
    name: sub.name?.trim() || "Subject",
    type: sub.type || "practice",
    practice_id: sub.practice_id ?? null,
    practice_ids: practiceIdsForSubjectDisplay(links, sub.id, sub.practice_id),
  };
}

function subjectPickerOptionLabel(
  s: {
    id: string;
    name: string;
    type: string;
    practice_id: string | null;
    practice_ids: string[];
  },
  practices: { id: string; name: string }[]
): string {
  if (s.id === PICKER_NO_SUBJECT_ID) return s.name;
  const t = normalizeCompetencyType(s.type);
  if (t === "organisation") return `${s.name} · organisation-wide`;
  const names = s.practice_ids
    .map((id) => practices.find((p) => p.id === id)?.name?.trim())
    .filter((n): n is string => Boolean(n));
  if (names.length > 0) return `${s.name} · ${names.join(", ")}`;
  if (isPracticeScopeSubjectType(s.type) && names.length === 0)
    return `${s.name} · unassigned practice`;
  return s.name;
}

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
  const [mappingCompetencyOptions, setMappingCompetencyOptions] = useState<
    CompetencyRow[]
  >([]);
  const [mappingPracticesForPicker, setMappingPracticesForPicker] = useState<
    { id: string; name: string }[]
  >([]);
  /** Browse: all | practice-scoped subjects | organisation-wide subjects */
  const [assignmentScopeFilter, setAssignmentScopeFilter] = useState<
    "all" | "practice" | "organisation"
  >("all");
  /** Narrow practice-scoped subjects by practice relevance (links + legacy practice_id) */
  const [assignmentPracticeFilter, setAssignmentPracticeFilter] = useState<
    "all" | "unassigned" | string
  >("all");
  const [subjectPracticeLinks, setSubjectPracticeLinks] = useState<
    SubjectPracticeLinkRow[]
  >([]);
  const [competencyPracticeLinksForOrg, setCompetencyPracticeLinksForOrg] =
    useState<CompetencyPracticeLinkRow[]>([]);
  const [assignmentPickerSearch, setAssignmentPickerSearch] = useState("");
  /** single = one competency; subject = bulk from selected subject */
  const [assignmentAddMode, setAssignmentAddMode] = useState<
    "single" | "subject"
  >("single");
  const [bulkCompetencySelection, setBulkCompetencySelection] = useState<
    Record<string, boolean>
  >({});
  const [bulkLevelDefaultsByCompetencyId, setBulkLevelDefaultsByCompetencyId] =
    useState<Record<string, string>>({});
  const [bulkLevelDefaultsLoading, setBulkLevelDefaultsLoading] =
    useState(false);
  const [pickerSubjectId, setPickerSubjectId] = useState("");
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
  const [competencyAiSuggestLoading, setCompetencyAiSuggestLoading] =
    useState(false);
  const [competencyAiSuggestError, setCompetencyAiSuggestError] = useState<
    string | null
  >(null);
  const [competencyAiReviewActive, setCompetencyAiReviewActive] = useState(false);
  const [competencyAiReviewRows, setCompetencyAiReviewRows] = useState<
    CompetencySuggestionReviewRow[]
  >([]);
  const [competencyAiGaps, setCompetencyAiGaps] =
    useState<JobProfileCompetencyAiGaps | null>(null);
  /** Build modal: primary practice overlay for bulk import */
  const [buildModalPracticeId, setBuildModalPracticeId] = useState("");
  const [buildModalSeniority, setBuildModalSeniority] =
    useState<RoleCapabilitySeniority>("intermediate");
  const [roleAugmentationRows, setRoleAugmentationRows] = useState<
    CompetencySuggestionReviewRow[]
  >([]);
  const [roleAugmentationLoading, setRoleAugmentationLoading] = useState(false);
  const [roleAugmentationError, setRoleAugmentationError] = useState<
    string | null
  >(null);
  const [buildCapabilityFeedback, setBuildCapabilityFeedback] = useState<
    string | null
  >(null);
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

  const [editingRolePurposeProfileId, setEditingRolePurposeProfileId] =
    useState<string | null>(null);
  const [draftRolePurpose, setDraftRolePurpose] = useState("");
  const [rolePurposeSaving, setRolePurposeSaving] = useState(false);

  const [skillSuggestModalOpen, setSkillSuggestModalOpen] = useState(false);
  const [skillSuggestJobProfileId, setSkillSuggestJobProfileId] = useState<
    string | null
  >(null);
  /** Flattened preview lines: core vs tools (stored in one DB skills list on apply). */
  const [skillSuggestLines, setSkillSuggestLines] = useState<
    { text: string; kind: "core" | "tools" }[] | null
  >(null);
  /** Parallel to skillSuggestLines — whether each row is selected for add */
  const [skillSuggestSelected, setSkillSuggestSelected] = useState<boolean[]>(
    [],
  );
  const [skillSuggestLoading, setSkillSuggestLoading] = useState(false);
  const [skillSuggestAccepting, setSkillSuggestAccepting] = useState(false);
  const [suggestingSkillsTargetId, setSuggestingSkillsTargetId] = useState<
    string | null
  >(null);

  const [respSuggestModalOpen, setRespSuggestModalOpen] = useState(false);
  const [respSuggestJobProfileId, setRespSuggestJobProfileId] = useState<
    string | null
  >(null);
  const [respSuggestions, setRespSuggestions] = useState<string[] | null>(
    null,
  );
  const [respSuggestSelected, setRespSuggestSelected] = useState<boolean[]>([]);
  const [respSuggestLoading, setRespSuggestLoading] = useState(false);
  const [respSuggestAccepting, setRespSuggestAccepting] = useState(false);
  const [suggestingRespTargetId, setSuggestingRespTargetId] = useState<
    string | null
  >(null);

  const [reqSuggestModalOpen, setReqSuggestModalOpen] = useState(false);
  const [reqSuggestJobProfileId, setReqSuggestJobProfileId] = useState<
    string | null
  >(null);
  const [reqSuggestions, setReqSuggestions] = useState<string[] | null>(null);
  const [reqSuggestSelected, setReqSuggestSelected] = useState<boolean[]>([]);
  const [reqSuggestLoading, setReqSuggestLoading] = useState(false);
  const [reqSuggestAccepting, setReqSuggestAccepting] = useState(false);
  const [suggestingReqTargetId, setSuggestingReqTargetId] = useState<
    string | null
  >(null);

  /** families = job family cards; familyRoles = roles in one family; roleDetail = full role editor */
  const [jobProfilesNav, setJobProfilesNav] = useState<
    "families" | "familyRoles" | "roleDetail"
  >("families");
  /** When nav is familyRoles: job family id or UNCATEGORISED_ACCORDION_ID */
  const [roleListFamilyId, setRoleListFamilyId] = useState<string | null>(null);
  const [roleListCounts, setRoleListCounts] = useState<
    Record<string, { resp: number; req: number; comp: number }>
  >({});
  const [roleListCountsLoading, setRoleListCountsLoading] = useState(false);
  /** Role detail collapsible sections — all closed by default */
  const [roleDetailSectionOpen, setRoleDetailSectionOpen] = useState({
    resp: false,
    req: false,
    comp: false,
    skills: false,
  });
  /** Per subject group inside Competency expectations: true = expanded */
  const [expectationSubjectGroupOpen, setExpectationSubjectGroupOpen] =
    useState<Record<string, boolean>>({});

  /** Invalidates in-flight job profile loads so stale completions cannot skip setJobProfilesLoading(false) or apply wrong org. */
  const jobProfilesLoadGenRef = useRef(0);

  useEffect(() => {
    setJobProfilesNav("families");
    setRoleListFamilyId(null);
  }, [activeOrgId]);

  /** After loadJobProfiles clears selection, nav can stay on roleDetail/familyRoles with nothing to show. */
  useEffect(() => {
    if (!isActive) return;
    if (jobProfilesNav === "roleDetail" && selectedJobProfileId === null) {
      setJobProfilesNav("families");
    }
    if (jobProfilesNav === "familyRoles" && roleListFamilyId === null) {
      setJobProfilesNav("families");
    }
  }, [isActive, jobProfilesNav, selectedJobProfileId, roleListFamilyId]);

  useEffect(() => {
    if (!activeOrgId || !isActive) {
      setSubjectPracticeLinks([]);
      setCompetencyPracticeLinksForOrg([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [spl, cpl] = await Promise.all([
        fetchSubjectPracticeLinksForOrg(activeOrgId),
        fetchCompetencyPracticeLinksForOrg(activeOrgId),
      ]);
      if (!cancelled) {
        setSubjectPracticeLinks(spl);
        setCompetencyPracticeLinksForOrg(cpl);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeOrgId, isActive]);

  const reloadJobProfileMappingPanelData = useCallback(async (orgId: string) => {
    setMappingPanelLoading(true);
    const [compRes, pracRes] = await Promise.all([
      supabase
        .from("competencies")
        .select(
          "id, name, description, subject_id, competency_type, status, competency_subjects ( id, name, type, practice_id )"
        )
        .eq("organisation_id", orgId)
        .eq("status", "active")
        .order("name"),
      supabase
        .from("competency_practices")
        .select("id, name")
        .eq("organisation_id", orgId)
        .in("status", ["active", "deprecated"])
        .order("name"),
    ]);

    if (compRes.error) {
      console.error(compRes.error);
      setMappingCompetencyOptions([]);
    } else {
      setMappingCompetencyOptions(
        (compRes.data as CompetencyRow[] | null) ?? []
      );
    }

    if (pracRes.error) {
      console.error(pracRes.error);
      setMappingPracticesForPicker([]);
    } else {
      setMappingPracticesForPicker(
        (pracRes.data as { id: string; name: string }[] | null) ?? []
      );
    }

    const [spl, cpl] = await Promise.all([
      fetchSubjectPracticeLinksForOrg(orgId),
      fetchCompetencyPracticeLinksForOrg(orgId),
    ]);
    setSubjectPracticeLinks(spl);
    setCompetencyPracticeLinksForOrg(cpl);

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
          "id, job_profile_id, competency_id, required_level, is_required, relevance, competencies ( id, name, status, description, subject_id, competency_subjects ( id, name, type, practice_id ) )"
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
    setEditingRolePurposeProfileId(null);
    setDraftRolePurpose("");
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
      jobProfilesLoadGenRef.current += 1;
      setJobProfilesLoading(false);
      return;
    }

    jobProfilesLoadGenRef.current += 1;
    const loadGen = jobProfilesLoadGenRef.current;
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
      setMappingCompetencyOptions([]);
      setMappingPracticesForPicker([]);
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

      if (loadGen !== jobProfilesLoadGenRef.current) {
        return;
      }

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
      jobProfilesLoadGenRef.current += 1;
    };
  }, [isActive, activeOrgId, showArchivedJobProfiles]);
  useEffect(() => {
    if (!isActive || activeOrgId === null) {
      setMappingCompetencyOptions([]);
      setMappingPracticesForPicker([]);
      return;
    }

    if (selectedJobProfileId === null) {
      setMappingCompetencyOptions([]);
      setMappingPracticesForPicker([]);
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
    setPickerSubjectId("");
    setAssignmentScopeFilter("all");
    setAssignmentPracticeFilter("all");
    setAssignmentPickerSearch("");
    setAssignmentAddMode("single");
    setBulkCompetencySelection({});
    setBulkLevelDefaultsByCompetencyId({});
    setBulkLevelDefaultsLoading(false);
    setCompetencyAiReviewActive(false);
    setCompetencyAiReviewRows([]);
    setCompetencyAiGaps(null);
    setCompetencyAiSuggestError(null);
    setCompetencyAiSuggestLoading(false);
    setBuildModalPracticeId("");
    setBuildModalSeniority("intermediate");
    setRoleAugmentationRows([]);
    setRoleAugmentationLoading(false);
    setRoleAugmentationError(null);
    setBuildCapabilityFeedback(null);
  }

  const subjectsForAssignmentPicker = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string;
        name: string;
        type: string;
        practice_id: string | null;
        practice_ids: string[];
      }
    >();
    for (const c of mappingCompetencyOptions) {
      const r = resolvedPickerSubject(c, subjectPracticeLinks);
      if (!r) continue;
      if (!map.has(r.id)) map.set(r.id, r);
    }
    let list = [...map.values()];
    if (assignmentScopeFilter === "practice") {
      list = list.filter(
        (s) =>
          s.id === PICKER_NO_SUBJECT_ID ||
          isPracticeScopeSubjectType(s.type)
      );
    } else if (assignmentScopeFilter === "organisation") {
      list = list.filter(
        (s) =>
          s.id !== PICKER_NO_SUBJECT_ID &&
          normalizeCompetencyType(s.type) === "organisation"
      );
    }
    if (
      assignmentScopeFilter === "all" ||
      assignmentScopeFilter === "practice"
    ) {
      if (assignmentPracticeFilter === "unassigned") {
        list = list.filter(
          (s) =>
            s.id === PICKER_NO_SUBJECT_ID ||
            (isPracticeScopeSubjectType(s.type) &&
              s.practice_ids.length === 0)
        );
      } else if (assignmentPracticeFilter !== "all") {
        list = list.filter(
          (s) =>
            s.id !== PICKER_NO_SUBJECT_ID &&
            s.practice_ids.includes(assignmentPracticeFilter)
        );
      }
    }
    const q = assignmentPickerSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((s) => s.name.toLowerCase().includes(q));
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [
    mappingCompetencyOptions,
    assignmentScopeFilter,
    assignmentPracticeFilter,
    assignmentPickerSearch,
    subjectPracticeLinks,
  ]);

  const competenciesForAssignmentPicker = useMemo(() => {
    if (!pickerSubjectId) return [];
    let list = mappingCompetencyOptions.filter((c) => {
      if (pickerSubjectId === PICKER_NO_SUBJECT_ID) return !c.subject_id;
      return c.subject_id === pickerSubjectId;
    });
    const q = assignmentPickerSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((c) => c.name.toLowerCase().includes(q));
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [
    mappingCompetencyOptions,
    pickerSubjectId,
    assignmentPickerSearch,
  ]);

  /** Full subject list for bulk add (search only narrows the checklist view). */
  const allCompetenciesInPickerSubject = useMemo(() => {
    if (!pickerSubjectId) return [];
    let list = mappingCompetencyOptions.filter((c) => {
      if (pickerSubjectId === PICKER_NO_SUBJECT_ID) return !c.subject_id;
      return c.subject_id === pickerSubjectId;
    });
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [mappingCompetencyOptions, pickerSubjectId]);

  const bulkCompetenciesDisplayed = useMemo(() => {
    const q = assignmentPickerSearch.trim().toLowerCase();
    if (!q) return allCompetenciesInPickerSubject;
    return allCompetenciesInPickerSubject.filter((c) => {
      const name = c.name.toLowerCase();
      const desc = (c.description || "").toLowerCase();
      return name.includes(q) || desc.includes(q);
    });
  }, [allCompetenciesInPickerSubject, assignmentPickerSearch]);

  const bulkChosenCount = useMemo(() => {
    if (!pickerSubjectId) return 0;
    return allCompetenciesInPickerSubject.filter(
      (c) => bulkCompetencySelection[c.id] !== false
    ).length;
  }, [
    pickerSubjectId,
    allCompetenciesInPickerSubject,
    bulkCompetencySelection,
  ]);

  useEffect(() => {
    if (assignmentAddMode !== "subject" || !pickerSubjectId) {
      setBulkCompetencySelection({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const c of allCompetenciesInPickerSubject) {
      next[c.id] = true;
    }
    setBulkCompetencySelection(next);
  }, [assignmentAddMode, pickerSubjectId, allCompetenciesInPickerSubject]);

  useEffect(() => {
    if (assignmentAddMode !== "subject" || !pickerSubjectId) {
      setBulkLevelDefaultsByCompetencyId({});
      setBulkLevelDefaultsLoading(false);
      return;
    }
    const ids = allCompetenciesInPickerSubject.map((c) => c.id);
    if (ids.length === 0) {
      setBulkLevelDefaultsByCompetencyId({});
      setBulkLevelDefaultsLoading(false);
      return;
    }

    let cancelled = false;

    async function loadBulkLevelDefaults() {
      setBulkLevelDefaultsLoading(true);
      const res = await supabase
        .from("competency_level_definitions")
        .select("competency_id, level_name, level_order")
        .in("competency_id", ids)
        .eq("is_active", true)
        .order("level_order", { ascending: true });

      if (cancelled) return;

      if (res.error) {
        console.error(res.error);
        setBulkLevelDefaultsByCompetencyId({});
      } else {
        const rows =
          (res.data as {
            competency_id: string;
            level_name: string;
            level_order: number;
          }[]) ?? [];
        const byComp: Record<string, string> = {};
        for (const r of rows) {
          if (byComp[r.competency_id] === undefined) {
            byComp[r.competency_id] = r.level_name;
          }
        }
        setBulkLevelDefaultsByCompetencyId(byComp);
      }
      setBulkLevelDefaultsLoading(false);
    }

    void loadBulkLevelDefaults();
    return () => {
      cancelled = true;
    };
  }, [assignmentAddMode, pickerSubjectId, allCompetenciesInPickerSubject]);

  useEffect(() => {
    if (!pickerSubjectId) return;
    const ok = subjectsForAssignmentPicker.some((s) => s.id === pickerSubjectId);
    if (!ok) {
      setPickerSubjectId("");
      setSelectedCompetencyId("");
    }
  }, [subjectsForAssignmentPicker, pickerSubjectId]);

  function handleCancelAddCompetencyExpectation() {
    resetAddCompetencyExpectationFormFields();
    setShowAddCompetencyExpectationForm(false);
  }

  function goToFamilyRoles(familyId: string) {
    setRoleListCounts({});
    setRoleListCountsLoading(true);
    setRoleListFamilyId(familyId);
    setJobProfilesNav("familyRoles");
    setSelectedJobProfileId(null);
    setEditingProfileId(null);
    setShowAddCompetencyExpectationForm(false);
    resetAddCompetencyExpectationFormFields();
  }

  function goBackToFamilies() {
    setJobProfilesNav("families");
    setRoleListFamilyId(null);
    setRoleListCounts({});
    setRoleListCountsLoading(false);
    setSelectedJobProfileId(null);
    setEditingProfileId(null);
    setShowAddCompetencyExpectationForm(false);
    resetAddCompetencyExpectationFormFields();
  }

  function openRoleDetail(row: JobProfileRow, withEdit: boolean) {
    setSelectedJobProfileId(row.id);
    setJobProfilesNav("roleDetail");
    setRoleDetailSectionOpen({
      resp: false,
      req: false,
      comp: false,
      skills: false,
    });
    setShowAddCompetencyExpectationForm(false);
    resetAddCompetencyExpectationFormFields();
    if (withEdit) {
      handleStartEditProfile(row);
    } else {
      setEditingProfileId(null);
    }
  }

  function backFromRoleDetail() {
    setEditingProfileId(null);
    setEditingRolePurposeProfileId(null);
    setDraftRolePurpose("");
    setShowAddCompetencyExpectationForm(false);
    resetAddCompetencyExpectationFormFields();
    setSelectedJobProfileId(null);
    setJobProfilesNav(roleListFamilyId ? "familyRoles" : "families");
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

  async function handleBulkSaveJobProfileCompetencies() {
    if (activeOrgId === null || selectedJobProfileId === null) {
      alert("No active workspace selected");
      return;
    }
    if (!pickerSubjectId) {
      alert("Please select a subject");
      return;
    }

    const chosenIds = allCompetenciesInPickerSubject
      .map((c) => c.id)
      .filter((id) => bulkCompetencySelection[id] !== false);
    if (chosenIds.length === 0) {
      alert("Select at least one competency");
      return;
    }

    const already = new Set(
      jobProfileCompetencies.map((m) => m.competency_id)
    );
    const toInsert: {
      competency_id: string;
      required_level: string;
    }[] = [];
    const skippedNoLevel: string[] = [];
    const skippedAssigned: string[] = [];

    for (const id of chosenIds) {
      if (already.has(id)) {
        skippedAssigned.push(id);
        continue;
      }
      const level = bulkLevelDefaultsByCompetencyId[id]?.trim();
      if (!level) {
        skippedNoLevel.push(id);
        continue;
      }
      toInsert.push({ competency_id: id, required_level: level });
    }

    if (toInsert.length === 0) {
      const parts: string[] = [];
      if (skippedAssigned.length)
        parts.push(
          `${skippedAssigned.length} already on this role`
        );
      if (skippedNoLevel.length)
        parts.push(
          `${skippedNoLevel.length} have no active level scale — add levels in Competencies first`
        );
      alert(
        parts.length
          ? `Nothing to add. ${parts.join(". ")}`
          : "Nothing to add."
      );
      return;
    }

    setIsSavingMapping(true);
    const rows = toInsert.map((r) => ({
      job_profile_id: selectedJobProfileId,
      competency_id: r.competency_id,
      required_level: r.required_level,
      is_required: mapIsRequired,
      relevance: selectedRelevance,
    }));

    const { error } = await supabase
      .from("job_profile_competencies")
      .insert(rows);

    if (error) {
      console.error("Job profile competency bulk insert error:", error);
      const msg =
        error.code === "23505"
          ? "One or more competencies are already assigned (try again with fewer selected)."
          : error.message || "Failed to save competency assignments";
      alert(msg);
      setIsSavingMapping(false);
      return;
    }

    let summary = `Added ${toInsert.length} competency expectation${toInsert.length === 1 ? "" : "s"}.`;
    if (skippedAssigned.length)
      summary += ` Skipped ${skippedAssigned.length} already assigned.`;
    if (skippedNoLevel.length)
      summary += ` Skipped ${skippedNoLevel.length} with no levels.`;
    if (skippedAssigned.length || skippedNoLevel.length) {
      alert(summary);
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

  const profilesInRoleListNav = useMemo(() => {
    if (!roleListFamilyId) return [];
    if (roleListFamilyId === UNCATEGORISED_ACCORDION_ID)
      return uncategorisedProfiles;
    return jobProfiles.filter((p) => p.job_family_id === roleListFamilyId);
  }, [jobProfiles, roleListFamilyId, uncategorisedProfiles]);

  /** Stable dependency so we do not re-fetch counts when only array identity changes. */
  const familyRoleIdsKey = useMemo(() => {
    if (!roleListFamilyId) return "";
    return profilesInRoleListNav
      .map((p) => p.id)
      .sort()
      .join(",");
  }, [profilesInRoleListNav, roleListFamilyId]);

  useEffect(() => {
    if (jobProfilesNav !== "familyRoles" || !roleListFamilyId) {
      setRoleListCounts({});
      setRoleListCountsLoading(false);
      return;
    }
    if (!familyRoleIdsKey) {
      setRoleListCounts({});
      setRoleListCountsLoading(false);
      return;
    }
    const ids = familyRoleIdsKey.split(",").filter(Boolean);
    if (ids.length === 0) {
      setRoleListCounts({});
      setRoleListCountsLoading(false);
      return;
    }

    let cancelled = false;

    async function loadCounts() {
      setRoleListCountsLoading(true);
      const [r1, r2, r3] = await Promise.all([
        supabase
          .from("job_profile_responsibilities")
          .select("job_profile_id")
          .in("job_profile_id", ids),
        supabase
          .from("job_profile_requirements")
          .select("job_profile_id")
          .in("job_profile_id", ids),
        supabase
          .from("job_profile_competencies")
          .select("job_profile_id")
          .in("job_profile_id", ids),
      ]);

      if (cancelled) return;

      const next: Record<string, { resp: number; req: number; comp: number }> =
        {};
      for (const id of ids) {
        next[id] = { resp: 0, req: 0, comp: 0 };
      }
      if (!r1.error && r1.data) {
        for (const row of r1.data as { job_profile_id: string }[]) {
          if (next[row.job_profile_id]) next[row.job_profile_id].resp++;
        }
      }
      if (!r2.error && r2.data) {
        for (const row of r2.data as { job_profile_id: string }[]) {
          if (next[row.job_profile_id]) next[row.job_profile_id].req++;
        }
      }
      if (!r3.error && r3.data) {
        for (const row of r3.data as { job_profile_id: string }[]) {
          if (next[row.job_profile_id]) next[row.job_profile_id].comp++;
        }
      }

      setRoleListCounts(next);
      setRoleListCountsLoading(false);
    }

    void loadCounts();
    return () => {
      cancelled = true;
    };
  }, [jobProfilesNav, roleListFamilyId, familyRoleIdsKey]);

  const selectedDetailJobProfile = useMemo(() => {
    if (!selectedJobProfileId) return null;
    return jobProfiles.find((p) => p.id === selectedJobProfileId) ?? null;
  }, [jobProfiles, selectedJobProfileId]);

  const buildPracticeImportPreview = useMemo(() => {
    const pid = buildModalPracticeId.trim();
    if (!pid) return null;
    return previewPracticeRoleImport(
      pid,
      competencyPracticeLinksForOrg,
      mappingCompetencyOptions,
    );
  }, [
    buildModalPracticeId,
    competencyPracticeLinksForOrg,
    mappingCompetencyOptions,
  ]);

  const buildModalPracticeName = useMemo(() => {
    const id = buildModalPracticeId.trim();
    if (!id) return null;
    return mappingPracticesForPicker.find((p) => p.id === id)?.name ?? null;
  }, [buildModalPracticeId, mappingPracticesForPicker]);

  const competencyAiReviewCoreBySubject = useMemo(
    () => groupCompetencyAiRowsBySubject(competencyAiReviewRows, "core"),
    [competencyAiReviewRows]
  );
  const competencyAiReviewSupportingBySubject = useMemo(
    () => groupCompetencyAiRowsBySubject(competencyAiReviewRows, "supporting"),
    [competencyAiReviewRows]
  );

  function patchCompetencyAiRow(
    key: string,
    patch: Partial<CompetencySuggestionReviewRow>
  ) {
    setCompetencyAiReviewRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...patch } : r))
    );
  }

  function toggleCompetencyAiSubjectGroup(
    tier: "core" | "supporting",
    subjectName: string,
    selected: boolean
  ) {
    setCompetencyAiReviewRows((prev) =>
      prev.map((r) =>
        r.tier === tier && r.subjectName === subjectName
          ? { ...r, selected }
          : r
      )
    );
  }

  async function handleRunCompetencyAiSuggest() {
    if (activeOrgId === null || selectedJobProfileId === null) {
      alert("No active workspace or job profile.");
      return;
    }
    if (!selectedDetailJobProfile) {
      alert("Job profile not loaded.");
      return;
    }
    if (mappingCompetencyOptions.length === 0) {
      alert(
        "Competency catalogue is still loading or empty. Open this panel again in a moment."
      );
      return;
    }
    setCompetencyAiSuggestLoading(true);
    setCompetencyAiSuggestError(null);
    try {
      const { capability_areas, subjects } =
        await fetchSubjectsAndCapabilityAreasForSuggestions(activeOrgId);
      const ids = mappingCompetencyOptions.map((c) => c.id);
      const levelNamesByCompetencyId = await fetchLevelNamesByCompetencyIds(ids);
      const familyName = selectedDetailJobProfile.job_family_id
        ? jobFamilies.find(
            (f) => f.id === selectedDetailJobProfile.job_family_id
          )?.name ?? null
        : null;
      const body = buildCompetencySuggestionRequest({
        companyProfile: companyProfile,
        jobTitle: selectedDetailJobProfile.title,
        levelName: selectedDetailJobProfile.level_name ?? null,
        jobFamilyName: familyName,
        roleSummary: selectedDetailJobProfile.role_summary ?? null,
        responsibilities: profileResponsibilities.map((r) => r.description),
        requirements: profileRequirements.map((r) => r.description),
        existingCompetencyNames: jobProfileCompetencies.map(
          (m) => m.competency_name
        ),
        mappingCompetencyOptions,
        capability_areas,
        subjects,
        subjectPracticeLinks,
        practiceOptions: mappingPracticesForPicker,
        levelNamesByCompetencyId,
      });
      const ai = await suggestJobProfileCompetencies(body);
      const subjectNameToId = buildSubjectNameToIdMap(subjects);
      let rows = resolveAiSuggestionsToReviewRows(
        ai,
        subjectNameToId,
        mappingCompetencyOptions
      );
      const existing = new Set(
        jobProfileCompetencies.map((m) => m.competency_id)
      );
      rows = rows.filter((r) => !existing.has(r.competencyId));
      const levelDefsByComp = await fetchLevelDefinitionsForCompetencyIds(
        rows.map((r) => r.competencyId)
      );
      rows = rows
        .map((r) => {
          const defs = levelDefsByComp[r.competencyId] ?? [];
          const snapped = snapRequiredLevel(r.requiredLevel, defs);
          return {
            ...r,
            levelOptions: defs,
            requiredLevel: defs.length > 0 ? snapped : r.requiredLevel,
          };
        })
        .filter((r) => r.levelOptions.length > 0);

      setCompetencyAiGaps(
        ai.gaps ?? {
          missing_competencies: [],
          missing_subjects: [],
        }
      );
      setCompetencyAiReviewRows(rows);
      setCompetencyAiReviewActive(true);
    } catch (e) {
      setCompetencyAiSuggestError(
        e instanceof Error ? e.message : "Suggestion request failed."
      );
    } finally {
      setCompetencyAiSuggestLoading(false);
    }
  }

  async function handleApplyCompetencyAiSuggestions() {
    if (activeOrgId === null || selectedJobProfileId === null) return;
    const accepted = competencyAiReviewRows.filter((r) => r.selected);
    if (accepted.length === 0) {
      alert("Select at least one competency to apply.");
      return;
    }
    for (const r of accepted) {
      if (!r.requiredLevel.trim()) {
        alert(`Select a required level for: ${r.competencyName}`);
        return;
      }
    }
    setIsSavingMapping(true);
    const rows = accepted.map((r) => ({
      job_profile_id: selectedJobProfileId,
      competency_id: r.competencyId,
      required_level: r.requiredLevel.trim(),
      is_required: r.isRequired,
      relevance: r.relevance,
    }));
    const { error } = await supabase
      .from("job_profile_competencies")
      .insert(rows);
    if (error) {
      console.error(error);
      const msg =
        error.code === "23505"
          ? "One or more competencies are already assigned."
          : error.message || "Failed to save competency assignments";
      alert(msg);
      setIsSavingMapping(false);
      return;
    }
    resetAddCompetencyExpectationFormFields();
    setShowAddCompetencyExpectationForm(false);
    setIsSavingMapping(false);
    await loadJobProfileCompetencies(selectedJobProfileId);
  }

  function patchRoleAugmentationRow(
    key: string,
    patch: Partial<CompetencySuggestionReviewRow>,
  ) {
    setRoleAugmentationRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  }

  async function handleSuggestRoleAugmentations() {
    if (activeOrgId === null || selectedJobProfileId === null) {
      alert("No active workspace or job profile.");
      return;
    }
    if (!buildModalPracticeId.trim()) {
      alert(
        "Select a practice first — suggestions use it as the primary lens.",
      );
      return;
    }
    if (!selectedDetailJobProfile) {
      alert("Job profile not loaded.");
      return;
    }
    if (mappingCompetencyOptions.length === 0) {
      alert(
        "Competency catalogue is still loading or empty. Try again in a moment.",
      );
      return;
    }
    setRoleAugmentationLoading(true);
    setRoleAugmentationError(null);
    setBuildCapabilityFeedback(null);
    try {
      const { capability_areas, subjects } =
        await fetchSubjectsAndCapabilityAreasForSuggestions(activeOrgId);
      const ids = mappingCompetencyOptions.map((c) => c.id);
      const levelNamesByCompetencyId = await fetchLevelNamesByCompetencyIds(ids);
      const familyName = selectedDetailJobProfile.job_family_id
        ? jobFamilies.find(
            (f) => f.id === selectedDetailJobProfile.job_family_id,
          )?.name ?? null
        : null;
      const practiceId = buildModalPracticeId.trim();
      const practiceLinked = competencyIdsLinkedToPractice(
        practiceId,
        competencyPracticeLinksForOrg,
      );
      const coveredNames = mappingCompetencyOptions
        .filter((c) => practiceLinked.has(c.id))
        .map((c) => c.name.trim())
        .filter(Boolean)
        .slice(0, 120);
      const body = buildCompetencySuggestionRequest({
        companyProfile: companyProfile,
        jobTitle: selectedDetailJobProfile.title,
        levelName: selectedDetailJobProfile.level_name ?? null,
        jobFamilyName: familyName,
        roleSummary: selectedDetailJobProfile.role_summary ?? null,
        responsibilities: profileResponsibilities.map((r) => r.description),
        requirements: profileRequirements.map((r) => r.description),
        existingCompetencyNames: jobProfileCompetencies.map(
          (m) => m.competency_name,
        ),
        mappingCompetencyOptions,
        capability_areas,
        subjects,
        subjectPracticeLinks,
        practiceOptions: mappingPracticesForPicker,
        levelNamesByCompetencyId,
        roleCapabilityCalibration:
          roleCapabilitySeniorityLabel(buildModalSeniority),
        primaryPracticeName: buildModalPracticeName,
        augmentationGuidance:
          "Focus on hybrid / leadership / stakeholder / strategy / delivery governance additions that are not already covered by the primary practice overlay.",
        competencyNamesFromPrimaryPractice:
          coveredNames.length > 0 ? coveredNames : undefined,
      });
      const ai = await suggestJobProfileCompetencies(body);
      const subjectNameToId = buildSubjectNameToIdMap(subjects);
      let rows = resolveAiSuggestionsToReviewRows(
        ai,
        subjectNameToId,
        mappingCompetencyOptions,
      );
      const existing = new Set(
        jobProfileCompetencies.map((m) => m.competency_id),
      );
      rows = rows.filter((r) => !existing.has(r.competencyId));
      rows = rows.filter((r) => !practiceLinked.has(r.competencyId));
      const levelDefsByComp = await fetchLevelDefinitionsForCompetencyIds(
        rows.map((r) => r.competencyId),
      );
      rows = rows
        .map((r) => {
          const defs = levelDefsByComp[r.competencyId] ?? [];
          const snapped = snapRequiredLevel(r.requiredLevel, defs);
          return {
            ...r,
            levelOptions: defs,
            requiredLevel: defs.length > 0 ? snapped : r.requiredLevel,
          };
        })
        .filter((r) => r.levelOptions.length > 0);
      setRoleAugmentationRows(rows);
    } catch (e) {
      setRoleAugmentationError(
        e instanceof Error ? e.message : "Suggestion request failed.",
      );
    } finally {
      setRoleAugmentationLoading(false);
    }
  }

  async function handleApplyBuildRoleCapabilities() {
    if (activeOrgId === null || selectedJobProfileId === null) {
      alert("No active workspace or job profile.");
      return;
    }
    const practiceId = buildModalPracticeId.trim();
    const preview =
      practiceId &&
      previewPracticeRoleImport(
        practiceId,
        competencyPracticeLinksForOrg,
        mappingCompetencyOptions,
      );
    const aug = roleAugmentationRows.filter((r) => r.selected);
    for (const r of aug) {
      if (!r.requiredLevel.trim()) {
        alert(`Select a required level for: ${r.competencyName}`);
        return;
      }
    }
    if (
      (!preview || preview.competencyIds.length === 0) &&
      aug.length === 0
    ) {
      alert(
        "Select a practice with linked competencies and/or pick suggested additions, then try again.",
      );
      return;
    }
    setIsSavingMapping(true);
    setBuildCapabilityFeedback(null);
    const already = new Set(jobProfileCompetencies.map((m) => m.competency_id));
    const seniority = buildModalSeniority;
    const seniorityLabel = roleCapabilitySeniorityLabel(seniority);
    let skippedAlready = 0;
    let skippedNoLevel = 0;
    let addedPractice = 0;
    let addedAug = 0;
    const toInsert: {
      job_profile_id: string;
      competency_id: string;
      required_level: string;
      is_required: boolean;
      relevance: JobProfileCompetencyRelevance;
    }[] = [];
    const claimed = new Set<string>();

    if (preview && preview.competencyIds.length > 0) {
      const defsMap = await fetchLevelDefinitionsForCompetencyIds(
        preview.competencyIds,
      );
      for (const cid of preview.competencyIds) {
        if (already.has(cid)) {
          skippedAlready++;
          continue;
        }
        if (claimed.has(cid)) continue;
        const defs = defsMap[cid] ?? [];
        const level = defaultLevelNameForDefinitions(seniority, defs);
        if (!level) {
          skippedNoLevel++;
          continue;
        }
        toInsert.push({
          job_profile_id: selectedJobProfileId,
          competency_id: cid,
          required_level: level,
          is_required: mapIsRequired,
          relevance: selectedRelevance,
        });
        claimed.add(cid);
        addedPractice++;
      }
    }

    for (const r of aug) {
      if (already.has(r.competencyId)) {
        skippedAlready++;
        continue;
      }
      if (claimed.has(r.competencyId)) continue;
      toInsert.push({
        job_profile_id: selectedJobProfileId,
        competency_id: r.competencyId,
        required_level: r.requiredLevel.trim(),
        is_required: r.isRequired,
        relevance: r.relevance,
      });
      claimed.add(r.competencyId);
      addedAug++;
    }

    if (toInsert.length === 0) {
      const summary = summarizeRoleCapabilityBuildResult({
        practiceName: buildModalPracticeName,
        addedFromPractice: 0,
        skippedAlreadyOnRole: skippedAlready,
        skippedNoLevel,
        addedAugmentation: 0,
        seniorityLabel,
      });
      const text = summary.lines.join("\n");
      setBuildCapabilityFeedback(text || null);
      alert(
        text ||
          "Nothing new to add — all items were already on this role or missing level scales.",
      );
      setIsSavingMapping(false);
      return;
    }

    const { error } = await supabase
      .from("job_profile_competencies")
      .insert(toInsert);
    if (error) {
      console.error(error);
      const msg =
        error.code === "23505"
          ? "One or more competencies are already assigned."
          : error.message || "Failed to save competency assignments";
      alert(msg);
      setIsSavingMapping(false);
      return;
    }
    await loadJobProfileCompetencies(selectedJobProfileId);
    const summary = summarizeRoleCapabilityBuildResult({
      practiceName: buildModalPracticeName,
      addedFromPractice: addedPractice,
      skippedAlreadyOnRole: skippedAlready,
      skippedNoLevel,
      addedAugmentation: addedAug,
      seniorityLabel,
    });
    const text = summary.lines.join("\n");
    setBuildCapabilityFeedback(text);
    alert(text);
    setIsSavingMapping(false);
  }

  const roleListFamilyTitle = useMemo(() => {
    if (!roleListFamilyId) return "";
    if (roleListFamilyId === UNCATEGORISED_ACCORDION_ID)
      return UNCATEGORISED_HEADING;
    return jobFamilies.find((f) => f.id === roleListFamilyId)?.name ?? "Job family";
  }, [roleListFamilyId, jobFamilies]);

  const competencyExpectationsBySubject = useMemo(() => {
    type Group = {
      key: string;
      headingLabel: string;
      subjectType: string | null;
      practiceIds: string[];
      items: JobProfileCompetencyMappingRow[];
    };
    const map = new Map<string, Group>();
    for (const m of jobProfileCompetencies) {
      const key =
        m.subject_id != null && m.subject_id !== ""
          ? m.subject_id
          : JOB_PROFILE_EXPECTATIONS_NO_SUBJECT_KEY;
      const headingLabel =
        key === JOB_PROFILE_EXPECTATIONS_NO_SUBJECT_KEY
          ? "No subject linked"
          : (m.subject_name?.trim() || "Subject");
      const prev = map.get(key);
      if (prev) {
        prev.items.push(m);
      } else {
        const practiceIds =
          key !== JOB_PROFILE_EXPECTATIONS_NO_SUBJECT_KEY && m.subject_id
            ? practiceIdsForSubjectDisplay(
                subjectPracticeLinks,
                m.subject_id,
                m.subject_practice_id
              )
            : [];
        map.set(key, {
          key,
          headingLabel,
          subjectType: m.subject_type ?? null,
          practiceIds,
          items: [m],
        });
      }
    }
    for (const g of map.values()) {
      g.items.sort((a, b) =>
        (a.competency_name || "").localeCompare(b.competency_name || "", undefined, {
          sensitivity: "base",
        })
      );
    }
    const list = [...map.values()];
    list.sort((a, b) => {
      if (a.key === JOB_PROFILE_EXPECTATIONS_NO_SUBJECT_KEY) return 1;
      if (b.key === JOB_PROFILE_EXPECTATIONS_NO_SUBJECT_KEY) return -1;
      return a.headingLabel.localeCompare(b.headingLabel, undefined, {
        sensitivity: "base",
      });
    });
    return list;
  }, [jobProfileCompetencies, subjectPracticeLinks]);

  const lastJobProfileExpectationId = useMemo(() => {
    const flat = competencyExpectationsBySubject.flatMap((g) => g.items);
    return flat.length ? flat[flat.length - 1].id : null;
  }, [competencyExpectationsBySubject]);

  useEffect(() => {
    setExpectationSubjectGroupOpen((prev) => {
      const valid = new Set(competencyExpectationsBySubject.map((g) => g.key));
      const next: Record<string, boolean> = {};
      for (const k of Object.keys(prev)) {
        if (valid.has(k)) next[k] = prev[k];
      }
      for (const g of competencyExpectationsBySubject) {
        if (next[g.key] === undefined) next[g.key] = true;
      }
      return next;
    });
  }, [competencyExpectationsBySubject]);

  const profileControlsDisabled =
    jobProfileSaving ||
    isSavingFamily ||
    editProfileSaving ||
    archivingProfileId !== null ||
    restoringProfileId !== null ||
    hrMutating ||
    refinementLoading ||
    acceptingRefinement ||
    skillSuggestLoading ||
    skillSuggestAccepting ||
    respSuggestLoading ||
    respSuggestAccepting ||
    reqSuggestLoading ||
    reqSuggestAccepting ||
    rolePurposeSaving;

  async function handleSuggestSkillsForJobProfile(row: JobProfileRow) {
    if (!activeOrgId) return;
    setSuggestingSkillsTargetId(row.id);
    setSkillSuggestLoading(true);
    try {
      const [profRes, respRes, reqRes, skillsRes] = await Promise.all([
        supabase
          .from("organisation_profiles")
          .select("*")
          .eq("organisation_id", activeOrgId)
          .maybeSingle(),
        supabase
          .from("job_profile_responsibilities")
          .select("description")
          .eq("job_profile_id", row.id)
          .order("order_index", { ascending: true }),
        supabase
          .from("job_profile_requirements")
          .select("description")
          .eq("job_profile_id", row.id)
          .order("order_index", { ascending: true }),
        supabase
          .from("job_profile_skills")
          .select("name")
          .eq("job_profile_id", row.id)
          .order("created_at", { ascending: true }),
      ]);

      if (profRes.error) throw new Error(profRes.error.message);
      if (respRes.error) throw new Error(respRes.error.message);
      if (reqRes.error) throw new Error(reqRes.error.message);
      if (skillsRes.error) throw new Error(skillsRes.error.message);

      const companyProfile =
        (profRes.data as OrganisationProfileRow | null) ?? null;

      const responsibilities = (respRes.data ?? [])
        .map((r) => r.description)
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0);
      const requirements = (reqRes.data ?? [])
        .map((r) => r.description)
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0);
      const existingSkillNames = (skillsRes.data ?? [])
        .map((r) => r.name)
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0);

      const familyName =
        row.job_family_id != null && row.job_family_id !== ""
          ? jobFamilies.find((f) => f.id === row.job_family_id)?.name ?? null
          : null;

      const result = await suggestJobProfileSkills({
        companyProfile,
        jobTitle: row.title,
        levelName: row.level_name,
        familyName,
        roleSummary: row.role_summary?.trim() || null,
        responsibilities,
        requirements,
        existingSkillNames,
      });

      const lines: { text: string; kind: "core" | "tools" }[] = [
        ...result.core_skills.map((text) => ({ text, kind: "core" as const })),
        ...result.tools_and_platforms.map((text) => ({
          text,
          kind: "tools" as const,
        })),
      ];
      if (lines.length === 0) {
        alert(
          "No new skills were suggested. Add skills manually or try again later.",
        );
        return;
      }
      setSkillSuggestJobProfileId(row.id);
      setSkillSuggestLines(lines);
      setSkillSuggestSelected(lines.map(() => true));
      setSkillSuggestModalOpen(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSkillSuggestLoading(false);
      setSuggestingSkillsTargetId(null);
    }
  }

  function handleCloseSkillSuggestModal() {
    if (skillSuggestAccepting) return;
    setSkillSuggestModalOpen(false);
    setSkillSuggestJobProfileId(null);
    setSkillSuggestLines(null);
    setSkillSuggestSelected([]);
  }

  function toggleSkillSuggestionIndex(index: number) {
    setSkillSuggestSelected((prev) =>
      prev.map((v, i) => (i === index ? !v : v)),
    );
  }

  async function handleAcceptSelectedSkillSuggestions() {
    if (!skillSuggestJobProfileId || !skillSuggestLines || !activeOrgId) return;

    const chosen = skillSuggestLines
      .filter((_, i) => skillSuggestSelected[i])
      .map((l) => l.text.trim())
      .filter(Boolean);
    if (chosen.length === 0) {
      alert("Select at least one skill, or cancel.");
      return;
    }

    setSkillSuggestAccepting(true);
    try {
      const fresh = await supabase
        .from("job_profile_skills")
        .select("name")
        .eq("job_profile_id", skillSuggestJobProfileId);
      if (fresh.error) throw fresh.error;

      const existingKeys = new Set(
        (fresh.data ?? []).map((r) =>
          normalizeHrLineKey(
            typeof r.name === "string" ? r.name : String(r.name),
          ),
        ),
      );

      const rows: { job_profile_id: string; name: string }[] = [];
      for (const raw of chosen) {
        const name = raw.trim();
        if (!name) continue;
        const k = normalizeHrLineKey(name);
        if (existingKeys.has(k)) continue;
        existingKeys.add(k);
        rows.push({ job_profile_id: skillSuggestJobProfileId, name });
      }

      if (rows.length > 0) {
        const { error: insErr } = await supabase
          .from("job_profile_skills")
          .insert(rows);
        if (insErr) throw insErr;
      }

      await loadJobProfileHr(skillSuggestJobProfileId);
      setSkillSuggestModalOpen(false);
      setSkillSuggestJobProfileId(null);
      setSkillSuggestLines(null);
      setSkillSuggestSelected([]);
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Failed to add skills");
    } finally {
      setSkillSuggestAccepting(false);
    }
  }

  async function handleSuggestResponsibilitiesForJobProfile(row: JobProfileRow) {
    if (!activeOrgId) return;
    setSuggestingRespTargetId(row.id);
    setRespSuggestLoading(true);
    try {
      const [profRes, respRes, reqRes] = await Promise.all([
        supabase
          .from("organisation_profiles")
          .select("*")
          .eq("organisation_id", activeOrgId)
          .maybeSingle(),
        supabase
          .from("job_profile_responsibilities")
          .select("description")
          .eq("job_profile_id", row.id)
          .order("order_index", { ascending: true }),
        supabase
          .from("job_profile_requirements")
          .select("description")
          .eq("job_profile_id", row.id)
          .order("order_index", { ascending: true }),
      ]);

      if (profRes.error) throw new Error(profRes.error.message);
      if (respRes.error) throw new Error(respRes.error.message);
      if (reqRes.error) throw new Error(reqRes.error.message);

      const companyProfile =
        (profRes.data as OrganisationProfileRow | null) ?? null;

      const existingResponsibilities = (respRes.data ?? [])
        .map((r) => r.description)
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0);
      const requirements = (reqRes.data ?? [])
        .map((r) => r.description)
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0);

      const familyName =
        row.job_family_id != null && row.job_family_id !== ""
          ? jobFamilies.find((f) => f.id === row.job_family_id)?.name ?? null
          : null;

      const result = await suggestJobProfileResponsibilities({
        companyProfile,
        jobTitle: row.title,
        levelName: row.level_name,
        familyName,
        roleSummary: row.role_summary?.trim() || null,
        existingResponsibilities,
        requirements,
      });

      const list = result.suggested_responsibilities;
      if (list.length === 0) {
        alert(
          "No new responsibilities were suggested. Add items manually or try again later.",
        );
        return;
      }
      setRespSuggestJobProfileId(row.id);
      setRespSuggestions(list);
      setRespSuggestSelected(list.map(() => true));
      setRespSuggestModalOpen(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setRespSuggestLoading(false);
      setSuggestingRespTargetId(null);
    }
  }

  function handleCloseRespSuggestModal() {
    if (respSuggestAccepting) return;
    setRespSuggestModalOpen(false);
    setRespSuggestJobProfileId(null);
    setRespSuggestions(null);
    setRespSuggestSelected([]);
  }

  function toggleRespSuggestionIndex(index: number) {
    setRespSuggestSelected((prev) =>
      prev.map((v, i) => (i === index ? !v : v)),
    );
  }

  async function handleAcceptSelectedRespSuggestions() {
    if (!respSuggestJobProfileId || !respSuggestions || !activeOrgId) return;

    const chosen = respSuggestions.filter((_, i) => respSuggestSelected[i]);
    if (chosen.length === 0) {
      alert("Select at least one item, or cancel.");
      return;
    }

    setRespSuggestAccepting(true);
    try {
      const fresh = await supabase
        .from("job_profile_responsibilities")
        .select("description, order_index")
        .eq("job_profile_id", respSuggestJobProfileId)
        .order("order_index", { ascending: true });
      if (fresh.error) throw fresh.error;

      const existingKeys = new Set(
        (fresh.data ?? []).map((r) =>
          normalizeHrLineKey(
            typeof r.description === "string"
              ? r.description
              : String(r.description),
          ),
        ),
      );

      let nextOrder = nextOrderIndex(
        (fresh.data as { order_index: number }[] | null) ?? [],
      );

      const rows: {
        job_profile_id: string;
        description: string;
        order_index: number;
      }[] = [];

      for (const raw of chosen) {
        const description = raw.trim();
        if (!description) continue;
        const k = normalizeHrLineKey(description);
        if (existingKeys.has(k)) continue;
        existingKeys.add(k);
        rows.push({
          job_profile_id: respSuggestJobProfileId,
          description,
          order_index: nextOrder++,
        });
      }

      if (rows.length > 0) {
        const { error: insErr } = await supabase
          .from("job_profile_responsibilities")
          .insert(rows);
        if (insErr) throw insErr;
      }

      await loadJobProfileHr(respSuggestJobProfileId);
      setRespSuggestModalOpen(false);
      setRespSuggestJobProfileId(null);
      setRespSuggestions(null);
      setRespSuggestSelected([]);
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Failed to add responsibilities");
    } finally {
      setRespSuggestAccepting(false);
    }
  }

  async function handleSuggestRequirementsForJobProfile(row: JobProfileRow) {
    if (!activeOrgId) return;
    setSuggestingReqTargetId(row.id);
    setReqSuggestLoading(true);
    try {
      const [profRes, respRes, reqRes] = await Promise.all([
        supabase
          .from("organisation_profiles")
          .select("*")
          .eq("organisation_id", activeOrgId)
          .maybeSingle(),
        supabase
          .from("job_profile_responsibilities")
          .select("description")
          .eq("job_profile_id", row.id)
          .order("order_index", { ascending: true }),
        supabase
          .from("job_profile_requirements")
          .select("description")
          .eq("job_profile_id", row.id)
          .order("order_index", { ascending: true }),
      ]);

      if (profRes.error) throw new Error(profRes.error.message);
      if (respRes.error) throw new Error(respRes.error.message);
      if (reqRes.error) throw new Error(reqRes.error.message);

      const companyProfile =
        (profRes.data as OrganisationProfileRow | null) ?? null;

      const responsibilities = (respRes.data ?? [])
        .map((r) => r.description)
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0);
      const existingRequirements = (reqRes.data ?? [])
        .map((r) => r.description)
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0);

      const familyName =
        row.job_family_id != null && row.job_family_id !== ""
          ? jobFamilies.find((f) => f.id === row.job_family_id)?.name ?? null
          : null;

      const result = await suggestJobProfileRequirements({
        companyProfile,
        jobTitle: row.title,
        levelName: row.level_name,
        familyName,
        roleSummary: row.role_summary?.trim() || null,
        responsibilities,
        existingRequirements,
      });

      const list = result.suggested_requirements;
      if (list.length === 0) {
        alert(
          "No new requirements were suggested. Add items manually or try again later.",
        );
        return;
      }
      setReqSuggestJobProfileId(row.id);
      setReqSuggestions(list);
      setReqSuggestSelected(list.map(() => true));
      setReqSuggestModalOpen(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setReqSuggestLoading(false);
      setSuggestingReqTargetId(null);
    }
  }

  function handleCloseReqSuggestModal() {
    if (reqSuggestAccepting) return;
    setReqSuggestModalOpen(false);
    setReqSuggestJobProfileId(null);
    setReqSuggestions(null);
    setReqSuggestSelected([]);
  }

  function toggleReqSuggestionIndex(index: number) {
    setReqSuggestSelected((prev) =>
      prev.map((v, i) => (i === index ? !v : v)),
    );
  }

  async function handleAcceptSelectedReqSuggestions() {
    if (!reqSuggestJobProfileId || !reqSuggestions || !activeOrgId) return;

    const chosen = reqSuggestions.filter((_, i) => reqSuggestSelected[i]);
    if (chosen.length === 0) {
      alert("Select at least one item, or cancel.");
      return;
    }

    setReqSuggestAccepting(true);
    try {
      const fresh = await supabase
        .from("job_profile_requirements")
        .select("description, order_index")
        .eq("job_profile_id", reqSuggestJobProfileId)
        .order("order_index", { ascending: true });
      if (fresh.error) throw fresh.error;

      const existingKeys = new Set(
        (fresh.data ?? []).map((r) =>
          normalizeHrLineKey(
            typeof r.description === "string"
              ? r.description
              : String(r.description),
          ),
        ),
      );

      let nextOrder = nextOrderIndex(
        (fresh.data as { order_index: number }[] | null) ?? [],
      );

      const rows: {
        job_profile_id: string;
        description: string;
        order_index: number;
      }[] = [];

      for (const raw of chosen) {
        const description = raw.trim();
        if (!description) continue;
        const k = normalizeHrLineKey(description);
        if (existingKeys.has(k)) continue;
        existingKeys.add(k);
        rows.push({
          job_profile_id: reqSuggestJobProfileId,
          description,
          order_index: nextOrder++,
        });
      }

      if (rows.length > 0) {
        const { error: insErr } = await supabase
          .from("job_profile_requirements")
          .insert(rows);
        if (insErr) throw insErr;
      }

      await loadJobProfileHr(reqSuggestJobProfileId);
      setReqSuggestModalOpen(false);
      setReqSuggestJobProfileId(null);
      setReqSuggestions(null);
      setReqSuggestSelected([]);
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Failed to add requirements");
    } finally {
      setReqSuggestAccepting(false);
    }
  }

  async function handleRefineWithCompanyContext(row: JobProfileRow) {
    if (!activeOrgId) return;
    setRefiningTargetId(row.id);
    setRefinementLoading(true);
    try {
      const [profRes, respRes, reqRes] = await Promise.all([
        supabase
          .from("organisation_profiles")
          .select("*")
          .eq("organisation_id", activeOrgId)
          .maybeSingle(),
        supabase
          .from("job_profile_responsibilities")
          .select("description")
          .eq("job_profile_id", row.id)
          .order("order_index", { ascending: true }),
        supabase
          .from("job_profile_requirements")
          .select("description")
          .eq("job_profile_id", row.id)
          .order("order_index", { ascending: true }),
      ]);

      if (profRes.error) {
        throw new Error(profRes.error.message);
      }
      if (respRes.error) {
        throw new Error(respRes.error.message);
      }
      if (reqRes.error) {
        throw new Error(reqRes.error.message);
      }

      const companyProfile =
        (profRes.data as OrganisationProfileRow | null) ?? null;

      const responsibilities = (respRes.data ?? [])
        .map((r) => r.description)
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0);
      const requirements = (reqRes.data ?? [])
        .map((r) => r.description)
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0);

      const familyName =
        row.job_family_id != null && row.job_family_id !== ""
          ? jobFamilies.find((f) => f.id === row.job_family_id)?.name ?? null
          : null;

      const result = await refineJobProfileWithCompanyContext({
        companyProfile,
        jobTitle: row.title,
        levelName: row.level_name,
        familyName,
        description: row.role_summary?.trim() || null,
        responsibilities,
        requirements,
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

    setAcceptingRefinement(true);
    try {
      const { error: uErr } = await supabase
        .from("job_profiles")
        .update({ role_summary: refinementPreview.refined_role_summary })
        .eq("id", refinementJobProfileId);
      if (uErr) throw uErr;

      await reloadJobProfilesForOrg(activeOrgId);
      setRefineModalOpen(false);
      setRefinementPreview(null);
      setRefinementJobProfileId(null);
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Failed to save role description");
    } finally {
      setAcceptingRefinement(false);
    }
  }

  function handleStartEditRolePurpose(row: JobProfileRow) {
    setEditingRolePurposeProfileId(row.id);
    setDraftRolePurpose(row.role_summary?.trim() ?? "");
  }

  function handleCancelEditRolePurpose() {
    setEditingRolePurposeProfileId(null);
    setDraftRolePurpose("");
  }

  async function handleSaveRolePurpose(row: JobProfileRow) {
    if (!activeOrgId) return;
    const trimmed = draftRolePurpose.trim();
    if (trimmed === "") {
      const ok = window.confirm(
        "Save with an empty role purpose? You can add text later.",
      );
      if (!ok) return;
    }
    setRolePurposeSaving(true);
    try {
      const { error } = await supabase
        .from("job_profiles")
        .update({ role_summary: trimmed === "" ? null : trimmed })
        .eq("id", row.id);
      if (error) throw error;
      await reloadJobProfilesForOrg(activeOrgId);
      setEditingRolePurposeProfileId(null);
      setDraftRolePurpose("");
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Failed to save role purpose");
    } finally {
      setRolePurposeSaving(false);
    }
  }

  const renderCompactRoleRow = (row: JobProfileRow) => {
    const archivedDimmed = showArchivedJobProfiles && !row.is_active;
    const cardStyle = {
      ...profileCardShell,
      opacity: archivedDimmed ? 0.55 : 1,
      border: `1px solid ${border}`,
    };
    const counts = roleListCounts[row.id] ?? {
      resp: 0,
      req: 0,
      comp: 0,
    };

    return (
      <li key={row.id} style={cardStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0, flex: "1 1 200px" }}>
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
            {row.role_summary?.trim() ? (
              <p
                style={{
                  margin: "8px 0 0",
                  fontSize: 13,
                  color: text,
                  lineHeight: 1.45,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {row.role_summary.trim()}
              </p>
            ) : null}
            <div
              style={{
                marginTop: 6,
                fontSize: 12,
                color: mutedColor,
              }}
            >
              {roleListCountsLoading ? (
                <span style={{ opacity: 0.55, letterSpacing: "0.04em" }}>
                  — · — · —
                </span>
              ) : (
                <>
                  {counts.resp} responsibility
                  {counts.resp !== 1 ? "ies" : "y"} · {counts.req} requirement
                  {counts.req !== 1 ? "s" : ""} · {counts.comp}{" "}
                  {counts.comp === 1 ? "competency" : "competencies"}
                </>
              )}
            </div>
          </div>
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
              onClick={() => openRoleDetail(row, false)}
              disabled={profileControlsDisabled}
              style={{
                ...btn,
                padding: "6px 12px",
                fontSize: 13,
              }}
            >
              View Details
            </button>
            <button
              type="button"
              onClick={() => openRoleDetail(row, true)}
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
      </li>
    );
  };

  const renderRoleDetailPanel = (row: JobProfileRow) => {
    const archivedDimmed = showArchivedJobProfiles && !row.is_active;
    const cardStyle = {
      ...profileCardShell,
      opacity: archivedDimmed ? 0.55 : 1,
      border: `1px solid ${border}`,
    };

    if (editingProfileId === row.id) {
      return (
        <div style={cardStyle}>
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
        </div>
      );
    }

    return (
      <div style={cardStyle}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              alignItems: "flex-start",
              flex: "1 1 0",
              minWidth: 0,
            }}
          >
            <button
              type="button"
              onClick={backFromRoleDetail}
              disabled={
                profileControlsDisabled ||
                editingRolePurposeProfileId === row.id
              }
              style={{
                ...btnGhost,
                padding: "6px 12px",
                fontSize: 13,
              }}
            >
              ← Back
            </button>
            <div style={{ flex: "1 1 220px", minWidth: 0, width: "100%" }}>
              <div
                style={{
                  fontWeight: 600,
                  color: text,
                  fontSize: 17,
                  letterSpacing: "-0.02em",
                }}
              >
                {row.title}
                {!row.is_active && (
                  <span
                    style={{
                      marginLeft: 8,
                      fontWeight: 500,
                      fontSize: 13,
                      color: mutedColor,
                    }}
                  >
                    (inactive)
                  </span>
                )}
              </div>
              <div style={{ fontSize: 13, color: mutedColor, marginTop: 4 }}>
                {row.level_name ?? "—"}
              </div>
              <div style={{ marginTop: 14, width: "100%", maxWidth: "100%" }}>
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
                  Role purpose
                </p>
                {editingRolePurposeProfileId === row.id ? (
                  <>
                    <textarea
                      value={draftRolePurpose}
                      onChange={(e) => setDraftRolePurpose(e.target.value)}
                      placeholder="Describe the purpose of this role..."
                      disabled={rolePurposeSaving}
                      rows={5}
                      style={{
                        display: "block",
                        width: "100%",
                        minWidth: 0,
                        maxWidth: "100%",
                        boxSizing: "border-box",
                        padding: "12px 14px",
                        fontSize: 14,
                        color: text,
                        lineHeight: 1.55,
                        backgroundColor: bg,
                        border: `1px solid ${border}`,
                        borderRadius: 8,
                        resize: "vertical",
                        minHeight: "7.75rem",
                        fontFamily: "inherit",
                        overflow: "auto",
                      }}
                    />
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: 10,
                        marginTop: 12,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => void handleSaveRolePurpose(row)}
                        disabled={rolePurposeSaving}
                        style={{
                          ...btnPrimary,
                          padding: "8px 14px",
                          fontSize: 13,
                          opacity: rolePurposeSaving ? 0.7 : 1,
                        }}
                      >
                        {rolePurposeSaving ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelEditRolePurpose}
                        disabled={rolePurposeSaving}
                        style={{
                          ...btn,
                          padding: "8px 14px",
                          fontSize: 13,
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : row.role_summary?.trim() ? (
                  <p
                    style={{
                      margin: 0,
                      fontSize: 14,
                      color: text,
                      lineHeight: 1.55,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {row.role_summary.trim()}
                  </p>
                ) : (
                  <p
                    style={{
                      margin: 0,
                      fontSize: 13,
                      color: mutedColor,
                      lineHeight: 1.5,
                    }}
                  >
                    No role purpose yet. Use Edit role purpose below to write one,
                    or Refine role description to generate from context.
                  </p>
                )}
              </div>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              justifyContent: "flex-end",
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={() => handleStartEditProfile(row)}
              disabled={
                profileControlsDisabled ||
                editingRolePurposeProfileId === row.id
              }
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
                disabled={
                  profileControlsDisabled ||
                  editingRolePurposeProfileId === row.id
                }
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
                disabled={
                  profileControlsDisabled ||
                  editingRolePurposeProfileId === row.id
                }
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
        <div
          style={{
            marginBottom: 16,
            paddingBottom: 16,
            borderBottom: `1px solid ${borderSubtle}`,
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
                disabled={
                  profileControlsDisabled ||
                  editingRolePurposeProfileId === row.id
                }
                style={{
                  ...btnPrimary,
                  padding: "8px 14px",
                  fontSize: 13,
                }}
              >
                {refiningTargetId === row.id ? "Refining…" : "Refine role description"}
              </button>
              <button
                type="button"
                onClick={() => handleStartEditRolePurpose(row)}
                disabled={
                  profileControlsDisabled ||
                  editingRolePurposeProfileId === row.id
                }
                style={{
                  ...btnGhost,
                  padding: "8px 14px",
                  fontSize: 13,
                }}
              >
                Edit role purpose
              </button>
              <span style={{ fontSize: 12, color: mutedColor, lineHeight: 1.4 }}>
                Uses the company profile plus this role&apos;s family, title, level,
                current role purpose (if any), responsibilities, and requirements.
              </span>
            </div>
            {jobProfileHrLoading ? (
              <p style={{ margin: "0 0 12px", fontSize: 13, color: mutedColor }}>
                Loading role details...
              </p>
            ) : null}
            <div
              style={{
                border: `1px solid ${border}`,
                borderRadius: 8,
                marginBottom: 12,
                backgroundColor: surface,
                overflow: "hidden",
              }}
            >
              <button
                type="button"
                onClick={() =>
                  setRoleDetailSectionOpen((s) => ({ ...s, resp: !s.resp }))
                }
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 12px",
                  margin: 0,
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  backgroundColor: bg,
                  color: text,
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                <span>Responsibilities</span>
                <span style={{ fontSize: 12, color: mutedColor }}>
                  {profileResponsibilities.length}{" "}
                  <span aria-hidden style={{ marginLeft: 6 }}>
                    {roleDetailSectionOpen.resp ? "▼" : "▶"}
                  </span>
                </span>
              </button>
              <AccordionCollapsible open={roleDetailSectionOpen.resp}>
                <div style={{ padding: "0 12px 14px" }}>
            <p style={{ ...muted, margin: "0 0 10px", fontSize: 12 }}>
              Key duties and outcomes for this role.
            </p>
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
                onClick={() => void handleSuggestResponsibilitiesForJobProfile(row)}
                disabled={profileControlsDisabled}
                style={{
                  ...btnPrimary,
                  padding: "8px 14px",
                  fontSize: 13,
                }}
              >
                {suggestingRespTargetId === row.id
                  ? "Suggesting…"
                  : "Suggest responsibilities"}
              </button>
              <span style={{ fontSize: 12, color: mutedColor, lineHeight: 1.4 }}>
                Preview and add selected lines — existing responsibilities stay as
                they are.
              </span>
            </div>
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
                </div>
              </AccordionCollapsible>
            </div>
            <div
              style={{
                border: `1px solid ${border}`,
                borderRadius: 8,
                marginBottom: 12,
                backgroundColor: surface,
                overflow: "hidden",
              }}
            >
              <button
                type="button"
                onClick={() =>
                  setRoleDetailSectionOpen((s) => ({ ...s, req: !s.req }))
                }
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 12px",
                  margin: 0,
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  backgroundColor: bg,
                  color: text,
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                <span>Requirements</span>
                <span style={{ fontSize: 12, color: mutedColor }}>
                  {profileRequirements.length}{" "}
                  <span aria-hidden style={{ marginLeft: 6 }}>
                    {roleDetailSectionOpen.req ? "▼" : "▶"}
                  </span>
                </span>
              </button>
              <AccordionCollapsible open={roleDetailSectionOpen.req}>
                <div style={{ padding: "0 12px 14px" }}>
            <p style={{ ...muted, margin: "0 0 10px", fontSize: 12 }}>
              Qualifications, education, and experience.
            </p>
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
                onClick={() => void handleSuggestRequirementsForJobProfile(row)}
                disabled={profileControlsDisabled}
                style={{
                  ...btnPrimary,
                  padding: "8px 14px",
                  fontSize: 13,
                }}
              >
                {suggestingReqTargetId === row.id
                  ? "Suggesting…"
                  : "Suggest requirements"}
              </button>
              <span style={{ fontSize: 12, color: mutedColor, lineHeight: 1.4 }}>
                Preview and add selected lines — existing requirements stay as they
                are.
              </span>
            </div>
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
                </div>
              </AccordionCollapsible>
            </div>
            <div
              style={{
                border: `1px solid ${border}`,
                borderRadius: 8,
                marginBottom: 12,
                backgroundColor: surface,
                overflow: "hidden",
              }}
            >
              <button
                type="button"
                onClick={() =>
                  setRoleDetailSectionOpen((s) => ({ ...s, skills: !s.skills }))
                }
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 12px",
                  margin: 0,
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  backgroundColor: bg,
                  color: text,
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                <span>Skills</span>
                <span style={{ fontSize: 12, color: mutedColor }}>
                  {profileSkills.length}{" "}
                  <span aria-hidden style={{ marginLeft: 6 }}>
                    {roleDetailSectionOpen.skills ? "▼" : "▶"}
                  </span>
                </span>
              </button>
              <AccordionCollapsible open={roleDetailSectionOpen.skills}>
                <div style={{ padding: "0 12px 14px" }}>
            <p style={{ ...muted, margin: "0 0 10px", fontSize: 12 }}>
              Role-facing tools, technologies, and methods — separate from
              competency expectations below.
            </p>
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
                onClick={() => void handleSuggestSkillsForJobProfile(row)}
                disabled={profileControlsDisabled}
                style={{
                  ...btnPrimary,
                  padding: "8px 14px",
                  fontSize: 13,
                }}
              >
                {suggestingSkillsTargetId === row.id
                  ? "Suggesting…"
                  : "Suggest skills"}
              </button>
              <span style={{ fontSize: 12, color: mutedColor, lineHeight: 1.4 }}>
                AI suggests tools and methods for this role only — not competency
                expectations.
              </span>
            </div>
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
            </div>
            <div
              style={{
                border: `1px solid ${border}`,
                borderRadius: 8,
                marginBottom: 12,
                backgroundColor: surface,
                overflow: "hidden",
              }}
            >
              <button
                type="button"
                onClick={() =>
                  setRoleDetailSectionOpen((s) => ({ ...s, comp: !s.comp }))
                }
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 12px",
                  margin: 0,
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  backgroundColor: bg,
                  color: text,
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                <span>Competency expectations</span>
                <span style={{ fontSize: 12, color: mutedColor }}>
                  {jobProfileCompetencies.length}{" "}
                  <span aria-hidden style={{ marginLeft: 6 }}>
                    {roleDetailSectionOpen.comp ? "▼" : "▶"}
                  </span>
                </span>
              </button>
              <AccordionCollapsible open={roleDetailSectionOpen.comp}>
                <div style={{ padding: "0 12px 14px" }}>
            <p style={{ ...muted, margin: "0 0 10px", fontSize: 12 }}>
              Linked from your practice library (reusable across roles). Separate
              from Skills above.
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
              <div
                style={{
                  margin: "0 0 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 0,
                }}
              >
                {competencyExpectationsBySubject.map((g) => {
                  const practiceNames = g.practiceIds
                    .map(
                      (id) =>
                        mappingPracticesForPicker.find((p) => p.id === id)
                          ?.name ?? null
                    )
                    .filter((n): n is string => Boolean(n));
                  const showOrgBadge =
                    g.key !== JOB_PROFILE_EXPECTATIONS_NO_SUBJECT_KEY &&
                    normalizeCompetencyType(g.subjectType) === "organisation";
                  const showPracticeMeta =
                    g.key !== JOB_PROFILE_EXPECTATIONS_NO_SUBJECT_KEY &&
                    isPracticeScopeSubjectType(g.subjectType);
                  const headingDomId = `jp-exp-subj-${g.key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
                  const subjectGroupExpanded =
                    expectationSubjectGroupOpen[g.key] !== false;
                  return (
                    <section
                      key={g.key}
                      aria-labelledby={headingDomId}
                      style={{ marginBottom: 12 }}
                    >
                      <button
                        type="button"
                        id={headingDomId}
                        aria-expanded={subjectGroupExpanded}
                        onClick={() =>
                          setExpectationSubjectGroupOpen((prev) => {
                            const expanded = prev[g.key] !== false;
                            return { ...prev, [g.key]: !expanded };
                          })
                        }
                        style={{
                          width: "100%",
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "center",
                          gap: "6px 10px",
                          padding: "6px 10px",
                          borderBottom: `1px solid ${borderSubtle}`,
                          backgroundColor: bg,
                          borderTop: "none",
                          borderLeft: "none",
                          borderRight: "none",
                          cursor: "pointer",
                          color: text,
                          textAlign: "left",
                          boxSizing: "border-box" as const,
                        }}
                      >
                        <span
                          aria-hidden
                          style={{
                            display: "inline-flex",
                            fontSize: 12,
                            color: mutedColor,
                            transform: subjectGroupExpanded
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
                            fontWeight: 600,
                            fontSize: 13,
                            color: text,
                          }}
                        >
                          {g.headingLabel}
                        </span>
                        {showOrgBadge ? (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              letterSpacing: "0.05em",
                              textTransform: "uppercase",
                              padding: "2px 6px",
                              borderRadius: 4,
                              border: `1px solid ${borderSubtle}`,
                              color: mutedColor,
                            }}
                          >
                            Organisation-wide
                          </span>
                        ) : null}
                        {showPracticeMeta ? (
                          <span style={{ fontSize: 11, color: mutedColor }}>
                            {practiceNames.length > 0
                              ? practiceNames.join(", ")
                              : "Unassigned practice"}
                          </span>
                        ) : null}
                        <span
                          style={{
                            fontSize: 11,
                            color: mutedColor,
                            marginLeft: "auto",
                          }}
                        >
                          {g.items.length}{" "}
                          {g.items.length === 1 ? "competency" : "competencies"}
                        </span>
                      </button>
                      <AccordionCollapsible open={subjectGroupExpanded}>
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
                        {g.items.map((m) => (
                  <li
                    key={m.id}
                    onMouseEnter={() => setHoveredMappingId(m.id)}
                    onMouseLeave={() =>
                      setHoveredMappingId((prev) =>
                        prev === m.id ? null : prev
                      )
                    }
                    style={{
                      padding: "8px 10px",
                      borderBottom:
                        m.id === lastJobProfileExpectationId
                          ? "none"
                          : `1px solid ${borderSubtle}`,
                      backgroundColor:
                        hoveredMappingId === m.id ? surfaceHover : "transparent",
                      transition: "background-color 0.12s ease",
                    }}
                  >
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
                        <span
                          style={{
                            fontWeight: 600,
                            color: text,
                            fontSize: 14,
                            lineHeight: 1.35,
                          }}
                        >
                          {m.competency_name || "Unknown competency"}
                        </span>
                        {m.competency_status === "deprecated" ? (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              letterSpacing: "0.06em",
                              textTransform: "uppercase",
                              padding: "2px 6px",
                              borderRadius: 4,
                              border: "1px solid rgba(212, 168, 75, 0.45)",
                              color: "#d4a84b",
                              backgroundColor: "rgba(212, 168, 75, 0.12)",
                              flexShrink: 0,
                            }}
                          >
                            Deprecated
                          </span>
                        ) : null}
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
                          padding: "5px 10px",
                          fontSize: 12,
                        }}
                      >
                        {removingMappingId === m.id
                          ? "Removing..."
                          : "Remove"}
                      </button>
                    </div>
                    {m.competency_description ? (
                      <p
                        style={{
                          ...muted,
                          margin: "4px 0 0",
                          fontSize: 12,
                          lineHeight: 1.35,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {m.competency_description}
                      </p>
                    ) : null}
                    {m.competency_status === "deprecated" ? (
                      <p
                        style={{
                          margin: "4px 0 0",
                          fontSize: 11,
                          color: "#c9a227",
                          lineHeight: 1.35,
                        }}
                      >
                        Deprecated — replace with a current competency when
                        updating requirements.
                      </p>
                    ) : null}
                    <div
                      style={{
                        marginTop: 6,
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        columnGap: 14,
                        rowGap: 6,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 12,
                          color: mutedColor,
                        }}
                      >
                        <span style={{ flexShrink: 0 }}>Level</span>
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
                            minWidth: 140,
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
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 12,
                          color: mutedColor,
                        }}
                      >
                        <span style={{ flexShrink: 0 }}>Relevance</span>
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
                            minWidth: 100,
                          }}
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                        </select>
                      </div>
                      <label
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 12,
                          color: mutedColor,
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
                  </li>
                        ))}
                      </ul>
                      </AccordionCollapsible>
                    </section>
                  );
                })}
              </div>
            )}
            {mappingPanelLoading ? null : (
              <>
                <p
                  style={{
                    ...muted,
                    margin: "14px 0 8px",
                    fontSize: 12,
                  }}
                >
                  Changes save automatically. Use the button below to compose
                  role expectations from practices and the catalogue.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setBuildCapabilityFeedback(null);
                    setShowAddCompetencyExpectationForm(true);
                  }}
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
                  Build role capabilities
                </button>
              </>
            )}
            {showAddCompetencyExpectationForm ? (
              <div
                role="dialog"
                aria-modal
                aria-labelledby={
                  competencyAiReviewActive
                    ? "job-profile-ai-comp-title"
                    : "job-profile-add-comp-title"
                }
                style={{
                  position: "fixed",
                  inset: 0,
                  zIndex: 70,
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "center",
                  padding: "24px 16px",
                  overflow: "auto",
                  backgroundColor: "rgba(0,0,0,0.55)",
                }}
                onClick={(e) => {
                  if (e.target === e.currentTarget)
                    handleCancelAddCompetencyExpectation();
                }}
              >
                <div
                  style={{
                    ...panelShell,
                    width: "100%",
                    maxWidth: competencyAiReviewActive ? 720 : 640,
                    marginTop: 24,
                    maxHeight: "min(78vh, 720px)",
                    overflow: "auto",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {competencyAiReviewActive ? (
                    <JobProfileCompetencyAiReviewPanel
                      competencyAiSuggestError={competencyAiSuggestError}
                      competencyAiSuggestLoading={competencyAiSuggestLoading}
                      competencyAiReviewCoreBySubject={
                        competencyAiReviewCoreBySubject
                      }
                      competencyAiReviewSupportingBySubject={
                        competencyAiReviewSupportingBySubject
                      }
                      competencyAiGaps={competencyAiGaps}
                      isSavingMapping={isSavingMapping}
                      onPatchRow={patchCompetencyAiRow}
                      onToggleSubjectGroup={toggleCompetencyAiSubjectGroup}
                      onApply={() => void handleApplyCompetencyAiSuggestions()}
                      onBack={() => setCompetencyAiReviewActive(false)}
                    />
                  ) : (
                    <>
                  <h3
                    id="job-profile-add-comp-title"
                    style={{
                      margin: "0 0 12px",
                      fontSize: 17,
                      fontWeight: 600,
                      color: text,
                    }}
                  >
                    Build role capabilities
                  </h3>
                  <p
                    style={{
                      ...muted,
                      margin: "0 0 14px",
                      fontSize: 13,
                      lineHeight: 1.45,
                    }}
                  >
                    Start from a practice overlay, calibrate seniority for
                    default expected levels, optionally add AI-suggested
                    cross-cutting competencies, then fine-tune manually. This
                    does not change taxonomy structure.
                  </p>
                  <div
                    style={{
                      marginBottom: 14,
                      padding: "12px 12px",
                      borderRadius: 8,
                      backgroundColor: surface,
                      border: `1px solid ${borderSubtle}`,
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    <p
                      style={{
                        ...sectionEyebrow,
                        margin: 0,
                        fontSize: 11,
                      }}
                    >
                      Add from Practice
                    </p>
                    <p
                      style={{
                        ...muted,
                        margin: 0,
                        fontSize: 12,
                        lineHeight: 1.45,
                      }}
                    >
                      Pull every competency linked to this practice in your
                      workspace (competency–practice links). Applies default
                      levels from Role seniority below.
                    </p>
                    <label
                      style={{
                        display: "grid",
                        gap: 6,
                        fontSize: 13,
                        color: mutedColor,
                      }}
                    >
                      Practice
                      <select
                        value={buildModalPracticeId}
                        onChange={(e) => setBuildModalPracticeId(e.target.value)}
                        disabled={
                          isSavingMapping ||
                          mappingPanelLoading ||
                          hrMutating
                        }
                        style={{
                          padding: "10px 12px",
                          fontSize: 15,
                          color: text,
                          backgroundColor: bg,
                          border: `1px solid ${border}`,
                          borderRadius: 8,
                        }}
                      >
                        <option value="">Select a practice…</option>
                        {mappingPracticesForPicker.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {buildPracticeImportPreview ? (
                      <p
                        style={{
                          margin: 0,
                          fontSize: 12,
                          color: text,
                          lineHeight: 1.45,
                        }}
                      >
                        <strong>{buildPracticeImportPreview.competencyCount}</strong>{" "}
                        competencies linked to this practice
                        {buildPracticeImportPreview.subjectCount > 0 ? (
                          <>
                            {" "}
                            across{" "}
                            <strong>
                              {buildPracticeImportPreview.subjectCount}
                            </strong>{" "}
                            subjects
                          </>
                        ) : null}{" "}
                        would be added (existing role rows are skipped).
                      </p>
                    ) : (
                      <p style={{ ...muted, margin: 0, fontSize: 12 }}>
                        Select a practice to preview how many catalogue
                        competencies are in this practice context.
                      </p>
                    )}
                  </div>
                  <div
                    style={{
                      marginBottom: 14,
                      padding: "12px 12px",
                      borderRadius: 8,
                      backgroundColor: surface,
                      border: `1px solid ${borderSubtle}`,
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    <p
                      style={{
                        ...sectionEyebrow,
                        margin: 0,
                        fontSize: 11,
                      }}
                    >
                      Role seniority
                    </p>
                    <p
                      style={{
                        ...muted,
                        margin: 0,
                        fontSize: 12,
                        lineHeight: 1.45,
                      }}
                    >
                      Maps to a default point on each competency&apos;s level
                      scale when importing from a practice (same mapping for all
                      imported rows in this pass).
                    </p>
                    <div
                      role="group"
                      aria-label="Role seniority"
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 8,
                      }}
                    >
                      {(
                        [
                          "associate",
                          "intermediate",
                          "senior",
                          "principal",
                        ] as const
                      ).map((s) => (
                        <button
                          key={s}
                          type="button"
                          disabled={
                            isSavingMapping ||
                            mappingPanelLoading ||
                            hrMutating
                          }
                          onClick={() => setBuildModalSeniority(s)}
                          style={{
                            ...(buildModalSeniority === s
                              ? btnPrimary
                              : btnGhost),
                            fontSize: 13,
                            padding: "6px 12px",
                          }}
                        >
                          {roleCapabilitySeniorityLabel(s)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div
                    style={{
                      marginBottom: 14,
                      padding: "12px 12px",
                      borderRadius: 8,
                      backgroundColor: surface,
                      border: `1px solid ${borderSubtle}`,
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    <p
                      style={{
                        ...sectionEyebrow,
                        margin: 0,
                        fontSize: 11,
                      }}
                    >
                      Suggested additions (AI)
                    </p>
                    <p
                      style={{
                        ...muted,
                        margin: 0,
                        fontSize: 12,
                        lineHeight: 1.45,
                      }}
                    >
                      Secondary to the practice above: extra competencies likely
                      relevant for hybrid / leadership roles. Requires a practice
                      selection.
                    </p>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => void handleSuggestRoleAugmentations()}
                        disabled={
                          roleAugmentationLoading ||
                          competencyAiSuggestLoading ||
                          isSavingMapping ||
                          mappingPanelLoading ||
                          hrMutating ||
                          mappingCompetencyOptions.length === 0 ||
                          !buildModalPracticeId.trim()
                        }
                        style={{
                          ...btnSecondary,
                          fontSize: 13,
                        }}
                      >
                        {roleAugmentationLoading
                          ? "Suggesting…"
                          : "Suggest additions for this role"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRunCompetencyAiSuggest()}
                        disabled={
                          competencyAiSuggestLoading ||
                          isSavingMapping ||
                          mappingPanelLoading ||
                          hrMutating ||
                          mappingCompetencyOptions.length === 0
                        }
                        title="Full-catalogue AI review (not scoped to a single practice)"
                        style={{
                          ...btnGhost,
                          fontSize: 12,
                          padding: "6px 10px",
                        }}
                      >
                        {competencyAiSuggestLoading
                          ? "Loading…"
                          : "Full catalogue AI review…"}
                      </button>
                    </div>
                    {competencyAiSuggestError ? (
                      <p
                        style={{
                          color: errorColor,
                          fontSize: 12,
                          margin: 0,
                          lineHeight: 1.4,
                        }}
                      >
                        {competencyAiSuggestError}
                      </p>
                    ) : null}
                    {roleAugmentationError ? (
                      <p
                        style={{
                          color: errorColor,
                          fontSize: 12,
                          margin: 0,
                          lineHeight: 1.4,
                        }}
                      >
                        {roleAugmentationError}
                      </p>
                    ) : null}
                    {roleAugmentationRows.length > 0 ? (
                      <ul
                        style={{
                          listStyle: "none",
                          margin: 0,
                          padding: "8px 0 0",
                          display: "grid",
                          gap: 10,
                          maxHeight: 220,
                          overflowY: "auto",
                        }}
                      >
                        {roleAugmentationRows.map((r) => (
                          <li
                            key={r.key}
                            style={{
                              display: "grid",
                              gap: 6,
                              fontSize: 12,
                              color: text,
                              paddingBottom: 8,
                              borderBottom: `1px solid ${borderSubtle}`,
                            }}
                          >
                            <label
                              style={{
                                display: "flex",
                                alignItems: "flex-start",
                                gap: 8,
                                cursor: "pointer",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={r.selected}
                                onChange={(e) =>
                                  patchRoleAugmentationRow(r.key, {
                                    selected: e.target.checked,
                                  })
                                }
                                style={{ marginTop: 3 }}
                              />
                              <span>
                                <strong>{r.competencyName}</strong>
                                <span style={{ ...muted, marginLeft: 6 }}>
                                  ({r.subjectName})
                                </span>
                              </span>
                            </label>
                            {r.reason?.trim() ? (
                              <span style={{ ...muted, fontSize: 11 }}>
                                {r.reason.trim()}
                              </span>
                            ) : null}
                            <label
                              style={{
                                display: "grid",
                                gap: 4,
                                fontSize: 11,
                                color: mutedColor,
                              }}
                            >
                              Required level
                              <select
                                value={r.requiredLevel}
                                onChange={(e) =>
                                  patchRoleAugmentationRow(r.key, {
                                    requiredLevel: e.target.value,
                                  })
                                }
                                disabled={r.levelOptions.length === 0}
                                style={{
                                  padding: "6px 8px",
                                  fontSize: 13,
                                  color: text,
                                  backgroundColor: bg,
                                  border: `1px solid ${border}`,
                                  borderRadius: 6,
                                }}
                              >
                                {r.levelOptions.map((ld) => (
                                  <option
                                    key={ld.id}
                                    value={ld.level_name}
                                  >
                                    {ld.level_order}. {ld.level_name}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  {buildCapabilityFeedback ? (
                    <p
                      style={{
                        margin: "0 0 12px",
                        padding: "8px 10px",
                        borderRadius: 8,
                        fontSize: 12,
                        lineHeight: 1.45,
                        color: text,
                        backgroundColor: "rgba(110, 176, 240, 0.08)",
                        border: "1px solid rgba(110, 176, 240, 0.25)",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {buildCapabilityFeedback}
                    </p>
                  ) : null}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (assignmentAddMode === "subject") {
                    void handleBulkSaveJobProfileCompetencies();
                  } else {
                    void handleSaveJobProfileCompetency(e);
                  }
                }}
                style={{
                  marginTop: 0,
                  padding: "12px 12px",
                  borderRadius: 8,
                  backgroundColor: bg,
                  border: `1px solid ${border}`,
                  display: "grid",
                  gap: 12,
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gap: 8,
                    paddingBottom: 8,
                    borderBottom: `1px solid ${borderSubtle}`,
                  }}
                >
                  <p
                    style={{
                      ...sectionEyebrow,
                      margin: 0,
                      fontSize: 11,
                    }}
                  >
                    Fine tune manually
                  </p>
                  <p
                    style={{
                      ...muted,
                      margin: 0,
                      fontSize: 12,
                      lineHeight: 1.45,
                    }}
                  >
                    Single competency or entire subject — uses scope, practice,
                    and search below. Saves immediately for the rows you add
                    here (separate from Apply to role above).
                  </p>
                </div>
                  <div
                    role="group"
                    aria-label="Add mode"
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        color: mutedColor,
                        marginRight: 4,
                      }}
                    >
                      Add
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setAssignmentAddMode("single");
                        setSelectedCompetencyId("");
                      }}
                      disabled={
                        isSavingMapping ||
                        mappingPanelLoading ||
                        hrMutating
                      }
                      style={{
                        ...(assignmentAddMode === "single"
                          ? btnPrimary
                          : btnGhost),
                        fontSize: 13,
                        padding: "6px 12px",
                      }}
                    >
                      Single competency
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAssignmentAddMode("subject");
                        setSelectedCompetencyId("");
                      }}
                      disabled={
                        isSavingMapping ||
                        mappingPanelLoading ||
                        hrMutating
                      }
                      style={{
                        ...(assignmentAddMode === "subject"
                          ? btnPrimary
                          : btnGhost),
                        fontSize: 13,
                        padding: "6px 12px",
                      }}
                    >
                      Entire subject
                    </button>
                  </div>
                  <label
                    style={{
                      display: "grid",
                      gap: 6,
                      fontSize: 13,
                      color: mutedColor,
                    }}
                  >
                    Scope
                    <select
                      value={assignmentScopeFilter}
                      onChange={(e) => {
                        const v = e.target.value as
                          | "all"
                          | "practice"
                          | "organisation";
                        setAssignmentScopeFilter(v);
                        if (v === "organisation")
                          setAssignmentPracticeFilter("all");
                        setPickerSubjectId("");
                        setSelectedCompetencyId("");
                      }}
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
                      <option value="all">All (practice + organisation)</option>
                      <option value="practice">Practice-scoped subjects</option>
                      <option value="organisation">
                        Organisation-wide subjects
                      </option>
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
                    Practice
                    <select
                      value={assignmentPracticeFilter}
                      onChange={(e) => {
                        setAssignmentPracticeFilter(
                          e.target.value as "all" | "unassigned" | string
                        );
                        setPickerSubjectId("");
                        setSelectedCompetencyId("");
                      }}
                      disabled={
                        isSavingMapping ||
                        mappingPanelLoading ||
                        hrMutating ||
                        assignmentScopeFilter === "organisation"
                      }
                      style={{
                        padding: "10px 12px",
                        fontSize: 15,
                        color: text,
                        backgroundColor: surface,
                        border: `1px solid ${border}`,
                        borderRadius: 8,
                        opacity:
                          assignmentScopeFilter === "organisation" ? 0.55 : 1,
                      }}
                    >
                      <option value="all">All</option>
                      <option value="unassigned">Unassigned</option>
                      {mappingPracticesForPicker.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
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
                    Search subjects & competencies
                    <input
                      type="search"
                      value={assignmentPickerSearch}
                      onChange={(e) =>
                        setAssignmentPickerSearch(e.target.value)
                      }
                      placeholder="Filter by name…"
                      autoComplete="off"
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
                    Subject
                    <select
                      required
                      value={pickerSubjectId}
                      onChange={(e) => {
                        setPickerSubjectId(e.target.value);
                        setSelectedCompetencyId("");
                      }}
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
                      <option value="">Select a subject…</option>
                      {subjectsForAssignmentPicker.map((s) => (
                        <option key={s.id} value={s.id}>
                          {subjectPickerOptionLabel(s, mappingPracticesForPicker)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {assignmentAddMode === "single" ? (
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
                          hrMutating ||
                          !pickerSubjectId
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
                          {!pickerSubjectId
                            ? "Select a subject first…"
                            : competenciesForAssignmentPicker.length === 0
                              ? "No competencies match this subject / search"
                              : "Select a competency…"}
                        </option>
                        {competenciesForAssignmentPicker.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <div
                      style={{
                        display: "grid",
                        gap: 8,
                        fontSize: 13,
                        color: mutedColor,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                        }}
                      >
                        <span>Competencies in this subject</span>
                        {pickerSubjectId &&
                        bulkCompetenciesDisplayed.length > 0 ? (
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: 8,
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setBulkCompetencySelection((prev) => {
                                  const next = { ...prev };
                                  for (const c of bulkCompetenciesDisplayed) {
                                    next[c.id] = true;
                                  }
                                  return next;
                                });
                              }}
                              disabled={
                                isSavingMapping ||
                                mappingPanelLoading ||
                                hrMutating
                              }
                              style={{ ...btnGhost, fontSize: 12, padding: "4px 8px" }}
                            >
                              Select visible
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setBulkCompetencySelection((prev) => {
                                  const next = { ...prev };
                                  for (const c of bulkCompetenciesDisplayed) {
                                    next[c.id] = false;
                                  }
                                  return next;
                                });
                              }}
                              disabled={
                                isSavingMapping ||
                                mappingPanelLoading ||
                                hrMutating
                              }
                              style={{ ...btnGhost, fontSize: 12, padding: "4px 8px" }}
                            >
                              Clear visible
                            </button>
                          </div>
                        ) : null}
                      </div>
                      {!pickerSubjectId ? (
                        <p style={{ ...muted, margin: 0, fontSize: 12 }}>
                          Select a subject to list competencies.
                        </p>
                      ) : bulkLevelDefaultsLoading ? (
                        <p style={{ ...muted, margin: 0, fontSize: 12 }}>
                          Loading level defaults…
                        </p>
                      ) : allCompetenciesInPickerSubject.length === 0 ? (
                        <p style={{ ...muted, margin: 0, fontSize: 12 }}>
                          No active competencies in this subject.
                        </p>
                      ) : (
                        <ul
                          style={{
                            listStyle: "none",
                            margin: 0,
                            padding: "8px 10px",
                            display: "grid",
                            gap: 8,
                            maxHeight: 280,
                            overflowY: "auto",
                            border: `1px solid ${border}`,
                            borderRadius: 8,
                            backgroundColor: surface,
                          }}
                        >
                          {bulkCompetenciesDisplayed.map((c) => {
                            const checked = bulkCompetencySelection[c.id] !== false;
                            const hasLevel =
                              !!bulkLevelDefaultsByCompetencyId[c.id]?.trim();
                            return (
                              <li
                                key={c.id}
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "auto 1fr",
                                  gap: 10,
                                  alignItems: "start",
                                  fontSize: 14,
                                  color: text,
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    setBulkCompetencySelection((prev) => ({
                                      ...prev,
                                      [c.id]: !checked,
                                    }));
                                  }}
                                  disabled={
                                    isSavingMapping ||
                                    mappingPanelLoading ||
                                    hrMutating
                                  }
                                  style={{
                                    width: 16,
                                    height: 16,
                                    marginTop: 2,
                                    cursor: "pointer",
                                  }}
                                />
                                <div>
                                  <div
                                    style={{
                                      fontWeight: 600,
                                      opacity: hasLevel ? 1 : 0.55,
                                    }}
                                  >
                                    {c.name}
                                    {!hasLevel ? (
                                      <span
                                        style={{
                                          ...muted,
                                          fontWeight: 400,
                                          fontSize: 11,
                                          marginLeft: 6,
                                        }}
                                      >
                                        (no levels — skipped on add)
                                      </span>
                                    ) : null}
                                  </div>
                                  {c.description?.trim() ? (
                                    <div
                                      style={{
                                        ...muted,
                                        fontSize: 12,
                                        marginTop: 2,
                                        lineHeight: 1.35,
                                      }}
                                    >
                                      {c.description.trim()}
                                    </div>
                                  ) : null}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {pickerSubjectId &&
                      allCompetenciesInPickerSubject.length > 0 ? (
                        <p style={{ ...muted, margin: 0, fontSize: 11 }}>
                          Required level for each row uses the lowest tier on
                          that competency&apos;s scale; adjust per expectation
                          after save.
                        </p>
                      ) : null}
                    </div>
                  )}
                {assignmentAddMode === "single" ? (
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
                ) : null}
                <label
                  style={{
                    display: "grid",
                    gap: 6,
                    fontSize: 13,
                    color: mutedColor,
                  }}
                >
                  <span
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "baseline",
                      gap: 6,
                    }}
                  >
                    Relevance
                    {assignmentAddMode === "subject" ? (
                      <span style={{ ...muted, fontWeight: 400, fontSize: 11 }}>
                        (default for all new rows)
                      </span>
                    ) : null}
                  </span>
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
                    flexDirection: "column",
                    gap: 4,
                    fontSize: 13,
                    color: mutedColor,
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
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
                  </span>
                  {assignmentAddMode === "subject" ? (
                    <span style={{ ...muted, fontSize: 11, marginLeft: 24 }}>
                      Default for all new rows; edit each expectation after
                      save.
                    </span>
                  ) : null}
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
                      isSavingMapping ||
                      mappingPanelLoading ||
                      hrMutating ||
                      (assignmentAddMode === "subject" &&
                        (!pickerSubjectId ||
                          bulkChosenCount === 0 ||
                          bulkLevelDefaultsLoading))
                    }
                    style={btn}
                  >
                    {isSavingMapping
                      ? "Saving..."
                      : assignmentAddMode === "subject"
                        ? "Add selected"
                        : "Save"}
                  </button>
                </div>
              </form>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 10,
                      marginTop: 16,
                      paddingTop: 14,
                      borderTop: `1px solid ${border}`,
                    }}
                  >
                    <button
                      type="button"
                      disabled={
                        isSavingMapping ||
                        mappingPanelLoading ||
                        hrMutating ||
                        roleAugmentationLoading ||
                        competencyAiSuggestLoading
                      }
                      onClick={() => void handleApplyBuildRoleCapabilities()}
                      style={btnPrimary}
                    >
                      {isSavingMapping ? "Applying…" : "Apply to role"}
                    </button>
                    <button
                      type="button"
                      disabled={
                        isSavingMapping ||
                        mappingPanelLoading ||
                        hrMutating
                      }
                      onClick={handleCancelAddCompetencyExpectation}
                      style={btn}
                    >
                      Cancel
                    </button>
                  </div>
                    </>
                  )}
                </div>
              </div>
            ) : null}
                </div>
              </AccordionCollapsible>
            </div>
        </div>
      </div>
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
                        {jobProfilesNav === "families" && (
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
                                    onClick={() =>
                                      goToFamilyRoles(family.id)
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
                                      backgroundColor: surface,
                                      color: text,
                                      transition: "background-color 0.18s ease",
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.backgroundColor =
                                        surfaceHover;
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.backgroundColor =
                                        surface;
                                    }}
                                  >
                                    <span
                                      style={{
                                        fontSize: 15,
                                        fontWeight: 600,
                                        letterSpacing: "0.02em",
                                        minWidth: 0,
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
                                  onClick={() =>
                                    goToFamilyRoles(UNCATEGORISED_ACCORDION_ID)
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
                                    backgroundColor: surface,
                                    color: text,
                                    transition: "background-color 0.18s ease",
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor =
                                      surfaceHover;
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor =
                                      surface;
                                  }}
                                >
                                  <span
                                    style={{
                                      fontSize: 15,
                                      fontWeight: 600,
                                      letterSpacing: "0.02em",
                                    }}
                                  >
                                    {UNCATEGORISED_HEADING}
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
                              </div>
                            )}
                          </div>
                        )}
                        </>
                        )}
                        {jobProfilesNav === "familyRoles" &&
                          roleListFamilyId && (
                            <div style={{ marginTop: 4 }}>
                              <button
                                type="button"
                                onClick={goBackToFamilies}
                                disabled={
                                  jobProfileSaving ||
                                  editProfileSaving ||
                                  archivingProfileId !== null ||
                                  restoringProfileId !== null
                                }
                                style={{
                                  ...btnGhost,
                                  padding: "6px 12px",
                                  fontSize: 13,
                                }}
                              >
                                ← Job families
                              </button>
                              <h2
                                style={{
                                  margin: "14px 0 8px",
                                  fontSize: 18,
                                  fontWeight: 600,
                                  color: text,
                                  letterSpacing: "-0.02em",
                                }}
                              >
                                {roleListFamilyTitle}
                              </h2>
                              <p
                                style={{
                                  ...muted,
                                  margin: "0 0 14px",
                                  fontSize: 13,
                                }}
                              >
                                Open a role to edit responsibilities, requirements,
                                and competencies.
                              </p>
                              {roleListCountsLoading &&
                              profilesInRoleListNav.length > 0 ? (
                                <p
                                  style={{
                                    ...muted,
                                    margin: "0 0 10px",
                                    fontSize: 12,
                                  }}
                                >
                                  Loading role statistics…
                                </p>
                              ) : null}
                              {profilesInRoleListNav.length === 0 ? (
                                <p
                                  style={{
                                    margin: 0,
                                    fontSize: 13,
                                    color: mutedColor,
                                  }}
                                >
                                  No roles in this family yet.
                                </p>
                              ) : (
                                <ul
                                  style={{
                                    margin: 0,
                                    padding: 0,
                                    listStyle: "none",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 12,
                                  }}
                                >
                                  {profilesInRoleListNav.map((row) =>
                                    renderCompactRoleRow(row)
                                  )}
                                </ul>
                              )}
                            </div>
                          )}
                        {jobProfilesNav === "roleDetail" &&
                          selectedDetailJobProfile && (
                            <div style={{ marginTop: 4 }}>
                              {renderRoleDetailPanel(selectedDetailJobProfile)}
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
              Preview refined role description
            </h3>
            <p style={{ ...muted, margin: "0 0 14px", fontSize: 12, lineHeight: 1.45 }}>
              Pass 1: role purpose only. Save updates the Job Profile&apos;s stored role
              purpose text. Responsibilities, requirements, skills, and competency
              expectations are not changed. Nothing is saved until you save below.
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
                  Refined role purpose
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
                {acceptingRefinement ? "Saving…" : "Save role description"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {skillSuggestModalOpen &&
      skillSuggestLines &&
      skillSuggestLines.length > 0 &&
      skillSuggestJobProfileId ? (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="skill-suggest-modal-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 81,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "24px 16px",
            overflow: "auto",
            backgroundColor: "rgba(0,0,0,0.6)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseSkillSuggestModal();
          }}
        >
          <div
            style={{
              ...panelShell,
              width: "100%",
              maxWidth: 520,
              marginTop: 40,
              maxHeight: "min(78vh, 720px)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="skill-suggest-modal-title"
              style={{
                margin: "0 0 8px",
                fontSize: 17,
                fontWeight: 600,
                color: text,
                letterSpacing: "-0.02em",
              }}
            >
              Suggested skills for this role
            </h3>
            <p style={{ ...muted, margin: "0 0 14px", fontSize: 12, lineHeight: 1.45 }}>
              Core skills vs tools/platforms are shown separately for review. Selected
              items are saved into the same Skills list (no separate DB column yet).
              Duplicates are skipped. Competency expectations are unchanged.
            </p>
            <div
              style={{
                flex: 1,
                overflow: "auto",
                paddingRight: 4,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {skillSuggestLines.map((line, i) => (
                <Fragment key={`${line.kind}-${i}-${line.text}`}>
                  {(i === 0 ||
                    skillSuggestLines[i - 1].kind !== line.kind) && (
                    <p
                      style={{
                        ...sectionEyebrow,
                        margin: i === 0 ? "0 0 6px" : "14px 0 6px",
                      }}
                    >
                      {line.kind === "core"
                        ? "Core skills"
                        : "Tools & platforms"}
                    </p>
                  )}
                  <label
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      cursor: "pointer",
                      fontSize: 14,
                      color: text,
                      lineHeight: 1.45,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={skillSuggestSelected[i] ?? false}
                      onChange={() => toggleSkillSuggestionIndex(i)}
                      disabled={skillSuggestAccepting}
                      style={{ marginTop: 3, flexShrink: 0 }}
                    />
                    <span>{line.text}</span>
                  </label>
                </Fragment>
              ))}
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
                disabled={skillSuggestAccepting}
                onClick={() => handleCloseSkillSuggestModal()}
                style={btn}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={skillSuggestAccepting}
                onClick={() => void handleAcceptSelectedSkillSuggestions()}
                style={{
                  ...btnPrimary,
                  opacity: skillSuggestAccepting ? 0.7 : 1,
                }}
              >
                {skillSuggestAccepting ? "Adding…" : "Add selected skills"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {respSuggestModalOpen &&
      respSuggestions &&
      respSuggestJobProfileId ? (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="resp-suggest-modal-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 82,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "24px 16px",
            overflow: "auto",
            backgroundColor: "rgba(0,0,0,0.6)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseRespSuggestModal();
          }}
        >
          <div
            style={{
              ...panelShell,
              width: "100%",
              maxWidth: 520,
              marginTop: 40,
              maxHeight: "min(78vh, 720px)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="resp-suggest-modal-title"
              style={{
                margin: "0 0 8px",
                fontSize: 17,
                fontWeight: 600,
                color: text,
                letterSpacing: "-0.02em",
              }}
            >
              Suggested responsibilities for this role
            </h3>
            <p style={{ ...muted, margin: "0 0 14px", fontSize: 12, lineHeight: 1.45 }}>
              Select lines to add to this job profile&apos;s Responsibilities list
              only. Competency expectations and other sections are not changed.
              Duplicates are skipped.
            </p>
            <div
              style={{
                flex: 1,
                overflow: "auto",
                paddingRight: 4,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {respSuggestions.map((label, i) => (
                <label
                  key={`${label}-${i}`}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    cursor: "pointer",
                    fontSize: 14,
                    color: text,
                    lineHeight: 1.45,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={respSuggestSelected[i] ?? false}
                    onChange={() => toggleRespSuggestionIndex(i)}
                    disabled={respSuggestAccepting}
                    style={{ marginTop: 3, flexShrink: 0 }}
                  />
                  <span>{label}</span>
                </label>
              ))}
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
                disabled={respSuggestAccepting}
                onClick={() => handleCloseRespSuggestModal()}
                style={btn}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={respSuggestAccepting}
                onClick={() => void handleAcceptSelectedRespSuggestions()}
                style={{
                  ...btnPrimary,
                  opacity: respSuggestAccepting ? 0.7 : 1,
                }}
              >
                {respSuggestAccepting ? "Adding…" : "Add selected responsibilities"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {reqSuggestModalOpen &&
      reqSuggestions &&
      reqSuggestJobProfileId ? (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="req-suggest-modal-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 83,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "24px 16px",
            overflow: "auto",
            backgroundColor: "rgba(0,0,0,0.6)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseReqSuggestModal();
          }}
        >
          <div
            style={{
              ...panelShell,
              width: "100%",
              maxWidth: 520,
              marginTop: 40,
              maxHeight: "min(78vh, 720px)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="req-suggest-modal-title"
              style={{
                margin: "0 0 8px",
                fontSize: 17,
                fontWeight: 600,
                color: text,
                letterSpacing: "-0.02em",
              }}
            >
              Suggested requirements for this role
            </h3>
            <p style={{ ...muted, margin: "0 0 14px", fontSize: 12, lineHeight: 1.45 }}>
              Select lines to add to this job profile&apos;s Requirements list only.
              Competency expectations and other sections are not changed. Duplicates
              are skipped.
            </p>
            <div
              style={{
                flex: 1,
                overflow: "auto",
                paddingRight: 4,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {reqSuggestions.map((label, i) => (
                <label
                  key={`${label}-${i}`}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    cursor: "pointer",
                    fontSize: 14,
                    color: text,
                    lineHeight: 1.45,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={reqSuggestSelected[i] ?? false}
                    onChange={() => toggleReqSuggestionIndex(i)}
                    disabled={reqSuggestAccepting}
                    style={{ marginTop: 3, flexShrink: 0 }}
                  />
                  <span>{label}</span>
                </label>
              ))}
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
                disabled={reqSuggestAccepting}
                onClick={() => handleCloseReqSuggestModal()}
                style={btn}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={reqSuggestAccepting}
                onClick={() => void handleAcceptSelectedReqSuggestions()}
                style={{
                  ...btnPrimary,
                  opacity: reqSuggestAccepting ? 0.7 : 1,
                }}
              >
                {reqSuggestAccepting ? "Adding…" : "Add selected requirements"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
