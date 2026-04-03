import { useCallback, useEffect, useMemo, useState } from "react";
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
} from "./hub/types";
import { SkillTagInput } from "./hub/SkillTagInput";
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
  text,
} from "./hub/hubTheme";

type Props = {
  activeOrgId: string | null;
  isActive: boolean;
};

function aggregateSkills(
  entries: UserExperienceRow[]
): { label: string; count: number }[] {
  const byKey = new Map<string, { label: string; count: number }>();
  for (const e of entries) {
    for (const t of e.skills ?? []) {
      const label = normalizeSkillLabel(t);
      if (!label) continue;
      const k = label.toLowerCase();
      const cur = byKey.get(k);
      if (cur) cur.count += 1;
      else byKey.set(k, { label, count: 1 });
    }
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count);
}

function buildSkillSuggestionPool(
  experienceRows: UserExperienceRow[],
  projectRows: UserExperienceProject[]
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of experienceRows) {
    for (const t of e.skills ?? []) {
      const n = normalizeSkillLabel(t);
      if (!n) continue;
      const k = n.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(n);
    }
  }
  for (const p of projectRows) {
    for (const t of p.skills ?? []) {
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

function aggregateIndustries(
  entries: UserExperienceRow[]
): { label: string; count: number }[] {
  const byKey = new Map<string, { label: string; count: number }>();
  for (const e of entries) {
    const ind = e.industry?.trim();
    if (!ind) continue;
    const k = ind.toLowerCase();
    const cur = byKey.get(k);
    if (cur) cur.count += 1;
    else byKey.set(k, { label: ind, count: 1 });
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count);
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
  };
}

export function MyExperienceSection({ activeOrgId, isActive }: Props) {
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
  const [saving, setSaving] = useState(false);

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

  const skillSummary = useMemo(
    () => aggregateSkills(experiences),
    [experiences]
  );
  const industrySummary = useMemo(
    () => aggregateIndustries(experiences),
    [experiences]
  );

  const sortedCertifications = useMemo(
    () => sortCertificationsByRenewalUrgency(certifications),
    [certifications]
  );

  const loadData = useCallback(async () => {
    if (!isActive || !activeOrgId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);

    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) {
      setLoadError("Not signed in.");
      setLoading(false);
      return;
    }
    setUserId(uid);

    const [expRes, qualRes, certRes, projRes] = await Promise.all([
      supabase
        .from("user_experience")
        .select("*")
        .eq("user_id", uid)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false }),
      supabase
        .from("user_qualifications")
        .select("*")
        .eq("organisation_id", activeOrgId)
        .eq("user_id", uid)
        .order("created_at", { ascending: false }),
      supabase
        .from("user_certifications")
        .select("*")
        .eq("organisation_id", activeOrgId)
        .eq("user_id", uid)
        .order("created_at", { ascending: false }),
      supabase
        .from("user_experience_projects")
        .select("*")
        .eq("user_id", uid)
        .order("created_at", { ascending: true }),
    ]);

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

    setLoading(false);
  }, [isActive, activeOrgId]);

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
    const payload = {
      role_title: title,
      organisation_name: org,
      description: expForm.description.trim() || null,
      start_date: expForm.start_date.trim() || null,
      end_date: expForm.is_current ? null : expForm.end_date.trim() || null,
      is_current: expForm.is_current,
      industry: expForm.industry.trim() || null,
      skills,
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
    if (!userId || !activeOrgId) return;
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
        organisation_id: activeOrgId,
        ...payload,
      });
      setSaving(false);
      if (error) {
        console.error(error);
        alert(error.message || "Could not add qualification.");
        return;
      }
    } else if (editingQualId) {
      const { error } = await supabase
        .from("user_qualifications")
        .update(payload)
        .eq("id", editingQualId)
        .eq("user_id", userId)
        .eq("organisation_id", activeOrgId);
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
    if (!activeOrgId) return;
    const { error } = await supabase
      .from("user_qualifications")
      .delete()
      .eq("id", id)
      .eq("user_id", userId)
      .eq("organisation_id", activeOrgId);
    if (error) {
      console.error(error);
      alert(error.message || "Could not delete.");
      return;
    }
    await loadData();
  }

  async function submitCertification(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!userId || !activeOrgId) return;
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
        organisation_id: activeOrgId,
        ...payload,
      });
      setSaving(false);
      if (error) {
        console.error(error);
        alert(error.message || "Could not add certification.");
        return;
      }
    } else if (editingCertId) {
      const { error } = await supabase
        .from("user_certifications")
        .update(payload)
        .eq("id", editingCertId)
        .eq("user_id", userId)
        .eq("organisation_id", activeOrgId);
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
    if (!userId || !activeOrgId) return;
    if (!confirm("Remove this certification?")) return;
    const { error } = await supabase
      .from("user_certifications")
      .delete()
      .eq("id", id)
      .eq("user_id", userId)
      .eq("organisation_id", activeOrgId);
    if (error) {
      console.error(error);
      alert(error.message || "Could not delete.");
      return;
    }
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
    const payload = {
      project_name: pname,
      client: projForm.client.trim() || null,
      role: projForm.role.trim() || null,
      description: projForm.description.trim() || null,
      start_date: projForm.start_date.trim() || null,
      end_date: projForm.end_date.trim() || null,
      industry: projForm.industry.trim() || null,
      skills,
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

  if (!activeOrgId) {
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

  return (
    <div
      style={{
        maxWidth: 720,
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

      {loadError ? (
        <p style={{ margin: 0, fontSize: 14, color: errorColor }}>{loadError}</p>
      ) : null}

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
              No entries yet. Add a role to build your evidence layer.
            </p>
          ) : (
            <ul
              style={{
                margin: 0,
                padding: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              {experiences.map((row) => (
                <li
                  key={row.id}
                  style={{
                    paddingBottom: 14,
                    borderBottom: `1px solid ${border}`,
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
                          fontSize: 15,
                          color: text,
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
                      {row.description ? (
                        <p
                          style={{
                            margin: "8px 0 0",
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
                            margin: "8px 0 0",
                            fontSize: 12,
                            color: mutedColor,
                          }}
                        >
                          Industry:{" "}
                          <span style={{ color: text }}>{row.industry}</span>
                        </p>
                      ) : null}
                      {(row.skills?.length ?? 0) > 0 ? (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 6,
                            marginTop: 10,
                          }}
                        >
                          {(row.skills ?? []).map((t) => (
                            <span
                              key={t}
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
                    </div>
                    <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                      <button
                        type="button"
                        onClick={() => openEditExperience(row)}
                        style={{ ...btnGhost, fontSize: 12, padding: "6px 10px" }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteExperience(row.id)}
                        style={{ ...btnGhost, fontSize: 12, padding: "6px 10px" }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div
                    style={{
                      marginTop: 14,
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
                    {(projectsByExperienceId[row.id] ?? []).length === 0 ? (
                      <p style={{ margin: 0, fontSize: 13, color: mutedColor }}>
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
                        {(projectsByExperienceId[row.id] ?? []).map((proj) => (
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
                                  {proj.project_name?.trim() || "Untitled project"}
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
                                    {truncateText(proj.description, 220)}
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
                                        key={t}
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
                                  onClick={() => openEditProject(proj)}
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
                                  onClick={() => void deleteProject(proj.id)}
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
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Skill summary (derived) */}
      <section>
        <p style={{ ...sectionEyebrow, marginTop: 0 }}>Skill summary</p>
        <p style={{ margin: "4px 0 10px", fontSize: 12, color: mutedColor }}>
          Derived from tags on your experience entries — indicative only, not
          formal competency data.
        </p>
        <div style={{ ...card, marginTop: 0 }}>
          {skillSummary.length === 0 ? (
            <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>
              Tag skills on work entries to see aggregated counts here.
            </p>
          ) : (
            <ul
              style={{
                margin: 0,
                padding: 0,
                listStyle: "none",
                display: "grid",
                gap: 8,
              }}
            >
              {skillSummary.map((s) => (
                <li
                  key={s.label}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: 14,
                    color: text,
                  }}
                >
                  <span>{s.label}</span>
                  <span style={{ fontSize: 13, color: mutedColor }}>
                    {s.count} {s.count === 1 ? "role" : "roles"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Industry (derived) */}
      <section>
        <p style={{ ...sectionEyebrow, marginTop: 0 }}>Industry experience</p>
        <p style={{ margin: "4px 0 10px", fontSize: 12, color: mutedColor }}>
          Derived from optional industry labels on entries — useful for future
          fit and mobility views.
        </p>
        <div style={{ ...card, marginTop: 0 }}>
          {industrySummary.length === 0 ? (
            <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>
              Add an industry label to a work entry to see counts here.
            </p>
          ) : (
            <ul
              style={{
                margin: 0,
                padding: 0,
                listStyle: "none",
                display: "grid",
                gap: 8,
              }}
            >
              {industrySummary.map((s) => (
                <li
                  key={s.label}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: 14,
                    color: text,
                  }}
                >
                  <span>{s.label}</span>
                  <span style={{ fontSize: 13, color: mutedColor }}>
                    {s.count} {s.count === 1 ? "entry" : "entries"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Qualifications (enduring credentials) */}
      <section>
        <p style={{ ...sectionEyebrow, marginTop: 0 }}>Qualifications</p>
        <div style={{ ...card, marginTop: 8 }}>
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
              Degrees, diplomas, professional courses, and other enduring
              credentials (Scrum, PRINCE2, etc.).
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
              No qualifications recorded for this workspace yet.
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
              {qualifications.map((q) => (
                <li
                  key={q.id}
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: "space-between",
                    gap: 10,
                    paddingBottom: 12,
                    borderBottom: `1px solid ${border}`,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: text }}>
                      {q.title}
                    </div>
                    {q.issuer ? (
                      <div style={{ fontSize: 13, color: mutedColor, marginTop: 4 }}>
                        {q.issuer}
                      </div>
                    ) : null}
                    {q.qualification_type ? (
                      <div style={{ fontSize: 12, color: mutedColor, marginTop: 4 }}>
                        {q.qualification_type}
                      </div>
                    ) : null}
                    <div style={{ fontSize: 12, color: mutedColor, marginTop: 6 }}>
                      {q.date_achieved
                        ? `Achieved ${formatDate(q.date_achieved)}`
                        : "Date not set"}
                    </div>
                    {q.notes ? (
                      <p
                        style={{
                          margin: "8px 0 0",
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
                          marginTop: 8,
                          fontSize: 12,
                          color: accent,
                        }}
                      >
                        View credential link
                      </a>
                    ) : null}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => openEditQualification(q)}
                      style={{ ...btnGhost, fontSize: 12, padding: "6px 10px" }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteQualification(q.id)}
                      style={{ ...btnGhost, fontSize: 12, padding: "6px 10px" }}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Certifications (renewable) */}
      <section>
        <p style={{ ...sectionEyebrow, marginTop: 0 }}>Certifications</p>
        <div style={{ ...card, marginTop: 8 }}>
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
              Safety, compliance, and other credentials that may expire and
              require renewal.
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
              No certifications recorded for this workspace yet.
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
              {sortedCertifications.map((c) => {
                const st = certificationRenewalStatus(c.expiry_date);
                const badgeLabel = certificationStatusLabel(st);
                const badgeColor =
                  st === "expired"
                    ? "#e87878"
                    : st === "expiring_soon"
                      ? "#e8c96a"
                      : mutedColor;
                return (
                  <li
                    key={c.id}
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      justifyContent: "space-between",
                      gap: 10,
                      paddingBottom: 12,
                      borderBottom: `1px solid ${border}`,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span style={{ fontWeight: 600, fontSize: 14, color: text }}>
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
                        <div style={{ fontSize: 13, color: mutedColor, marginTop: 4 }}>
                          {c.issuer}
                        </div>
                      ) : null}
                      <div style={{ fontSize: 12, color: mutedColor, marginTop: 6 }}>
                        {c.issue_date
                          ? `Issued ${formatDate(c.issue_date)}`
                          : "Issue date not set"}
                        {c.expiry_date
                          ? ` · Expires ${formatDate(c.expiry_date)}`
                          : " · No expiry date"}
                        {!c.renewal_required ? " · Renewal not required" : ""}
                      </div>
                      {c.notes ? (
                        <p
                          style={{
                            margin: "8px 0 0",
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
                            marginTop: 8,
                            fontSize: 12,
                            color: accent,
                          }}
                        >
                          View credential link
                        </a>
                      ) : null}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => openEditCertification(c)}
                        style={{ ...btnGhost, fontSize: 12, padding: "6px 10px" }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteCertification(c.id)}
                        style={{ ...btnGhost, fontSize: 12, padding: "6px 10px" }}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

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
                  Skills <span style={{ fontWeight: 400 }}>(optional)</span>
                </>
              }
              skills={expForm.skills}
              onSkillsChange={(skills) =>
                setExpForm((f) => ({ ...f, skills }))
              }
              suggestionPool={skillSuggestionPool}
              placeholder="Type a skill and press Enter"
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
                  Skills <span style={{ fontWeight: 400 }}>(optional)</span>
                </>
              }
              skills={projForm.skills}
              onSkillsChange={(skills) =>
                setProjForm((f) => ({ ...f, skills }))
              }
              suggestionPool={skillSuggestionPool}
              placeholder="Type a skill and press Enter"
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
    </div>
  );
}
