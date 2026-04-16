import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { researchCompanyProfileFromUrl } from "../lib/companyProfileResearch";
import {
  normaliseStringArray,
  parseSemicolonSelections,
} from "../lib/organisationProfileMaps";
import {
  DELIVERY_MODEL_OPTIONS,
  KEY_DRIVER_OPTIONS,
  ORGANISATION_STRUCTURE_OPTIONS,
  PRIMARY_CAPABILITY_AREA_OPTIONS,
  REGULATORY_INTENSITY_OPTIONS,
  ROLE_MODEL_BIAS_OPTIONS,
} from "../lib/organisationProfileOptions";
import type { OrganisationProfileRow } from "./hub/types";
import { canAccessWorkspaceAdminSurfaces } from "./hub/workspaceRoles";
import { OrganisationLinkedInsightsPanel } from "./OrganisationLinkedInsightsPanel";
import {
  border,
  borderSubtle,
  btn,
  btnGhost,
  errorColor,
  inputField,
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
  workspaceRole: string | null;
};

const textareaStyle: CSSProperties = {
  ...inputField,
  minHeight: 88,
  resize: "vertical",
  lineHeight: 1.45,
};

const shortTextStyle: CSSProperties = {
  ...inputField,
};

const helperLineStyle: CSSProperties = {
  margin: "0 0 10px",
  fontSize: 13,
  color: mutedColor,
  lineHeight: 1.45,
};

const selectStyle: CSSProperties = {
  ...inputField,
  padding: "8px 10px",
};

function toggleInList(list: string[], value: string): string[] {
  if (list.includes(value)) return list.filter((x) => x !== value);
  return [...list, value];
}

type ApplyPick = {
  summary: boolean;
  strategic_focus: boolean;
  key_drivers: boolean;
  delivery_models: boolean;
  organisation_structure: boolean;
  primary_capability_areas: boolean;
  regulatory_intensity: boolean;
  role_model_bias: boolean;
  capability_focus_notes: boolean;
};

const defaultApplyPick: ApplyPick = {
  summary: true,
  strategic_focus: true,
  key_drivers: true,
  delivery_models: true,
  organisation_structure: true,
  primary_capability_areas: true,
  regulatory_intensity: true,
  role_model_bias: true,
  capability_focus_notes: true,
};

function loadStrategicFocus(row: OrganisationProfileRow): string {
  const v2 = row.strategic_focus?.trim();
  if (v2) return v2;
  return row.business_purpose?.trim() ?? "";
}

function loadKeyDrivers(row: OrganisationProfileRow): string[] {
  const fromArr = normaliseStringArray(row.key_drivers);
  if (fromArr.length) return fromArr;
  return parseSemicolonSelections(
    row.strategic_priorities,
    KEY_DRIVER_OPTIONS,
  );
}

function loadDeliveryModels(row: OrganisationProfileRow): string[] {
  const fromArr = normaliseStringArray(row.delivery_models);
  if (fromArr.length) return fromArr;
  return parseSemicolonSelections(
    row.delivery_context,
    DELIVERY_MODEL_OPTIONS,
  );
}

function loadPrimaryAreas(row: OrganisationProfileRow): string[] {
  const fromArr = normaliseStringArray(row.primary_capability_areas);
  if (fromArr.length) return fromArr;
  return parseSemicolonSelections(
    row.capability_emphasis,
    PRIMARY_CAPABILITY_AREA_OPTIONS,
  );
}

function loadCapabilityNotes(row: OrganisationProfileRow): string {
  const v = row.capability_focus_notes?.trim();
  if (v) return v;
  return [row.delivery_context, row.capability_emphasis]
    .filter((x) => x?.trim())
    .join("\n\n");
}

export function CompanyProfileSection({
  activeOrgId,
  isActive,
  workspaceRole,
}: Props) {
  const canEdit = canAccessWorkspaceAdminSurfaces(workspaceRole);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [rowId, setRowId] = useState<string | null>(null);

  const [organisation_name, setOrganisationName] = useState("");
  const [sector, setSector] = useState("");
  const [industry, setIndustry] = useState("");
  const [company_url, setCompanyUrl] = useState("");
  const [summary, setSummary] = useState("");

  const [strategic_focus, setStrategicFocus] = useState("");
  const [key_drivers, setKeyDrivers] = useState<string[]>([]);
  const [delivery_models, setDeliveryModels] = useState<string[]>([]);
  const [organisation_structure, setOrganisationStructure] = useState("");
  const [primary_capability_areas, setPrimaryCapabilityAreas] = useState<
    string[]
  >([]);
  const [capability_focus_notes, setCapabilityFocusNotes] = useState("");
  const [regulatory_intensity, setRegulatoryIntensity] = useState("");
  const [role_model_bias, setRoleModelBias] = useState("");

  const [role_interpretation_guidance, setRoleInterpretationGuidance] =
    useState("");
  const [terminology_guidance, setTerminologyGuidance] = useState("");

  const [researchOpen, setResearchOpen] = useState(false);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [researchPreview, setResearchPreview] = useState<Awaited<
    ReturnType<typeof researchCompanyProfileFromUrl>
  > | null>(null);
  const [applyPick, setApplyPick] = useState<ApplyPick>(defaultApplyPick);

  const load = useCallback(async () => {
    if (!activeOrgId || !isActive) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);

    const [orgRes, profRes] = await Promise.all([
      supabase
        .from("organisations")
        .select("name")
        .eq("id", activeOrgId)
        .maybeSingle(),
      supabase
        .from("organisation_profiles")
        .select("*")
        .eq("organisation_id", activeOrgId)
        .maybeSingle(),
    ]);

    if (orgRes.error) {
      console.warn("[company_profile] organisations:", orgRes.error.message);
    }

    const defaultOrgName =
      (orgRes.data as { name?: string } | null)?.name?.trim() ?? "";

    if (profRes.error) {
      setLoadError(profRes.error.message);
      setRowId(null);
      setOrganisationName(defaultOrgName);
      setSector("");
      setIndustry("");
      setCompanyUrl("");
      setSummary("");
      setStrategicFocus("");
      setKeyDrivers([]);
      setDeliveryModels([]);
      setOrganisationStructure("");
      setPrimaryCapabilityAreas([]);
      setCapabilityFocusNotes("");
      setRegulatoryIntensity("");
      setRoleModelBias("");
      setRoleInterpretationGuidance("");
      setTerminologyGuidance("");
      setLoading(false);
      return;
    }

    const row = profRes.data as OrganisationProfileRow | null;
    if (row) {
      setRowId(row.id);
      setOrganisationName(row.organisation_name?.trim() ?? defaultOrgName);
      setSector(row.sector ?? "");
      setIndustry(row.industry ?? "");
      setCompanyUrl(row.company_url?.trim() ?? "");
      setSummary(row.summary ?? "");
      setStrategicFocus(loadStrategicFocus(row));
      setKeyDrivers(loadKeyDrivers(row));
      setDeliveryModels(loadDeliveryModels(row));
      setOrganisationStructure(row.organisation_structure?.trim() ?? "");
      setPrimaryCapabilityAreas(loadPrimaryAreas(row));
      setCapabilityFocusNotes(loadCapabilityNotes(row));
      setRegulatoryIntensity(row.regulatory_intensity?.trim() ?? "");
      setRoleModelBias(row.role_model_bias?.trim() ?? "");
      setRoleInterpretationGuidance(row.role_interpretation_guidance ?? "");
      setTerminologyGuidance(row.terminology_guidance ?? "");
    } else {
      setRowId(null);
      setOrganisationName(defaultOrgName);
      setSector("");
      setIndustry("");
      setCompanyUrl("");
      setSummary("");
      setStrategicFocus("");
      setKeyDrivers([]);
      setDeliveryModels([]);
      setOrganisationStructure("");
      setPrimaryCapabilityAreas([]);
      setCapabilityFocusNotes("");
      setRegulatoryIntensity("");
      setRoleModelBias("");
      setRoleInterpretationGuidance("");
      setTerminologyGuidance("");
    }

    setLoading(false);
  }, [activeOrgId, isActive]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  function buildPersistencePayload() {
    const sf = strategic_focus.trim() || null;
    const kd = key_drivers;
    const dm = delivery_models;
    const pca = primary_capability_areas;
    const now = new Date().toISOString();
    return {
      organisation_name: organisation_name.trim() || null,
      sector: sector.trim() || null,
      industry: industry.trim() || null,
      company_url: company_url.trim() || null,
      summary: summary.trim() || null,
      strategic_focus: sf,
      key_drivers: kd,
      delivery_models: dm,
      organisation_structure: organisation_structure.trim() || null,
      primary_capability_areas: pca,
      capability_focus_notes: capability_focus_notes.trim() || null,
      regulatory_intensity: regulatory_intensity.trim() || null,
      role_model_bias: role_model_bias.trim() || null,
      role_interpretation_guidance: role_interpretation_guidance.trim() || null,
      terminology_guidance: terminology_guidance.trim() || null,
      business_purpose: sf,
      strategic_priorities: kd.length > 0 ? kd.join("; ") : null,
      delivery_context: dm.length > 0 ? dm.join("; ") : null,
      capability_emphasis: pca.length > 0 ? pca.join("; ") : null,
      updated_at: now,
    };
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeOrgId || !canEdit) return;
    const organisationId = activeOrgId.trim();
    if (!organisationId) {
      setSaveError("No workspace selected.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    const payload = buildPersistencePayload();

    let saveErr: { message: string } | null = null;
    if (rowId) {
      const updateBody = {
        organisation_name: payload.organisation_name,
        sector: payload.sector,
        industry: payload.industry,
        company_url: payload.company_url,
        summary: payload.summary,
        strategic_focus: payload.strategic_focus,
        key_drivers: payload.key_drivers,
        delivery_models: payload.delivery_models,
        organisation_structure: payload.organisation_structure,
        primary_capability_areas: payload.primary_capability_areas,
        capability_focus_notes: payload.capability_focus_notes,
        regulatory_intensity: payload.regulatory_intensity,
        role_model_bias: payload.role_model_bias,
        business_purpose: payload.business_purpose,
        strategic_priorities: payload.strategic_priorities,
        delivery_context: payload.delivery_context,
        capability_emphasis: payload.capability_emphasis,
        role_interpretation_guidance: payload.role_interpretation_guidance,
        terminology_guidance: payload.terminology_guidance,
        updated_at: payload.updated_at,
      };
      const res = await supabase
        .from("organisation_profiles")
        .update(updateBody)
        .eq("id", rowId)
        .eq("organisation_id", organisationId);
      saveErr = res.error;
    } else {
      const insertBody = {
        organisation_id: organisationId,
        organisation_name: payload.organisation_name,
        sector: payload.sector,
        industry: payload.industry,
        company_url: payload.company_url,
        summary: payload.summary,
        strategic_focus: payload.strategic_focus,
        key_drivers: payload.key_drivers,
        delivery_models: payload.delivery_models,
        organisation_structure: payload.organisation_structure,
        primary_capability_areas: payload.primary_capability_areas,
        capability_focus_notes: payload.capability_focus_notes,
        regulatory_intensity: payload.regulatory_intensity,
        role_model_bias: payload.role_model_bias,
        business_purpose: payload.business_purpose,
        strategic_priorities: payload.strategic_priorities,
        delivery_context: payload.delivery_context,
        capability_emphasis: payload.capability_emphasis,
        role_interpretation_guidance: payload.role_interpretation_guidance,
        terminology_guidance: payload.terminology_guidance,
        updated_at: payload.updated_at,
      };
      const res = await supabase
        .from("organisation_profiles")
        .insert(insertBody);
      saveErr = res.error;
    }

    setSaving(false);
    if (saveErr) {
      console.error(saveErr);
      setSaveError(saveErr.message || "Could not save company profile.");
      return;
    }
    await load();
  }

  async function handleResearchClick() {
    const u = company_url.trim();
    if (!u) {
      setResearchError("Add a company URL first.");
      return;
    }
    setResearchError(null);
    setResearchLoading(true);
    try {
      const result = await researchCompanyProfileFromUrl(u);
      setResearchPreview(result);
      setApplyPick({ ...defaultApplyPick });
      setResearchOpen(true);
    } catch (e) {
      setResearchError(
        e instanceof Error ? e.message : "Research could not complete.",
      );
    } finally {
      setResearchLoading(false);
    }
  }

  function applyResearchSelections(all: boolean) {
    if (!researchPreview) return;
    const p = researchPreview.suggestions;
    const pick = all ? defaultApplyPick : applyPick;

    if (pick.summary && p.summary) {
      setSummary(p.summary);
    }
    if (pick.strategic_focus && p.strategic_focus) {
      setStrategicFocus(p.strategic_focus);
    }
    if (pick.key_drivers && (p.key_drivers.length > 0 || all)) {
      setKeyDrivers([...p.key_drivers]);
    }
    if (pick.delivery_models && (p.delivery_models.length > 0 || all)) {
      setDeliveryModels([...p.delivery_models]);
    }
    if (pick.organisation_structure && p.organisation_structure) {
      setOrganisationStructure(p.organisation_structure);
    }
    if (
      pick.primary_capability_areas &&
      (p.primary_capability_areas.length > 0 || all)
    ) {
      setPrimaryCapabilityAreas([...p.primary_capability_areas]);
    }
    if (pick.regulatory_intensity && p.regulatory_intensity) {
      setRegulatoryIntensity(p.regulatory_intensity);
    }
    if (pick.role_model_bias && p.role_model_bias) {
      setRoleModelBias(p.role_model_bias);
    }
    if (pick.capability_focus_notes && p.capability_focus_notes) {
      setCapabilityFocusNotes(p.capability_focus_notes);
    }

    setResearchOpen(false);
    setResearchPreview(null);
  }

  if (!isActive) {
    return null;
  }

  if (!activeOrgId) {
    return (
      <div style={{ ...panelShell, marginTop: 0 }}>
        <p style={{ ...muted, margin: 0 }}>
          Select a workspace to edit the company profile.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ ...panelShell, marginTop: 0 }}>
        <p style={{ ...muted, margin: 0 }}>Loading…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <p style={{ marginTop: 0, fontSize: 14, color: errorColor }}>{loadError}</p>
    );
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <header style={{ marginBottom: 20 }}>
        <h2
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 600,
            color: text,
            letterSpacing: "-0.02em",
          }}
        >
          Company Profile
        </h2>
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 14,
            color: mutedColor,
            lineHeight: 1.5,
          }}
        >
          Structured context for this workspace so roles and AI features align
          with how your organisation works. Website research only suggests
          values — you choose what to keep.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        style={{
          ...panelShell,
          marginTop: 0,
          display: "grid",
          gap: 22,
        }}
      >
        {saveError ? (
          <p style={{ margin: 0, fontSize: 14, color: errorColor }}>{saveError}</p>
        ) : null}

        {!canEdit ? (
          <p style={{ margin: 0, fontSize: 13, color: mutedColor }}>
            You can view this profile. Only workspace admins can edit.
          </p>
        ) : null}

        <div>
          <p style={{ ...sectionEyebrow, marginBottom: 10 }}>Organisation</p>
          <div style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Organisation name
              <input
                type="text"
                value={organisation_name}
                onChange={(e) => setOrganisationName(e.target.value)}
                disabled={!canEdit}
                style={shortTextStyle}
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Sector
              <input
                type="text"
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                disabled={!canEdit}
                style={shortTextStyle}
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Industry
              <input
                type="text"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                disabled={!canEdit}
                style={shortTextStyle}
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Company URL
              <input
                type="url"
                value={company_url}
                onChange={(e) => setCompanyUrl(e.target.value)}
                disabled={!canEdit}
                style={shortTextStyle}
                placeholder="https://"
              />
            </label>
            <p style={{ ...helperLineStyle, marginTop: -4 }}>
              Used to research and enrich company context (optional).
            </p>
            {canEdit ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  disabled={researchLoading}
                  onClick={() => void handleResearchClick()}
                  style={btnGhost}
                >
                  {researchLoading ? "Researching…" : "Research from URL"}
                </button>
                {researchError ? (
                  <span style={{ fontSize: 13, color: errorColor }}>
                    {researchError}
                  </span>
                ) : null}
              </div>
            ) : null}
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Summary
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                disabled={!canEdit}
                style={textareaStyle}
                rows={3}
                placeholder="Short snapshot of the organisation (optional)."
              />
            </label>
          </div>
        </div>

        <div>
          <p style={{ ...sectionEyebrow, marginBottom: 10 }}>Strategy</p>
          <div style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Strategic focus
              <textarea
                value={strategic_focus}
                onChange={(e) => setStrategicFocus(e.target.value)}
                disabled={!canEdit}
                style={textareaStyle}
                rows={4}
                placeholder="What the organisation is trying to achieve and where it competes."
              />
            </label>
            <div>
              <span
                style={{ fontSize: 13, color: mutedColor, display: "block", marginBottom: 8 }}
              >
                Key drivers
              </span>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "10px 14px",
                }}
              >
                {KEY_DRIVER_OPTIONS.map((opt) => (
                  <label
                    key={opt}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 13,
                      color: text,
                      cursor: canEdit ? "pointer" : "default",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={key_drivers.includes(opt)}
                      onChange={() =>
                        canEdit && setKeyDrivers(toggleInList(key_drivers, opt))
                      }
                      disabled={!canEdit}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div>
          <p style={{ ...sectionEyebrow, marginBottom: 10 }}>Operating model</p>
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <span
                style={{ fontSize: 13, color: mutedColor, display: "block", marginBottom: 8 }}
              >
                Delivery models
              </span>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "10px 14px",
                }}
              >
                {DELIVERY_MODEL_OPTIONS.map((opt) => (
                  <label
                    key={opt}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 13,
                      color: text,
                      cursor: canEdit ? "pointer" : "default",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={delivery_models.includes(opt)}
                      onChange={() =>
                        canEdit &&
                        setDeliveryModels(toggleInList(delivery_models, opt))
                      }
                      disabled={!canEdit}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            </div>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Organisation structure
              <select
                value={organisation_structure}
                onChange={(e) => setOrganisationStructure(e.target.value)}
                disabled={!canEdit}
                style={selectStyle}
              >
                <option value="">— Select —</option>
                {ORGANISATION_STRUCTURE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div>
          <p style={{ ...sectionEyebrow, marginBottom: 10 }}>Capability focus</p>
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <span
                style={{ fontSize: 13, color: mutedColor, display: "block", marginBottom: 8 }}
              >
                Primary areas
              </span>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "10px 14px",
                }}
              >
                {PRIMARY_CAPABILITY_AREA_OPTIONS.map((opt) => (
                  <label
                    key={opt}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 13,
                      color: text,
                      cursor: canEdit ? "pointer" : "default",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={primary_capability_areas.includes(opt)}
                      onChange={() =>
                        canEdit &&
                        setPrimaryCapabilityAreas(
                          toggleInList(primary_capability_areas, opt),
                        )
                      }
                      disabled={!canEdit}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            </div>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Notes (optional)
              <textarea
                value={capability_focus_notes}
                onChange={(e) => setCapabilityFocusNotes(e.target.value)}
                disabled={!canEdit}
                style={textareaStyle}
                rows={3}
                placeholder="Extra nuance on capabilities or delivery."
              />
            </label>
          </div>
        </div>

        <div>
          <p style={{ ...sectionEyebrow, marginBottom: 10 }}>Regulatory context</p>
          <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
            Regulatory intensity
            <select
              value={regulatory_intensity}
              onChange={(e) => setRegulatoryIntensity(e.target.value)}
              disabled={!canEdit}
              style={selectStyle}
            >
              <option value="">— Select —</option>
              {REGULATORY_INTENSITY_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div
          style={{
            paddingTop: 4,
            borderTop: `1px solid ${borderSubtle}`,
          }}
        >
          <p style={{ ...sectionEyebrow, marginBottom: 10 }}>
            AI interpretation
          </p>
          <p style={helperLineStyle}>
            Optional hints for titles, seniority, and internal language when
            generating or analysing roles.
          </p>
          <div style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Role model bias
              <select
                value={role_model_bias}
                onChange={(e) => setRoleModelBias(e.target.value)}
                disabled={!canEdit}
                style={selectStyle}
              >
                <option value="">— Select —</option>
                {ROLE_MODEL_BIAS_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Role interpretation guidance
              <textarea
                value={role_interpretation_guidance}
                onChange={(e) => setRoleInterpretationGuidance(e.target.value)}
                disabled={!canEdit}
                style={textareaStyle}
                rows={3}
                placeholder='e.g. Here, "Lead" means delivery ownership.'
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Terminology guidance
              <textarea
                value={terminology_guidance}
                onChange={(e) => setTerminologyGuidance(e.target.value)}
                disabled={!canEdit}
                style={textareaStyle}
                rows={3}
                placeholder="How your organisation uses specific terms."
              />
            </label>
          </div>
        </div>

        {canEdit ? (
          <div>
            <button type="submit" disabled={saving} style={btn}>
              {saving ? "Saving…" : "Save company profile"}
            </button>
          </div>
        ) : null}
      </form>

      {researchOpen && researchPreview ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="research-preview-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1200,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setResearchOpen(false);
              setResearchPreview(null);
            }
          }}
        >
          <div
            style={{
              maxWidth: 600,
              width: "100%",
              maxHeight: "90vh",
              overflow: "auto",
              border: `1px solid ${border}`,
              borderRadius: 10,
              padding: 20,
              background: surface,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3
              id="research-preview-title"
              style={{ margin: "0 0 12px", fontSize: 18, color: text }}
            >
              Suggested values (preview)
            </h3>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: mutedColor }}>
              Sources: homepage
              {researchPreview.sources.about_page
                ? ` + about page`
                : ""}. These are suggestions only — nothing is saved until you
              choose Apply and then Save.
            </p>

            <div style={{ display: "grid", gap: 14, marginBottom: 16 }}>
              <label
                style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13 }}
              >
                <input
                  type="checkbox"
                  checked={applyPick.summary}
                  onChange={(e) =>
                    setApplyPick((p) => ({
                      ...p,
                      summary: e.target.checked,
                    }))
                  }
                  style={{ marginTop: 3 }}
                />
                <span style={{ flex: 1, color: mutedColor, minWidth: 0 }}>
                  <strong style={{ color: text }}>Summary</strong>
                  <span
                    style={{
                      display: "block",
                      fontSize: 11,
                      color: mutedColor,
                      marginBottom: 6,
                      fontWeight: 400,
                    }}
                  >
                    Organisation overview — who they are and what they do (1–3
                    sentences).
                  </span>
                  <div
                    style={{
                      whiteSpace: "pre-wrap",
                      lineHeight: 1.5,
                      maxHeight: 160,
                      overflowY: "auto",
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: `1px solid ${borderSubtle}`,
                      background: "rgba(0,0,0,0.2)",
                      fontSize: 13,
                      color: researchPreview.suggestions.summary ? text : mutedColor,
                      fontStyle: researchPreview.suggestions.summary ? "normal" : "italic",
                    }}
                  >
                    {researchPreview.suggestions.summary
                      ? researchPreview.suggestions.summary
                      : "No summary could be inferred from the website content."}
                  </div>
                </span>
              </label>
              <label
                style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13 }}
              >
                <input
                  type="checkbox"
                  checked={applyPick.strategic_focus}
                  onChange={(e) =>
                    setApplyPick((p) => ({
                      ...p,
                      strategic_focus: e.target.checked,
                    }))
                  }
                  style={{ marginTop: 3 }}
                />
                <span style={{ flex: 1, color: mutedColor, minWidth: 0 }}>
                  <strong style={{ color: text }}>Strategic focus</strong>
                  <span
                    style={{
                      display: "block",
                      fontSize: 11,
                      color: mutedColor,
                      marginBottom: 6,
                      fontWeight: 400,
                    }}
                  >
                    Short directional line — complements Key drivers; should not
                    repeat Summary.
                  </span>
                  <div
                    style={{
                      lineHeight: 1.35,
                      fontSize: 13,
                      fontWeight: 500,
                      color: text,
                      overflow: "hidden",
                      display: "-webkit-box",
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: "vertical",
                      wordBreak: "break-word",
                    }}
                  >
                    {researchPreview.suggestions.strategic_focus || "—"}
                  </div>
                </span>
              </label>
              <label
                style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13 }}
              >
                <input
                  type="checkbox"
                  checked={applyPick.key_drivers}
                  onChange={(e) =>
                    setApplyPick((p) => ({ ...p, key_drivers: e.target.checked }))
                  }
                  style={{ marginTop: 3 }}
                />
                <span style={{ flex: 1, color: mutedColor }}>
                  <strong style={{ color: text }}>Key drivers</strong>
                  <br />
                  {researchPreview.suggestions.key_drivers.length
                    ? researchPreview.suggestions.key_drivers.join(", ")
                    : "—"}
                </span>
              </label>
              <label
                style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13 }}
              >
                <input
                  type="checkbox"
                  checked={applyPick.delivery_models}
                  onChange={(e) =>
                    setApplyPick((p) => ({
                      ...p,
                      delivery_models: e.target.checked,
                    }))
                  }
                  style={{ marginTop: 3 }}
                />
                <span style={{ flex: 1, color: mutedColor }}>
                  <strong style={{ color: text }}>Delivery models</strong>
                  <br />
                  {researchPreview.suggestions.delivery_models.length
                    ? researchPreview.suggestions.delivery_models.join(", ")
                    : "—"}
                </span>
              </label>
              <label
                style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13 }}
              >
                <input
                  type="checkbox"
                  checked={applyPick.organisation_structure}
                  onChange={(e) =>
                    setApplyPick((p) => ({
                      ...p,
                      organisation_structure: e.target.checked,
                    }))
                  }
                  style={{ marginTop: 3 }}
                />
                <span style={{ flex: 1, color: mutedColor }}>
                  <strong style={{ color: text }}>Organisation structure</strong>
                  <br />
                  {researchPreview.suggestions.organisation_structure || "—"}
                </span>
              </label>
              <label
                style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13 }}
              >
                <input
                  type="checkbox"
                  checked={applyPick.primary_capability_areas}
                  onChange={(e) =>
                    setApplyPick((p) => ({
                      ...p,
                      primary_capability_areas: e.target.checked,
                    }))
                  }
                  style={{ marginTop: 3 }}
                />
                <span style={{ flex: 1, color: mutedColor }}>
                  <strong style={{ color: text }}>Primary capability areas</strong>
                  <br />
                  {researchPreview.suggestions.primary_capability_areas.length
                    ? researchPreview.suggestions.primary_capability_areas.join(
                        ", ",
                      )
                    : "—"}
                </span>
              </label>
              <label
                style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13 }}
              >
                <input
                  type="checkbox"
                  checked={applyPick.regulatory_intensity}
                  onChange={(e) =>
                    setApplyPick((p) => ({
                      ...p,
                      regulatory_intensity: e.target.checked,
                    }))
                  }
                  style={{ marginTop: 3 }}
                />
                <span style={{ flex: 1, color: mutedColor }}>
                  <strong style={{ color: text }}>Regulatory intensity</strong>
                  <br />
                  {researchPreview.suggestions.regulatory_intensity || "—"}
                </span>
              </label>
              <label
                style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13 }}
              >
                <input
                  type="checkbox"
                  checked={applyPick.role_model_bias}
                  onChange={(e) =>
                    setApplyPick((p) => ({
                      ...p,
                      role_model_bias: e.target.checked,
                    }))
                  }
                  style={{ marginTop: 3 }}
                />
                <span style={{ flex: 1, color: mutedColor }}>
                  <strong style={{ color: text }}>Role model bias</strong>
                  <br />
                  {researchPreview.suggestions.role_model_bias || "—"}
                </span>
              </label>
              <label
                style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13 }}
              >
                <input
                  type="checkbox"
                  checked={applyPick.capability_focus_notes}
                  onChange={(e) =>
                    setApplyPick((p) => ({
                      ...p,
                      capability_focus_notes: e.target.checked,
                    }))
                  }
                  style={{ marginTop: 3 }}
                />
                <span style={{ flex: 1, color: mutedColor }}>
                  <strong style={{ color: text }}>Capability notes</strong>
                  <br />
                  {researchPreview.suggestions.capability_focus_notes || "—"}
                </span>
              </label>
            </div>

            {researchPreview.suggestions.rationale ? (
              <p
                style={{
                  margin: "0 0 16px",
                  fontSize: 12,
                  color: mutedColor,
                  fontStyle: "italic",
                }}
              >
                {researchPreview.suggestions.rationale}
              </p>
            ) : null}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                style={btn}
                onClick={() => applyResearchSelections(true)}
              >
                Apply all to form
              </button>
              <button
                type="button"
                style={btnGhost}
                onClick={() => applyResearchSelections(false)}
              >
                Apply selected
              </button>
              <button
                type="button"
                style={btnGhost}
                onClick={() => {
                  setResearchOpen(false);
                  setResearchPreview(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <OrganisationLinkedInsightsPanel
        activeOrgId={activeOrgId}
        isActive={isActive}
        workspaceRole={workspaceRole}
      />
    </div>
  );
}
