import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";
import { supabase } from "../lib/supabase";
import {
  generateCompetenciesWithAi,
  generateSubjectsWithAi,
} from "../lib/hierarchyGeneration";
import { generatePracticeModelWithAi } from "../lib/practiceModelGeneration";
import { generateHierarchyFromPrompt } from "../lib/promptHierarchyGeneration";
import type { PromptHierarchyResult } from "../lib/promptHierarchyGeneration";
import { insertDefaultCompetencyLevels } from "../lib/insertDefaultCompetencyLevels";
import type {
  CompetencyLevelDefinitionRow,
  CompetencyPracticeRow,
  CompetencyRow,
  CompetencySubjectRow,
  CompetencyType,
  OrganisationProfileRow,
} from "./hub/types";
import { AccordionCollapsible } from "./hub/AccordionCollapsible";
import {
  entityMatchesLifecycleFilter,
  isAssignableLifecycleStatus,
  parseLifecycleStatus,
  type LifecycleViewFilter,
} from "./hub/competencyLifecycle";
import {
  canAccessWorkspaceManagementNav,
  isWorkspaceAdminRole,
} from "./hub/workspaceRoles";
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
const UNASSIGNED_ORG_SUBJECT_KEY = "__unassigned_org_subject__";
const UNASSIGNED_PRACTICE_KEY = "__unassigned_practice__";

/** Stable key for org-tree inline competency form + subject accordion (avoids collisions with practice tree). */
function orgInlineSectionKey(
  practiceKey: string,
  sectionKey: string
): string {
  return `org:${practiceKey}::${sectionKey}`;
}

function orgSubjectAccordionStorageId(
  practiceKey: string,
  sectionKey: string
): string {
  return `org:${practiceKey}::${sectionKey}`;
}

function normalizeCompetencyType(type?: string | null) {
  return (type || "").toLowerCase().trim();
}

/** Normalise competency display names for org-wide uniqueness comparison (trim + lowercase). */
function normalizeCompetencyNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Subject type for alignment: only `subject.type` (see CompetencySubjectRow). */
function normalizeSubjectTypeForAlignment(
  subject: CompetencySubjectRow | undefined
): string {
  return normalizeCompetencyType(subject?.type);
}

const COMPETENCY_SUBJECT_TYPE_WARN_BORDER = "#b45309";
const COMPETENCY_SUBJECT_TYPE_WARN_MSG =
  "Competency type will be aligned with its Subject type (Organisation / Practice).";

function toCompetencyTypeUnion(normalized: string): CompetencyType {
  if (
    normalized === "organisation" ||
    normalized === "stretch" ||
    normalized === "practice"
  ) {
    return normalized;
  }
  return "practice";
}

function competencyTypeLabel(t: CompetencyType): string {
  if (t === "practice") return "Practice";
  if (t === "organisation") return "Organisation";
  return "Stretch";
}

/** Badge colour key for competency_type (UI only) */
function getCompetencyBadge(
  type: string | null | undefined
): "blue" | "green" | "yellow" {
  const t = normalizeCompetencyType(type);
  if (t === "organisation") return "green";
  if (t === "stretch") return "yellow";
  return "blue";
}

function competencyTypeBadgeColors(t: CompetencyType): {
  bg: string;
  fg: string;
  border: string;
} {
  const key = getCompetencyBadge(t);
  if (key === "green") {
    return {
      bg: "rgba(100, 200, 130, 0.14)",
      fg: "#8fd4a8",
      border: "rgba(100, 200, 130, 0.4)",
    };
  }
  if (key === "yellow") {
    return {
      bg: "rgba(240, 200, 110, 0.14)",
      fg: "#e8c878",
      border: "rgba(240, 200, 110, 0.42)",
    };
  }
  return {
    bg: "rgba(110, 176, 240, 0.16)",
    fg: "#8ec4f0",
    border: "rgba(110, 176, 240, 0.42)",
  };
}

function CompetencyTypeBadge({ type }: { type: CompetencyType }) {
  const colors = competencyTypeBadgeColors(type);
  return (
    <span
      title={competencyTypeLabel(type)}
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        padding: "2px 7px",
        borderRadius: 4,
        border: `1px solid ${colors.border}`,
        backgroundColor: colors.bg,
        color: colors.fg,
        flexShrink: 0,
      }}
    >
      {competencyTypeLabel(type)}
    </span>
  );
}

type ManagementSectionModel = {
  key: string;
  title: string;
  description: string | null;
  category: string | null;
  /** practice | organisation | stretch — aligns with competencies under this subject */
  subjectType: CompetencyType;
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

type ExpansionCompetencyPreviewRow = {
  id: string;
  name: string;
  description: string;
  selected: boolean;
};

type ExpansionSubjectPreviewRow = {
  id: string;
  name: string;
  description: string;
  selected: boolean;
  competencies: ExpansionCompetencyPreviewRow[];
};

type ExpansionPracticePreviewRow = {
  id: string;
  name: string;
  description: string;
  selected: boolean;
  subjects: ExpansionSubjectPreviewRow[];
};

function mapPromptHierarchyToPreviewRows(
  result: PromptHierarchyResult
): ExpansionPracticePreviewRow[] {
  return result.practices.map((p) => ({
    id: crypto.randomUUID(),
    name: p.name.trim(),
    description: p.description?.trim() ?? "",
    selected: true,
    subjects: (p.subjects ?? []).map((s) => ({
      id: crypto.randomUUID(),
      name: s.name.trim(),
      description: s.description?.trim() ?? "",
      selected: true,
      competencies: (s.competencies ?? []).map((c) => ({
        id: crypto.randomUUID(),
        name: c.name.trim(),
        description: c.description?.trim() ?? "",
        selected: true,
      })),
    })),
  }));
}

type SubjectGenPreviewRow = {
  id: string;
  name: string;
  description: string;
  category: string;
  selected: boolean;
};

type CompetencyGenPreviewRow = {
  id: string;
  name: string;
  description: string;
  selected: boolean;
};

function findSimilarCompetencies(
  name: string,
  catalogue: CompetencyRow[]
): CompetencyRow[] {
  const t = name.trim().toLowerCase();
  if (t.length < 2) return [];
  const seen = new Set<string>();
  const out: CompetencyRow[] = [];
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2)
    );
  const wt = words(t);
  for (const c of catalogue) {
    const cn = c.name.trim().toLowerCase();
    if (cn.length < 2) continue;
    let match = false;
    if (cn === t) match = true;
    else if (cn.includes(t) || t.includes(cn)) match = true;
    else {
      const wn = words(cn);
      let overlap = 0;
      for (const w of wt) {
        if (wn.has(w)) overlap++;
      }
      if (wt.size > 0 && overlap / wt.size >= 0.5) match = true;
    }
    if (match && !seen.has(c.id)) {
      seen.add(c.id);
      out.push(c);
    }
  }
  return out.slice(0, 12);
}

function competencyHierarchyLabel(
  c: CompetencyRow,
  subjectsList: CompetencySubjectRow[],
  practicesList: CompetencyPracticeRow[]
): string {
  const sid = c.subject_id;
  if (!sid) return "Unassigned subject";
  const sub = subjectsList.find((s) => s.id === sid);
  if (!sub) return "Unknown subject";
  const pid = sub.practice_id;
  if (!pid) return sub.name.trim() || "Subject";
  const pr = practicesList.find((p) => p.id === pid);
  const sn = sub.name.trim() || "Subject";
  return pr ? `${pr.name.trim() || "Practice"} → ${sn}` : sn;
}

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
    subjectType: toCompetencyTypeUnion(normalizeCompetencyType(s.type)),
    items: bySubject.get(s.id) ?? [],
    isUnassigned: false,
    subjectPracticeId: s.practice_id ?? null,
  }));

  const unassignedSubjectSection: ManagementSectionModel = {
    key: UNASSIGNED_SUBJECT_KEY,
    title: "Unassigned",
    description: null,
    category: null,
    subjectType: "practice",
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

/** Organisational Practice → Subject → Competency (only organisation-type subjects + org competencies). */
export function buildOrganisationManagementPracticeGroups(
  practiceRows: CompetencyPracticeRow[],
  subjectRows: CompetencySubjectRow[],
  competencies: CompetencyRow[]
): ManagementPracticeGroup[] {
  const bySubject = new Map<string, CompetencyRow[]>();
  for (const c of competencies) {
    const key = c.subject_id ?? UNASSIGNED_ORG_SUBJECT_KEY;
    if (!bySubject.has(key)) bySubject.set(key, []);
    bySubject.get(key)!.push(c);
  }
  for (const [, arr] of bySubject) {
    arr.sort((a, b) => a.name.localeCompare(b.name));
  }

  const orgSubjectsOnly = subjectRows.filter(
    (s) => normalizeCompetencyType(s.type) === "organisation"
  );
  const orgSubjectIds = new Set(orgSubjectsOnly.map((s) => s.id));
  for (const key of [...bySubject.keys()]) {
    if (key === UNASSIGNED_ORG_SUBJECT_KEY) continue;
    if (!orgSubjectIds.has(key)) {
      const items = bySubject.get(key) ?? [];
      bySubject.delete(key);
      const un = bySubject.get(UNASSIGNED_ORG_SUBJECT_KEY) ?? [];
      bySubject.set(UNASSIGNED_ORG_SUBJECT_KEY, [...un, ...items]);
    }
  }
  const unBucket = bySubject.get(UNASSIGNED_ORG_SUBJECT_KEY);
  if (unBucket) {
    unBucket.sort((a, b) => a.name.localeCompare(b.name));
  }

  const sortedOrgSubjects = [...orgSubjectsOnly].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const realSections: ManagementSectionModel[] = sortedOrgSubjects.map(
    (s) => ({
      key: s.id,
      title: s.name.trim() || "Subject",
      description: s.description?.trim() ? s.description : null,
      category: s.category?.trim() ? s.category : null,
      subjectType: "organisation",
      items: bySubject.get(s.id) ?? [],
      isUnassigned: false,
      subjectPracticeId: s.practice_id ?? null,
    })
  );

  const unassignedSubjectSection: ManagementSectionModel = {
    key: UNASSIGNED_ORG_SUBJECT_KEY,
    title: "Unassigned Organisational Subject",
    description: null,
    category: null,
    subjectType: "organisation",
    items: bySubject.get(UNASSIGNED_ORG_SUBJECT_KEY) ?? [],
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
  /** When set, inline "Add subject" form is shown under this practice only */
  const [subjectCreatePracticeKey, setSubjectCreatePracticeKey] = useState<
    string | null
  >(null);
  /** When true, the visible Add Subject form belongs to the organisational hierarchy tree. */
  const [subjectCreateFromOrganisationTree, setSubjectCreateFromOrganisationTree] =
    useState(false);
  const [newSubjectName, setNewSubjectName] = useState("");
  const [newSubjectDescription, setNewSubjectDescription] = useState("");
  const [newSubjectCategory, setNewSubjectCategory] = useState("");
  const [newSubjectType, setNewSubjectType] =
    useState<CompetencyType>("practice");
  const [newSubjectPracticeId, setNewSubjectPracticeId] = useState("");
  const [isSavingSubject, setIsSavingSubject] = useState(false);

  const [newCompetencyName, setNewCompetencyName] = useState("");
  const [newCompetencyDescription, setNewCompetencyDescription] = useState("");
  const [newCompetencyType, setNewCompetencyType] =
    useState<CompetencyType>("organisation");
  const [newCompetencySubjectId, setNewCompetencySubjectId] = useState("");
  /** When set, create form shows which subject the competency is being added to */
  const [competencyFormSubjectHint, setCompetencyFormSubjectHint] = useState<
    string | null
  >(null);
  /** Which subject section shows the inline create form; only one at a time */
  const [inlineCompetencySectionKey, setInlineCompetencySectionKey] = useState<
    string | null
  >(null);
  const [competencyDuplicateModal, setCompetencyDuplicateModal] = useState<
    | {
        matches: CompetencyRow[];
        pending: {
          name: string;
          description: string;
          subjectId: string | null;
          competencyType: CompetencyType;
        };
      }
    | null
  >(null);
  const duplicateCompetencySkipRef = useRef(false);
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
  const [editSubjectType, setEditSubjectType] =
    useState<CompetencyType>("practice");
  const [editSubjectPracticeId, setEditSubjectPracticeId] = useState("");
  const [isSavingEditSubject, setIsSavingEditSubject] = useState(false);

  const [editingCompetencyId, setEditingCompetencyId] = useState<string | null>(
    null
  );
  const [editCompetencyName, setEditCompetencyName] = useState("");
  const [editCompetencyDescription, setEditCompetencyDescription] =
    useState("");
  const [editCompetencySubjectId, setEditCompetencySubjectId] = useState("");
  const [editCompetencyType, setEditCompetencyType] =
    useState<CompetencyType>("practice");
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

  /** Practice accordion: only `true` = expanded (default collapsed) */
  const [practiceAccordionOpen, setPracticeAccordionOpen] = useState<
    Record<string, boolean>
  >({});
  /** Subject accordion: key `${practiceKey}::${sectionKey}`; only `true` = expanded */
  const [subjectAccordionOpen, setSubjectAccordionOpen] = useState<
    Record<string, boolean>
  >({});
  /** Same as practice accordion for the organisational hierarchy tree (separate state). */
  const [orgPracticeAccordionOpen, setOrgPracticeAccordionOpen] = useState<
    Record<string, boolean>
  >({});
  /** Subject accordion keys for organisational tree (`org:${practiceKey}::${sectionKey}`). */
  const [orgSubjectAccordionOpen, setOrgSubjectAccordionOpen] = useState<
    Record<string, boolean>
  >({});
  /** Row hover for competency action affordance */
  const [competencyRowHoverId, setCompetencyRowHoverId] = useState<
    string | null
  >(null);

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
  const [practiceGenModalMode, setPracticeGenModalMode] = useState<
    "standard" | "promptExpansion"
  >("standard");
  const [practiceGenExpansionHierarchy, setPracticeGenExpansionHierarchy] =
    useState<ExpansionPracticePreviewRow[] | null>(null);
  const [expansionPrompt, setExpansionPrompt] = useState("");
  const [isGeneratingExpansion, setIsGeneratingExpansion] = useState(false);
  const [expansionPromptError, setExpansionPromptError] = useState<
    string | null
  >(null);

  const [subjectGenModalOpen, setSubjectGenModalOpen] = useState(false);
  const [subjectGenContext, setSubjectGenContext] =
    useState<ManagementPracticeGroup | null>(null);
  const [subjectGenRows, setSubjectGenRows] = useState<SubjectGenPreviewRow[]>(
    []
  );
  const [subjectGenLoading, setSubjectGenLoading] = useState(false);
  const [subjectGenError, setSubjectGenError] = useState<string | null>(null);
  const [subjectGenAccepting, setSubjectGenAccepting] = useState(false);
  const [subjectGenSubjectType, setSubjectGenSubjectType] =
    useState<CompetencyType>("practice");

  const [competencyGenModalOpen, setCompetencyGenModalOpen] = useState(false);
  const [competencyGenContext, setCompetencyGenContext] = useState<{
    subjectId: string;
    subjectName: string;
    subjectDescription: string | null;
    practiceTitle: string;
  } | null>(null);
  const [competencyGenRows, setCompetencyGenRows] = useState<
    CompetencyGenPreviewRow[]
  >([]);
  const [competencyGenLoading, setCompetencyGenLoading] = useState(false);
  const [competencyGenError, setCompetencyGenError] = useState<string | null>(
    null
  );
  const [competencyGenAccepting, setCompetencyGenAccepting] = useState(false);

  const [showArchivedEntities, setShowArchivedEntities] = useState(false);
  const [viewMode, setViewMode] = useState<
    "all" | "practice" | "organisation"
  >("all");
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
  const canAuthorHierarchy = canAccessWorkspaceManagementNav(workspaceRole);

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
      setSubjectCreatePracticeKey(null);
      setNewSubjectName("");
      setNewSubjectDescription("");
      setNewSubjectCategory("");
      setNewSubjectType("practice");
      setNewSubjectPracticeId("");
      setInlineCompetencySectionKey(null);
      setCompetencyDuplicateModal(null);
      setNewCompetencyName("");
      setNewCompetencyDescription("");
      setNewCompetencyType("organisation");
      setNewCompetencySubjectId("");
      setCompetencyFormSubjectHint(null);
      setEditingSubjectId(null);
      setEditSubjectName("");
      setEditSubjectDescription("");
      setEditSubjectCategory("");
      setEditSubjectType("practice");
      setEditSubjectPracticeId("");
      setEditingCompetencyId(null);
      setEditCompetencyName("");
      setEditCompetencyDescription("");
      setEditCompetencySubjectId("");
      setEditCompetencyType("practice");
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
            "id, name, description, competency_type, is_active, status, deprecated_at, deprecated_reason, replaced_by_id, subject_id, competency_subjects ( id, name, description, category, type, practice_id, status, deprecated_at, deprecated_reason, replaced_by_id, competency_practices ( id, name, description, is_active, status, deprecated_at, deprecated_reason, replaced_by_id ) )"
          )
          .eq("organisation_id", orgId)
          .in("status", [...statusList])
          .order("name"),
        supabase
          .from("competency_subjects")
          .select(
            "id, name, description, category, type, practice_id, status, deprecated_at, deprecated_reason, replaced_by_id, competency_practices ( id, name, description, is_active, status, deprecated_at, deprecated_reason, replaced_by_id )"
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
    if (import.meta.env.DEV) {
      console.log(
        "[Competency Types]",
        competencies.map((c) => ({
          name: c.name,
          raw: c.competency_type,
          normalized: normalizeCompetencyType(c.competency_type),
        }))
      );
    }
  }, [competencies]);

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
        "id, name, description, category, type, practice_id, status, deprecated_at, deprecated_reason, replaced_by_id, competency_practices ( id, name, description, is_active, status, deprecated_at, deprecated_reason, replaced_by_id )"
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
        "id, name, description, competency_type, is_active, status, deprecated_at, deprecated_reason, replaced_by_id, subject_id, competency_subjects ( id, name, description, category, type, practice_id, status, deprecated_at, deprecated_reason, replaced_by_id, competency_practices ( id, name, description, is_active, status, deprecated_at, deprecated_reason, replaced_by_id ) )"
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
    if (!canAuthorHierarchy) return;

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
      type: newSubjectType,
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
    setNewSubjectType("practice");
    setNewSubjectPracticeId("");
    setSubjectCreatePracticeKey(null);
    setIsSavingSubject(false);

    await reloadSubjectsForOrg(activeOrgId);
  }

  function handleCancelCreateSubject() {
    setSubjectCreatePracticeKey(null);
    setSubjectCreateFromOrganisationTree(false);
    setNewSubjectName("");
    setNewSubjectDescription("");
    setNewSubjectCategory("");
    setNewSubjectType("practice");
    setNewSubjectPracticeId("");
  }

  function openCreateSubjectForPractice(practice: ManagementPracticeGroup) {
    if (!canAuthorHierarchy) return;
    setSubjectCreateFromOrganisationTree(false);
    setSubjectCreatePracticeKey(practice.key);
    setNewSubjectPracticeId(practice.isUnassigned ? "" : practice.key);
    setNewSubjectName("");
    setNewSubjectDescription("");
    setNewSubjectCategory("");
    setNewSubjectType("practice");
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

  async function performInsertCompetency(
    name: string,
    descriptionTrimmed: string,
    subjectId: string | null,
    competencyType: CompetencyType
  ) {
    if (activeOrgId === null) return;
    if (!canAuthorHierarchy) return;
    const idsBefore = new Set(competencies.map((c) => c.id));
    setIsSavingCompetency(true);
    let resolvedCompetencyType = competencyType;
    if (subjectId) {
      const subject = subjects.find((s) => s.id === subjectId);
      const subjectType = normalizeSubjectTypeForAlignment(subject);
      const competencyTypeNorm = normalizeCompetencyType(resolvedCompetencyType);
      if (subjectType && subjectType !== competencyTypeNorm) {
        resolvedCompetencyType = toCompetencyTypeUnion(subjectType);
      }
    }
    const { data: insertedCompetency, error } = await supabase
      .from("competencies")
      .insert({
        organisation_id: activeOrgId,
        name,
        description: descriptionTrimmed.length > 0 ? descriptionTrimmed : null,
        competency_type: resolvedCompetencyType,
        is_active: true,
        subject_id: subjectId,
        status: "active",
      })
      .select("id")
      .single();

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

    const { error: levelsError } = await insertDefaultCompetencyLevels(
      supabase,
      insertedCompetency.id
    );
    if (levelsError) {
      console.error(levelsError);
      alert(
        levelsError.message ||
          "Competency was created but default proficiency levels could not be added."
      );
    }

    setNewCompetencyName("");
    setNewCompetencyDescription("");
    setNewCompetencyType("organisation");
    setNewCompetencySubjectId("");
    setCompetencyFormSubjectHint(null);
    setInlineCompetencySectionKey(null);
    setIsSavingCompetency(false);

    const rows = await reloadCompetenciesForOrg(activeOrgId);
    const newRow = rows.find((c) => !idsBefore.has(c.id));
    if (newRow) {
      setHighlightCompetencyId(newRow.id);
    }
  }

  async function handleSaveNewCompetency(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (activeOrgId === null) {
      alert("No active workspace selected");
      return;
    }
    if (!canAuthorHierarchy) return;

    const name = newCompetencyName.trim();
    if (!name) {
      alert("Please enter a name");
      return;
    }

    const descriptionTrimmed = newCompetencyDescription.trim();
    const subjectId =
      newCompetencySubjectId.trim() === "" ? null : newCompetencySubjectId;

    if (!duplicateCompetencySkipRef.current) {
      const similar = findSimilarCompetencies(name, competencies);
      if (similar.length > 0) {
        setCompetencyDuplicateModal({
          matches: similar,
          pending: {
            name,
            description: descriptionTrimmed,
            subjectId,
            competencyType: newCompetencyType,
          },
        });
        return;
      }
    }
    duplicateCompetencySkipRef.current = false;
    setCompetencyDuplicateModal(null);

    await performInsertCompetency(
      name,
      descriptionTrimmed,
      subjectId,
      newCompetencyType
    );
  }

  function handleCancelCreateCompetency() {
    setInlineCompetencySectionKey(null);
    setNewCompetencyName("");
    setNewCompetencyDescription("");
    setNewCompetencyType("organisation");
    setNewCompetencySubjectId("");
    setCompetencyFormSubjectHint(null);
    setCompetencyDuplicateModal(null);
    duplicateCompetencySkipRef.current = false;
  }

  function handleAddCompetencyToSubject(
    presetSubjectId: string,
    subjectDisplayName: string,
    inlineSectionKey: string,
    tree: "practice" | "organisation" = "practice"
  ) {
    if (!canAuthorHierarchy) return;
    setInlineCompetencySectionKey(inlineSectionKey);
    setNewCompetencySubjectId(presetSubjectId);
    const subject = presetSubjectId
      ? subjects.find((s) => s.id === presetSubjectId)
      : undefined;
    const st = normalizeSubjectTypeForAlignment(subject);
    setNewCompetencyType(
      toCompetencyTypeUnion(
        st || (tree === "organisation" ? "organisation" : "practice")
      )
    );
    setCompetencyFormSubjectHint(subjectDisplayName);
  }

  function handleStartEditSubject(section: ManagementSectionModel) {
    if (section.isUnassigned) return;
    setInlineCompetencySectionKey(null);
    setEditingSubjectId(section.key);
    setEditSubjectName(section.title);
    setEditSubjectDescription(section.description ?? "");
    setEditSubjectCategory(section.category ?? "");
    setEditSubjectType(section.subjectType);
    setEditSubjectPracticeId(section.subjectPracticeId ?? "");
  }

  function handleCancelEditSubject() {
    setEditingSubjectId(null);
    setEditSubjectName("");
    setEditSubjectDescription("");
    setEditSubjectCategory("");
    setEditSubjectType("practice");
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
        type: editSubjectType,
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
    setEditSubjectType("practice");
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
    setEditCompetencyType(
      toCompetencyTypeUnion(normalizeCompetencyType(c.competency_type))
    );
  }

  function handleCancelEditCompetency() {
    setEditingCompetencyId(null);
    setEditCompetencyName("");
    setEditCompetencyDescription("");
    setEditCompetencySubjectId("");
    setEditCompetencyType("practice");
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

    let resolvedEditType = editCompetencyType;
    if (subjectId) {
      const subject = subjects.find((s) => s.id === subjectId);
      const subjectType = normalizeSubjectTypeForAlignment(subject);
      const competencyTypeNorm = normalizeCompetencyType(resolvedEditType);
      if (subjectType && subjectType !== competencyTypeNorm) {
        resolvedEditType = toCompetencyTypeUnion(subjectType);
      }
    }

    setIsSavingEditCompetency(true);
    const { error } = await supabase
      .from("competencies")
      .update({
        name,
        description: descriptionTrimmed.length > 0 ? descriptionTrimmed : null,
        subject_id: subjectId,
        competency_type: resolvedEditType,
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
    setEditCompetencyType("practice");
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

  const competenciesForPracticeHierarchy = useMemo(
    () =>
      filteredCompetencies.filter(
        (c) => normalizeCompetencyType(c.competency_type) !== "organisation"
      ),
    [filteredCompetencies]
  );

  const organisationalCompetencies = useMemo(
    () =>
      filteredCompetencies.filter(
        (c) => normalizeCompetencyType(c.competency_type) === "organisation"
      ),
    [filteredCompetencies]
  );

  const organisationalGroupedBySubject = useMemo(() => {
    const map = new Map<string, CompetencyRow[]>();
    for (const c of organisationalCompetencies) {
      let label = "General";
      if (c.subject_id) {
        const sub = subjects.find((s) => s.id === c.subject_id);
        label = sub?.name?.trim() || "General";
      }
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(c);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.name.localeCompare(b.name));
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [organisationalCompetencies, subjects]);

  const assignablePractices = useMemo(
    () => practices.filter((p) => isAssignableLifecycleStatus(p.status)),
    [practices]
  );

  const assignableSubjects = useMemo(
    () => subjects.filter((s) => isAssignableLifecycleStatus(s.status)),
    [subjects]
  );

  const competencySubjectTypeMismatchCreate = useMemo(() => {
    const sid = newCompetencySubjectId.trim();
    if (!sid) return false;
    const subject = subjects.find((s) => s.id === sid);
    const subjectType = normalizeSubjectTypeForAlignment(subject);
    const competencyTypeNorm = normalizeCompetencyType(newCompetencyType);
    return !!(
      subjectType &&
      competencyTypeNorm &&
      subjectType !== competencyTypeNorm
    );
  }, [newCompetencySubjectId, newCompetencyType, subjects]);

  const competencySubjectTypeMismatchEdit = useMemo(() => {
    const sid = editCompetencySubjectId.trim();
    if (!sid) return false;
    const subject = subjects.find((s) => s.id === sid);
    const subjectType = normalizeSubjectTypeForAlignment(subject);
    const competencyTypeNorm = normalizeCompetencyType(editCompetencyType);
    return !!(
      subjectType &&
      competencyTypeNorm &&
      subjectType !== competencyTypeNorm
    );
  }, [editCompetencySubjectId, editCompetencyType, subjects]);

  const managementPracticeGroups = useMemo(
    () =>
      buildManagementPracticeGroups(
        filteredPractices,
        filteredSubjects,
        competenciesForPracticeHierarchy
      ),
    [filteredPractices, filteredSubjects, competenciesForPracticeHierarchy]
  );

  const orgPanelEditing = useMemo(
    () =>
      editingCompetencyId !== null &&
      organisationalCompetencies.some((c) => c.id === editingCompetencyId),
    [editingCompetencyId, organisationalCompetencies]
  );

  const orgPanelLevels = useMemo(
    () =>
      expandedCompetencyId !== null &&
      organisationalCompetencies.some((c) => c.id === expandedCompetencyId),
    [expandedCompetencyId, organisationalCompetencies]
  );

  function isPracticeAccordionExpanded(practiceKey: string) {
    return practiceAccordionOpen[practiceKey] === true;
  }

  function togglePracticeAccordion(practiceKey: string) {
    setPracticeAccordionOpen((prev) => {
      const isOpen = prev[practiceKey] === true;
      if (isOpen) {
        return { ...prev, [practiceKey]: false };
      }
      // Single open practice at a time (accordion)
      return { [practiceKey]: true };
    });
  }

  function isOrgPracticeAccordionExpanded(practiceKey: string) {
    return orgPracticeAccordionOpen[practiceKey] === true;
  }

  function toggleOrgPracticeAccordion(practiceKey: string) {
    setOrgPracticeAccordionOpen((prev) => {
      const isOpen = prev[practiceKey] === true;
      if (isOpen) {
        return { ...prev, [practiceKey]: false };
      }
      return { [practiceKey]: true };
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
    sectionKeyForState: string,
    tree: "practice" | "organisation" = "practice"
  ) {
    const isOrgTree = tree === "organisation";
    if (editingSubjectId === sectionKeyForState) return true;
    const inlineKey = isOrgTree
      ? orgInlineSectionKey(practiceKey, sectionKeyForState)
      : sectionKeyForState;
    if (inlineCompetencySectionKey === inlineKey) return true;
    const id = isOrgTree
      ? orgSubjectAccordionStorageId(practiceKey, sectionKey)
      : subjectAccordionStorageId(practiceKey, sectionKey);
    const map = isOrgTree ? orgSubjectAccordionOpen : subjectAccordionOpen;
    return map[id] === true;
  }

  function toggleSubjectAccordion(
    practiceKey: string,
    sectionKey: string,
    tree: "practice" | "organisation" = "practice"
  ) {
    const isOrgTree = tree === "organisation";
    const id = isOrgTree
      ? orgSubjectAccordionStorageId(practiceKey, sectionKey)
      : subjectAccordionStorageId(practiceKey, sectionKey);
    const setter = isOrgTree
      ? setOrgSubjectAccordionOpen
      : setSubjectAccordionOpen;
    setter((prev) => {
      const isOpen = prev[id] === true;
      return { ...prev, [id]: !isOpen };
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
    setPracticeGenModalMode("standard");
    setPracticeGenExpansionHierarchy(null);
    setPracticeGenPhase("input");
    setPracticeGenModalOpen(true);
    void loadCompanyProfileForPracticeGen(activeOrgId);
  }

  function closePracticeGenModal() {
    setPracticeGenModalOpen(false);
    setPracticeGenLoading(false);
    setPracticeGenError(null);
    setPracticeGenAccepting(false);
    setPracticeGenModalMode("standard");
    setPracticeGenExpansionHierarchy(null);
  }

  async function handleGenerateFromPrompt() {
    if (!activeOrgId || !expansionPrompt.trim()) return;
    setExpansionPromptError(null);
    setIsGeneratingExpansion(true);
    try {
      const data = await generateHierarchyFromPrompt({
        prompt: expansionPrompt.trim(),
      });
      setPracticeGenExpansionHierarchy(mapPromptHierarchyToPreviewRows(data));
      setPracticeGenRows([]);
      setPracticeGenError(null);
      setPracticeGenModalMode("promptExpansion");
      setPracticeGenPhase("preview");
      setPracticeGenModalOpen(true);
      setExpansionPrompt("");
    } catch (err) {
      console.error("Prompt generation failed", err);
      setExpansionPromptError(
        err instanceof Error ? err.message : "Generation failed."
      );
    } finally {
      setIsGeneratingExpansion(false);
    }
  }

  async function handleAcceptPromptExpansion() {
    if (!activeOrgId || !practiceGenExpansionHierarchy) return;
    const selectedPractices = practiceGenExpansionHierarchy.filter(
      (p) => p.selected && p.name.trim()
    );
    if (selectedPractices.length === 0) {
      alert("Select at least one practice with a name.");
      return;
    }

    const existingPracticeLower = new Set(
      practices.map((p) => p.name.trim().toLowerCase())
    );
    const collidingPractices = selectedPractices.filter((p) =>
      existingPracticeLower.has(p.name.trim().toLowerCase())
    );
    let practicesToCreate = selectedPractices;
    if (collidingPractices.length > 0) {
      const ok = window.confirm(
        `Some selected names match existing practices (${collidingPractices
          .map((c) => c.name.trim())
          .join(", ")}). New rows will be added — existing practices will not be modified. Continue?`
      );
      if (!ok) {
        practicesToCreate = selectedPractices.filter(
          (p) => !existingPracticeLower.has(p.name.trim().toLowerCase())
        );
        if (practicesToCreate.length === 0) {
          alert("No practices to create — all selected names already exist.");
          return;
        }
      }
    }

    const plannedCompetencies: { name: string }[] = [];
    for (const pr of practicesToCreate) {
      for (const sub of pr.subjects.filter((s) => s.selected && s.name.trim())) {
        for (const comp of sub.competencies.filter(
          (c) => c.selected && c.name.trim()
        )) {
          plannedCompetencies.push({ name: comp.name.trim() });
        }
      }
    }
    const similarRisky: { name: string; matches: CompetencyRow[] }[] = [];
    for (const pc of plannedCompetencies) {
      const sim = findSimilarCompetencies(pc.name, competencies);
      if (sim.length > 0) {
        similarRisky.push({ name: pc.name, matches: sim });
      }
    }
    if (similarRisky.length > 0) {
      const lines = similarRisky
        .slice(0, 5)
        .map(
          (x) =>
            `• ${x.name} (similar to: ${x.matches
              .slice(0, 2)
              .map((m) => m.name)
              .join(", ")})`
        )
        .join("\n");
      const ok = window.confirm(
        `Some selected names are similar to existing competencies in your catalogue:\n\n${lines}${
          similarRisky.length > 5 ? "\n…" : ""
        }\n\nCreate these new rows anyway?`
      );
      if (!ok) return;
    }

    setPracticeGenAccepting(true);
    try {
      for (const pr of practicesToCreate) {
        const { data: practiceRow, error: pErr } = await supabase
          .from("competency_practices")
          .insert({
            organisation_id: activeOrgId,
            name: pr.name.trim(),
            description: pr.description.trim() || null,
            is_active: true,
            status: "active",
          })
          .select("id")
          .single();
        if (pErr || !practiceRow) {
          console.error(pErr);
          alert(pErr?.message || "Failed to create a practice.");
          return;
        }
        const practiceId = practiceRow.id as string;

        const subjectNamesSeen = new Set<string>();
        const selectedSubjects = pr.subjects.filter(
          (s) => s.selected && s.name.trim()
        );
        for (const sub of selectedSubjects) {
          const sk = sub.name.trim().toLowerCase();
          if (subjectNamesSeen.has(sk)) continue;
          subjectNamesSeen.add(sk);

          const existingSubLower = new Set(
            subjects
              .filter((s) => s.practice_id === practiceId)
              .map((s) => s.name.trim().toLowerCase())
          );
          if (existingSubLower.has(sk)) continue;

          const { data: subRow, error: sErr } = await supabase
            .from("competency_subjects")
            .insert({
              organisation_id: activeOrgId,
              name: sub.name.trim(),
              description: sub.description.trim() || null,
              category: null,
              type: "practice",
              practice_id: practiceId,
              is_active: true,
              status: "active",
            })
            .select("id, type")
            .single();
          if (sErr || !subRow) {
            console.error(sErr);
            alert(sErr?.message || "Failed to create a subject.");
            return;
          }
          const subjectId = subRow.id as string;
          const resolvedCompetencyType = toCompetencyTypeUnion(
            normalizeSubjectTypeForAlignment(subRow as CompetencySubjectRow)
          );

          const competencyNamesSeen = new Set<string>();
          const selectedComps = sub.competencies.filter(
            (c) => c.selected && c.name.trim()
          );
          for (const comp of selectedComps) {
            const cn = comp.name.trim();
            const ck = cn.toLowerCase();
            if (competencyNamesSeen.has(ck)) continue;
            competencyNamesSeen.add(ck);

            const { data: newComp, error: cErr } = await supabase
              .from("competencies")
              .insert({
                organisation_id: activeOrgId,
                name: cn,
                description: comp.description.trim() || null,
                competency_type: resolvedCompetencyType,
                is_active: true,
                subject_id: subjectId,
                status: "active",
              })
              .select("id")
              .single();
            if (cErr || !newComp) {
              console.error(cErr);
              alert(cErr?.message || "Failed to create a competency.");
              return;
            }
            const { error: levErr } = await insertDefaultCompetencyLevels(
              supabase,
              newComp.id
            );
            if (levErr) {
              console.error(levErr);
              alert(
                levErr.message ||
                  "A competency was created but default proficiency levels could not be added."
              );
              return;
            }
          }
        }
      }
      await reloadPracticesForOrg(activeOrgId);
      await reloadSubjectsForOrg(activeOrgId);
      await reloadCompetenciesForOrg(activeOrgId);
      closePracticeGenModal();
    } finally {
      setPracticeGenAccepting(false);
    }
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

  function openSubjectGenModal(practice: ManagementPracticeGroup) {
    if (!activeOrgId || !canAuthorHierarchy) return;
    setSubjectGenError(null);
    setSubjectGenRows([]);
    setSubjectGenSubjectType("practice");
    setSubjectGenContext(practice);
    setSubjectGenModalOpen(true);
    void loadCompanyProfileForPracticeGen(activeOrgId);
  }

  function closeSubjectGenModal() {
    setSubjectGenModalOpen(false);
    setSubjectGenContext(null);
    setSubjectGenLoading(false);
    setSubjectGenError(null);
    setSubjectGenAccepting(false);
    setSubjectGenRows([]);
    setSubjectGenSubjectType("practice");
  }

  async function handleGenerateSubjectsPreview() {
    if (!activeOrgId || !subjectGenContext) return;
    setSubjectGenError(null);
    setSubjectGenLoading(true);
    try {
      const existingNames = subjects
        .filter((s) => {
          if (subjectGenContext.isUnassigned) return s.practice_id === null;
          return s.practice_id === subjectGenContext.key;
        })
        .map((s) => s.name.trim())
        .filter(Boolean);
      const result = await generateSubjectsWithAi({
        companyProfile,
        practiceName: subjectGenContext.title,
        practiceDescription: subjectGenContext.description,
        existingSubjectNames: existingNames,
      });
      setSubjectGenRows(
        result.subjects.map((s) => ({
          id: crypto.randomUUID(),
          name: s.name,
          description: s.description,
          category: s.category ?? "",
          selected: true,
        }))
      );
    } catch (e) {
      setSubjectGenError(
        e instanceof Error ? e.message : "Generation failed."
      );
    } finally {
      setSubjectGenLoading(false);
    }
  }

  async function handleAcceptSubjectGenerated() {
    if (!activeOrgId || !subjectGenContext) return;
    const rows = subjectGenRows.filter((r) => r.selected && r.name.trim());
    if (rows.length === 0) {
      alert("Select at least one subject with a name.");
      return;
    }
    const practiceId = subjectGenContext.isUnassigned
      ? null
      : subjectGenContext.key;
    const existingLower = new Set(
      subjects
        .filter((s) => {
          if (subjectGenContext.isUnassigned) return s.practice_id === null;
          return s.practice_id === subjectGenContext.key;
        })
        .map((s) => s.name.trim().toLowerCase())
    );
    const toCreate = rows.filter(
      (r) => !existingLower.has(r.name.trim().toLowerCase())
    );
    const skipped = rows.length - toCreate.length;
    if (toCreate.length === 0) {
      alert(
        skipped > 0
          ? "All selected names already exist in this practice."
          : "Nothing to create."
      );
      return;
    }
    if (skipped > 0) {
      const ok = window.confirm(
        `${skipped} name(s) match existing subjects in this practice and will be skipped. Continue with ${toCreate.length} new subject(s)?`
      );
      if (!ok) return;
    }
    setSubjectGenAccepting(true);
    try {
      for (const row of toCreate) {
        const { error } = await supabase.from("competency_subjects").insert({
          organisation_id: activeOrgId,
          name: row.name.trim(),
          description: row.description.trim() || null,
          category: row.category.trim() || null,
          type: subjectGenSubjectType,
          practice_id: practiceId,
          is_active: true,
          status: "active",
        });
        if (error) {
          console.error(error);
          alert(error.message || "Failed to create a subject.");
          return;
        }
      }
      await reloadSubjectsForOrg(activeOrgId);
      closeSubjectGenModal();
    } finally {
      setSubjectGenAccepting(false);
    }
  }

  function openCompetencyGenModal(
    practice: ManagementPracticeGroup,
    section: ManagementSectionModel
  ) {
    if (!activeOrgId || !canAuthorHierarchy) return;
    if (section.isUnassigned) return;
    const sid = section.key;
    if (sid === UNASSIGNED_SUBJECT_KEY) return;
    setCompetencyGenError(null);
    setCompetencyGenRows([]);
    setCompetencyGenContext({
      subjectId: sid,
      subjectName: section.title?.trim() || "Subject",
      subjectDescription: section.description,
      practiceTitle: practice.title,
    });
    setCompetencyGenModalOpen(true);
    void loadCompanyProfileForPracticeGen(activeOrgId);
  }

  function closeCompetencyGenModal() {
    setCompetencyGenModalOpen(false);
    setCompetencyGenContext(null);
    setCompetencyGenLoading(false);
    setCompetencyGenError(null);
    setCompetencyGenAccepting(false);
    setCompetencyGenRows([]);
  }

  async function handleGenerateCompetenciesPreview() {
    if (!activeOrgId || !competencyGenContext) return;
    setCompetencyGenError(null);
    setCompetencyGenLoading(true);
    try {
      const existingNames = competencies
        .filter((c) => c.subject_id === competencyGenContext.subjectId)
        .map((c) => c.name.trim())
        .filter(Boolean);
      const result = await generateCompetenciesWithAi({
        companyProfile,
        practiceName: competencyGenContext.practiceTitle,
        subjectName: competencyGenContext.subjectName,
        subjectDescription: competencyGenContext.subjectDescription,
        existingCompetencyNames: existingNames,
      });
      setCompetencyGenRows(
        result.competencies.map((c) => ({
          id: crypto.randomUUID(),
          name: c.name,
          description: c.description,
          selected: true,
        }))
      );
    } catch (e) {
      setCompetencyGenError(
        e instanceof Error ? e.message : "Generation failed."
      );
    } finally {
      setCompetencyGenLoading(false);
    }
  }

  async function handleAcceptCompetencyGenerated() {
    if (!activeOrgId || !competencyGenContext) return;
    const rows = competencyGenRows.filter((r) => r.selected && r.name.trim());
    if (rows.length === 0) {
      alert("Select at least one competency with a name.");
      return;
    }
    const sid = competencyGenContext.subjectId;

    const seenBatch = new Set<string>();
    const rowsDeduped: typeof rows = [];
    for (const r of rows) {
      const k = normalizeCompetencyNameKey(r.name);
      if (!k) continue;
      if (seenBatch.has(k)) continue;
      seenBatch.add(k);
      rowsDeduped.push(r);
    }

    const orgNameToExisting = new Map<string, { subjectName: string }>();
    for (const c of competencies) {
      const k = normalizeCompetencyNameKey(c.name);
      if (!k) continue;
      if (orgNameToExisting.has(k)) continue;
      const subj = subjects.find((s) => s.id === c.subject_id);
      orgNameToExisting.set(k, {
        subjectName: subj?.name?.trim() || "Unknown subject",
      });
    }

    const exactDuplicates: { name: string; existingSubjectName: string }[] =
      [];
    const insertable: typeof rows = [];
    for (const r of rowsDeduped) {
      const k = normalizeCompetencyNameKey(r.name);
      const existing = orgNameToExisting.get(k);
      if (existing) {
        exactDuplicates.push({
          name: r.name.trim(),
          existingSubjectName: existing.subjectName,
        });
      } else {
        insertable.push(r);
      }
    }

    if (insertable.length === 0) {
      if (exactDuplicates.length > 0) {
        const lines = exactDuplicates
          .slice(0, 12)
          .map(
            (d) =>
              `• ${d.name} (already under: ${d.existingSubjectName})`
          )
          .join("\n");
        alert(
          `Some selected competencies already exist in this organisation and were not added.\n\n${lines}${
            exactDuplicates.length > 12 ? "\n…" : ""
          }`
        );
      } else {
        alert("Nothing to create.");
      }
      return;
    }

    if (exactDuplicates.length > 0) {
      const lines = exactDuplicates
        .slice(0, 10)
        .map(
          (d) =>
            `• ${d.name} — already exists under “${d.existingSubjectName}”`
        )
        .join("\n");
      const ok = window.confirm(
        `Some selected competencies already exist in this organisation and were not added:\n\n${lines}${
          exactDuplicates.length > 10 ? "\n…" : ""
        }\n\nCreate ${insertable.length} new competency row(s)?`
      );
      if (!ok) return;
    }

    const similarRisky: { name: string; matches: CompetencyRow[] }[] = [];
    for (const r of insertable) {
      const sim = findSimilarCompetencies(r.name, competencies).filter(
        (c) =>
          c.subject_id !== sid ||
          c.name.trim().toLowerCase() !== r.name.trim().toLowerCase()
      );
      if (sim.length > 0) {
        similarRisky.push({ name: r.name.trim(), matches: sim });
      }
    }
    if (similarRisky.length > 0) {
      const lines = similarRisky
        .slice(0, 5)
        .map(
          (x) =>
            `• ${x.name} (similar to: ${x.matches
              .slice(0, 2)
              .map((m) => m.name)
              .join(", ")})`
        )
        .join("\n");
      const ok = window.confirm(
        `Some generated names are similar to existing competencies in your catalogue:\n\n${lines}${
          similarRisky.length > 5 ? "\n…" : ""
        }\n\nCreate these new rows anyway?`
      );
      if (!ok) return;
    }

    setCompetencyGenAccepting(true);
    try {
      const subjectForAlign = subjects.find((s) => s.id === sid);
      const alignedFromSubject = normalizeSubjectTypeForAlignment(
        subjectForAlign
      );
      const resolvedGenType = toCompetencyTypeUnion(
        alignedFromSubject || "practice"
      );
      for (const row of insertable) {
        const { data: insertedRow, error } = await supabase
          .from("competencies")
          .insert({
            organisation_id: activeOrgId,
            name: row.name.trim(),
            description: row.description.trim() || null,
            competency_type: resolvedGenType,
            is_active: true,
            subject_id: sid,
            status: "active",
          })
          .select("id")
          .single();
        if (error || !insertedRow) {
          console.error(error);
          if (error?.code === "23505") {
            alert(
              "A competency with this name already exists in this organisation. It was not added."
            );
          } else {
            alert(error?.message || "Failed to create a competency.");
          }
          return;
        }
        const { error: levErr } = await insertDefaultCompetencyLevels(
          supabase,
          insertedRow.id
        );
        if (levErr) {
          console.error(levErr);
          alert(
            levErr.message ||
              "A competency was created but default proficiency levels could not be added."
          );
          return;
        }
      }
      await reloadCompetenciesForOrg(activeOrgId);
      closeCompetencyGenModal();
    } finally {
      setCompetencyGenAccepting(false);
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
          Competency type
          <select
            value={newCompetencyType}
            onChange={(e) =>
              setNewCompetencyType(e.target.value as CompetencyType)
            }
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
              border: competencySubjectTypeMismatchCreate
                ? `2px solid ${COMPETENCY_SUBJECT_TYPE_WARN_BORDER}`
                : `1px solid ${border}`,
              borderRadius: 8,
            }}
          >
            <option value="organisation">Organisation</option>
            <option value="practice">Practice</option>
            <option value="stretch">Stretch</option>
          </select>
          {competencySubjectTypeMismatchCreate ? (
            <span
              style={{
                fontSize: 12,
                color: COMPETENCY_SUBJECT_TYPE_WARN_BORDER,
                display: "flex",
                gap: 6,
                alignItems: "center",
                lineHeight: 1.35,
              }}
              role="status"
            >
              <span aria-hidden>⚠</span>
              {COMPETENCY_SUBJECT_TYPE_WARN_MSG}
            </span>
          ) : null}
        </label>
        {!isInline ? (
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
        ) : null}
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

  function renderPromptExpansionPreview() {
    const h = practiceGenExpansionHierarchy;
    if (!h) return null;
    return (
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
          {h.map((pr) => {
            const practiceCollides = practices.some(
              (p) =>
                p.name.trim().toLowerCase() === pr.name.trim().toLowerCase()
            );
            return (
              <div
                key={pr.id}
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
                    checked={pr.selected}
                    onChange={(e) =>
                      setPracticeGenExpansionHierarchy((prev) =>
                        prev
                          ? prev.map((p) =>
                              p.id === pr.id
                                ? { ...p, selected: e.target.checked }
                                : p
                            )
                          : null
                      )
                    }
                    disabled={practiceGenAccepting}
                    style={{ marginTop: 3 }}
                  />
                  <span style={{ flex: 1 }}>
                    Include practice
                    {practiceCollides ? (
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
                  Practice name
                  <input
                    value={pr.name}
                    onChange={(e) =>
                      setPracticeGenExpansionHierarchy((prev) =>
                        prev
                          ? prev.map((p) =>
                              p.id === pr.id
                                ? { ...p, name: e.target.value }
                                : p
                            )
                          : null
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
                    value={pr.description}
                    onChange={(e) =>
                      setPracticeGenExpansionHierarchy((prev) =>
                        prev
                          ? prev.map((p) =>
                              p.id === pr.id
                                ? { ...p, description: e.target.value }
                                : p
                            )
                          : null
                      )
                    }
                    disabled={practiceGenAccepting}
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
                {pr.subjects.map((sub) => (
                  <div
                    key={sub.id}
                    style={{
                      marginTop: 12,
                      marginLeft: 10,
                      paddingLeft: 12,
                      borderLeft: `2px solid ${borderSubtle}`,
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
                        checked={sub.selected}
                        onChange={(e) =>
                          setPracticeGenExpansionHierarchy((prev) =>
                            prev
                              ? prev.map((p) =>
                                  p.id === pr.id
                                    ? {
                                        ...p,
                                        subjects: p.subjects.map((s) =>
                                          s.id === sub.id
                                            ? {
                                                ...s,
                                                selected: e.target.checked,
                                              }
                                            : s
                                        ),
                                      }
                                    : p
                                )
                              : null
                          )
                        }
                        disabled={practiceGenAccepting}
                        style={{ marginTop: 3 }}
                      />
                      <span style={{ flex: 1 }}>Include subject</span>
                    </label>
                    <label
                      style={{
                        display: "grid",
                        gap: 6,
                        fontSize: 13,
                        color: mutedColor,
                        marginTop: 8,
                      }}
                    >
                      Subject name
                      <input
                        value={sub.name}
                        onChange={(e) =>
                          setPracticeGenExpansionHierarchy((prev) =>
                            prev
                              ? prev.map((p) =>
                                  p.id === pr.id
                                    ? {
                                        ...p,
                                        subjects: p.subjects.map((s) =>
                                          s.id === sub.id
                                            ? { ...s, name: e.target.value }
                                            : s
                                        ),
                                      }
                                    : p
                                )
                              : null
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
                        marginTop: 8,
                      }}
                    >
                      Description
                      <textarea
                        value={sub.description}
                        onChange={(e) =>
                          setPracticeGenExpansionHierarchy((prev) =>
                            prev
                              ? prev.map((p) =>
                                  p.id === pr.id
                                    ? {
                                        ...p,
                                        subjects: p.subjects.map((s) =>
                                          s.id === sub.id
                                            ? {
                                                ...s,
                                                description: e.target.value,
                                              }
                                            : s
                                        ),
                                      }
                                    : p
                                )
                              : null
                          )
                        }
                        disabled={practiceGenAccepting}
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
                    {sub.competencies.map((comp) => (
                      <div
                        key={comp.id}
                        style={{
                          marginTop: 10,
                          marginLeft: 8,
                          paddingLeft: 10,
                          borderLeft: `1px solid ${borderSubtle}`,
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
                            checked={comp.selected}
                            onChange={(e) =>
                              setPracticeGenExpansionHierarchy((prev) =>
                                prev
                                  ? prev.map((p) =>
                                      p.id === pr.id
                                        ? {
                                            ...p,
                                            subjects: p.subjects.map((s) =>
                                              s.id === sub.id
                                                ? {
                                                    ...s,
                                                    competencies:
                                                      s.competencies.map((c) =>
                                                        c.id === comp.id
                                                          ? {
                                                              ...c,
                                                              selected:
                                                                e.target
                                                                  .checked,
                                                            }
                                                          : c
                                                      ),
                                                  }
                                                : s
                                            ),
                                          }
                                        : p
                                    )
                                  : null
                              )
                            }
                            disabled={practiceGenAccepting}
                            style={{ marginTop: 3 }}
                          />
                          <span style={{ flex: 1 }}>Include competency</span>
                        </label>
                        <label
                          style={{
                            display: "grid",
                            gap: 6,
                            fontSize: 13,
                            color: mutedColor,
                            marginTop: 6,
                          }}
                        >
                          Competency name
                          <input
                            value={comp.name}
                            onChange={(e) =>
                              setPracticeGenExpansionHierarchy((prev) =>
                                prev
                                  ? prev.map((p) =>
                                      p.id === pr.id
                                        ? {
                                            ...p,
                                            subjects: p.subjects.map((s) =>
                                              s.id === sub.id
                                                ? {
                                                    ...s,
                                                    competencies:
                                                      s.competencies.map((c) =>
                                                        c.id === comp.id
                                                          ? {
                                                              ...c,
                                                              name: e.target
                                                                .value,
                                                            }
                                                          : c
                                                      ),
                                                  }
                                                : s
                                            ),
                                          }
                                        : p
                                    )
                                  : null
                              )
                            }
                            disabled={practiceGenAccepting}
                            style={{
                              padding: "8px 10px",
                              fontSize: 14,
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
                            marginTop: 6,
                          }}
                        >
                          Description
                          <textarea
                            value={comp.description}
                            onChange={(e) =>
                              setPracticeGenExpansionHierarchy((prev) =>
                                prev
                                  ? prev.map((p) =>
                                      p.id === pr.id
                                        ? {
                                            ...p,
                                            subjects: p.subjects.map((s) =>
                                              s.id === sub.id
                                                ? {
                                                    ...s,
                                                    competencies:
                                                      s.competencies.map((c) =>
                                                        c.id === comp.id
                                                          ? {
                                                              ...c,
                                                              description:
                                                                e.target
                                                                  .value,
                                                            }
                                                          : c
                                                      ),
                                                  }
                                                : s
                                            ),
                                          }
                                        : p
                                    )
                                  : null
                              )
                            }
                            disabled={practiceGenAccepting}
                            rows={2}
                            style={{
                              padding: "8px 10px",
                              fontSize: 14,
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
                    ))}
                  </div>
                ))}
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
            onClick={() => closePracticeGenModal()}
            style={btn}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={practiceGenAccepting}
            onClick={() => void handleAcceptPromptExpansion()}
            style={{
              ...btnPrimary,
              opacity: practiceGenAccepting ? 0.7 : 1,
            }}
          >
            {practiceGenAccepting ? "Creating…" : "Accept"}
          </button>
        </div>
      </>
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
                              value={viewMode}
                              onChange={(e) =>
                                setViewMode(
                                  e.target.value as
                                    | "all"
                                    | "practice"
                                    | "organisation"
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
                              <option value="practice">Practice</option>
                              <option value="organisation">Organisation</option>
                            </select>
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
                            Lifecycle
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

                        {viewMode !== "organisation" && (
                          <>
                        <div
                          style={{
                            width: "100%",
                            marginTop: 0,
                            marginBottom: 0,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: text,
                              marginBottom: 8,
                              letterSpacing: "-0.01em",
                            }}
                          >
                            Expand capability model
                          </div>
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "nowrap",
                              alignItems: "center",
                              gap: 8,
                              width: "100%",
                            }}
                          >
                            <input
                              type="text"
                              value={expansionPrompt}
                              onChange={(e) => {
                                setExpansionPrompt(e.target.value);
                                setExpansionPromptError(null);
                              }}
                              disabled={
                                isSavingPractice ||
                                isSavingSubject ||
                                isSavingCompetency ||
                                isSavingLevel ||
                                isSavingEditCompetency ||
                                isSavingEditSubject ||
                                isGeneratingExpansion
                              }
                              placeholder="Describe what you want to add (e.g. Add a Customer and Service Design function)"
                              style={{
                                flex: "1 1 auto",
                                minWidth: 0,
                                padding: "8px 10px",
                                fontSize: 14,
                                color: text,
                                backgroundColor: surface,
                                border: `1px solid ${border}`,
                                borderRadius: 8,
                                boxSizing: "border-box" as const,
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => void handleGenerateFromPrompt()}
                              disabled={
                                !expansionPrompt.trim() ||
                                isSavingPractice ||
                                isSavingSubject ||
                                isSavingCompetency ||
                                isSavingLevel ||
                                isSavingEditCompetency ||
                                isSavingEditSubject ||
                                isGeneratingExpansion
                              }
                              style={{
                                ...btnSecondary,
                                flex: "0 0 auto",
                                margin: 0,
                                padding: "8px 12px",
                                fontSize: 13,
                                whiteSpace: "nowrap",
                                opacity:
                                  !expansionPrompt.trim() ||
                                  isGeneratingExpansion
                                    ? 0.55
                                    : 1,
                              }}
                            >
                              {isGeneratingExpansion
                                ? "Generating…"
                                : "Generate Suggestions"}
                            </button>
                          </div>
                          {expansionPromptError ? (
                            <p
                              style={{
                                margin: "6px 0 0",
                                fontSize: 12,
                                color: errorColor,
                                lineHeight: 1.35,
                              }}
                            >
                              {expansionPromptError}
                            </p>
                          ) : null}
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
                            marginTop: 14,
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

                        {(viewMode === "all" || viewMode === "practice") && (
                          <h3
                            style={{
                              margin: "14px 0 8px",
                              fontSize: 14,
                              fontWeight: 600,
                              color: text,
                              letterSpacing: "0.02em",
                            }}
                          >
                            Practice competencies
                          </h3>
                        )}

                        <div
                          style={{
                            marginTop: 14,
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                          }}
                        >
                          {managementPracticeGroups.map((practice) => {
                            const hierarchyTree =
                              "practice" as "practice" | "organisation";
                            const practiceRow = practice.isUnassigned
                              ? null
                              : practices.find((p) => p.id === practice.key);
                            const practiceLife = practiceRow
                              ? parseLifecycleStatus(practiceRow.status)
                              : null;
                            const practiceExpanded =
                              hierarchyTree === "organisation"
                                ? isOrgPracticeAccordionExpanded(practice.key)
                                : isPracticeAccordionExpanded(practice.key);
                            return (
                            <div
                              key={practice.key}
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 0,
                                borderBottom: `1px solid ${border}`,
                                paddingBottom: 10,
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "flex-start",
                                  gap: 8,
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    hierarchyTree === "organisation"
                                      ? toggleOrgPracticeAccordion(practice.key)
                                      : togglePracticeAccordion(practice.key)
                                  }
                                  aria-expanded={practiceExpanded}
                                  aria-label={
                                    practiceExpanded
                                      ? "Collapse practice"
                                      : "Expand practice"
                                  }
                                  style={{
                                    flexShrink: 0,
                                    marginTop: 2,
                                    padding: "2px 6px",
                                    border: `1px solid ${border}`,
                                    borderRadius: 6,
                                    backgroundColor: bg,
                                    cursor: "pointer",
                                    font: "inherit",
                                    color: mutedColor,
                                    lineHeight: 1,
                                    fontSize: 12,
                                  }}
                                >
                                  {practiceExpanded ? "▼" : "▶"}
                                </button>
                                <div style={{ flex: 1, minWidth: 0 }}>
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
                                        fontWeight: 700,
                                        fontSize: 15,
                                        color: text,
                                        letterSpacing: "-0.02em",
                                      }}
                                    >
                                      {practice.title}
                                    </span>
                                    {practiceRow
                                      ? renderLifecycleBadge(
                                          practiceRow.status
                                        )
                                      : null}
                                  </div>
                                  {practice.description ? (
                                    <p
                                      style={{
                                        margin: "4px 0 0",
                                        fontSize: 13,
                                        color: mutedColor,
                                        lineHeight: 1.45,
                                        ...(practiceExpanded
                                          ? {
                                              display: "-webkit-box",
                                              WebkitLineClamp: 2,
                                              WebkitBoxOrient: "vertical" as const,
                                              overflow: "hidden",
                                            }
                                          : {
                                              overflow: "hidden",
                                              textOverflow: "ellipsis",
                                              whiteSpace: "nowrap" as const,
                                            }),
                                      }}
                                    >
                                      {practice.description}
                                    </p>
                                  ) : null}
                                </div>
                                {practiceRow ? (
                                  <div
                                    style={{
                                      display: "flex",
                                      flexDirection: "column",
                                      justifyContent: "flex-start",
                                      gap: 4,
                                      padding: "0 0 0 4px",
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
                                          fontSize: 11,
                                          padding: "4px 8px",
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
                                          fontSize: 11,
                                          padding: "4px 8px",
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
                                          fontSize: 11,
                                          padding: "4px 8px",
                                        }}
                                      >
                                        Archive
                                      </button>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                              {canAuthorHierarchy ? (
                                <div
                                  style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: 8,
                                    alignItems: "center",
                                    marginTop: 8,
                                    paddingLeft: 30,
                                  }}
                                >
                                  <button
                                    type="button"
                                    onClick={() =>
                                      openCreateSubjectForPractice(practice)
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
                                      ...btnPrimary,
                                      fontSize: 12,
                                      padding: "6px 10px",
                                    }}
                                  >
                                    Add Subject
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      openSubjectGenModal(practice)
                                    }
                                    disabled={
                                      isSavingPractice ||
                                      isSavingSubject ||
                                      isSavingCompetency ||
                                      isSavingLevel ||
                                      isSavingEditCompetency ||
                                      isSavingEditSubject ||
                                      subjectGenLoading
                                    }
                                    style={{
                                      ...btnSecondary,
                                      fontSize: 12,
                                      padding: "6px 10px",
                                    }}
                                  >
                                    Generate Subjects
                                  </button>
                                </div>
                              ) : (
                                <p
                                  style={{
                                    margin: "6px 0 0",
                                    paddingLeft: 30,
                                    fontSize: 12,
                                    color: mutedColor,
                                    lineHeight: 1.45,
                                  }}
                                >
                                  Subject and competency authoring requires
                                  management access.
                                </p>
                              )}
                              <AccordionCollapsible
                                open={practiceExpanded}
                              >
                                <div
                                  style={{
                                    paddingLeft: 10,
                                    borderLeft: `1px solid ${borderSubtle}`,
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 10,
                                  }}
                                >
                          {subjectCreatePracticeKey === practice.key &&
                          (hierarchyTree === "organisation"
                            ? subjectCreateFromOrganisationTree
                            : !subjectCreateFromOrganisationTree) ? (
                            <form
                              onSubmit={(e) => void handleSaveNewSubject(e)}
                              style={{
                                padding: "14px 14px",
                                borderRadius: 8,
                                backgroundColor: bg,
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
                                  color: accent,
                                }}
                              >
                                New subject in{" "}
                                {practice.isUnassigned
                                  ? "Unassigned Practice"
                                  : practice.title}
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
                                Subject type
                                <select
                                  value={newSubjectType}
                                  onChange={(e) =>
                                    setNewSubjectType(
                                      e.target.value as CompetencyType
                                    )
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
                                  <option value="practice">Practice</option>
                                  <option value="organisation">
                                    Organisation
                                  </option>
                                  <option value="stretch">Stretch</option>
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
                          ) : null}
                          {practice.subjectSections.length === 0 &&
                          (subjectCreatePracticeKey !== practice.key ||
                            subjectCreateFromOrganisationTree !==
                              (hierarchyTree === "organisation")) ? (
                            <p
                              style={{
                                margin: 0,
                                fontSize: 13,
                                color: mutedColor,
                              }}
                            >
                              No subjects in this practice yet. Use{" "}
                              <strong style={{ color: text }}>
                                Add Subject
                              </strong>{" "}
                              to create one.
                            </p>
                          ) : null}
                          {practice.subjectSections.map((section) => {
                            const sectionKey =
                              String(section.key ?? "").trim() ||
                              UNASSIGNED_SUBJECT_KEY;
                            const sectionInlineKey = sectionKey;
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
                              inlineCompetencySectionKey !== sectionInlineKey;
                            const isEditingThisSubject =
                              editingSubjectId === sectionKey &&
                              !section.isUnassigned;
                            return (
                              <div
                                key={sectionKey}
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 10,
                                  opacity: dimOtherSubjects ? 0.68 : 1,
                                  transition: "opacity 0.22s ease",
                                }}
                              >
                                {isEditingThisSubject ? (
                                  <div
                                    style={{
                                      display: "flex",
                                      flexDirection: "column",
                                      gap: 12,
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
                                        Subject type
                                        <select
                                          value={editSubjectType}
                                          onChange={(e) =>
                                            setEditSubjectType(
                                              e.target.value as CompetencyType
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
                                          <option value="practice">
                                            Practice
                                          </option>
                                          <option value="organisation">
                                            Organisation
                                          </option>
                                          <option value="stretch">
                                            Stretch
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
                                        sectionKey,
                                        hierarchyTree
                                      )}
                                    >
                                      <div
                                        style={{
                                          display: "flex",
                                          flexDirection: "column",
                                          gap: 10,
                                          padding: "0 0 6px",
                                        }}
                                      >
                                        {inlineCompetencySectionKey ===
                                        sectionInlineKey ? (
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
                                              padding: "8px 0 4px",
                                              borderTop: `1px solid ${borderSubtle}`,
                                            }}
                                          >
                                            <p
                                              style={{
                                                ...muted,
                                                margin: 0,
                                                fontSize: 12,
                                              }}
                                            >
                                              No competencies added yet
                                            </p>
                                            <div
                                              style={{
                                                display: "flex",
                                                flexWrap: "wrap",
                                                gap: 8,
                                                marginTop: 8,
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
                                                    sectionInlineKey,
                                                    hierarchyTree
                                                  )
                                                }
                                                disabled={
                                                  !canAuthorHierarchy ||
                                                  isSavingCompetency ||
                                                  isSavingLevel ||
                                                  isSavingSubject ||
                                                  isSavingEditCompetency ||
                                                  isSavingEditSubject
                                                }
                                                title={
                                                  !canAuthorHierarchy
                                                    ? "Requires management access"
                                                    : undefined
                                                }
                                                style={{
                                                  ...btnPrimary,
                                                  flex: "1 1 160px",
                                                  boxSizing:
                                                    "border-box" as const,
                                                }}
                                              >
                                                Add Competency
                                              </button>
                                              {!section.isUnassigned &&
                                              canAuthorHierarchy &&
                                              subjRow ? (
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    openCompetencyGenModal(
                                                      practice,
                                                      section
                                                    )
                                                  }
                                                  disabled={
                                                    !canAuthorHierarchy ||
                                                    isSavingCompetency ||
                                                    isSavingLevel ||
                                                    isSavingSubject ||
                                                    isSavingEditCompetency ||
                                                    isSavingEditSubject ||
                                                    competencyGenLoading
                                                  }
                                                  style={{
                                                    ...btnGhost,
                                                    flex: "1 1 160px",
                                                    boxSizing:
                                                      "border-box" as const,
                                                  }}
                                                >
                                                  Generate Competencies
                                                </button>
                                              ) : null}
                                            </div>
                                          </div>
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
                                            {sectionItems.map((c) => (
                                              <li
                                                key={c.id}
                                                id={`comp-row-${c.id}`}
                                                onMouseEnter={() =>
                                                  setCompetencyRowHoverId(c.id)
                                                }
                                                onMouseLeave={() =>
                                                  setCompetencyRowHoverId(null)
                                                }
                                                style={{
                                                  padding: "8px 0",
                                                  borderBottom: `1px solid ${borderSubtle}`,
                                                  listStyle: "none",
                                                  backgroundColor:
                                                    highlightCompetencyId ===
                                                    c.id
                                                      ? "rgba(110, 176, 240, 0.12)"
                                                      : competencyRowHoverId ===
                                                          c.id
                                                        ? "rgba(255,255,255,0.04)"
                                                        : "transparent",
                                                  transition:
                                                    "background-color 0.2s ease",
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
                                                      Competency type
                                                      <select
                                                        value={editCompetencyType}
                                                        onChange={(e) =>
                                                          setEditCompetencyType(
                                                            e.target
                                                              .value as CompetencyType
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
                                                          border:
                                                            competencySubjectTypeMismatchEdit
                                                              ? `2px solid ${COMPETENCY_SUBJECT_TYPE_WARN_BORDER}`
                                                              : `1px solid ${border}`,
                                                          borderRadius: 8,
                                                        }}
                                                      >
                                                        <option value="organisation">
                                                          Organisation
                                                        </option>
                                                        <option value="practice">
                                                          Practice
                                                        </option>
                                                        <option value="stretch">
                                                          Stretch
                                                        </option>
                                                      </select>
                                                      {competencySubjectTypeMismatchEdit ? (
                                                        <span
                                                          style={{
                                                            fontSize: 12,
                                                            color:
                                                              COMPETENCY_SUBJECT_TYPE_WARN_BORDER,
                                                            display: "flex",
                                                            gap: 6,
                                                            alignItems:
                                                              "center",
                                                            lineHeight: 1.35,
                                                          }}
                                                          role="status"
                                                        >
                                                          <span aria-hidden>
                                                            ⚠
                                                          </span>
                                                          {
                                                            COMPETENCY_SUBJECT_TYPE_WARN_MSG
                                                          }
                                                        </span>
                                                      ) : null}
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
                                                        <CompetencyTypeBadge
                                                          type={toCompetencyTypeUnion(
                                                            normalizeCompetencyType(
                                                              c.competency_type
                                                            )
                                                          )}
                                                        />
                                                        {renderLifecycleBadge(
                                                          c.status
                                                        )}
                                                      </div>
                                                      {c.description != null &&
                                                      c.description.trim() !==
                                                        "" ? (
                                                        <div
                                                          style={{
                                                            marginTop: 4,
                                                            fontSize: 12,
                                                            color: mutedColor,
                                                            lineHeight: 1.45,
                                                            display:
                                                              "-webkit-box",
                                                            WebkitLineClamp: 2,
                                                            WebkitBoxOrient:
                                                              "vertical" as const,
                                                            overflow: "hidden",
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
                                                        gap: 6,
                                                        justifyContent:
                                                          "flex-end",
                                                        opacity:
                                                          competencyRowHoverId ===
                                                          c.id
                                                            ? 1
                                                            : 0.4,
                                                        transition:
                                                          "opacity 0.18s ease",
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
                                      borderBottom: `1px solid ${borderSubtle}`,
                                    }}
                                  >
                                    <div
                                      style={{
                                        padding: "4px 0 8px",
                                      }}
                                    >
                                      <div
                                        style={{
                                          display: "flex",
                                          flexWrap: "wrap",
                                          alignItems: "flex-start",
                                          gap: 8,
                                        }}
                                      >
                                        <button
                                          type="button"
                                          onClick={() =>
                                            toggleSubjectAccordion(
                                              practice.key,
                                              sectionKey,
                                              hierarchyTree
                                            )
                                          }
                                          aria-expanded={isSubjectAccordionExpanded(
                                            practice.key,
                                            sectionKey,
                                            sectionKey,
                                            hierarchyTree
                                          )}
                                          title={
                                            isSubjectAccordionExpanded(
                                              practice.key,
                                              sectionKey,
                                              sectionKey,
                                              hierarchyTree
                                            )
                                              ? "Collapse subject"
                                              : "Expand subject"
                                          }
                                          style={{
                                            flexShrink: 0,
                                            marginTop: 1,
                                            padding: "2px 6px",
                                            border: `1px solid ${border}`,
                                            borderRadius: 6,
                                            backgroundColor: bg,
                                            cursor: "pointer",
                                            font: "inherit",
                                            color: mutedColor,
                                            lineHeight: 1,
                                            fontSize: 12,
                                          }}
                                        >
                                          {isSubjectAccordionExpanded(
                                            practice.key,
                                            sectionKey,
                                            sectionKey,
                                            hierarchyTree
                                          )
                                            ? "▼"
                                            : "▶"}
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
                                                sectionInlineKey,
                                                hierarchyTree
                                              )
                                            }
                                            disabled={
                                              !canAuthorHierarchy ||
                                              isSavingCompetency ||
                                              isSavingLevel ||
                                              isSavingSubject ||
                                              isSavingEditCompetency ||
                                              isSavingEditSubject
                                            }
                                            title={
                                              !canAuthorHierarchy
                                                ? "Requires management access"
                                                : undefined
                                            }
                                            style={{
                                              ...btnPrimary,
                                              fontSize: 12,
                                              padding: "7px 12px",
                                            }}
                                          >
                                            Add Competency
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
                                                onClick={() =>
                                                  openCompetencyGenModal(
                                                    practice,
                                                    section
                                                  )
                                                }
                                                disabled={
                                                  !canAuthorHierarchy ||
                                                  !subjRow ||
                                                  isSavingCompetency ||
                                                  isSavingLevel ||
                                                  isSavingSubject ||
                                                  isSavingEditCompetency ||
                                                  isSavingEditSubject ||
                                                  competencyGenLoading
                                                }
                                                title={
                                                  !canAuthorHierarchy
                                                    ? "Requires management access"
                                                    : !subjRow
                                                      ? "Subject required"
                                                      : "AI-generate competencies for this subject"
                                                }
                                                style={{
                                                  ...btnGhost,
                                                  fontSize: 12,
                                                  padding: "7px 12px",
                                                }}
                                              >
                                                Generate Competencies
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
                                        sectionKey,
                                        hierarchyTree
                                      )}
                                    >
                                      <div
                                        style={{
                                          display: "flex",
                                          flexDirection: "column",
                                          gap: 10,
                                          padding: "0 0 6px",
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
                                        sectionInlineKey ? (
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
                                              padding: "8px 0 4px",
                                              borderTop: `1px solid ${borderSubtle}`,
                                            }}
                                          >
                                            <p
                                              style={{
                                                ...muted,
                                                margin: 0,
                                                fontSize: 12,
                                              }}
                                            >
                                              No competencies added yet
                                            </p>
                                            <div
                                              style={{
                                                display: "flex",
                                                flexWrap: "wrap",
                                                gap: 8,
                                                marginTop: 8,
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
                                                    sectionInlineKey,
                                                    hierarchyTree
                                                  )
                                                }
                                                disabled={
                                                  !canAuthorHierarchy ||
                                                  isSavingCompetency ||
                                                  isSavingLevel ||
                                                  isSavingSubject ||
                                                  isSavingEditCompetency ||
                                                  isSavingEditSubject
                                                }
                                                title={
                                                  !canAuthorHierarchy
                                                    ? "Requires management access"
                                                    : undefined
                                                }
                                                style={{
                                                  ...btnPrimary,
                                                  flex: "1 1 160px",
                                                  boxSizing:
                                                    "border-box" as const,
                                                }}
                                              >
                                                Add Competency
                                              </button>
                                              {!section.isUnassigned &&
                                              canAuthorHierarchy &&
                                              subjRow ? (
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    openCompetencyGenModal(
                                                      practice,
                                                      section
                                                    )
                                                  }
                                                  disabled={
                                                    !canAuthorHierarchy ||
                                                    isSavingCompetency ||
                                                    isSavingLevel ||
                                                    isSavingSubject ||
                                                    isSavingEditCompetency ||
                                                    isSavingEditSubject ||
                                                    competencyGenLoading
                                                  }
                                                  style={{
                                                    ...btnGhost,
                                                    flex: "1 1 160px",
                                                    boxSizing:
                                                      "border-box" as const,
                                                  }}
                                                >
                                                  Generate Competencies
                                                </button>
                                              ) : null}
                                            </div>
                                          </div>
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
                                            {sectionItems.map((c) => (
                                              <li
                                                key={c.id}
                                                id={`comp-row-${c.id}`}
                                                onMouseEnter={() =>
                                                  setCompetencyRowHoverId(c.id)
                                                }
                                                onMouseLeave={() =>
                                                  setCompetencyRowHoverId(null)
                                                }
                                                style={{
                                                  padding: "8px 0",
                                                  borderBottom: `1px solid ${borderSubtle}`,
                                                  listStyle: "none",
                                                  backgroundColor:
                                                    highlightCompetencyId ===
                                                    c.id
                                                      ? "rgba(110, 176, 240, 0.12)"
                                                      : competencyRowHoverId ===
                                                          c.id
                                                        ? "rgba(255,255,255,0.04)"
                                                        : "transparent",
                                                  transition:
                                                    "background-color 0.2s ease",
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
                                                      Competency type
                                                      <select
                                                        value={editCompetencyType}
                                                        onChange={(e) =>
                                                          setEditCompetencyType(
                                                            e.target
                                                              .value as CompetencyType
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
                                                          border:
                                                            competencySubjectTypeMismatchEdit
                                                              ? `2px solid ${COMPETENCY_SUBJECT_TYPE_WARN_BORDER}`
                                                              : `1px solid ${border}`,
                                                          borderRadius: 8,
                                                        }}
                                                      >
                                                        <option value="organisation">
                                                          Organisation
                                                        </option>
                                                        <option value="practice">
                                                          Practice
                                                        </option>
                                                        <option value="stretch">
                                                          Stretch
                                                        </option>
                                                      </select>
                                                      {competencySubjectTypeMismatchEdit ? (
                                                        <span
                                                          style={{
                                                            fontSize: 12,
                                                            color:
                                                              COMPETENCY_SUBJECT_TYPE_WARN_BORDER,
                                                            display: "flex",
                                                            gap: 6,
                                                            alignItems:
                                                              "center",
                                                            lineHeight: 1.35,
                                                          }}
                                                          role="status"
                                                        >
                                                          <span aria-hidden>
                                                            ⚠
                                                          </span>
                                                          {
                                                            COMPETENCY_SUBJECT_TYPE_WARN_MSG
                                                          }
                                                        </span>
                                                      ) : null}
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
                                                        <CompetencyTypeBadge
                                                          type={toCompetencyTypeUnion(
                                                            normalizeCompetencyType(
                                                              c.competency_type
                                                            )
                                                          )}
                                                        />
                                                        {renderLifecycleBadge(
                                                          c.status
                                                        )}
                                                      </div>
                                                      {c.description != null &&
                                                      c.description.trim() !==
                                                        "" ? (
                                                        <div
                                                          style={{
                                                            marginTop: 4,
                                                            fontSize: 12,
                                                            color: mutedColor,
                                                            lineHeight: 1.45,
                                                            display:
                                                              "-webkit-box",
                                                            WebkitLineClamp: 2,
                                                            WebkitBoxOrient:
                                                              "vertical" as const,
                                                            overflow: "hidden",
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
                                                        gap: 6,
                                                        justifyContent:
                                                          "flex-end",
                                                        opacity:
                                                          competencyRowHoverId ===
                                                          c.id
                                                            ? 1
                                                            : 0.4,
                                                        transition:
                                                          "opacity 0.18s ease",
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
                            );
                          })}
                        </div>
                          </>
                        )}
                        {(viewMode === "all" || viewMode === "organisation") ? (
                          <div
                            style={{
                              marginTop: viewMode === "organisation" ? 0 : 20,
                              paddingTop:
                                viewMode === "organisation" ? 0 : 12,
                              borderTop:
                                viewMode === "organisation"
                                  ? "none"
                                  : `1px solid ${borderSubtle}`,
                            }}
                          >
                            <h3
                              style={{
                                margin: "0 0 12px",
                                fontSize: 14,
                                fontWeight: 600,
                                color: text,
                                letterSpacing: "0.02em",
                              }}
                            >
                              Organisational competencies
                            </h3>
                            {organisationalGroupedBySubject.length === 0 &&
                            !orgPanelEditing &&
                            !orgPanelLevels ? (
                              <p
                                style={{
                                  margin: "0 0 12px",
                                  fontSize: 13,
                                  color: mutedColor,
                                  lineHeight: 1.45,
                                }}
                              >
                                No organisational competencies in this
                                workspace yet.
                              </p>
                            ) : null}
                            <div style={{ marginTop: 14 }}>
                            {organisationalGroupedBySubject.map(
                              ([subjectLabel, items]) => (
                                <div
                                  key={subjectLabel}
                                  style={{ marginBottom: 14 }}
                                >
                                  <div
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 600,
                                      color: mutedColor,
                                      marginBottom: 6,
                                      letterSpacing: "0.06em",
                                      textTransform: "uppercase",
                                    }}
                                  >
                                    {subjectLabel}
                                  </div>
                                  <ul
                                    style={{
                                      margin: 0,
                                      padding: 0,
                                      listStyle: "none",
                                    }}
                                  >
                                    {items.map((c) => (
                                      <li
                                        key={c.id}
                                        id={`comp-row-${c.id}`}
                                        onMouseEnter={() =>
                                          setCompetencyRowHoverId(c.id)
                                        }
                                        onMouseLeave={() =>
                                          setCompetencyRowHoverId(null)
                                        }
                                        style={{
                                          padding: "4px 0",
                                          borderBottom: `1px solid ${borderSubtle}`,
                                          backgroundColor:
                                            highlightCompetencyId === c.id
                                              ? "rgba(110, 176, 240, 0.12)"
                                              : competencyRowHoverId === c.id
                                                ? "rgba(255,255,255,0.04)"
                                                : "transparent",
                                        }}
                                      >
                                        {editingCompetencyId === c.id &&
                                        orgPanelEditing ? null : (
                                          <div
                                            style={{
                                              display: "flex",
                                              alignItems: "flex-start",
                                              justifyContent: "space-between",
                                              gap: 8,
                                            }}
                                          >
                                            <div
                                              style={{
                                                minWidth: 0,
                                                flex: 1,
                                              }}
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
                                                    fontSize: 13,
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                    whiteSpace: "nowrap",
                                                  }}
                                                >
                                                  {c.name}
                                                </span>
                                                <CompetencyTypeBadge
                                                  type={toCompetencyTypeUnion(
                                                    normalizeCompetencyType(
                                                      c.competency_type
                                                    )
                                                  )}
                                                />
                                                {renderLifecycleBadge(
                                                  c.status
                                                )}
                                              </div>
                                              {c.description != null &&
                                              c.description.trim() !== "" ? (
                                                <div
                                                  style={{
                                                    marginTop: 2,
                                                    fontSize: 11,
                                                    color: mutedColor,
                                                    lineHeight: 1.35,
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                    whiteSpace: "nowrap",
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
                                                gap: 4,
                                                justifyContent: "flex-end",
                                                opacity:
                                                  competencyRowHoverId ===
                                                  c.id
                                                    ? 1
                                                    : 0.1,
                                                transition:
                                                  "opacity 0.18s ease",
                                              }}
                                            >
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  handleStartEditCompetency(c)
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
                                                  padding: "4px 8px",
                                                  fontSize: 12,
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
                                                  padding: "4px 8px",
                                                  fontSize: 12,
                                                }}
                                              >
                                                {expandedCompetencyId === c.id
                                                  ? "Hide levels"
                                                  : "Levels"}
                                              </button>
                                              {parseLifecycleStatus(
                                                c.status
                                              ) === "active" ? (
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    setLifecycleModal({
                                                      kind: "deprecate",
                                                      entity: "competency",
                                                      id: c.id,
                                                      label: c.name,
                                                    });
                                                    setLifecycleReason("");
                                                    setLifecycleReplacedById(
                                                      ""
                                                    );
                                                  }}
                                                  disabled={lifecycleSaving}
                                                  style={{
                                                    ...btnGhost,
                                                    padding: "4px 8px",
                                                    fontSize: 12,
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
                                                  disabled={lifecycleSaving}
                                                  style={{
                                                    ...btnGhost,
                                                    padding: "4px 8px",
                                                    fontSize: 12,
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
                                                  disabled={lifecycleSaving}
                                                  style={{
                                                    ...btnGhost,
                                                    padding: "4px 8px",
                                                    fontSize: 12,
                                                  }}
                                                >
                                                  Archive
                                                </button>
                                              ) : null}
                                            </div>
                                          </div>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )
                            )}
                            </div>
                            {orgPanelEditing ? (
                              <div
                                style={{
                                  marginTop: 12,
                                  padding: "12px 14px",
                                  borderRadius: 8,
                                  border: `1px solid ${border}`,
                                  backgroundColor: bg,
                                }}
                              >
                                <p
                                  style={{
                                    margin: "0 0 10px",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: accent,
                                  }}
                                >
                                  Edit competency
                                </p>
                                <form
                                  onSubmit={(e) =>
                                    void handleSaveEditCompetency(e)
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
                                      value={editCompetencyName}
                                      onChange={(e) =>
                                        setEditCompetencyName(e.target.value)
                                      }
                                      disabled={isSavingEditCompetency}
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
                                      value={editCompetencyDescription}
                                      onChange={(e) =>
                                        setEditCompetencyDescription(
                                          e.target.value
                                        )
                                      }
                                      disabled={isSavingEditCompetency}
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
                                    Competency type
                                    <select
                                      value={editCompetencyType}
                                      onChange={(e) =>
                                        setEditCompetencyType(
                                          e.target.value as CompetencyType
                                        )
                                      }
                                      disabled={isSavingEditCompetency}
                                      style={{
                                        padding: "10px 12px",
                                        fontSize: 15,
                                        color: text,
                                        backgroundColor: surface,
                                        border: competencySubjectTypeMismatchEdit
                                          ? `2px solid ${COMPETENCY_SUBJECT_TYPE_WARN_BORDER}`
                                          : `1px solid ${border}`,
                                        borderRadius: 8,
                                      }}
                                    >
                                      <option value="organisation">
                                        Organisation
                                      </option>
                                      <option value="practice">Practice</option>
                                      <option value="stretch">Stretch</option>
                                    </select>
                                    {competencySubjectTypeMismatchEdit ? (
                                      <span
                                        style={{
                                          fontSize: 12,
                                          color: COMPETENCY_SUBJECT_TYPE_WARN_BORDER,
                                          display: "flex",
                                          gap: 6,
                                          alignItems: "center",
                                          lineHeight: 1.35,
                                        }}
                                        role="status"
                                      >
                                        <span aria-hidden>⚠</span>
                                        {COMPETENCY_SUBJECT_TYPE_WARN_MSG}
                                      </span>
                                    ) : null}
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
                                      value={editCompetencySubjectId}
                                      onChange={(e) =>
                                        setEditCompetencySubjectId(
                                          e.target.value
                                        )
                                      }
                                      disabled={isSavingEditCompetency}
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
                                    }}
                                  >
                                    <button
                                      type="submit"
                                      disabled={isSavingEditCompetency}
                                      style={btn}
                                    >
                                      {isSavingEditCompetency
                                        ? "Saving..."
                                        : "Save"}
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isSavingEditCompetency}
                                      onClick={handleCancelEditCompetency}
                                      style={btn}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </form>
                              </div>
                            ) : null}
                            {orgPanelLevels && expandedCompetencyId ? (
                              <div
                                style={{
                                  marginTop: 12,
                                  padding: "12px 14px",
                                  borderRadius: 8,
                                  border: `1px solid ${border}`,
                                  backgroundColor: surface,
                                }}
                              >
                                <p
                                  style={{
                                    margin: "0 0 8px",
                                    fontSize: 13,
                                    fontWeight: 600,
                                    color: text,
                                  }}
                                >
                                  Level definitions
                                </p>
                                {levelDefinitionsLoading ? (
                                  <p
                                    style={{
                                      margin: 0,
                                      fontSize: 13,
                                      color: mutedColor,
                                    }}
                                  >
                                    Loading level definitions...
                                  </p>
                                ) : levelDefinitions.length === 0 ? (
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
                                      flexDirection: "column",
                                      gap: 8,
                                    }}
                                  >
                                    {levelDefinitions.map((ld) => (
                                      <li
                                        key={ld.id}
                                        style={{
                                          padding: "8px 10px",
                                          borderRadius: 6,
                                          backgroundColor: bg,
                                          border: `1px solid ${border}`,
                                        }}
                                      >
                                        <div
                                          style={{
                                            fontWeight: 600,
                                            color: text,
                                            fontSize: 13,
                                          }}
                                        >
                                          {ld.level_name}
                                        </div>
                                        <div
                                          style={{
                                            marginTop: 4,
                                            fontSize: 12,
                                            color: mutedColor,
                                          }}
                                        >
                                          Order: {ld.level_order}
                                        </div>
                                        {ld.description != null &&
                                        ld.description.trim() !== "" ? (
                                          <div
                                            style={{
                                              marginTop: 6,
                                              fontSize: 12,
                                              color: mutedColor,
                                              lineHeight: 1.45,
                                            }}
                                          >
                                            {ld.description}
                                          </div>
                                        ) : null}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                {showCreateLevelFormForCompetencyId ===
                                expandedCompetencyId ? (
                                  <form
                                    onSubmit={(e) => {
                                      void handleSaveNewLevelDefinition(
                                        e,
                                        expandedCompetencyId
                                      );
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
                                      Level Name
                                      <input
                                        required
                                        value={newLevelName}
                                        onChange={(e) =>
                                          setNewLevelName(e.target.value)
                                        }
                                        disabled={isSavingLevel}
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
                                      Level Order
                                      <input
                                        required
                                        type="number"
                                        value={newLevelOrder}
                                        onChange={(e) =>
                                          setNewLevelOrder(e.target.value)
                                        }
                                        disabled={isSavingLevel}
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
                                        value={newLevelDescription}
                                        onChange={(e) =>
                                          setNewLevelDescription(e.target.value)
                                        }
                                        disabled={isSavingLevel}
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
                                        disabled={isSavingLevel}
                                        style={btn}
                                      >
                                        {isSavingLevel ? "Saving..." : "Save"}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isSavingLevel}
                                        onClick={handleCancelCreateLevelDefinition}
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
                                        expandedCompetencyId
                                      )
                                    }
                                    disabled={
                                      levelDefinitionsLoading || isSavingLevel
                                    }
                                    style={{
                                      ...btn,
                                      marginTop: 12,
                                      width: "100%",
                                      boxSizing: "border-box" as const,
                                    }}
                                  >
                                    + Add Level
                                  </button>
                                )}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </>
                    )}


        </div>
      )}

      {competencyDuplicateModal ? (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="dup-comp-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 88,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "24px 16px",
            overflow: "auto",
            backgroundColor: "rgba(0,0,0,0.6)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setCompetencyDuplicateModal(null);
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
              id="dup-comp-title"
              style={{
                margin: "0 0 8px",
                fontSize: 17,
                fontWeight: 600,
                color: text,
              }}
            >
              Similar competencies already exist
            </h3>
            <p style={{ ...muted, margin: "0 0 12px", fontSize: 13 }}>
              You&apos;re about to create{" "}
              <strong style={{ color: text }}>
                {competencyDuplicateModal.pending.name}
              </strong>
              . The catalogue already includes close matches:
            </p>
            <ul
              style={{
                margin: "0 0 14px",
                paddingLeft: 18,
                fontSize: 13,
                color: mutedColor,
                lineHeight: 1.5,
              }}
            >
              {competencyDuplicateModal.matches.map((m) => (
                <li key={m.id} style={{ marginBottom: 6 }}>
                  <span style={{ color: text, fontWeight: 600 }}>{m.name}</span>
                  <span style={{ color: mutedColor }}>
                    {" "}
                    —{" "}
                    {competencyHierarchyLabel(m, subjects, practices)}
                  </span>
                </li>
              ))}
            </ul>
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
                onClick={() => {
                  const first = competencyDuplicateModal.matches[0];
                  setCompetencyDuplicateModal(null);
                  if (first) {
                    setHighlightCompetencyId(first.id);
                    document
                      .getElementById(`comp-row-${first.id}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                  }
                }}
                style={btn}
              >
                Use existing
              </button>
              <button
                type="button"
                onClick={() => {
                  const p = competencyDuplicateModal.pending;
                  setCompetencyDuplicateModal(null);
                  void performInsertCompetency(
                    p.name,
                    p.description,
                    p.subjectId,
                    p.competencyType
                  );
                }}
                style={btnPrimary}
              >
                Create new anyway
              </button>
              <button
                type="button"
                onClick={() => setCompetencyDuplicateModal(null)}
                style={btnGhost}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {subjectGenModalOpen && subjectGenContext ? (
        <div
          role="dialog"
          aria-modal
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 86,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "24px 16px",
            overflow: "auto",
            backgroundColor: "rgba(0,0,0,0.6)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !subjectGenAccepting) {
              closeSubjectGenModal();
            }
          }}
        >
          <div
            style={{
              ...panelShell,
              width: "100%",
              maxWidth: 560,
              marginTop: 40,
              maxHeight: "min(82vh, 720px)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                margin: "0 0 8px",
                fontSize: 17,
                fontWeight: 600,
                color: text,
              }}
            >
              Generate subjects
            </h3>
            <p style={{ ...muted, margin: "0 0 12px", fontSize: 13 }}>
              Practice:{" "}
              <strong style={{ color: text }}>{subjectGenContext.title}</strong>
            </p>
            {companyProfileLoading ? (
              <p style={{ fontSize: 13, color: mutedColor }}>
                Loading company profile…
              </p>
            ) : null}
            {subjectGenError ? (
              <p style={{ fontSize: 13, color: errorColor }}>{subjectGenError}</p>
            ) : null}
            {subjectGenRows.length === 0 ? (
              <button
                type="button"
                disabled={subjectGenLoading}
                onClick={() => void handleGenerateSubjectsPreview()}
                style={{ ...btnPrimary, marginBottom: 12 }}
              >
                {subjectGenLoading ? "Generating…" : "Generate preview"}
              </button>
            ) : (
              <>
                <div
                  style={{
                    overflow: "auto",
                    flex: 1,
                    minHeight: 0,
                    marginBottom: 12,
                  }}
                >
                  {subjectGenRows.map((row) => (
                    <label
                      key={row.id}
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "flex-start",
                        padding: "8px 0",
                        borderBottom: `1px solid ${border}`,
                        fontSize: 13,
                        color: text,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={row.selected}
                        onChange={(e) => {
                          const on = e.target.checked;
                          setSubjectGenRows((prev) =>
                            prev.map((r) =>
                              r.id === row.id ? { ...r, selected: on } : r
                            )
                          );
                        }}
                      />
                      <span>
                        <strong>{row.name}</strong>
                        {row.description ? (
                          <span style={{ color: mutedColor }}>
                            {" "}
                            — {row.description}
                          </span>
                        ) : null}
                        {row.category ? (
                          <span style={{ color: mutedColor }}>
                            {" "}
                            [{row.category}]
                          </span>
                        ) : null}
                      </span>
                    </label>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    disabled={subjectGenAccepting}
                    onClick={() => void handleAcceptSubjectGenerated()}
                    style={btnPrimary}
                  >
                    {subjectGenAccepting ? "Saving…" : "Create selected"}
                  </button>
                  <button
                    type="button"
                    onClick={closeSubjectGenModal}
                    disabled={subjectGenAccepting}
                    style={btn}
                  >
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {competencyGenModalOpen && competencyGenContext ? (
        <div
          role="dialog"
          aria-modal
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 86,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "24px 16px",
            overflow: "auto",
            backgroundColor: "rgba(0,0,0,0.6)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !competencyGenAccepting) {
              closeCompetencyGenModal();
            }
          }}
        >
          <div
            style={{
              ...panelShell,
              width: "100%",
              maxWidth: 560,
              marginTop: 40,
              maxHeight: "min(82vh, 720px)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                margin: "0 0 8px",
                fontSize: 17,
                fontWeight: 600,
                color: text,
              }}
            >
              Generate competencies
            </h3>
            <p style={{ ...muted, margin: "0 0 12px", fontSize: 13 }}>
              Subject:{" "}
              <strong style={{ color: text }}>
                {competencyGenContext.subjectName}
              </strong>
            </p>
            {competencyGenError ? (
              <p style={{ fontSize: 13, color: errorColor }}>
                {competencyGenError}
              </p>
            ) : null}
            {competencyGenRows.length === 0 ? (
              <button
                type="button"
                disabled={competencyGenLoading}
                onClick={() => void handleGenerateCompetenciesPreview()}
                style={{ ...btnPrimary, marginBottom: 12 }}
              >
                {competencyGenLoading ? "Generating…" : "Generate preview"}
              </button>
            ) : (
              <>
                <div
                  style={{
                    overflow: "auto",
                    flex: 1,
                    minHeight: 0,
                    marginBottom: 12,
                  }}
                >
                  {competencyGenRows.map((row) => (
                    <label
                      key={row.id}
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "flex-start",
                        padding: "8px 0",
                        borderBottom: `1px solid ${border}`,
                        fontSize: 13,
                        color: text,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={row.selected}
                        onChange={(e) => {
                          const on = e.target.checked;
                          setCompetencyGenRows((prev) =>
                            prev.map((r) =>
                              r.id === row.id ? { ...r, selected: on } : r
                            )
                          );
                        }}
                      />
                      <span>
                        <strong>{row.name}</strong>
                        {row.description ? (
                          <span style={{ color: mutedColor }}>
                            {" "}
                            — {row.description}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    disabled={competencyGenAccepting}
                    onClick={() => void handleAcceptCompetencyGenerated()}
                    style={btnPrimary}
                  >
                    {competencyGenAccepting ? "Saving…" : "Create selected"}
                  </button>
                  <button
                    type="button"
                    onClick={closeCompetencyGenModal}
                    disabled={competencyGenAccepting}
                    style={btn}
                  >
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

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
            if (
              e.target === e.currentTarget &&
              !practiceGenLoading &&
              !practiceGenAccepting &&
              !isGeneratingExpansion
            ) {
              closePracticeGenModal();
            }
          }}
        >
          <div
            style={{
              ...panelShell,
              width: "100%",
              maxWidth:
                practiceGenModalMode === "promptExpansion" ? 720 : 560,
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
              {practiceGenModalMode === "promptExpansion"
                ? "Preview suggested hierarchy"
                : practiceGenPhase === "input"
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
              {practiceGenModalMode === "promptExpansion"
                ? "Review hierarchy, edit names, choose what to include. Nothing is saved until you accept."
                : practiceGenPhase === "input"
                  ? "Uses your company profile (optional), plus any domain or focus you add. Nothing is saved until you accept the preview."
                  : "Edit names and descriptions, choose which to create. Existing practices are never overwritten — new rows are inserted only."}
            </p>

            {practiceGenModalMode === "promptExpansion" &&
            practiceGenPhase === "preview" &&
            practiceGenExpansionHierarchy
              ? renderPromptExpansionPreview()
              : practiceGenPhase === "input" ? (
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
