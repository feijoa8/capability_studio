import { supabase } from "../../lib/supabase";
import type {
  UserCertificationRow,
  UserExperienceRow,
  UserQualificationRow,
} from "./types";
import { dedupeSkillsNormalized } from "./skillNormalization";
import type {
  CvCertificationDraft,
  CvEvidenceImportMode,
  CvProjectDraft,
  CvQualificationDraft,
  CvWorkExperienceDraft,
  Selectable,
} from "./cvImportLogic";
import {
  isDupCert,
  isDupProject,
  isDupQual,
  matchExperienceId,
  normKey,
} from "./cvImportLogic";

function expKey(role: string, org: string): string {
  return `${normKey(role)}::${normKey(org)}`;
}

export async function applyCvImport(args: {
  /** When null, qualification/certification rows are stored as personal (organisation_id null). */
  activeOrgId: string | null;
  userId: string;
  experiences: UserExperienceRow[];
  existingQualifications: UserQualificationRow[];
  existingCertifications: UserCertificationRow[];
  existingProjects: { experience_id: string; project_name?: string | null }[];
  work_experience: Selectable<CvWorkExperienceDraft>[];
  projects: Selectable<CvProjectDraft>[];
  qualifications: Selectable<CvQualificationDraft>[];
  certifications: Selectable<CvCertificationDraft>[];
  importMode?: CvEvidenceImportMode;
}): Promise<{ counts: { experience: number; projects: number; qualifications: number; certifications: number }; skipped: string[] }> {
  const skipped: string[] = [];
  const counts = {
    experience: 0,
    projects: 0,
    qualifications: 0,
    certifications: 0,
  };

  const importMode: CvEvidenceImportMode = args.importMode ?? "merge";

  let effectiveExperiences = args.experiences;
  let effectiveProjects = args.existingProjects;
  if (importMode === "replace") {
    const { error: delErr } = await supabase
      .from("user_experience")
      .delete()
      .eq("user_id", args.userId);
    if (delErr) {
      console.error(delErr);
      throw new Error(delErr.message);
    }
    effectiveExperiences = [];
    effectiveProjects = [];
  }

  const keyToId = new Map<string, string>();
  for (const e of effectiveExperiences) {
    const k = expKey(e.role_title ?? "", e.organisation_name ?? "");
    keyToId.set(k, e.id);
  }

  let maxSort = effectiveExperiences.reduce(
    (m, r) => Math.max(m, r.sort_order ?? 0),
    0
  );

  const poolMap = new Map<
    string,
    { id: string; role_title: string | null; organisation_name: string | null }
  >();
  for (const e of effectiveExperiences) {
    poolMap.set(e.id, {
      id: e.id,
      role_title: e.role_title,
      organisation_name: e.organisation_name,
    });
  }

  for (const w of args.work_experience) {
    if (!w.include) continue;
    const k = expKey(w.role_title, w.organisation_name);
    if (importMode === "merge" && keyToId.has(k)) {
      skipped.push(
        `Work: "${w.role_title}" at ${w.organisation_name} already exists — skipped.`
      );
      continue;
    }
    maxSort += 1;
    const payload = {
      user_id: args.userId,
      role_title: w.role_title,
      organisation_name: w.organisation_name,
      description: w.description,
      start_date: w.start_date,
      end_date: w.is_current ? null : w.end_date,
      is_current: w.is_current,
      industry: w.industry,
      skills: dedupeSkillsNormalized(w.skills),
      methods: dedupeSkillsNormalized(w.methods ?? []),
      tools: dedupeSkillsNormalized(w.tools ?? []),
      sort_order: maxSort,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from("user_experience")
      .insert(payload)
      .select("id")
      .single();
    if (error || !data) {
      console.error(error);
      skipped.push(`Work: could not add "${w.role_title}" (${error?.message ?? "unknown"})`);
      continue;
    }
    const newId = data.id as string;
    keyToId.set(k, newId);
    poolMap.set(newId, {
      id: newId,
      role_title: w.role_title,
      organisation_name: w.organisation_name,
    });
    counts.experience += 1;
  }

  const pool = [...poolMap.values()];

  const seenProject = new Set<string>();
  const projectsSeenThisRun: { experience_id: string; project_name: string | null }[] =
    [];

  for (const p of args.projects) {
    if (!p.include) continue;
    const expId = matchExperienceId(p, pool);
    if (!expId) {
      skipped.push(`Project: no role match for "${p.project_name}"`);
      continue;
    }
    const dupAgainstSaved = isDupProject(p, expId, effectiveProjects);
    const dupInBatch = isDupProject(p, expId, projectsSeenThisRun);
    if (dupAgainstSaved || dupInBatch) {
      skipped.push(`Project: duplicate "${p.project_name}"`);
      continue;
    }
    const dedupeKey = `${expId}::${normKey(p.project_name)}`;
    if (seenProject.has(dedupeKey)) {
      skipped.push(`Project: duplicate "${p.project_name}" in import batch`);
      continue;
    }
    seenProject.add(dedupeKey);

    const { error } = await supabase.from("user_experience_projects").insert({
      user_id: args.userId,
      experience_id: expId,
      project_name: p.project_name,
      client: p.client,
      role: p.role,
      description: p.description,
      start_date: p.start_date,
      end_date: p.end_date,
      industry: p.industry,
      skills: dedupeSkillsNormalized(p.skills),
      methods: dedupeSkillsNormalized(p.methods ?? []),
      tools: dedupeSkillsNormalized(p.tools ?? []),
      updated_at: new Date().toISOString(),
    });
    if (error) {
      console.error(error);
      skipped.push(`Project: "${p.project_name}" (${error.message})`);
      continue;
    }
    projectsSeenThisRun.push({
      experience_id: expId,
      project_name: p.project_name,
    });
    counts.projects += 1;
  }

  const qualPool: {
    title: string;
    issuer: string | null;
    date_achieved: string | null;
  }[] = args.existingQualifications.map((q) => ({
    title: q.title,
    issuer: q.issuer,
    date_achieved: q.date_achieved,
  }));

  for (const q of args.qualifications) {
    if (!q.include) continue;
    if (isDupQual(q, qualPool)) {
      skipped.push(`Qualification: duplicate "${q.title}"`);
      continue;
    }
    const { error } = await supabase.from("user_qualifications").insert({
      user_id: args.userId,
      organisation_id: args.activeOrgId,
      title: q.title,
      issuer: q.issuer,
      qualification_type: q.qualification_type,
      date_achieved: q.date_achieved,
      notes: q.notes,
      credential_url: q.credential_url,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      console.error(error);
      skipped.push(`Qualification: "${q.title}" (${error.message})`);
      continue;
    }
    qualPool.push({
      title: q.title,
      issuer: q.issuer,
      date_achieved: q.date_achieved,
    });
    counts.qualifications += 1;
  }

  const certPool: {
    title: string;
    issuer: string | null;
    issue_date: string | null;
  }[] = args.existingCertifications.map((c) => ({
    title: c.title,
    issuer: c.issuer,
    issue_date: c.issue_date,
  }));

  for (const c of args.certifications) {
    if (!c.include) continue;
    if (isDupCert(c, certPool)) {
      skipped.push(`Certification: duplicate "${c.title}"`);
      continue;
    }
    const { error } = await supabase.from("user_certifications").insert({
      user_id: args.userId,
      organisation_id: args.activeOrgId,
      title: c.title,
      issuer: c.issuer,
      issue_date: c.issue_date,
      expiry_date: c.expiry_date,
      renewal_required: c.renewal_required,
      notes: c.notes,
      credential_url: c.credential_url,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      console.error(error);
      skipped.push(`Certification: "${c.title}" (${error.message})`);
      continue;
    }
    certPool.push({
      title: c.title,
      issuer: c.issuer,
      issue_date: c.issue_date,
    });
    counts.certifications += 1;
  }

  return { counts, skipped };
}
