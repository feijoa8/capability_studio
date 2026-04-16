import {
  isReferenceStarterPackCompetencyItem,
  isReferenceStarterPackSubjectItem,
  type ReferenceStarterPackItemRow,
  type ReferenceSubjectRow,
} from "../../lib/referenceLibrary";

function unwrapSubject(
  s: ReferenceStarterPackItemRow["reference_subjects"],
): ReferenceSubjectRow | null {
  if (!s) return null;
  return Array.isArray(s) ? s[0] ?? null : s;
}

function unwrapCompetency(
  c: ReferenceStarterPackItemRow["reference_competencies"],
): NonNullable<ReferenceStarterPackItemRow["reference_competencies"]> | null {
  if (!c) return null;
  return Array.isArray(c) ? c[0] ?? null : c;
}

function unwrapRefCapabilityAreaLabel(subject: ReferenceSubjectRow | null): string | null {
  if (!subject?.reference_capability_areas) return null;
  const ra = subject.reference_capability_areas;
  const one = Array.isArray(ra) ? ra[0] : ra;
  return one?.name?.trim() || null;
}

export type PackSubjectGroup = {
  subjectId: string;
  subject: ReferenceSubjectRow;
  capabilityAreaLabel: string | null;
  competencies: {
    itemId: string;
    competencyId: string;
    name: string;
    description: string | null;
  }[];
};

/** Group pack items by reference subject (same logic as member browse detail). */
export function buildPackSubjectGroups(
  items: ReferenceStarterPackItemRow[],
): PackSubjectGroup[] {
  const order: string[] = [];
  const groups = new Map<string, PackSubjectGroup>();

  const placeholder = (sid: string): ReferenceSubjectRow => ({
    id: sid,
    reference_capability_area_id: "",
    name: "Reference subject",
    description: null,
    lifecycle_status: "published",
  });

  function ensure(sid: string, sub: ReferenceSubjectRow | null) {
    if (!groups.has(sid)) {
      const row = sub ?? placeholder(sid);
      groups.set(sid, {
        subjectId: sid,
        subject: row,
        capabilityAreaLabel: unwrapRefCapabilityAreaLabel(row),
        competencies: [],
      });
      order.push(sid);
    } else if (sub) {
      const g = groups.get(sid)!;
      g.subject = sub;
      g.capabilityAreaLabel =
        unwrapRefCapabilityAreaLabel(sub) ?? g.capabilityAreaLabel;
    }
  }

  for (const it of items) {
    if (isReferenceStarterPackSubjectItem(it)) {
      const subj = unwrapSubject(it.reference_subjects);
      if (subj && it.reference_subject_id) {
        ensure(subj.id, subj);
      }
    }
    if (isReferenceStarterPackCompetencyItem(it)) {
      const comp = unwrapCompetency(it.reference_competencies);
      if (comp?.reference_subject_id) {
        const sid = comp.reference_subject_id;
        const psub = unwrapSubject(
          comp.reference_subjects as ReferenceStarterPackItemRow["reference_subjects"],
        );
        ensure(sid, psub);
        groups.get(sid)!.competencies.push({
          itemId: it.id,
          competencyId: comp.id,
          name: comp.name,
          description: comp.description,
        });
      }
    }
  }

  return order.map((id) => groups.get(id)!);
}
