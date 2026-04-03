import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { supabase } from "../lib/supabase";
import type { OrganisationProfileRow } from "./hub/types";
import { canAccessWorkspaceAdminSurfaces } from "./hub/workspaceRoles";
import { OrganisationLinkedInsightsPanel } from "./OrganisationLinkedInsightsPanel";
import {
  btn,
  errorColor,
  inputField,
  muted,
  mutedColor,
  panelShell,
  sectionEyebrow,
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

const placeholders = {
  summary:
    "e.g. Mid-size professional services firm focused on regulated sectors; ~500 people across UK and EU.",
  business_purpose:
    "e.g. Help clients modernise legacy systems safely while meeting audit and data-protection obligations.",
  strategic_priorities:
    "e.g. Grow recurring revenue; shorten time-to-compliance for new offerings; deepen partner ecosystem.",
  delivery_context:
    "e.g. Cross-functional squads aligned to value streams; quarterly planning; heavy stakeholder sign-off in finance.",
  capability_emphasis:
    "e.g. Strong emphasis on stakeholder management, regulatory literacy, and evidence-based prioritisation.",
  role_interpretation_guidance:
    "e.g. Here, “Lead” means delivery ownership; “Principal” is deep IC expertise without people management.",
  terminology_guidance:
    "e.g. “Programme” = multi-year initiative; “Stream” = long-lived product line; “BAU” = run-the-business work.",
} as const;

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
  const [summary, setSummary] = useState("");
  const [business_purpose, setBusinessPurpose] = useState("");
  const [strategic_priorities, setStrategicPriorities] = useState("");
  const [delivery_context, setDeliveryContext] = useState("");
  const [capability_emphasis, setCapabilityEmphasis] = useState("");
  const [role_interpretation_guidance, setRoleInterpretationGuidance] =
    useState("");
  const [terminology_guidance, setTerminologyGuidance] = useState("");

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
      setSummary("");
      setBusinessPurpose("");
      setStrategicPriorities("");
      setDeliveryContext("");
      setCapabilityEmphasis("");
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
      setSummary(row.summary ?? "");
      setBusinessPurpose(row.business_purpose ?? "");
      setStrategicPriorities(row.strategic_priorities ?? "");
      setDeliveryContext(row.delivery_context ?? "");
      setCapabilityEmphasis(row.capability_emphasis ?? "");
      setRoleInterpretationGuidance(row.role_interpretation_guidance ?? "");
      setTerminologyGuidance(row.terminology_guidance ?? "");
    } else {
      setRowId(null);
      setOrganisationName(defaultOrgName);
      setSector("");
      setIndustry("");
      setSummary("");
      setBusinessPurpose("");
      setStrategicPriorities("");
      setDeliveryContext("");
      setCapabilityEmphasis("");
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
    const now = new Date().toISOString();
    const payload = {
      organisation_id: organisationId,
      organisation_name: organisation_name.trim() || null,
      sector: sector.trim() || null,
      industry: industry.trim() || null,
      summary: summary.trim() || null,
      business_purpose: business_purpose.trim() || null,
      strategic_priorities: strategic_priorities.trim() || null,
      delivery_context: delivery_context.trim() || null,
      capability_emphasis: capability_emphasis.trim() || null,
      role_interpretation_guidance: role_interpretation_guidance.trim() || null,
      terminology_guidance: terminology_guidance.trim() || null,
      updated_at: now,
    };

    let saveErr: { message: string } | null = null;
    if (rowId) {
      const updateBody = {
        organisation_name: payload.organisation_name,
        sector: payload.sector,
        industry: payload.industry,
        summary: payload.summary,
        business_purpose: payload.business_purpose,
        strategic_priorities: payload.strategic_priorities,
        delivery_context: payload.delivery_context,
        capability_emphasis: payload.capability_emphasis,
        role_interpretation_guidance: payload.role_interpretation_guidance,
        terminology_guidance: payload.terminology_guidance,
        updated_at: now,
      };
      if (import.meta.env.DEV) {
        console.log("[company_profile_debug] organisation_profiles save", {
          savePath: "update" as const,
          activeOrgId,
          profileRowId: rowId,
          organisationIdUsed: organisationId,
          updateBody,
        });
      }
      const res = await supabase
        .from("organisation_profiles")
        .update(updateBody)
        .eq("id", rowId)
        .eq("organisation_id", organisationId);
      saveErr = res.error;
      if (import.meta.env.DEV) {
        console.log("[company_profile_debug] UPDATE response", {
          error: res.error?.message ?? null,
          data: res.data,
          status: res.status,
        });
      }
    } else {
      const insertBody = {
        organisation_id: organisationId,
        organisation_name: payload.organisation_name,
        sector: payload.sector,
        industry: payload.industry,
        summary: payload.summary,
        business_purpose: payload.business_purpose,
        strategic_priorities: payload.strategic_priorities,
        delivery_context: payload.delivery_context,
        capability_emphasis: payload.capability_emphasis,
        role_interpretation_guidance: payload.role_interpretation_guidance,
        terminology_guidance: payload.terminology_guidance,
        updated_at: now,
      };
      if (import.meta.env.DEV) {
        console.log("[company_profile_debug] organisation_profiles save", {
          savePath: "insert" as const,
          activeOrgId,
          fullInsertPayload: insertBody,
          organisation_id: insertBody.organisation_id,
          organisation_name: insertBody.organisation_name,
          organisation_id_matches_workspace:
            insertBody.organisation_id === organisationId &&
            organisationId === activeOrgId.trim(),
        });
      }
      const res = await supabase
        .from("organisation_profiles")
        .insert(insertBody);
      saveErr = res.error;
      if (import.meta.env.DEV) {
        console.log("[company_profile_debug] INSERT response", {
          error: res.error?.message ?? null,
          data: res.data,
          status: res.status,
        });
      }
    }

    setSaving(false);
    if (saveErr) {
      console.error(saveErr);
      setSaveError(saveErr.message || "Could not save company profile.");
      return;
    }
    await load();
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
          Structured context for this workspace — roles, competencies, and
          development aligned to how your organisation actually works.
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
          <p style={{ ...sectionEyebrow, marginBottom: 10 }}>Basic context</p>
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
              Summary
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                disabled={!canEdit}
                style={textareaStyle}
                rows={4}
                placeholder={placeholders.summary}
              />
            </label>
          </div>
        </div>

        <div>
          <p style={{ ...sectionEyebrow, marginBottom: 10 }}>Strategic context</p>
          <div style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Business purpose
              <textarea
                value={business_purpose}
                onChange={(e) => setBusinessPurpose(e.target.value)}
                disabled={!canEdit}
                style={textareaStyle}
                rows={4}
                placeholder={placeholders.business_purpose}
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Strategic priorities
              <textarea
                value={strategic_priorities}
                onChange={(e) => setStrategicPriorities(e.target.value)}
                disabled={!canEdit}
                style={textareaStyle}
                rows={4}
                placeholder={placeholders.strategic_priorities}
              />
            </label>
          </div>
        </div>

        <div>
          <p style={{ ...sectionEyebrow, marginBottom: 10 }}>Delivery context</p>
          <p style={helperLineStyle}>
            How work is organised and executed here — structure, cadence, and constraints that shape delivery.
          </p>
          <div style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Delivery context
              <textarea
                value={delivery_context}
                onChange={(e) => setDeliveryContext(e.target.value)}
                disabled={!canEdit}
                style={textareaStyle}
                rows={4}
                placeholder={placeholders.delivery_context}
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Capability emphasis
              <textarea
                value={capability_emphasis}
                onChange={(e) => setCapabilityEmphasis(e.target.value)}
                disabled={!canEdit}
                style={textareaStyle}
                rows={4}
                placeholder={placeholders.capability_emphasis}
              />
            </label>
          </div>
        </div>

        <div>
          <p style={{ ...sectionEyebrow, marginBottom: 10 }}>
            AI interpretation guidance
          </p>
          <p style={helperLineStyle}>
            Optional hints so AI features interpret job titles, seniority, and internal language the way your organisation intends.
          </p>
          <div style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Role interpretation guidance
              <textarea
                value={role_interpretation_guidance}
                onChange={(e) => setRoleInterpretationGuidance(e.target.value)}
                disabled={!canEdit}
                style={textareaStyle}
                rows={4}
                placeholder={placeholders.role_interpretation_guidance}
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: mutedColor }}>
              Terminology guidance
              <textarea
                value={terminology_guidance}
                onChange={(e) => setTerminologyGuidance(e.target.value)}
                disabled={!canEdit}
                style={textareaStyle}
                rows={4}
                placeholder={placeholders.terminology_guidance}
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

      <OrganisationLinkedInsightsPanel
        activeOrgId={activeOrgId}
        isActive={isActive}
        workspaceRole={workspaceRole}
      />
    </div>
  );
}
