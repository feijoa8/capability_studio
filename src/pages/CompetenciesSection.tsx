import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";
import { supabase } from "../lib/supabase";
import { generatePracticeModelWithAi } from "../lib/practiceModelGeneration";
import type {
  CompetencyLevelDefinitionRow,
  CompetencyPracticeRow,
  CompetencyRow,
  CompetencySubjectRow,
  OrganisationProfileRow,
} from "./hub/types";
import { AccordionCollapsible } from "./hub/AccordionCollapsible";
import {
  entityMatchesLifecycleFilter,
  isAssignableLifecycleStatus,
  parseLifecycleStatus,
  type LifecycleViewFilter,
} from "./hub/competencyLifecycle";
import { isWorkspaceAdminRole } from "./hub/workspaceRoles";
import {
  accent,
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
  surface,
  text,
} from "./hub/hubTheme";

const UNASSIGNED_SUBJECT_KEY = "__unassigned__";
const UNASSIGNED_PRACTICE_KEY = "__unassigned_practice__";

type ManagementSectionModel = {
  key: string;
  title: string;
  description: string | null;
  category: string | null;
  items: CompetencyRow[];
  isUnassigned: boolean;
  /** Practice this subject belongs to; null = Unassigned Practice bucket */
  subjectPracticeId: string | null;
};

type ManagementPracticeGroup = {
  key: string;
  title: string;
  description: string | null;
  isUnassigned: boolean;
  subjectSections: ManagementSectionModel[];
};

type PracticeGenPreviewRow = {
  id: string;
  name: string;
  description: string;
  selected: boolean;
};

/** Practice → Subject → Competency; subjects without a practice use Unassigned Practice */
function buildManagementPracticeGroups(
  practiceRows: CompetencyPracticeRow[],
  subjectRows: CompetencySubjectRow[],
  competencies: CompetencyRow[]
): ManagementPracticeGroup[] {
  const bySubject = new Map<string, CompetencyRow[]>();
  for (const c of competencies) {
    const key = c.subject_id ?? UNASSIGNED_SUBJECT_KEY;
    if (!bySubject.has(key)) bySubject.set(key, []);
    bySubject.get(key)!.push(c);
  }
  for (const [, arr] of bySubject) {
    arr.sort((a, b) => a.name.localeCompare(b.name));
  }

  const subjectIds = new Set(subjectRows.map((s) => s.id));
  const orphanKeys: string[] = [];
  for (const key of bySubject.keys()) {
    if (key !== UNASSIGNED_SUBJECT_KEY && !subjectIds.has(key)) {
      orphanKeys.push(key);
    }
  }
  for (const key of orphanKeys) {
    const items = bySubject.get(key) ?? [];
    bySubject.delete(key);
    const un = bySubject.get(UNASSIGNED_SUBJECT_KEY) ?? [];
    bySubject.set(UNASSIGNED_SUBJECT_KEY, [...un, ...items]);
  }
  const unBucket = bySubject.get(UNASSIGNED_SUBJECT_KEY);
  if (unBucket) {
    unBucket.sort((a, b) => a.name.localeCompare(b.name));
  }

  const sortedSubjects = [...subjectRows].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const realSections: ManagementSectionModel[] = sortedSubjects.map((s) => ({
    key: s.id,
    title: s.name.trim() || "Subject",
    description: s.description?.trim() ? s.description : null,
    category: s.category?.trim() ? s.category : null,
    items: bySubject.get(s.id) ?? [],
    isUnassigned: false,
    subjectPracticeId: s.practice_id ?? null,
  }));

  const unassignedSubjectSection: ManagementSectionModel = {
    key: UNASSIGNED_SUBJECT_KEY,
    title: "Unassigned",
    description: null,
    category: null,
    items: bySubject.get(UNASSIGNED_SUBJECT_KEY) ?? [],
    isUnassigned: true,
    subjectPracticeId: null,
  };

  const grouped = new Map<string, ManagementSectionModel[]>();
  for (const section of realSections) {
    const pk = section.subjectPracticeId ?? UNASSIGNED_PRACTICE_KEY;
    if (!grouped.has(pk)) grouped.set(pk, []);
    grouped.get(pk)!.push(section);
  }
  if (!grouped.has(UNASSIGNED_PRACTICE_KEY)) {
    grouped.set(UNASSIGNED_PRACTICE_KEY, []);
  }
  grouped.get(UNASSIGNED_PRACTICE_KEY)!.push(unassignedSubjectSection);

  const sortedPractices = [...practiceRows].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const result: ManagementPracticeGroup[] = [];
  for (const p of sortedPractices) {
    result.push({
      key: p.id,
      title: p.name.trim() || "Practice",
      description: p.description?.trim() ? p.description : null,
      isUnassigned: false,
      subjectSections: grouped.get(p.id) ?? [],
    });
  }

  const unassignedPracticeSections = grouped.get(UNASSIGNED_PRACTICE_KEY) ?? [];
  if (unassignedPracticeSections.length > 0) {
    result.push({
      key: UNASSIGNED_PRACTICE_KEY,
      title: "Unassigned Practice",
      description: null,
      isUnassigned: true,
      subjectSections: unassignedPracticeSections,
    });
  }

  return result;
}

export type CompetenciesSectionProps = {
  activeOrgId: string | null;
  isActive: boolean;
  /** Used to gate Archive / Unarchive (workspace admin roles). */
  workspaceRole?: string | null;
};

export function CompetenciesSection({
  activeOrgId,
  isActive,
  workspaceRole = null,
}: CompetenciesSectionProps) {
  const [competencies, setCompetencies] = useState<CompetencyRow[]>([]);
  const [competenciesLoading, setCompetenciesLoading] = useState(false);
  const [competenciesError, setCompetenciesError] = useState<string | null>(
    null
  );
  const [subjects, setSubjects] = useState<CompetencySubjectRow[]>([]);
  const [practices, setPractices] = useState<CompetencyPracticeRow[]>([]);
  const [showCreatePracticeForm, setShowCreatePracticeForm] = useState(false);
  const [newPracticeName, setNewPracticeName] = useState("");
  const [newPracticeDescription, setNewPracticeDescription] = useState("");
  const [isSavingPractice, setIsSavingPractice] = useState(false);
  const [showCreateSubjectForm, setShowCreateSubjectForm] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState("");
  const [newSubjectDescription, setNewSubjectDescription] = useState("");
  const [newSubjectCategory, setNewSubjectCategory] = useState("");
  const [newSubjectPracticeId, setNewSubjectPracticeId] = useState("");
  const [isSavingSubject, setIsSavingSubject] = useState(false);

  const [showCreateCompetencyForm, setShowCreateCompetencyForm] =
    useState(false);
  const [newCompetencyName, setNewCompetencyName] = useState("");
  const [newCompetencyDescription, setNewCompetencyDescription] = useState("");
  const [newCompetencySubjectId, setNewCompetencySubjectId] = useState("");
  /** When set, create form shows which subject the competency is being added to */
  const [competencyFormSubjectHint, setCompetencyFormSubjectHint] = useState<
    string | null
  >(null);
  /** Which subject section shows the inline create form; only one at a time */
  const [inlineCompetencySectionKey, setInlineCompetencySectionKey] = useState<
    string | null
  >(null);
  const inlineFormAnchorRef = useRef<HTMLDivElement | null>(null);
  const inlineNameInputRef = useRef<HTMLInputElement | null>(null);
  /** Briefly highlight a row after creating a competency */
  const [highlightCompetencyId, setHighlightCompetencyId] = useState<
    string | null
  >(null);
  const [isSavingCompetency, setIsSavingCompetency] = useState(false);

  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null);
  const [editSubjectName, setEditSubjectName] = useState("");
  const [editSubjectDescription, setEditSubjectDescription] = useState("");
  const [editSubjectCategory, setEditSubjectCategory] = useState("");
  const [editSubjectPracticeId, setEditSubjectPracticeId] = useState("");
  const [isSavingEditSubject, setIsSavingEditSubject] = useState(false);

  const [editingCompetencyId, setEditingCompetencyId] = useState<string | null>(
    null
  );
  const [editCompetencyName, setEditCompetencyName] = useState("");
  const [editCompetencyDescription, setEditCompetencyDescription] =
    useState("");
  const [editCompetencySubjectId, setEditCompetencySubjectId] = useState("");
  const [isSavingEditCompetency, setIsSavingEditCompetency] = useState(false);
  const [expandedCompetencyId, setExpandedCompetencyId] = useState<string | null>(
    null
  );
  const [levelDefinitions, setLevelDefinitions] = useState<
    CompetencyLevelDefinitionRow[]
  >([]);
  const [levelDefinitionsLoading, setLevelDefinitionsLoading] = useState(false);
  const [showCreateLevelFormForCompetencyId, setShowCreateLevelFormForCompetencyId] =
    useState<string | null>(null);
  const [newLevelName, setNewLevelName] = useState("");
  const [newLevelOrder, setNewLevelOrder] = useState("");
  const [newLevelDescription, setNewLevelDescription] = useState("");
  const [isSavingLevel, setIsSavingLevel] = useState(false);

  /** Practice accordion: omitted or true = expanded; false = collapsed */
  const [practiceAccordionOpen, setPracticeAccordionOpen] = useState<
    Record<string, boolean>
  >({});
  /** Subject accordion: key `${practiceKey}::${sectionKey}`; omitted or true = expanded */
  const [subjectAccordionOpen, setSubjectAccordionOpen] = useState<
    Record<string, boolean>
  >({});

  const [practiceGenModalOpen, setPracticeGenModalOpen] = useState(false);
  const [practiceGenPhase, setPracticeGenPhase] = useState<
    "input" | "preview"
  >("input");
  const [companyProfile, setCompanyProfile] =
    useState<OrganisationProfileRow | null>(null);
  const [companyProfileLoading, setCompanyProfileLoading] = useState(false);
  const [companyProfileLoadError, setCompanyProfileLoadError] = useState<
    string | null
  >(null);
  const [practiceGenDomain, setPracticeGenDomain] = useState("");
  const [practiceGenFocus, setPracticeGenFocus] = useState("");
  const [practiceGenRows, setPracticeGenRows] = useState<PracticeGenPreviewRow[]>(
    [],
  );
  const [practiceGenLoading, setPracticeGenLoading] = useState(false);
  const [practiceGenError, setPracticeGenError] = useState<string | null>(null);
  const [practiceGenAccepting, setPracticeGenAccepting] = useState(false);

  const [showArchivedEntities, setShowArchivedEntities] = useState(false);
  const [lifecycleViewFilter, setLifecycleViewFilter] =
    useState<LifecycleViewFilter>("all");
  const [lifecycleModal, setLifecycleModal] = useState<
    | null
    | {
        kind: "deprecate";
        entity: "practice" | "subject" | "competency";
        id: string;
        label: string;
      }
  >(null);
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [lifecycleReplacedById, setLifecycleReplacedById] = useState("");
  const [lifecycleSaving, setLifecycleSaving] = useState(false);

  const canArchiveEntity = isWorkspaceAdminRole(workspaceRole);

  useEffect(() => {
    if (!isActive || activeOrgId === null) {
      return;
    }

    let cancelled = false;
    const orgId = activeOrgId;

    async function loadCompetencies() {
      setCompetenciesLoading(true);
      setCompetenciesError(null);
      setCompetencies([]);
      setSubjects([]);
      setPractices([]);
      setShowCreatePracticeForm(false);
      setNewPracticeName("");
      setNewPracticeDescription("");
      setShowCreateSubjectForm(false);
      setNewSubjectName("");
      setNewSubjectDescription("");
      setNewSubjectCategory("");
      setNewSubjectPracticeId("");
      setShowCreateCompetencyForm(false);
      setInlineCompetencySectionKey(null);
      setNewCompetencyName("");
      setNewCompetencyDescription("");
      setNewCompetencySubjectId("");
      setCompetencyFormSubjectHint(null);
      setEditingSubjectId(null);
      setEditSubjectName("");
      setEditSubjectDescription("");
      setEditSubjectCategory("");
      setEditSubjectPracticeId("");
      setEditingCompetencyId(null);
      setEditCompetencyName("");
      setEditCompetencyDescription("");
      setEditCompetencySubjectId("");
      setExpandedCompetencyId(null);
      setLevelDefinitions([]);
      setLevelDefinitionsLoading(false);
      setShowCreateLevelFormForCompetencyId(null);
      setNewLevelName("");
      setNewLevelOrder("");
      setNewLevelDescription("");

      const statusList = showArchivedEntities
        ? (["active", "deprecated", "archived"] as const)
        : (["active", "deprecated"] as const);

      const [res, subRes, pracRes] = await Promise.all([
        supabase
          .from("competencies")
          .select(
            "id, name, description, is_active, status, deprecated_at, deprecated_reason, replaced_by_id, subject_id, competency_subjects ( id, name, description, category, practice_id, status, deprecated_at, deprecated_reason, replaced_by_id, competency_practices ( id, name, description, is_active, status, deprecated_at, deprecated_reason, replaced_by_id ) )"
          )
          .eq("organisation_id", orgId)
          .in("status", [...statusList])
          .order("name"),
        supabase
          .from("competency_subjects")
          .select(
            "id, name, description, category, practice_id, status, deprecated_at, deprecated_reason, replaced_by_id, competency_practices ( id, name, description, is_active, status, deprecated_at, deprecated_reason, replaced_by_id )"
          )
          .eq("organisation_id", orgId)
          .in("status", [...statusList])
          .order("name", { ascending: true }),
        supabase
          .from("competency_practices")
          .select(
            "id, name, description, is_active, organisation_id, status, deprecated_at, deprecated_reason, replaced_by_id"
          )
          .eq("organisation_id", orgId)
          .in("status", [...statusList])
          .order("name", { ascending: true }),
      ]);

      if (cancelled) return;

      if (pracRes.error) {
        console.error("[competency_practices]", pracRes.error);
        setPractices([]);
      } else {
        setPractices((pracRes.data as CompetencyPracticeRow[] | null) ?? []);
      }

      if (subRes.error) {
        console.error("[competency_subjects]", subRes.error);
        setSubjects([]);
      } else {
        setSubjects((subRes.data as CompetencySubjectRow[] | null) ?? []);
      }

      if (res.error) {
        setCompetenciesError(res.error.message);
        setCompetencies([]);
      } else {
        setCompetencies((res.data as CompetencyRow[] | null) ?? []);
        setCompetenciesError(null);
      }

      setCompetenciesLoading(false);
    }

    void loadCompetencies();
    return () => {
      cancelled = true;
    };
  }, [isActive, activeOrgId, showArchivedEntities]);

  useEffect(() => {
    if (highlightCompetencyId === null) return;
    const raf = requestAnimationFrame(() => {
      document
        .getElementById(`comp-row-${highlightCompetencyId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    const clear = window.setTimeout(() => setHighlightCompetencyId(null), 1000);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(clear);
    };
  }, [highlightCompetencyId]);

  useEffect(() => {
    if (inlineCompetencySectionKey === null) return;
    const frame = requestAnimationFrame(() => {
      inlineFormAnchorRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
    const focusTimer = window.setTimeout(() => {
      inlineNameInputRef.current?.focus({ preventScroll: true });
    }, 200);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(focusTimer);
    };
  }, [inlineCompetencySectionKey]);

  async function reloadPracticesForOrg(orgId: string) {
    const statusList = showArchivedEntities
      ? (["active", "deprecated", "archived"] as const)
      : (["active", "deprecated"] as const);
    const res = await supabase
      .from("competency_practices")
      .select(
        "id, name, description, is_active, organisation_id, status, deprecated_at, deprecated_reason, replaced_by_id"
      )
      .eq("organisation_id", orgId)
      .in("status", [...statusList])
      .order("name", { ascending: true });

    if (res.error) {
      console.error(res.error);
      return;
    }
    setPractices((res.data as CompetencyPracticeRow[] | null) ?? []);
  }

  async function reloadSubjectsForOrg(orgId: string) {
    const statusList = showArchivedEntities
      ? (["active", "deprecated", "archived"] as const)
      : (["active", "deprecated"] as const);
    const subRes = await supabase
      .from("competency_subjects")
      .select(
        "id, name, description, category, practice_id, status, deprecated_at, deprecated_reason, replaced_by_id, competency_practices ( id, name, description, is_active, status, deprecated_at, deprecated_reason, replaced_by_id )"
      )
      .eq("organisation_id", orgId)
      .in("status", [...statusList])
      .order("name", { ascending: true });

    if (subRes.error) {
      console.error(subRes.error);
      return;
    }
    setSubjects((subRes.data as CompetencySubjectRow[] | null) ?? []);
  }

  async function reloadCompetenciesForOrg(orgId: string): Promise<CompetencyRow[]> {
    const statusList = showArchivedEntities
      ? (["active", "deprecated", "archived"] as const)
      : (["active", "deprecated"] as const);
    const res = await supabase
      .from("competencies")
      .select(
        "id, name, description, is_active, status, deprecated_at, deprecated_reason, replaced_by_id, subject_id, competency_subjects ( id, name, description, category, practice_id, status, deprecated_at, deprecated_reason, replaced_by_id, competency_practices ( id, name, description, is_active, status, deprecated_at, deprecated_reason, replaced_by_id ) )"
      )
      .eq("organisation_id", orgId)
      .in("status", [...statusList])
      .order("name");

    if (res.error) {
      console.error(res.error);
      alert(res.error.message);
      setCompetenciesError(res.error.message);
      return [];
    }
    const rows = (res.data as CompetencyRow[] | null) ?? [];
    setCompetencies(rows);
    setCompetenciesError(null);
    return rows;
  }

  async function handleSaveNewSubject(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (activeOrgId === null) return;

    const name = newSubjectName.trim();
    if (!name) {
      alert("Please enter a subject name");
      return;
    }

    const descriptionTrimmed = newSubjectDescription.trim();
    const categoryTrimmed = newSubjectCategory.trim();

    setIsSavingSubject(true);
    const practiceId =
      newSubjectPracticeId.trim() === "" ? null : newSubjectPracticeId;
    const { error } = await supabase.from("competency_subjects").insert({
      organisation_id: activeOrgId,
      name,
      description: descriptionTrimmed.length > 0 ? descriptionTrimmed : null,
      category: categoryTrimmed.length > 0 ? categoryTrimmed : null,
      practice_id: practiceId,
      is_active: true,
      status: "active",
    });

    if (error) {
      console.error(error);
      alert(error.message || "Failed to create subject");
      setIsSavingSubject(false);
      return;
    }

    setNewSubjectName("");
    setNewSubjectDescription("");
    setNewSubjectCategory("");
    setNewSubjectPracticeId("");
    setShowCreateSubjectForm(false);
    setIsSavingSubject(false);

    await reloadSubjectsForOrg(activeOrgId);
  }

  function handleCancelCreateSubject() {
    setShowCreateSubjectForm(false);
    setNewSubjectName("");
    setNewSubjectDescription("");
    setNewSubjectCategory("");
    setNewSubjectPracticeId("");
  }

  async function handleSaveNewPractice(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (activeOrgId === null) return;

    const name = newPracticeName.trim();
    if (!name) {
      alert("Please enter a practice name");
      return;
    }

    const descriptionTrimmed = newPracticeDescription.trim();

    setIsSavingPractice(true);
    const { error } = await supabase.from("competency_practices").insert({
      organisation_id: activeOrgId,
      name,
      description: descriptionTrimmed.length > 0 ? descriptionTrimmed : null,
      is_active: true,
      status: "active",
    });

    if (error) {
      console.error(error);
      alert(error.message || "Failed to create practice");
      setIsSavingPractice(false);
      return;
    }

    setNewPracticeName("");
    setNewPracticeDescription("");
    setShowCreatePracticeForm(false);
    setIsSavingPractice(false);

    await reloadPracticesForOrg(activeOrgId);
  }

  function handleCancelCreatePractice() {
    setShowCreatePracticeForm(false);
    setNewPracticeName("");
    setNewPracticeDescription("");
  }

  async function handleSaveNewCompetency(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (activeOrgId === null) {
      alert("No active workspace selected");
      return;
    }

    const name = newCompetencyName.trim();
    if (!name) {
      alert("Please enter a name");
      return;
    }

    const descriptionTrimmed = newCompetencyDescription.trim();

    const idsBefore = new Set(competencies.map((c) => c.id));

    setIsSavingCompetency(true);
    const subjectId =
      newCompetencySubjectId.trim() === "" ? null : newCompetencySubjectId;
    const { error } = await supabase.from("competencies").insert({
      organisation_id: activeOrgId,
      name,
      description: descriptionTrimmed.length > 0 ? descriptionTrimmed : null,
      is_active: true,
      subject_id: subjectId,
      status: "active",
    });

    if (error) {
      console.error(error);

      if (error.code === "23505") {
        alert("This competency already exists in this workspace");
      } else {
        alert("Failed to create competency");
      }

      setIsSavingCompetency(false);
      return;
    }

    setNewCompetencyName("");
    setNewCompetencyDescription("");
    setNewCompetencySubjectId("");
    setCompetencyFormSubjectHint(null);
    setShowCreateCompetencyForm(false);
    setInlineCompetencySectionKey(null);
    setIsSavingCompetency(false);

    const rows = await reloadCompetenciesForOrg(activeOrgId);
    const newRow = rows.find((c) => !idsBefore.has(c.id));
    if (newRow) {
      setHighlightCompetencyId(newRow.id);
    }
  }

  function handleCancelCreateCompetency() {
    setShowCreateCompetencyForm(false);
    setInlineCompetencySectionKey(null);
    setNewCompetencyName("");
    setNewCompetencyDescription("");
    setNewCompetencySubjectId("");
    setCompetencyFormSubjectHint(null);
  }

  function handleOpenGenericAddCompetency() {
    if (showCreateCompetencyForm) {
      setShowCreateCompetencyForm(false);
      setCompetencyFormSubjectHint(null);
      setInlineCompetencySectionKey(null);
    } else {
      setInlineCompetencySectionKey(null);
      setNewCompetencySubjectId("");
      setCompetencyFormSubjectHint(null);
      setShowCreateCompetencyForm(true);
    }
  }

  function handleAddCompetencyToSubject(
    presetSubjectId: string,
    subjectDisplayName: string,
    inlineSectionKey: string
  ) {
    setShowCreateCompetencyForm(false);
    setInlineCompetencySectionKey(inlineSectionKey);
    setNewCompetencySubjectId(presetSubjectId);
    setCompetencyFormSubjectHint(subjectDisplayName);
  }

  function handleStartEditSubject(section: ManagementSectionModel) {
    if (section.isUnassigned) return;
    setInlineCompetencySectionKey(null);
    setEditingSubjectId(section.key);
    setEditSubjectName(section.title);
    setEditSubjectDescription(section.description ?? "");
    setEditSubjectCategory(section.category ?? "");
    setEditSubjectPracticeId(section.subjectPracticeId ?? "");
  }

  function handleCancelEditSubject() {
    setEditingSubjectId(null);
    setEditSubjectName("");
    setEditSubjectDescription("");
    setEditSubjectCategory("");
    setEditSubjectPracticeId("");
  }

  async function handleSaveEditSubject(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (activeOrgId === null || !editingSubjectId) return;

    const name = editSubjectName.trim();
    if (!name) {
      alert("Please enter a subject name");
      return;
    }

    const descriptionTrimmed = editSubjectDescription.trim();
    const categoryTrimmed = editSubjectCategory.trim();

    setIsSavingEditSubject(true);
    const practiceId =
      editSubjectPracticeId.trim() === "" ? null : editSubjectPracticeId;
    const { error } = await supabase
      .from("competency_subjects")
      .update({
        name,
        description: descriptionTrimmed.length > 0 ? descriptionTrimmed : null,
        category: categoryTrimmed.length > 0 ? categoryTrimmed : null,
        practice_id: practiceId,
      })
      .eq("id", editingSubjectId)
      .eq("organisation_id", activeOrgId);

    if (error) {
      console.error(error);
      alert(error.message || "Failed to update subject");
      setIsSavingEditSubject(false);
      return;
    }

    setEditingSubjectId(null);
    setEditSubjectName("");
    setEditSubjectDescription("");
    setEditSubjectCategory("");
    setEditSubjectPracticeId("");
    setIsSavingEditSubject(false);

    await Promise.all([
      reloadSubjectsForOrg(activeOrgId),
      reloadCompetenciesForOrg(activeOrgId),
    ]);
  }

  function handleStartEditCompetency(c: CompetencyRow) {
    setEditingCompetencyId(c.id);
    setEditCompetencyName(c.name);
    setEditCompetencyDescription(c.description ?? "");
    setEditCompetencySubjectId(c.subject_id ?? "");
  }

  function handleCancelEditCompetency() {
    setEditingCompetencyId(null);
    setEditCompetencyName("");
    setEditCompetencyDescription("");
    setEditCompetencySubjectId("");
  }

  async function handleSaveEditCompetency(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (activeOrgId === null || !editingCompetencyId) return;

    const name = editCompetencyName.trim();
    if (!name) {
      alert("Please enter a name");
      return;
    }

    const descriptionTrimmed = editCompetencyDescription.trim();
    const subjectId =
      editCompetencySubjectId.trim() === "" ? null : editCompetencySubjectId;

    setIsSavingEditCompetency(true);
    const { error } = await supabase
      .from("competencies")
      .update({
        name,
        description: descriptionTrimmed.length > 0 ? descriptionTrimmed : null,
        subject_id: subjectId,
      })
      .eq("id", editingCompetencyId)
      .eq("organisation_id", activeOrgId);

    if (error) {
      console.error(error);
      alert(error.message || "Failed to update competency");
      setIsSavingEditCompetency(false);
      return;
    }

    setEditingCompetencyId(null);
    setEditCompetencyName("");
    setEditCompetencyDescription("");
    setEditCompetencySubjectId("");
    setIsSavingEditCompetency(false);

    await reloadCompetenciesForOrg(activeOrgId);
  }

  async function loadLevelDefinitions(competencyId: string) {
    setLevelDefinitionsLoading(true);
    setLevelDefinitions([]);

    const res = await supabase
      .from("competency_level_definitions")
      .select(
        "id, competency_id, level_name, level_order, description, is_active"
      )
      .eq("competency_id", competencyId)
      .eq("is_active", true)
      .order("level_order", { ascending: true });

    if (res.error) {
      console.error(res.error);
      alert(res.error.message);
      setLevelDefinitions([]);
    } else {
      setLevelDefinitions(
        (res.data as CompetencyLevelDefinitionRow[] | null) ?? []
      );
    }

    setLevelDefinitionsLoading(false);
  }

  function handleToggleManageLevels(competencyId: string) {
    if (
      editingCompetencyId !== null &&
      editingCompetencyId !== competencyId
    ) {
      handleCancelEditCompetency();
    }

    if (expandedCompetencyId === competencyId) {
      setExpandedCompetencyId(null);
      setLevelDefinitions([]);
      setLevelDefinitionsLoading(false);
      setShowCreateLevelFormForCompetencyId(null);
      setNewLevelName("");
      setNewLevelOrder("");
      setNewLevelDescription("");
      return;
    }

    setExpandedCompetencyId(competencyId);
    setShowCreateLevelFormForCompetencyId(null);
    setNewLevelName("");
    setNewLevelOrder("");
    setNewLevelDescription("");
    void loadLevelDefinitions(competencyId);
  }

  function handleCancelCreateLevelDefinition() {
    setShowCreateLevelFormForCompetencyId(null);
    setNewLevelName("");
    setNewLevelOrder("");
    setNewLevelDescription("");
  }

  async function handleSaveNewLevelDefinition(
    e: FormEvent<HTMLFormElement>,
    competencyId: string
  ) {
    e.preventDefault();

    const level_name = newLevelName.trim();
    if (!level_name) {
      alert("Please enter a level name");
      return;
    }

    const orderRaw = newLevelOrder.trim();
    if (!orderRaw) {
      alert("Please enter a level order");
      return;
    }

    const level_order = Number(orderRaw);
    if (!Number.isFinite(level_order)) {
      alert("Level order must be a valid number");
      return;
    }

    const descriptionTrimmed = newLevelDescription.trim();

    setIsSavingLevel(true);
    const { error } = await supabase
      .from("competency_level_definitions")
      .insert({
        competency_id: competencyId,
        level_name,
        level_order,
        description:
          descriptionTrimmed.length > 0 ? descriptionTrimmed : null,
        is_active: true,
      });

    if (error) {
      console.error(error);

      if (error.code === "23505") {
        alert("This level already exists for this competency");
      } else {
        alert("Failed to create level definition");
      }

      setIsSavingLevel(false);
      return;
    }

    setNewLevelName("");
    setNewLevelOrder("");
    setNewLevelDescription("");
    setShowCreateLevelFormForCompetencyId(null);
    setIsSavingLevel(false);

    await loadLevelDefinitions(competencyId);
  }

  const filteredPractices = useMemo(
    () =>
      practices.filter((p) =>
        entityMatchesLifecycleFilter(
          p.status,
          lifecycleViewFilter,
          showArchivedEntities
        )
      ),
    [practices, lifecycleViewFilter, showArchivedEntities]
  );

  const filteredSubjects = useMemo(
    () =>
      subjects.filter((s) =>
        entityMatchesLifecycleFilter(
          s.status,
          lifecycleViewFilter,
          showArchivedEntities
        )
      ),
    [subjects, lifecycleViewFilter, showArchivedEntities]
  );

  const filteredCompetencies = useMemo(
    () =>
      competencies.filter((c) =>
        entityMatchesLifecycleFilter(
          c.status,
          lifecycleViewFilter,
          showArchivedEntities
        )
      ),
    [competencies, lifecycleViewFilter, showArchivedEntities]
  );

  const assignablePractices = useMemo(
    () => practices.filter((p) => isAssignableLifecycleStatus(p.status)),
    [practices]
  );

  const assignableSubjects = useMemo(
    () => subjects.filter((s) => isAssignableLifecycleStatus(s.status)),
    [subjects]
  );

  const managementPracticeGroups = useMemo(
    () =>
      buildManagementPracticeGroups(
        filteredPractices,
        filteredSubjects,
        filteredCompetencies
      ),
    [filteredPractices, filteredSubjects, filteredCompetencies]
  );

  function isPracticeAccordionExpanded(practiceKey: string) {
    return practiceAccordionOpen[practiceKey] !== false;
  }

  function togglePracticeAccordion(practiceKey: string) {
    setPracticeAccordionOpen((prev) => {
      const open = prev[practiceKey] !== false;
      return { ...prev, [practiceKey]: !open };
    });
  }

  function subjectAccordionStorageId(
    practiceKey: string,
    sectionKey: string
  ) {
    return `${practiceKey}::${sectionKey}`;
  }

  function isSubjectAccordionExpanded(
    practiceKey: string,
    sectionKey: string,
    sectionKeyForState: string
  ) {
    if (editingSubjectId === sectionKeyForState) return true;
    if (inlineCompetencySectionKey === sectionKeyForState) return true;
    const id = subjectAccordionStorageId(practiceKey, sectionKey);
    return subjectAccordionOpen[id] !== false;
  }

  function toggleSubjectAccordion(practiceKey: string, sectionKey: string) {
    const id = subjectAccordionStorageId(practiceKey, sectionKey);
    setSubjectAccordionOpen((prev) => {
      const open = prev[id] !== false;
      return { ...prev, [id]: !open };
    });
  }

  async function loadCompanyProfileForPracticeGen(orgId: string) {
    setCompanyProfileLoading(true);
    setCompanyProfileLoadError(null);
    const res = await supabase
      .from("organisation_profiles")
      .select(
        "id, organisation_id, organisation_name, sector, industry, summary, business_purpose, strategic_priorities, delivery_context, capability_emphasis, role_interpretation_guidance, terminology_guidance, created_at, updated_at"
      )
      .eq("organisation_id", orgId)
      .maybeSingle();
    setCompanyProfileLoading(false);
    if (res.error) {
      console.error(res.error);
      setCompanyProfileLoadError(res.error.message);
      setCompanyProfile(null);
      return;
    }
    setCompanyProfile((res.data as OrganisationProfileRow | null) ?? null);
  }

  function openPracticeGenModal() {
    if (!activeOrgId) return;
    setPracticeGenError(null);
    setPracticeGenDomain("");
    setPracticeGenFocus("");
    setPracticeGenRows([]);
    setPracticeGenPhase("input");
    setPracticeGenModalOpen(true);
    void loadCompanyProfileForPracticeGen(activeOrgId);
  }

  function closePracticeGenModal() {
    setPracticeGenModalOpen(false);
    setPracticeGenLoading(false);
    setPracticeGenError(null);
    setPracticeGenAccepting(false);
  }

  async function handleGeneratePracticeModel() {
    if (!activeOrgId) return;
    setPracticeGenError(null);
    setPracticeGenLoading(true);
    try {
      const result = await generatePracticeModelWithAi({
        companyProfile,
        domain: practiceGenDomain.trim() || null,
        focus: practiceGenFocus.trim() || null,
      });
      setPracticeGenRows(
        result.practices.map((p) => ({
          id: crypto.randomUUID(),
          name: p.name,
          description: p.description,
          selected: true,
        }))
      );
      setPracticeGenPhase("preview");
    } catch (e) {
      setPracticeGenError(
        e instanceof Error ? e.message : "Generation failed."
      );
    } finally {
      setPracticeGenLoading(false);
    }
  }

  async function handleAcceptPracticeGenerated() {
    if (!activeOrgId) return;
    const rows = practiceGenRows.filter((r) => r.selected && r.name.trim());
    if (rows.length === 0) {
      alert("Select at least one practice with a name.");
      return;
    }
    const existingLower = new Set(
      practices.map((p) => p.name.trim().toLowerCase())
    );
    const colliding = rows.filter((r) =>
      existingLower.has(r.name.trim().toLowerCase())
    );
    let toCreate = rows;
    if (colliding.length > 0) {
      const ok = window.confirm(
        `Some selected names match existing practices (${colliding
          .map((c) => c.name.trim())
          .join(", ")}). New rows will be added — existing practices will not be modified. Continue?`
      );
      if (!ok) {
        toCreate = rows.filter(
          (r) => !existingLower.has(r.name.trim().toLowerCase())
        );
        if (toCreate.length === 0) {
          alert("No practices to create — all selected names already exist.");
          return;
        }
      }
    }
    setPracticeGenAccepting(true);
    try {
      for (const row of toCreate) {
        const { error } = await supabase.from("competency_practices").insert({
          organisation_id: activeOrgId,
          name: row.name.trim(),
          description: row.description.trim() || null,
          is_active: true,
          status: "active",
        });
        if (error) {
          console.error(error);
          alert(error.message || "Failed to create a practice.");
          return;
        }
      }
      await reloadPracticesForOrg(activeOrgId);
      closePracticeGenModal();
    } finally {
      setPracticeGenAccepting(false);
    }
  }

  function lifecycleTable(
    entity: "practice" | "subject" | "competency"
  ):
    | "competency_practices"
    | "competency_subjects"
    | "competencies" {
    if (entity === "practice") return "competency_practices";
    if (entity === "subject") return "competency_subjects";
    return "competencies";
  }

  function replacementOptions(
    entity: "practice" | "subject" | "competency"
  ): { id: string; name: string }[] {
    if (entity === "practice") {
      return assignablePractices.map((p) => ({ id: p.id, name: p.name }));
    }
    if (entity === "subject") {
      return assignableSubjects.map((s) => ({ id: s.id, name: s.name }));
    }
    return competencies
      .filter((c) => isAssignableLifecycleStatus(c.status))
      .map((c) => ({ id: c.id, name: c.name }));
  }

  function replacementOptionsExcluding(
    entity: "practice" | "subject" | "competency",
    excludeId: string
  ): { id: string; name: string }[] {
    return replacementOptions(entity).filter((o) => o.id !== excludeId);
  }

  async function submitLifecycleDeprecate() {
    if (activeOrgId === null || !lifecycleModal || lifecycleModal.kind !== "deprecate") {
      return;
    }
    const { entity, id } = lifecycleModal;
    const reason = lifecycleReason.trim();
    let replaced: string | null =
      lifecycleReplacedById.trim() === "" ? null : lifecycleReplacedById.trim();
    if (replaced === id) {
      alert("Replacement cannot be the same item.");
      return;
    }
    setLifecycleSaving(true);
    const table = lifecycleTable(entity);
    const { error } = await supabase
      .from(table)
      .update({
        status: "deprecated",
        deprecated_at: new Date().toISOString(),
        deprecated_reason: reason.length > 0 ? reason : null,
        replaced_by_id: replaced,
        is_active: true,
      })
      .eq("id", id)
      .eq("organisation_id", activeOrgId);
    setLifecycleSaving(false);
    if (error) {
      console.error(error);
      alert(error.message || "Could not deprecate.");
      return;
    }
    setLifecycleModal(null);
    setLifecycleReason("");
    setLifecycleReplacedById("");
    await Promise.all([
      reloadPracticesForOrg(activeOrgId),
      reloadSubjectsForOrg(activeOrgId),
      reloadCompetenciesForOrg(activeOrgId),
    ]);
  }

  async function runArchiveEntity(
    entity: "practice" | "subject" | "competency",
    id: string
  ) {
    if (activeOrgId === null || !canArchiveEntity) return;
    const table = lifecycleTable(entity);
    const { error } = await supabase
      .from(table)
      .update({
        status: "archived",
        is_active: false,
        deprecated_at: null,
        deprecated_reason: null,
        replaced_by_id: null,
      })
      .eq("id", id)
      .eq("organisation_id", activeOrgId);
    if (error) {
      console.error(error);
      alert(error.message || "Could not archive.");
      return;
    }
    await Promise.all([
      reloadPracticesForOrg(activeOrgId),
      reloadSubjectsForOrg(activeOrgId),
      reloadCompetenciesForOrg(activeOrgId),
    ]);
  }

  async function runRestoreEntity(
    entity: "practice" | "subject" | "competency",
    id: string
  ) {
    if (activeOrgId === null) return;
    const table = lifecycleTable(entity);
    const { error } = await supabase
      .from(table)
      .update({
        status: "active",
        is_active: true,
        deprecated_at: null,
        deprecated_reason: null,
        replaced_by_id: null,
      })
      .eq("id", id)
      .eq("organisation_id", activeOrgId);
    if (error) {
      console.error(error);
      alert(error.message || "Could not restore.");
      return;
    }
    await Promise.all([
      reloadPracticesForOrg(activeOrgId),
      reloadSubjectsForOrg(activeOrgId),
      reloadCompetenciesForOrg(activeOrgId),
    ]);
  }

  function renderLifecycleBadge(status: string | undefined) {
    const s = parseLifecycleStatus(status);
    if (s === "active") return null;
    const label = s === "deprecated" ? "Deprecated" : "Archived";
    return (
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          padding: "3px 8px",
          borderRadius: 5,
          border: `1px solid ${border}`,
          color: s === "deprecated" ? "#d4a84b" : mutedColor,
          backgroundColor:
            s === "deprecated"
              ? "rgba(212, 168, 75, 0.12)"
              : "rgba(255,255,255,0.04)",
        }}
      >
        {label}
      </span>
    );
  }

  function renderNewCompetencyForm(
    marginTop: number,
    opts?: {
      variant?: "default" | "inline";
      nameInputRef?: RefObject<HTMLInputElement | null>;
    }
  ) {
    const variant = opts?.variant ?? "default";
    const nameInputRef = opts?.nameInputRef;
    const isInline = variant === "inline";

    const formStyle = isInline
      ? {
          marginTop: 0,
          padding: "16px 18px",
          borderRadius: 10,
          backgroundColor: "rgba(110, 176, 240, 0.07)",
          border: "1px solid rgba(110, 176, 240, 0.38)",
          boxShadow:
            "0 8px 32px rgba(0, 0, 0, 0.32), 0 0 0 1px rgba(110, 176, 240, 0.15)",
          display: "grid" as const,
          gap: 12,
        }
      : {
          marginTop,
          padding: "14px 14px",
          borderRadius: 8,
          backgroundColor: bg,
          border: `1px solid ${border}`,
          display: "grid" as const,
          gap: 12,
        };

    return (
      <form onSubmit={handleSaveNewCompetency} style={formStyle}>
        {isInline ? (
          <p
            style={{
              margin: 0,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: accent,
            }}
          >
            New competency in this subject
          </p>
        ) : null}
        {competencyFormSubjectHint != null ? (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              backgroundColor: "rgba(110, 176, 240, 0.08)",
              border: `1px solid rgba(110, 176, 240, 0.22)`,
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: text,
                lineHeight: 1.45,
              }}
            >
              <span style={{ fontWeight: 600 }}>Adding to:</span>{" "}
              {competencyFormSubjectHint}
            </p>
            <p
              style={{
                ...muted,
                margin: "6px 0 0",
                fontSize: 12,
                lineHeight: 1.4,
              }}
            >
              Pick a different subject below if you need to override.
            </p>
          </div>
        ) : null}
        <label
          style={{
            display: "grid",
            gap: 6,
            fontSize: 13,
            color: mutedColor,
          }}
        >
          Name
          <input
            ref={nameInputRef}
            required
            value={newCompetencyName}
            onChange={(e) => setNewCompetencyName(e.target.value)}
            disabled={
              isSavingCompetency ||
              isSavingLevel ||
              isSavingSubject ||
              isSavingEditCompetency ||
              isSavingEditSubject ||
              isSavingPractice
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
          Description (optional)
          <textarea
            value={newCompetencyDescription}
            onChange={(e) => setNewCompetencyDescription(e.target.value)}
            disabled={
              isSavingCompetency ||
              isSavingLevel ||
              isSavingSubject ||
              isSavingEditCompetency ||
              isSavingEditSubject ||
              isSavingPractice
            }
            rows={3}
            style={{
              padding: "10px 12px",
              fontSize: 15,
              color: text,
              backgroundColor: surface,
              border: `1px solid ${border}`,
              borderRadius: 8,
              fontFamily: "inherit",
              resize: "vertical" as const,
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
            value={newCompetencySubjectId}
            onChange={(e) => setNewCompetencySubjectId(e.target.value)}
            disabled={
              isSavingCompetency ||
              isSavingLevel ||
              isSavingSubject ||
              isSavingEditCompetency ||
              isSavingEditSubject ||
              isSavingPractice
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
            <option value="">Unassigned</option>
            {assignableSubjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
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
              isSavingCompetency ||
              isSavingLevel ||
              isSavingSubject ||
              isSavingEditCompetency ||
              isSavingEditSubject ||
              isSavingPractice
            }
            style={btn}
          >
            {isSavingCompetency ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            disabled={
              isSavingCompetency ||
              isSavingLevel ||
              isSavingSubject ||
              isSavingEditCompetency ||
              isSavingEditSubject ||
              isSavingPractice
            }
            onClick={handleCancelCreateCompetency}
            style={btn}
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <>
      {!activeOrgId ? (
        <div style={panelShell}>
          <p style={{ margin: 0 }}>No workspaces yet.</p>
        </div>
      ) : (
        <div style={panelShell}>
                      {competenciesLoading ? (
                        <p style={{ margin: 0 }}>Loading competencies...</p>
                      ) : competenciesError ? (
                        <p style={{ margin: 0, color: errorColor }}>
                          {competenciesError}
                        </p>
                      ) : (
                      <>
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            alignItems: "center",
                            gap: 12,
                            marginBottom: 14,
                            padding: "12px 14px",
                            borderRadius: 8,
                            border: `1px solid ${border}`,
                            backgroundColor: bg,
                          }}
                        >
                          <label
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              fontSize: 13,
                              color: mutedColor,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={showArchivedEntities}
                              onChange={(e) =>
                                setShowArchivedEntities(e.target.checked)
                              }
                            />
                            Show archived
                          </label>
                          <label
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              fontSize: 13,
                              color: mutedColor,
                            }}
                          >
                            View
                            <select
                              value={lifecycleViewFilter}
                              onChange={(e) =>
                                setLifecycleViewFilter(
                                  e.target.value as LifecycleViewFilter
                                )
                              }
                              style={{
                                padding: "6px 10px",
                                fontSize: 13,
                                borderRadius: 6,
                                border: `1px solid ${border}`,
                                backgroundColor: surface,
                                color: text,
                              }}
                            >
                              <option value="all">All</option>
                              <option value="active">Active only</option>
                              <option value="deprecated">Deprecated only</option>
                              <option value="archived">Archived only</option>
                            </select>
                          </label>
                        </div>

                        <button
                          type="button"
                          onClick={openPracticeGenModal}
                          disabled={
                            isSavingPractice ||
                            isSavingSubject ||
                            isSavingCompetency ||
                            isSavingLevel ||
                            isSavingEditCompetency ||
                            isSavingEditSubject
                          }
                          style={{
                            ...btnSecondary,
                            marginTop: 0,
                            marginBottom: 0,
                            width: "100%",
                            boxSizing: "border-box" as const,
                          }}
                        >
                          Generate Practice Model
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setShowCreatePracticeForm((s) => !s)
                          }
                          disabled={
                            isSavingPractice ||
                            isSavingSubject ||
                            isSavingCompetency ||
                            isSavingLevel ||
                            isSavingEditCompetency ||
                            isSavingEditSubject
                          }
                          style={{
                            ...btn,
                            marginTop: 14,
                            marginBottom: 0,
                            width: "100%",
                            boxSizing: "border-box" as const,
                          }}
                        >
                          Add Practice
                        </button>

                        {showCreatePracticeForm && (
                          <form
                            onSubmit={(e) => void handleSaveNewPractice(e)}
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
                              Name
                              <input
                                required
                                value={newPracticeName}
                                onChange={(e) =>
                                  setNewPracticeName(e.target.value)
                                }
                                disabled={isSavingPractice}
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
                              Description (optional)
                              <textarea
                                value={newPracticeDescription}
                                onChange={(e) =>
                                  setNewPracticeDescription(e.target.value)
                                }
                                disabled={isSavingPractice}
                                rows={2}
                                style={{
                                  padding: "10px 12px",
                                  fontSize: 15,
                                  color: text,
                                  backgroundColor: surface,
                                  border: `1px solid ${border}`,
                                  borderRadius: 8,
                                  fontFamily: "inherit",
                                  resize: "vertical" as const,
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
                                disabled={isSavingPractice}
                                style={btn}
                              >
                                {isSavingPractice ? "Saving..." : "Save"}
                              </button>
                              <button
                                type="button"
                                disabled={isSavingPractice}
                                onClick={handleCancelCreatePractice}
                                style={btn}
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            setShowCreateSubjectForm((s) => !s)
                          }
                          disabled={
                            isSavingPractice ||
                            isSavingSubject ||
                            isSavingCompetency ||
                            isSavingLevel ||
                            isSavingEditCompetency ||
                            isSavingEditSubject
                          }
                          style={{
                            ...btn,
                            marginTop: 14,
                            marginBottom: 0,
                            width: "100%",
                            boxSizing: "border-box" as const,
                          }}
                        >
                          Add Subject
                        </button>

                        {showCreateSubjectForm && (
                          <form
                            onSubmit={(e) => void handleSaveNewSubject(e)}
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
                              Name
                              <input
                                required
                                value={newSubjectName}
                                onChange={(e) =>
                                  setNewSubjectName(e.target.value)
                                }
                                disabled={isSavingSubject}
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
                              Description (optional)
                              <textarea
                                value={newSubjectDescription}
                                onChange={(e) =>
                                  setNewSubjectDescription(e.target.value)
                                }
                                disabled={isSavingSubject}
                                rows={2}
                                style={{
                                  padding: "10px 12px",
                                  fontSize: 15,
                                  color: text,
                                  backgroundColor: surface,
                                  border: `1px solid ${border}`,
                                  borderRadius: 8,
                                  fontFamily: "inherit",
                                  resize: "vertical" as const,
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
                              Category (optional)
                              <input
                                value={newSubjectCategory}
                                onChange={(e) =>
                                  setNewSubjectCategory(e.target.value)
                                }
                                disabled={isSavingSubject}
                                placeholder="e.g. Practice, Organisation"
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
                              Practice (optional)
                              <select
                                value={newSubjectPracticeId}
                                onChange={(e) =>
                                  setNewSubjectPracticeId(e.target.value)
                                }
                                disabled={isSavingSubject}
                                style={{
                                  padding: "10px 12px",
                                  fontSize: 15,
                                  color: text,
                                  backgroundColor: surface,
                                  border: `1px solid ${border}`,
                                  borderRadius: 8,
                                }}
                              >
                                <option value="">Unassigned Practice</option>
                                {assignablePractices.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                              </select>
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
                                disabled={isSavingSubject}
                                style={btn}
                              >
                                {isSavingSubject ? "Saving..." : "Save"}
                              </button>
                              <button
                                type="button"
                                disabled={isSavingSubject}
                                onClick={handleCancelCreateSubject}
                                style={btn}
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        )}

                        <button
                          type="button"
                          onClick={handleOpenGenericAddCompetency}
                          disabled={
                            isSavingPractice ||
                            isSavingCompetency ||
                            isSavingLevel ||
                            isSavingSubject ||
                            isSavingEditCompetency ||
                            isSavingEditSubject
                          }
                          style={{
                            ...btn,
                            marginTop: 14,
                            marginBottom: 0,
                            width: "100%",
                            boxSizing: "border-box" as const,
                          }}
                        >
                          + Add Competency
                        </button>

                        {showCreateCompetencyForm && renderNewCompetencyForm(14)}

                        <div
                          style={{
                            marginTop: 14,
                            display: "flex",
                            flexDirection: "column",
                            gap: 24,
                          }}
                        >
                          {managementPracticeGroups.map((practice) => {
                            const practiceRow = practice.isUnassigned
                              ? null
                              : practices.find((p) => p.id === practice.key);
                            const practiceLife = practiceRow
                              ? parseLifecycleStatus(practiceRow.status)
                              : null;
                            return (
                            <div
                              key={practice.key}
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 12,
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  width: "100%",
                                  boxSizing: "border-box",
                                  borderRadius: 8,
                                  backgroundColor: surface,
                                  border: `1px solid ${border}`,
                                  overflow: "hidden",
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    togglePracticeAccordion(practice.key)
                                  }
                                  aria-expanded={isPracticeAccordionExpanded(
                                    practice.key
                                  )}
                                  style={{
                                    flex: 1,
                                    minWidth: 0,
                                    boxSizing: "border-box",
                                    padding: "12px 14px",
                                    border: "none",
                                    borderRadius: 0,
                                    backgroundColor: "transparent",
                                    cursor: "pointer",
                                    textAlign: "left",
                                    display: "flex",
                                    alignItems: "flex-start",
                                    justifyContent: "space-between",
                                    gap: 12,
                                    font: "inherit",
                                    color: text,
                                  }}
                                >
                                  <div style={{ minWidth: 0, flex: 1 }}>
                                    <p
                                      style={{
                                        margin: 0,
                                        fontSize: 11,
                                        fontWeight: 600,
                                        letterSpacing: "0.08em",
                                        textTransform: "uppercase",
                                        color: mutedColor,
                                      }}
                                    >
                                      Practice
                                    </p>
                                    <div
                                      style={{
                                        marginTop: 6,
                                        display: "flex",
                                        flexWrap: "wrap",
                                        alignItems: "center",
                                        gap: "6px 8px",
                                      }}
                                    >
                                      <div
                                        style={{
                                          fontWeight: 700,
                                          fontSize: 16,
                                          color: text,
                                          letterSpacing: "-0.02em",
                                        }}
                                      >
                                        {practice.title}
                                      </div>
                                      {practiceRow
                                        ? renderLifecycleBadge(
                                            practiceRow.status
                                          )
                                        : null}
                                    </div>
                                    {practice.description ? (
                                      <p
                                        style={{
                                          margin: "8px 0 0",
                                          fontSize: 13,
                                          color: mutedColor,
                                          lineHeight: 1.5,
                                        }}
                                      >
                                        {practice.description}
                                      </p>
                                    ) : null}
                                  </div>
                                  <span
                                    aria-hidden
                                    style={{
                                      flexShrink: 0,
                                      fontSize: 12,
                                      color: mutedColor,
                                      lineHeight: 1.2,
                                      marginTop: 2,
                                      transform: isPracticeAccordionExpanded(
                                        practice.key
                                      )
                                        ? "rotate(90deg)"
                                        : "rotate(0deg)",
                                      transition: "transform 0.22s ease",
                                    }}
                                  >
                                    ▶
                                  </span>
                                </button>
                                {practiceRow ? (
                                  <div
                                    style={{
                                      display: "flex",
                                      flexDirection: "column",
                                      justifyContent: "center",
                                      gap: 6,
                                      padding: "8px 10px",
                                      borderLeft: `1px solid ${border}`,
                                      flexShrink: 0,
                                    }}
                                  >
                                    {practiceLife === "active" ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setLifecycleModal({
                                            kind: "deprecate",
                                            entity: "practice",
                                            id: practiceRow.id,
                                            label: practice.title,
                                          });
                                          setLifecycleReason("");
                                          setLifecycleReplacedById("");
                                        }}
                                        disabled={lifecycleSaving}
                                        style={{
                                          ...btnGhost,
                                          fontSize: 12,
                                          padding: "6px 10px",
                                        }}
                                      >
                                        Deprecate
                                      </button>
                                    ) : null}
                                    {practiceLife === "deprecated" ||
                                    practiceLife === "archived" ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void runRestoreEntity(
                                            "practice",
                                            practiceRow.id
                                          )
                                        }
                                        disabled={lifecycleSaving}
                                        style={{
                                          ...btnGhost,
                                          fontSize: 12,
                                          padding: "6px 10px",
                                        }}
                                      >
                                        Restore
                                      </button>
                                    ) : null}
                                    {canArchiveEntity &&
                                    practiceLife !== "archived" ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (
                                            !window.confirm(
                                              "Archive this practice? It will be hidden from normal lists until you turn on “Show archived” and restore it."
                                            )
                                          ) {
                                            return;
                                          }
                                          void runArchiveEntity(
                                            "practice",
                                            practiceRow.id
                                          );
                                        }}
                                        disabled={lifecycleSaving}
                                        style={{
                                          ...btnGhost,
                                          fontSize: 12,
                                          padding: "6px 10px",
                                        }}
                                      >
                                        Archive
                                      </button>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                              <AccordionCollapsible
                                open={isPracticeAccordionExpanded(practice.key)}
                              >
                                <div
                                  style={{
                                    paddingLeft: 14,
                                    borderLeft: `2px solid ${borderSubtle}`,
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 24,
                                  }}
                                >
                          {practice.subjectSections.map((section) => {
                            const sectionKey =
                              String(section.key ?? "").trim() ||
                              UNASSIGNED_SUBJECT_KEY;
                            const sectionTitle = section.isUnassigned
                              ? "Unassigned"
                              : section.title?.trim() || "Subject";
                            const sectionItems = Array.isArray(section.items)
                              ? section.items
                              : [];
                            const subjRow = section.isUnassigned
                              ? null
                              : subjects.find((s) => s.id === sectionKey);
                            const subjLife = subjRow
                              ? parseLifecycleStatus(subjRow.status)
                              : null;
                            const dimOtherSubjects =
                              inlineCompetencySectionKey !== null &&
                              inlineCompetencySectionKey !== sectionKey;
                            const isEditingThisSubject =
                              editingSubjectId === sectionKey &&
                              !section.isUnassigned;
                            return (
                              <div
                                key={sectionKey}
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 24,
                                  opacity: dimOtherSubjects ? 0.68 : 1,
                                  transition: "opacity 0.22s ease",
                                }}
                              >
                                {isEditingThisSubject ? (
                                  <div
                                    style={{
                                      display: "flex",
                                      flexDirection: "column",
                                      gap: 24,
                                    }}
                                  >
                                    <form
                                      onSubmit={(e) =>
                                        void handleSaveEditSubject(e)
                                      }
                                      style={{
                                        padding: "14px 14px",
                                        borderRadius: 8,
                                        backgroundColor: surface,
                                        border: `1px solid ${border}`,
                                        display: "grid",
                                        gap: 12,
                                      }}
                                    >
                                      <p
                                        style={{
                                          margin: 0,
                                          fontSize: 11,
                                          fontWeight: 600,
                                          letterSpacing: "0.08em",
                                          textTransform: "uppercase",
                                          color: mutedColor,
                                        }}
                                      >
                                        Edit subject
                                      </p>
                                      <label
                                        style={{
                                          display: "grid",
                                          gap: 6,
                                          fontSize: 13,
                                          color: mutedColor,
                                        }}
                                      >
                                        Name
                                        <input
                                          required
                                          value={editSubjectName}
                                          onChange={(e) =>
                                            setEditSubjectName(e.target.value)
                                          }
                                          disabled={isSavingEditSubject}
                                          style={{
                                            padding: "10px 12px",
                                            fontSize: 15,
                                            color: text,
                                            backgroundColor: bg,
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
                                        Description (optional)
                                        <textarea
                                          value={editSubjectDescription}
                                          onChange={(e) =>
                                            setEditSubjectDescription(
                                              e.target.value
                                            )
                                          }
                                          disabled={isSavingEditSubject}
                                          rows={2}
                                          style={{
                                            padding: "10px 12px",
                                            fontSize: 15,
                                            color: text,
                                            backgroundColor: bg,
                                            border: `1px solid ${border}`,
                                            borderRadius: 8,
                                            fontFamily: "inherit",
                                            resize: "vertical" as const,
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
                                        Category (optional)
                                        <input
                                          value={editSubjectCategory}
                                          onChange={(e) =>
                                            setEditSubjectCategory(
                                              e.target.value
                                            )
                                          }
                                          disabled={isSavingEditSubject}
                                          placeholder="e.g. Practice, Organisation"
                                          style={{
                                            padding: "10px 12px",
                                            fontSize: 15,
                                            color: text,
                                            backgroundColor: bg,
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
                                        Practice (optional)
                                        <select
                                          value={editSubjectPracticeId}
                                          onChange={(e) =>
                                            setEditSubjectPracticeId(
                                              e.target.value
                                            )
                                          }
                                          disabled={isSavingEditSubject}
                                          style={{
                                            padding: "10px 12px",
                                            fontSize: 15,
                                            color: text,
                                            backgroundColor: bg,
                                            border: `1px solid ${border}`,
                                            borderRadius: 8,
                                          }}
                                        >
                                          <option value="">
                                            Unassigned Practice
                                          </option>
                                          {assignablePractices.map((p) => (
                                            <option key={p.id} value={p.id}>
                                              {p.name}
                                            </option>
                                          ))}
                                        </select>
                                      </label>
                                      <div
                                        style={{
                                          display: "flex",
                                          flexWrap: "wrap",
                                          gap: 10,
                                        }}
                                      >
                                        <button
                                          type="submit"
                                          disabled={isSavingEditSubject}
                                          style={btnPrimary}
                                        >
                                          {isSavingEditSubject
                                            ? "Saving..."
                                            : "Save subject"}
                                        </button>
                                        <button
                                          type="button"
                                          disabled={isSavingEditSubject}
                                          onClick={handleCancelEditSubject}
                                          style={btn}
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </form>
                                    <AccordionCollapsible
                                      open={isSubjectAccordionExpanded(
                                        practice.key,
                                        sectionKey,
                                        sectionKey
                                      )}
                                    >
                                      <div
                                        style={{
                                          display: "flex",
                                          flexDirection: "column",
                                          gap: 24,
                                          padding: "0 14px 14px",
                                        }}
                                      >
                                        {inlineCompetencySectionKey ===
                                        sectionKey ? (
                                          <div ref={inlineFormAnchorRef}>
                                            {renderNewCompetencyForm(0, {
                                              variant: "inline",
                                              nameInputRef: inlineNameInputRef,
                                            })}
                                          </div>
                                        ) : null}
                                        {sectionItems.length === 0 ? (
                                          <div
                                            style={{
                                              padding: "14px 14px",
                                              borderRadius: 8,
                                              border: `1px solid ${border}`,
                                              backgroundColor: bg,
                                            }}
                                          >
                                            <p
                                              style={{
                                                ...muted,
                                                margin: 0,
                                                fontSize: 13,
                                              }}
                                            >
                                              No competencies added yet
                                            </p>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleAddCompetencyToSubject(
                                                  section.isUnassigned
                                                    ? ""
                                                    : sectionKey,
                                                  sectionTitle,
                                                  sectionKey
                                                )
                                              }
                                              disabled={
                                                isSavingCompetency ||
                                                isSavingLevel ||
                                                isSavingSubject ||
                                                isSavingEditCompetency ||
                                                isSavingEditSubject
                                              }
                                              style={{
                                                ...btnPrimary,
                                                marginTop: 12,
                                                width: "100%",
                                                boxSizing: "border-box" as const,
                                              }}
                                            >
                                              Add competency to this subject
                                            </button>
                                            {section.isUnassigned ? null : (
                                              <p
                                                style={{
                                                  ...muted,
                                                  margin: "10px 0 0",
                                                  fontSize: 12,
                                                  lineHeight: 1.45,
                                                }}
                                              >
                                                You&apos;ll be able to generate
                                                starter competencies for a
                                                subject in a future update.
                                              </p>
                                            )}
                                          </div>
                                        ) : (
                                          <ul
                                            style={{
                                              margin: 0,
                                              padding: 0,
                                              listStyle: "none",
                                              display: "flex",
                                              flexDirection: "column",
                                              gap: 16,
                                            }}
                                          >
                                            {sectionItems.map((c) => (
                                              <li
                                                key={c.id}
                                                id={`comp-row-${c.id}`}
                                                style={{
                                                  padding: "12px 14px",
                                                  borderRadius: 8,
                                                  backgroundColor:
                                                    highlightCompetencyId ===
                                                    c.id
                                                      ? "rgba(110, 176, 240, 0.14)"
                                                      : surface,
                                                  border:
                                                    highlightCompetencyId ===
                                                    c.id
                                                      ? "1px solid rgba(110, 176, 240, 0.5)"
                                                      : `1px solid ${border}`,
                                                  boxShadow:
                                                    highlightCompetencyId ===
                                                    c.id
                                                      ? "0 0 0 1px rgba(110, 176, 240, 0.2)"
                                                      : undefined,
                                                  transition:
                                                    "background-color 0.35s ease, border-color 0.35s ease, box-shadow 0.35s ease",
                                                }}
                                              >
                                                {editingCompetencyId ===
                                                c.id ? (
                                                  <form
                                                    onSubmit={(e) =>
                                                      void handleSaveEditCompetency(
                                                        e
                                                      )
                                                    }
                                                    style={{
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
                                                      Name
                                                      <input
                                                        required
                                                        value={
                                                          editCompetencyName
                                                        }
                                                        onChange={(e) =>
                                                          setEditCompetencyName(
                                                            e.target.value
                                                          )
                                                        }
                                                        disabled={
                                                          isSavingEditCompetency
                                                        }
                                                        style={{
                                                          padding:
                                                            "10px 12px",
                                                          fontSize: 15,
                                                          color: text,
                                                          backgroundColor: bg,
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
                                                      Description (optional)
                                                      <textarea
                                                        value={
                                                          editCompetencyDescription
                                                        }
                                                        onChange={(e) =>
                                                          setEditCompetencyDescription(
                                                            e.target.value
                                                          )
                                                        }
                                                        disabled={
                                                          isSavingEditCompetency
                                                        }
                                                        rows={3}
                                                        style={{
                                                          padding:
                                                            "10px 12px",
                                                          fontSize: 15,
                                                          color: text,
                                                          backgroundColor: bg,
                                                          border: `1px solid ${border}`,
                                                          borderRadius: 8,
                                                          fontFamily: "inherit",
                                                          resize:
                                                            "vertical" as const,
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
                                                        value={
                                                          editCompetencySubjectId
                                                        }
                                                        onChange={(e) =>
                                                          setEditCompetencySubjectId(
                                                            e.target.value
                                                          )
                                                        }
                                                        disabled={
                                                          isSavingEditCompetency
                                                        }
                                                        style={{
                                                          padding:
                                                            "10px 12px",
                                                          fontSize: 15,
                                                          color: text,
                                                          backgroundColor: bg,
                                                          border: `1px solid ${border}`,
                                                          borderRadius: 8,
                                                        }}
                                                      >
                                                        <option value="">
                                                          Unassigned
                                                        </option>
                                                        {assignableSubjects.map((s) => (
                                                          <option
                                                            key={s.id}
                                                            value={s.id}
                                                          >
                                                            {s.name}
                                                          </option>
                                                        ))}
                                                      </select>
                                                    </label>
                                                    <div
                                                      style={{
                                                        display: "flex",
                                                        flexWrap: "wrap",
                                                        gap: 10,
                                                      }}
                                                    >
                                                      <button
                                                        type="submit"
                                                        disabled={
                                                          isSavingEditCompetency
                                                        }
                                                        style={btn}
                                                      >
                                                        {isSavingEditCompetency
                                                          ? "Saving..."
                                                          : "Save"}
                                                      </button>
                                                      <button
                                                        type="button"
                                                        disabled={
                                                          isSavingEditCompetency
                                                        }
                                                        onClick={
                                                          handleCancelEditCompetency
                                                        }
                                                        style={btn}
                                                      >
                                                        Cancel
                                                      </button>
                                                    </div>
                                                  </form>
                                                ) : (
                                                  <div
                                                    style={{
                                                      display: "flex",
                                                      alignItems: "flex-start",
                                                      justifyContent:
                                                        "space-between",
                                                      gap: 10,
                                                    }}
                                                  >
                                                    <div
                                                      style={{ minWidth: 0 }}
                                                    >
                                                      <div
                                                        style={{
                                                          display: "flex",
                                                          flexWrap: "wrap",
                                                          alignItems: "center",
                                                          gap: "6px 8px",
                                                        }}
                                                      >
                                                        <span
                                                          style={{
                                                            fontWeight: 600,
                                                            color: text,
                                                            fontSize: 15,
                                                          }}
                                                        >
                                                          {c.name}
                                                        </span>
                                                        {renderLifecycleBadge(
                                                          c.status
                                                        )}
                                                      </div>
                                                      {c.description != null &&
                                                      c.description.trim() !==
                                                        "" ? (
                                                        <div
                                                          style={{
                                                            marginTop: 6,
                                                            fontSize: 13,
                                                            color: mutedColor,
                                                            lineHeight: 1.45,
                                                          }}
                                                        >
                                                          {c.description}
                                                        </div>
                                                      ) : null}
                                                    </div>
                                                    <div
                                                      style={{
                                                        display: "flex",
                                                        flexShrink: 0,
                                                        flexWrap: "wrap",
                                                        gap: 8,
                                                        justifyContent:
                                                          "flex-end",
                                                      }}
                                                    >
                                                      <button
                                                        type="button"
                                                        onClick={() =>
                                                          handleStartEditCompetency(
                                                            c
                                                          )
                                                        }
                                                        disabled={
                                                          isSavingCompetency ||
                                                          isSavingLevel ||
                                                          isSavingSubject ||
                                                          isSavingEditCompetency ||
                                                          isSavingEditSubject
                                                        }
                                                        style={{
                                                          ...btn,
                                                          padding:
                                                            "6px 12px",
                                                          fontSize: 13,
                                                        }}
                                                      >
                                                        Edit
                                                      </button>
                                                      <button
                                                        type="button"
                                                        onClick={() =>
                                                          handleToggleManageLevels(
                                                            c.id
                                                          )
                                                        }
                                                        disabled={
                                                          isSavingCompetency ||
                                                          isSavingLevel ||
                                                          isSavingSubject ||
                                                          isSavingEditCompetency ||
                                                          isSavingEditSubject
                                                        }
                                                        style={{
                                                          ...btn,
                                                          padding:
                                                            "6px 12px",
                                                          fontSize: 13,
                                                        }}
                                                      >
                                                        {expandedCompetencyId ===
                                                        c.id
                                                          ? "Hide levels"
                                                          : "Manage Levels"}
                                                      </button>
                                                      {parseLifecycleStatus(
                                                        c.status
                                                      ) === "active" ? (
                                                        <button
                                                          type="button"
                                                          onClick={() => {
                                                            setLifecycleModal({
                                                              kind: "deprecate",
                                                              entity:
                                                                "competency",
                                                              id: c.id,
                                                              label: c.name,
                                                            });
                                                            setLifecycleReason(
                                                              ""
                                                            );
                                                            setLifecycleReplacedById(
                                                              ""
                                                            );
                                                          }}
                                                          disabled={
                                                            lifecycleSaving
                                                          }
                                                          style={{
                                                            ...btnGhost,
                                                            padding:
                                                              "6px 12px",
                                                            fontSize: 13,
                                                          }}
                                                        >
                                                          Deprecate
                                                        </button>
                                                      ) : null}
                                                      {parseLifecycleStatus(
                                                        c.status
                                                      ) === "deprecated" ||
                                                      parseLifecycleStatus(
                                                        c.status
                                                      ) === "archived" ? (
                                                        <button
                                                          type="button"
                                                          onClick={() =>
                                                            void runRestoreEntity(
                                                              "competency",
                                                              c.id
                                                            )
                                                          }
                                                          disabled={
                                                            lifecycleSaving
                                                          }
                                                          style={{
                                                            ...btnGhost,
                                                            padding:
                                                              "6px 12px",
                                                            fontSize: 13,
                                                          }}
                                                        >
                                                          Restore
                                                        </button>
                                                      ) : null}
                                                      {canArchiveEntity &&
                                                      parseLifecycleStatus(
                                                        c.status
                                                      ) !== "archived" ? (
                                                        <button
                                                          type="button"
                                                          onClick={() => {
                                                            if (
                                                              !window.confirm(
                                                                "Archive this competency? It will be hidden from normal lists until you turn on “Show archived” and restore it."
                                                              )
                                                            ) {
                                                              return;
                                                            }
                                                            void runArchiveEntity(
                                                              "competency",
                                                              c.id
                                                            );
                                                          }}
                                                          disabled={
                                                            lifecycleSaving
                                                          }
                                                          style={{
                                                            ...btnGhost,
                                                            padding:
                                                              "6px 12px",
                                                            fontSize: 13,
                                                          }}
                                                        >
                                                          Archive
                                                        </button>
                                                      ) : null}
                                                    </div>
                                                  </div>
                                                )}
                                                {expandedCompetencyId ===
                                                  c.id && (
                                                  <div
                                                    style={{
                                                      marginTop: 12,
                                                      paddingTop: 12,
                                                      borderTop: `1px solid ${border}`,
                                                    }}
                                                  >
                                                    {levelDefinitionsLoading ? (
                                                      <p
                                                        style={{
                                                          margin: 0,
                                                          fontSize: 13,
                                                          color: mutedColor,
                                                        }}
                                                      >
                                                        Loading level
                                                        definitions...
                                                      </p>
                                                    ) : levelDefinitions.length ===
                                                      0 ? (
                                                      <p
                                                        style={{
                                                          margin: 0,
                                                          fontSize: 13,
                                                          color: mutedColor,
                                                        }}
                                                      >
                                                        No level definitions yet
                                                      </p>
                                                    ) : (
                                                      <ul
                                                        style={{
                                                          margin: 0,
                                                          padding: 0,
                                                          listStyle: "none",
                                                          display: "flex",
                                                          flexDirection:
                                                            "column",
                                                          gap: 8,
                                                        }}
                                                      >
                                                        {levelDefinitions.map(
                                                          (ld) => (
                                                            <li
                                                              key={ld.id}
                                                              style={{
                                                                padding:
                                                                  "10px 12px",
                                                                borderRadius: 6,
                                                                backgroundColor:
                                                                  bg,
                                                                border: `1px solid ${border}`,
                                                              }}
                                                            >
                                                              <div
                                                                style={{
                                                                  fontWeight: 600,
                                                                  color: text,
                                                                  fontSize: 14,
                                                                }}
                                                              >
                                                                {ld.level_name}
                                                              </div>
                                                              <div
                                                                style={{
                                                                  marginTop: 4,
                                                                  fontSize: 12,
                                                                  color:
                                                                    mutedColor,
                                                                }}
                                                              >
                                                                Order:{" "}
                                                                {ld.level_order}
                                                              </div>
                                                              {ld.description !=
                                                                null &&
                                                              ld.description.trim() !==
                                                                "" ? (
                                                                <div
                                                                  style={{
                                                                    marginTop: 6,
                                                                    fontSize: 13,
                                                                    color:
                                                                      mutedColor,
                                                                    lineHeight: 1.45,
                                                                  }}
                                                                >
                                                                  {
                                                                    ld.description
                                                                  }
                                                                </div>
                                                              ) : null}
                                                            </li>
                                                          )
                                                        )}
                                                      </ul>
                                                    )}
                                                    {showCreateLevelFormForCompetencyId ===
                                                    c.id ? (
                                                      <form
                                                        onSubmit={(e) => {
                                                          void handleSaveNewLevelDefinition(
                                                            e,
                                                            c.id
                                                          );
                                                        }}
                                                        style={{
                                                          marginTop: 12,
                                                          padding:
                                                            "12px 12px",
                                                          borderRadius: 8,
                                                          backgroundColor:
                                                            surface,
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
                                                          Level Name
                                                          <input
                                                            required
                                                            value={newLevelName}
                                                            onChange={(e) =>
                                                              setNewLevelName(
                                                                e.target.value
                                                              )
                                                            }
                                                            disabled={
                                                              isSavingLevel
                                                            }
                                                            style={{
                                                              padding:
                                                                "10px 12px",
                                                              fontSize: 15,
                                                              color: text,
                                                              backgroundColor:
                                                                bg,
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
                                                          Level Order
                                                          <input
                                                            required
                                                            type="number"
                                                            value={
                                                              newLevelOrder
                                                            }
                                                            onChange={(e) =>
                                                              setNewLevelOrder(
                                                                e.target.value
                                                              )
                                                            }
                                                            disabled={
                                                              isSavingLevel
                                                            }
                                                            style={{
                                                              padding:
                                                                "10px 12px",
                                                              fontSize: 15,
                                                              color: text,
                                                              backgroundColor:
                                                                bg,
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
                                                          Description
                                                          (optional)
                                                          <textarea
                                                            value={
                                                              newLevelDescription
                                                            }
                                                            onChange={(e) =>
                                                              setNewLevelDescription(
                                                                e.target.value
                                                              )
                                                            }
                                                            disabled={
                                                              isSavingLevel
                                                            }
                                                            rows={2}
                                                            style={{
                                                              padding:
                                                                "10px 12px",
                                                              fontSize: 15,
                                                              color: text,
                                                              backgroundColor:
                                                                bg,
                                                              border: `1px solid ${border}`,
                                                              borderRadius: 8,
                                                              fontFamily:
                                                                "inherit",
                                                              resize:
                                                                "vertical" as const,
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
                                                              isSavingLevel
                                                            }
                                                            style={btn}
                                                          >
                                                            {isSavingLevel
                                                              ? "Saving..."
                                                              : "Save"}
                                                          </button>
                                                          <button
                                                            type="button"
                                                            disabled={
                                                              isSavingLevel
                                                            }
                                                            onClick={
                                                              handleCancelCreateLevelDefinition
                                                            }
                                                            style={btn}
                                                          >
                                                            Cancel
                                                          </button>
                                                        </div>
                                                      </form>
                                                    ) : (
                                                      <button
                                                        type="button"
                                                        onClick={() =>
                                                          setShowCreateLevelFormForCompetencyId(
                                                            c.id
                                                          )
                                                        }
                                                        disabled={
                                                          levelDefinitionsLoading ||
                                                          isSavingLevel
                                                        }
                                                        style={{
                                                          ...btn,
                                                          marginTop: 12,
                                                          width: "100%",
                                                          boxSizing:
                                                            "border-box" as const,
                                                        }}
                                                      >
                                                        + Add Level
                                                      </button>
                                                    )}
                                                  </div>
                                                )}
                                              </li>
                                            ))}
                                          </ul>
                                        )}
                                      </div>
                                    </AccordionCollapsible>
                                  </div>
                                ) : (
                                  <div
                                    style={{
                                      borderRadius: 8,
                                      backgroundColor: surface,
                                      border: `1px solid ${border}`,
                                      overflow: "hidden",
                                    }}
                                  >
                                    <div
                                      style={{
                                        padding: "14px 14px",
                                      }}
                                    >
                                      <div
                                        style={{
                                          display: "flex",
                                          flexWrap: "wrap",
                                          alignItems: "flex-start",
                                          gap: 12,
                                        }}
                                      >
                                        <button
                                          type="button"
                                          onClick={() =>
                                            toggleSubjectAccordion(
                                              practice.key,
                                              sectionKey
                                            )
                                          }
                                          aria-expanded={isSubjectAccordionExpanded(
                                            practice.key,
                                            sectionKey,
                                            sectionKey
                                          )}
                                          title={
                                            isSubjectAccordionExpanded(
                                              practice.key,
                                              sectionKey,
                                              sectionKey
                                            )
                                              ? "Collapse subject"
                                              : "Expand subject"
                                          }
                                          style={{
                                            flexShrink: 0,
                                            marginTop: 2,
                                            padding: "4px 6px",
                                            border: `1px solid ${border}`,
                                            borderRadius: 6,
                                            backgroundColor: bg,
                                            cursor: "pointer",
                                            font: "inherit",
                                            color: mutedColor,
                                            lineHeight: 1,
                                          }}
                                        >
                                          <span
                                            aria-hidden
                                            style={{
                                              display: "inline-block",
                                              transform:
                                                isSubjectAccordionExpanded(
                                                  practice.key,
                                                  sectionKey,
                                                  sectionKey
                                                )
                                                  ? "rotate(90deg)"
                                                  : "rotate(0deg)",
                                              transition:
                                                "transform 0.22s ease",
                                            }}
                                          >
                                            ▶
                                          </span>
                                        </button>
                                        <div
                                          style={{
                                            minWidth: 0,
                                            flex: "1 1 200px",
                                          }}
                                        >
                                          <div
                                            style={{
                                              display: "flex",
                                              flexWrap: "wrap",
                                              alignItems: "baseline",
                                              gap: "6px 8px",
                                            }}
                                          >
                                            <span
                                              style={{
                                                fontWeight: 700,
                                                fontSize: 15,
                                                color: text,
                                                letterSpacing: "-0.02em",
                                              }}
                                            >
                                              {sectionTitle}
                                            </span>
                                            <span
                                              style={{
                                                fontSize: 13,
                                                fontWeight: 500,
                                                color: mutedColor,
                                              }}
                                            >
                                              · {sectionItems.length}{" "}
                                              {sectionItems.length === 1
                                                ? "competency"
                                                : "competencies"}
                                            </span>
                                            {section.category ? (
                                              <span
                                                style={{
                                                  fontSize: 10,
                                                  fontWeight: 600,
                                                  letterSpacing: "0.06em",
                                                  textTransform: "uppercase",
                                                  padding: "3px 8px",
                                                  borderRadius: 5,
                                                  border: `1px solid ${border}`,
                                                  color: mutedColor,
                                                  backgroundColor:
                                                    "rgba(255,255,255,0.03)",
                                                }}
                                              >
                                                {section.category}
                                              </span>
                                            ) : null}
                                            {subjRow
                                              ? renderLifecycleBadge(
                                                  subjRow.status
                                                )
                                              : null}
                                          </div>
                                        </div>
                                        <div
                                          style={{
                                            display: "flex",
                                            flexWrap: "wrap",
                                            gap: 8,
                                            justifyContent: "flex-end",
                                            flexShrink: 0,
                                            alignItems: "center",
                                          }}
                                        >
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleAddCompetencyToSubject(
                                                section.isUnassigned
                                                  ? ""
                                                  : sectionKey,
                                                sectionTitle,
                                                sectionKey
                                              )
                                            }
                                            disabled={
                                              isSavingCompetency ||
                                              isSavingLevel ||
                                              isSavingSubject ||
                                              isSavingEditCompetency ||
                                              isSavingEditSubject
                                            }
                                            style={{
                                              ...btnPrimary,
                                              fontSize: 12,
                                              padding: "7px 12px",
                                            }}
                                          >
                                            + Competency
                                          </button>
                                          {!section.isUnassigned ? (
                                            <>
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  handleStartEditSubject(
                                                    section
                                                  )
                                                }
                                                disabled={
                                                  isSavingEditSubject ||
                                                  isSavingCompetency ||
                                                  isSavingLevel ||
                                                  isSavingSubject ||
                                                  isSavingEditCompetency ||
                                                  editingSubjectId !== null
                                                }
                                                style={{
                                                  ...btnSecondary,
                                                  fontSize: 12,
                                                  padding: "7px 12px",
                                                }}
                                              >
                                                Edit
                                              </button>
                                              <button
                                                type="button"
                                                disabled
                                                title="Coming in a future update"
                                                style={{
                                                  ...btnGhost,
                                                  fontSize: 12,
                                                  padding: "7px 12px",
                                                  opacity: 0.75,
                                                  cursor: "not-allowed",
                                                }}
                                              >
                                                Generate competencies
                                              </button>
                                              {subjRow ? (
                                                <>
                                                  {subjLife === "active" ? (
                                                    <button
                                                      type="button"
                                                      onClick={() => {
                                                        setLifecycleModal({
                                                          kind: "deprecate",
                                                          entity: "subject",
                                                          id: subjRow.id,
                                                          label: sectionTitle,
                                                        });
                                                        setLifecycleReason("");
                                                        setLifecycleReplacedById(
                                                          ""
                                                        );
                                                      }}
                                                      disabled={lifecycleSaving}
                                                      style={{
                                                        ...btnGhost,
                                                        fontSize: 12,
                                                        padding: "7px 12px",
                                                      }}
                                                    >
                                                      Deprecate
                                                    </button>
                                                  ) : null}
                                                  {subjLife === "deprecated" ||
                                                  subjLife === "archived" ? (
                                                    <button
                                                      type="button"
                                                      onClick={() =>
                                                        void runRestoreEntity(
                                                          "subject",
                                                          subjRow.id
                                                        )
                                                      }
                                                      disabled={lifecycleSaving}
                                                      style={{
                                                        ...btnGhost,
                                                        fontSize: 12,
                                                        padding: "7px 12px",
                                                      }}
                                                    >
                                                      Restore
                                                    </button>
                                                  ) : null}
                                                  {canArchiveEntity &&
                                                  subjLife !== "archived" ? (
                                                    <button
                                                      type="button"
                                                      onClick={() => {
                                                        if (
                                                          !window.confirm(
                                                            "Archive this subject? It will be hidden from normal lists until you turn on “Show archived” and restore it."
                                                          )
                                                        ) {
                                                          return;
                                                        }
                                                        void runArchiveEntity(
                                                          "subject",
                                                          subjRow.id
                                                        );
                                                      }}
                                                      disabled={lifecycleSaving}
                                                      style={{
                                                        ...btnGhost,
                                                        fontSize: 12,
                                                        padding: "7px 12px",
                                                      }}
                                                    >
                                                      Archive
                                                    </button>
                                                  ) : null}
                                                </>
                                              ) : null}
                                            </>
                                          ) : null}
                                        </div>
                                      </div>
                                    </div>
                                    <AccordionCollapsible
                                      open={isSubjectAccordionExpanded(
                                        practice.key,
                                        sectionKey,
                                        sectionKey
                                      )}
                                    >
                                      <div
                                        style={{
                                          display: "flex",
                                          flexDirection: "column",
                                          gap: 24,
                                          padding: "0 14px 14px",
                                        }}
                                      >
                                        {section.description ? (
                                          <p
                                            style={{
                                              margin: 0,
                                              fontSize: 13,
                                              color: mutedColor,
                                              lineHeight: 1.5,
                                            }}
                                          >
                                            {section.description}
                                          </p>
                                        ) : null}
                                        {inlineCompetencySectionKey ===
                                        sectionKey ? (
                                          <div ref={inlineFormAnchorRef}>
                                            {renderNewCompetencyForm(0, {
                                              variant: "inline",
                                              nameInputRef: inlineNameInputRef,
                                            })}
                                          </div>
                                        ) : null}
                                        {sectionItems.length === 0 ? (
                                          <div
                                            style={{
                                              padding: "14px 14px",
                                              borderRadius: 8,
                                              border: `1px solid ${border}`,
                                              backgroundColor: bg,
                                            }}
                                          >
                                            <p
                                              style={{
                                                ...muted,
                                                margin: 0,
                                                fontSize: 13,
                                              }}
                                            >
                                              No competencies added yet
                                            </p>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleAddCompetencyToSubject(
                                                  section.isUnassigned
                                                    ? ""
                                                    : sectionKey,
                                                  sectionTitle,
                                                  sectionKey
                                                )
                                              }
                                              disabled={
                                                isSavingCompetency ||
                                                isSavingLevel ||
                                                isSavingSubject ||
                                                isSavingEditCompetency ||
                                                isSavingEditSubject
                                              }
                                              style={{
                                                ...btnPrimary,
                                                marginTop: 12,
                                                width: "100%",
                                                boxSizing: "border-box" as const,
                                              }}
                                            >
                                              Add competency to this subject
                                            </button>
                                            {section.isUnassigned ? null : (
                                              <p
                                                style={{
                                                  ...muted,
                                                  margin: "10px 0 0",
                                                  fontSize: 12,
                                                  lineHeight: 1.45,
                                                }}
                                              >
                                                You&apos;ll be able to generate
                                                starter competencies for a
                                                subject in a future update.
                                              </p>
                                            )}
                                          </div>
                                        ) : (
                                          <ul
                                            style={{
                                              margin: 0,
                                              padding: 0,
                                              listStyle: "none",
                                              display: "flex",
                                              flexDirection: "column",
                                              gap: 16,
                                            }}
                                          >
                                            {sectionItems.map((c) => (
                                              <li
                                                key={c.id}
                                                id={`comp-row-${c.id}`}
                                                style={{
                                                  padding: "12px 14px",
                                                  borderRadius: 8,
                                                  backgroundColor:
                                                    highlightCompetencyId ===
                                                    c.id
                                                      ? "rgba(110, 176, 240, 0.14)"
                                                      : surface,
                                                  border:
                                                    highlightCompetencyId ===
                                                    c.id
                                                      ? "1px solid rgba(110, 176, 240, 0.5)"
                                                      : `1px solid ${border}`,
                                                  boxShadow:
                                                    highlightCompetencyId ===
                                                    c.id
                                                      ? "0 0 0 1px rgba(110, 176, 240, 0.2)"
                                                      : undefined,
                                                  transition:
                                                    "background-color 0.35s ease, border-color 0.35s ease, box-shadow 0.35s ease",
                                                }}
                                              >
                                                {editingCompetencyId ===
                                                c.id ? (
                                                  <form
                                                    onSubmit={(e) =>
                                                      void handleSaveEditCompetency(
                                                        e
                                                      )
                                                    }
                                                    style={{
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
                                                      Name
                                                      <input
                                                        required
                                                        value={
                                                          editCompetencyName
                                                        }
                                                        onChange={(e) =>
                                                          setEditCompetencyName(
                                                            e.target.value
                                                          )
                                                        }
                                                        disabled={
                                                          isSavingEditCompetency
                                                        }
                                                        style={{
                                                          padding:
                                                            "10px 12px",
                                                          fontSize: 15,
                                                          color: text,
                                                          backgroundColor: bg,
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
                                                      Description (optional)
                                                      <textarea
                                                        value={
                                                          editCompetencyDescription
                                                        }
                                                        onChange={(e) =>
                                                          setEditCompetencyDescription(
                                                            e.target.value
                                                          )
                                                        }
                                                        disabled={
                                                          isSavingEditCompetency
                                                        }
                                                        rows={3}
                                                        style={{
                                                          padding:
                                                            "10px 12px",
                                                          fontSize: 15,
                                                          color: text,
                                                          backgroundColor: bg,
                                                          border: `1px solid ${border}`,
                                                          borderRadius: 8,
                                                          fontFamily: "inherit",
                                                          resize:
                                                            "vertical" as const,
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
                                                        value={
                                                          editCompetencySubjectId
                                                        }
                                                        onChange={(e) =>
                                                          setEditCompetencySubjectId(
                                                            e.target.value
                                                          )
                                                        }
                                                        disabled={
                                                          isSavingEditCompetency
                                                        }
                                                        style={{
                                                          padding:
                                                            "10px 12px",
                                                          fontSize: 15,
                                                          color: text,
                                                          backgroundColor: bg,
                                                          border: `1px solid ${border}`,
                                                          borderRadius: 8,
                                                        }}
                                                      >
                                                        <option value="">
                                                          Unassigned
                                                        </option>
                                                        {assignableSubjects.map((s) => (
                                                          <option
                                                            key={s.id}
                                                            value={s.id}
                                                          >
                                                            {s.name}
                                                          </option>
                                                        ))}
                                                      </select>
                                                    </label>
                                                    <div
                                                      style={{
                                                        display: "flex",
                                                        flexWrap: "wrap",
                                                        gap: 10,
                                                      }}
                                                    >
                                                      <button
                                                        type="submit"
                                                        disabled={
                                                          isSavingEditCompetency
                                                        }
                                                        style={btn}
                                                      >
                                                        {isSavingEditCompetency
                                                          ? "Saving..."
                                                          : "Save"}
                                                      </button>
                                                      <button
                                                        type="button"
                                                        disabled={
                                                          isSavingEditCompetency
                                                        }
                                                        onClick={
                                                          handleCancelEditCompetency
                                                        }
                                                        style={btn}
                                                      >
                                                        Cancel
                                                      </button>
                                                    </div>
                                                  </form>
                                                ) : (
                                                  <div
                                                    style={{
                                                      display: "flex",
                                                      alignItems: "flex-start",
                                                      justifyContent:
                                                        "space-between",
                                                      gap: 10,
                                                    }}
                                                  >
                                                    <div
                                                      style={{ minWidth: 0 }}
                                                    >
                                                      <div
                                                        style={{
                                                          display: "flex",
                                                          flexWrap: "wrap",
                                                          alignItems: "center",
                                                          gap: "6px 8px",
                                                        }}
                                                      >
                                                        <span
                                                          style={{
                                                            fontWeight: 600,
                                                            color: text,
                                                            fontSize: 15,
                                                          }}
                                                        >
                                                          {c.name}
                                                        </span>
                                                        {renderLifecycleBadge(
                                                          c.status
                                                        )}
                                                      </div>
                                                      {c.description != null &&
                                                      c.description.trim() !==
                                                        "" ? (
                                                        <div
                                                          style={{
                                                            marginTop: 6,
                                                            fontSize: 13,
                                                            color: mutedColor,
                                                            lineHeight: 1.45,
                                                          }}
                                                        >
                                                          {c.description}
                                                        </div>
                                                      ) : null}
                                                    </div>
                                                    <div
                                                      style={{
                                                        display: "flex",
                                                        flexShrink: 0,
                                                        flexWrap: "wrap",
                                                        gap: 8,
                                                        justifyContent:
                                                          "flex-end",
                                                      }}
                                                    >
                                                      <button
                                                        type="button"
                                                        onClick={() =>
                                                          handleStartEditCompetency(
                                                            c
                                                          )
                                                        }
                                                        disabled={
                                                          isSavingCompetency ||
                                                          isSavingLevel ||
                                                          isSavingSubject ||
                                                          isSavingEditCompetency ||
                                                          isSavingEditSubject
                                                        }
                                                        style={{
                                                          ...btn,
                                                          padding:
                                                            "6px 12px",
                                                          fontSize: 13,
                                                        }}
                                                      >
                                                        Edit
                                                      </button>
                                                      <button
                                                        type="button"
                                                        onClick={() =>
                                                          handleToggleManageLevels(
                                                            c.id
                                                          )
                                                        }
                                                        disabled={
                                                          isSavingCompetency ||
                                                          isSavingLevel ||
                                                          isSavingSubject ||
                                                          isSavingEditCompetency ||
                                                          isSavingEditSubject
                                                        }
                                                        style={{
                                                          ...btn,
                                                          padding:
                                                            "6px 12px",
                                                          fontSize: 13,
                                                        }}
                                                      >
                                                        {expandedCompetencyId ===
                                                        c.id
                                                          ? "Hide levels"
                                                          : "Manage Levels"}
                                                      </button>
                                                      {parseLifecycleStatus(
                                                        c.status
                                                      ) === "active" ? (
                                                        <button
                                                          type="button"
                                                          onClick={() => {
                                                            setLifecycleModal({
                                                              kind: "deprecate",
                                                              entity:
                                                                "competency",
                                                              id: c.id,
                                                              label: c.name,
                                                            });
                                                            setLifecycleReason(
                                                              ""
                                                            );
                                                            setLifecycleReplacedById(
                                                              ""
                                                            );
                                                          }}
                                                          disabled={
                                                            lifecycleSaving
                                                          }
                                                          style={{
                                                            ...btnGhost,
                                                            padding:
                                                              "6px 12px",
                                                            fontSize: 13,
                                                          }}
                                                        >
                                                          Deprecate
                                                        </button>
                                                      ) : null}
                                                      {parseLifecycleStatus(
                                                        c.status
                                                      ) === "deprecated" ||
                                                      parseLifecycleStatus(
                                                        c.status
                                                      ) === "archived" ? (
                                                        <button
                                                          type="button"
                                                          onClick={() =>
                                                            void runRestoreEntity(
                                                              "competency",
                                                              c.id
                                                            )
                                                          }
                                                          disabled={
                                                            lifecycleSaving
                                                          }
                                                          style={{
                                                            ...btnGhost,
                                                            padding:
                                                              "6px 12px",
                                                            fontSize: 13,
                                                          }}
                                                        >
                                                          Restore
                                                        </button>
                                                      ) : null}
                                                      {canArchiveEntity &&
                                                      parseLifecycleStatus(
                                                        c.status
                                                      ) !== "archived" ? (
                                                        <button
                                                          type="button"
                                                          onClick={() => {
                                                            if (
                                                              !window.confirm(
                                                                "Archive this competency? It will be hidden from normal lists until you turn on “Show archived” and restore it."
                                                              )
                                                            ) {
                                                              return;
                                                            }
                                                            void runArchiveEntity(
                                                              "competency",
                                                              c.id
                                                            );
                                                          }}
                                                          disabled={
                                                            lifecycleSaving
                                                          }
                                                          style={{
                                                            ...btnGhost,
                                                            padding:
                                                              "6px 12px",
                                                            fontSize: 13,
                                                          }}
                                                        >
                                                          Archive
                                                        </button>
                                                      ) : null}
                                                    </div>
                                                  </div>
                                                )}
                                                {expandedCompetencyId ===
                                                  c.id && (
                                                  <div
                                                    style={{
                                                      marginTop: 12,
                                                      paddingTop: 12,
                                                      borderTop: `1px solid ${border}`,
                                                    }}
                                                  >
                                                    {levelDefinitionsLoading ? (
                                                      <p
                                                        style={{
                                                          margin: 0,
                                                          fontSize: 13,
                                                          color: mutedColor,
                                                        }}
                                                      >
                                                        Loading level
                                                        definitions...
                                                      </p>
                                                    ) : levelDefinitions.length ===
                                                      0 ? (
                                                      <p
                                                        style={{
                                                          margin: 0,
                                                          fontSize: 13,
                                                          color: mutedColor,
                                                        }}
                                                      >
                                                        No level definitions yet
                                                      </p>
                                                    ) : (
                                                      <ul
                                                        style={{
                                                          margin: 0,
                                                          padding: 0,
                                                          listStyle: "none",
                                                          display: "flex",
                                                          flexDirection:
                                                            "column",
                                                          gap: 8,
                                                        }}
                                                      >
                                                        {levelDefinitions.map(
                                                          (ld) => (
                                                            <li
                                                              key={ld.id}
                                                              style={{
                                                                padding:
                                                                  "10px 12px",
                                                                borderRadius: 6,
                                                                backgroundColor:
                                                                  bg,
                                                                border: `1px solid ${border}`,
                                                              }}
                                                            >
                                                              <div
                                                                style={{
                                                                  fontWeight: 600,
                                                                  color: text,
                                                                  fontSize: 14,
                                                                }}
                                                              >
                                                                {ld.level_name}
                                                              </div>
                                                              <div
                                                                style={{
                                                                  marginTop: 4,
                                                                  fontSize: 12,
                                                                  color:
                                                                    mutedColor,
                                                                }}
                                                              >
                                                                Order:{" "}
                                                                {ld.level_order}
                                                              </div>
                                                              {ld.description !=
                                                                null &&
                                                              ld.description.trim() !==
                                                                "" ? (
                                                                <div
                                                                  style={{
                                                                    marginTop: 6,
                                                                    fontSize: 13,
                                                                    color:
                                                                      mutedColor,
                                                                    lineHeight: 1.45,
                                                                  }}
                                                                >
                                                                  {
                                                                    ld.description
                                                                  }
                                                                </div>
                                                              ) : null}
                                                            </li>
                                                          )
                                                        )}
                                                      </ul>
                                                    )}
                                                    {showCreateLevelFormForCompetencyId ===
                                                    c.id ? (
                                                      <form
                                                        onSubmit={(e) => {
                                                          void handleSaveNewLevelDefinition(
                                                            e,
                                                            c.id
                                                          );
                                                        }}
                                                        style={{
                                                          marginTop: 12,
                                                          padding:
                                                            "12px 12px",
                                                          borderRadius: 8,
                                                          backgroundColor:
                                                            surface,
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
                                                          Level Name
                                                          <input
                                                            required
                                                            value={newLevelName}
                                                            onChange={(e) =>
                                                              setNewLevelName(
                                                                e.target.value
                                                              )
                                                            }
                                                            disabled={
                                                              isSavingLevel
                                                            }
                                                            style={{
                                                              padding:
                                                                "10px 12px",
                                                              fontSize: 15,
                                                              color: text,
                                                              backgroundColor:
                                                                bg,
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
                                                          Level Order
                                                          <input
                                                            required
                                                            type="number"
                                                            value={
                                                              newLevelOrder
                                                            }
                                                            onChange={(e) =>
                                                              setNewLevelOrder(
                                                                e.target.value
                                                              )
                                                            }
                                                            disabled={
                                                              isSavingLevel
                                                            }
                                                            style={{
                                                              padding:
                                                                "10px 12px",
                                                              fontSize: 15,
                                                              color: text,
                                                              backgroundColor:
                                                                bg,
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
                                                          Description
                                                          (optional)
                                                          <textarea
                                                            value={
                                                              newLevelDescription
                                                            }
                                                            onChange={(e) =>
                                                              setNewLevelDescription(
                                                                e.target.value
                                                              )
                                                            }
                                                            disabled={
                                                              isSavingLevel
                                                            }
                                                            rows={2}
                                                            style={{
                                                              padding:
                                                                "10px 12px",
                                                              fontSize: 15,
                                                              color: text,
                                                              backgroundColor:
                                                                bg,
                                                              border: `1px solid ${border}`,
                                                              borderRadius: 8,
                                                              fontFamily:
                                                                "inherit",
                                                              resize:
                                                                "vertical" as const,
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
                                                              isSavingLevel
                                                            }
                                                            style={btn}
                                                          >
                                                            {isSavingLevel
                                                              ? "Saving..."
                                                              : "Save"}
                                                          </button>
                                                          <button
                                                            type="button"
                                                            disabled={
                                                              isSavingLevel
                                                            }
                                                            onClick={
                                                              handleCancelCreateLevelDefinition
                                                            }
                                                            style={btn}
                                                          >
                                                            Cancel
                                                          </button>
                                                        </div>
                                                      </form>
                                                    ) : (
                                                      <button
                                                        type="button"
                                                        onClick={() =>
                                                          setShowCreateLevelFormForCompetencyId(
                                                            c.id
                                                          )
                                                        }
                                                        disabled={
                                                          levelDefinitionsLoading ||
                                                          isSavingLevel
                                                        }
                                                        style={{
                                                          ...btn,
                                                          marginTop: 12,
                                                          width: "100%",
                                                          boxSizing:
                                                            "border-box" as const,
                                                        }}
                                                      >
                                                        + Add Level
                                                      </button>
                                                    )}
                                                  </div>
                                                )}
                                              </li>
                                            ))}
                                          </ul>
                                        )}
                                      </div>
                                    </AccordionCollapsible>
                                  </div>
                                )}

                              </div>
                            );
                          })}
                                </div>
                              </AccordionCollapsible>
                            </div>
                          );})}
                        </div>
                      </>
                    )}


        </div>
      )}

      {lifecycleModal?.kind === "deprecate" ? (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="lifecycle-deprecate-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 85,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "24px 16px",
            overflow: "auto",
            backgroundColor: "rgba(0,0,0,0.6)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !lifecycleSaving) {
              setLifecycleModal(null);
              setLifecycleReason("");
              setLifecycleReplacedById("");
            }
          }}
        >
          <div
            style={{
              ...panelShell,
              width: "100%",
              maxWidth: 480,
              marginTop: 48,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="lifecycle-deprecate-title"
              style={{
                margin: "0 0 8px",
                fontSize: 17,
                fontWeight: 600,
                color: text,
              }}
            >
              Deprecate{" "}
              {lifecycleModal.entity === "practice"
                ? "practice"
                : lifecycleModal.entity === "subject"
                  ? "subject"
                  : "competency"}
            </h3>
            <p style={{ ...muted, margin: "0 0 12px", fontSize: 13 }}>
              <strong style={{ color: text }}>{lifecycleModal.label}</strong>
              <br />
              Deprecated items stay visible on existing assignments but cannot
              be newly assigned. Optional: record a reason and replacement.
            </p>
            <label
              style={{
                display: "grid",
                gap: 6,
                fontSize: 13,
                color: mutedColor,
                marginBottom: 10,
              }}
            >
              Reason (optional)
              <textarea
                value={lifecycleReason}
                onChange={(e) => setLifecycleReason(e.target.value)}
                disabled={lifecycleSaving}
                rows={3}
                style={{
                  padding: "10px 12px",
                  fontSize: 14,
                  color: text,
                  backgroundColor: bg,
                  border: `1px solid ${border}`,
                  borderRadius: 8,
                  fontFamily: "inherit",
                  resize: "vertical" as const,
                }}
              />
            </label>
            <label
              style={{
                display: "grid",
                gap: 6,
                fontSize: 13,
                color: mutedColor,
                marginBottom: 14,
              }}
            >
              Replaced by (optional)
              <select
                value={lifecycleReplacedById}
                onChange={(e) =>
                  setLifecycleReplacedById(e.target.value)
                }
                disabled={lifecycleSaving}
                style={{
                  padding: "10px 12px",
                  fontSize: 14,
                  color: text,
                  backgroundColor: surface,
                  border: `1px solid ${border}`,
                  borderRadius: 8,
                }}
              >
                <option value="">— None —</option>
                {replacementOptionsExcluding(
                  lifecycleModal.entity,
                  lifecycleModal.id
                ).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                justifyContent: "flex-end",
              }}
            >
              <button
                type="button"
                disabled={lifecycleSaving}
                onClick={() => {
                  setLifecycleModal(null);
                  setLifecycleReason("");
                  setLifecycleReplacedById("");
                }}
                style={btn}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={lifecycleSaving}
                onClick={() => void submitLifecycleDeprecate()}
                style={btnPrimary}
              >
                {lifecycleSaving ? "Saving…" : "Deprecate"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {practiceGenModalOpen ? (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="practice-gen-modal-title"
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
            if (e.target === e.currentTarget && !practiceGenLoading && !practiceGenAccepting) {
              closePracticeGenModal();
            }
          }}
        >
          <div
            style={{
              ...panelShell,
              width: "100%",
              maxWidth: 560,
              marginTop: 40,
              maxHeight: "min(82vh, 760px)",
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="practice-gen-modal-title"
              style={{
                margin: "0 0 8px",
                fontSize: 17,
                fontWeight: 600,
                color: text,
                letterSpacing: "-0.02em",
              }}
            >
              {practiceGenPhase === "input"
                ? "Generate practice model"
                : "Preview practices"}
            </h3>
            <p
              style={{
                ...muted,
                margin: "0 0 14px",
                fontSize: 12,
                lineHeight: 1.45,
              }}
            >
              {practiceGenPhase === "input"
                ? "Uses your company profile (optional), plus any domain or focus you add. Nothing is saved until you accept the preview."
                : "Edit names and descriptions, choose which to create. Existing practices are never overwritten — new rows are inserted only."}
            </p>

            {practiceGenPhase === "input" ? (
              <>
                {companyProfileLoading ? (
                  <p style={{ margin: "0 0 12px", fontSize: 13, color: mutedColor }}>
                    Loading company profile…
                  </p>
                ) : companyProfileLoadError ? (
                  <p style={{ margin: "0 0 12px", fontSize: 13, color: errorColor }}>
                    {companyProfileLoadError} (generation can still proceed with a
                    thinner context.)
                  </p>
                ) : companyProfile ? (
                  <p style={{ margin: "0 0 12px", fontSize: 13, color: mutedColor }}>
                    Company profile loaded ({companyProfile.organisation_name?.trim() ?? "workspace"}).
                  </p>
                ) : (
                  <p style={{ margin: "0 0 12px", fontSize: 13, color: mutedColor }}>
                    No company profile saved yet — add one in Company Profile for
                    richer results, or continue with domain/focus only.
                  </p>
                )}

                <label
                  style={{
                    display: "grid",
                    gap: 6,
                    fontSize: 13,
                    color: mutedColor,
                  }}
                >
                  Domain (optional)
                  <input
                    value={practiceGenDomain}
                    onChange={(e) => setPracticeGenDomain(e.target.value)}
                    disabled={practiceGenLoading}
                    placeholder="e.g. IT, Digital, Operations"
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
                    marginTop: 12,
                  }}
                >
                  Focus area (optional)
                  <input
                    value={practiceGenFocus}
                    onChange={(e) => setPracticeGenFocus(e.target.value)}
                    disabled={practiceGenLoading}
                    placeholder='e.g. IT Management in a Bank'
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

                {practiceGenError ? (
                  <p
                    style={{
                      margin: "12px 0 0",
                      fontSize: 13,
                      color: errorColor,
                    }}
                  >
                    {practiceGenError}
                  </p>
                ) : null}

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
                    disabled={practiceGenLoading}
                    onClick={() => closePracticeGenModal()}
                    style={btn}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={practiceGenLoading}
                    onClick={() => void handleGeneratePracticeModel()}
                    style={{
                      ...btnPrimary,
                      opacity: practiceGenLoading ? 0.7 : 1,
                    }}
                  >
                    {practiceGenLoading ? "Generating…" : "Generate"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    overflow: "auto",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    paddingRight: 4,
                    marginBottom: 8,
                  }}
                >
                  {practiceGenRows.map((row) => {
                    const collides = practices.some(
                      (p) =>
                        p.name.trim().toLowerCase() ===
                        row.name.trim().toLowerCase()
                    );
                    return (
                      <div
                        key={row.id}
                        style={{
                          padding: "12px 12px",
                          borderRadius: 8,
                          backgroundColor: bg,
                          border: `1px solid ${border}`,
                        }}
                      >
                        <label
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 10,
                            cursor: "pointer",
                            fontSize: 13,
                            color: text,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={row.selected}
                            onChange={(e) =>
                              setPracticeGenRows((prev) =>
                                prev.map((r) =>
                                  r.id === row.id
                                    ? { ...r, selected: e.target.checked }
                                    : r
                                )
                              )
                            }
                            disabled={practiceGenAccepting}
                            style={{ marginTop: 3 }}
                          />
                          <span style={{ flex: 1 }}>
                            Include in workspace
                            {collides ? (
                              <span
                                style={{
                                  display: "block",
                                  marginTop: 4,
                                  fontSize: 11,
                                  color: mutedColor,
                                }}
                              >
                                Name matches an existing practice — a new row will
                                still be added if you confirm on accept.
                              </span>
                            ) : null}
                          </span>
                        </label>
                        <label
                          style={{
                            display: "grid",
                            gap: 6,
                            fontSize: 13,
                            color: mutedColor,
                            marginTop: 10,
                          }}
                        >
                          Name
                          <input
                            value={row.name}
                            onChange={(e) =>
                              setPracticeGenRows((prev) =>
                                prev.map((r) =>
                                  r.id === row.id
                                    ? { ...r, name: e.target.value }
                                    : r
                                )
                              )
                            }
                            disabled={practiceGenAccepting}
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
                            marginTop: 10,
                          }}
                        >
                          Description
                          <textarea
                            value={row.description}
                            onChange={(e) =>
                              setPracticeGenRows((prev) =>
                                prev.map((r) =>
                                  r.id === row.id
                                    ? { ...r, description: e.target.value }
                                    : r
                                )
                              )
                            }
                            disabled={practiceGenAccepting}
                            rows={3}
                            style={{
                              padding: "10px 12px",
                              fontSize: 15,
                              color: text,
                              backgroundColor: surface,
                              border: `1px solid ${border}`,
                              borderRadius: 8,
                              fontFamily: "inherit",
                              resize: "vertical" as const,
                            }}
                          />
                        </label>
                      </div>
                    );
                  })}
                </div>

                {practiceGenError ? (
                  <p
                    style={{
                      margin: "0 0 8px",
                      fontSize: 13,
                      color: errorColor,
                    }}
                  >
                    {practiceGenError}
                  </p>
                ) : null}

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
                    disabled={practiceGenAccepting}
                    onClick={() => {
                      setPracticeGenPhase("input");
                      setPracticeGenError(null);
                    }}
                    style={btn}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={practiceGenAccepting}
                    onClick={() => closePracticeGenModal()}
                    style={btn}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={practiceGenAccepting}
                    onClick={() => void handleAcceptPracticeGenerated()}
                    style={{
                      ...btnPrimary,
                      opacity: practiceGenAccepting ? 0.7 : 1,
                    }}
                  >
                    {practiceGenAccepting ? "Creating…" : "Accept"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
