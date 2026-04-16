import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";
import { supabase } from "../lib/supabase";
import {
  generateCompetenciesWithAi,
  generateSubjectsWithAi,
  type GeneratedSubjectDraft,
} from "../lib/hierarchyGeneration";
import {
  generateCompetenciesFromSubjects,
  type GenerateCompetenciesFromSubjectsDepth,
} from "../lib/generateCompetenciesFromSubjects";
import { toHierarchyCompanyProfilePayload } from "../lib/organisationProfileMaps";
import {
  normaliseSubjectTaxonomy,
  type NormaliseSubjectTaxonomyRequest,
  type NormaliseSubjectTaxonomyResponse,
  type NormalisedCapabilityAreaRow,
  type SubjectNormalisationNotes,
} from "../lib/subjectNameNormalisation";
import { generatePracticeModelWithAi } from "../lib/practiceModelGeneration";
import { generateHierarchyFromPrompt } from "../lib/promptHierarchyGeneration";
import type { PromptHierarchyResult } from "../lib/promptHierarchyGeneration";
import { insertDefaultCompetencyLevels } from "../lib/insertDefaultCompetencyLevels";
import type {
  CapabilityAreaRow,
  CompetencyLevelDefinitionRow,
  CompetencyPracticeRow,
  CompetencyRow,
  CompetencySubjectRow,
  CompetencyType,
  OrganisationProfileRow,
} from "./hub/types";
import { CapabilityAreaBuilderModal } from "./hub/CapabilityAreaBuilderModal";
import { LeftoverSubjectsRefinementModal } from "./hub/LeftoverSubjectsRefinementModal";
import { UnassignedCompetenciesRefinementModal } from "./hub/UnassignedCompetenciesRefinementModal";
import { PracticeCompetencyRefinementModal } from "./hub/PracticeCompetencyRefinementModal";
import {
  addSubjectPracticeLink,
  fetchSubjectPracticeLinksForOrg,
  linkExistsInMemory,
  practiceIdsForSubjectDisplay,
  replaceSubjectPracticeLinksForSubject,
  subjectIsRelevantToPractice,
  type SubjectPracticeLinkRow,
} from "./hub/subjectPracticeLinks";
import {
  competencyLinkedToPractice,
  fetchCompetencyPracticeLinksForOrg,
  removeCompetencyPracticeLink,
  type CompetencyPracticeLinkRow,
} from "./hub/competencyPracticeLinks";
import {
  ensureCompetencyLinkedToPracticeOrganisation,
  ensureSubjectLinkedToPracticeOrganisation,
  listPracticeCandidateCompetenciesForSubject,
  listPracticeManagedCompetenciesForSubject,
  removeSubjectFromPracticeOverlay,
} from "./hub/practiceOverlayCuration";
import {
  getCompetencyReferenceMappedFromLine,
  getSubjectProvenanceLines,
  orgCapabilityAreaDisplayName,
  type CompetencySubjectWithProvenance,
  type CompetencyWithProvenance,
} from "../lib/referenceProvenance";
import { GovernanceTaxonomyBadge } from "./hub/GovernanceTaxonomyBadge";
import { AccordionCollapsible } from "./hub/AccordionCollapsible";
import {
  parseTaxonomyGovernanceStatus,
  type TaxonomyGovernanceStatus,
} from "./hub/taxonomyGovernance";
import {
  entityMatchesLifecycleFilter,
  excludeArchivedCompetencies,
  isAssignableLifecycleStatus,
  parseLifecycleStatus,
  type LifecycleViewFilter,
} from "./hub/competencyLifecycle";
import { activeCompetencyIdsForSubject } from "./hub/catalogueBulkCleanup";
import { fetchCompetencyArchiveImpact } from "./hub/competencyArchiveImpact";
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
/** Synthetic section: all practice/stretch subjects in one list (practice is context, not parent). */
const PRACTICE_SUBJECTS_ROOT_KEY = "__practice_subjects_root__";
/** Subjects with no capability_area_id render under this synthetic group (last). */
const UNASSIGNED_CAPABILITY_AREA_KEY = "__unassigned_capability_area__";
/** Synthetic practice row for organisational Subject → Competency tree (flat by subject_id). */
const ORGANISATION_ROOT_PRACTICE_KEY = "__organisation_root__";

/** Shown where subject ↔ practice context is explained (subject-first model). */
const SUBJECT_PRACTICE_CONTEXT_HINT =
  "Subjects are shared across the organisation. Practices provide contextual relevance (where work applies) — they do not own or structure the taxonomy.";

function resolveSubjectGenPracticeId(
  ctx: ManagementPracticeGroup,
  subjectGenSubjectType: CompetencyType,
  subjectGenPracticePickId: string,
  catalogueContext: boolean
): string | null {
  if (normalizeCompetencyType(subjectGenSubjectType) === "organisation") {
    return null;
  }
  if (catalogueContext) {
    const t = subjectGenPracticePickId.trim();
    return t === "" ? null : t;
  }
  if (ctx.key === PRACTICE_SUBJECTS_ROOT_KEY) {
    const t = subjectGenPracticePickId.trim();
    return t === "" ? null : t;
  }
  if (ctx.isUnassigned) return null;
  return ctx.key;
}

function resolveSubjectGenCapabilityAreaId(
  ctx: ManagementPracticeGroup,
  areaRows: CapabilityAreaRow[]
): string | null {
  if (ctx.key === UNASSIGNED_CAPABILITY_AREA_KEY) return null;
  return areaRows.some((a) => a.id === ctx.key) ? ctx.key : null;
}

/**
 * Words that are too generic to justify a “close match” on their own (precision over recall).
 */
const SUBJECT_CLOSE_MATCH_STOPWORDS = new Set([
  "management",
  "planning",
  "delivery",
  "development",
  "process",
  "processes",
  "operations",
  "operation",
  "practice",
  "practices",
  "testing",
  "test",
  "design",
  "support",
  "service",
  "services",
  "business",
  "project",
  "projects",
  "product",
  "products",
  "skills",
  "skill",
  "capability",
  "capabilities",
  "quality",
  "engineering",
  "agile",
  "scrum",
  "team",
  "teams",
  "iteration",
  "iterations",
  "organisation",
  "organization",
  "organizational",
  "professional",
  "technical",
  "functional",
  "general",
  "core",
  "basic",
  "advanced",
  "standard",
  "strategic",
  "operational",
  "alignment",
  "governance",
  "framework",
  "frameworks",
  "methodology",
  "approach",
  "approaches",
]);

function subjectNameTokensForMatch(name: string): string[] {
  return name
    .trim()
    .toLowerCase()
    .split(/[\s/&,-]+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ""))
    .filter((w) => w.length > 2);
}

function meaningfulTokensForSubjectMatch(name: string): string[] {
  return subjectNameTokensForMatch(name).filter(
    (w) => !SUBJECT_CLOSE_MATCH_STOPWORDS.has(w)
  );
}

/**
 * Conservative fuzzy match for subject generation previews — avoids weak pairs
 * (e.g. “Budget Management” vs “Backlog Management”) sharing only a generic token.
 */
function findSimilarSubjectsConservative(
  name: string,
  catalogue: CompetencySubjectRow[],
  options?: { preferCapabilityAreaId?: string | null }
): CompetencySubjectRow[] {
  const query = name.trim().toLowerCase();
  if (query.length < 2) return [];

  const qMean = meaningfulTokensForSubjectMatch(name);
  const qAll = subjectNameTokensForMatch(name);
  const pref = options?.preferCapabilityAreaId?.trim();

  type Hit = { row: CompetencySubjectRow; score: number };
  const hits: Hit[] = [];

  for (const row of catalogue) {
    const cand = row.name.trim();
    if (cand.length < 2) continue;

    const oMean = meaningfulTokensForSubjectMatch(cand);
    const oAll = subjectNameTokensForMatch(cand);

    const meanA = new Set(qMean);
    const meanB = new Set(oMean);
    let interMean = 0;
    for (const t of meanA) {
      if (meanB.has(t)) interMean++;
    }
    const unionMean = new Set([...meanA, ...meanB]).size;
    const jaccMean = unionMean > 0 ? interMean / unionMean : 0;

    let score = 0;

    if (meanA.size > 0 && meanB.size > 0) {
      if (interMean === 0) continue;
      if (interMean >= 2) {
        score = Math.min(1, 0.45 + jaccMean * 0.55);
      } else {
        if (jaccMean < 0.38) continue;
        score = jaccMean * 0.88;
      }
    } else {
      const allA = new Set(qAll);
      const allB = new Set(oAll);
      let interAll = 0;
      for (const t of allA) {
        if (allB.has(t)) interAll++;
      }
      const unionAll = new Set([...allA, ...allB]).size;
      if (unionAll === 0) continue;
      const jAll = interAll / unionAll;
      if (interAll < 2 || jAll < 0.55) continue;
      score = jAll * 0.75;
    }

    if (pref && row.capability_area_id === pref) {
      score += 0.06;
    }

    if (score < 0.42) continue;
    hits.push({ row, score });
  }

  hits.sort((a, b) => b.score - a.score);
  if (hits.length === 0) return [];

  const top = hits[0]!;
  if (hits.length > 1) {
    const second = hits[1]!;
    if (top.score - second.score < 0.04 && top.score < 0.58) {
      return [];
    }
  }

  return [top.row];
}

/** Light guardrail: names that sound like activities may belong under a subject as competencies. */
function subjectNameSuggestsActivity(name: string): boolean {
  const t = name.trim().toLowerCase();
  if (t.length < 3) return false;
  return (
    /\b(iteration|sprint|review|retrospective|planning|analysis|stand-?up|workshop|grooming|refinement)\b/i.test(
      t
    ) || /\b(plan|analyze|facilitate|moderate)\b/i.test(t)
  );
}

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

/** Catalogue filter: practice relevance includes legacy practice_id and subject_practice_links. */
function subjectMatchesPracticeRelevanceFilter(
  s: CompetencySubjectRow,
  filter: "all" | "unassigned" | string,
  links: SubjectPracticeLinkRow[]
): boolean {
  if (filter === "all") return true;
  const pids = practiceIdsForSubjectDisplay(links, s.id, s.practice_id);
  if (filter === "unassigned") return pids.length === 0;
  return pids.includes(filter);
}

/** Normalise competency display names for org-wide uniqueness comparison (trim + lowercase). */
function normalizeCompetencyNameKey(name: string): string {
  return name.trim().toLowerCase();
}

function findExactCompetencyByName(
  name: string,
  list: CompetencyRow[]
): CompetencyRow | null {
  const k = normalizeCompetencyNameKey(name);
  if (!k) return null;
  return list.find((c) => normalizeCompetencyNameKey(c.name) === k) ?? null;
}

function resolveCompetencyTypeForSubject(
  subjectId: string | null,
  preferredType: CompetencyType,
  subjectsList: CompetencySubjectRow[]
): CompetencyType {
  let resolvedCompetencyType = preferredType;
  if (subjectId) {
    const subject = subjectsList.find((s) => s.id === subjectId);
    const subjectType = normalizeSubjectTypeForAlignment(subject);
    const competencyTypeNorm = normalizeCompetencyType(resolvedCompetencyType);
    if (subjectType && subjectType !== competencyTypeNorm) {
      resolvedCompetencyType = toCompetencyTypeUnion(subjectType);
    }
  }
  return resolvedCompetencyType;
}

/** Subject type for alignment: only `subject.type` (see CompetencySubjectRow). */
function normalizeSubjectTypeForAlignment(
  subject: CompetencySubjectRow | undefined
): string {
  return normalizeCompetencyType(subject?.type);
}

const COMPETENCY_SUBJECT_TYPE_WARN_BORDER = "#b45309";
const COMPETENCY_SUBJECT_TYPE_WARN_MSG =
  "Competency type will align with the subject’s scope (organisation vs practice).";

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
  /** Practices this subject is relevant to (context); legacy single id kept in model until fully migrated */
  subjectPracticeIds: string[];
};

type ManagementPracticeGroup = {
  key: string;
  title: string;
  description: string | null;
  isUnassigned: boolean;
  subjectSections: ManagementSectionModel[];
};

type PracticeGenSubjectMode =
  | "use_existing"
  | "use_and_link"
  | "create_new";

type PracticeGenSubjectPreviewItem = {
  id: string;
  name: string;
  description: string;
  selected: boolean;
  mode: PracticeGenSubjectMode;
  existingSubjectId?: string | null;
  similarHint?: string;
};

type PracticeGenPreviewRow = {
  id: string;
  name: string;
  description: string;
  selected: boolean;
  subjectItems?: PracticeGenSubjectPreviewItem[];
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
  mode: PracticeGenSubjectMode;
  existingSubjectId?: string | null;
  similarHint?: string;
};

function buildOrganisationSubjectGenPreviewRows(
  generated: GeneratedSubjectDraft[],
  existingSubjects: CompetencySubjectRow[],
  preferCapabilityAreaId: string | null
): SubjectGenPreviewRow[] {
  return generated.map((s) => {
    const name = s.name.trim();
    const k = normalizeCompetencyNameKey(name);

    const exactAny = existingSubjects.find(
      (sub) => normalizeCompetencyNameKey(sub.name) === k
    );
    if (exactAny) {
      const t = normalizeCompetencyType(exactAny.type);
      const scopeHint =
        t === "organisation"
          ? "Organisation-wide"
          : t === "practice" || t === "stretch"
            ? "Practice / stretch"
            : (exactAny.type ?? "Unknown").trim();
      return {
        id: crypto.randomUUID(),
        name,
        description: (s.description ?? "").trim(),
        category: s.category ?? "",
        selected: true,
        mode: "use_existing",
        existingSubjectId: exactAny.id,
        similarHint: `Exact match in catalogue (${scopeHint} scope). Default: reuse — no new row.`,
      };
    }

    const similar = findSimilarSubjectsConservative(name, existingSubjects, {
      preferCapabilityAreaId,
    });
    if (similar.length > 0) {
      const best = similar[0]!;
      return {
        id: crypto.randomUUID(),
        name,
        description: (s.description ?? "").trim(),
        category: s.category ?? "",
        selected: true,
        mode: "use_existing",
        existingSubjectId: best.id,
        similarHint: `Suggested catalogue match: “${best.name.trim()}”. Reuse only if equivalent — otherwise choose Create new.`,
      };
    }

    return {
      id: crypto.randomUUID(),
      name,
      description: (s.description ?? "").trim(),
      category: s.category ?? "",
      selected: true,
      mode: "create_new",
      existingSubjectId: null,
    };
  });
}

function buildPracticeSubjectGenPreviewRowsFromDrafts(
  generated: GeneratedSubjectDraft[],
  existingSubjects: CompetencySubjectRow[],
  practiceIdForContext: string | null,
  practicesForLabel: CompetencyPracticeRow[],
  subjectPracticeLinks: SubjectPracticeLinkRow[],
  preferCapabilityAreaId: string | null
): SubjectGenPreviewRow[] {
  const items = buildSubjectPreviewItemsForPractice(
    generated,
    existingSubjects,
    practiceIdForContext,
    practicesForLabel,
    subjectPracticeLinks,
    preferCapabilityAreaId
  );
  return items.map((item, i) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    category: generated[i]?.category ?? "",
    selected: item.selected,
    mode: item.mode,
    existingSubjectId: item.existingSubjectId,
    similarHint: item.similarHint,
  }));
}

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
  practicesList: CompetencyPracticeRow[],
  subjectPracticeLinks: SubjectPracticeLinkRow[]
): string {
  const sid = c.subject_id;
  if (!sid) return "No subject linked";
  const sub = subjectsList.find((s) => s.id === sid);
  if (!sub) return "Unknown subject";
  const sn = sub.name.trim() || "Subject";
  const pids = practiceIdsForSubjectDisplay(
    subjectPracticeLinks,
    sub.id,
    sub.practice_id
  );
  if (pids.length === 0) return sn;
  const names = pids
    .map((id) => practicesList.find((p) => p.id === id)?.name?.trim())
    .filter((x): x is string => !!x);
  if (names.length === 0) return sn;
  if (names.length === 1) return `${sn} · ${names[0]}`;
  if (names.length <= 3) return `${sn} · ${names.join(", ")}`;
  return `${sn} · ${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

function isPracticeScopeSubjectRow(s: CompetencySubjectRow): boolean {
  const t = normalizeCompetencyType(s.type);
  return t === "practice" || t === "stretch";
}

/** Match a practice-scoped subject by name within this practice or unassigned — never another practice. Pass practiceId null for unassigned-only context. */
function findScopedPracticeSubjectByName(
  catalogue: CompetencySubjectRow[],
  nameKey: string,
  practiceId: string | null,
  links: SubjectPracticeLinkRow[]
): CompetencySubjectRow | undefined {
  if (practiceId == null || practiceId === "") {
    return catalogue.find(
      (s) =>
        isPracticeScopeSubjectRow(s) &&
        normalizeCompetencyNameKey(s.name) === nameKey &&
        s.practice_id === null &&
        !links.some((l) => l.subject_id === s.id)
    );
  }
  const candidates = catalogue.filter(
    (s) =>
      isPracticeScopeSubjectRow(s) &&
      normalizeCompetencyNameKey(s.name) === nameKey &&
      (s.practice_id === practiceId ||
        s.practice_id === null ||
        subjectIsRelevantToPractice(links, s.id, practiceId, s))
  );
  if (candidates.length === 0) return undefined;
  const samePractice = candidates.find((s) =>
    subjectIsRelevantToPractice(links, s.id, practiceId, s)
  );
  if (samePractice) return samePractice;
  const legacySame = candidates.find((s) => s.practice_id === practiceId);
  if (legacySame) return legacySame;
  const unassigned = candidates.find(
    (s) =>
      s.practice_id === null && !links.some((l) => l.subject_id === s.id)
  );
  if (unassigned) return unassigned;
  return candidates[0];
}

function buildSubjectPreviewItemsForPractice(
  generated: GeneratedSubjectDraft[],
  existingSubjects: CompetencySubjectRow[],
  practiceIdForReuseScope: string | null,
  practicesForLabel: CompetencyPracticeRow[],
  subjectPracticeLinks: SubjectPracticeLinkRow[],
  preferCapabilityAreaId: string | null
): PracticeGenSubjectPreviewItem[] {
  return generated.map((s) => {
    const name = s.name.trim();
    const k = normalizeCompetencyNameKey(name);

    const exactOrg = existingSubjects.find(
      (sub) =>
        normalizeCompetencyType(sub.type) === "organisation" &&
        normalizeCompetencyNameKey(sub.name) === k
    );
    if (exactOrg) {
      return {
        id: crypto.randomUUID(),
        name,
        description: (s.description ?? "").trim(),
        selected: true,
        mode: "use_and_link",
        existingSubjectId: exactOrg.id,
        similarHint:
          "Organisation-wide subject already exists — will add this practice as relevant context (no duplicate subject row). Job profile links to competencies under this subject stay valid.",
      };
    }

    const exactScoped = existingSubjects.find((sub) => {
      if (!isPracticeScopeSubjectRow(sub)) return false;
      if (normalizeCompetencyNameKey(sub.name) !== k) return false;
      if (practiceIdForReuseScope) {
        return subjectIsRelevantToPractice(
          subjectPracticeLinks,
          sub.id,
          practiceIdForReuseScope,
          sub
        );
      }
      return (
        sub.practice_id === null &&
        !subjectPracticeLinks.some((l) => l.subject_id === sub.id)
      );
    });

    if (exactScoped) {
      const already =
        practiceIdForReuseScope &&
        subjectIsRelevantToPractice(
          subjectPracticeLinks,
          exactScoped.id,
          practiceIdForReuseScope,
          exactScoped
        );
      return {
        id: crypto.randomUUID(),
        name,
        description: (s.description ?? "").trim(),
        selected: true,
        mode: "use_and_link",
        existingSubjectId: exactScoped.id,
        similarHint: already
          ? "Already linked to this practice."
          : "Existing subject found — will add this practice as relevant context (other links kept).",
      };
    }

    const exactOtherPractice = existingSubjects.find(
      (sub) =>
        isPracticeScopeSubjectRow(sub) &&
        normalizeCompetencyNameKey(sub.name) === k &&
        practiceIdForReuseScope &&
        !subjectIsRelevantToPractice(
          subjectPracticeLinks,
          sub.id,
          practiceIdForReuseScope,
          sub
        )
    );
    if (exactOtherPractice) {
      const otherIds = practiceIdsForSubjectDisplay(
        subjectPracticeLinks,
        exactOtherPractice.id,
        exactOtherPractice.practice_id
      ).filter((id) => id !== practiceIdForReuseScope);
      const prName =
        otherIds.length > 0
          ? otherIds
              .map(
                (id) =>
                  practicesForLabel.find((p) => p.id === id)?.name?.trim() ||
                  "Practice"
              )
              .join(", ")
          : "other contexts";
      return {
        id: crypto.randomUUID(),
        name,
        description: (s.description ?? "").trim(),
        selected: true,
        mode: "use_existing",
        existingSubjectId: exactOtherPractice.id,
        similarHint: `Subject already exists (relevant to: ${prName}). Choose “Use and link to this practice” to add this practice without removing others.`,
      };
    }

    const similar = findSimilarSubjectsConservative(name, existingSubjects, {
      preferCapabilityAreaId,
    });
    if (similar.length > 0) {
      const best = similar[0]!;
      return {
        id: crypto.randomUUID(),
        name,
        description: (s.description ?? "").trim(),
        selected: true,
        mode: "use_and_link",
        existingSubjectId: best.id,
        similarHint: `Suggested catalogue match: “${best.name.trim()}”. Use and link only if equivalent — otherwise use Create new.`,
      };
    }

    return {
      id: crypto.randomUUID(),
      name,
      description: (s.description ?? "").trim(),
      selected: true,
      mode: "create_new",
      existingSubjectId: null,
    };
  });
}

function buildCapabilityAreaManagementGroups(
  capabilityAreas: CapabilityAreaRow[],
  subjectRows: CompetencySubjectRow[],
  competencies: CompetencyRow[],
  subjectPracticeLinks: SubjectPracticeLinkRow[]
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

  const byAreaId = new Map<string, CompetencySubjectRow[]>();
  for (const s of subjectRows) {
    const aid = s.capability_area_id ?? UNASSIGNED_CAPABILITY_AREA_KEY;
    if (!byAreaId.has(aid)) byAreaId.set(aid, []);
    byAreaId.get(aid)!.push(s);
  }
  for (const arr of byAreaId.values()) {
    arr.sort((a, b) => a.name.localeCompare(b.name));
  }

  const sectionForSubject = (s: CompetencySubjectRow): ManagementSectionModel => ({
    key: s.id,
    title: s.name.trim() || "Subject",
    description: s.description?.trim() ? s.description : null,
    category: s.category?.trim() ? s.category : null,
    subjectType: toCompetencyTypeUnion(normalizeCompetencyType(s.type)),
    items: bySubject.get(s.id) ?? [],
    isUnassigned: false,
    subjectPracticeIds: practiceIdsForSubjectDisplay(
      subjectPracticeLinks,
      s.id,
      s.practice_id
    ),
  });

  const groups: ManagementPracticeGroup[] = [];

  for (const area of [...capabilityAreas].sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const subjs = byAreaId.get(area.id) ?? [];
    groups.push({
      key: area.id,
      title: area.name.trim() || "Capability area",
      description: area.description?.trim() ? area.description : null,
      isUnassigned: false,
      subjectSections: subjs.map(sectionForSubject),
    });
  }

  const unassignedSubjs =
    byAreaId.get(UNASSIGNED_CAPABILITY_AREA_KEY) ?? [];
  const unassignedSections: ManagementSectionModel[] =
    unassignedSubjs.map(sectionForSubject);
  unassignedSections.push({
    key: UNASSIGNED_SUBJECT_KEY,
    title: "Competencies not linked to a subject",
    description: null,
    category: null,
    subjectType: "practice",
    items: bySubject.get(UNASSIGNED_SUBJECT_KEY) ?? [],
    isUnassigned: true,
    subjectPracticeIds: [],
  });

  groups.push({
    key: UNASSIGNED_CAPABILITY_AREA_KEY,
    title: "Unassigned Capability Area",
    description:
      "Subjects not yet assigned to a capability area appear here. Edit a subject to assign one.",
    isUnassigned: false,
    subjectSections: unassignedSections,
  });

  return groups;
}

/** Real subject rows in the capability catalogue (excludes synthetic unassigned competency bucket). */
function catalogueSubjectSectionsForBatchGen(
  practice: ManagementPracticeGroup,
): ManagementSectionModel[] {
  return practice.subjectSections.filter((s) => !s.isUnassigned);
}

function buildSubjectNormalisationRequestFromCatalogue(
  groups: ManagementPracticeGroup[],
  subjectsList: CompetencySubjectRow[],
  cp: OrganisationProfileRow | null,
): NormaliseSubjectTaxonomyRequest {
  const subjectById = new Map(subjectsList.map((s) => [s.id, s] as const));
  const capabilityAreas: NormaliseSubjectTaxonomyRequest["capabilityAreas"] =
    [];
  for (const g of groups) {
    if (g.key === UNASSIGNED_CAPABILITY_AREA_KEY) continue;
    const sections = g.subjectSections.filter(
      (s) => !s.isUnassigned && s.key !== UNASSIGNED_SUBJECT_KEY,
    );
    if (sections.length === 0) continue;
    const rows = sections
      .map((sec) => {
        const row = subjectById.get(sec.key);
        const name = (row?.name ?? sec.title).trim();
        if (!name) return null;
        return {
          subjectId: sec.key,
          name,
          description: row?.description?.trim() || null,
          category: row?.category?.trim() || null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (rows.length === 0) continue;
    capabilityAreas.push({
      capabilityAreaId: g.key,
      capabilityAreaName: g.title.trim() || "Capability area",
      subjects: rows,
    });
  }
  const hierarchy = toHierarchyCompanyProfilePayload(cp);
  return {
    companyProfile: hierarchy as Record<string, unknown> | null,
    capabilityAreas,
  };
}

function resolveProposedCapabilityAreaIdNorm(
  area: NormalisedCapabilityAreaRow,
  capabilityAreas: CapabilityAreaRow[],
): string | null {
  const id = area.capabilityAreaId?.trim();
  if (id && capabilityAreas.some((a) => a.id === id)) return id;
  const k = normalizeCompetencyNameKey(area.capabilityAreaName);
  return (
    capabilityAreas.find((a) => normalizeCompetencyNameKey(a.name) === k)
      ?.id ?? null
  );
}

function analyseSubjectMergeSkipIds(
  result: NormaliseSubjectTaxonomyResponse,
  subjectsList: CompetencySubjectRow[],
  capabilityAreas: CapabilityAreaRow[],
  competencyCountBySubject: Map<string, number>,
): {
  skipSubjectIds: Set<string>;
  mergeVictimsWithCompetencies: string[];
  mergeSuggestionCount: number;
} {
  const skipSubjectIds = new Set<string>();
  const mergeVictimsWithCompetencies: string[] = [];
  const merges = result.notes.merges ?? [];
  for (const m of merges) {
    const areaName =
      typeof m.capabilityAreaName === "string" ? m.capabilityAreaName.trim() : "";
    const to = typeof m.to === "string" ? m.to.trim() : "";
    const fromArr = Array.isArray(m.from)
      ? m.from
          .filter((x): x is string => typeof x === "string" && x.trim() !== "")
          .map((x) => x.trim())
      : [];
    if (!areaName || !to || fromArr.length < 2) continue;

    const areaId =
      capabilityAreas.find(
        (a) =>
          normalizeCompetencyNameKey(a.name) === normalizeCompetencyNameKey(areaName),
      )?.id ?? null;

    const fromIds = subjectsList
      .filter((s) => {
        if ((s.capability_area_id ?? null) !== (areaId ?? null)) return false;
        return fromArr.some(
          (fn) =>
            normalizeCompetencyNameKey(fn) === normalizeCompetencyNameKey(s.name),
        );
      })
      .map((s) => s.id);

    let survivorId: string | null = null;
    outer: for (const ar of result.capabilityAreas) {
      if (
        normalizeCompetencyNameKey(ar.capabilityAreaName) !==
        normalizeCompetencyNameKey(areaName)
      ) {
        continue;
      }
      for (const subj of ar.subjects) {
        if (
          normalizeCompetencyNameKey(subj.name) ===
            normalizeCompetencyNameKey(to) &&
          subj.subjectId?.trim()
        ) {
          survivorId = subj.subjectId.trim();
          break outer;
        }
      }
    }

    for (const id of fromIds) {
      if (survivorId && id === survivorId) continue;
      skipSubjectIds.add(id);
      if ((competencyCountBySubject.get(id) ?? 0) > 0) {
        mergeVictimsWithCompetencies.push(id);
      }
    }
  }
  return {
    skipSubjectIds,
    mergeVictimsWithCompetencies,
    mergeSuggestionCount: merges.length,
  };
}

function normalisationHasSuggestedEdits(
  result: NormaliseSubjectTaxonomyResponse,
  subjectsList: CompetencySubjectRow[],
  capabilityAreas: CapabilityAreaRow[],
  skipSubjectIds: Set<string>,
): boolean {
  for (const area of result.capabilityAreas) {
    const aid = resolveProposedCapabilityAreaIdNorm(area, capabilityAreas);
    for (const sub of area.subjects) {
      const sid = sub.subjectId?.trim();
      if (!sid || skipSubjectIds.has(sid)) continue;
      const cur = subjectsList.find((s) => s.id === sid);
      if (!cur) continue;
      if (
        normalizeCompetencyNameKey(cur.name) !==
        normalizeCompetencyNameKey(sub.name)
      ) {
        return true;
      }
      if (
        (cur.description ?? "").trim() !== (sub.description ?? "").trim()
      ) {
        return true;
      }
      if ((cur.category ?? "").trim() !== (sub.category ?? "").trim()) {
        return true;
      }
      if ((cur.capability_area_id ?? null) !== (aid ?? null)) {
        return true;
      }
    }
  }
  return false;
}

function normalisationHasNotes(result: NormaliseSubjectTaxonomyResponse): boolean {
  const n = result.notes;
  return (
    (n.merges?.length ?? 0) > 0 ||
    (n.renames?.length ?? 0) > 0 ||
    (n.moves?.length ?? 0) > 0 ||
    (n.preservedDistinctions?.length ?? 0) > 0
  );
}

type PendingSubjectMergeContext = {
  merges: SubjectNormalisationNotes["merges"];
  proposedCapabilityAreas: NormalisedCapabilityAreaRow[];
};

type SubjectMergeResolvedMember = {
  id: string;
  name: string;
  status: ReturnType<typeof parseLifecycleStatus>;
  competencyCount: number;
  practiceLinkCount: number;
  isRecommendedSurvivor: boolean;
};

type SubjectMergeResolvedGroup = {
  mergeIndex: number;
  note: SubjectNormalisationNotes["merges"][number];
  areaId: string | null;
  areaName: string;
  recommendedSurvivorId: string | null;
  recommendedSurvivorName: string;
  members: SubjectMergeResolvedMember[];
  blockedReason: string | null;
};

function resolveSurvivorIdFromMergeNote(
  mergeNote: SubjectNormalisationNotes["merges"][number],
  proposedAreas: NormalisedCapabilityAreaRow[],
): string | null {
  const areaName =
    typeof mergeNote.capabilityAreaName === "string"
      ? mergeNote.capabilityAreaName.trim()
      : "";
  const to = typeof mergeNote.to === "string" ? mergeNote.to.trim() : "";
  if (!areaName || !to) return null;
  for (const ar of proposedAreas) {
    if (
      normalizeCompetencyNameKey(ar.capabilityAreaName) !==
      normalizeCompetencyNameKey(areaName)
    ) {
      continue;
    }
    for (const subj of ar.subjects) {
      if (
        normalizeCompetencyNameKey(subj.name) ===
          normalizeCompetencyNameKey(to) &&
        subj.subjectId?.trim()
      ) {
        return subj.subjectId.trim();
      }
    }
  }
  return null;
}

function practiceLinkCountForSubjectRow(
  links: SubjectPracticeLinkRow[],
  subj: CompetencySubjectRow,
): number {
  return practiceIdsForSubjectDisplay(links, subj.id, subj.practice_id).length;
}

function buildSubjectMergeResolvedGroups(
  merges: SubjectNormalisationNotes["merges"],
  proposedAreas: NormalisedCapabilityAreaRow[],
  subjectsList: CompetencySubjectRow[],
  capabilityCatalogAreas: CapabilityAreaRow[],
  competencyCountBySubject: Map<string, number>,
  subjectPracticeLinks: SubjectPracticeLinkRow[],
): SubjectMergeResolvedGroup[] {
  return merges.map((note, mergeIndex) => {
    const areaName =
      typeof note.capabilityAreaName === "string"
        ? note.capabilityAreaName.trim()
        : "";
    const toName =
      typeof note.to === "string" ? note.to.trim() : "";
    const fromArr = Array.isArray(note.from)
      ? note.from
          .filter((x): x is string => typeof x === "string" && x.trim() !== "")
          .map((x) => x.trim())
      : [];

    const areaId =
      capabilityCatalogAreas.find(
        (a) =>
          normalizeCompetencyNameKey(a.name) ===
          normalizeCompetencyNameKey(areaName),
      )?.id ?? null;

    const recommendedSurvivorId = resolveSurvivorIdFromMergeNote(
      note,
      proposedAreas,
    );

    const fromIds = subjectsList
      .filter((s) => {
        if ((s.capability_area_id ?? null) !== (areaId ?? null)) return false;
        return fromArr.some(
          (fn) =>
            normalizeCompetencyNameKey(fn) ===
            normalizeCompetencyNameKey(s.name),
        );
      })
      .map((s) => s.id);

    const memberIdSet = new Set<string>(fromIds);
    if (recommendedSurvivorId) {
      memberIdSet.add(recommendedSurvivorId);
    }
    for (const s of subjectsList) {
      if ((s.capability_area_id ?? null) !== (areaId ?? null)) continue;
      if (
        toName &&
        normalizeCompetencyNameKey(s.name) ===
          normalizeCompetencyNameKey(toName)
      ) {
        memberIdSet.add(s.id);
      }
    }

    const members: SubjectMergeResolvedMember[] = [...memberIdSet]
      .map((id) => {
        const s = subjectsList.find((x) => x.id === id);
        if (!s) return null;
        return {
          id: s.id,
          name: s.name,
          status: parseLifecycleStatus(s.status),
          competencyCount: competencyCountBySubject.get(id) ?? 0,
          practiceLinkCount: practiceLinkCountForSubjectRow(
            subjectPracticeLinks,
            s,
          ),
          isRecommendedSurvivor:
            !!recommendedSurvivorId && recommendedSurvivorId === id,
        };
      })
      .filter((x): x is SubjectMergeResolvedMember => x !== null)
      .sort((a, b) => a.name.localeCompare(b.name));

    let blockedReason: string | null = null;
    if (!areaName || fromArr.length < 2) {
      blockedReason =
        "This merge note is incomplete in the review output. Manual review required.";
    } else if (memberIdSet.size < 2) {
      blockedReason =
        "Fewer than two catalogue subjects matched this merge group for the current capability area. Manual review required.";
    } else {
      const activeMembers = members.filter((m) =>
        isAssignableLifecycleStatus(m.status),
      );
      if (activeMembers.length < 2) {
        blockedReason =
          "Fewer than two active subjects in this group. Restore subjects or adjust lifecycle before merging.";
      }
    }

    return {
      mergeIndex,
      note,
      areaId,
      areaName: areaName || "(unknown area)",
      recommendedSurvivorId,
      recommendedSurvivorName: toName,
      members,
      blockedReason,
    };
  });
}

type BatchFromSubjectsReviewGroup = {
  subjectId: string;
  subjectName: string;
  warning?: string;
  groupSelected: boolean;
  lines: { key: string; label: string; selected: boolean }[];
};

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
  const [subjectPracticeLinks, setSubjectPracticeLinks] = useState<
    SubjectPracticeLinkRow[]
  >([]);
  const [competencyPracticeLinks, setCompetencyPracticeLinks] = useState<
    CompetencyPracticeLinkRow[]
  >([]);
  const [practices, setPractices] = useState<CompetencyPracticeRow[]>([]);
  const [capabilityAreas, setCapabilityAreas] = useState<CapabilityAreaRow[]>(
    []
  );
  const [showCreateCapabilityAreaForm, setShowCreateCapabilityAreaForm] =
    useState(false);
  const [capabilityAreaBuilderOpen, setCapabilityAreaBuilderOpen] =
    useState(false);
  const [leftoverRefinementOpen, setLeftoverRefinementOpen] = useState(false);
  const [practiceCompetencyRefinementPractice, setPracticeCompetencyRefinementPractice] =
    useState<CompetencyPracticeRow | null>(null);
  const [competencyRefinementOpen, setCompetencyRefinementOpen] = useState(false);
  const [newCapabilityAreaName, setNewCapabilityAreaName] = useState("");
  const [newCapabilityAreaDescription, setNewCapabilityAreaDescription] =
    useState("");
  const [isSavingCapabilityArea, setIsSavingCapabilityArea] = useState(false);
  const [capabilityAreaEditModal, setCapabilityAreaEditModal] =
    useState<CapabilityAreaRow | null>(null);
  const [editCapabilityAreaName, setEditCapabilityAreaName] = useState("");
  const [editCapabilityAreaDescription, setEditCapabilityAreaDescription] =
    useState("");
  const [isSavingCapabilityAreaEdit, setIsSavingCapabilityAreaEdit] =
    useState(false);
  const [taxonomyGovernanceFilter, setTaxonomyGovernanceFilter] = useState<
    "all" | TaxonomyGovernanceStatus
  >("all");
  const [governanceUpdateBusy, setGovernanceUpdateBusy] = useState<
    string | null
  >(null);
  const [showCreatePracticeForm, setShowCreatePracticeForm] = useState(false);
  const [newPracticeName, setNewPracticeName] = useState("");
  const [newPracticeDescription, setNewPracticeDescription] = useState("");
  const [isSavingPractice, setIsSavingPractice] = useState(false);
  const [editingPracticeId, setEditingPracticeId] = useState<string | null>(
    null
  );
  const [editPracticeName, setEditPracticeName] = useState("");
  const [editPracticeDescription, setEditPracticeDescription] = useState("");
  const [editPracticeReferenceFramework, setEditPracticeReferenceFramework] =
    useState("");
  const [isSavingEditPractice, setIsSavingEditPractice] = useState(false);
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
  const [newSubjectPracticeIds, setNewSubjectPracticeIds] = useState<string[]>(
    []
  );
  const [newSubjectCapabilityAreaId, setNewSubjectCapabilityAreaId] =
    useState("");
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
  /** Exact name match (org-wide): reuse / move / skip — not fuzzy similarity. */
  const [competencyExactReuseModal, setCompetencyExactReuseModal] = useState<
    | null
    | {
        source: "manual";
        existing: CompetencyRow;
        targetSubjectId: string | null;
        competencyTypeForTarget: CompetencyType;
        pendingName: string;
        pendingDescription: string;
      }
    | {
        source: "ai";
        current: {
          name: string;
          description: string;
          existing: CompetencyRow;
        };
        rest: Array<{
          name: string;
          description: string;
          existing: CompetencyRow;
        }>;
        insertable: Array<{
          id: string;
          name: string;
          description: string;
        }>;
        targetSubjectId: string;
        resolvedGenType: CompetencyType;
      }
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
  const [editSubjectType, setEditSubjectType] =
    useState<CompetencyType>("practice");
  /** Subject scope: practice = practice/stretch subjects; organisation = org-wide. */
  const [editSubjectScope, setEditSubjectScope] = useState<
    "practice" | "organisation"
  >("practice");
  /** Practices this subject is relevant to (subject_practice_links; legacy column cleared on save). */
  const [editSubjectPracticeIds, setEditSubjectPracticeIds] = useState<string[]>(
    []
  );
  const [editSubjectCapabilityAreaId, setEditSubjectCapabilityAreaId] =
    useState("");
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
  /** When generating from the flat practice-context subjects section, user picks practice context for AI + inserts. */
  const [subjectGenPracticePickId, setSubjectGenPracticePickId] =
    useState("");
  /** True when subject generation was opened from the capability-area catalogue (not legacy practice hierarchy). */
  const [subjectGenCatalogueContext, setSubjectGenCatalogueContext] =
    useState(false);

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

  const [batchFromSubjectsOpen, setBatchFromSubjectsOpen] = useState(false);
  const [batchFromSubjectsContext, setBatchFromSubjectsContext] =
    useState<ManagementPracticeGroup | null>(null);
  const [batchFromSubjectsDepth, setBatchFromSubjectsDepth] =
    useState<GenerateCompetenciesFromSubjectsDepth>("moderate");
  const [batchFromSubjectsLoading, setBatchFromSubjectsLoading] =
    useState(false);
  const [batchFromSubjectsError, setBatchFromSubjectsError] = useState<
    string | null
  >(null);
  const [batchFromSubjectsApplying, setBatchFromSubjectsApplying] =
    useState(false);
  const [batchFromSubjectsReview, setBatchFromSubjectsReview] = useState<
    BatchFromSubjectsReviewGroup[] | null
  >(null);

  const [subjectNormModalOpen, setSubjectNormModalOpen] = useState(false);
  const [subjectNormPhase, setSubjectNormPhase] = useState<
    "setup" | "review" | "complete"
  >("setup");
  const [subjectNormLoading, setSubjectNormLoading] = useState(false);
  const [subjectNormApplying, setSubjectNormApplying] = useState(false);
  const [subjectNormError, setSubjectNormError] = useState<string | null>(null);
  const [subjectNormResult, setSubjectNormResult] =
    useState<NormaliseSubjectTaxonomyResponse | null>(null);
  const [subjectNormRunStats, setSubjectNormRunStats] = useState<{
    areaCount: number;
    subjectCount: number;
  } | null>(null);
  const [subjectNormCompleteSummary, setSubjectNormCompleteSummary] = useState<{
    updated: number;
    mergeVictimsWithCompetencies: number;
  } | null>(null);
  /** When false and review has no renames/moves/merges, proposed lists stay collapsed. */
  const [subjectNormShowReviewedStructure, setSubjectNormShowReviewedStructure] =
    useState(false);
  const [pendingSubjectMergeContext, setPendingSubjectMergeContext] =
    useState<PendingSubjectMergeContext | null>(null);
  const [subjectMergeModalOpen, setSubjectMergeModalOpen] = useState(false);
  const [subjectMergeDecisions, setSubjectMergeDecisions] = useState<
    {
      mode: "recommended" | "pick" | "skip";
      survivorId: string | null;
      survivorRename: string;
    }[]
  >([]);
  const [subjectMergeApplying, setSubjectMergeApplying] = useState(false);
  const [subjectMergeApplySummary, setSubjectMergeApplySummary] = useState<{
    mergesCompleted: number;
    competenciesMoved: number;
    duplicatesSkipped: number;
    duplicateCompetenciesDeprecated: number;
    subjectsDeprecated: number;
    mergesSkipped: number;
    warnings: string[];
  } | null>(null);

  const pendingMergeSuggestionCount =
    pendingSubjectMergeContext?.merges.length ?? 0;
  const mergeResolutionButtonDisabled =
    pendingMergeSuggestionCount === 0 ||
    isSavingCapabilityArea ||
    isSavingSubject ||
    isSavingCompetency ||
    subjectMergeApplying;
  const mergeResolutionButtonTitle =
    pendingMergeSuggestionCount === 0
      ? "No pending merge suggestions. Run Refine subject names first."
      : isSavingCapabilityArea ||
          isSavingSubject ||
          isSavingCompetency ||
          subjectMergeApplying
        ? "Finish the current save operation before opening merge resolution."
        : "Review and apply subject merges suggested by the last subject normalisation run";

  const [showArchivedEntities, setShowArchivedEntities] = useState(false);
  const [viewMode, setViewMode] = useState<
    "all" | "practice" | "organisation"
  >("all");
  /** Narrow subjects by practice relevance (links + legacy practice_id). */
  const [subjectPrimaryPracticeFilter, setSubjectPrimaryPracticeFilter] =
    useState<"all" | "unassigned" | string>("all");
  /** Filter subject rows by whether they have competencies. */
  const [subjectCompetencyPresenceFilter, setSubjectCompetencyPresenceFilter] =
    useState<"all" | "with" | "without">("all");
  const [lifecycleViewFilter, setLifecycleViewFilter] =
    useState<LifecycleViewFilter>("all");
  /** Primary Competency Management lens: capability-area tree vs practice → subject comparison. */
  const [competencyManagementLens, setCompetencyManagementLens] = useState<
    "catalogue" | "practice"
  >("catalogue");
  /** Collapsed state for Practice view sections; omitted = expanded. */
  const [practiceLensAccordionOpen, setPracticeLensAccordionOpen] = useState<
    Record<string, boolean>
  >({});
  /** Practice lens: `${practiceId}::${subjectId}` while removing relevance */
  const [removingSubjectFromPracticeKey, setRemovingSubjectFromPracticeKey] =
    useState<string | null>(null);
  const [practiceRemoveConfirm, setPracticeRemoveConfirm] = useState<{
    practice: CompetencyPracticeRow;
    subject: CompetencySubjectRow;
  } | null>(null);
  const [practiceAddItemsModal, setPracticeAddItemsModal] = useState<{
    practice: CompetencyPracticeRow;
    subject: CompetencySubjectRow;
  } | null>(null);
  const [addItemsSelectedIds, setAddItemsSelectedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [addItemsApplying, setAddItemsApplying] = useState(false);
  const [practiceManageModal, setPracticeManageModal] = useState<{
    practice: CompetencyPracticeRow;
    subject: CompetencySubjectRow;
  } | null>(null);
  const [manageItemsLinked, setManageItemsLinked] = useState<
    Record<string, boolean>
  >({});
  const [manageItemsApplying, setManageItemsApplying] = useState(false);
  const [practiceOverlayFeedback, setPracticeOverlayFeedback] = useState<
    string | null
  >(null);
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

  /** Catalogue “Unassigned Capability Area” — bulk select competency_subjects (real rows only). */
  const [catalogueBulkUnassignedSubjectIds, setCatalogueBulkUnassignedSubjectIds] =
    useState<Set<string>>(() => new Set());
  /** “Competencies not linked to a subject” bucket — bulk select. */
  const [catalogueBulkOrphanCompetencyIds, setCatalogueBulkOrphanCompetencyIds] =
    useState<Set<string>>(() => new Set());
  const [catalogueBulkFeedback, setCatalogueBulkFeedback] = useState<string | null>(
    null,
  );
  const [bulkAssignCompetencyModalOpen, setBulkAssignCompetencyModalOpen] =
    useState(false);
  const [bulkAssignCompetenciesTargetId, setBulkAssignCompetenciesTargetId] =
    useState("");
  const [bulkAssignCapabilityAreaModalOpen, setBulkAssignCapabilityAreaModalOpen] =
    useState(false);
  const [bulkAssignCapabilityAreaTargetId, setBulkAssignCapabilityAreaTargetId] =
    useState("");
  const [bulkActionBusy, setBulkActionBusy] = useState(false);
  const [subjectArchiveDialog, setSubjectArchiveDialog] = useState<
    | null
    | {
        subjectId: string;
        label: string;
        linkedCompetencyIds: string[];
      }
  >(null);
  const [subjectArchiveChoice, setSubjectArchiveChoice] = useState<
    "unassigned" | "move_subject" | "archive_linked"
  >("unassigned");
  const [subjectArchiveMoveToId, setSubjectArchiveMoveToId] = useState("");

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
      setSubjectPracticeLinks([]);
      setCompetencyPracticeLinks([]);
      setPractices([]);
      setShowCreatePracticeForm(false);
      setNewPracticeName("");
      setNewPracticeDescription("");
      setSubjectCreatePracticeKey(null);
      setNewSubjectName("");
      setNewSubjectDescription("");
      setNewSubjectCategory("");
      setNewSubjectType("practice");
      setNewSubjectPracticeIds([]);
      setNewSubjectCapabilityAreaId("");
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
      setEditSubjectScope("practice");
      setEditSubjectPracticeIds([]);
      setEditSubjectCapabilityAreaId("");
      setCapabilityAreaEditModal(null);
      setEditCapabilityAreaName("");
      setEditCapabilityAreaDescription("");
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
      setCapabilityAreas([]);
      setShowCreateCapabilityAreaForm(false);
      setCapabilityAreaBuilderOpen(false);
      setLeftoverRefinementOpen(false);
      setPracticeCompetencyRefinementPractice(null);
      setCompetencyRefinementOpen(false);
      setBatchFromSubjectsOpen(false);
      setBatchFromSubjectsContext(null);
      setBatchFromSubjectsDepth("moderate");
      setBatchFromSubjectsLoading(false);
      setBatchFromSubjectsError(null);
      setBatchFromSubjectsApplying(false);
      setBatchFromSubjectsReview(null);
      setSubjectNormModalOpen(false);
      setSubjectNormPhase("setup");
      setSubjectNormLoading(false);
      setSubjectNormApplying(false);
      setSubjectNormError(null);
      setSubjectNormResult(null);
      setSubjectNormRunStats(null);
      setSubjectNormCompleteSummary(null);
      setSubjectNormShowReviewedStructure(false);
      setPendingSubjectMergeContext(null);
      setSubjectMergeModalOpen(false);
      setSubjectMergeDecisions([]);
      setSubjectMergeApplying(false);
      setSubjectMergeApplySummary(null);
      subjectMergeModalOpenedRef.current = false;
      setNewCapabilityAreaName("");
      setNewCapabilityAreaDescription("");
      setPracticeLensAccordionOpen({});
      setEditingPracticeId(null);
      setEditPracticeName("");
      setEditPracticeDescription("");
      setEditPracticeReferenceFramework("");
      setCatalogueBulkUnassignedSubjectIds(new Set());
      setCatalogueBulkOrphanCompetencyIds(new Set());
      setCatalogueBulkFeedback(null);
      setBulkAssignCompetencyModalOpen(false);
      setBulkAssignCompetenciesTargetId("");
      setBulkAssignCapabilityAreaModalOpen(false);
      setBulkAssignCapabilityAreaTargetId("");
      setSubjectArchiveDialog(null);
      setSubjectArchiveChoice("unassigned");
      setSubjectArchiveMoveToId("");

      const statusList = showArchivedEntities
        ? (["active", "deprecated", "archived"] as const)
        : (["active", "deprecated"] as const);

      const [res, subRes, pracRes, capRes, splRes, cplRes] = await Promise.all([
        supabase
          .from("competencies")
          .select(
            "id, name, description, competency_type, is_active, status, deprecated_at, deprecated_reason, replaced_by_id, reference_competency_id, origin_type, canonical_name, subject_id, reference_competencies ( id, name, reference_subjects ( id, name, reference_capability_areas ( id, name, reference_frameworks ( id, code, name ) ) ) ), competency_subjects ( id, name, description, category, type, practice_id, capability_area_id, status, governance_status, deprecated_at, deprecated_reason, replaced_by_id, reference_subject_id, origin_type, capability_areas ( id, name ), reference_subjects ( id, name, reference_capability_areas ( id, name, reference_frameworks ( id, code, name ) ) ), competency_practices ( id, name, description, reference_framework, is_active, status, deprecated_at, deprecated_reason, replaced_by_id ) )"
          )
          .eq("organisation_id", orgId)
          .in("status", [...statusList])
          .order("name"),
        supabase
          .from("competency_subjects")
          .select(
            "id, name, description, category, type, practice_id, capability_area_id, status, governance_status, deprecated_at, deprecated_reason, replaced_by_id, reference_subject_id, origin_type, capability_areas ( id, name ), reference_subjects ( id, name, reference_capability_areas ( id, name, reference_frameworks ( id, code, name ) ) ), competency_practices ( id, name, description, reference_framework, is_active, status, deprecated_at, deprecated_reason, replaced_by_id )"
          )
          .eq("organisation_id", orgId)
          .in("status", [...statusList])
          .order("name", { ascending: true }),
        supabase
          .from("competency_practices")
          .select(
            "id, name, description, reference_framework, is_active, organisation_id, status, deprecated_at, deprecated_reason, replaced_by_id"
          )
          .eq("organisation_id", orgId)
          .in("status", [...statusList])
          .order("name", { ascending: true }),
        supabase
          .from("capability_areas")
          .select("id, organisation_id, name, description, created_at, governance_status")
          .eq("organisation_id", orgId)
          .order("name", { ascending: true }),
        fetchSubjectPracticeLinksForOrg(orgId),
        fetchCompetencyPracticeLinksForOrg(orgId),
      ]);

      if (cancelled) return;

      if (pracRes.error) {
        console.error("[competency_practices]", pracRes.error);
        setPractices([]);
      } else {
        setPractices((pracRes.data as CompetencyPracticeRow[] | null) ?? []);
      }

      if (capRes.error) {
        console.error("[capability_areas]", capRes.error);
        setCapabilityAreas([]);
      } else {
        setCapabilityAreas((capRes.data as CapabilityAreaRow[] | null) ?? []);
      }

      if (subRes.error) {
        console.error("[competency_subjects]", subRes.error);
        setSubjects([]);
      } else {
        setSubjects((subRes.data as CompetencySubjectRow[] | null) ?? []);
      }

      setSubjectPracticeLinks(splRes);
      setCompetencyPracticeLinks(cplRes);

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
        "id, name, description, reference_framework, is_active, organisation_id, status, deprecated_at, deprecated_reason, replaced_by_id"
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

  async function reloadSubjectsForOrg(
    orgId: string
  ): Promise<CompetencySubjectRow[]> {
    const statusList = showArchivedEntities
      ? (["active", "deprecated", "archived"] as const)
      : (["active", "deprecated"] as const);
    const [subRes, links] = await Promise.all([
      supabase
        .from("competency_subjects")
        .select(
          "id, name, description, category, type, practice_id, capability_area_id, status, governance_status, deprecated_at, deprecated_reason, replaced_by_id, reference_subject_id, origin_type, capability_areas ( id, name ), reference_subjects ( id, name, reference_capability_areas ( id, name, reference_frameworks ( id, code, name ) ) ), competency_practices ( id, name, description, reference_framework, is_active, status, deprecated_at, deprecated_reason, replaced_by_id )"
        )
        .eq("organisation_id", orgId)
        .in("status", [...statusList])
        .order("name", { ascending: true }),
      fetchSubjectPracticeLinksForOrg(orgId),
    ]);

    if (subRes.error) {
      console.error(subRes.error);
      setSubjectPracticeLinks(links);
      return [];
    }
    const rows = (subRes.data as CompetencySubjectRow[] | null) ?? [];
    setSubjects(rows);
    setSubjectPracticeLinks(links);
    return rows;
  }

  async function reloadCompetencyPracticeLinksForOrg(orgId: string) {
    const links = await fetchCompetencyPracticeLinksForOrg(orgId);
    setCompetencyPracticeLinks(links);
  }

  async function reloadCapabilityAreasForOrg(
    orgId: string
  ): Promise<CapabilityAreaRow[]> {
    const res = await supabase
      .from("capability_areas")
      .select("id, organisation_id, name, description, created_at, governance_status")
      .eq("organisation_id", orgId)
      .order("name", { ascending: true });
    if (res.error) {
      console.error(res.error);
      return [];
    }
    const rows = (res.data as CapabilityAreaRow[] | null) ?? [];
    setCapabilityAreas(rows);
    return rows;
  }

  async function setCapabilityAreaGovernanceStatus(
    areaId: string,
    next: TaxonomyGovernanceStatus
  ) {
    if (!activeOrgId || !canAuthorHierarchy) return;
    const row = capabilityAreas.find((a) => a.id === areaId);
    if (!row) return;
    const cur = parseTaxonomyGovernanceStatus(row.governance_status);
    if (cur === next) return;
    if (cur === "protected" && next === "settled") {
      if (
        !window.confirm(
          "Remove protection and mark this capability area as settled?"
        )
      ) {
        return;
      }
    }
    if (cur === "protected" && next === "draft") {
      if (
        !window.confirm(
          "Remove protection and revert this capability area to draft?"
        )
      ) {
        return;
      }
    }
    setGovernanceUpdateBusy(`area:${areaId}`);
    try {
      const { error } = await supabase
        .from("capability_areas")
        .update({ governance_status: next })
        .eq("id", areaId)
        .eq("organisation_id", activeOrgId);
      if (error) throw error;
      await reloadCapabilityAreasForOrg(activeOrgId);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setGovernanceUpdateBusy(null);
    }
  }

  async function setSubjectGovernanceStatus(
    subjectId: string,
    next: TaxonomyGovernanceStatus
  ) {
    if (!activeOrgId || !canAuthorHierarchy) return;
    const row = subjects.find((s) => s.id === subjectId);
    if (!row) return;
    const cur = parseTaxonomyGovernanceStatus(row.governance_status);
    if (cur === next) return;
    if (cur === "protected" && next === "settled") {
      if (
        !window.confirm(
          "Remove protection and mark this subject as settled?"
        )
      ) {
        return;
      }
    }
    if (cur === "protected" && next === "draft") {
      if (
        !window.confirm("Remove protection and revert this subject to draft?")
      ) {
        return;
      }
    }
    setGovernanceUpdateBusy(`subject:${subjectId}`);
    try {
      const { error } = await supabase
        .from("competency_subjects")
        .update({ governance_status: next })
        .eq("id", subjectId)
        .eq("organisation_id", activeOrgId);
      if (error) throw error;
      await reloadSubjectsForOrg(activeOrgId);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setGovernanceUpdateBusy(null);
    }
  }

  async function handleSaveNewCapabilityArea(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeOrgId || !canAuthorHierarchy) return;
    const name = newCapabilityAreaName.trim();
    if (!name) {
      alert("Please enter a capability area name");
      return;
    }
    setIsSavingCapabilityArea(true);
    const { error } = await supabase.from("capability_areas").insert({
      organisation_id: activeOrgId,
      name,
      description:
        newCapabilityAreaDescription.trim() === ""
          ? null
          : newCapabilityAreaDescription.trim(),
    });
    if (error) {
      console.error(error);
      alert(error.message || "Failed to create capability area");
      setIsSavingCapabilityArea(false);
      return;
    }
    setNewCapabilityAreaName("");
    setNewCapabilityAreaDescription("");
    setShowCreateCapabilityAreaForm(false);
    setIsSavingCapabilityArea(false);
    await reloadCapabilityAreasForOrg(activeOrgId);
  }

  function openCapabilityAreaEditModal(area: CapabilityAreaRow) {
    setCapabilityAreaEditModal(area);
    setEditCapabilityAreaName(area.name.trim());
    setEditCapabilityAreaDescription(area.description?.trim() ?? "");
  }

  function closeCapabilityAreaEditModal() {
    setCapabilityAreaEditModal(null);
    setEditCapabilityAreaName("");
    setEditCapabilityAreaDescription("");
  }

  async function handleSaveEditCapabilityArea(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeOrgId || !capabilityAreaEditModal) return;
    const name = editCapabilityAreaName.trim();
    if (!name) {
      alert("Please enter a name");
      return;
    }
    setIsSavingCapabilityAreaEdit(true);
    const { error } = await supabase
      .from("capability_areas")
      .update({
        name,
        description:
          editCapabilityAreaDescription.trim() === ""
            ? null
            : editCapabilityAreaDescription.trim(),
      })
      .eq("id", capabilityAreaEditModal.id)
      .eq("organisation_id", activeOrgId);
    if (error) {
      console.error(error);
      alert(error.message || "Failed to update capability area");
      setIsSavingCapabilityAreaEdit(false);
      return;
    }
    closeCapabilityAreaEditModal();
    setIsSavingCapabilityAreaEdit(false);
    await reloadCapabilityAreasForOrg(activeOrgId);
  }

  async function reloadCompetenciesForOrg(orgId: string): Promise<CompetencyRow[]> {
    const statusList = showArchivedEntities
      ? (["active", "deprecated", "archived"] as const)
      : (["active", "deprecated"] as const);
    const res = await supabase
      .from("competencies")
      .select(
        "id, name, description, competency_type, is_active, status, deprecated_at, deprecated_reason, replaced_by_id, reference_competency_id, origin_type, canonical_name, subject_id, competency_subjects ( id, name, description, category, type, practice_id, capability_area_id, status, governance_status, deprecated_at, deprecated_reason, replaced_by_id, reference_subject_id, origin_type, competency_practices ( id, name, description, reference_framework, is_active, status, deprecated_at, deprecated_reason, replaced_by_id ) )"
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

  /**
   * All org competencies for exact name matching — same scope as DB unique constraint.
   * Not filtered by lifecycle UI; use `reloadCompetenciesForOrg` for display.
   */
  async function loadExactDuplicateCandidatesForOrg(
    orgId: string
  ): Promise<CompetencyRow[]> {
    const res = await supabase
      .from("competencies")
      .select(
        "id, name, description, competency_type, is_active, status, deprecated_at, deprecated_reason, replaced_by_id, subject_id"
      )
      .eq("organisation_id", orgId)
      .order("name");

    if (res.error) {
      console.error(res.error);
      alert(res.error.message);
      return [];
    }
    return (res.data as CompetencyRow[] | null) ?? [];
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
    const orgScope =
      normalizeCompetencyType(newSubjectType) === "organisation";
    const linkPracticeIds = orgScope
      ? []
      : [...new Set(newSubjectPracticeIds.filter(Boolean))];
    const capAreaTrim = newSubjectCapabilityAreaId.trim();
    const { data: inserted, error } = await supabase
      .from("competency_subjects")
      .insert({
        organisation_id: activeOrgId,
        name,
        description: descriptionTrimmed.length > 0 ? descriptionTrimmed : null,
        category: categoryTrimmed.length > 0 ? categoryTrimmed : null,
        type: newSubjectType,
        practice_id: null,
        capability_area_id: capAreaTrim === "" ? null : capAreaTrim,
        is_active: true,
        status: "active",
      })
      .select("id")
      .maybeSingle();

    if (error) {
      console.error(error);
      alert(error.message || "Failed to create subject");
      setIsSavingSubject(false);
      return;
    }
    const newId = inserted?.id;
    if (newId && linkPracticeIds.length > 0) {
      const { error: linkErr } = await replaceSubjectPracticeLinksForSubject(
        activeOrgId,
        newId,
        linkPracticeIds
      );
      if (linkErr) {
        console.error(linkErr);
        alert(linkErr.message || "Subject created but practice links failed.");
        setIsSavingSubject(false);
        return;
      }
    }

    setNewSubjectName("");
    setNewSubjectDescription("");
    setNewSubjectCategory("");
    setNewSubjectType("practice");
    setNewSubjectPracticeIds([]);
    setNewSubjectCapabilityAreaId("");
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
    setNewSubjectPracticeIds([]);
    setNewSubjectCapabilityAreaId("");
  }

  function openCreateSubjectForPractice(practice: ManagementPracticeGroup) {
    if (!canAuthorHierarchy) return;
    setSubjectCreateFromOrganisationTree(false);
    setSubjectCreatePracticeKey(practice.key);
    setNewSubjectCapabilityAreaId("");
    if (practice.key === PRACTICE_SUBJECTS_ROOT_KEY) {
      setNewSubjectPracticeIds([]);
    } else {
      setNewSubjectPracticeIds(
        practice.isUnassigned ? [] : [practice.key]
      );
    }
    setNewSubjectName("");
    setNewSubjectDescription("");
    setNewSubjectCategory("");
    setNewSubjectType("practice");
  }

  function openCreateSubjectForCapabilityArea(practice: ManagementPracticeGroup) {
    if (!canAuthorHierarchy) return;
    setSubjectCreateFromOrganisationTree(false);
    setSubjectCreatePracticeKey(practice.key);
    setNewSubjectPracticeIds([]);
    setNewSubjectCapabilityAreaId(
      practice.key === UNASSIGNED_CAPABILITY_AREA_KEY ? "" : practice.key
    );
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
    handleCancelEditPractice();

    await reloadPracticesForOrg(activeOrgId);
  }

  function handleCancelCreatePractice() {
    setShowCreatePracticeForm(false);
    setNewPracticeName("");
    setNewPracticeDescription("");
  }

  function handleStartEditPractice(p: CompetencyPracticeRow) {
    setEditingPracticeId(p.id);
    setEditPracticeName(p.name.trim());
    setEditPracticeDescription(p.description?.trim() ?? "");
    setEditPracticeReferenceFramework(p.reference_framework?.trim() ?? "");
    setShowCreatePracticeForm(false);
  }

  function handleCancelEditPractice() {
    setEditingPracticeId(null);
    setEditPracticeName("");
    setEditPracticeDescription("");
    setEditPracticeReferenceFramework("");
  }

  async function handleSaveEditPractice(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (activeOrgId === null || !editingPracticeId) return;
    const name = editPracticeName.trim();
    if (!name) {
      alert("Please enter a practice name");
      return;
    }
    const descriptionTrimmed = editPracticeDescription.trim();
    const frameworkTrimmed = editPracticeReferenceFramework.trim();
    setIsSavingEditPractice(true);
    const { error } = await supabase
      .from("competency_practices")
      .update({
        name,
        description: descriptionTrimmed.length > 0 ? descriptionTrimmed : null,
        reference_framework:
          frameworkTrimmed.length > 0 ? frameworkTrimmed : null,
      })
      .eq("id", editingPracticeId)
      .eq("organisation_id", activeOrgId);
    if (error) {
      console.error(error);
      alert(error.message || "Failed to update practice");
      setIsSavingEditPractice(false);
      return;
    }
    handleCancelEditPractice();
    setIsSavingEditPractice(false);
    await reloadPracticesForOrg(activeOrgId);
  }

  async function performInsertCompetency(
    name: string,
    descriptionTrimmed: string,
    subjectId: string | null,
    competencyType: CompetencyType
  ) {
    if (activeOrgId === null) return;
    if (!canAuthorHierarchy) return;
    setIsSavingCompetency(true);
    const freshRows = await reloadCompetenciesForOrg(activeOrgId);
    const idsBefore = new Set(freshRows.map((c) => c.id));
    const exactCandidates = await loadExactDuplicateCandidatesForOrg(activeOrgId);
    const exactBeforeInsert = findExactCompetencyByName(name, exactCandidates);
    if (exactBeforeInsert) {
      setCompetencyExactReuseModal({
        source: "manual",
        existing: exactBeforeInsert,
        targetSubjectId: subjectId,
        competencyTypeForTarget: resolveCompetencyTypeForSubject(
          subjectId,
          competencyType,
          subjects
        ),
        pendingName: name,
        pendingDescription: descriptionTrimmed,
      });
      setIsSavingCompetency(false);
      return;
    }
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
        alert(
          "A competency with this name already exists in this organisation."
        );
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

  async function moveCompetencyToSubject(
    competencyId: string,
    targetSubjectId: string | null | undefined,
    preferredCompetencyType: CompetencyType
  ): Promise<boolean> {
    if (activeOrgId === null) return false;
    /** Never pass undefined to Supabase — omitted keys skip PATCH fields and leave subject_id unchanged. */
    const normalizedSubjectId =
      targetSubjectId == null || String(targetSubjectId).trim() === ""
        ? null
        : String(targetSubjectId).trim();

    const resolvedType = resolveCompetencyTypeForSubject(
      normalizedSubjectId,
      preferredCompetencyType,
      subjects
    );

    const updatePayload = {
      subject_id: normalizedSubjectId,
      competency_type: resolvedType,
    };

    const { data: updatedRow, error } = await supabase
      .from("competencies")
      .update(updatePayload)
      .eq("id", competencyId)
      .eq("organisation_id", activeOrgId)
      .select("id, subject_id, competency_type")
      .maybeSingle();

    if (error) {
      console.error(error);
      alert(error.message || "Could not move competency.");
      return false;
    }
    if (!updatedRow) {
      console.error("Competency move update returned no row (RLS or missing competency)");
      alert("Could not move competency (no row updated).");
      return false;
    }

    await Promise.all([
      reloadCompetenciesForOrg(activeOrgId),
      reloadSubjectsForOrg(activeOrgId),
    ]);
    return true;
  }

  async function patchCompetencyToSubjectQuiet(
    competencyId: string,
    targetSubjectId: string | null | undefined,
    preferredCompetencyType: CompetencyType,
    subjectsList: CompetencySubjectRow[],
  ): Promise<boolean> {
    if (activeOrgId === null) return false;
    const normalizedSubjectId =
      targetSubjectId == null || String(targetSubjectId).trim() === ""
        ? null
        : String(targetSubjectId).trim();

    const resolvedType = resolveCompetencyTypeForSubject(
      normalizedSubjectId,
      preferredCompetencyType,
      subjectsList,
    );

    const { data: updatedRow, error } = await supabase
      .from("competencies")
      .update({
        subject_id: normalizedSubjectId,
        competency_type: resolvedType,
      })
      .eq("id", competencyId)
      .eq("organisation_id", activeOrgId)
      .select("id, subject_id, competency_type")
      .maybeSingle();

    if (error) {
      console.error(error);
      return false;
    }
    return !!updatedRow;
  }

  async function handleApplySubjectMerges() {
    if (activeOrgId === null || !pendingSubjectMergeContext) return;
    if (subjectMergeDecisions.length !== subjectMergeResolvedGroups.length) {
      return;
    }

    const summary = {
      mergesCompleted: 0,
      competenciesMoved: 0,
      duplicatesSkipped: 0,
      duplicateCompetenciesDeprecated: 0,
      subjectsDeprecated: 0,
      mergesSkipped: 0,
      warnings: [] as string[],
    };

    setSubjectMergeApplying(true);
    try {
      let workingCompetencies = await reloadCompetenciesForOrg(activeOrgId);
      let workingSubjects = await reloadSubjectsForOrg(activeOrgId);
      let workingLinks = await fetchSubjectPracticeLinksForOrg(activeOrgId);

      for (let i = 0; i < subjectMergeResolvedGroups.length; i++) {
        const group = subjectMergeResolvedGroups[i]!;
        const decision = subjectMergeDecisions[i]!;
        if (decision.mode === "skip" || group.blockedReason) {
          summary.mergesSkipped++;
          continue;
        }

        const survivorId = decision.survivorId?.trim() || null;
        if (!survivorId) {
          summary.warnings.push(
            `Merge in “${group.areaName}”: no survivor selected — skipped.`,
          );
          summary.mergesSkipped++;
          continue;
        }

        const survivorRow = workingSubjects.find((s) => s.id === survivorId);
        if (!survivorRow || !isAssignableLifecycleStatus(survivorRow.status)) {
          summary.warnings.push(
            `Merge in “${group.areaName}”: survivor is missing or not active — skipped.`,
          );
          summary.mergesSkipped++;
          continue;
        }

        const memberIds = new Set(group.members.map((m) => m.id));
        if (!memberIds.has(survivorId)) {
          summary.warnings.push(
            `Merge in “${group.areaName}”: survivor is outside the resolved group — skipped.`,
          );
          summary.mergesSkipped++;
          continue;
        }

        const victims = group.members
          .map((m) => workingSubjects.find((s) => s.id === m.id))
          .filter(
            (s): s is CompetencySubjectRow =>
              !!s && s.id !== survivorId && isAssignableLifecycleStatus(s.status),
          );

        if (victims.length === 0) {
          summary.warnings.push(
            `Merge in “${group.areaName}”: no active duplicate subjects to retire — skipped.`,
          );
          summary.mergesSkipped++;
          continue;
        }

        const rename = decision.survivorRename.trim();
        if (rename && rename !== survivorRow.name.trim()) {
          const { error: renErr } = await supabase
            .from("competency_subjects")
            .update({ name: rename })
            .eq("id", survivorId)
            .eq("organisation_id", activeOrgId);
          if (renErr) {
            console.error(renErr);
            summary.warnings.push(
              `Merge in “${group.areaName}”: could not rename survivor — skipped group.`,
            );
            summary.mergesSkipped++;
            continue;
          }
          workingSubjects = await reloadSubjectsForOrg(activeOrgId);
        }

        const survivorRowLatest =
          workingSubjects.find((s) => s.id === survivorId) ?? survivorRow;

        const practiceIdsToEnsure = new Set<string>();
        for (const v of victims) {
          for (const pid of practiceIdsForSubjectDisplay(
            workingLinks,
            v.id,
            v.practice_id,
          )) {
            practiceIdsToEnsure.add(pid);
          }
        }

        let victimLinkDeleteFailed = false;
        for (const v of victims) {
          const { error: delLinkErr } = await supabase
            .from("subject_practice_links")
            .delete()
            .eq("organisation_id", activeOrgId)
            .eq("subject_id", v.id);
          if (delLinkErr) {
            console.error(delLinkErr);
            summary.warnings.push(
              `Could not clear practice links for subject “${v.name}” — merge skipped for this group (no competencies or subjects were changed).`,
            );
            victimLinkDeleteFailed = true;
            break;
          }
        }

        if (victimLinkDeleteFailed) {
          summary.mergesSkipped++;
          continue;
        }

        workingLinks = workingLinks.filter(
          (l) => !victims.some((v) => v.id === l.subject_id),
        );

        const survivorKeySet = new Set(
          workingCompetencies
            .filter(
              (c) =>
                c.subject_id === survivorId &&
                isAssignableLifecycleStatus(c.status),
            )
            .map((c) => normalizeCompetencyNameKey(c.name)),
        );

        for (const v of victims) {
          const victimComps = workingCompetencies.filter(
            (c) =>
              c.subject_id === v.id && isAssignableLifecycleStatus(c.status),
          );
          for (const comp of victimComps) {
            const k = normalizeCompetencyNameKey(comp.name);
            if (survivorKeySet.has(k)) {
              summary.duplicatesSkipped++;
              const keeper = workingCompetencies.find(
                (c) =>
                  c.subject_id === survivorId &&
                  normalizeCompetencyNameKey(c.name) === k &&
                  isAssignableLifecycleStatus(c.status),
              );
              if (
                keeper &&
                isAssignableLifecycleStatus(comp.status) &&
                comp.id !== keeper.id
              ) {
                const { error: depErr } = await supabase
                  .from("competencies")
                  .update({
                    status: "deprecated",
                    deprecated_at: new Date().toISOString(),
                    deprecated_reason:
                      "Duplicate name after subject merge — retained on surviving subject.",
                    replaced_by_id: keeper.id,
                    is_active: true,
                  })
                  .eq("id", comp.id)
                  .eq("organisation_id", activeOrgId);
                if (!depErr) {
                  summary.duplicateCompetenciesDeprecated++;
                } else {
                  summary.warnings.push(
                    `Could not deprecate duplicate competency “${comp.name}” (${comp.id.slice(0, 8)}…).`,
                  );
                }
              }
              continue;
            }
            const ok = await patchCompetencyToSubjectQuiet(
              comp.id,
              survivorId,
              toCompetencyTypeUnion(comp.competency_type ?? "practice"),
              workingSubjects,
            );
            if (ok) {
              survivorKeySet.add(k);
              summary.competenciesMoved++;
              const row = workingCompetencies.find((x) => x.id === comp.id);
              if (row) row.subject_id = survivorId;
            } else {
              summary.warnings.push(
                `Could not move competency “${comp.name}” to survivor — left on victim for manual review.`,
              );
            }
          }
        }

        for (const pid of practiceIdsToEnsure) {
          if (
            !linkExistsInMemory(workingLinks, survivorId, pid) &&
            survivorRowLatest.practice_id !== pid
          ) {
            const { error: linkErr } = await addSubjectPracticeLink(
              activeOrgId,
              survivorId,
              pid,
            );
            if (linkErr) {
              summary.warnings.push(
                `Could not add practice link ${pid.slice(0, 8)}… to survivor — review practice relevance.`,
              );
            } else {
              workingLinks.push({
                id: `temp-${survivorId}-${pid}`,
                organisation_id: activeOrgId,
                subject_id: survivorId,
                practice_id: pid,
                created_at: new Date().toISOString(),
              });
            }
          }
        }

        const survivorDisplayName =
          rename.trim() ||
          survivorRowLatest.name.trim() ||
          survivorRow.name.trim();

        let victimStillHasCompetencies: CompetencySubjectRow | null = null;
        for (const v of victims) {
          const remainingOnVictim = workingCompetencies.filter(
            (c) =>
              c.subject_id === v.id && isAssignableLifecycleStatus(c.status),
          );
          if (remainingOnVictim.length > 0) {
            victimStillHasCompetencies = v;
            break;
          }
        }
        if (victimStillHasCompetencies) {
          summary.warnings.push(
            `“${victimStillHasCompetencies.name}” still has competencies that could not all be moved or deduplicated — victims were not deprecated. Review manually.`,
          );
          summary.mergesSkipped++;
          workingCompetencies = await reloadCompetenciesForOrg(activeOrgId);
          continue;
        }

        for (const v of victims) {
          const { error: depSubErr } = await supabase
            .from("competency_subjects")
            .update({
              status: "deprecated",
              deprecated_at: new Date().toISOString(),
              deprecated_reason: `Subject merged into “${survivorDisplayName}”.`,
              replaced_by_id: survivorId,
              is_active: true,
              practice_id: null,
            })
            .eq("id", v.id)
            .eq("organisation_id", activeOrgId);
          if (depSubErr) {
            console.error(depSubErr);
            summary.warnings.push(
              `Could not deprecate subject “${v.name}” — merge may be incomplete.`,
            );
          } else {
            summary.subjectsDeprecated++;
          }
        }

        summary.mergesCompleted++;
        workingCompetencies = await reloadCompetenciesForOrg(activeOrgId);
        workingSubjects = await reloadSubjectsForOrg(activeOrgId);
        workingLinks = await fetchSubjectPracticeLinksForOrg(activeOrgId);
      }

      await Promise.all([
        reloadCompetenciesForOrg(activeOrgId),
        reloadSubjectsForOrg(activeOrgId),
      ]);
      setSubjectPracticeLinks(await fetchSubjectPracticeLinksForOrg(activeOrgId));

      setSubjectMergeApplySummary(summary);
      setPendingSubjectMergeContext(null);
    } finally {
      setSubjectMergeApplying(false);
    }
  }

  function closeSubjectMergeModal() {
    setSubjectMergeModalOpen(false);
    setSubjectMergeApplySummary(null);
  }

  async function finalizeAiInsertable(
    insertable: Array<{ id: string; name: string; description: string }>,
    sid: string,
    resolvedGenType: CompetencyType,
    opts?: { skipSimilarConfirm?: boolean }
  ) {
    if (!activeOrgId) return;
    if (insertable.length === 0) {
      await reloadCompetenciesForOrg(activeOrgId);
      closeCompetencyGenModal();
      return;
    }
    if (!opts?.skipSimilarConfirm) {
      const latestCompetencies = await reloadCompetenciesForOrg(activeOrgId);
      const similarRisky: { name: string; matches: CompetencyRow[] }[] = [];
      for (const r of insertable) {
        const sim = findSimilarCompetencies(r.name, latestCompetencies).filter(
          (c) =>
            c.subject_id !== sid ||
            normalizeCompetencyNameKey(c.name) !==
              normalizeCompetencyNameKey(r.name)
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
    }

    setCompetencyGenAccepting(true);
    try {
      for (let i = 0; i < insertable.length; i++) {
        const row = insertable[i]!;
        const exactCandidates = await loadExactDuplicateCandidatesForOrg(
          activeOrgId
        );
        const exactBeforeInsert = findExactCompetencyByName(
          row.name,
          exactCandidates
        );
        if (exactBeforeInsert) {
          setCompetencyExactReuseModal({
            source: "ai",
            current: {
              name: row.name.trim(),
              description: row.description.trim(),
              existing: exactBeforeInsert,
            },
            rest: [],
            insertable: insertable.slice(i + 1),
            targetSubjectId: sid,
            resolvedGenType,
          });
          return;
        }
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
              "A competency with this name already exists in this organisation."
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
        await reloadCompetenciesForOrg(activeOrgId);
      }
      await reloadCompetenciesForOrg(activeOrgId);
      closeCompetencyGenModal();
    } finally {
      setCompetencyGenAccepting(false);
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

    const freshRows = await reloadCompetenciesForOrg(activeOrgId);
    const exactCandidates = await loadExactDuplicateCandidatesForOrg(activeOrgId);
    const exactDup = findExactCompetencyByName(name, exactCandidates);
    if (exactDup) {
      setCompetencyExactReuseModal({
        source: "manual",
        existing: exactDup,
        targetSubjectId: subjectId,
        competencyTypeForTarget: resolveCompetencyTypeForSubject(
          subjectId,
          newCompetencyType,
          subjects
        ),
        pendingName: name,
        pendingDescription: descriptionTrimmed,
      });
      return;
    }

    const nameKey = normalizeCompetencyNameKey(name);
    const similar = findSimilarCompetencies(name, freshRows).filter(
      (c) => normalizeCompetencyNameKey(c.name) !== nameKey
    );
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
    setCompetencyExactReuseModal(null);
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
    const subj = subjects.find((s) => s.id === section.key);
    if (subj) {
      setEditSubjectCapabilityAreaId(subj.capability_area_id ?? "");
      const t = normalizeCompetencyType(subj.type);
      if (t === "organisation") {
        setEditSubjectScope("organisation");
        setEditSubjectPracticeIds([]);
        setEditSubjectType("organisation");
      } else {
        setEditSubjectScope("practice");
        setEditSubjectPracticeIds(
          practiceIdsForSubjectDisplay(
            subjectPracticeLinks,
            subj.id,
            subj.practice_id
          )
        );
        setEditSubjectType(toCompetencyTypeUnion(t));
      }
    } else {
      if (
        normalizeCompetencyType(String(section.subjectType)) === "organisation"
      ) {
        setEditSubjectScope("organisation");
        setEditSubjectPracticeIds([]);
        setEditSubjectType("organisation");
      } else {
        setEditSubjectScope("practice");
        setEditSubjectPracticeIds(section.subjectPracticeIds);
        setEditSubjectType(section.subjectType);
      }
      setEditSubjectCapabilityAreaId("");
    }
  }

  function handleCancelEditSubject() {
    setEditingSubjectId(null);
    setEditSubjectName("");
    setEditSubjectDescription("");
    setEditSubjectCategory("");
    setEditSubjectType("practice");
    setEditSubjectScope("practice");
    setEditSubjectPracticeIds([]);
    setEditSubjectCapabilityAreaId("");
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
    let nextType: CompetencyType;

    if (editSubjectScope === "organisation") {
      nextType = "organisation";
    } else {
      nextType = editSubjectType === "stretch" ? "stretch" : "practice";
    }

    const capEdit = editSubjectCapabilityAreaId.trim();
    const linkIds =
      editSubjectScope === "organisation"
        ? []
        : [...new Set(editSubjectPracticeIds.filter(Boolean))];
    /** Clear legacy practice_id; relevance lives in subject_practice_links. */
    const updatePayload = {
      name,
      description: descriptionTrimmed.length > 0 ? descriptionTrimmed : null,
      category: categoryTrimmed.length > 0 ? categoryTrimmed : null,
      type: nextType,
      practice_id: null,
      capability_area_id: capEdit === "" ? null : capEdit,
    };

    const { data: updatedRow, error } = await supabase
      .from("competency_subjects")
      .update(updatePayload)
      .eq("id", editingSubjectId)
      .eq("organisation_id", activeOrgId)
      .select("id, name, practice_id, type, organisation_id")
      .maybeSingle();

    if (error) {
      console.error(error);
      alert(error.message || "Failed to update subject.");
      setIsSavingEditSubject(false);
      return;
    }
    if (!updatedRow) {
      console.error("Subject update returned no row (RLS or subject not found)");
      alert(
        "The subject could not be updated. Check permissions or try again."
      );
      setIsSavingEditSubject(false);
      return;
    }

    const { error: linkErr } = await replaceSubjectPracticeLinksForSubject(
      activeOrgId,
      editingSubjectId,
      linkIds
    );
    if (linkErr) {
      console.error(linkErr);
      alert(linkErr.message || "Failed to update practice relevance links.");
      setIsSavingEditSubject(false);
      return;
    }

    setEditingSubjectId(null);
    setEditSubjectName("");
    setEditSubjectDescription("");
    setEditSubjectCategory("");
    setEditSubjectType("practice");
    setEditSubjectScope("practice");
    setEditSubjectPracticeIds([]);
    setEditSubjectCapabilityAreaId("");
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

  /** AI refinement and unassigned cleanup flows — never include archived. */
  const competenciesForRefinementFlow = useMemo(
    () => excludeArchivedCompetencies(filteredCompetencies),
    [filteredCompetencies]
  );

  const competencyCountBySubject = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of filteredCompetencies) {
      const sid = c.subject_id;
      if (!sid) continue;
      m.set(sid, (m.get(sid) ?? 0) + 1);
    }
    return m;
  }, [filteredCompetencies]);

  const subjectMergeResolvedGroups = useMemo(() => {
    if (!pendingSubjectMergeContext) return [];
    return buildSubjectMergeResolvedGroups(
      pendingSubjectMergeContext.merges,
      pendingSubjectMergeContext.proposedCapabilityAreas,
      subjects,
      capabilityAreas,
      competencyCountBySubject,
      subjectPracticeLinks,
    );
  }, [
    pendingSubjectMergeContext,
    subjects,
    capabilityAreas,
    competencyCountBySubject,
    subjectPracticeLinks,
  ]);

  const subjectMergeModalOpenedRef = useRef(false);
  useEffect(() => {
    if (!subjectMergeModalOpen) {
      subjectMergeModalOpenedRef.current = false;
      return;
    }
    if (subjectMergeModalOpenedRef.current) return;
    subjectMergeModalOpenedRef.current = true;
    setSubjectMergeApplySummary(null);
    setSubjectMergeDecisions(
      subjectMergeResolvedGroups.map((g) => {
        const pickOptions = g.members.filter((m) =>
          isAssignableLifecycleStatus(m.status),
        );
        const recOk =
          !!g.recommendedSurvivorId &&
          g.members.some(
            (m) =>
              m.id === g.recommendedSurvivorId &&
              isAssignableLifecycleStatus(m.status),
          );
        const defSurvivor = recOk
          ? g.recommendedSurvivorId!
          : pickOptions[0]?.id ?? null;
        if (g.blockedReason || pickOptions.length < 2 || !defSurvivor) {
          return {
            mode: "skip" as const,
            survivorId: null,
            survivorRename: "",
          };
        }
        return {
          mode: recOk ? ("recommended" as const) : ("pick" as const),
          survivorId: defSurvivor,
          survivorRename: "",
        };
      }),
    );
  }, [subjectMergeModalOpen, subjectMergeResolvedGroups]);

  const taxonomyGovernanceAnchors = useMemo(() => {
    const settledSubjectNames: string[] = [];
    const protectedSubjectNames: string[] = [];
    for (const s of subjects) {
      const g = parseTaxonomyGovernanceStatus(s.governance_status);
      const n = s.name.trim();
      if (!n) continue;
      if (g === "settled") settledSubjectNames.push(n);
      if (g === "protected") protectedSubjectNames.push(n);
    }
    const settledCapabilityAreaNames: string[] = [];
    const protectedCapabilityAreaNames: string[] = [];
    for (const a of capabilityAreas) {
      const g = parseTaxonomyGovernanceStatus(a.governance_status);
      const n = a.name.trim();
      if (!n) continue;
      if (g === "settled") settledCapabilityAreaNames.push(n);
      if (g === "protected") protectedCapabilityAreaNames.push(n);
    }
    return {
      settledSubjectNames,
      protectedSubjectNames,
      settledCapabilityAreaNames,
      protectedCapabilityAreaNames,
    };
  }, [subjects, capabilityAreas]);

  const subjectsForCapabilityTree = useMemo(() => {
    let s = filteredSubjects;
    if (viewMode === "practice") {
      s = s.filter(isPracticeScopeSubjectRow);
    } else if (viewMode === "organisation") {
      s = s.filter(
        (x) => normalizeCompetencyType(x.type) === "organisation"
      );
    }
    if (subjectPrimaryPracticeFilter === "unassigned") {
      s = s.filter((x) =>
        subjectMatchesPracticeRelevanceFilter(
          x,
          "unassigned",
          subjectPracticeLinks
        )
      );
    } else if (subjectPrimaryPracticeFilter !== "all") {
      s = s.filter((x) =>
        subjectMatchesPracticeRelevanceFilter(
          x,
          subjectPrimaryPracticeFilter,
          subjectPracticeLinks
        )
      );
    }
    if (subjectCompetencyPresenceFilter === "with") {
      s = s.filter(
        (x) => (competencyCountBySubject.get(x.id) ?? 0) > 0
      );
    } else if (subjectCompetencyPresenceFilter === "without") {
      s = s.filter(
        (x) => (competencyCountBySubject.get(x.id) ?? 0) === 0
      );
    }
    if (taxonomyGovernanceFilter !== "all") {
      s = s.filter(
        (x) =>
          parseTaxonomyGovernanceStatus(x.governance_status) ===
          taxonomyGovernanceFilter
      );
    }
    return s;
  }, [
    filteredSubjects,
    viewMode,
    subjectPrimaryPracticeFilter,
    subjectCompetencyPresenceFilter,
    competencyCountBySubject,
    taxonomyGovernanceFilter,
    subjectPracticeLinks,
  ]);

  const managementCapabilityAreaGroups = useMemo(
    () =>
      buildCapabilityAreaManagementGroups(
        capabilityAreas,
        subjectsForCapabilityTree,
        filteredCompetencies,
        subjectPracticeLinks
      ),
    [
      capabilityAreas,
      subjectsForCapabilityTree,
      filteredCompetencies,
      subjectPracticeLinks,
    ]
  );

  const subjectNormEligibleCount = useMemo(
    () =>
      managementCapabilityAreaGroups.reduce(
        (n, g) => n + catalogueSubjectSectionsForBatchGen(g).length,
        0,
      ),
    [managementCapabilityAreaGroups],
  );

  /** Practices visible under current lifecycle filters (Practice view headers). */
  const practicesForPracticeLensView = useMemo(
    () =>
      [...practices]
        .filter((p) =>
          entityMatchesLifecycleFilter(
            p.status,
            lifecycleViewFilter,
            showArchivedEntities
          )
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [practices, lifecycleViewFilter, showArchivedEntities]
  );

  const assignablePractices = useMemo(
    () => practices.filter((p) => isAssignableLifecycleStatus(p.status)),
    [practices]
  );

  /** Include selected practices in the picker even if not assignable (e.g. deprecated). */
  const practicesForEditSubjectPrimary = useMemo(() => {
    if (!editingSubjectId) return assignablePractices;
    const extra = editSubjectPracticeIds
      .filter((id) => !assignablePractices.some((p) => p.id === id))
      .map((id) => practices.find((pr) => pr.id === id))
      .filter((p): p is CompetencyPracticeRow => !!p);
    if (extra.length === 0) return assignablePractices;
    return [...assignablePractices, ...extra];
  }, [
    assignablePractices,
    editingSubjectId,
    practices,
    editSubjectPracticeIds,
  ]);

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

  const orgPanelEditing = useMemo(
    () =>
      editingCompetencyId !== null &&
      filteredCompetencies.some(
        (c) =>
          c.id === editingCompetencyId &&
          normalizeCompetencyType(c.competency_type) === "organisation"
      ),
    [editingCompetencyId, filteredCompetencies]
  );

  const orgPanelLevels = useMemo(
    () =>
      expandedCompetencyId !== null &&
      filteredCompetencies.some(
        (c) =>
          c.id === expandedCompetencyId &&
          normalizeCompetencyType(c.competency_type) === "organisation"
      ),
    [expandedCompetencyId, filteredCompetencies]
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

  function togglePracticeLensAccordion(practiceId: string) {
    setPracticeLensAccordionOpen((prev) => {
      const cur = prev[practiceId] ?? true;
      return { ...prev, [practiceId]: !cur };
    });
  }

  function openRemoveSubjectFromPracticeModal(
    practice: CompetencyPracticeRow,
    subject: CompetencySubjectRow,
  ) {
    setPracticeOverlayFeedback(null);
    setPracticeRemoveConfirm({ practice, subject });
  }

  async function confirmRemoveSubjectFromPracticeOverlay() {
    if (!activeOrgId || !practiceRemoveConfirm || !canAuthorHierarchy) return;
    const { practice, subject } = practiceRemoveConfirm;
    const rowKey = `${practice.id}::${subject.id}`;
    setRemovingSubjectFromPracticeKey(rowKey);
    try {
      const { error } = await removeSubjectFromPracticeOverlay(
        activeOrgId,
        practice.id,
        subject.id,
      );
      if (error) {
        alert(error.message);
        return;
      }
      await reloadCompetencyPracticeLinksForOrg(activeOrgId);
      await reloadSubjectsForOrg(activeOrgId);
      setPracticeRemoveConfirm(null);
      setPracticeOverlayFeedback(
        `Removed ${subject.name.trim() || "subject"} from ${practice.name.trim() || "practice"}.`,
      );
    } finally {
      setRemovingSubjectFromPracticeKey(null);
    }
  }

  function openPracticeAddItemsModal(
    practice: CompetencyPracticeRow,
    subject: CompetencySubjectRow,
  ) {
    setPracticeOverlayFeedback(null);
    setAddItemsSelectedIds(new Set());
    setPracticeAddItemsModal({ practice, subject });
  }

  function togglePracticeAddItemSelection(competencyId: string) {
    setAddItemsSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(competencyId)) n.delete(competencyId);
      else n.add(competencyId);
      return n;
    });
  }

  async function applyPracticeAddItems() {
    if (!activeOrgId || !practiceAddItemsModal || !canAuthorHierarchy) return;
    const { practice, subject } = practiceAddItemsModal;
    setAddItemsApplying(true);
    try {
      const { error: se } = await ensureSubjectLinkedToPracticeOrganisation(
        activeOrgId,
        practice.id,
        subject.id,
      );
      if (se) {
        alert(se.message);
        return;
      }
      for (const cid of addItemsSelectedIds) {
        const { error } = await ensureCompetencyLinkedToPracticeOrganisation(
          activeOrgId,
          practice.id,
          cid,
        );
        if (error) {
          alert(error.message);
          return;
        }
      }
      await reloadCompetencyPracticeLinksForOrg(activeOrgId);
      await reloadSubjectsForOrg(activeOrgId);
      const n = addItemsSelectedIds.size;
      const pn = practice.name.trim() || "practice";
      setPracticeOverlayFeedback(
        n > 0
          ? `Added ${n} competencies to ${pn}.`
          : `Linked subject to ${pn}. Select competencies anytime via Manage items.`,
      );
      setPracticeAddItemsModal(null);
    } finally {
      setAddItemsApplying(false);
    }
  }

  function openPracticeManageItemsModal(
    practice: CompetencyPracticeRow,
    subject: CompetencySubjectRow,
  ) {
    setPracticeOverlayFeedback(null);
    const rows = listPracticeManagedCompetenciesForSubject(
      practice.id,
      subject.id,
      competencies,
      competencyPracticeLinks,
    );
    const next: Record<string, boolean> = {};
    for (const c of rows) {
      next[c.id] = competencyLinkedToPractice(
        competencyPracticeLinks,
        c.id,
        practice.id,
      );
    }
    setManageItemsLinked(next);
    setPracticeManageModal({ practice, subject });
  }

  async function applyPracticeManageItems() {
    if (!activeOrgId || !practiceManageModal || !canAuthorHierarchy) return;
    const { practice, subject } = practiceManageModal;
    const rows = listPracticeManagedCompetenciesForSubject(
      practice.id,
      subject.id,
      competencies,
      competencyPracticeLinks,
    );
    setManageItemsApplying(true);
    try {
      for (const c of rows) {
        const was = competencyLinkedToPractice(
          competencyPracticeLinks,
          c.id,
          practice.id,
        );
        const now = manageItemsLinked[c.id] ?? false;
        if (was === now) continue;
        if (now) {
          const { error: e1 } = await ensureSubjectLinkedToPracticeOrganisation(
            activeOrgId,
            practice.id,
            subject.id,
          );
          if (e1) {
            alert(e1.message);
            return;
          }
          const { error: e2 } =
            await ensureCompetencyLinkedToPracticeOrganisation(
              activeOrgId,
              practice.id,
              c.id,
            );
          if (e2) {
            alert(e2.message);
            return;
          }
        } else {
          const { error: e3 } = await removeCompetencyPracticeLink(
            activeOrgId,
            practice.id,
            c.id,
          );
          if (e3) {
            alert(e3.message);
            return;
          }
        }
      }
      await reloadCompetencyPracticeLinksForOrg(activeOrgId);
      await reloadSubjectsForOrg(activeOrgId);
      setPracticeOverlayFeedback(
        `Updated ${practice.name.trim() || "practice"} practice items for ${subject.name.trim() || "subject"}.`,
      );
      setPracticeManageModal(null);
    } finally {
      setManageItemsApplying(false);
    }
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
        taxonomyAnchors: {
          protectedSubjectNames:
            taxonomyGovernanceAnchors.protectedSubjectNames,
          settledSubjectNames: taxonomyGovernanceAnchors.settledSubjectNames,
          protectedCapabilityAreaNames:
            taxonomyGovernanceAnchors.protectedCapabilityAreaNames,
          settledCapabilityAreaNames:
            taxonomyGovernanceAnchors.settledCapabilityAreaNames,
        },
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
      let expansionLinks = await fetchSubjectPracticeLinksForOrg(activeOrgId);
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
              .filter((s) =>
                subjectIsRelevantToPractice(
                  expansionLinks,
                  s.id,
                  practiceId,
                  s
                )
              )
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
              practice_id: null,
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
          const { error: linkErr } = await addSubjectPracticeLink(
            activeOrgId,
            subjectId,
            practiceId
          );
          if (linkErr) {
            console.error(linkErr);
            alert(
              linkErr.message ||
                "Subject created but practice link failed."
            );
            return;
          }
          expansionLinks = [
            ...expansionLinks,
            {
              id: crypto.randomUUID(),
              organisation_id: activeOrgId,
              subject_id: subjectId,
              practice_id: practiceId,
              created_at: new Date().toISOString(),
            },
          ];
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

            const exactCandidates =
              await loadExactDuplicateCandidatesForOrg(activeOrgId);
            const exactBeforeInsert = findExactCompetencyByName(
              cn,
              exactCandidates
            );
            if (exactBeforeInsert) {
              setCompetencyExactReuseModal({
                source: "manual",
                existing: exactBeforeInsert,
                targetSubjectId: subjectId,
                competencyTypeForTarget: resolvedCompetencyType,
                pendingName: cn,
                pendingDescription: comp.description.trim(),
              });
              setPracticeGenAccepting(false);
              return;
            }

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
              if (cErr?.code === "23505") {
                alert(
                  "A competency with this name already exists in this organisation."
                );
              } else {
                alert(cErr?.message || "Failed to create a competency.");
              }
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
        existingPracticeNames: practices
          .map((p) => p.name.trim())
          .filter(Boolean),
      });
      const existingSubjectsSnapshot = subjects;
      const rowsOut: PracticeGenPreviewRow[] = [];
      for (const p of result.practices) {
        const name = p.name.trim();
        const desc = (p.description ?? "").trim();
        const existingPracticeIdForScope =
          practices.find(
            (pr) => pr.name.trim().toLowerCase() === name.toLowerCase()
          )?.id ?? null;
        let subjectItems: PracticeGenSubjectPreviewItem[] | undefined;
        try {
          const subRes = await generateSubjectsWithAi({
            companyProfile,
            practiceName: name,
            practiceDescription: desc.length > 0 ? desc : null,
            existingSubjectNames: existingSubjectsSnapshot
              .map((s) => s.name.trim())
              .filter(Boolean),
            settledSubjectNames: taxonomyGovernanceAnchors.settledSubjectNames,
            protectedSubjectNames:
              taxonomyGovernanceAnchors.protectedSubjectNames,
          });
          subjectItems = buildSubjectPreviewItemsForPractice(
            subRes.subjects,
            existingSubjectsSnapshot,
            existingPracticeIdForScope,
            practices,
            subjectPracticeLinks,
            null
          );
        } catch (subErr) {
          console.error(subErr);
          subjectItems = undefined;
        }
        rowsOut.push({
          id: crypto.randomUUID(),
          name: p.name,
          description: p.description,
          selected: true,
          subjectItems,
        });
      }
      setPracticeGenRows(rowsOut);
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
    if (colliding.length > 0) {
      const ok = window.confirm(
        `Some names match existing practices (${colliding
          .map((c) => c.name.trim())
          .join(
            ", "
          )}). Those practices will be reused (relevant context) — no duplicate practice rows. Continue?`
      );
      if (!ok) return;
    }
    setPracticeGenAccepting(true);
    try {
      const practiceIdByName = new Map<string, string>();
      for (const p of practices) {
        practiceIdByName.set(p.name.trim().toLowerCase(), p.id);
      }
      let workingSubjects = await reloadSubjectsForOrg(activeOrgId);
      let workingLinks = await fetchSubjectPracticeLinksForOrg(activeOrgId);

      for (const row of rows) {
        const pk = row.name.trim().toLowerCase();
        let practiceId = practiceIdByName.get(pk);
        if (!practiceId) {
          const { data: inserted, error: pErr } = await supabase
            .from("competency_practices")
            .insert({
              organisation_id: activeOrgId,
              name: row.name.trim(),
              description: row.description.trim() || null,
              is_active: true,
              status: "active",
            })
            .select("id")
            .single();
          if (pErr || !inserted) {
            console.error(pErr);
            alert(pErr?.message || "Failed to create a practice.");
            return;
          }
          practiceId = inserted.id as string;
          practiceIdByName.set(pk, practiceId);
        }

        const items = row.subjectItems ?? [];
        for (const si of items) {
          if (!si.selected || !si.name.trim()) continue;
          const nameKey = normalizeCompetencyNameKey(si.name);

          if (si.mode === "use_existing") {
            if (!si.existingSubjectId) continue;
            const sr = workingSubjects.find((s) => s.id === si.existingSubjectId);
            if (!sr) {
              alert(
                `Could not find existing subject for "${si.name.trim()}". Skipping.`
              );
              continue;
            }
            continue;
          }

          if (si.mode === "use_and_link") {
            if (!si.existingSubjectId || !practiceId) continue;
            const sr = workingSubjects.find((s) => s.id === si.existingSubjectId);
            if (!sr) {
              alert(
                `Could not find subject to link for "${si.name.trim()}". Skipping.`
              );
              continue;
            }
            if (linkExistsInMemory(workingLinks, sr.id, practiceId)) continue;
            const { error: aErr } = await addSubjectPracticeLink(
              activeOrgId,
              sr.id,
              practiceId
            );
            if (aErr) {
              console.error(aErr);
              alert(
                aErr.message || "Failed to add practice relevance for subject."
              );
              return;
            }
            workingLinks = [
              ...workingLinks,
              {
                id: crypto.randomUUID(),
                organisation_id: activeOrgId,
                subject_id: sr.id,
                practice_id: practiceId,
                created_at: new Date().toISOString(),
              },
            ];
            continue;
          }

          const dup = findScopedPracticeSubjectByName(
            workingSubjects,
            nameKey,
            practiceId,
            workingLinks
          );
          if (dup && practiceId) {
            if (linkExistsInMemory(workingLinks, dup.id, practiceId)) continue;
            const { error: aErr } = await addSubjectPracticeLink(
              activeOrgId,
              dup.id,
              practiceId
            );
            if (aErr) {
              console.error(aErr);
              alert(
                aErr.message || "Failed to add practice relevance for subject."
              );
              return;
            }
            workingLinks = [
              ...workingLinks,
              {
                id: crypto.randomUUID(),
                organisation_id: activeOrgId,
                subject_id: dup.id,
                practice_id: practiceId,
                created_at: new Date().toISOString(),
              },
            ];
            continue;
          }

          if (!practiceId) continue;
          const { data: newSub, error: sErr } = await supabase
            .from("competency_subjects")
            .insert({
              organisation_id: activeOrgId,
              name: si.name.trim(),
              description: si.description.trim() || null,
              category: null,
              type: "practice",
              practice_id: null,
              is_active: true,
              status: "active",
            })
            .select("id, name, description, category, type, practice_id")
            .single();
          if (sErr || !newSub) {
            console.error(sErr);
            alert(sErr?.message || "Failed to create a subject.");
            return;
          }
          const newRow = newSub as CompetencySubjectRow;
          const { error: linkErr } = await addSubjectPracticeLink(
            activeOrgId,
            newRow.id,
            practiceId
          );
          if (linkErr) {
            console.error(linkErr);
            alert(
              linkErr.message ||
                "Subject created but practice link failed."
            );
            return;
          }
          workingLinks = [
            ...workingLinks,
            {
              id: crypto.randomUUID(),
              organisation_id: activeOrgId,
              subject_id: newRow.id,
              practice_id: practiceId,
              created_at: new Date().toISOString(),
            },
          ];
          workingSubjects = [...workingSubjects, newRow];
        }
      }

      await reloadPracticesForOrg(activeOrgId);
      await reloadSubjectsForOrg(activeOrgId);
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
    setSubjectGenPracticePickId("");
    setSubjectGenCatalogueContext(false);
    setSubjectGenContext(practice);
    setSubjectGenModalOpen(true);
    void loadCompanyProfileForPracticeGen(activeOrgId);
  }

  function openSubjectGenModalForCapabilityArea(practice: ManagementPracticeGroup) {
    if (!activeOrgId || !canAuthorHierarchy) return;
    setSubjectGenError(null);
    setSubjectGenRows([]);
    setSubjectGenSubjectType("practice");
    setSubjectGenPracticePickId("");
    setSubjectGenCatalogueContext(true);
    setSubjectGenContext(practice);
    setSubjectGenModalOpen(true);
    void loadCompanyProfileForPracticeGen(activeOrgId);
  }

  function openCreateSubjectForOrganisationRoot(
    practice: ManagementPracticeGroup
  ) {
    if (!canAuthorHierarchy) return;
    setSubjectCreateFromOrganisationTree(true);
    setSubjectCreatePracticeKey(practice.key);
    setNewSubjectPracticeIds([]);
    setNewSubjectCapabilityAreaId("");
    setNewSubjectName("");
    setNewSubjectDescription("");
    setNewSubjectCategory("");
    setNewSubjectType("organisation");
  }

  function openSubjectGenModalForOrganisationRoot(
    practice: ManagementPracticeGroup
  ) {
    if (!activeOrgId || !canAuthorHierarchy) return;
    setSubjectGenError(null);
    setSubjectGenRows([]);
    setSubjectGenSubjectType("organisation");
    setSubjectGenPracticePickId("");
    setSubjectGenCatalogueContext(false);
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
    setSubjectGenPracticePickId("");
    setSubjectGenCatalogueContext(false);
  }

  async function handleGenerateSubjectsPreview() {
    if (!activeOrgId || !subjectGenContext) return;
    setSubjectGenError(null);
    setSubjectGenLoading(true);
    try {
      const allCatalogueNames = [
        ...new Set(subjects.map((s) => s.name.trim()).filter(Boolean)),
      ];
      let practiceNameForAi: string;
      let practiceDescriptionForAi: string | null;

      if (subjectGenSubjectType === "organisation") {
        practiceNameForAi = "";
        practiceDescriptionForAi = null;
      } else if (subjectGenCatalogueContext) {
        if (subjectGenPracticePickId.trim()) {
          const pr = practices.find((p) => p.id === subjectGenPracticePickId);
          if (!pr) {
            alert("Selected practice not found.");
            setSubjectGenLoading(false);
            return;
          }
          practiceNameForAi = pr.name.trim();
          practiceDescriptionForAi = pr.description?.trim() ?? null;
        } else {
          practiceNameForAi = subjectGenContext.title.trim();
          practiceDescriptionForAi = subjectGenContext.description;
        }
      } else if (subjectGenContext.key === PRACTICE_SUBJECTS_ROOT_KEY) {
        if (!subjectGenPracticePickId.trim()) {
          alert(
            "Choose a practice for context — it drives AI and where new subjects are linked as relevant."
          );
          setSubjectGenLoading(false);
          return;
        }
        const pr = practices.find((p) => p.id === subjectGenPracticePickId);
        if (!pr) {
          alert("Selected practice not found.");
          setSubjectGenLoading(false);
          return;
        }
        practiceNameForAi = pr.name.trim();
        practiceDescriptionForAi = pr.description?.trim() ?? null;
      } else {
        practiceNameForAi = subjectGenContext.title.trim();
        practiceDescriptionForAi = subjectGenContext.description;
      }

      const result =
        subjectGenSubjectType === "organisation"
          ? await generateSubjectsWithAi({
              companyProfile,
              organisationContext: true,
              existingSubjectNames: allCatalogueNames,
              settledSubjectNames: taxonomyGovernanceAnchors.settledSubjectNames,
              protectedSubjectNames:
                taxonomyGovernanceAnchors.protectedSubjectNames,
            })
          : await generateSubjectsWithAi({
              companyProfile,
              practiceName: practiceNameForAi,
              practiceDescription: practiceDescriptionForAi,
              existingSubjectNames: allCatalogueNames,
              settledSubjectNames: taxonomyGovernanceAnchors.settledSubjectNames,
              protectedSubjectNames:
                taxonomyGovernanceAnchors.protectedSubjectNames,
            });

      const practiceIdForContext = resolveSubjectGenPracticeId(
        subjectGenContext,
        subjectGenSubjectType,
        subjectGenPracticePickId,
        subjectGenCatalogueContext
      );

      const resolvedCapabilityAreaId = resolveSubjectGenCapabilityAreaId(
        subjectGenContext,
        capabilityAreas
      );

      if (normalizeCompetencyType(subjectGenSubjectType) === "organisation") {
        setSubjectGenRows(
          buildOrganisationSubjectGenPreviewRows(
            result.subjects,
            subjects,
            resolvedCapabilityAreaId
          )
        );
      } else {
        setSubjectGenRows(
          buildPracticeSubjectGenPreviewRowsFromDrafts(
            result.subjects,
            subjects,
            practiceIdForContext,
            practices,
            subjectPracticeLinks,
            resolvedCapabilityAreaId
          )
        );
      }
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
    const practiceId = resolveSubjectGenPracticeId(
      subjectGenContext,
      subjectGenSubjectType,
      subjectGenPracticePickId,
      subjectGenCatalogueContext
    );
    if (
      normalizeCompetencyType(subjectGenSubjectType) !== "organisation" &&
      subjectGenContext.key === PRACTICE_SUBJECTS_ROOT_KEY &&
      !subjectGenCatalogueContext &&
      !practiceId
    ) {
      alert("Choose a practice for context before applying.");
      return;
    }

    const resolvedCapabilityAreaId = resolveSubjectGenCapabilityAreaId(
      subjectGenContext,
      capabilityAreas
    );

    const fromAssignedCapabilityAreaFlow =
      subjectGenCatalogueContext &&
      subjectGenContext.key !== UNASSIGNED_CAPABILITY_AREA_KEY;

    const willCreateNewSubject = rows.some((r) => r.mode === "create_new");
    if (
      fromAssignedCapabilityAreaFlow &&
      willCreateNewSubject &&
      !resolvedCapabilityAreaId
    ) {
      alert(
        "Could not resolve the capability area for new subjects. Close this dialog, open Generate Subjects again from the intended capability area, or refresh the page."
      );
      return;
    }

    const insertType = subjectGenSubjectType;

    setSubjectGenAccepting(true);
    try {
      let workingSubjects = await reloadSubjectsForOrg(activeOrgId);
      let workingLinks = await fetchSubjectPracticeLinksForOrg(activeOrgId);

      for (const row of rows) {
        const nameKey = normalizeCompetencyNameKey(row.name);

        if (normalizeCompetencyType(insertType) === "organisation") {
          if (row.mode === "use_existing" || row.mode === "use_and_link") {
            continue;
          }
          const { error } = await supabase.from("competency_subjects").insert({
            organisation_id: activeOrgId,
            name: row.name.trim(),
            description: row.description.trim() || null,
            category: row.category.trim() || null,
            type: "organisation",
            practice_id: null,
            capability_area_id: resolvedCapabilityAreaId,
            is_active: true,
            status: "active",
          });
          if (error) {
            console.error(error);
            alert(error.message || "Failed to create a subject.");
            return;
          }
          continue;
        }

        if (row.mode === "use_existing") {
          continue;
        }
        if (row.mode === "use_and_link" && row.existingSubjectId) {
          if (!practiceId) continue;
          const sr = workingSubjects.find((s) => s.id === row.existingSubjectId);
          if (!sr) {
            alert(
              `Could not find subject to link for "${row.name.trim()}". Skipping.`
            );
            continue;
          }
          if (linkExistsInMemory(workingLinks, sr.id, practiceId)) continue;
          const { error: aErr } = await addSubjectPracticeLink(
            activeOrgId,
            sr.id,
            practiceId
          );
          if (aErr) {
            console.error(aErr);
            alert(
              aErr.message ||
                "Failed to add practice relevance for subject."
            );
            return;
          }
          workingLinks = [
            ...workingLinks,
            {
              id: crypto.randomUUID(),
              organisation_id: activeOrgId,
              subject_id: sr.id,
              practice_id: practiceId,
              created_at: new Date().toISOString(),
            },
          ];
          continue;
        }

        const dup = findScopedPracticeSubjectByName(
          workingSubjects,
          nameKey,
          practiceId,
          workingLinks
        );
        if (dup && practiceId) {
          if (linkExistsInMemory(workingLinks, dup.id, practiceId)) continue;
          const { error: aErr } = await addSubjectPracticeLink(
            activeOrgId,
            dup.id,
            practiceId
          );
          if (aErr) {
            console.error(aErr);
            alert(
              aErr.message ||
                "Failed to add practice relevance for subject."
            );
            return;
          }
          workingLinks = [
            ...workingLinks,
            {
              id: crypto.randomUUID(),
              organisation_id: activeOrgId,
              subject_id: dup.id,
              practice_id: practiceId,
              created_at: new Date().toISOString(),
            },
          ];
          continue;
        }

        const { data: insertedRow, error } = await supabase
          .from("competency_subjects")
          .insert({
            organisation_id: activeOrgId,
            name: row.name.trim(),
            description: row.description.trim() || null,
            category: row.category.trim() || null,
            type: insertType,
            practice_id: null,
            capability_area_id: resolvedCapabilityAreaId,
            is_active: true,
            status: "active",
          })
          .select("id")
          .maybeSingle();
        if (error) {
          console.error(error);
          alert(error.message || "Failed to create a subject.");
          return;
        }
        const newSid = insertedRow?.id;
        if (newSid && practiceId) {
          const { error: linkErr } = await addSubjectPracticeLink(
            activeOrgId,
            newSid,
            practiceId
          );
          if (linkErr) {
            console.error(linkErr);
            alert(
              linkErr.message ||
                "Subject created but practice link failed."
            );
            return;
          }
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
    const practiceTitle =
      practice.key === PRACTICE_SUBJECTS_ROOT_KEY
        ? section.subjectPracticeIds.length > 0
          ? section.subjectPracticeIds
              .map(
                (pid) =>
                  practices.find((p) => p.id === pid)?.name?.trim() || ""
              )
              .filter(Boolean)
              .join(", ") || "Practice"
          : "Practice"
        : practice.title.trim()
          ? practice.title
          : "Practice";
    setCompetencyGenError(null);
    setCompetencyGenRows([]);
    setCompetencyGenContext({
      subjectId: sid,
      subjectName: section.title?.trim() || "Subject",
      subjectDescription: section.description,
      practiceTitle,
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

  function openBatchFromSubjectsModal(practice: ManagementPracticeGroup) {
    if (!activeOrgId || !canAuthorHierarchy) return;
    const secs = catalogueSubjectSectionsForBatchGen(practice);
    if (secs.length === 0) {
      alert(
        "Add at least one subject to this capability area before generating competencies.",
      );
      return;
    }
    setBatchFromSubjectsContext(practice);
    setBatchFromSubjectsDepth("moderate");
    setBatchFromSubjectsError(null);
    setBatchFromSubjectsReview(null);
    setBatchFromSubjectsOpen(true);
    void loadCompanyProfileForPracticeGen(activeOrgId);
  }

  function closeBatchFromSubjectsModal() {
    setBatchFromSubjectsOpen(false);
    setBatchFromSubjectsContext(null);
    setBatchFromSubjectsLoading(false);
    setBatchFromSubjectsError(null);
    setBatchFromSubjectsApplying(false);
    setBatchFromSubjectsReview(null);
  }

  async function handleGenerateBatchFromSubjectsPreview() {
    if (!activeOrgId || !batchFromSubjectsContext) return;
    const secs = catalogueSubjectSectionsForBatchGen(batchFromSubjectsContext);
    const subjectNames = secs.map((s) => s.title.trim()).filter(Boolean);
    if (subjectNames.length === 0) {
      setBatchFromSubjectsError("No subject names in this area.");
      return;
    }
    setBatchFromSubjectsLoading(true);
    setBatchFromSubjectsError(null);
    try {
      const result = await generateCompetenciesFromSubjects({
        companyProfile,
        subjects: subjectNames,
        depth: batchFromSubjectsDepth,
      });
      const byName = new Map(
        result.subjects.map(
          (r) => [normalizeCompetencyNameKey(r.name), r] as const,
        ),
      );
      const review: BatchFromSubjectsReviewGroup[] = [];
      for (const s of secs) {
        const nm = s.title.trim();
        const k = normalizeCompetencyNameKey(nm);
        const row = byName.get(k);
        if (!row) {
          review.push({
            subjectId: s.key,
            subjectName: nm,
            warning: "No competencies could be generated for this subject",
            groupSelected: false,
            lines: [],
          });
          continue;
        }
        const warning =
          row.warning?.trim() ||
          (row.competencies.length === 0
            ? "No competencies could be generated for this subject"
            : undefined);
        review.push({
          subjectId: s.key,
          subjectName: nm,
          ...(warning ? { warning } : {}),
          groupSelected: row.competencies.length > 0,
          lines: row.competencies.map((label) => ({
            key: crypto.randomUUID(),
            label,
            selected: true,
          })),
        });
      }
      setBatchFromSubjectsReview(review);
    } catch (e) {
      setBatchFromSubjectsError(
        e instanceof Error ? e.message : "Generation failed.",
      );
    } finally {
      setBatchFromSubjectsLoading(false);
    }
  }

  function closeSubjectNormalisationModal() {
    if (subjectNormResult?.notes.merges && subjectNormResult.notes.merges.length > 0) {
      setPendingSubjectMergeContext({
        merges: subjectNormResult.notes.merges,
        proposedCapabilityAreas: subjectNormResult.capabilityAreas,
      });
    }
    setSubjectNormModalOpen(false);
    setSubjectNormPhase("setup");
    setSubjectNormLoading(false);
    setSubjectNormApplying(false);
    setSubjectNormError(null);
    setSubjectNormResult(null);
    setSubjectNormRunStats(null);
    setSubjectNormCompleteSummary(null);
  }

  function openSubjectNormalisationModal() {
    if (!activeOrgId || !canAuthorHierarchy) return;
    const payload = buildSubjectNormalisationRequestFromCatalogue(
      managementCapabilityAreaGroups,
      subjects,
      companyProfile,
    );
    if (payload.capabilityAreas.length === 0) {
      alert(
        "No subjects in assigned capability areas to review. Assign subjects to a capability area first.",
      );
      return;
    }
    const subjectCount = payload.capabilityAreas.reduce(
      (n, a) => n + a.subjects.length,
      0,
    );
    setSubjectNormRunStats({
      areaCount: payload.capabilityAreas.length,
      subjectCount,
    });
    setSubjectNormPhase("setup");
    setSubjectNormError(null);
    setSubjectNormResult(null);
    setSubjectNormCompleteSummary(null);
    setSubjectNormShowReviewedStructure(false);
    setSubjectNormModalOpen(true);
    void loadCompanyProfileForPracticeGen(activeOrgId);
  }

  async function handleRunSubjectNormalisationReview() {
    if (!activeOrgId) return;
    setSubjectNormLoading(true);
    setSubjectNormError(null);
    try {
      const payload = buildSubjectNormalisationRequestFromCatalogue(
        managementCapabilityAreaGroups,
        subjects,
        companyProfile,
      );
      if (payload.capabilityAreas.length === 0) {
        setSubjectNormError("No subjects to send for review.");
        return;
      }
      const result = await normaliseSubjectTaxonomy(payload);
      setSubjectNormResult(result);
      setSubjectNormPhase("review");
      const mergeNc = result.notes.merges?.length ?? 0;
      const renameNc = result.notes.renames?.length ?? 0;
      const moveNc = result.notes.moves?.length ?? 0;
      const hasNoteAction = mergeNc + renameNc + moveNc > 0;
      const mergeSkipForUi = analyseSubjectMergeSkipIds(
        result,
        subjects,
        capabilityAreas,
        competencyCountBySubject,
      );
      const hasCatalogRowEdits = normalisationHasSuggestedEdits(
        result,
        subjects,
        capabilityAreas,
        mergeSkipForUi.skipSubjectIds,
      );
      setSubjectNormShowReviewedStructure(hasNoteAction || hasCatalogRowEdits);
      if ((result.notes.merges?.length ?? 0) > 0) {
        setPendingSubjectMergeContext({
          merges: result.notes.merges,
          proposedCapabilityAreas: result.capabilityAreas,
        });
      } else {
        setPendingSubjectMergeContext(null);
      }
    } catch (e) {
      setSubjectNormError(
        e instanceof Error ? e.message : "Review request failed.",
      );
    } finally {
      setSubjectNormLoading(false);
    }
  }

  async function handleApplySubjectNormalisation() {
    if (!activeOrgId || !subjectNormResult) return;
    const { skipSubjectIds, mergeVictimsWithCompetencies } =
      analyseSubjectMergeSkipIds(
        subjectNormResult,
        subjects,
        capabilityAreas,
        competencyCountBySubject,
      );
    setSubjectNormApplying(true);
    let updated = 0;
    try {
      for (const area of subjectNormResult.capabilityAreas) {
        const targetAreaId = resolveProposedCapabilityAreaIdNorm(
          area,
          capabilityAreas,
        );
        for (const sub of area.subjects) {
          const sid = sub.subjectId?.trim();
          if (!sid) continue;
          if (skipSubjectIds.has(sid)) continue;
          const cur = subjects.find((s) => s.id === sid);
          if (!cur) continue;
          const nextName = sub.name.trim();
          if (!nextName) continue;
          const nextDesc = sub.description?.trim() || null;
          const nextCat = sub.category?.trim() || null;
          const sameName =
            normalizeCompetencyNameKey(cur.name) ===
            normalizeCompetencyNameKey(nextName);
          const sameDesc =
            (cur.description ?? "").trim() === (nextDesc ?? "").trim();
          const sameCat =
            (cur.category ?? "").trim() === (nextCat ?? "").trim();
          const sameCap =
            (cur.capability_area_id ?? null) === (targetAreaId ?? null);
          if (sameName && sameDesc && sameCat && sameCap) continue;

          const { error } = await supabase
            .from("competency_subjects")
            .update({
              name: nextName,
              description: nextDesc,
              category: nextCat,
              capability_area_id: targetAreaId,
            })
            .eq("id", sid)
            .eq("organisation_id", activeOrgId);
          if (error) {
            console.error(error);
            alert(error.message || "Failed to update a subject.");
            return;
          }
          updated++;
        }
      }
      await reloadSubjectsForOrg(activeOrgId);
      const mergeN = subjectNormResult.notes.merges?.length ?? 0;
      if (mergeN > 0) {
        setPendingSubjectMergeContext({
          merges: subjectNormResult.notes.merges,
          proposedCapabilityAreas: subjectNormResult.capabilityAreas,
        });
        setSubjectNormCompleteSummary({
          updated,
          mergeVictimsWithCompetencies: mergeVictimsWithCompetencies.length,
        });
        setSubjectNormPhase("complete");
      } else {
        closeSubjectNormalisationModal();
      }
    } finally {
      setSubjectNormApplying(false);
    }
  }

  async function handleApplyBatchFromSubjects() {
    if (!activeOrgId || !batchFromSubjectsReview) return;
    const hasSelection = batchFromSubjectsReview.some(
      (g) =>
        g.groupSelected && g.lines.some((l) => l.selected && l.label.trim()),
    );
    if (!hasSelection) {
      alert("Select at least one competency to apply.");
      return;
    }
    setBatchFromSubjectsApplying(true);
    let created = 0;
    let skippedUnderSubject = 0;
    let skippedElsewhere = 0;
    let latestCompetencies = competencies;
    try {
      for (const g of batchFromSubjectsReview) {
        if (!g.groupSelected) continue;
        const resolvedGenType = resolveCompetencyTypeForSubject(
          g.subjectId,
          toCompetencyTypeUnion(
            normalizeSubjectTypeForAlignment(
              subjects.find((sub) => sub.id === g.subjectId),
            ) || "practice",
          ),
          subjects,
        );
        for (const line of g.lines) {
          if (!line.selected) continue;
          const name = line.label.trim();
          if (!name) continue;
          const compsOnSubject = latestCompetencies.filter(
            (c) => c.subject_id === g.subjectId,
          );
          if (findExactCompetencyByName(name, compsOnSubject)) {
            skippedUnderSubject++;
            continue;
          }
          const exactCandidates = await loadExactDuplicateCandidatesForOrg(
            activeOrgId,
          );
          if (findExactCompetencyByName(name, exactCandidates)) {
            skippedElsewhere++;
            continue;
          }
          const { data: insertedRow, error } = await supabase
            .from("competencies")
            .insert({
              organisation_id: activeOrgId,
              name,
              description: null,
              competency_type: resolvedGenType,
              is_active: true,
              subject_id: g.subjectId,
              status: "active",
            })
            .select("id")
            .single();
          if (error || !insertedRow) {
            console.error(error);
            if (error?.code === "23505") {
              skippedElsewhere++;
            } else {
              alert(error?.message || "Failed to create a competency.");
            }
            return;
          }
          const { error: levErr } = await insertDefaultCompetencyLevels(
            supabase,
            insertedRow.id,
          );
          if (levErr) {
            console.error(levErr);
            alert(
              levErr.message ||
                "A competency was created but default proficiency levels could not be added.",
            );
            return;
          }
          created++;
          latestCompetencies = await reloadCompetenciesForOrg(activeOrgId);
        }
      }
      await reloadCompetenciesForOrg(activeOrgId);
      const parts: string[] = [`Created ${created} competencies.`];
      if (skippedUnderSubject > 0) {
        parts.push(
          `${skippedUnderSubject} skipped (already under this subject).`,
        );
      }
      if (skippedElsewhere > 0) {
        parts.push(
          `${skippedElsewhere} skipped (already in catalogue under another subject).`,
        );
      }
      alert(parts.join(" "));
      closeBatchFromSubjectsModal();
    } finally {
      setBatchFromSubjectsApplying(false);
    }
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

    const keyToExisting = new Map<string, CompetencyRow>();
    for (const c of competencies) {
      const k = normalizeCompetencyNameKey(c.name);
      if (!k) continue;
      if (!keyToExisting.has(k)) keyToExisting.set(k, c);
    }

    const exactItems: Array<{
      name: string;
      description: string;
      existing: CompetencyRow;
    }> = [];
    const insertable: typeof rows = [];
    for (const r of rowsDeduped) {
      const k = normalizeCompetencyNameKey(r.name);
      const existing = k ? keyToExisting.get(k) : undefined;
      if (existing) {
        exactItems.push({
          name: r.name.trim(),
          description: r.description.trim(),
          existing,
        });
      } else {
        insertable.push(r);
      }
    }

    if (exactItems.length === 0 && insertable.length === 0) {
      alert("Nothing to create.");
      return;
    }

    const subjectForAlign = subjects.find((s) => s.id === sid);
    const alignedFromSubject = normalizeSubjectTypeForAlignment(
      subjectForAlign
    );
    const resolvedGenType = toCompetencyTypeUnion(
      alignedFromSubject || "practice"
    );

    if (exactItems.length > 0) {
      const first = exactItems[0]!;
      setCompetencyExactReuseModal({
        source: "ai",
        current: {
          name: first.name,
          description: first.description,
          existing: first.existing,
        },
        rest: exactItems.slice(1).map((x) => ({
          name: x.name,
          description: x.description,
          existing: x.existing,
        })),
        insertable: insertable.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
        })),
        targetSubjectId: sid,
        resolvedGenType,
      });
      return;
    }

    await finalizeAiInsertable(
      insertable.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
      })),
      sid,
      resolvedGenType
    );
  }

  async function advanceAiExactReuseQueue(
    m: Extract<
      NonNullable<typeof competencyExactReuseModal>,
      { source: "ai" }
    >,
    afterSkipOrMove: "skip" | "move",
    movedOk: boolean
  ) {
    if (afterSkipOrMove === "move" && !movedOk) return;

    if (m.rest.length > 0) {
      const next = m.rest[0]!;
      setCompetencyExactReuseModal({
        source: "ai",
        current: {
          name: next.name,
          description: next.description,
          existing: next.existing,
        },
        rest: m.rest.slice(1),
        insertable: m.insertable,
        targetSubjectId: m.targetSubjectId,
        resolvedGenType: m.resolvedGenType,
      });
      return;
    }

    const { insertable, targetSubjectId, resolvedGenType } = m;
    setCompetencyExactReuseModal(null);
    await finalizeAiInsertable(insertable, targetSubjectId, resolvedGenType, {
      skipSimilarConfirm: true,
    });
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

  /**
   * Move competencies to the orphan bucket (subject_id null). Safety-critical: never delete rows.
   * Batch update keeps Starter Pack testing responsive for large selections.
   */
  async function detachCompetencyIdsToUnassignedBucket(
    competencyIds: string[],
  ): Promise<boolean> {
    if (activeOrgId === null || competencyIds.length === 0) return true;
    const { error } = await supabase
      .from("competencies")
      .update({ subject_id: null })
      .in("id", competencyIds)
      .eq("organisation_id", activeOrgId);
    if (error) {
      console.error(error);
      alert(error.message || "Could not move competencies to unassigned.");
      return false;
    }
    await reloadCompetenciesForOrg(activeOrgId);
    return true;
  }

  function beginSubjectArchiveFlow(
    subjRow: CompetencySubjectRow,
    sectionTitle: string,
  ) {
    if (activeOrgId === null || !canArchiveEntity) return;
    const linked = activeCompetencyIdsForSubject(competencies, subjRow.id);
    if (linked.length === 0) {
      if (
        !window.confirm(
          "Archive this subject? It will be hidden from normal lists until you turn on “Show archived” and restore it.",
        )
      ) {
        return;
      }
      void runArchiveEntity("subject", subjRow.id);
      return;
    }
    setSubjectArchiveChoice("unassigned");
    setSubjectArchiveMoveToId("");
    setSubjectArchiveDialog({
      subjectId: subjRow.id,
      label: sectionTitle,
      linkedCompetencyIds: linked,
    });
  }

  async function confirmSubjectArchiveDialog() {
    if (activeOrgId === null || !subjectArchiveDialog || !canArchiveEntity) return;
    const { subjectId, linkedCompetencyIds, label } = subjectArchiveDialog;
    setBulkActionBusy(true);
    try {
      if (subjectArchiveChoice === "unassigned") {
        const ok = await detachCompetencyIdsToUnassignedBucket(
          linkedCompetencyIds,
        );
        if (!ok) return;
      } else if (subjectArchiveChoice === "move_subject") {
        const tid = subjectArchiveMoveToId.trim();
        if (!tid) {
          alert("Choose a subject to move competencies into.");
          return;
        }
        if (tid === subjectId) {
          alert("Choose a different subject.");
          return;
        }
        for (const cid of linkedCompetencyIds) {
          const row = competencies.find((x) => x.id === cid);
          if (!row) continue;
          const moved = await moveCompetencyToSubject(
            cid,
            tid,
            toCompetencyTypeUnion(
              normalizeCompetencyType(row.competency_type),
            ),
          );
          if (!moved) return;
        }
      } else {
        for (const cid of linkedCompetencyIds) {
          await runArchiveEntity("competency", cid);
        }
      }
      await runArchiveEntity("subject", subjectId);
      setSubjectArchiveDialog(null);
      setCatalogueBulkFeedback(`Archived subject “${label.trim()}”.`);
    } finally {
      setBulkActionBusy(false);
    }
  }

  async function executeBulkAssignOrphanCompetencies() {
    if (activeOrgId === null || !canAuthorHierarchy) return;
    const tid = bulkAssignCompetenciesTargetId.trim();
    if (!tid) {
      alert("Choose a subject.");
      return;
    }
    const ids = [...catalogueBulkOrphanCompetencyIds];
    if (ids.length === 0) return;
    setBulkActionBusy(true);
    try {
      let n = 0;
      const target = subjects.find((s) => s.id === tid);
      const targetName = target?.name?.trim() || "subject";
      for (const cid of ids) {
        const row = competencies.find((c) => c.id === cid);
        if (!row || !isAssignableLifecycleStatus(row.status)) continue;
        const ok = await moveCompetencyToSubject(
          cid,
          tid,
          toCompetencyTypeUnion(
            normalizeCompetencyType(row.competency_type),
          ),
        );
        if (ok) n++;
      }
      setCatalogueBulkOrphanCompetencyIds(new Set());
      setBulkAssignCompetencyModalOpen(false);
      setBulkAssignCompetenciesTargetId("");
      setCatalogueBulkFeedback(`${n} competencies assigned to ${targetName}.`);
    } finally {
      setBulkActionBusy(false);
    }
  }

  async function executeBulkArchiveOrphanCompetencies() {
    if (activeOrgId === null || !canArchiveEntity) return;
    const ids = [...catalogueBulkOrphanCompetencyIds].filter((id) => {
      const c = competencies.find((x) => x.id === id);
      return c && parseLifecycleStatus(c.status) !== "archived";
    });
    if (ids.length === 0) return;
    if (!window.confirm(`Archive ${ids.length} selected competencies?`)) return;
    setBulkActionBusy(true);
    try {
      for (const id of ids) {
        await runArchiveEntity("competency", id);
      }
      setCatalogueBulkOrphanCompetencyIds(new Set());
      setCatalogueBulkFeedback(`${ids.length} competencies archived.`);
    } finally {
      setBulkActionBusy(false);
    }
  }

  async function executeBulkArchiveUnassignedSubjects() {
    if (activeOrgId === null || !canArchiveEntity) return;
    const ids = [...catalogueBulkUnassignedSubjectIds];
    if (ids.length === 0) return;
    if (
      !window.confirm(
        `Archive ${ids.length} selected subjects? Active competencies still linked to them will be moved to “Competencies not linked to a subject” first (nothing is deleted).`,
      )
    ) {
      return;
    }
    setBulkActionBusy(true);
    try {
      const allLinked = ids.flatMap((sid) =>
        activeCompetencyIdsForSubject(competencies, sid),
      );
      if (allLinked.length > 0) {
        const ok = await detachCompetencyIdsToUnassignedBucket(allLinked);
        if (!ok) return;
      }
      for (const sid of ids) {
        await runArchiveEntity("subject", sid);
      }
      setCatalogueBulkUnassignedSubjectIds(new Set());
      setCatalogueBulkFeedback(`${ids.length} subjects archived.`);
    } finally {
      setBulkActionBusy(false);
    }
  }

  async function executeBulkAssignCapabilityAreaToSubjects() {
    if (activeOrgId === null || !canAuthorHierarchy) return;
    const aid = bulkAssignCapabilityAreaTargetId.trim();
    if (!aid) {
      alert("Choose a capability area.");
      return;
    }
    const ids = [...catalogueBulkUnassignedSubjectIds];
    if (ids.length === 0) return;
    const area = capabilityAreas.find((a) => a.id === aid);
    const areaName = area?.name?.trim() || "capability area";
    setBulkActionBusy(true);
    try {
      const { error } = await supabase
        .from("competency_subjects")
        .update({ capability_area_id: aid })
        .eq("organisation_id", activeOrgId)
        .in("id", ids);
      if (error) {
        console.error(error);
        alert(error.message || "Update failed.");
        return;
      }
      await reloadSubjectsForOrg(activeOrgId);
      await reloadCompetenciesForOrg(activeOrgId);
      setCatalogueBulkUnassignedSubjectIds(new Set());
      setBulkAssignCapabilityAreaModalOpen(false);
      setBulkAssignCapabilityAreaTargetId("");
      setCatalogueBulkFeedback(
        `${ids.length} subjects assigned to ${areaName}.`,
      );
    } finally {
      setBulkActionBusy(false);
    }
  }

  async function handleConfirmArchiveCompetency(c: CompetencyRow) {
    if (activeOrgId === null || !canArchiveEntity) return;
    setLifecycleSaving(true);
    let impact: Awaited<ReturnType<typeof fetchCompetencyArchiveImpact>>;
    try {
      impact = await fetchCompetencyArchiveImpact(activeOrgId, c.id);
    } catch (e) {
      setLifecycleSaving(false);
      const msg = e instanceof Error ? e.message : "unknown error";
      if (
        !window.confirm(
          `Could not load linked usage (${msg}). Archive “${c.name.trim()}” anyway? It will be hidden from normal lists and AI refinement until you turn on “Show archived” and restore it.`
        )
      ) {
        return;
      }
      setLifecycleSaving(true);
      try {
        await runArchiveEntity("competency", c.id);
      } finally {
        setLifecycleSaving(false);
      }
      return;
    }
    setLifecycleSaving(false);

    const lines: string[] = [];
    lines.push(`Archive “${c.name.trim()}”?`);
    lines.push("");
    lines.push(
      "It will be hidden from normal lists and from AI refinement until you turn on “Show archived” and restore it."
    );
    if (c.subject_id) {
      lines.push(
        "The subject link is kept in the database until you edit or move this competency."
      );
    }
    const usageParts: string[] = [];
    if (impact.orgUserCompetencies > 0) {
      usageParts.push(
        `${impact.orgUserCompetencies} team member profile link(s)`
      );
    }
    if (impact.jobProfileLinks > 0) {
      usageParts.push(`${impact.jobProfileLinks} job profile mapping(s)`);
    }
    if (impact.assessments > 0) {
      usageParts.push(`${impact.assessments} assessment record(s)`);
    }
    if (impact.developmentGoals > 0) {
      usageParts.push(`${impact.developmentGoals} development goal(s)`);
    }
    if (impact.planObjectives > 0) {
      usageParts.push(
        `${impact.planObjectives} development plan objective(s)`
      );
    }
    if (usageParts.length > 0) {
      lines.push("");
      lines.push(
        "Linked usage in this organisation (data is kept; review before archiving if needed):"
      );
      for (const p of usageParts) lines.push(`• ${p}`);
    }
    lines.push("");
    lines.push("Continue with archive?");

    if (!window.confirm(lines.join("\n"))) return;
    setLifecycleSaving(true);
    try {
      await runArchiveEntity("competency", c.id);
    } finally {
      setLifecycleSaving(false);
    }
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
              <option value="">No subject</option>
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

  function renderManagementPracticeHierarchyRow(
    practice: ManagementPracticeGroup,
    hierarchyTreeProp: "practice" | "organisation" | "catalogue"
  ) {
                            const practiceRow =
                              practice.isUnassigned ||
                              practice.key === PRACTICE_SUBJECTS_ROOT_KEY ||
                              practice.key === ORGANISATION_ROOT_PRACTICE_KEY
                                ? null
                                : practices.find((p) => p.id === practice.key);
                            const practiceLife = practiceRow
                              ? parseLifecycleStatus(practiceRow.status)
                              : null;
                            const practiceExpanded =
                              hierarchyTreeProp === "organisation"
                                ? isOrgPracticeAccordionExpanded(practice.key)
                                : isPracticeAccordionExpanded(practice.key);
                            const catalogueUnassignedBulkContext =
                              hierarchyTreeProp === "catalogue" &&
                              practice.key === UNASSIGNED_CAPABILITY_AREA_KEY;
                            const unassignedSubjectKeysForBulk =
                              catalogueUnassignedBulkContext
                                ? practice.subjectSections
                                    .filter((s) => !s.isUnassigned)
                                    .map((s) => s.key)
                                : [];
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
                                    hierarchyTreeProp === "organisation"
                                      ? toggleOrgPracticeAccordion(practice.key)
                                      : togglePracticeAccordion(practice.key)
                                  }
                                  aria-expanded={practiceExpanded}
                                  aria-label={
                                    practiceExpanded
                                      ? "Collapse section"
                                      : "Expand section"
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
                                    {practice.title.trim() ? (
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
                                    ) : null}
                                    {hierarchyTreeProp === "catalogue" &&
                                    practice.key !==
                                      UNASSIGNED_CAPABILITY_AREA_KEY &&
                                    capabilityAreas.some(
                                      (a) => a.id === practice.key
                                    ) ? (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const a = capabilityAreas.find(
                                              (x) => x.id === practice.key
                                            );
                                            if (a) openCapabilityAreaEditModal(a);
                                          }}
                                          disabled={
                                            isSavingCapabilityArea ||
                                            isSavingCapabilityAreaEdit
                                          }
                                          style={{
                                            ...btnGhost,
                                            fontSize: 11,
                                            padding: "4px 8px",
                                            flexShrink: 0,
                                          }}
                                        >
                                          Edit area
                                        </button>
                                        <GovernanceTaxonomyBadge
                                          status={parseTaxonomyGovernanceStatus(
                                            capabilityAreas.find(
                                              (x) => x.id === practice.key
                                            )?.governance_status
                                          )}
                                          compact
                                        />
                                        {canAuthorHierarchy ? (
                                          <span
                                            style={{
                                              display: "inline-flex",
                                              flexWrap: "wrap",
                                              gap: 4,
                                              alignItems: "center",
                                            }}
                                          >
                                            {parseTaxonomyGovernanceStatus(
                                              capabilityAreas.find(
                                                (x) => x.id === practice.key
                                              )?.governance_status
                                            ) === "draft" ? (
                                              <>
                                                <button
                                                  type="button"
                                                  disabled={
                                                    governanceUpdateBusy ===
                                                    `area:${practice.key}`
                                                  }
                                                  onClick={() =>
                                                    void setCapabilityAreaGovernanceStatus(
                                                      practice.key,
                                                      "settled"
                                                    )
                                                  }
                                                  style={{
                                                    ...btnGhost,
                                                    fontSize: 10,
                                                    padding: "2px 6px",
                                                  }}
                                                >
                                                  Set settled
                                                </button>
                                                <button
                                                  type="button"
                                                  disabled={
                                                    governanceUpdateBusy ===
                                                    `area:${practice.key}`
                                                  }
                                                  onClick={() =>
                                                    void setCapabilityAreaGovernanceStatus(
                                                      practice.key,
                                                      "protected"
                                                    )
                                                  }
                                                  style={{
                                                    ...btnGhost,
                                                    fontSize: 10,
                                                    padding: "2px 6px",
                                                  }}
                                                >
                                                  Protect
                                                </button>
                                              </>
                                            ) : null}
                                            {parseTaxonomyGovernanceStatus(
                                              capabilityAreas.find(
                                                (x) => x.id === practice.key
                                              )?.governance_status
                                            ) === "settled" ? (
                                              <>
                                                <button
                                                  type="button"
                                                  disabled={
                                                    governanceUpdateBusy ===
                                                    `area:${practice.key}`
                                                  }
                                                  onClick={() =>
                                                    void setCapabilityAreaGovernanceStatus(
                                                      practice.key,
                                                      "protected"
                                                    )
                                                  }
                                                  style={{
                                                    ...btnGhost,
                                                    fontSize: 10,
                                                    padding: "2px 6px",
                                                  }}
                                                >
                                                  Protect
                                                </button>
                                                <button
                                                  type="button"
                                                  disabled={
                                                    governanceUpdateBusy ===
                                                    `area:${practice.key}`
                                                  }
                                                  onClick={() =>
                                                    void setCapabilityAreaGovernanceStatus(
                                                      practice.key,
                                                      "draft"
                                                    )
                                                  }
                                                  style={{
                                                    ...btnGhost,
                                                    fontSize: 10,
                                                    padding: "2px 6px",
                                                  }}
                                                >
                                                  To draft
                                                </button>
                                              </>
                                            ) : null}
                                            {parseTaxonomyGovernanceStatus(
                                              capabilityAreas.find(
                                                (x) => x.id === practice.key
                                              )?.governance_status
                                            ) === "protected" ? (
                                              <>
                                                <button
                                                  type="button"
                                                  disabled={
                                                    governanceUpdateBusy ===
                                                    `area:${practice.key}`
                                                  }
                                                  onClick={() =>
                                                    void setCapabilityAreaGovernanceStatus(
                                                      practice.key,
                                                      "settled"
                                                    )
                                                  }
                                                  style={{
                                                    ...btnGhost,
                                                    fontSize: 10,
                                                    padding: "2px 6px",
                                                  }}
                                                >
                                                  Unprotect
                                                </button>
                                                <button
                                                  type="button"
                                                  disabled={
                                                    governanceUpdateBusy ===
                                                    `area:${practice.key}`
                                                  }
                                                  onClick={() =>
                                                    void setCapabilityAreaGovernanceStatus(
                                                      practice.key,
                                                      "draft"
                                                    )
                                                  }
                                                  style={{
                                                    ...btnGhost,
                                                    fontSize: 10,
                                                    padding: "2px 6px",
                                                  }}
                                                >
                                                  To draft
                                                </button>
                                              </>
                                            ) : null}
                                          </span>
                                        ) : null}
                                      </>
                                    ) : null}
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
                                      hierarchyTreeProp === "catalogue"
                                        ? openCreateSubjectForCapabilityArea(
                                            practice
                                          )
                                        : practice.key ===
                                            ORGANISATION_ROOT_PRACTICE_KEY
                                          ? openCreateSubjectForOrganisationRoot(
                                              practice
                                            )
                                          : openCreateSubjectForPractice(
                                              practice
                                            )
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
                                      hierarchyTreeProp === "catalogue"
                                        ? openSubjectGenModalForCapabilityArea(
                                            practice
                                          )
                                        : practice.key ===
                                            ORGANISATION_ROOT_PRACTICE_KEY
                                          ? openSubjectGenModalForOrganisationRoot(
                                              practice
                                            )
                                          : openSubjectGenModal(practice)
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
                                  {hierarchyTreeProp === "catalogue" &&
                                  catalogueSubjectSectionsForBatchGen(practice)
                                    .length > 0 ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openBatchFromSubjectsModal(practice)
                                      }
                                      disabled={
                                        isSavingPractice ||
                                        isSavingSubject ||
                                        isSavingCompetency ||
                                        isSavingLevel ||
                                        isSavingEditCompetency ||
                                        isSavingEditSubject ||
                                        batchFromSubjectsLoading
                                      }
                                      style={{
                                        ...btnSecondary,
                                        fontSize: 12,
                                        padding: "6px 10px",
                                      }}
                                      title="Suggest competencies for subjects in this capability area (review before saving)"
                                    >
                                      Generate competencies from subjects
                                    </button>
                                  ) : null}
                                  {hierarchyTreeProp === "catalogue" &&
                                  practice.key ===
                                    UNASSIGNED_CAPABILITY_AREA_KEY ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setLeftoverRefinementOpen(true)
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
                                        ...btnGhost,
                                        fontSize: 12,
                                        padding: "6px 10px",
                                      }}
                                      title="Resolve unassigned subjects with targeted AI"
                                    >
                                      Resolve unassigned subjects
                                    </button>
                                  ) : null}
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
                          {catalogueUnassignedBulkContext &&
                          canAuthorHierarchy ? (
                            <>
                              {catalogueBulkFeedback ? (
                                <div
                                  style={{
                                    padding: "8px 10px",
                                    borderRadius: 8,
                                    backgroundColor:
                                      "rgba(110, 176, 240, 0.08)",
                                    border:
                                      "1px solid rgba(110, 176, 240, 0.25)",
                                    fontSize: 13,
                                    color: text,
                                  }}
                                >
                                  {catalogueBulkFeedback}
                                </div>
                              ) : null}
                              {unassignedSubjectKeysForBulk.length > 0 ? (
                                <div
                                  style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    alignItems: "center",
                                    gap: 10,
                                    padding: "4px 0",
                                  }}
                                >
                                  <label
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 6,
                                      fontSize: 12,
                                      color: mutedColor,
                                      cursor: "pointer",
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={
                                        unassignedSubjectKeysForBulk.length >
                                          0 &&
                                        unassignedSubjectKeysForBulk.every(
                                          (k) =>
                                            catalogueBulkUnassignedSubjectIds.has(
                                              k,
                                            ),
                                        )
                                      }
                                      onChange={() => {
                                        const allOn =
                                          unassignedSubjectKeysForBulk.every(
                                            (k) =>
                                              catalogueBulkUnassignedSubjectIds.has(
                                                k,
                                              ),
                                          );
                                        setCatalogueBulkUnassignedSubjectIds(
                                          (prev) => {
                                            const n = new Set(prev);
                                            if (allOn) {
                                              for (const k of unassignedSubjectKeysForBulk)
                                                n.delete(k);
                                            } else {
                                              for (const k of unassignedSubjectKeysForBulk)
                                                n.add(k);
                                            }
                                            return n;
                                          },
                                        );
                                      }}
                                    />
                                    Select all
                                  </label>
                                  {catalogueBulkUnassignedSubjectIds.size >
                                  0 ? (
                                    <span
                                      style={{
                                        fontSize: 12,
                                        color: text,
                                        fontWeight: 600,
                                      }}
                                    >
                                      {
                                        catalogueBulkUnassignedSubjectIds.size
                                      }{" "}
                                      selected
                                    </span>
                                  ) : null}
                                </div>
                              ) : null}
                              {catalogueBulkUnassignedSubjectIds.size > 0 ? (
                                <div
                                  style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: 8,
                                    alignItems: "center",
                                    padding: "8px 10px",
                                    borderRadius: 8,
                                    backgroundColor: bg,
                                    border: `1px solid ${borderSubtle}`,
                                  }}
                                >
                                  <button
                                    type="button"
                                    disabled={
                                      bulkActionBusy ||
                                      !canArchiveEntity ||
                                      isSavingSubject
                                    }
                                    onClick={() =>
                                      void executeBulkArchiveUnassignedSubjects()
                                    }
                                    style={{
                                      ...btnSecondary,
                                      fontSize: 12,
                                      padding: "6px 10px",
                                    }}
                                  >
                                    Archive selected
                                  </button>
                                  <button
                                    type="button"
                                    disabled={
                                      bulkActionBusy || isSavingSubject
                                    }
                                    onClick={() =>
                                      setBulkAssignCapabilityAreaModalOpen(true)
                                    }
                                    style={{
                                      ...btnGhost,
                                      fontSize: 12,
                                      padding: "6px 10px",
                                    }}
                                  >
                                    Assign capability area
                                  </button>
                                  <button
                                    type="button"
                                    disabled={bulkActionBusy}
                                    onClick={() =>
                                      setCatalogueBulkUnassignedSubjectIds(
                                        new Set(),
                                      )
                                    }
                                    style={{
                                      ...btn,
                                      fontSize: 12,
                                      padding: "6px 10px",
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : null}
                            </>
                          ) : null}
                          {subjectCreatePracticeKey === practice.key &&
                          (hierarchyTreeProp === "organisation"
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
                                {hierarchyTreeProp === "catalogue"
                                  ? practice.title.trim() || "Capability area"
                                  : practice.key === PRACTICE_SUBJECTS_ROOT_KEY
                                    ? "practice context"
                                    : practice.isUnassigned
                                      ? "Practice view (no subject row)"
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
                              {subjectNameSuggestsActivity(newSubjectName) ? (
                                <p
                                  style={{
                                    margin: 0,
                                    fontSize: 12,
                                    lineHeight: 1.45,
                                    color: COMPETENCY_SUBJECT_TYPE_WARN_BORDER,
                                  }}
                                >
                                  This may be better represented as a competency
                                  under an existing subject.
                                </p>
                              ) : null}
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
                                  onChange={(e) => {
                                    const v = e.target.value as CompetencyType;
                                    setNewSubjectType(v);
                                    if (
                                      normalizeCompetencyType(v) ===
                                      "organisation"
                                    ) {
                                      setNewSubjectPracticeIds([]);
                                    }
                                  }}
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
                                Capability area (optional)
                                <select
                                  value={newSubjectCapabilityAreaId}
                                  onChange={(e) =>
                                    setNewSubjectCapabilityAreaId(e.target.value)
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
                                  <option value="">Unassigned</option>
                                  {capabilityAreas.map((a) => (
                                    <option key={a.id} value={a.id}>
                                      {a.name.trim() || "Capability area"}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              {(practice.key === PRACTICE_SUBJECTS_ROOT_KEY ||
                                hierarchyTreeProp === "catalogue") &&
                              normalizeCompetencyType(newSubjectType) !==
                                "organisation" ? (
                                <div
                                  style={{
                                    display: "grid",
                                    gap: 8,
                                    fontSize: 13,
                                    color: mutedColor,
                                  }}
                                >
                                  <span>Relevant to practice (optional)</span>
                                  <div
                                    style={{
                                      display: "flex",
                                      flexDirection: "column",
                                      gap: 6,
                                      maxHeight: 200,
                                      overflowY: "auto",
                                      padding: "8px 10px",
                                      border: `1px solid ${border}`,
                                      borderRadius: 8,
                                      backgroundColor: surface,
                                    }}
                                  >
                                    {assignablePractices.length === 0 ? (
                                      <span style={{ fontSize: 12 }}>
                                        No assignable practices.
                                      </span>
                                    ) : (
                                      assignablePractices.map((p) => (
                                        <label
                                          key={p.id}
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 8,
                                            fontSize: 14,
                                            color: text,
                                            cursor: "pointer",
                                          }}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={newSubjectPracticeIds.includes(
                                              p.id
                                            )}
                                            onChange={() => {
                                              setNewSubjectPracticeIds((prev) =>
                                                prev.includes(p.id)
                                                  ? prev.filter((x) => x !== p.id)
                                                  : [...prev, p.id]
                                              );
                                            }}
                                            disabled={isSavingSubject}
                                          />
                                          {p.name}
                                        </label>
                                      ))
                                    )}
                                  </div>
                                  <span
                                    style={{
                                      fontSize: 12,
                                      lineHeight: 1.45,
                                      color: mutedColor,
                                      fontWeight: 400,
                                    }}
                                  >
                                    Select any practices where this subject
                                    applies. Does not define ownership or
                                    structure.
                                  </span>
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
                              (hierarchyTreeProp === "organisation")) ? (
                            <p
                              style={{
                                margin: 0,
                                fontSize: 13,
                                color: mutedColor,
                              }}
                            >
                              No subjects yet. Use{" "}
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
                              ? section.title?.trim() ||
                                "Competencies not linked to a subject"
                              : section.title?.trim() || "Subject";
                            const sectionItems = Array.isArray(section.items)
                              ? section.items
                              : [];
                            const orphanSelectableIds = section.isUnassigned
                              ? sectionItems
                                  .filter((c) =>
                                    isAssignableLifecycleStatus(c.status),
                                  )
                                  .map((c) => c.id)
                              : [];
                            const subjRow = section.isUnassigned
                              ? null
                              : subjects.find((s) => s.id === sectionKey);
                            const practiceRelevanceNames = subjRow
                              ? practiceIdsForSubjectDisplay(
                                  subjectPracticeLinks,
                                  subjRow.id,
                                  subjRow.practice_id
                                )
                                  .map((pid) =>
                                    practices
                                      .find((p) => p.id === pid)
                                      ?.name?.trim()
                                  )
                                  .filter((n): n is string => Boolean(n))
                              : [];
                            const subjLife = subjRow
                              ? parseLifecycleStatus(subjRow.status)
                              : null;
                            const dimOtherSubjects =
                              inlineCompetencySectionKey !== null &&
                              inlineCompetencySectionKey !== sectionInlineKey;
                            const sectionTree: "practice" | "organisation" =
                              hierarchyTreeProp === "catalogue"
                                ? section.subjectType === "organisation"
                                  ? "organisation"
                                  : "practice"
                                : hierarchyTreeProp;
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
                                      {subjectNameSuggestsActivity(editSubjectName) ? (
                                        <p
                                          style={{
                                            margin: 0,
                                            fontSize: 12,
                                            lineHeight: 1.45,
                                            color: COMPETENCY_SUBJECT_TYPE_WARN_BORDER,
                                          }}
                                        >
                                          This may be better represented as a
                                          competency under an existing subject.
                                        </p>
                                      ) : null}
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
                                      <fieldset
                                        style={{
                                          margin: 0,
                                          padding: 0,
                                          border: "none",
                                          display: "grid",
                                          gap: 8,
                                        }}
                                      >
                                        <legend
                                          style={{
                                            fontSize: 13,
                                            color: mutedColor,
                                            marginBottom: 4,
                                          }}
                                        >
                                          Subject scope
                                        </legend>
                                        <label
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 8,
                                            fontSize: 14,
                                            color: text,
                                            cursor: "pointer",
                                          }}
                                        >
                                          <input
                                            type="radio"
                                            name="editSubjectScope"
                                            checked={editSubjectScope === "practice"}
                                            onChange={() => {
                                              setEditSubjectScope("practice");
                                              setEditSubjectType("practice");
                                            }}
                                            disabled={isSavingEditSubject}
                                          />
                                          Practice-type subjects (reusable;
                                          competencies align with Practice /
                                          Stretch types)
                                        </label>
                                        <label
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 8,
                                            fontSize: 14,
                                            color: text,
                                            cursor: "pointer",
                                          }}
                                        >
                                          <input
                                            type="radio"
                                            name="editSubjectScope"
                                            checked={
                                              editSubjectScope === "organisation"
                                            }
                                            onChange={() => {
                                              setEditSubjectScope("organisation");
                                              setEditSubjectType("organisation");
                                              setEditSubjectPracticeIds([]);
                                            }}
                                            disabled={isSavingEditSubject}
                                          />
                                          Organisation-wide
                                        </label>
                                      </fieldset>
                                      {editSubjectScope === "practice" ? (
                                        <>
                                          <label
                                            style={{
                                              display: "grid",
                                              gap: 6,
                                              fontSize: 13,
                                              color: mutedColor,
                                            }}
                                          >
                                            Subject subtype
                                            <select
                                              value={
                                                editSubjectType === "stretch"
                                                  ? "stretch"
                                                  : "practice"
                                              }
                                              onChange={(e) =>
                                                setEditSubjectType(
                                                  e.target.value === "stretch"
                                                    ? "stretch"
                                                    : "practice"
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
                                              <option value="stretch">
                                                Stretch
                                              </option>
                                            </select>
                                          </label>
                                          <div
                                            style={{
                                              display: "grid",
                                              gap: 8,
                                              fontSize: 13,
                                              color: mutedColor,
                                            }}
                                          >
                                            <span>
                                              Relevant to practice (optional)
                                            </span>
                                            <div
                                              style={{
                                                display: "flex",
                                                flexDirection: "column",
                                                gap: 6,
                                                maxHeight: 200,
                                                overflowY: "auto",
                                                padding: "8px 10px",
                                                border: `1px solid ${border}`,
                                                borderRadius: 8,
                                                backgroundColor: bg,
                                              }}
                                            >
                                              {practicesForEditSubjectPrimary.length ===
                                              0 ? (
                                                <span style={{ fontSize: 12 }}>
                                                  No practices available.
                                                </span>
                                              ) : (
                                                practicesForEditSubjectPrimary.map(
                                                  (p) => (
                                                    <label
                                                      key={p.id}
                                                      style={{
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: 8,
                                                        fontSize: 14,
                                                        color: text,
                                                        cursor: "pointer",
                                                      }}
                                                    >
                                                      <input
                                                        type="checkbox"
                                                        checked={editSubjectPracticeIds.includes(
                                                          p.id
                                                        )}
                                                        onChange={() => {
                                                          setEditSubjectPracticeIds(
                                                            (prev) =>
                                                              prev.includes(p.id)
                                                                ? prev.filter(
                                                                    (x) =>
                                                                      x !== p.id
                                                                  )
                                                                : [...prev, p.id]
                                                          );
                                                        }}
                                                        disabled={
                                                          isSavingEditSubject
                                                        }
                                                      />
                                                      {p.name}
                                                    </label>
                                                  )
                                                )
                                              )}
                                            </div>
                                            <span
                                              style={{
                                                fontSize: 12,
                                                lineHeight: 1.45,
                                                color: mutedColor,
                                                fontWeight: 400,
                                              }}
                                            >
                                              Select any practices where this
                                              subject applies. Does not define
                                              ownership or structure.
                                            </span>
                                          </div>
                                          <p
                                            style={{
                                              ...muted,
                                              margin: 0,
                                              fontSize: 12,
                                              lineHeight: 1.45,
                                            }}
                                          >
                                            The subject row remains the
                                            structural parent for competencies
                                            under capability area — practice is
                                            only contextual.
                                          </p>
                                        </>
                                      ) : (
                                        <p
                                          style={{
                                            ...muted,
                                            margin: 0,
                                            fontSize: 12,
                                            lineHeight: 1.45,
                                          }}
                                        >
                                          Organisation-wide subjects do not use
                                          practice context in this phase.
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
                                        Capability area (optional)
                                        <select
                                          value={editSubjectCapabilityAreaId}
                                          onChange={(e) =>
                                            setEditSubjectCapabilityAreaId(
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
                                          <option value="">Unassigned</option>
                                          {capabilityAreas.map((a) => (
                                            <option key={a.id} value={a.id}>
                                              {a.name.trim() || "Capability area"}
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
                                        sectionTree
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
                                                    sectionTree
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
                                                          No subject
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
                                                    {catalogueUnassignedBulkContext &&
                                                    section.isUnassigned &&
                                                    canAuthorHierarchy &&
                                                    isAssignableLifecycleStatus(
                                                      c.status,
                                                    ) ? (
                                                      <label
                                                        style={{
                                                          display: "flex",
                                                          alignItems:
                                                            "flex-start",
                                                          marginTop: 4,
                                                          cursor: "pointer",
                                                          flexShrink: 0,
                                                        }}
                                                      >
                                                        <input
                                                          type="checkbox"
                                                          checked={catalogueBulkOrphanCompetencyIds.has(
                                                            c.id,
                                                          )}
                                                          onChange={(e) => {
                                                            setCatalogueBulkOrphanCompetencyIds(
                                                              (prev) => {
                                                                const n =
                                                                  new Set(prev);
                                                                if (
                                                                  e.target.checked
                                                                )
                                                                  n.add(c.id);
                                                                else
                                                                  n.delete(c.id);
                                                                return n;
                                                              },
                                                            );
                                                          }}
                                                        />
                                                      </label>
                                                    ) : null}
                                                    <div
                                                      style={{
                                                        minWidth: 0,
                                                        flex: "1 1 0",
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
                                                      {(() => {
                                                        const refLine =
                                                          getCompetencyReferenceMappedFromLine(
                                                            c as CompetencyWithProvenance,
                                                          );
                                                        if (!refLine) return null;
                                                        return (
                                                          <div
                                                            style={{
                                                              marginTop: 4,
                                                              fontSize: 11,
                                                              color: mutedColor,
                                                              opacity: 0.88,
                                                              lineHeight: 1.35,
                                                            }}
                                                          >
                                                            {refLine}
                                                          </div>
                                                        );
                                                      })()}
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
                                                            void handleConfirmArchiveCompetency(
                                                              c
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
                                        {catalogueUnassignedBulkContext &&
                                        !section.isUnassigned &&
                                        subjRow &&
                                        canAuthorHierarchy ? (
                                          <label
                                            style={{
                                              display: "inline-flex",
                                              alignItems: "center",
                                              marginTop: 2,
                                              cursor: "pointer",
                                              flexShrink: 0,
                                            }}
                                            title="Bulk select subject"
                                          >
                                            <input
                                              type="checkbox"
                                              checked={catalogueBulkUnassignedSubjectIds.has(
                                                sectionKey,
                                              )}
                                              onChange={(e) => {
                                                setCatalogueBulkUnassignedSubjectIds(
                                                  (prev) => {
                                                    const n = new Set(prev);
                                                    if (e.target.checked)
                                                      n.add(sectionKey);
                                                    else n.delete(sectionKey);
                                                    return n;
                                                  },
                                                );
                                              }}
                                            />
                                          </label>
                                        ) : null}
                                        <button
                                          type="button"
                                          onClick={() =>
                                            toggleSubjectAccordion(
                                              practice.key,
                                              sectionKey,
                                              sectionTree
                                            )
                                          }
                                          aria-expanded={isSubjectAccordionExpanded(
                                            practice.key,
                                            sectionKey,
                                            sectionKey,
                                            sectionTree
                                          )}
                                          title={
                                            isSubjectAccordionExpanded(
                                              practice.key,
                                              sectionKey,
                                              sectionKey,
                                              sectionTree
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
                                            sectionTree
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
                                            {!section.isUnassigned &&
                                            subjRow ? (
                                              hierarchyTreeProp ===
                                              "catalogue" ? (
                                                <>
                                                  <CompetencyTypeBadge
                                                    type={toCompetencyTypeUnion(
                                                      normalizeCompetencyType(
                                                        subjRow.type
                                                      )
                                                    )}
                                                  />
                                                  {practiceRelevanceNames.length >
                                                  0 ? (
                                                    <span
                                                      title="Practice context (optional)"
                                                      style={{
                                                        fontSize: 11,
                                                        fontWeight: 500,
                                                        letterSpacing: "0.02em",
                                                        color: mutedColor,
                                                        opacity: 0.92,
                                                        padding: "3px 10px",
                                                        borderRadius: 999,
                                                        border: `1px solid ${borderSubtle}`,
                                                        backgroundColor:
                                                          "rgba(255,255,255,0.03)",
                                                        maxWidth: "100%",
                                                        whiteSpace:
                                                          "nowrap" as const,
                                                        overflow: "hidden",
                                                        textOverflow:
                                                          "ellipsis",
                                                      }}
                                                    >
                                                      Relevant to:{" "}
                                                      {practiceRelevanceNames.join(
                                                        ", "
                                                      )}
                                                    </span>
                                                  ) : null}
                                                </>
                                              ) : (
                                                <span
                                                  title={
                                                    sectionTree ===
                                                    "organisation"
                                                      ? "Subject scope (structural)"
                                                      : "Practice context (optional)"
                                                  }
                                                  style={{
                                                    fontSize: 11,
                                                    fontWeight: 500,
                                                    letterSpacing: "0.02em",
                                                    color: mutedColor,
                                                    opacity: 0.92,
                                                    padding: "3px 10px",
                                                    borderRadius: 999,
                                                    border: `1px solid ${borderSubtle}`,
                                                    backgroundColor:
                                                      "rgba(255,255,255,0.03)",
                                                    maxWidth: "100%",
                                                    whiteSpace:
                                                      "nowrap" as const,
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                  }}
                                                >
                                                  {sectionTree ===
                                                  "organisation"
                                                    ? "Organisation scope"
                                                    : practiceRelevanceNames.length >
                                                        0
                                                      ? `Relevant · ${practiceRelevanceNames.join(", ")}`
                                                      : "No practice context"}
                                                </span>
                                              )
                                            ) : null}
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
                                            {subjRow ? (
                                              <GovernanceTaxonomyBadge
                                                status={parseTaxonomyGovernanceStatus(
                                                  subjRow.governance_status
                                                )}
                                                compact
                                              />
                                            ) : null}
                                          </div>
                                          {!section.isUnassigned && subjRow
                                            ? (() => {
                                                const lines =
                                                  getSubjectProvenanceLines(
                                                    subjRow as CompetencySubjectWithProvenance,
                                                    capabilityAreas,
                                                  );
                                                const items = [
                                                  lines.capabilityAreaLine,
                                                  lines.mappedFromLine,
                                                  lines.sourceFrameworkLine,
                                                ].filter(Boolean) as string[];
                                                if (items.length === 0)
                                                  return null;
                                                return (
                                                  <div
                                                    style={{
                                                      marginTop: 4,
                                                      display: "flex",
                                                      flexDirection: "column",
                                                      gap: 2,
                                                      maxWidth: "100%",
                                                    }}
                                                  >
                                                    {items.map((line, i) => (
                                                      <div
                                                        key={`prov-${i}-${line.slice(0, 24)}`}
                                                        style={{
                                                          fontSize: 11,
                                                          color: mutedColor,
                                                          opacity: 0.9,
                                                          lineHeight: 1.35,
                                                        }}
                                                      >
                                                        {line}
                                                      </div>
                                                    ))}
                                                  </div>
                                                );
                                              })()
                                            : null}
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
                                          {!section.isUnassigned &&
                                          subjRow &&
                                          canAuthorHierarchy ? (
                                            <span
                                              style={{
                                                display: "inline-flex",
                                                flexWrap: "wrap",
                                                gap: 4,
                                                alignItems: "center",
                                                marginRight: 4,
                                              }}
                                            >
                                              {parseTaxonomyGovernanceStatus(
                                                subjRow.governance_status
                                              ) === "draft" ? (
                                                <>
                                                  <button
                                                    type="button"
                                                    disabled={
                                                      governanceUpdateBusy ===
                                                      `subject:${subjRow.id}`
                                                    }
                                                    onClick={() =>
                                                      void setSubjectGovernanceStatus(
                                                        subjRow.id,
                                                        "settled"
                                                      )
                                                    }
                                                    style={{
                                                      ...btnGhost,
                                                      fontSize: 10,
                                                      padding: "2px 6px",
                                                    }}
                                                  >
                                                    Set settled
                                                  </button>
                                                  <button
                                                    type="button"
                                                    disabled={
                                                      governanceUpdateBusy ===
                                                      `subject:${subjRow.id}`
                                                    }
                                                    onClick={() =>
                                                      void setSubjectGovernanceStatus(
                                                        subjRow.id,
                                                        "protected"
                                                      )
                                                    }
                                                    style={{
                                                      ...btnGhost,
                                                      fontSize: 10,
                                                      padding: "2px 6px",
                                                    }}
                                                  >
                                                    Protect
                                                  </button>
                                                </>
                                              ) : null}
                                              {parseTaxonomyGovernanceStatus(
                                                subjRow.governance_status
                                              ) === "settled" ? (
                                                <>
                                                  <button
                                                    type="button"
                                                    disabled={
                                                      governanceUpdateBusy ===
                                                      `subject:${subjRow.id}`
                                                    }
                                                    onClick={() =>
                                                      void setSubjectGovernanceStatus(
                                                        subjRow.id,
                                                        "protected"
                                                      )
                                                    }
                                                    style={{
                                                      ...btnGhost,
                                                      fontSize: 10,
                                                      padding: "2px 6px",
                                                    }}
                                                  >
                                                    Protect
                                                  </button>
                                                  <button
                                                    type="button"
                                                    disabled={
                                                      governanceUpdateBusy ===
                                                      `subject:${subjRow.id}`
                                                    }
                                                    onClick={() =>
                                                      void setSubjectGovernanceStatus(
                                                        subjRow.id,
                                                        "draft"
                                                      )
                                                    }
                                                    style={{
                                                      ...btnGhost,
                                                      fontSize: 10,
                                                      padding: "2px 6px",
                                                    }}
                                                  >
                                                    To draft
                                                  </button>
                                                </>
                                              ) : null}
                                              {parseTaxonomyGovernanceStatus(
                                                subjRow.governance_status
                                              ) === "protected" ? (
                                                <>
                                                  <button
                                                    type="button"
                                                    disabled={
                                                      governanceUpdateBusy ===
                                                      `subject:${subjRow.id}`
                                                    }
                                                    onClick={() =>
                                                      void setSubjectGovernanceStatus(
                                                        subjRow.id,
                                                        "settled"
                                                      )
                                                    }
                                                    style={{
                                                      ...btnGhost,
                                                      fontSize: 10,
                                                      padding: "2px 6px",
                                                    }}
                                                  >
                                                    Unprotect
                                                  </button>
                                                  <button
                                                    type="button"
                                                    disabled={
                                                      governanceUpdateBusy ===
                                                      `subject:${subjRow.id}`
                                                    }
                                                    onClick={() =>
                                                      void setSubjectGovernanceStatus(
                                                        subjRow.id,
                                                        "draft"
                                                      )
                                                    }
                                                    style={{
                                                      ...btnGhost,
                                                      fontSize: 10,
                                                      padding: "2px 6px",
                                                    }}
                                                  >
                                                    To draft
                                                  </button>
                                                </>
                                              ) : null}
                                            </span>
                                          ) : null}
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleAddCompetencyToSubject(
                                                section.isUnassigned
                                                  ? ""
                                                  : sectionKey,
                                                sectionTitle,
                                                sectionInlineKey,
                                                sectionTree
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
                                          {section.isUnassigned &&
                                          canAuthorHierarchy ? (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setCompetencyRefinementOpen(true)
                                              }
                                              disabled={
                                                isSavingCompetency ||
                                                isSavingLevel ||
                                                isSavingSubject ||
                                                isSavingEditCompetency ||
                                                isSavingEditSubject
                                              }
                                              style={{
                                                ...btnGhost,
                                                fontSize: 12,
                                                padding: "7px 12px",
                                              }}
                                              title="Resolve unassigned competencies with targeted AI"
                                            >
                                              Resolve unassigned competencies
                                            </button>
                                          ) : null}
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
                                                      onClick={() =>
                                                        beginSubjectArchiveFlow(
                                                          subjRow,
                                                          sectionTitle,
                                                        )
                                                      }
                                                      disabled={
                                                        lifecycleSaving ||
                                                        bulkActionBusy
                                                      }
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
                                        sectionTree
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
                                                    sectionTree
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
                                          <div
                                            style={{
                                              display: "flex",
                                              flexDirection: "column",
                                              gap: 0,
                                            }}
                                          >
                                            {section.isUnassigned &&
                                            catalogueUnassignedBulkContext &&
                                            canAuthorHierarchy ? (
                                              <div
                                                style={{
                                                  display: "flex",
                                                  flexDirection: "column",
                                                  gap: 8,
                                                  padding: "4px 0 8px",
                                                  borderBottom: `1px solid ${borderSubtle}`,
                                                }}
                                              >
                                                {orphanSelectableIds.length >
                                                0 ? (
                                                  <div
                                                    style={{
                                                      display: "flex",
                                                      flexWrap: "wrap",
                                                      alignItems: "center",
                                                      gap: 10,
                                                    }}
                                                  >
                                                    <label
                                                      style={{
                                                        display: "inline-flex",
                                                        alignItems: "center",
                                                        gap: 6,
                                                        fontSize: 12,
                                                        color: mutedColor,
                                                        cursor: "pointer",
                                                      }}
                                                    >
                                                      <input
                                                        type="checkbox"
                                                        checked={
                                                          orphanSelectableIds.length >
                                                            0 &&
                                                          orphanSelectableIds.every(
                                                            (id) =>
                                                              catalogueBulkOrphanCompetencyIds.has(
                                                                id,
                                                              ),
                                                          )
                                                        }
                                                        onChange={() => {
                                                          const allOn =
                                                            orphanSelectableIds.every(
                                                              (id) =>
                                                                catalogueBulkOrphanCompetencyIds.has(
                                                                  id,
                                                                ),
                                                            );
                                                          setCatalogueBulkOrphanCompetencyIds(
                                                            (prev) => {
                                                              const n =
                                                                new Set(prev);
                                                              if (allOn) {
                                                                for (const id of orphanSelectableIds)
                                                                  n.delete(id);
                                                              } else {
                                                                for (const id of orphanSelectableIds)
                                                                  n.add(id);
                                                              }
                                                              return n;
                                                            },
                                                          );
                                                        }}
                                                      />
                                                      Select all
                                                    </label>
                                                    {catalogueBulkOrphanCompetencyIds.size >
                                                    0 ? (
                                                      <span
                                                        style={{
                                                          fontSize: 12,
                                                          color: text,
                                                          fontWeight: 600,
                                                        }}
                                                      >
                                                        {
                                                          catalogueBulkOrphanCompetencyIds.size
                                                        }{" "}
                                                        selected
                                                      </span>
                                                    ) : null}
                                                  </div>
                                                ) : null}
                                                {catalogueBulkOrphanCompetencyIds.size >
                                                0 ? (
                                                  <div
                                                    style={{
                                                      display: "flex",
                                                      flexWrap: "wrap",
                                                      gap: 8,
                                                      alignItems: "center",
                                                      padding: "8px 10px",
                                                      borderRadius: 8,
                                                      backgroundColor: bg,
                                                      border: `1px solid ${borderSubtle}`,
                                                    }}
                                                  >
                                                    <button
                                                      type="button"
                                                      disabled={
                                                        bulkActionBusy ||
                                                        isSavingCompetency
                                                      }
                                                      onClick={() => {
                                                        setBulkAssignCompetenciesTargetId(
                                                          "",
                                                        );
                                                        setBulkAssignCompetencyModalOpen(
                                                          true,
                                                        );
                                                      }}
                                                      style={{
                                                        ...btnPrimary,
                                                        fontSize: 12,
                                                        padding: "6px 10px",
                                                      }}
                                                    >
                                                      Assign to subject
                                                    </button>
                                                    <button
                                                      type="button"
                                                      disabled={
                                                        bulkActionBusy ||
                                                        !canArchiveEntity
                                                      }
                                                      onClick={() =>
                                                        void executeBulkArchiveOrphanCompetencies()
                                                      }
                                                      style={{
                                                        ...btnSecondary,
                                                        fontSize: 12,
                                                        padding: "6px 10px",
                                                      }}
                                                    >
                                                      Archive selected
                                                    </button>
                                                    <button
                                                      type="button"
                                                      disabled={bulkActionBusy}
                                                      onClick={() =>
                                                        setCatalogueBulkOrphanCompetencyIds(
                                                          new Set(),
                                                        )
                                                      }
                                                      style={{
                                                        ...btn,
                                                        fontSize: 12,
                                                        padding: "6px 10px",
                                                      }}
                                                    >
                                                      Cancel
                                                    </button>
                                                  </div>
                                                ) : null}
                                              </div>
                                            ) : null}
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
                                                          No subject
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
                                                    {catalogueUnassignedBulkContext &&
                                                    section.isUnassigned &&
                                                    canAuthorHierarchy &&
                                                    isAssignableLifecycleStatus(
                                                      c.status,
                                                    ) ? (
                                                      <label
                                                        style={{
                                                          display: "flex",
                                                          alignItems:
                                                            "flex-start",
                                                          marginTop: 4,
                                                          cursor: "pointer",
                                                          flexShrink: 0,
                                                        }}
                                                      >
                                                        <input
                                                          type="checkbox"
                                                          checked={catalogueBulkOrphanCompetencyIds.has(
                                                            c.id,
                                                          )}
                                                          onChange={(e) => {
                                                            setCatalogueBulkOrphanCompetencyIds(
                                                              (prev) => {
                                                                const n =
                                                                  new Set(prev);
                                                                if (
                                                                  e.target.checked
                                                                )
                                                                  n.add(c.id);
                                                                else
                                                                  n.delete(c.id);
                                                                return n;
                                                              },
                                                            );
                                                          }}
                                                        />
                                                      </label>
                                                    ) : null}
                                                    <div
                                                      style={{
                                                        minWidth: 0,
                                                        flex: "1 1 0",
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
                                                      {(() => {
                                                        const refLine =
                                                          getCompetencyReferenceMappedFromLine(
                                                            c as CompetencyWithProvenance,
                                                          );
                                                        if (!refLine) return null;
                                                        return (
                                                          <div
                                                            style={{
                                                              marginTop: 4,
                                                              fontSize: 11,
                                                              color: mutedColor,
                                                              opacity: 0.88,
                                                              lineHeight: 1.35,
                                                            }}
                                                          >
                                                            {refLine}
                                                          </div>
                                                        );
                                                      })()}
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
                                                            void handleConfirmArchiveCompetency(
                                                              c
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
                                        </div>
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
                            marginBottom: 12,
                            display: "flex",
                            flexWrap: "wrap",
                            alignItems: "center",
                            gap: 10,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              letterSpacing: "0.08em",
                              textTransform: "uppercase",
                              color: mutedColor,
                            }}
                          >
                            View
                          </span>
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: 4,
                              alignItems: "center",
                            }}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setCompetencyManagementLens("catalogue")
                              }
                              style={{
                                ...(competencyManagementLens === "catalogue"
                                  ? btnPrimary
                                  : btnGhost),
                                fontSize: 13,
                                padding: "8px 14px",
                                borderRadius: 8,
                              }}
                            >
                              Capability catalogue
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setCompetencyManagementLens("practice")
                              }
                              style={{
                                ...(competencyManagementLens === "practice"
                                  ? btnPrimary
                                  : btnGhost),
                                fontSize: 13,
                                padding: "8px 14px",
                                borderRadius: 8,
                              }}
                            >
                              Practice view
                            </button>
                          </div>
                        </div>
                        <div
                          style={{
                            marginBottom: 12,
                            padding: "12px 14px",
                            borderRadius: 8,
                            border: `1px solid ${border}`,
                            backgroundColor: bg,
                            display: "flex",
                            flexDirection: "column",
                            gap: 10,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              letterSpacing: "0.08em",
                              textTransform: "uppercase",
                              color: mutedColor,
                            }}
                          >
                            Filters
                          </div>
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              alignItems: "center",
                              gap: 12,
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
                              Scope
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
                                <option value="all">All areas</option>
                                <option value="practice">
                                  Practice / stretch types only
                                </option>
                                <option value="organisation">
                                  Organisation-wide only
                                </option>
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
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              alignItems: "center",
                              gap: 12,
                              paddingTop: 8,
                              borderTop: `1px solid ${borderSubtle}`,
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
                              Practice context
                              <select
                                value={subjectPrimaryPracticeFilter}
                                onChange={(e) =>
                                  setSubjectPrimaryPracticeFilter(e.target.value)
                                }
                                disabled={viewMode === "organisation"}
                                title={
                                  viewMode === "organisation"
                                    ? "Switch scope to All or Practice types to filter by practice context"
                                    : "Filter subjects by which practice they are relevant to (context only)"
                                }
                                style={{
                                  padding: "6px 10px",
                                  fontSize: 13,
                                  borderRadius: 6,
                                  border: `1px solid ${border}`,
                                  backgroundColor: surface,
                                  color: text,
                                  opacity: viewMode === "organisation" ? 0.55 : 1,
                                }}
                              >
                                <option value="all">All</option>
                                <option value="unassigned">No practice context</option>
                                {[...practices]
                                  .sort((a, b) =>
                                    a.name.localeCompare(b.name)
                                  )
                                  .map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.name}
                                    </option>
                                  ))}
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
                              Competencies on subject
                              <select
                                value={subjectCompetencyPresenceFilter}
                                onChange={(e) =>
                                  setSubjectCompetencyPresenceFilter(
                                    e.target.value as "all" | "with" | "without"
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
                                <option value="all">All subjects</option>
                                <option value="with">Has competencies</option>
                                <option value="without">No competencies yet</option>
                              </select>
                            </label>
                            {subjectPrimaryPracticeFilter !== "all" ||
                            subjectCompetencyPresenceFilter !== "all" ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setSubjectPrimaryPracticeFilter("all");
                                  setSubjectCompetencyPresenceFilter("all");
                                }}
                                style={{
                                  ...btnGhost,
                                  fontSize: 12,
                                  padding: "4px 8px",
                                }}
                              >
                                Reset subject filters
                              </button>
                            ) : null}
                          </div>
                          {canAuthorHierarchy ? (
                            <div
                              style={{
                                paddingTop: 8,
                                borderTop: `1px solid ${borderSubtle}`,
                                display: "flex",
                                flexDirection: "column",
                                gap: 8,
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 12,
                                  fontWeight: 600,
                                  color: mutedColor,
                                }}
                              >
                                Capability areas
                              </div>
                              <div
                                style={{
                                  display: "flex",
                                  flexWrap: "wrap",
                                  gap: 8,
                                  alignItems: "center",
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setShowCreateCapabilityAreaForm((v) => !v)
                                  }
                                  style={btnSecondary}
                                >
                                  {showCreateCapabilityAreaForm
                                    ? "Cancel"
                                    : "Create capability area"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCapabilityAreaBuilderOpen(true)
                                  }
                                  style={btnSecondary}
                                >
                                  Manage capability areas
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setLeftoverRefinementOpen(true)
                                  }
                                  style={btnSecondary}
                                  title="AI suggestions for subjects not yet in a capability area"
                                >
                                  Refine leftovers
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCompetencyRefinementOpen(true)
                                  }
                                  style={btnSecondary}
                                  title="Assign unlinked competencies to subjects using targeted AI"
                                >
                                  Refine competencies
                                </button>
                                <button
                                  type="button"
                                  onClick={openSubjectNormalisationModal}
                                  disabled={
                                    subjectNormEligibleCount === 0 ||
                                    isSavingCapabilityArea ||
                                    isSavingSubject ||
                                    isSavingCompetency ||
                                    subjectNormLoading
                                  }
                                  style={btnSecondary}
                                  title="AI review of subject naming across capability areas (nothing saves until you apply)"
                                >
                                  Refine subject names
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (pendingMergeSuggestionCount > 0) {
                                      setSubjectMergeModalOpen(true);
                                    }
                                  }}
                                  disabled={mergeResolutionButtonDisabled}
                                  style={{
                                    ...btnSecondary,
                                    ...(mergeResolutionButtonDisabled
                                      ? {
                                          opacity: 0.48,
                                          cursor: "not-allowed",
                                          color: mutedColor,
                                          borderColor: borderSubtle,
                                        }
                                      : {}),
                                  }}
                                  title={mergeResolutionButtonTitle}
                                >
                                  Resolve subject merges (
                                  {pendingMergeSuggestionCount})
                                </button>
                              </div>
                              {showCreateCapabilityAreaForm ? (
                                <form
                                  onSubmit={(e) =>
                                    void handleSaveNewCapabilityArea(e)
                                  }
                                  style={{
                                    display: "grid",
                                    gap: 8,
                                  }}
                                >
                                  <label
                                    style={{
                                      display: "grid",
                                      gap: 4,
                                      fontSize: 13,
                                      color: mutedColor,
                                    }}
                                  >
                                    Name
                                    <input
                                      required
                                      value={newCapabilityAreaName}
                                      onChange={(e) =>
                                        setNewCapabilityAreaName(e.target.value)
                                      }
                                      disabled={isSavingCapabilityArea}
                                      style={{
                                        padding: "8px 10px",
                                        fontSize: 14,
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
                                      gap: 4,
                                      fontSize: 13,
                                      color: mutedColor,
                                    }}
                                  >
                                    Description (optional)
                                    <textarea
                                      value={newCapabilityAreaDescription}
                                      onChange={(e) =>
                                        setNewCapabilityAreaDescription(
                                          e.target.value
                                        )
                                      }
                                      disabled={isSavingCapabilityArea}
                                      rows={2}
                                      style={{
                                        padding: "8px 10px",
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
                                  <button
                                    type="submit"
                                    disabled={isSavingCapabilityArea}
                                    style={btnPrimary}
                                  >
                                    {isSavingCapabilityArea
                                      ? "Saving…"
                                      : "Save"}
                                  </button>
                                </form>
                              ) : null}
                            </div>
                          ) : null}
                        </div>

                        {viewMode !== "organisation" &&
                          competencyManagementLens === "catalogue" && (
                          <div
                            style={{
                              marginBottom: 16,
                              padding: "12px 14px",
                              borderRadius: 8,
                              border: `1px solid ${borderSubtle}`,
                              backgroundColor: surface,
                              display: "flex",
                              flexDirection: "column",
                              gap: 10,
                            }}
                          >
                            <div
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                letterSpacing: "0.08em",
                                textTransform: "uppercase",
                                color: mutedColor,
                              }}
                            >
                              Actions
                            </div>
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
                                Suggest additions (AI)
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
                                  placeholder="Describe what to add (subjects, competencies, practices…)"
                                  style={{
                                    flex: "1 1 auto",
                                    minWidth: 0,
                                    padding: "8px 10px",
                                    fontSize: 14,
                                    color: text,
                                    backgroundColor: bg,
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
                                    : "Generate"}
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
                          </div>
                        )}

                        {competencyManagementLens === "catalogue" ? (
                          <>
                            <div
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                alignItems: "center",
                                gap: 10,
                                margin: "14px 0 6px",
                              }}
                            >
                              <h3
                                style={{
                                  margin: 0,
                                  fontSize: 14,
                                  fontWeight: 600,
                                  color: text,
                                  letterSpacing: "0.02em",
                                }}
                              >
                                Capability catalogue
                              </h3>
                              <label
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                                  fontSize: 12,
                                  color: mutedColor,
                                }}
                              >
                                Taxonomy governance
                                <select
                                  value={taxonomyGovernanceFilter}
                                  onChange={(e) =>
                                    setTaxonomyGovernanceFilter(
                                      e.target.value === "all"
                                        ? "all"
                                        : (e.target
                                            .value as TaxonomyGovernanceStatus)
                                    )
                                  }
                                  style={{
                                    padding: "4px 8px",
                                    fontSize: 12,
                                    borderRadius: 6,
                                    border: `1px solid ${border}`,
                                    backgroundColor: surface,
                                    color: text,
                                  }}
                                >
                                  <option value="all">All statuses</option>
                                  <option value="draft">Draft only</option>
                                  <option value="settled">Settled only</option>
                                  <option value="protected">Protected only</option>
                                </select>
                              </label>
                              <button
                                type="button"
                                onClick={() =>
                                  setTaxonomyGovernanceFilter(
                                    taxonomyGovernanceFilter === "draft"
                                      ? "all"
                                      : "draft"
                                  )
                                }
                                style={{
                                  ...btnGhost,
                                  fontSize: 11,
                                  padding: "4px 8px",
                                }}
                              >
                                {taxonomyGovernanceFilter === "draft"
                                  ? "Show all statuses"
                                  : "Show draft subjects only"}
                              </button>
                            </div>
                            <p
                              style={{
                                margin: "0 0 10px",
                                fontSize: 13,
                                color: mutedColor,
                                lineHeight: 1.45,
                              }}
                            >
                              {SUBJECT_PRACTICE_CONTEXT_HINT} Subjects are
                              grouped by capability area, then listed with
                              competencies. Subject type (organisation / practice
                              / stretch) and optional practice context appear on
                              each row — capability area is structural; practice
                              is contextual.
                            </p>
                            {subjectsForCapabilityTree.length === 0 &&
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
                                No subjects match the current filters. Adjust
                                filters or add subjects.
                              </p>
                            ) : null}
                            <div
                              style={{
                                marginTop: 14,
                                display: "flex",
                                flexDirection: "column",
                                gap: 6,
                              }}
                            >
                              {managementCapabilityAreaGroups.map((group) =>
                                renderManagementPracticeHierarchyRow(
                                  group,
                                  "catalogue"
                                )
                              )}
                            </div>
                          </>
                        ) : (
                          <>
                            <div
                              style={{
                                marginBottom: 14,
                                padding: "14px 14px",
                                borderRadius: 8,
                                border: `1px solid ${borderSubtle}`,
                                backgroundColor: surface,
                                display: "flex",
                                flexDirection: "column",
                                gap: 12,
                              }}
                            >
                              <div>
                                <h3
                                  style={{
                                    margin: "0 0 6px",
                                    fontSize: 14,
                                    fontWeight: 600,
                                    color: text,
                                    letterSpacing: "0.02em",
                                  }}
                                >
                                  Practice management
                                </h3>
                                <p
                                  style={{
                                    margin: 0,
                                    fontSize: 13,
                                    color: mutedColor,
                                    lineHeight: 1.45,
                                  }}
                                >
                                  Practices provide organisational context for
                                  your capability model.
                                </p>
                                <p
                                  style={{
                                    margin: 0,
                                    fontSize: 13,
                                    color: mutedColor,
                                    lineHeight: 1.45,
                                  }}
                                >
                                  They highlight which subjects and competencies
                                  are relevant in a domain (e.g. Business
                                  Analysis, Agile Delivery), but they do not
                                  own or structure the taxonomy.
                                </p>
                                <p
                                  style={{
                                    margin: 0,
                                    fontSize: 13,
                                    color: mutedColor,
                                    lineHeight: 1.45,
                                  }}
                                >
                                  Subjects and competencies are defined
                                  independently and may be relevant to multiple
                                  practices. Create practices or generate a
                                  model here, then review alignment below.
                                </p>
                              </div>
                              <div
                                style={{
                                  display: "flex",
                                  flexWrap: "wrap",
                                  gap: 10,
                                  alignItems: "stretch",
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={openPracticeGenModal}
                                  disabled={
                                    isSavingPractice ||
                                    isSavingSubject ||
                                    isSavingCompetency ||
                                    isSavingLevel ||
                                    isSavingEditCompetency ||
                                    isSavingEditSubject ||
                                    isSavingEditPractice
                                  }
                                  style={{
                                    ...btnSecondary,
                                    flex: "1 1 200px",
                                    margin: 0,
                                    minWidth: 0,
                                    boxSizing: "border-box" as const,
                                  }}
                                >
                                  Generate practice model
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleCancelEditPractice();
                                    setShowCreatePracticeForm((s) => !s);
                                  }}
                                  disabled={
                                    isSavingPractice ||
                                    isSavingSubject ||
                                    isSavingCompetency ||
                                    isSavingLevel ||
                                    isSavingEditCompetency ||
                                    isSavingEditSubject ||
                                    isSavingEditPractice
                                  }
                                  style={{
                                    ...btn,
                                    flex: "1 1 200px",
                                    margin: 0,
                                    minWidth: 0,
                                    boxSizing: "border-box" as const,
                                  }}
                                >
                                  Add practice
                                </button>
                              </div>
                              {showCreatePracticeForm ? (
                                <form
                                  onSubmit={(e) => void handleSaveNewPractice(e)}
                                  style={{
                                    marginTop: 0,
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
                              ) : null}
                            </div>

                            <h3
                              style={{
                                margin: "0 0 6px",
                                fontSize: 14,
                                fontWeight: 600,
                                color: text,
                                letterSpacing: "0.02em",
                              }}
                            >
                              Practice comparison
                            </h3>
                            <p
                              style={{
                                margin: "0 0 8px",
                                fontSize: 13,
                                color: text,
                                fontWeight: 600,
                                lineHeight: 1.45,
                              }}
                            >
                              This view shows subjects relevant to each practice.
                              Practices do not own subjects — they provide context
                              only.
                            </p>
                            <p
                              style={{
                                margin: "0 0 10px",
                                fontSize: 13,
                                color: mutedColor,
                                lineHeight: 1.45,
                              }}
                            >
                              Subjects linked via subject_practice_links (plus
                              legacy practice_id until cleared). Under each
                              subject, competencies linked in this practice
                              context appear (competency_practice_links).
                              Organisation-wide subjects with no practice
                              relevance do not appear. Uses the same subject
                              filters as the catalogue.
                            </p>
                            {practiceOverlayFeedback ? (
                              <p
                                style={{
                                  margin: "0 0 10px",
                                  padding: "8px 10px",
                                  borderRadius: 8,
                                  fontSize: 13,
                                  color: text,
                                  lineHeight: 1.45,
                                  backgroundColor: "rgba(110, 176, 240, 0.08)",
                                  border: "1px solid rgba(110, 176, 240, 0.25)",
                                }}
                              >
                                {practiceOverlayFeedback}
                              </p>
                            ) : null}
                            <div
                              style={{
                                marginTop: 4,
                                display: "flex",
                                flexDirection: "column",
                                gap: 0,
                              }}
                            >
                              {practicesForPracticeLensView.length === 0 ? (
                                <p
                                  style={{
                                    margin: "0 0 12px",
                                    fontSize: 13,
                                    color: mutedColor,
                                    lineHeight: 1.45,
                                  }}
                                >
                                  No practices match the current lifecycle
                                  filters.
                                </p>
                              ) : (
                                practicesForPracticeLensView.map((practice) => {
                                  const practiceLife = parseLifecycleStatus(
                                    practice.status
                                  );
                                  const linkedSubjects = subjectsForCapabilityTree
                                    .filter((s) =>
                                      subjectMatchesPracticeRelevanceFilter(
                                        s,
                                        practice.id,
                                        subjectPracticeLinks
                                      )
                                    )
                                    .sort((a, b) => {
                                      const ao = orgCapabilityAreaDisplayName(
                                        a as CompetencySubjectWithProvenance,
                                        capabilityAreas,
                                      );
                                      const bo = orgCapabilityAreaDisplayName(
                                        b as CompetencySubjectWithProvenance,
                                        capabilityAreas,
                                      );
                                      if (ao && !bo) return -1;
                                      if (!ao && bo) return 1;
                                      if (ao && bo) {
                                        const cmp = ao.localeCompare(bo, undefined, {
                                          sensitivity: "base",
                                        });
                                        if (cmp !== 0) return cmp;
                                      }
                                      return a.name.localeCompare(b.name);
                                    });
                                  const practiceLensExpanded =
                                    practiceLensAccordionOpen[practice.id] !==
                                    false;
                                  return (
                                    <div
                                      key={practice.id}
                                      style={{
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
                                            togglePracticeLensAccordion(
                                              practice.id
                                            )
                                          }
                                          aria-expanded={practiceLensExpanded}
                                          aria-label={
                                            practiceLensExpanded
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
                                          {practiceLensExpanded ? "▼" : "▶"}
                                        </button>
                                        <div
                                          style={{
                                            flex: 1,
                                            minWidth: 0,
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
                                                fontWeight: 700,
                                                fontSize: 15,
                                                color: text,
                                                letterSpacing: "-0.02em",
                                              }}
                                            >
                                              {practice.name.trim() ||
                                                "Practice"}
                                            </span>
                                            {renderLifecycleBadge(
                                              practice.status
                                            )}
                                            <span
                                              style={{
                                                fontSize: 13,
                                                color: mutedColor,
                                              }}
                                            >
                                              · {linkedSubjects.length}{" "}
                                              {linkedSubjects.length === 1
                                                ? "subject relevant to this practice"
                                                : "subjects relevant to this practice"}
                                            </span>
                                          </div>
                                          {practice.description?.trim() ? (
                                            <p
                                              style={{
                                                margin: "6px 0 0",
                                                fontSize: 13,
                                                color: mutedColor,
                                                lineHeight: 1.45,
                                              }}
                                            >
                                              {practice.description.trim()}
                                            </p>
                                          ) : null}
                                        </div>
                                        {canAuthorHierarchy ? (
                                          <div
                                            style={{
                                              display: "flex",
                                              flexWrap: "wrap",
                                              gap: 4,
                                              justifyContent: "flex-end",
                                              flexShrink: 0,
                                              alignItems: "flex-start",
                                            }}
                                          >
                                            <button
                                              type="button"
                                              onClick={() =>
                                                handleStartEditPractice(practice)
                                              }
                                              disabled={
                                                lifecycleSaving ||
                                                isSavingEditPractice ||
                                                isSavingPractice
                                              }
                                              style={{
                                                ...btnGhost,
                                                fontSize: 11,
                                                padding: "4px 8px",
                                              }}
                                            >
                                              Edit
                                            </button>
                                            {practiceLife !== "archived" ? (
                                              <button
                                                type="button"
                                                title="AI-assisted review: link subjects and competencies, suggest gaps (taxonomy only)"
                                                onClick={() =>
                                                  setPracticeCompetencyRefinementPractice(
                                                    practice
                                                  )
                                                }
                                                disabled={
                                                  lifecycleSaving ||
                                                  isSavingEditPractice ||
                                                  isSavingPractice
                                                }
                                                style={{
                                                  ...btnSecondary,
                                                  fontSize: 11,
                                                  padding: "4px 8px",
                                                }}
                                              >
                                                Refine practice model
                                              </button>
                                            ) : null}
                                            {practiceLife === "active" ? (
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setLifecycleModal({
                                                    kind: "deprecate",
                                                    entity: "practice",
                                                    id: practice.id,
                                                    label: practice.name,
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
                                                    practice.id
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
                                                    practice.id
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
                                      {editingPracticeId === practice.id ? (
                                        <form
                                          onSubmit={(e) =>
                                            void handleSaveEditPractice(e)
                                          }
                                          style={{
                                            marginTop: 10,
                                            marginLeft: 30,
                                            padding: "12px 14px",
                                            borderRadius: 8,
                                            backgroundColor: bg,
                                            border: `1px solid ${border}`,
                                            display: "grid",
                                            gap: 10,
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
                                            Edit practice
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
                                              value={editPracticeName}
                                              onChange={(e) =>
                                                setEditPracticeName(
                                                  e.target.value
                                                )
                                              }
                                              disabled={isSavingEditPractice}
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
                                              value={editPracticeDescription}
                                              onChange={(e) =>
                                                setEditPracticeDescription(
                                                  e.target.value
                                                )
                                              }
                                              disabled={isSavingEditPractice}
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
                                            Reference framework (optional)
                                            <input
                                              value={editPracticeReferenceFramework}
                                              onChange={(e) =>
                                                setEditPracticeReferenceFramework(
                                                  e.target.value
                                                )
                                              }
                                              disabled={isSavingEditPractice}
                                              placeholder="e.g. BABOK v3, Scrum Guide"
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
                                            }}
                                          >
                                            <button
                                              type="submit"
                                              disabled={isSavingEditPractice}
                                              style={btnPrimary}
                                            >
                                              {isSavingEditPractice
                                                ? "Saving…"
                                                : "Save"}
                                            </button>
                                            <button
                                              type="button"
                                              disabled={isSavingEditPractice}
                                              onClick={handleCancelEditPractice}
                                              style={btn}
                                            >
                                              Cancel
                                            </button>
                                          </div>
                                        </form>
                                      ) : null}
                                      <AccordionCollapsible
                                        open={practiceLensExpanded}
                                      >
                                        <div
                                          style={{
                                            paddingLeft: 30,
                                            paddingTop: 8,
                                          }}
                                        >
                                          {linkedSubjects.length === 0 ? (
                                            <p
                                              style={{
                                                margin: 0,
                                                fontSize: 13,
                                                color: mutedColor,
                                                lineHeight: 1.45,
                                              }}
                                            >
                                              No subjects linked yet
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
                                              {linkedSubjects.map((subj, idx) => {
                                                const n =
                                                  competencyCountBySubject.get(
                                                    subj.id
                                                  ) ?? 0;
                                                const removeKey = `${practice.id}::${subj.id}`;
                                                const removingThis =
                                                  removingSubjectFromPracticeKey ===
                                                  removeKey;
                                                const compsInPracticeContext =
                                                  filteredCompetencies
                                                    .filter(
                                                      (c) =>
                                                        c.subject_id ===
                                                          subj.id &&
                                                        competencyLinkedToPractice(
                                                          competencyPracticeLinks,
                                                          c.id,
                                                          practice.id,
                                                        ),
                                                    )
                                                    .sort((a, b) =>
                                                      a.name.localeCompare(
                                                        b.name,
                                                      ),
                                                    );
                                                return (
                                                  <li
                                                    key={subj.id}
                                                    style={{
                                                      padding: "10px 0",
                                                      borderTop:
                                                        idx === 0
                                                          ? "none"
                                                          : `1px solid ${borderSubtle}`,
                                                    }}
                                                  >
                                                    <div
                                                      style={{
                                                        display: "flex",
                                                        flexWrap: "wrap",
                                                        alignItems: "center",
                                                        justifyContent:
                                                          "space-between",
                                                        gap: "8px 12px",
                                                      }}
                                                    >
                                                      <div
                                                        style={{
                                                          display: "flex",
                                                          flexWrap: "wrap",
                                                          alignItems: "center",
                                                          gap: "6px 10px",
                                                          minWidth: 0,
                                                          flex: "1 1 200px",
                                                        }}
                                                      >
                                                        <span
                                                          style={{
                                                            fontWeight: 600,
                                                            fontSize: 14,
                                                            color: text,
                                                          }}
                                                        >
                                                          {subj.name.trim() ||
                                                            "Subject"}
                                                        </span>
                                                        <CompetencyTypeBadge
                                                          type={toCompetencyTypeUnion(
                                                            normalizeCompetencyType(
                                                              subj.type,
                                                            ),
                                                          )}
                                                        />
                                                        <span
                                                          style={{
                                                            fontSize: 13,
                                                            color: mutedColor,
                                                          }}
                                                        >
                                                          {n} in catalogue
                                                          {compsInPracticeContext.length >
                                                          0
                                                            ? ` · ${compsInPracticeContext.length} in this practice context`
                                                            : ""}
                                                        </span>
                                                      </div>
                                                      {canAuthorHierarchy ? (
                                                        <div
                                                          style={{
                                                            display: "flex",
                                                            flexWrap: "wrap",
                                                            gap: 6,
                                                            justifyContent: "flex-end",
                                                            alignItems: "center",
                                                          }}
                                                        >
                                                          <button
                                                            type="button"
                                                            disabled={
                                                              removingThis ||
                                                              addItemsApplying ||
                                                              manageItemsApplying
                                                            }
                                                            title="Add competencies from this subject into this practice context"
                                                            onClick={() =>
                                                              openPracticeAddItemsModal(
                                                                practice,
                                                                subj,
                                                              )
                                                            }
                                                            style={{
                                                              ...btnGhost,
                                                              flexShrink: 0,
                                                              fontSize: 12,
                                                            }}
                                                          >
                                                            Add items
                                                          </button>
                                                          <button
                                                            type="button"
                                                            disabled={
                                                              removingThis ||
                                                              addItemsApplying ||
                                                              manageItemsApplying
                                                            }
                                                            title="Choose which competencies under this subject apply in this practice"
                                                            onClick={() =>
                                                              openPracticeManageItemsModal(
                                                                practice,
                                                                subj,
                                                              )
                                                            }
                                                            style={{
                                                              ...btnGhost,
                                                              flexShrink: 0,
                                                              fontSize: 12,
                                                            }}
                                                          >
                                                            Manage items
                                                          </button>
                                                          <button
                                                            type="button"
                                                            disabled={
                                                              removingThis ||
                                                              addItemsApplying ||
                                                              manageItemsApplying
                                                            }
                                                            title="Remove this subject from this practice overlay"
                                                            onClick={() =>
                                                              openRemoveSubjectFromPracticeModal(
                                                                practice,
                                                                subj,
                                                              )
                                                            }
                                                            style={{
                                                              ...btnGhost,
                                                              flexShrink: 0,
                                                              fontSize: 12,
                                                            }}
                                                          >
                                                            {removingThis
                                                              ? "Removing…"
                                                              : "Remove from practice"}
                                                          </button>
                                                        </div>
                                                      ) : null}
                                                    </div>
                                                    {(() => {
                                                      const lines =
                                                        getSubjectProvenanceLines(
                                                          subj as CompetencySubjectWithProvenance,
                                                          capabilityAreas,
                                                        );
                                                      const items = [
                                                        lines.capabilityAreaLine,
                                                        lines.mappedFromLine,
                                                        lines.sourceFrameworkLine,
                                                      ].filter(Boolean) as string[];
                                                      if (items.length === 0)
                                                        return null;
                                                      return (
                                                        <div
                                                          style={{
                                                            marginTop: 6,
                                                            display: "flex",
                                                            flexDirection:
                                                              "column",
                                                            gap: 2,
                                                            paddingRight: 8,
                                                          }}
                                                        >
                                                          {items.map((line, i) => (
                                                            <div
                                                              key={`pl-${i}-${line.slice(0, 24)}`}
                                                              style={{
                                                                fontSize: 11,
                                                                color: mutedColor,
                                                                opacity: 0.9,
                                                                lineHeight: 1.35,
                                                              }}
                                                            >
                                                              {line}
                                                            </div>
                                                          ))}
                                                        </div>
                                                      );
                                                    })()}
                                                    {compsInPracticeContext.length ===
                                                    0 ? (
                                                      <p
                                                        style={{
                                                          margin: "6px 0 0",
                                                          fontSize: 12,
                                                          color: mutedColor,
                                                          lineHeight: 1.4,
                                                        }}
                                                      >
                                                        No competencies linked in
                                                        this practice context yet.
                                                      </p>
                                                    ) : (
                                                      <ul
                                                        style={{
                                                          margin: "8px 0 0",
                                                          padding: "0 0 0 14px",
                                                          listStyle: "disc",
                                                          fontSize: 12,
                                                          color: text,
                                                        }}
                                                      >
                                                        {compsInPracticeContext.map(
                                                          (c) => (
                                                            <li
                                                              key={c.id}
                                                              style={{
                                                                marginBottom: 2,
                                                              }}
                                                            >
                                                              {c.name.trim()}
                                                            </li>
                                                          ),
                                                        )}
                                                      </ul>
                                                    )}
                                                  </li>
                                                );
                                              })}
                                            </ul>
                                          )}
                                        </div>
                                      </AccordionCollapsible>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </>
                        )}
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
              Close matches in your catalogue
            </h3>
            <p style={{ ...muted, margin: "0 0 12px", fontSize: 13 }}>
              <strong style={{ color: text }}>
                {competencyDuplicateModal.pending.name}
              </strong>{" "}
              is a new name. This is not an exact duplicate, but these entries
              are similar — you may want to reuse one instead.
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
                    {competencyHierarchyLabel(
                      m,
                      subjects,
                      practices,
                      subjectPracticeLinks
                    )}
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
                Open existing
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
                Create new competency
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

      {competencyExactReuseModal ? (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="exact-reuse-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 90,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "24px 16px",
            overflow: "auto",
            backgroundColor: "rgba(0,0,0,0.6)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setCompetencyExactReuseModal(null);
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
            onClick={(ev) => ev.stopPropagation()}
          >
            <h3
              id="exact-reuse-title"
              style={{
                margin: "0 0 8px",
                fontSize: 17,
                fontWeight: 600,
                color: text,
              }}
            >
              Exact name already in use
            </h3>
            {competencyExactReuseModal.source === "manual" ? (
              <>
                <p style={{ ...muted, margin: "0 0 12px", fontSize: 13 }}>
                  A competency named{" "}
                  <strong style={{ color: text }}>
                    {competencyExactReuseModal.pendingName}
                  </strong>{" "}
                  already exists in this workspace. It is currently under{" "}
                  <strong style={{ color: text }}>
                    {competencyHierarchyLabel(
                      competencyExactReuseModal.existing,
                      subjects,
                      practices,
                      subjectPracticeLinks
                    )}
                  </strong>
                  . You can move it to the subject you selected, or keep
                  working without creating a duplicate.
                </p>
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
                    onClick={async () => {
                      const m = competencyExactReuseModal;
                      if (!m || m.source !== "manual") return;
                      const ok = await moveCompetencyToSubject(
                        m.existing.id,
                        m.targetSubjectId,
                        m.competencyTypeForTarget
                      );
                      if (ok) {
                        setCompetencyExactReuseModal(null);
                        setHighlightCompetencyId(m.existing.id);
                        handleCancelCreateCompetency();
                      }
                    }}
                    style={btnPrimary}
                  >
                    Move to this subject
                  </button>
                  <button
                    type="button"
                    onClick={() => setCompetencyExactReuseModal(null)}
                    style={btn}
                  >
                    Leave as-is
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCompetencyExactReuseModal(null);
                      handleCancelCreateCompetency();
                    }}
                    style={btnGhost}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <p style={{ ...muted, margin: "0 0 8px", fontSize: 13 }}>
                  <strong style={{ color: text }}>
                    {competencyExactReuseModal.current.name}
                  </strong>{" "}
                  already exists (exact name). It is currently under{" "}
                  <strong style={{ color: text }}>
                    {competencyHierarchyLabel(
                      competencyExactReuseModal.current.existing,
                      subjects,
                      practices,
                      subjectPracticeLinks
                    )}
                  </strong>
                  .
                </p>
                {competencyExactReuseModal.rest.length > 0 ? (
                  <p
                    style={{
                      margin: "0 0 12px",
                      fontSize: 12,
                      color: mutedColor,
                    }}
                  >
                    {competencyExactReuseModal.rest.length} more to review after
                    this one.
                  </p>
                ) : null}
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
                      const m = competencyExactReuseModal;
                      if (!m || m.source !== "ai") return;
                      void advanceAiExactReuseQueue(m, "skip", true);
                    }}
                    style={btn}
                  >
                    Keep at current subject
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const m = competencyExactReuseModal;
                      if (!m || m.source !== "ai") return;
                      const ok = await moveCompetencyToSubject(
                        m.current.existing.id,
                        m.targetSubjectId,
                        m.resolvedGenType
                      );
                      if (ok) void advanceAiExactReuseQueue(m, "move", true);
                    }}
                    style={btnPrimary}
                  >
                    Move to this subject
                  </button>
                  <button
                    type="button"
                    onClick={() => setCompetencyExactReuseModal(null)}
                    style={btnGhost}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {batchFromSubjectsOpen && batchFromSubjectsContext ? (
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
            if (
              e.target === e.currentTarget &&
              !batchFromSubjectsLoading &&
              !batchFromSubjectsApplying
            ) {
              closeBatchFromSubjectsModal();
            }
          }}
        >
          <div
            style={{
              ...panelShell,
              width: "100%",
              maxWidth: 640,
              marginTop: 32,
              maxHeight: "min(88vh, 800px)",
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
              Generate competencies from subjects
            </h3>
            <p
              style={{
                ...muted,
                margin: "0 0 12px",
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              This generates suggested competencies from the selected subjects.
              Nothing is saved until you apply.
            </p>
            <p style={{ ...muted, margin: "0 0 10px", fontSize: 13 }}>
              <span style={{ color: mutedColor }}>Capability area: </span>
              <strong style={{ color: text }}>
                {batchFromSubjectsContext.title.trim() || "—"}
              </strong>
            </p>
            {batchFromSubjectsReview === null ? (
              <>
                <label
                  style={{
                    display: "grid",
                    gap: 6,
                    fontSize: 13,
                    color: mutedColor,
                    marginBottom: 10,
                  }}
                >
                  Depth
                  <select
                    value={batchFromSubjectsDepth}
                    onChange={(e) =>
                      setBatchFromSubjectsDepth(
                        e.target.value as GenerateCompetenciesFromSubjectsDepth,
                      )
                    }
                    disabled={batchFromSubjectsLoading}
                    style={{
                      padding: "10px 12px",
                      fontSize: 15,
                      color: text,
                      backgroundColor: surface,
                      border: `1px solid ${border}`,
                      borderRadius: 8,
                    }}
                  >
                    <option value="light">Light (fewer suggestions)</option>
                    <option value="moderate">Moderate</option>
                    <option value="comprehensive">Comprehensive</option>
                  </select>
                </label>
                <p
                  style={{
                    margin: "0 0 10px",
                    fontSize: 12,
                    color: mutedColor,
                  }}
                >
                  Subjects included (
                  {
                    catalogueSubjectSectionsForBatchGen(
                      batchFromSubjectsContext,
                    ).length
                  }
                  ):
                </p>
                <ul
                  style={{
                    margin: "0 0 14px",
                    paddingLeft: 20,
                    fontSize: 13,
                    color: text,
                    maxHeight: 160,
                    overflow: "auto",
                  }}
                >
                  {catalogueSubjectSectionsForBatchGen(
                    batchFromSubjectsContext,
                  ).map((s) => (
                    <li key={s.key}>{s.title.trim() || "Subject"}</li>
                  ))}
                </ul>
                {batchFromSubjectsError ? (
                  <p style={{ fontSize: 13, color: errorColor, marginBottom: 10 }}>
                    {batchFromSubjectsError}
                  </p>
                ) : null}
                {companyProfileLoading ? (
                  <p style={{ ...muted, fontSize: 12, marginBottom: 10 }}>
                    Loading organisation profile for context…
                  </p>
                ) : null}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    disabled={batchFromSubjectsLoading || companyProfileLoading}
                    onClick={() => void handleGenerateBatchFromSubjectsPreview()}
                    style={btnPrimary}
                  >
                    {batchFromSubjectsLoading ? "Generating…" : "Generate suggestions"}
                  </button>
                  <button
                    type="button"
                    disabled={batchFromSubjectsLoading}
                    onClick={closeBatchFromSubjectsModal}
                    style={btn}
                  >
                    Cancel
                  </button>
                </div>
              </>
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
                  {batchFromSubjectsReview.map((g) => (
                    <div
                      key={g.subjectId}
                      style={{
                        marginBottom: 16,
                        paddingBottom: 12,
                        borderBottom: `1px solid ${borderSubtle}`,
                      }}
                    >
                      <label
                        style={{
                          display: "flex",
                          gap: 10,
                          alignItems: "flex-start",
                          fontSize: 14,
                          fontWeight: 600,
                          color: text,
                          marginBottom: 8,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={g.groupSelected}
                          onChange={(e) => {
                            const on = e.target.checked;
                            setBatchFromSubjectsReview((prev) =>
                              prev
                                ? prev.map((row) =>
                                    row.subjectId === g.subjectId
                                      ? {
                                          ...row,
                                          groupSelected: on,
                                          lines: row.lines.map((ln) => ({
                                            ...ln,
                                            selected: on,
                                          })),
                                        }
                                      : row,
                                  )
                                : prev,
                            );
                          }}
                        />
                        <span>{g.subjectName}</span>
                      </label>
                      {g.warning ? (
                        <p
                          style={{
                            margin: "0 0 8px",
                            paddingLeft: 28,
                            fontSize: 12,
                            color: g.lines.length === 0 ? errorColor : mutedColor,
                          }}
                        >
                          {g.warning}
                        </p>
                      ) : null}
                      {g.lines.map((line) => (
                        <label
                          key={line.key}
                          style={{
                            display: "flex",
                            gap: 10,
                            alignItems: "flex-start",
                            padding: "6px 0 6px 28px",
                            fontSize: 13,
                            color: text,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={line.selected}
                            disabled={!g.groupSelected}
                            onChange={(e) => {
                              const on = e.target.checked;
                              setBatchFromSubjectsReview((prev) =>
                                prev
                                  ? prev.map((row) =>
                                      row.subjectId === g.subjectId
                                        ? {
                                            ...row,
                                            lines: row.lines.map((ln) =>
                                              ln.key === line.key
                                                ? { ...ln, selected: on }
                                                : ln,
                                            ),
                                          }
                                        : row,
                                    )
                                  : prev,
                              );
                            }}
                          />
                          <span>{line.label}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
                {batchFromSubjectsError ? (
                  <p style={{ fontSize: 13, color: errorColor, marginBottom: 10 }}>
                    {batchFromSubjectsError}
                  </p>
                ) : null}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    disabled={batchFromSubjectsApplying}
                    onClick={() => void handleApplyBatchFromSubjects()}
                    style={btnPrimary}
                  >
                    {batchFromSubjectsApplying ? "Applying…" : "Apply selected"}
                  </button>
                  <button
                    type="button"
                    disabled={batchFromSubjectsApplying}
                    onClick={() => {
                      setBatchFromSubjectsReview(null);
                      setBatchFromSubjectsError(null);
                    }}
                    style={btnSecondary}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={batchFromSubjectsApplying}
                    onClick={closeBatchFromSubjectsModal}
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

      {subjectNormModalOpen ? (
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
            if (
              e.target === e.currentTarget &&
              !subjectNormLoading &&
              !subjectNormApplying
            ) {
              closeSubjectNormalisationModal();
            }
          }}
        >
          <div
            style={{
              ...panelShell,
              width: "100%",
              maxWidth: 640,
              marginTop: 32,
              maxHeight: "min(88vh, 820px)",
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
              Refine subject names
            </h3>
            <p
              style={{
                ...muted,
                margin: "0 0 10px",
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              This is a review step to improve naming consistency and reduce
              overlap across capability areas. The model may suggest renames,
              moves, and merges. Nothing changes until you apply.
            </p>
            {subjectNormPhase === "setup" ? (
              <>
                {subjectNormRunStats ? (
                  <p style={{ fontSize: 13, color: text, margin: "0 0 12px" }}>
                    <strong>{subjectNormRunStats.areaCount}</strong> capability
                    area{subjectNormRunStats.areaCount === 1 ? "" : "s"} ·{" "}
                    <strong>{subjectNormRunStats.subjectCount}</strong> subject
                    {subjectNormRunStats.subjectCount === 1 ? "" : "s"} (assigned
                    areas only; unassigned bucket excluded).
                  </p>
                ) : null}
                {companyProfileLoading ? (
                  <p style={{ ...muted, fontSize: 12, marginBottom: 10 }}>
                    Loading organisation profile for context…
                  </p>
                ) : null}
                {subjectNormError ? (
                  <p style={{ fontSize: 13, color: errorColor, marginBottom: 10 }}>
                    {subjectNormError}
                  </p>
                ) : null}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    disabled={subjectNormLoading || companyProfileLoading}
                    onClick={() => void handleRunSubjectNormalisationReview()}
                    style={btnPrimary}
                  >
                    {subjectNormLoading ? "Running…" : "Run review"}
                  </button>
                  <button
                    type="button"
                    disabled={subjectNormLoading}
                    onClick={closeSubjectNormalisationModal}
                    style={btn}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : subjectNormPhase === "complete" ? (
              <>
                <p style={{ fontSize: 13, color: text, marginBottom: 10 }}>
                  {subjectNormCompleteSummary
                    ? subjectNormCompleteSummary.updated > 0
                      ? `Applied safe updates to ${subjectNormCompleteSummary.updated} subject(s).`
                      : "No subject rows were changed by the last apply."
                    : "Updates applied."}
                </p>
                {(() => {
                  const mc = subjectNormResult?.notes.merges?.length ?? 0;
                  if (mc === 0) return null;
                  return (
                    <>
                      <p
                        style={{
                          fontSize: 13,
                          color: text,
                          marginBottom: 12,
                          lineHeight: 1.45,
                        }}
                      >
                        There {mc === 1 ? "is" : "are"} <strong>{mc}</strong>{" "}
                        merge group{mc === 1 ? "" : "s"} ready to resolve. Use the
                        guided flow to pick a survivor; victims are deprecated, not
                        deleted.
                      </p>
                      {subjectNormCompleteSummary &&
                      subjectNormCompleteSummary.mergeVictimsWithCompetencies > 0 ? (
                        <p
                          style={{
                            fontSize: 12,
                            color: errorColor,
                            marginBottom: 12,
                            lineHeight: 1.45,
                          }}
                        >
                          {subjectNormCompleteSummary.mergeVictimsWithCompetencies}{" "}
                          merge participant(s) still had competencies — the merge
                          workflow will reassign them when you apply merges.
                        </p>
                      ) : null}
                    </>
                  );
                })()}
                <p
                  style={{
                    ...muted,
                    fontSize: 12,
                    marginBottom: 12,
                    lineHeight: 1.45,
                  }}
                >
                  Duplicate competencies under the survivor are skipped (one copy kept).
                  Practice relevance from victims is merged onto the survivor where
                  possible. Nothing else changes until you confirm in the merge dialog.
                </p>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    disabled={pendingMergeSuggestionCount === 0}
                    onClick={() => {
                      if (pendingMergeSuggestionCount > 0) {
                        setSubjectMergeModalOpen(true);
                        closeSubjectNormalisationModal();
                      }
                    }}
                    style={btnPrimary}
                  >
                    Resolve merges now
                  </button>
                  <button
                    type="button"
                    onClick={closeSubjectNormalisationModal}
                    style={btnSecondary}
                  >
                    Later
                  </button>
                </div>
              </>
            ) : (
              <>
                {(() => {
                  const normSkip = subjectNormResult
                    ? analyseSubjectMergeSkipIds(
                        subjectNormResult,
                        subjects,
                        capabilityAreas,
                        competencyCountBySubject,
                      )
                    : null;
                  const normHasEdits = subjectNormResult && normSkip
                    ? normalisationHasSuggestedEdits(
                        subjectNormResult,
                        subjects,
                        capabilityAreas,
                        normSkip.skipSubjectIds,
                      )
                    : false;
                  const normHasNotes = subjectNormResult
                    ? normalisationHasNotes(subjectNormResult)
                    : false;
                  const n = subjectNormResult?.notes;
                  const mergeN = n?.merges?.length ?? 0;
                  const renameN = n?.renames?.length ?? 0;
                  const moveN = n?.moves?.length ?? 0;
                  const preservedN = n?.preservedDistinctions?.length ?? 0;
                  const hasNoteAction =
                    mergeN > 0 || renameN > 0 || moveN > 0;
                  const hasNoActionableOutcome =
                    !hasNoteAction && !normHasEdits;
                  const showReviewedStructure =
                    subjectNormShowReviewedStructure ||
                    hasNoteAction ||
                    normHasEdits;
                  return (
                    <>
                      {subjectNormError ? (
                        <p
                          style={{
                            fontSize: 13,
                            color: errorColor,
                            marginBottom: 10,
                          }}
                        >
                          {subjectNormError}
                        </p>
                      ) : null}
                      <div
                        style={{
                          marginBottom: 12,
                          padding: "10px 12px",
                          borderRadius: 8,
                          border: `1px solid ${borderSubtle}`,
                          backgroundColor: surface,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: text,
                            marginBottom: 8,
                          }}
                        >
                          Review summary (actionable items)
                        </div>
                        <ul
                          style={{
                            margin: 0,
                            paddingLeft: 18,
                            fontSize: 13,
                            color: mutedColor,
                            lineHeight: 1.55,
                          }}
                        >
                          <li>
                            Renames: <strong style={{ color: text }}>{renameN}</strong>
                          </li>
                          <li>
                            Moves: <strong style={{ color: text }}>{moveN}</strong>
                          </li>
                          <li>
                            Merges: <strong style={{ color: text }}>{mergeN}</strong>
                          </li>
                          <li>
                            Preserved distinctions:{" "}
                            <strong style={{ color: text }}>{preservedN}</strong>
                          </li>
                        </ul>
                      </div>
                      {hasNoActionableOutcome ? (
                        <>
                          <p
                            style={{
                              fontSize: 14,
                              fontWeight: 600,
                              color: text,
                              margin: "0 0 8px",
                            }}
                          >
                            No naming changes were suggested.
                          </p>
                          <p
                            style={{
                              fontSize: 13,
                              color: mutedColor,
                              margin: "0 0 12px",
                              lineHeight: 1.45,
                            }}
                          >
                            {preservedN > 0
                              ? "The review only recorded preserved distinctions (see counts above). There are no renames, moves, or merges to apply."
                              : "You can close this dialog or run again after editing subjects."}
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              setSubjectNormShowReviewedStructure(
                                (v) => !v,
                              )
                            }
                            style={btnGhost}
                          >
                            {subjectNormShowReviewedStructure
                              ? "Hide reviewed subject structure"
                              : "Show reviewed subject structure"}
                          </button>
                        </>
                      ) : null}
                      {(normSkip?.mergeSuggestionCount ?? 0) > 0 ? (
                        <p
                          style={{
                            fontSize: 12,
                            color:
                              (normSkip?.mergeVictimsWithCompetencies.length ??
                                0) > 0
                                ? errorColor
                                : mutedColor,
                            marginBottom: 12,
                            marginTop: hasNoActionableOutcome ? 12 : 0,
                            lineHeight: 1.45,
                          }}
                        >
                          Merge suggestions are detailed below when structure is
                          visible. “Apply safe updates” skips merge participants;
                          use “Resolve subject merges” in the toolbar (count in
                          label) to consolidate duplicates safely.
                        </p>
                      ) : null}
                      {showReviewedStructure ? (
                        <div
                          style={{
                            overflow: "auto",
                            flex: 1,
                            minHeight: 0,
                            marginBottom: 12,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              color: mutedColor,
                              marginBottom: 8,
                            }}
                          >
                            Proposed subject lists
                          </div>
                          {subjectNormResult?.capabilityAreas.map((area) => (
                            <div
                              key={`${area.capabilityAreaId ?? ""}-${area.capabilityAreaName}`}
                              style={{
                                marginBottom: 14,
                                paddingBottom: 12,
                                borderBottom: `1px solid ${borderSubtle}`,
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 14,
                                  fontWeight: 600,
                                  color: text,
                                  marginBottom: 6,
                                }}
                              >
                                {area.capabilityAreaName}
                              </div>
                              {area.subjects.length === 0 ? (
                                <p
                                  style={{
                                    fontSize: 12,
                                    color: mutedColor,
                                    margin: 0,
                                  }}
                                >
                                  (no subjects)
                                </p>
                              ) : (
                                <ul
                                  style={{
                                    margin: 0,
                                    paddingLeft: 18,
                                    fontSize: 13,
                                    color: text,
                                  }}
                                >
                                  {area.subjects.map((s) => (
                                    <li key={`${s.subjectId ?? "new"}-${s.name}`}>
                                      {s.name}
                                      {s.subjectId &&
                                      normSkip?.skipSubjectIds.has(s.subjectId)
                                        ? " — (merge participant: apply skipped)"
                                        : null}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ))}
                          {normHasNotes && subjectNormResult ? (
                            <div style={{ marginTop: 16 }}>
                              <div
                                style={{
                                  fontSize: 12,
                                  fontWeight: 600,
                                  color: mutedColor,
                                  marginBottom: 8,
                                }}
                              >
                                Governance notes
                              </div>
                              {(subjectNormResult.notes.merges?.length ?? 0) >
                              0 ? (
                                <div style={{ marginBottom: 12 }}>
                                  <div
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 600,
                                      color: text,
                                      marginBottom: 4,
                                    }}
                                  >
                                    Merges
                                  </div>
                                  <ul
                                    style={{
                                      margin: 0,
                                      paddingLeft: 18,
                                      fontSize: 12,
                                      color: mutedColor,
                                    }}
                                  >
                                    {subjectNormResult.notes.merges.map(
                                      (m, i) => (
                                        <li key={`m-${i}`}>
                                          {m.capabilityAreaName}:{" "}
                                          {(m.from ?? []).join(", ")} → {m.to}
                                        </li>
                                      ),
                                    )}
                                  </ul>
                                </div>
                              ) : null}
                              {(subjectNormResult.notes.renames?.length ?? 0) >
                              0 ? (
                                <div style={{ marginBottom: 12 }}>
                                  <div
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 600,
                                      color: text,
                                      marginBottom: 4,
                                    }}
                                  >
                                    Renames
                                  </div>
                                  <ul
                                    style={{
                                      margin: 0,
                                      paddingLeft: 18,
                                      fontSize: 12,
                                      color: mutedColor,
                                    }}
                                  >
                                    {subjectNormResult.notes.renames.map(
                                      (r, i) => (
                                        <li key={`r-${i}`}>
                                          {r.capabilityAreaName}: {r.from} →{" "}
                                          {r.to}
                                        </li>
                                      ),
                                    )}
                                  </ul>
                                </div>
                              ) : null}
                              {(subjectNormResult.notes.moves?.length ?? 0) >
                              0 ? (
                                <div style={{ marginBottom: 12 }}>
                                  <div
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 600,
                                      color: text,
                                      marginBottom: 4,
                                    }}
                                  >
                                    Moves
                                  </div>
                                  <ul
                                    style={{
                                      margin: 0,
                                      paddingLeft: 18,
                                      fontSize: 12,
                                      color: mutedColor,
                                    }}
                                  >
                                    {subjectNormResult.notes.moves.map(
                                      (mv, i) => (
                                        <li key={`mv-${i}`}>
                                          {mv.subjectName}: {mv.fromArea} →{" "}
                                          {mv.toArea}
                                          {mv.reason ? ` — ${mv.reason}` : ""}
                                        </li>
                                      ),
                                    )}
                                  </ul>
                                </div>
                              ) : null}
                              {(subjectNormResult.notes.preservedDistinctions
                                ?.length ?? 0) > 0 ? (
                                <div style={{ marginBottom: 12 }}>
                                  <div
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 600,
                                      color: text,
                                      marginBottom: 4,
                                    }}
                                  >
                                    Preserved distinctions
                                  </div>
                                  <ul
                                    style={{
                                      margin: 0,
                                      paddingLeft: 18,
                                      fontSize: 12,
                                      color: mutedColor,
                                    }}
                                  >
                                    {subjectNormResult.notes.preservedDistinctions.map(
                                      (p, i) => (
                                        <li key={`p-${i}`}>{p}</li>
                                      ),
                                    )}
                                  </ul>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  );
                })()}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    disabled={
                      subjectNormApplying ||
                      !subjectNormResult ||
                      !normalisationHasSuggestedEdits(
                        subjectNormResult,
                        subjects,
                        capabilityAreas,
                        analyseSubjectMergeSkipIds(
                          subjectNormResult,
                          subjects,
                          capabilityAreas,
                          competencyCountBySubject,
                        ).skipSubjectIds,
                      )
                    }
                    onClick={() => void handleApplySubjectNormalisation()}
                    style={btnPrimary}
                  >
                    {subjectNormApplying ? "Applying…" : "Apply safe updates"}
                  </button>
                  <button
                    type="button"
                    disabled={subjectNormApplying}
                    onClick={() => {
                      setSubjectNormPhase("setup");
                      setSubjectNormResult(null);
                      setSubjectNormError(null);
                      setSubjectNormShowReviewedStructure(false);
                    }}
                    style={btnSecondary}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={subjectNormApplying}
                    onClick={closeSubjectNormalisationModal}
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

      {subjectMergeModalOpen &&
      (pendingSubjectMergeContext || subjectMergeApplySummary) ? (
        <div
          role="dialog"
          aria-modal
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 87,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "24px 16px",
            overflow: "auto",
            backgroundColor: "rgba(0,0,0,0.6)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !subjectMergeApplying) {
              closeSubjectMergeModal();
            }
          }}
        >
          <div
            style={{
              ...panelShell,
              width: "100%",
              maxWidth: 720,
              marginTop: 28,
              maxHeight: "min(90vh, 900px)",
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
              Resolve subject merges
            </h3>
            {!pendingSubjectMergeContext && subjectMergeApplySummary ? (
              <p style={{ fontSize: 13, color: text, marginBottom: 12 }}>
                Merge run finished. Review the summary below, then close this dialog.
              </p>
            ) : (
            <p style={{ ...muted, margin: "0 0 10px", fontSize: 13, lineHeight: 1.45 }}>
              Suggestions come from the latest “Refine subject names” review (
              <code style={{ fontSize: 12 }}>notes.merges</code>). Competencies move
              to the surviving subject; duplicate names on the survivor are skipped;
              merge victims are <strong>deprecated</strong> with{" "}
              <code style={{ fontSize: 12 }}>replaced_by_id</code> — nothing is hard
              deleted. Changes apply only when you click Apply merges.
            </p>
            )}
            <div
              style={{
                overflow: "auto",
                flex: 1,
                minHeight: 0,
                marginBottom: 12,
              }}
            >
              {pendingSubjectMergeContext
                ? subjectMergeResolvedGroups.map((g, gi) => {
                const dec = subjectMergeDecisions[gi];
                const activePickOptions = g.members.filter((m) =>
                  isAssignableLifecycleStatus(m.status),
                );
                return (
                  <div
                    key={`merge-${g.mergeIndex}-${g.areaName}`}
                    style={{
                      marginBottom: 16,
                      paddingBottom: 14,
                      borderBottom: `1px solid ${borderSubtle}`,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: text,
                        marginBottom: 6,
                      }}
                    >
                      {g.areaName}
                      {g.recommendedSurvivorName ? (
                        <span style={{ ...muted, fontWeight: 400, fontSize: 12 }}>
                          {" "}
                          — suggested survivor name: {g.recommendedSurvivorName}
                        </span>
                      ) : null}
                    </div>
                    {g.blockedReason ? (
                      <p
                        style={{
                          fontSize: 12,
                          color: errorColor,
                          margin: "0 0 8px",
                          lineHeight: 1.45,
                        }}
                      >
                        {g.blockedReason}
                      </p>
                    ) : g.recommendedSurvivorId &&
                      !g.members.some(
                        (m) =>
                          m.id === g.recommendedSurvivorId &&
                          isAssignableLifecycleStatus(m.status),
                      ) ? (
                      <p
                        style={{
                          fontSize: 12,
                          color: mutedColor,
                          margin: "0 0 8px",
                          lineHeight: 1.45,
                        }}
                      >
                        The recommended survivor from the review is not active in
                        the catalogue — choose a different survivor below.
                      </p>
                    ) : null}
                    <div style={{ fontSize: 12, color: mutedColor, marginBottom: 8 }}>
                      Subjects in this group
                    </div>
                    <ul
                      style={{
                        margin: "0 0 10px",
                        paddingLeft: 18,
                        fontSize: 13,
                        color: text,
                      }}
                    >
                      {g.members.map((m) => (
                        <li key={m.id}>
                          {m.name}
                          <span style={{ ...muted, fontSize: 12 }}>
                            {" "}
                            — {m.competencyCount} competency
                            {m.competencyCount === 1 ? "" : "ies"}
                            {m.practiceLinkCount > 0
                              ? ` · ${m.practiceLinkCount} practice link${
                                  m.practiceLinkCount === 1 ? "" : "s"
                                }`
                              : ""}
                            {m.isRecommendedSurvivor ? " · recommended survivor" : ""}
                            {m.status !== "active" ? ` · ${m.status}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {dec ? (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                          fontSize: 13,
                          color: text,
                        }}
                      >
                        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <input
                            type="radio"
                            name={`merge-dec-${gi}`}
                            checked={dec.mode === "recommended"}
                            disabled={
                              !g.recommendedSurvivorId ||
                              !!g.blockedReason ||
                              !g.members.some(
                                (m) =>
                                  m.id === g.recommendedSurvivorId &&
                                  isAssignableLifecycleStatus(m.status),
                              )
                            }
                            onChange={() => {
                              setSubjectMergeDecisions((prev) => {
                                const next = [...prev];
                                next[gi] = {
                                  ...next[gi]!,
                                  mode: "recommended",
                                  survivorId: g.recommendedSurvivorId,
                                };
                                return next;
                              });
                            }}
                          />
                          Accept recommended survivor
                        </label>
                                               <label style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <input
                            type="radio"
                            name={`merge-dec-${gi}`}
                            checked={dec.mode === "pick"}
                            disabled={!!g.blockedReason || activePickOptions.length < 2}
                            onChange={() => {
                              setSubjectMergeDecisions((prev) => {
                                const next = [...prev];
                                const fallback =
                                  activePickOptions.find((m) => m.id === dec.survivorId)
                                    ?.id ??
                                  activePickOptions[0]?.id ??
                                  null;
                                next[gi] = {
                                  ...next[gi]!,
                                  mode: "pick",
                                  survivorId: fallback,
                                };
                                return next;
                              });
                            }}
                          />
                          Choose survivor
                          {dec.mode === "pick" && activePickOptions.length > 0 ? (
                            <select
                              value={dec.survivorId ?? ""}
                              onChange={(e) => {
                                const v = e.target.value.trim() || null;
                                setSubjectMergeDecisions((prev) => {
                                  const next = [...prev];
                                  next[gi] = { ...next[gi]!, survivorId: v };
                                  return next;
                                });
                              }}
                              style={{
                                marginLeft: 8,
                                padding: "6px 8px",
                                fontSize: 13,
                                color: text,
                                backgroundColor: surface,
                                border: `1px solid ${border}`,
                                borderRadius: 8,
                                maxWidth: 280,
                              }}
                            >
                              {activePickOptions.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name}
                                </option>
                              ))}
                            </select>
                          ) : null}
                        </label>
                        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <input
                            type="radio"
                            name={`merge-dec-${gi}`}
                            checked={dec.mode === "skip"}
                            onChange={() => {
                              setSubjectMergeDecisions((prev) => {
                                const next = [...prev];
                                next[gi] = { ...next[gi]!, mode: "skip" };
                                return next;
                              });
                            }}
                          />
                          Keep separate (skip this merge)
                        </label>
                        <label
                          style={{
                            display: "grid",
                            gap: 4,
                            fontSize: 12,
                            color: mutedColor,
                          }}
                        >
                          Optional: rename survivor before apply
                          <input
                            value={dec.survivorRename}
                            onChange={(e) => {
                              const v = e.target.value;
                              setSubjectMergeDecisions((prev) => {
                                const next = [...prev];
                                next[gi] = { ...next[gi]!, survivorRename: v };
                                return next;
                              });
                            }}
                            disabled={dec.mode === "skip" || !!g.blockedReason}
                            placeholder="Leave blank to keep current name"
                            style={{
                              padding: "8px 10px",
                              fontSize: 14,
                              color: text,
                              backgroundColor: bg,
                              border: `1px solid ${border}`,
                              borderRadius: 8,
                            }}
                          />
                        </label>
                      </div>
                    ) : null}
                  </div>
                );
              })
                : null}
            </div>
            {subjectMergeApplySummary ? (
              <div
                style={{
                  marginBottom: 12,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${borderSubtle}`,
                  backgroundColor: surface,
                  fontSize: 13,
                  color: text,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Results</div>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 18,
                    fontSize: 12,
                    color: mutedColor,
                    lineHeight: 1.5,
                  }}
                >
                  <li>Merges completed: {subjectMergeApplySummary.mergesCompleted}</li>
                  <li>Competencies moved: {subjectMergeApplySummary.competenciesMoved}</li>
                  <li>
                    Duplicate competencies skipped:{" "}
                    {subjectMergeApplySummary.duplicatesSkipped}
                  </li>
                  <li>
                    Duplicate competencies deprecated:{" "}
                    {subjectMergeApplySummary.duplicateCompetenciesDeprecated}
                  </li>
                  <li>
                    Subjects deprecated: {subjectMergeApplySummary.subjectsDeprecated}
                  </li>
                  <li>Merges skipped: {subjectMergeApplySummary.mergesSkipped}</li>
                </ul>
                {subjectMergeApplySummary.warnings.length > 0 ? (
                  <div style={{ marginTop: 8, fontSize: 12, color: errorColor }}>
                    {subjectMergeApplySummary.warnings.slice(0, 6).map((w, i) => (
                      <div key={`mw-${i}`}>{w}</div>
                    ))}
                    {subjectMergeApplySummary.warnings.length > 6 ? (
                      <div>…</div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {pendingSubjectMergeContext ? (
                <button
                  type="button"
                  disabled={
                    subjectMergeApplying ||
                    subjectMergeDecisions.length !==
                      subjectMergeResolvedGroups.length ||
                    subjectMergeResolvedGroups.length === 0 ||
                    subjectMergeResolvedGroups.every(
                      (gr, idx) =>
                        !!gr.blockedReason ||
                        subjectMergeDecisions[idx]?.mode === "skip",
                    )
                  }
                  onClick={() => void handleApplySubjectMerges()}
                  style={btnPrimary}
                >
                  {subjectMergeApplying ? "Applying…" : "Apply merges"}
                </button>
              ) : null}
              <button
                type="button"
                disabled={subjectMergeApplying}
                onClick={closeSubjectMergeModal}
                style={btn}
              >
                Close
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
            <p
              style={{
                ...muted,
                margin: "0 0 10px",
                fontSize: 12,
                lineHeight: 1.45,
              }}
            >
              {SUBJECT_PRACTICE_CONTEXT_HINT}
            </p>
            <p style={{ ...muted, margin: "0 0 12px", fontSize: 13 }}>
              <span style={{ color: mutedColor }}>Context: </span>
              {subjectGenSubjectType === "organisation" ? (
                <>
                  Organisation:{" "}
                  <strong style={{ color: text }}>
                    {companyProfile?.organisation_name?.trim() ||
                      "This workspace"}
                  </strong>
                  {companyProfile?.industry?.trim() ? (
                    <span style={{ color: mutedColor }}>
                      {" "}
                      (Industry: {companyProfile.industry.trim()})
                    </span>
                  ) : null}
                </>
              ) : subjectGenCatalogueContext ? (
                <>
                  Capability area:{" "}
                  <strong style={{ color: text }}>
                    {subjectGenContext.title.trim() || "—"}
                  </strong>
                  {subjectGenSubjectType === "practice" ? (
                    <>
                      {" "}
                      {subjectGenPracticePickId.trim() ? (
                        <span style={{ color: mutedColor }}>
                          · Practice context:{" "}
                          <strong style={{ color: text }}>
                            {practices.find(
                              (p) => p.id === subjectGenPracticePickId
                            )?.name?.trim() || "Practice"}
                          </strong>
                        </span>
                      ) : (
                        <span style={{ color: mutedColor }}>
                          {" "}
                          — optional: practice for AI context below (guides
                          suggestions only)
                        </span>
                      )}
                    </>
                  ) : null}
                </>
              ) : subjectGenContext.key === PRACTICE_SUBJECTS_ROOT_KEY ? (
                <>
                  <span style={{ color: text, fontWeight: 600 }}>
                    Subjects relevant to this practice
                  </span>
                  {subjectGenPracticePickId.trim() ? (
                    <>
                      {" "}
                      —{" "}
                      <strong style={{ color: text }}>
                        {practices.find((p) => p.id === subjectGenPracticePickId)
                          ?.name?.trim() || "Practice"}
                      </strong>
                    </>
                  ) : (
                    <span style={{ color: mutedColor }}>
                      {" "}
                      — choose practice for AI context below (optional)
                    </span>
                  )}
                </>
              ) : (
                <strong style={{ color: text }}>
                  {subjectGenContext.title.trim()
                    ? subjectGenContext.title
                    : "—"}
                </strong>
              )}
            </p>
            {(subjectGenContext.key === PRACTICE_SUBJECTS_ROOT_KEY ||
              subjectGenCatalogueContext) &&
            subjectGenSubjectType === "practice" ? (
              <label
                style={{
                  display: "grid",
                  gap: 6,
                  fontSize: 13,
                  color: mutedColor,
                  marginBottom: 12,
                }}
              >
                Practice for AI context (optional)
                <select
                  value={subjectGenPracticePickId}
                  onChange={(e) =>
                    setSubjectGenPracticePickId(e.target.value)
                  }
                  disabled={subjectGenLoading || subjectGenAccepting}
                  style={{
                    padding: "10px 12px",
                    fontSize: 15,
                    color: text,
                    backgroundColor: surface,
                    border: `1px solid ${border}`,
                    borderRadius: 8,
                  }}
                >
                  <option value="">Choose a practice…</option>
                  {assignablePractices.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <span
                  style={{
                    fontSize: 12,
                    lineHeight: 1.45,
                    color: mutedColor,
                    fontWeight: 400,
                  }}
                >
                  Used as context to guide suggestions — not a structural
                  parent.
                </span>
              </label>
            ) : null}
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
                <p
                  style={{
                    margin: "0 0 10px",
                    fontSize: 12,
                    color: mutedColor,
                    lineHeight: 1.45,
                  }}
                >
                  {SUBJECT_PRACTICE_CONTEXT_HINT} Suggestions are matched to
                  your catalogue (exact first, then close). Defaults favour reuse;
                  change the option if you need a new subject row.
                </p>
                <div
                  style={{
                    overflow: "auto",
                    flex: 1,
                    minHeight: 0,
                    marginBottom: 12,
                  }}
                >
                  {subjectGenRows.map((row) => {
                    const canUseCatalogue = Boolean(row.existingSubjectId);
                    const orgSubjectGenFlow =
                      normalizeCompetencyType(subjectGenSubjectType) ===
                      "organisation";
                    return (
                      <div
                        key={row.id}
                        style={{
                          padding: "10px 0",
                          borderBottom: `1px solid ${border}`,
                          fontSize: 13,
                          color: text,
                        }}
                      >
                        <label
                          style={{
                            display: "flex",
                            gap: 10,
                            alignItems: "flex-start",
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={row.selected}
                            disabled={subjectGenAccepting}
                            onChange={(e) => {
                              const on = e.target.checked;
                              setSubjectGenRows((prev) =>
                                prev.map((r) =>
                                  r.id === row.id ? { ...r, selected: on } : r
                                )
                              );
                            }}
                            style={{ marginTop: 3 }}
                          />
                          <span style={{ flex: 1 }}>
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
                            {row.similarHint ? (
                              <span
                                style={{
                                  display: "block",
                                  marginTop: 6,
                                  fontSize: 11,
                                  color: mutedColor,
                                  lineHeight: 1.45,
                                }}
                              >
                                {row.similarHint}
                              </span>
                            ) : null}
                            <div
                              role="radiogroup"
                              aria-label={`Apply ${row.name}`}
                              style={{
                                marginTop: 8,
                                display: "flex",
                                flexDirection: "column",
                                gap: 6,
                              }}
                            >
                              <label
                                style={{
                                  display: "flex",
                                  alignItems: "flex-start",
                                  gap: 8,
                                  fontSize: 12,
                                  color: text,
                                  cursor:
                                    subjectGenAccepting || !canUseCatalogue
                                      ? "not-allowed"
                                      : "pointer",
                                  opacity:
                                    canUseCatalogue && !subjectGenAccepting
                                      ? 1
                                      : 0.45,
                                }}
                              >
                                <input
                                  type="radio"
                                  name={`sgen-${row.id}`}
                                  checked={row.mode === "use_existing"}
                                  disabled={
                                    subjectGenAccepting || !canUseCatalogue
                                  }
                                  onChange={() =>
                                    setSubjectGenRows((prev) =>
                                      prev.map((r) =>
                                        r.id === row.id
                                          ? { ...r, mode: "use_existing" }
                                          : r
                                      )
                                    )
                                  }
                                  style={{ marginTop: 2 }}
                                />
                                <span>
                                  Use existing subject (no change to practice
                                  context)
                                </span>
                              </label>
                              {!orgSubjectGenFlow ? (
                                <label
                                  style={{
                                    display: "flex",
                                    alignItems: "flex-start",
                                    gap: 8,
                                    fontSize: 12,
                                    color: text,
                                    cursor:
                                      subjectGenAccepting || !canUseCatalogue
                                        ? "not-allowed"
                                        : "pointer",
                                    opacity:
                                      canUseCatalogue && !subjectGenAccepting
                                        ? 1
                                        : 0.45,
                                  }}
                                >
                                  <input
                                    type="radio"
                                    name={`sgen-${row.id}`}
                                    checked={row.mode === "use_and_link"}
                                    disabled={
                                      subjectGenAccepting || !canUseCatalogue
                                    }
                                    onChange={() =>
                                      setSubjectGenRows((prev) =>
                                        prev.map((r) =>
                                          r.id === row.id
                                            ? { ...r, mode: "use_and_link" }
                                            : r
                                        )
                                      )
                                    }
                                    style={{ marginTop: 2 }}
                                  />
                                  <span>
                                    Use and link to this practice context
                                    (relevant)
                                  </span>
                                </label>
                              ) : null}
                              <label
                                style={{
                                  display: "flex",
                                  alignItems: "flex-start",
                                  gap: 8,
                                  fontSize: 12,
                                  color: text,
                                  cursor: subjectGenAccepting
                                    ? "not-allowed"
                                    : "pointer",
                                  opacity: subjectGenAccepting ? 0.45 : 1,
                                }}
                              >
                                <input
                                  type="radio"
                                  name={`sgen-${row.id}`}
                                  checked={row.mode === "create_new"}
                                  disabled={subjectGenAccepting}
                                  onChange={() =>
                                    setSubjectGenRows((prev) =>
                                      prev.map((r) =>
                                        r.id === row.id
                                          ? { ...r, mode: "create_new" }
                                          : r
                                      )
                                    )
                                  }
                                  style={{ marginTop: 2 }}
                                />
                                <span>Create new subject</span>
                              </label>
                            </div>
                          </span>
                        </label>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    disabled={subjectGenAccepting}
                    onClick={() => void handleAcceptSubjectGenerated()}
                    style={btnPrimary}
                  >
                    {subjectGenAccepting ? "Saving…" : "Apply selected"}
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

      {capabilityAreaEditModal ? (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="cap-area-edit-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 87,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "24px 16px",
            overflow: "auto",
            backgroundColor: "rgba(0,0,0,0.6)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !isSavingCapabilityAreaEdit) {
              closeCapabilityAreaEditModal();
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
              id="cap-area-edit-title"
              style={{
                margin: "0 0 8px",
                fontSize: 17,
                fontWeight: 600,
                color: text,
              }}
            >
              Edit capability area
            </h3>
            <form
              onSubmit={(e) => void handleSaveEditCapabilityArea(e)}
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
                Name
                <input
                  required
                  value={editCapabilityAreaName}
                  onChange={(e) =>
                    setEditCapabilityAreaName(e.target.value)
                  }
                  disabled={isSavingCapabilityAreaEdit}
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
                  value={editCapabilityAreaDescription}
                  onChange={(e) =>
                    setEditCapabilityAreaDescription(e.target.value)
                  }
                  disabled={isSavingCapabilityAreaEdit}
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
                  disabled={isSavingCapabilityAreaEdit}
                  style={btnPrimary}
                >
                  {isSavingCapabilityAreaEdit ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  disabled={isSavingCapabilityAreaEdit}
                  onClick={closeCapabilityAreaEditModal}
                  style={btn}
                >
                  Cancel
                </button>
              </div>
            </form>
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

      {bulkAssignCompetencyModalOpen ? (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="bulk-assign-comp-title"
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
            if (e.target === e.currentTarget && !bulkActionBusy) {
              setBulkAssignCompetencyModalOpen(false);
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
            onClick={(ev) => ev.stopPropagation()}
          >
            <h3
              id="bulk-assign-comp-title"
              style={{
                margin: "0 0 8px",
                fontSize: 17,
                fontWeight: 600,
                color: text,
              }}
            >
              Assign competencies to subject
            </h3>
            <p style={{ ...muted, margin: "0 0 12px", fontSize: 13 }}>
              {catalogueBulkOrphanCompetencyIds.size} selected — traceability
              fields are preserved.
            </p>
            <label
              style={{
                display: "grid",
                gap: 6,
                fontSize: 13,
                color: mutedColor,
                marginBottom: 12,
              }}
            >
              Target subject
              <select
                value={bulkAssignCompetenciesTargetId}
                onChange={(e) =>
                  setBulkAssignCompetenciesTargetId(e.target.value)
                }
                disabled={bulkActionBusy}
                style={{
                  padding: "10px 12px",
                  fontSize: 15,
                  color: text,
                  backgroundColor: surface,
                  border: `1px solid ${border}`,
                  borderRadius: 8,
                }}
              >
                <option value="">Choose subject…</option>
                {assignableSubjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name.trim() || "Subject"}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                disabled={bulkActionBusy}
                onClick={() => void executeBulkAssignOrphanCompetencies()}
                style={btnPrimary}
              >
                {bulkActionBusy ? "Applying…" : "Apply"}
              </button>
              <button
                type="button"
                disabled={bulkActionBusy}
                onClick={() => setBulkAssignCompetencyModalOpen(false)}
                style={btn}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {bulkAssignCapabilityAreaModalOpen ? (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="bulk-assign-area-title"
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
            if (e.target === e.currentTarget && !bulkActionBusy) {
              setBulkAssignCapabilityAreaModalOpen(false);
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
            onClick={(ev) => ev.stopPropagation()}
          >
            <h3
              id="bulk-assign-area-title"
              style={{
                margin: "0 0 8px",
                fontSize: 17,
                fontWeight: 600,
                color: text,
              }}
            >
              Assign subjects to capability area
            </h3>
            <p style={{ ...muted, margin: "0 0 12px", fontSize: 13 }}>
              {catalogueBulkUnassignedSubjectIds.size} selected — existing
              areas are updated only (no new areas created here).
            </p>
            <label
              style={{
                display: "grid",
                gap: 6,
                fontSize: 13,
                color: mutedColor,
                marginBottom: 12,
              }}
            >
              Capability area
              <select
                value={bulkAssignCapabilityAreaTargetId}
                onChange={(e) =>
                  setBulkAssignCapabilityAreaTargetId(e.target.value)
                }
                disabled={bulkActionBusy}
                style={{
                  padding: "10px 12px",
                  fontSize: 15,
                  color: text,
                  backgroundColor: surface,
                  border: `1px solid ${border}`,
                  borderRadius: 8,
                }}
              >
                <option value="">Choose area…</option>
                {capabilityAreas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name.trim() || "Capability area"}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                disabled={bulkActionBusy}
                onClick={() =>
                  void executeBulkAssignCapabilityAreaToSubjects()
                }
                style={btnPrimary}
              >
                {bulkActionBusy ? "Applying…" : "Apply"}
              </button>
              <button
                type="button"
                disabled={bulkActionBusy}
                onClick={() => setBulkAssignCapabilityAreaModalOpen(false)}
                style={btn}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {subjectArchiveDialog ? (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="subject-archive-linked-title"
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
            if (e.target === e.currentTarget && !bulkActionBusy) {
              setSubjectArchiveDialog(null);
            }
          }}
        >
          <div
            style={{
              ...panelShell,
              width: "100%",
              maxWidth: 520,
              marginTop: 48,
            }}
            onClick={(ev) => ev.stopPropagation()}
          >
            <h3
              id="subject-archive-linked-title"
              style={{
                margin: "0 0 8px",
                fontSize: 17,
                fontWeight: 600,
                color: text,
              }}
            >
              Archive subject and handle linked competencies
            </h3>
            <p style={{ ...muted, margin: "0 0 12px", fontSize: 13 }}>
              <strong style={{ color: text }}>
                {subjectArchiveDialog.label.trim()}
              </strong>
              <br />
              This subject has{" "}
              {subjectArchiveDialog.linkedCompetencyIds.length} active
              linked competencies. Choose what happens before the subject is
              archived (nothing is deleted).
            </p>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                marginBottom: 12,
              }}
            >
              <label
                style={{
                  display: "flex",
                  gap: 8,
                  fontSize: 13,
                  color: text,
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="subjectArchiveChoice"
                  checked={subjectArchiveChoice === "unassigned"}
                  onChange={() => setSubjectArchiveChoice("unassigned")}
                />
                Move linked competencies to Unassigned (no subject)
              </label>
              <label
                style={{
                  display: "flex",
                  gap: 8,
                  fontSize: 13,
                  color: text,
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="subjectArchiveChoice"
                  checked={subjectArchiveChoice === "move_subject"}
                  onChange={() => setSubjectArchiveChoice("move_subject")}
                />
                Move linked competencies to another subject
              </label>
              {subjectArchiveChoice === "move_subject" ? (
                <select
                  value={subjectArchiveMoveToId}
                  onChange={(e) => setSubjectArchiveMoveToId(e.target.value)}
                  style={{
                    marginLeft: 24,
                    padding: "8px 10px",
                    fontSize: 14,
                    color: text,
                    backgroundColor: surface,
                    border: `1px solid ${border}`,
                    borderRadius: 8,
                  }}
                >
                  <option value="">Choose subject…</option>
                  {assignableSubjects
                    .filter((s) => s.id !== subjectArchiveDialog.subjectId)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name.trim() || "Subject"}
                      </option>
                    ))}
                </select>
              ) : null}
              <label
                style={{
                  display: "flex",
                  gap: 8,
                  fontSize: 13,
                  color: text,
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="subjectArchiveChoice"
                  checked={subjectArchiveChoice === "archive_linked"}
                  onChange={() => setSubjectArchiveChoice("archive_linked")}
                />
                Archive linked competencies as well
              </label>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                disabled={bulkActionBusy}
                onClick={() => void confirmSubjectArchiveDialog()}
                style={btnPrimary}
              >
                {bulkActionBusy ? "Working…" : "Archive subject"}
              </button>
              <button
                type="button"
                disabled={bulkActionBusy}
                onClick={() => setSubjectArchiveDialog(null)}
                style={btn}
              >
                Cancel
              </button>
            </div>
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
                  : "Preview practices & subjects"}
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
                  : "Edit names, choose practices and subjects to apply. Existing practices are matched by name and reused; subjects are matched to the catalogue first (using practice context where set) or created only when needed."}
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
                                Name matches an existing practice — that practice
                                will be reused as relevant context for subjects.
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
                        {row.subjectItems && row.subjectItems.length > 0 ? (
                          <div
                            style={{
                              marginTop: 14,
                              paddingTop: 10,
                              borderTop: `1px solid ${borderSubtle}`,
                            }}
                          >
                            <p
                              style={{
                                margin: "0 0 4px",
                                fontSize: 12,
                                fontWeight: 600,
                                color: mutedColor,
                              }}
                            >
                              Proposed subjects — relevant to this practice
                            </p>
                            <p
                              style={{
                                margin: "0 0 10px",
                                fontSize: 11,
                                color: mutedColor,
                                lineHeight: 1.45,
                              }}
                            >
                              {SUBJECT_PRACTICE_CONTEXT_HINT}
                            </p>
                            {row.subjectItems.map((subItem) => {
                              const canUseCatalogue =
                                Boolean(subItem.existingSubjectId);
                              return (
                              <div
                                key={subItem.id}
                                style={{
                                  marginBottom: 12,
                                  paddingLeft: 10,
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
                                    checked={subItem.selected}
                                    onChange={(e) =>
                                      setPracticeGenRows((prev) =>
                                        prev.map((r) =>
                                          r.id === row.id
                                            ? {
                                                ...r,
                                                subjectItems: (
                                                  r.subjectItems ?? []
                                                ).map((si) =>
                                                  si.id === subItem.id
                                                    ? {
                                                        ...si,
                                                        selected:
                                                          e.target.checked,
                                                      }
                                                    : si
                                                ),
                                              }
                                            : r
                                        )
                                      )
                                    }
                                    disabled={practiceGenAccepting}
                                    style={{ marginTop: 3 }}
                                  />
                                  <span style={{ flex: 1 }}>
                                    <strong>{subItem.name}</strong>
                                    {subItem.description ? (
                                      <span style={{ color: mutedColor }}>
                                        {" "}
                                        — {subItem.description}
                                      </span>
                                    ) : null}
                                    {subItem.similarHint ? (
                                      <span
                                        style={{
                                          display: "block",
                                          marginTop: 4,
                                          fontSize: 11,
                                          color: mutedColor,
                                          lineHeight: 1.45,
                                        }}
                                      >
                                        {subItem.similarHint}
                                      </span>
                                    ) : null}
                                    <div
                                      role="radiogroup"
                                      aria-label={`Apply ${subItem.name}`}
                                      style={{
                                        marginTop: 8,
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: 6,
                                      }}
                                    >
                                      <label
                                        style={{
                                          display: "flex",
                                          alignItems: "flex-start",
                                          gap: 8,
                                          fontSize: 12,
                                          color: text,
                                          cursor:
                                            practiceGenAccepting ||
                                            !canUseCatalogue
                                              ? "not-allowed"
                                              : "pointer",
                                          opacity:
                                            canUseCatalogue && !practiceGenAccepting
                                              ? 1
                                              : 0.45,
                                        }}
                                      >
                                        <input
                                          type="radio"
                                          name={`pg-sub-${row.id}-${subItem.id}`}
                                          checked={
                                            subItem.mode === "use_existing"
                                          }
                                          disabled={
                                            practiceGenAccepting ||
                                            !canUseCatalogue
                                          }
                                          onChange={() =>
                                            setPracticeGenRows((prev) =>
                                              prev.map((r) =>
                                                r.id === row.id
                                                  ? {
                                                      ...r,
                                                      subjectItems: (
                                                        r.subjectItems ?? []
                                                      ).map((si) =>
                                                        si.id === subItem.id
                                                          ? {
                                                              ...si,
                                                              mode: "use_existing",
                                                            }
                                                          : si
                                                      ),
                                                    }
                                                  : r
                                              )
                                            )
                                          }
                                          style={{ marginTop: 2 }}
                                        />
                                        <span>
                                          Use existing subject (no change to
                                          practice context)
                                        </span>
                                      </label>
                                      <label
                                        style={{
                                          display: "flex",
                                          alignItems: "flex-start",
                                          gap: 8,
                                          fontSize: 12,
                                          color: text,
                                          cursor:
                                            practiceGenAccepting ||
                                            !canUseCatalogue
                                              ? "not-allowed"
                                              : "pointer",
                                          opacity:
                                            canUseCatalogue && !practiceGenAccepting
                                              ? 1
                                              : 0.45,
                                        }}
                                      >
                                        <input
                                          type="radio"
                                          name={`pg-sub-${row.id}-${subItem.id}`}
                                          checked={
                                            subItem.mode === "use_and_link"
                                          }
                                          disabled={
                                            practiceGenAccepting ||
                                            !canUseCatalogue
                                          }
                                          onChange={() =>
                                            setPracticeGenRows((prev) =>
                                              prev.map((r) =>
                                                r.id === row.id
                                                  ? {
                                                      ...r,
                                                      subjectItems: (
                                                        r.subjectItems ?? []
                                                      ).map((si) =>
                                                        si.id === subItem.id
                                                          ? {
                                                              ...si,
                                                              mode: "use_and_link",
                                                            }
                                                          : si
                                                      ),
                                                    }
                                                  : r
                                              )
                                            )
                                          }
                                          style={{ marginTop: 2 }}
                                        />
                                        <span>
                                          Use and link to this practice
                                          (relevant context)
                                        </span>
                                      </label>
                                      <label
                                        style={{
                                          display: "flex",
                                          alignItems: "flex-start",
                                          gap: 8,
                                          fontSize: 12,
                                          color: text,
                                          cursor: practiceGenAccepting
                                            ? "not-allowed"
                                            : "pointer",
                                          opacity: practiceGenAccepting ? 0.45 : 1,
                                        }}
                                      >
                                        <input
                                          type="radio"
                                          name={`pg-sub-${row.id}-${subItem.id}`}
                                          checked={
                                            subItem.mode === "create_new"
                                          }
                                          disabled={practiceGenAccepting}
                                          onChange={() =>
                                            setPracticeGenRows((prev) =>
                                              prev.map((r) =>
                                                r.id === row.id
                                                  ? {
                                                      ...r,
                                                      subjectItems: (
                                                        r.subjectItems ?? []
                                                      ).map((si) =>
                                                        si.id === subItem.id
                                                          ? {
                                                              ...si,
                                                              mode: "create_new",
                                                            }
                                                          : si
                                                      ),
                                                    }
                                                  : r
                                              )
                                            )
                                          }
                                          style={{ marginTop: 2 }}
                                        />
                                        <span>Create new subject</span>
                                      </label>
                                    </div>
                                  </span>
                                </label>
                              </div>
                              );
                            })}
                          </div>
                        ) : null}
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

      {practiceRemoveConfirm ? (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="practice-remove-subj-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 89,
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
              !removingSubjectFromPracticeKey
            ) {
              setPracticeRemoveConfirm(null);
            }
          }}
        >
          <div
            style={{
              ...panelShell,
              width: "100%",
              maxWidth: 520,
              marginTop: 48,
            }}
            onClick={(ev) => ev.stopPropagation()}
          >
            <h3
              id="practice-remove-subj-title"
              style={{
                margin: "0 0 12px",
                fontSize: 17,
                fontWeight: 600,
                color: text,
              }}
            >
              Remove subject from practice
            </h3>
            <div
              style={{
                fontSize: 13,
                color: mutedColor,
                lineHeight: 1.55,
              }}
            >
              <p style={{ margin: "0 0 10px", color: text }}>
                You are about to remove{" "}
                <strong style={{ color: text }}>
                  {practiceRemoveConfirm.subject.name.trim() || "this subject"}
                </strong>{" "}
                from the practice{" "}
                <strong style={{ color: text }}>
                  {practiceRemoveConfirm.practice.name.trim() ||
                    "this practice"}
                </strong>
                .
              </p>
              <p
                style={{
                  margin: "0 0 6px",
                  fontWeight: 600,
                  color: text,
                  fontSize: 12,
                }}
              >
                This will:
              </p>
              <ul
                style={{
                  margin: "0 0 12px",
                  paddingLeft: 18,
                }}
              >
                <li>
                  Remove this subject from this practice view (subject–practice
                  link).
                </li>
                <li>
                  Remove competency–practice links for competencies under this
                  subject in this practice only.
                </li>
              </ul>
              <p
                style={{
                  margin: "0 0 6px",
                  fontWeight: 600,
                  color: text,
                  fontSize: 12,
                }}
              >
                This will not:
              </p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                <li>Delete the subject or any competencies from the taxonomy.</li>
                <li>Affect other practices or their overlays.</li>
                <li>Change capability area placement or provenance.</li>
              </ul>
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
                disabled={
                  removingSubjectFromPracticeKey ===
                  `${practiceRemoveConfirm.practice.id}::${practiceRemoveConfirm.subject.id}`
                }
                onClick={() => setPracticeRemoveConfirm(null)}
                style={btn}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  removingSubjectFromPracticeKey ===
                  `${practiceRemoveConfirm.practice.id}::${practiceRemoveConfirm.subject.id}`
                }
                onClick={() => void confirmRemoveSubjectFromPracticeOverlay()}
                style={btnPrimary}
              >
                {removingSubjectFromPracticeKey ===
                `${practiceRemoveConfirm.practice.id}::${practiceRemoveConfirm.subject.id}`
                  ? "Removing…"
                  : "Remove from practice"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {practiceAddItemsModal ? (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="practice-add-items-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 89,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "24px 16px",
            overflow: "auto",
            backgroundColor: "rgba(0,0,0,0.6)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !addItemsApplying) {
              setPracticeAddItemsModal(null);
            }
          }}
        >
          <div
            style={{
              ...panelShell,
              width: "100%",
              maxWidth: 520,
              marginTop: 48,
            }}
            onClick={(ev) => ev.stopPropagation()}
          >
            <h3
              id="practice-add-items-title"
              style={{
                margin: "0 0 6px",
                fontSize: 17,
                fontWeight: 600,
                color: text,
              }}
            >
              Add items to{" "}
              {practiceAddItemsModal.practice.name.trim() || "practice"}
            </h3>
            <p style={{ ...muted, margin: "0 0 12px", fontSize: 13 }}>
              Select competencies to include in this practice context.
              {practiceAddItemsModal.subject.name.trim() ? (
                <>
                  {" "}
                  Showing competencies under{" "}
                  <strong style={{ color: text }}>
                    {practiceAddItemsModal.subject.name.trim()}
                  </strong>{" "}
                  that are not yet linked.
                </>
              ) : null}
            </p>
            <div
              style={{
                maxHeight: 320,
                overflow: "auto",
                marginBottom: 14,
                padding: "8px 10px",
                borderRadius: 8,
                border: `1px solid ${borderSubtle}`,
                backgroundColor: surface,
              }}
            >
              {(() => {
                const candidates = listPracticeCandidateCompetenciesForSubject(
                  practiceAddItemsModal.practice.id,
                  practiceAddItemsModal.subject.id,
                  competencies,
                  competencyPracticeLinks,
                );
                if (candidates.length === 0) {
                  return (
                    <p
                      style={{
                        margin: 0,
                        fontSize: 13,
                        color: mutedColor,
                        lineHeight: 1.45,
                      }}
                    >
                      All assignable competencies under this subject are already
                      linked to this practice, or none are available.
                    </p>
                  );
                }
                return (
                  <ul
                    style={{
                      margin: 0,
                      padding: 0,
                      listStyle: "none",
                    }}
                  >
                    {candidates.map((c) => (
                      <li
                        key={c.id}
                        style={{
                          marginBottom: 8,
                          fontSize: 13,
                          color: text,
                        }}
                      >
                        <label
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 10,
                            cursor: addItemsApplying ? "not-allowed" : "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={addItemsSelectedIds.has(c.id)}
                            disabled={addItemsApplying}
                            onChange={() =>
                              togglePracticeAddItemSelection(c.id)
                            }
                            style={{ marginTop: 3 }}
                          />
                          <span>{c.name.trim()}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                paddingTop: 14,
                borderTop: `1px solid ${border}`,
              }}
            >
              <button
                type="button"
                disabled={addItemsApplying}
                onClick={() => setPracticeAddItemsModal(null)}
                style={btn}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={addItemsApplying}
                onClick={() => void applyPracticeAddItems()}
                style={btnPrimary}
              >
                {addItemsApplying ? "Adding…" : "Add selected"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {practiceManageModal ? (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="practice-manage-items-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 89,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "24px 16px",
            overflow: "auto",
            backgroundColor: "rgba(0,0,0,0.6)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !manageItemsApplying) {
              setPracticeManageModal(null);
            }
          }}
        >
          <div
            style={{
              ...panelShell,
              width: "100%",
              maxWidth: 520,
              marginTop: 48,
            }}
            onClick={(ev) => ev.stopPropagation()}
          >
            <h3
              id="practice-manage-items-title"
              style={{
                margin: "0 0 8px",
                fontSize: 17,
                fontWeight: 600,
                color: text,
              }}
            >
              Manage items —{" "}
              {practiceManageModal.subject.name.trim() || "Subject"}
            </h3>
            <p style={{ ...muted, margin: "0 0 14px", fontSize: 13 }}>
              Practice:{" "}
              <strong style={{ color: text }}>
                {practiceManageModal.practice.name.trim() || "Practice"}
              </strong>
            </p>
            <p style={{ margin: "0 0 10px", fontSize: 12, color: mutedColor }}>
              Checked competencies are included in this practice overlay for
              this subject. Unchecked ones are not linked in this practice
              (taxonomy is unchanged).
            </p>
            <div
              style={{
                maxHeight: 320,
                overflow: "auto",
                marginBottom: 14,
                padding: "8px 10px",
                borderRadius: 8,
                border: `1px solid ${borderSubtle}`,
                backgroundColor: surface,
              }}
            >
              {(() => {
                const managed = listPracticeManagedCompetenciesForSubject(
                  practiceManageModal.practice.id,
                  practiceManageModal.subject.id,
                  competencies,
                  competencyPracticeLinks,
                );
                if (managed.length === 0) {
                  return (
                    <p
                      style={{
                        margin: 0,
                        fontSize: 13,
                        color: mutedColor,
                        lineHeight: 1.45,
                      }}
                    >
                      No assignable competencies under this subject.
                    </p>
                  );
                }
                return (
                  <ul
                    style={{
                      margin: 0,
                      padding: 0,
                      listStyle: "none",
                    }}
                  >
                    {managed.map((c) => (
                      <li
                        key={c.id}
                        style={{
                          marginBottom: 8,
                          fontSize: 13,
                          color: text,
                        }}
                      >
                        <label
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 10,
                            cursor: manageItemsApplying
                              ? "not-allowed"
                              : "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={manageItemsLinked[c.id] ?? false}
                            disabled={manageItemsApplying}
                            onChange={(e) =>
                              setManageItemsLinked((prev) => ({
                                ...prev,
                                [c.id]: e.target.checked,
                              }))
                            }
                            style={{ marginTop: 3 }}
                          />
                          <span>{c.name.trim()}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                paddingTop: 14,
                borderTop: `1px solid ${border}`,
              }}
            >
              <button
                type="button"
                disabled={manageItemsApplying}
                onClick={() => setPracticeManageModal(null)}
                style={btn}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={manageItemsApplying}
                onClick={() => void applyPracticeManageItems()}
                style={btnPrimary}
              >
                {manageItemsApplying ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeOrgId ? (
        <CapabilityAreaBuilderModal
          open={capabilityAreaBuilderOpen}
          onClose={() => setCapabilityAreaBuilderOpen(false)}
          activeOrgId={activeOrgId}
          subjects={filteredSubjects}
          capabilityAreas={capabilityAreas}
          companyProfile={companyProfile}
          onApplied={async () => {
            await reloadSubjectsForOrg(activeOrgId);
            await reloadCapabilityAreasForOrg(activeOrgId);
          }}
        />
      ) : null}
      {activeOrgId ? (
        <LeftoverSubjectsRefinementModal
          open={leftoverRefinementOpen}
          onClose={() => setLeftoverRefinementOpen(false)}
          activeOrgId={activeOrgId}
          subjects={subjects}
          capabilityAreas={capabilityAreas}
          companyProfile={companyProfile}
          onApplied={async () => {
            await reloadSubjectsForOrg(activeOrgId);
            await reloadCapabilityAreasForOrg(activeOrgId);
          }}
        />
      ) : null}
      {activeOrgId ? (
        <PracticeCompetencyRefinementModal
          open={practiceCompetencyRefinementPractice !== null}
          onClose={() => setPracticeCompetencyRefinementPractice(null)}
          practice={practiceCompetencyRefinementPractice}
          subjects={subjects}
          competencies={competencies}
          capabilityAreas={capabilityAreas}
          companyProfile={companyProfile}
          activeOrgId={activeOrgId}
          canAuthorHierarchy={canAuthorHierarchy}
          subjectPracticeLinks={subjectPracticeLinks}
          competencyPracticeLinks={competencyPracticeLinks}
          onApplied={async () => {
            await reloadSubjectsForOrg(activeOrgId);
            await reloadCompetenciesForOrg(activeOrgId);
            await reloadCompetencyPracticeLinksForOrg(activeOrgId);
          }}
        />
      ) : null}
      {activeOrgId ? (
        <UnassignedCompetenciesRefinementModal
          open={competencyRefinementOpen}
          onClose={() => setCompetencyRefinementOpen(false)}
          competencies={competenciesForRefinementFlow}
          subjectsForCapabilityTree={subjectsForCapabilityTree}
          subjects={subjects}
          capabilityAreas={capabilityAreas}
          companyProfile={companyProfile}
          onApplyAssignment={async (competencyId, subjectId) => {
            const c = competencies.find((x) => x.id === competencyId);
            if (!c) return false;
            return moveCompetencyToSubject(
              competencyId,
              subjectId,
              normalizeCompetencyType(c.competency_type) as CompetencyType
            );
          }}
        />
      ) : null}
    </>
  );
}
