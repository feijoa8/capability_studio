import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "../../lib/supabase";
import { normalizeJobProfileLevelName } from "../hub/hubUtils";
import {
  border,
  borderSubtle,
  btnGhost,
  btnPrimary,
  errorColor,
  fieldBg,
  mutedColor,
  surface,
  text,
} from "../hub/hubTheme";
import {
  fetchInternalMembersForOrg,
  fetchManagedHiringForOpening,
  type HiringOpeningRow,
  type HiringOpeningStatus,
  type HiringOpeningVisibility,
  type ManagedOrganisationRow,
} from "./hiringApi";
import { JobProfilePreviewModal } from "./JobProfilePreviewModal";

type JobOpt = { id: string; title: string };
type FamilyOpt = { id: string; name: string };

type Props = {
  open: boolean;
  organisationId: string;
  onClose: () => void;
  onCreated: () => void;
  /** When set, form updates this opening instead of inserting. */
  openingToEdit?: HiringOpeningRow | null;
};

function numOrNull(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function CreateRoleModal({
  open,
  organisationId,
  onClose,
  onCreated,
  openingToEdit = null,
}: Props) {
  const editMode = Boolean(openingToEdit);
  const [jobProfiles, setJobProfiles] = useState<JobOpt[]>([]);
  const [jobFamilies, setJobFamilies] = useState<FamilyOpt[]>([]);
  const [managedOrgs, setManagedOrgs] = useState<ManagedOrganisationRow[]>([]);
  const [managedOrgsLoading, setManagedOrgsLoading] = useState(false);
  const [managedOrgsListError, setManagedOrgsListError] = useState<string | null>(
    null,
  );
  const [clientOrgSaving, setClientOrgSaving] = useState(false);
  const [clientOrgSaveMessage, setClientOrgSaveMessage] = useState<string | null>(
    null,
  );
  const [members, setMembers] = useState<
    Awaited<ReturnType<typeof fetchInternalMembersForOrg>>
  >([]);

  /** `true` = hiring for this workspace; `false` = managing for a client (managed). */
  const [hiringForOwnOrg, setHiringForOwnOrg] = useState(true);
  const [useNewClientOrg, setUseNewClientOrg] = useState(false);
  const [managedOrgId, setManagedOrgId] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [newClientDomain, setNewClientDomain] = useState("");
  const [newClientIndustry, setNewClientIndustry] = useState("");
  const [newClientSizeBand, setNewClientSizeBand] = useState("");
  const [newClientNotes, setNewClientNotes] = useState("");

  /** In managed (create) mode: use existing org job profile or create a new one. */
  const [jobProfileMode, setJobProfileMode] = useState<"existing" | "new">(
    "existing",
  );
  const [newProfileFamilyId, setNewProfileFamilyId] = useState("");
  const [newProfileTitle, setNewProfileTitle] = useState("");
  const [newProfileLevel, setNewProfileLevel] = useState("");

  const [isAnonymous, setIsAnonymous] = useState(true);
  const [publicName, setPublicName] = useState("");
  const [salaryMin, setSalaryMin] = useState("");
  const [salaryMax, setSalaryMax] = useState("");
  const [salaryCurrency, setSalaryCurrency] = useState("");

  const [clientOrgNameReadonly, setClientOrgNameReadonly] = useState<string | null>(
    null,
  );
  const [editingManagedRoleId, setEditingManagedRoleId] = useState<string | null>(
    null,
  );

  const [jobProfileId, setJobProfileId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<HiringOpeningStatus>("draft");
  const [hiringManagerId, setHiringManagerId] = useState<string>("");
  const [hiringLeadId, setHiringLeadId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [visibility, setVisibility] = useState<HiringOpeningVisibility>("internal_only");
  const [publicSlug, setPublicSlug] = useState("");

  const loadJobs = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("job_profiles")
      .select("id, title")
      .eq("organisation_id", organisationId)
      .order("title");
    if (err) {
      console.warn("job_profiles:", err.message);
      setJobProfiles([]);
      return;
    }
    setJobProfiles(
      (data ?? []).map((r) => ({
        id: String((r as { id: string }).id),
        title: String((r as { title: string }).title ?? ""),
      })),
    );
  }, [organisationId]);

  const loadJobFamilies = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("job_families")
      .select("id, name")
      .eq("organisation_id", organisationId)
      .order("name");
    if (err) {
      console.warn("job_families:", err.message);
      setJobFamilies([]);
      return;
    }
    setJobFamilies(
      (data ?? []).map((r) => ({
        id: String((r as { id: string }).id),
        name: String((r as { name: string }).name ?? ""),
      })),
    );
  }, [organisationId]);

  const loadManagedList = useCallback(async () => {
    setManagedOrgsListError(null);
    setManagedOrgsLoading(true);
    const { data, error: listErr } = await supabase
      .from("managed_organisations")
      .select(
        "id, managing_org_id, name, domain, industry, size_band, context_notes, created_at, updated_at",
      )
      .eq("managing_org_id", organisationId)
      .order("name", { ascending: true });
    setManagedOrgsLoading(false);
    if (listErr) {
      setManagedOrgsListError(listErr.message);
      setManagedOrgs([]);
      return;
    }
    setManagedOrgs((data ?? []) as ManagedOrganisationRow[]);
  }, [organisationId]);

  const loadMembers = useCallback(async () => {
    const rows = await fetchInternalMembersForOrg(supabase, organisationId);
    setMembers(rows);
  }, [organisationId]);

  const insertManagedOrganisationFromForm = useCallback(async (): Promise<string> => {
    const n = newClientName.trim();
    if (!n) {
      throw new Error("Client name is required.");
    }
    const { data, error: moErr } = await supabase
      .from("managed_organisations")
      .insert({
        managing_org_id: organisationId,
        name: n,
        domain: newClientDomain.trim() || null,
        industry: newClientIndustry.trim() || null,
        size_band: newClientSizeBand.trim() || null,
        context_notes: newClientNotes.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (moErr || !data) {
      throw new Error(moErr?.message ?? "Could not save client organisation.");
    }
    return String((data as { id: string }).id);
  }, [
    organisationId,
    newClientName,
    newClientDomain,
    newClientIndustry,
    newClientSizeBand,
    newClientNotes,
  ]);

  async function handleSaveClientAndSelect() {
    setError(null);
    setManagedOrgsListError(null);
    if (!newClientName.trim()) {
      setError("Enter a name for the client organisation.");
      return;
    }
    setClientOrgSaving(true);
    try {
      const id = await insertManagedOrganisationFromForm();
      await loadManagedList();
      setManagedOrgId(id);
      setUseNewClientOrg(false);
      setClientOrgSaveMessage(
        "Client saved and selected. Continue with job profile and role details below.",
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save client organisation.",
      );
    } finally {
      setClientOrgSaving(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setError(null);
    setClientOrgSaveMessage(null);
    setManagedOrgsListError(null);
    void loadJobs();
    void loadJobFamilies();
    void loadManagedList();
    void loadMembers();

    if (openingToEdit) {
      setJobProfileId(openingToEdit.job_profile_id ?? "");
      setTitle(openingToEdit.title ?? "");
      setStatus(openingToEdit.status);
      setHiringManagerId(openingToEdit.hiring_manager_user_id ?? "");
      setHiringLeadId(openingToEdit.hiring_lead_user_id ?? "");
      setVisibility(openingToEdit.visibility ?? "internal_only");
      setPublicSlug(openingToEdit.public_slug?.trim() ?? "");
      setHiringForOwnOrg(true);
      setEditingManagedRoleId(null);
      setClientOrgNameReadonly(null);
      void (async () => {
        const ctx = await fetchManagedHiringForOpening(
          supabase,
          openingToEdit.id,
        );
        if (ctx) {
          setHiringForOwnOrg(false);
          setClientOrgNameReadonly(ctx.clientOrgName);
          setEditingManagedRoleId(ctx.role.id);
          setIsAnonymous(ctx.role.is_anonymous);
          setPublicName(ctx.role.public_name?.trim() ?? "");
          setSalaryMin(
            ctx.role.salary_min != null ? String(ctx.role.salary_min) : "",
          );
          setSalaryMax(
            ctx.role.salary_max != null ? String(ctx.role.salary_max) : "",
          );
          setSalaryCurrency(ctx.role.currency?.trim() ?? "");
        } else {
          setIsAnonymous(true);
          setPublicName("");
          setSalaryMin("");
          setSalaryMax("");
          setSalaryCurrency("");
        }
      })();
      return;
    }

    setTitle("");
    setJobProfileId("");
    setStatus("draft");
    setHiringLeadId("");
    setVisibility("internal_only");
    setPublicSlug("");
    setHiringForOwnOrg(true);
    setUseNewClientOrg(false);
    setManagedOrgId("");
    setNewClientName("");
    setNewClientDomain("");
    setNewClientIndustry("");
    setNewClientSizeBand("");
    setNewClientNotes("");
    setJobProfileMode("existing");
    setNewProfileFamilyId("");
    setNewProfileTitle("");
    setNewProfileLevel("");
    setIsAnonymous(true);
    setPublicName("");
    setSalaryMin("");
    setSalaryMax("");
    setSalaryCurrency("");
    setClientOrgNameReadonly(null);
    setEditingManagedRoleId(null);
    setClientOrgSaveMessage(null);
    void supabase.auth.getUser().then(({ data: { user } }) => {
      setHiringManagerId(user?.id ?? "");
    });
  }, [open, loadJobs, loadJobFamilies, loadManagedList, loadMembers, openingToEdit]);

  const hasSavedClients = managedOrgs.length > 0;

  useEffect(() => {
    if (!open || editMode) return;
    if (hiringForOwnOrg) return;
    if (managedOrgsLoading) return;
    if (managedOrgs.length === 0) {
      setUseNewClientOrg(true);
    }
  }, [
    open,
    editMode,
    hiringForOwnOrg,
    managedOrgsLoading,
    managedOrgs.length,
  ]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!hiringManagerId.trim()) {
      setError("Select a hiring manager (decision owner).");
      return;
    }

    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) {
      setError("Not signed in.");
      return;
    }

    const lead = hiringLeadId.trim() || null;
    const slugTrim = publicSlug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    if (visibility === "public_hosted" && status === "open") {
      if (!slugTrim || slugTrim.length < 2) {
        setError("Public listings need a short URL slug (e.g. senior-analyst).");
        return;
      }
    }

    const publishedAt =
      visibility === "public_hosted" && status === "open"
        ? openingToEdit?.published_at ?? new Date().toISOString()
        : null;

    let resolvedJobProfileId = jobProfileId.trim();
    if (!editMode && !hiringForOwnOrg) {
      const willInsertNewClient =
        useNewClientOrg || managedOrgs.length === 0;
      if (willInsertNewClient) {
        if (!newClientName.trim()) {
          setError("Enter a client name (or save with “Save and select for this role”).");
          return;
        }
      } else if (!managedOrgId.trim()) {
        setError("Select a saved client or add a new one above.");
        return;
      }
      if (jobProfileMode === "new") {
        if (!newProfileFamilyId.trim()) {
          setError("Select a job family for the new job profile.");
          return;
        }
        const t = newProfileTitle.trim();
        if (!t) {
          setError("Enter a job profile title.");
          return;
        }
        const levelTrim = newProfileLevel.trim();
        if (!levelTrim) {
          setError("Enter a level (e.g. M3).");
          return;
        }
      } else if (!resolvedJobProfileId) {
        setError("Select a job profile, or create a new one for this client.");
        return;
      }
    } else {
      if (!resolvedJobProfileId) {
        setError("Select a job profile.");
        return;
      }
    }

    setSaving(true);
    try {
      if (editMode && openingToEdit) {
        const { error: upErr } = await supabase
          .from("hiring_openings")
          .update({
            job_profile_id: resolvedJobProfileId,
            title: title.trim() || null,
            status,
            hiring_manager_user_id: hiringManagerId.trim(),
            hiring_lead_user_id: lead,
            visibility,
            public_slug:
              visibility === "public_hosted" && status === "open" ? slugTrim : null,
            published_at: publishedAt,
          })
          .eq("id", openingToEdit.id);
        if (upErr) {
          setError(upErr.message);
          return;
        }
        if (editingManagedRoleId) {
          const sMin = numOrNull(salaryMin);
          const sMax = numOrNull(salaryMax);
          const { error: mrErr } = await supabase
            .from("managed_roles")
            .update({
              is_anonymous: isAnonymous,
              public_name: publicName.trim() || null,
              salary_min: sMin,
              salary_max: sMax,
              currency: salaryCurrency.trim() || null,
            })
            .eq("id", editingManagedRoleId);
          if (mrErr) {
            setError(mrErr.message);
            return;
          }
        }
        onCreated();
        onClose();
        return;
      }

      if (hiringForOwnOrg) {
        const { error: insErr } = await supabase.from("hiring_openings").insert({
          organisation_id: organisationId,
          job_profile_id: resolvedJobProfileId,
          title: title.trim() || null,
          status,
          created_by: uid,
          hiring_manager_user_id: hiringManagerId.trim(),
          hiring_lead_user_id: lead,
          visibility,
          public_slug:
            visibility === "public_hosted" && status === "open" ? slugTrim : null,
          published_at: publishedAt,
        });
        if (insErr) {
          setError(insErr.message);
          return;
        }
        onCreated();
        onClose();
        return;
      }

      const insertNewClientOnSave =
        useNewClientOrg || managedOrgs.length === 0;
      let finalManagedOrgId = managedOrgId.trim();
      if (insertNewClientOnSave) {
        try {
          finalManagedOrgId = await insertManagedOrganisationFromForm();
          await loadManagedList();
          setManagedOrgId(finalManagedOrgId);
          setUseNewClientOrg(false);
        } catch (e) {
          setError(
            e instanceof Error
              ? e.message
              : "Could not save client organisation for this role.",
          );
          return;
        }
      }

      if (jobProfileMode === "new") {
        const level_name = normalizeJobProfileLevelName(newProfileLevel);
        const { data: newJp, error: jpInsErr } = await supabase
          .from("job_profiles")
          .insert({
            organisation_id: organisationId,
            job_family_id: newProfileFamilyId.trim(),
            title: newProfileTitle.trim(),
            level_name,
            is_active: true,
          })
          .select("id")
          .single();
        if (jpInsErr || !newJp) {
          setError(
            jpInsErr?.message ?? "Could not create job profile. Try a different title or level.",
          );
          return;
        }
        resolvedJobProfileId = String((newJp as { id: string }).id);
      }

      const { data: newOp, error: opErr } = await supabase
        .from("hiring_openings")
        .insert({
          organisation_id: organisationId,
          job_profile_id: resolvedJobProfileId,
          title: title.trim() || null,
          status,
          created_by: uid,
          hiring_manager_user_id: hiringManagerId.trim(),
          hiring_lead_user_id: lead,
          visibility,
          public_slug:
            visibility === "public_hosted" && status === "open" ? slugTrim : null,
          published_at: publishedAt,
        })
        .select("id")
        .single();

      if (opErr || !newOp) {
        setError(opErr?.message ?? "Could not create hiring role.");
        return;
      }
      const openingId = String((newOp as { id: string }).id);

      const sMin = numOrNull(salaryMin);
      const sMax = numOrNull(salaryMax);
      const { error: mrInsErr } = await supabase.from("managed_roles").insert({
        managed_org_id: finalManagedOrgId,
        job_profile_id: resolvedJobProfileId,
        hiring_opening_id: openingId,
        created_by: uid,
        is_anonymous: isAnonymous,
        public_name: publicName.trim() || null,
        salary_min: sMin,
        salary_max: sMax,
        currency: salaryCurrency.trim() || null,
      });
      if (mrInsErr) {
        setError(
          `${mrInsErr.message} (Hiring role was created; manage or link client context from the database if needed.)`,
        );
        return;
      }
      onCreated();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const showManagedFields = !hiringForOwnOrg;
  const isManagedEdit = editMode && !hiringForOwnOrg && clientOrgNameReadonly;
  const canPreviewJobProfile = jobProfileId.trim().length > 0;

  if (!open) return null;

  return (
    <>
      <div
        role="dialog"
        aria-modal
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.55)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 80,
          padding: 16,
        }}
        onMouseDown={(ev) => {
          if (ev.target === ev.currentTarget) onClose();
        }}
      >
        <div
          style={{
            width: "min(520px, 100%)",
            maxHeight: "min(90vh, 880px)",
            overflowY: "auto",
            backgroundColor: surface,
            border: `1px solid ${border}`,
            borderRadius: 12,
            padding: "20px 22px",
            boxSizing: "border-box",
          }}
        >
          <h3
            style={{
              margin: "0 0 14px",
              fontSize: 18,
              fontWeight: 600,
              color: text,
            }}
          >
            {editMode ? "Edit hiring role" : "Create hiring role"}
          </h3>
          <form onSubmit={onSubmit}>
            {editMode && isManagedEdit ? (
              <p
                style={{
                  margin: "0 0 12px",
                  fontSize: 12,
                  color: mutedColor,
                  lineHeight: 1.45,
                }}
              >
                Managing for{" "}
                <strong style={{ color: text }}>{clientOrgNameReadonly}</strong>{" "}
                — job profile and client are fixed; you can still update
                leadership, status, and internal fields below.
              </p>
            ) : null}

            {!editMode ? (
              <>
                <p
                  style={{
                    margin: "0 0 8px",
                    fontSize: 12,
                    fontWeight: 600,
                    color: mutedColor,
                  }}
                >
                  This role is for
                </p>
                <div
                  style={{
                    display: "grid",
                    gap: 8,
                    marginBottom: 16,
                    fontSize: 14,
                    color: text,
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="hiringFor"
                      checked={hiringForOwnOrg}
                      onChange={() => {
                        setHiringForOwnOrg(true);
                        setError(null);
                        setClientOrgSaveMessage(null);
                      }}
                    />
                    <span>Hiring for my organisation</span>
                  </label>
                  <label
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="hiringFor"
                      checked={!hiringForOwnOrg}
                      onChange={() => {
                        setHiringForOwnOrg(false);
                        setError(null);
                        setClientOrgSaveMessage(null);
                      }}
                    />
                    <span>Managing for another organisation (client context)</span>
                  </label>
                </div>
              </>
            ) : null}

            {showManagedFields && !isManagedEdit ? (
              <div style={{ marginBottom: 16 }}>
                <p
                  style={{
                    margin: "0 0 8px",
                    fontSize: 12,
                    fontWeight: 600,
                    color: mutedColor,
                  }}
                >
                  Client organisation
                </p>
                <p
                  style={{
                    margin: "0 0 10px",
                    fontSize: 12,
                    color: mutedColor,
                    lineHeight: 1.45,
                  }}
                >
                  {hasSavedClients
                    ? "Choose a saved client or add a new one. Your workspace keeps a list you can reuse on future managed roles."
                    : "Set up who you are hiring for. Save a client to your list first, then continue with job profile and the rest of the form below."}
                </p>
                {managedOrgsListError ? (
                  <div
                    style={{
                      marginBottom: 8,
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: `1px solid ${errorColor}`,
                      background: "rgba(200, 80, 80, 0.12)",
                      fontSize: 12,
                      color: errorColor,
                    }}
                  >
                    {managedOrgsListError}{" "}
                    <button
                      type="button"
                      onClick={() => void loadManagedList()}
                      style={{
                        ...btnGhost,
                        fontSize: 11,
                        padding: "2px 8px",
                        marginTop: 4,
                      }}
                    >
                      Retry
                    </button>
                  </div>
                ) : null}
                {managedOrgsLoading ? (
                  <p style={{ margin: "0 0 12px", fontSize: 12, color: mutedColor }}>
                    Loading your client list…
                  </p>
                ) : null}
                {managedOrgsListError && !managedOrgsLoading ? (
                  <p
                    style={{
                      margin: "0 0 10px",
                      fontSize: 12,
                      color: mutedColor,
                      lineHeight: 1.45,
                    }}
                  >
                    You can still add a new client with the form below. Retry
                    the list to pick an existing client.
                  </p>
                ) : null}
                {!managedOrgsLoading && hasSavedClients ? (
                <div style={{ marginBottom: 8 }}>
                  <label
                    style={{ fontSize: 13, color: text, marginRight: 12 }}
                  >
                    <input
                      type="radio"
                      name="useNewClient"
                      checked={!useNewClientOrg}
                      onChange={() => {
                        setUseNewClientOrg(false);
                        setError(null);
                        setClientOrgSaveMessage(null);
                      }}
                    />{" "}
                    Use saved client
                  </label>
                  <label style={{ fontSize: 13, color: text }}>
                    <input
                      type="radio"
                      name="useNewClient"
                      checked={useNewClientOrg}
                      onChange={() => {
                        setUseNewClientOrg(true);
                        setError(null);
                        setClientOrgSaveMessage(null);
                      }}
                    />{" "}
                    New client
                  </label>
                </div>
                ) : !managedOrgsLoading ? (
                  <p
                    style={{
                      margin: "0 0 10px",
                      fontSize: 12,
                      color: text,
                      fontWeight: 500,
                    }}
                  >
                    New client
                  </p>
                ) : null}
                {!managedOrgsLoading &&
                (useNewClientOrg || !hasSavedClients) ? (
                  <div
                    style={{ display: "grid", gap: 10, marginBottom: 10 }}
                  >
                    <input
                      type="text"
                      value={newClientName}
                      onChange={(e) => {
                        setNewClientName(e.target.value);
                        setClientOrgSaveMessage(null);
                      }}
                      placeholder="Client name (required to save)"
                      disabled={clientOrgSaving}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: 8,
                        border: `1px solid ${border}`,
                        background: fieldBg,
                        color: text,
                        fontSize: 14,
                        boxSizing: "border-box",
                        opacity: clientOrgSaving ? 0.7 : 1,
                      }}
                    />
                    <input
                      type="text"
                      value={newClientDomain}
                      onChange={(e) => setNewClientDomain(e.target.value)}
                      placeholder="Domain (optional)"
                      disabled={clientOrgSaving}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: 8,
                        border: `1px solid ${border}`,
                        background: fieldBg,
                        color: text,
                        fontSize: 14,
                        boxSizing: "border-box",
                        opacity: clientOrgSaving ? 0.7 : 1,
                      }}
                    />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <input
                        type="text"
                        value={newClientIndustry}
                        onChange={(e) => setNewClientIndustry(e.target.value)}
                        placeholder="Industry (optional)"
                        disabled={clientOrgSaving}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 8,
                          border: `1px solid ${border}`,
                          background: fieldBg,
                          color: text,
                          fontSize: 14,
                          boxSizing: "border-box",
                          opacity: clientOrgSaving ? 0.7 : 1,
                        }}
                      />
                      <input
                        type="text"
                        value={newClientSizeBand}
                        onChange={(e) => setNewClientSizeBand(e.target.value)}
                        placeholder="Size band (optional)"
                        disabled={clientOrgSaving}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 8,
                          border: `1px solid ${border}`,
                          background: fieldBg,
                          color: text,
                          fontSize: 14,
                          boxSizing: "border-box",
                          opacity: clientOrgSaving ? 0.7 : 1,
                        }}
                      />
                    </div>
                    <textarea
                      value={newClientNotes}
                      onChange={(e) => setNewClientNotes(e.target.value)}
                      placeholder="Internal context notes (optional)"
                      rows={2}
                      disabled={clientOrgSaving}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: 8,
                        border: `1px solid ${border}`,
                        background: fieldBg,
                        color: text,
                        fontSize: 14,
                        resize: "vertical",
                        boxSizing: "border-box",
                        opacity: clientOrgSaving ? 0.7 : 1,
                      }}
                    />
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                      <button
                        type="button"
                        onClick={() => void handleSaveClientAndSelect()}
                        disabled={clientOrgSaving}
                        style={{ ...btnPrimary, fontSize: 13 }}
                      >
                        {clientOrgSaving ? "Saving client…" : "Save and select for this role"}
                      </button>
                      {clientOrgSaving ? (
                        <span style={{ fontSize: 12, color: mutedColor }}>
                          Saving to your client list…
                        </span>
                      ) : null}
                    </div>
                    {clientOrgSaveMessage ? (
                      <p
                        style={{
                          margin: 0,
                          fontSize: 12,
                          color: "rgba(120, 200, 160, 0.95)",
                          lineHeight: 1.45,
                        }}
                      >
                        {clientOrgSaveMessage}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {!managedOrgsLoading && !useNewClientOrg && hasSavedClients ? (
                  <div style={{ marginTop: 4 }}>
                    <label
                      style={{
                        display: "block",
                        fontSize: 11,
                        fontWeight: 600,
                        color: mutedColor,
                        marginBottom: 4,
                      }}
                    >
                      Saved client
                    </label>
                    <select
                      value={managedOrgId}
                      onChange={(e) => {
                        setManagedOrgId(e.target.value);
                        setError(null);
                        setClientOrgSaveMessage(null);
                      }}
                      required
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: 8,
                        border: `1px solid ${border}`,
                        background: fieldBg,
                        color: text,
                        fontSize: 14,
                      }}
                    >
                      <option value="">Select a client…</option>
                      {managedOrgs.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
            ) : null}

            <label
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                color: mutedColor,
                marginBottom: 6,
              }}
            >
              Job profile
            </label>
            {showManagedFields && !isManagedEdit ? (
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 13, color: text, marginRight: 12 }}>
                  <input
                    type="radio"
                    name="jpMode"
                    checked={jobProfileMode === "existing"}
                    onChange={() => {
                      setJobProfileMode("existing");
                    }}
                  />{" "}
                  Use existing in workspace
                </label>
                <label style={{ fontSize: 13, color: text }}>
                  <input
                    type="radio"
                    name="jpMode"
                    checked={jobProfileMode === "new"}
                    onChange={() => {
                      setJobProfileMode("new");
                    }}
                  />{" "}
                  Create new profile
                </label>
              </div>
            ) : null}
            {showManagedFields && !isManagedEdit && jobProfileMode === "new" ? (
              <div
                style={{
                  display: "grid",
                  gap: 10,
                  marginBottom: 14,
                }}
              >
                <select
                  value={newProfileFamilyId}
                  onChange={(e) => setNewProfileFamilyId(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: `1px solid ${border}`,
                    background: fieldBg,
                    color: text,
                    fontSize: 14,
                  }}
                >
                  <option value="">Job family *</option>
                  {jobFamilies.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={newProfileTitle}
                  onChange={(e) => setNewProfileTitle(e.target.value)}
                  placeholder="Title *"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: `1px solid ${border}`,
                    background: fieldBg,
                    color: text,
                    fontSize: 14,
                    boxSizing: "border-box",
                  }}
                />
                <input
                  type="text"
                  value={newProfileLevel}
                  onChange={(e) => setNewProfileLevel(e.target.value)}
                  placeholder="Level (e.g. M3) *"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: `1px solid ${border}`,
                    background: fieldBg,
                    color: text,
                    fontSize: 14,
                    boxSizing: "border-box",
                  }}
                />
                <p style={{ margin: 0, fontSize: 12, color: mutedColor }}>
                  Creates a job profile in your workspace; candidates are still
                  matched on that profile.
                </p>
              </div>
            ) : (
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                marginBottom: 14,
              }}
            >
              <select
                required
                disabled={Boolean(isManagedEdit)}
                value={jobProfileId}
                onChange={(e) => setJobProfileId(e.target.value)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${border}`,
                  background: isManagedEdit ? "rgba(0,0,0,0.15)" : fieldBg,
                  color: text,
                  fontSize: 14,
                }}
              >
                <option value="">Select…</option>
                {jobProfiles.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title || j.id.slice(0, 8)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                style={btnGhost}
                disabled={!canPreviewJobProfile}
                title={
                  canPreviewJobProfile
                    ? "Preview the selected job profile"
                    : "Select a job profile in the list first"
                }
                onClick={() => {
                  if (canPreviewJobProfile) setPreviewOpen(true);
                }}
              >
                Preview
              </button>
            </div>
            )}

            {showManagedFields ? (
              <div
                style={{
                  marginBottom: 16,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${borderSubtle}`,
                  background: "rgba(0,0,0,0.12)",
                }}
              >
                <p
                  style={{
                    margin: "0 0 8px",
                    fontSize: 12,
                    fontWeight: 600,
                    color: mutedColor,
                  }}
                >
                  Listing &amp; display (client context)
                </p>
                <p
                  style={{
                    margin: "0 0 8px",
                    fontSize: 12,
                    color: mutedColor,
                    lineHeight: 1.45,
                  }}
                >
                  Client name is hidden from candidates unless you choose to
                  disclose it.
                </p>
                <label
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                    fontSize: 14,
                    color: text,
                    marginBottom: 8,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isAnonymous}
                    onChange={(e) => setIsAnonymous(e.target.checked)}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    Hide this client in candidate-facing flows (default: on;
                    uncheck to allow disclosure)
                  </span>
                </label>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 600,
                    color: mutedColor,
                    marginBottom: 4,
                  }}
                >
                  Public display name (optional)
                </label>
                <input
                  type="text"
                  value={publicName}
                  onChange={(e) => setPublicName(e.target.value)}
                  placeholder="e.g. global retail group"
                  style={{
                    width: "100%",
                    marginBottom: 8,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: `1px solid ${border}`,
                    background: fieldBg,
                    color: text,
                    fontSize: 14,
                    boxSizing: "border-box",
                  }}
                />
                <p
                  style={{
                    margin: "0 0 4px",
                    fontSize: 12,
                    fontWeight: 600,
                    color: mutedColor,
                  }}
                >
                  Internal salary reference (for your team)
                </p>
                <p
                  style={{
                    margin: "0 0 6px",
                    fontSize: 11,
                    color: mutedColor,
                    lineHeight: 1.45,
                  }}
                >
                  For recruiters only — not shown in candidate-facing flows and
                  not a request for candidate salary expectations.
                </p>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr minmax(4.5rem, 0.5fr)",
                    gap: 8,
                    alignItems: "end",
                  }}
                >
                  <div>
                    <span style={{ fontSize: 10, color: mutedColor }}>Min</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={salaryMin}
                      onChange={(e) => setSalaryMin(e.target.value)}
                      placeholder="Min"
                      style={{
                        width: "100%",
                        marginTop: 2,
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: `1px solid ${border}`,
                        background: fieldBg,
                        color: text,
                        fontSize: 14,
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <div>
                    <span style={{ fontSize: 10, color: mutedColor }}>Max</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={salaryMax}
                      onChange={(e) => setSalaryMax(e.target.value)}
                      placeholder="Max"
                      style={{
                        width: "100%",
                        marginTop: 2,
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: `1px solid ${border}`,
                        background: fieldBg,
                        color: text,
                        fontSize: 14,
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <div>
                    <span style={{ fontSize: 10, color: mutedColor }}>Currency</span>
                    <input
                      type="text"
                      value={salaryCurrency}
                      onChange={(e) => setSalaryCurrency(e.target.value.slice(0, 8))}
                      placeholder="e.g. GBP"
                      style={{
                        width: "100%",
                        marginTop: 2,
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: `1px solid ${border}`,
                        background: fieldBg,
                        color: text,
                        fontSize: 14,
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                </div>
              </div>
            ) : null}

            <label
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                color: mutedColor,
                marginBottom: 6,
              }}
            >
              Title override (optional)
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Senior Engineer — Payments"
              style={{
                width: "100%",
                marginBottom: 14,
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px solid ${border}`,
                background: fieldBg,
                color: text,
                fontSize: 14,
                boxSizing: "border-box",
              }}
            />

            <label
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                color: mutedColor,
                marginBottom: 4,
              }}
            >
              Hiring Manager
            </label>
            <p
              style={{
                margin: "0 0 8px",
                fontSize: 12,
                color: mutedColor,
                lineHeight: 1.45,
              }}
            >
              Role owner / decision owner for this hire.
            </p>
            <select
              required
              value={hiringManagerId}
              onChange={(e) => setHiringManagerId(e.target.value)}
              style={{
                width: "100%",
                marginBottom: 14,
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px solid ${border}`,
                background: fieldBg,
                color: text,
                fontSize: 14,
              }}
            >
              <option value="">Select workspace member…</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName}
                  {m.email ? ` (${m.email})` : ""}
                </option>
              ))}
            </select>

            <label
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                color: mutedColor,
                marginBottom: 4,
              }}
            >
              Hiring Lead (optional)
            </label>
            <p
              style={{
                margin: "0 0 8px",
                fontSize: 12,
                color: mutedColor,
                lineHeight: 1.45,
              }}
            >
              Recruiter or process owner — coordinates candidates through the
              pipeline.
            </p>
            <select
              value={hiringLeadId}
              onChange={(e) => setHiringLeadId(e.target.value)}
              style={{
                width: "100%",
                marginBottom: 16,
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px solid ${border}`,
                background: fieldBg,
                color: text,
                fontSize: 14,
              }}
            >
              <option value="">None</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName}
                  {m.email ? ` (${m.email})` : ""}
                </option>
              ))}
            </select>

            <label
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                color: mutedColor,
                marginBottom: 6,
              }}
            >
              Status
            </label>
            <select
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as HiringOpeningStatus)
              }
              style={{
                width: "100%",
                marginBottom: 16,
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px solid ${border}`,
                background: fieldBg,
                color: text,
                fontSize: 14,
              }}
            >
              <option value="draft">Draft</option>
              <option value="open">Open</option>
              <option value="filled">Filled</option>
              <option value="closed">Closed</option>
            </select>

            <label
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                color: mutedColor,
                marginBottom: 6,
              }}
            >
              Listing visibility
            </label>
            <select
              value={visibility}
              onChange={(e) =>
                setVisibility(e.target.value as HiringOpeningVisibility)
              }
              style={{
                width: "100%",
                marginBottom: 10,
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px solid ${border}`,
                background: fieldBg,
                color: text,
                fontSize: 14,
              }}
            >
              <option value="internal_only">Internal only (workspace)</option>
              <option value="public_hosted">Public hosted listing</option>
              <option value="external_link_only">External link only</option>
            </select>
            {visibility === "public_hosted" ? (
              <>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 600,
                    color: mutedColor,
                    marginBottom: 6,
                  }}
                >
                  Public URL slug
                </label>
                <p
                  style={{
                    margin: "0 0 8px",
                    fontSize: 12,
                    color: mutedColor,
                    lineHeight: 1.45,
                  }}
                >
                  Set the organisation&apos;s public slug under Company profile,
                  then use a unique slug for this role. Path:{" "}
                  <code style={{ color: text }}>
                    /careers/&#123;org&#125;/&#123;role-slug&#125;
                  </code>
                </p>
                <input
                  type="text"
                  value={publicSlug}
                  onChange={(e) => setPublicSlug(e.target.value)}
                  placeholder="e.g. senior-business-analyst"
                  style={{
                    width: "100%",
                    marginBottom: 16,
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: `1px solid ${border}`,
                    background: fieldBg,
                    color: text,
                    fontSize: 14,
                    boxSizing: "border-box",
                  }}
                />
              </>
            ) : null}

            {error ? (
              <p style={{ color: errorColor, fontSize: 13, margin: "0 0 12px" }}>
                {error}
              </p>
            ) : null}

            <div
              style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}
            >
              <button
                type="button"
                onClick={onClose}
                style={btnGhost}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                style={btnPrimary}
                disabled={saving || clientOrgSaving}
              >
                {saving ? "Saving…" : editMode ? "Save" : "Create"}
              </button>
            </div>
          </form>
        </div>
      </div>

      <JobProfilePreviewModal
        open={previewOpen}
        jobProfileId={jobProfileId.trim() || null}
        onClose={() => setPreviewOpen(false)}
      />
    </>
  );
}
