import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "../lib/supabase";
import type { ProfileRow, WorkspaceMembership } from "./hub/types";
import { organisationLabel } from "./hub/hubUtils";
import {
  accentMuted,
  bg,
  border,
  btn,
  errorColor,
  muted,
  mutedColor,
  panelShell,
  surface,
  text,
} from "./hub/hubTheme";

type Props = {
  activeOrgId: string | null;
  isActive: boolean;
  userEmail: string;
  activeMembership: WorkspaceMembership | undefined;
};

function fullNameFromProfile(p: {
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
}): string {
  const dn = p.display_name?.trim();
  if (dn) return dn;
  const fn = (p.first_name ?? "").trim();
  const ln = (p.last_name ?? "").trim();
  const combined = [fn, ln].filter(Boolean).join(" ");
  if (combined) return combined;
  return p.email?.trim() || "Member";
}

function formatWorkspaceRole(role: string | null | undefined): string {
  const r = role?.trim().toLowerCase() ?? "";
  const map: Record<string, string> = {
    company_admin: "Company admin",
    learning_lead: "Learning lead",
    member: "Member",
  };
  return map[r] ?? (r ? r.replace(/_/g, " ") : "—");
}

export function MyProfileSection({
  activeOrgId,
  isActive,
  userEmail,
  activeMembership,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [profileEmail, setProfileEmail] = useState(userEmail);
  const [jobTitle, setJobTitle] = useState<string | null>(null);
  const [jobLevel, setJobLevel] = useState<string | null>(null);
  const [organisationName, setOrganisationName] = useState<string | null>(null);

  const [summary, setSummary] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");

  const loadProfile = useCallback(async () => {
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

    const [profRes, ujpRes] = await Promise.all([
      supabase
        .from("profiles")
        .select(
          "id, email, display_name, first_name, last_name, summary, phone, location, linkedin_url"
        )
        .eq("id", uid)
        .maybeSingle(),
      supabase
        .from("user_job_profiles")
        .select("job_profile_id")
        .eq("organisation_id", activeOrgId)
        .eq("user_id", uid)
        .maybeSingle(),
    ]);

    if (profRes.error) {
      console.error(profRes.error);
      setLoadError(profRes.error.message);
      setLoading(false);
      return;
    }

    const row = profRes.data as ProfileRow | null;
    if (row) {
      setDisplayName(
        fullNameFromProfile({
          display_name: row.display_name,
          first_name: row.first_name,
          last_name: row.last_name,
          email: row.email ?? userEmail,
        })
      );
      setProfileEmail(row.email?.trim() || userEmail);
      setSummary(row.summary ?? "");
      setPhone(row.phone ?? "");
      setLocation(row.location ?? "");
      setLinkedinUrl(row.linkedin_url ?? "");
    } else {
      setDisplayName(fullNameFromProfile({ email: userEmail }));
      setProfileEmail(userEmail);
      setSummary("");
      setPhone("");
      setLocation("");
      setLinkedinUrl("");
    }

    let jpTitle: string | null = null;
    let jpLevel: string | null = null;
    if (!ujpRes.error && ujpRes.data) {
      const jid = (ujpRes.data as { job_profile_id: string | null })
        .job_profile_id;
      if (jid) {
        const jpRes = await supabase
          .from("job_profiles")
          .select("title, level_name")
          .eq("id", jid)
          .maybeSingle();
        if (!jpRes.error && jpRes.data) {
          const jp = jpRes.data as {
            title: string;
            level_name: string | null;
          };
          jpTitle = jp.title;
          jpLevel = jp.level_name;
        }
      }
    } else if (ujpRes.error) {
      console.warn("user_job_profiles:", ujpRes.error.message);
    }
    setJobTitle(jpTitle);
    setJobLevel(jpLevel);

    setOrganisationName(
      activeMembership ? organisationLabel(activeMembership) : null
    );

    setLoading(false);
  }, [isActive, activeOrgId, userEmail, activeMembership]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  async function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!userId) return;

    setSaving(true);
    setLoadError(null);

    const payload = {
      summary: summary.trim() || null,
      phone: phone.trim() || null,
      location: location.trim() || null,
      linkedin_url: linkedinUrl.trim() || null,
    };

    const { data: updatedRows, error } = await supabase
      .from("profiles")
      .update(payload)
      .eq("id", userId)
      .select("id");

    setSaving(false);
    if (error) {
      console.error(error);
      setLoadError(error.message || "Could not save profile.");
      return;
    }

    if (!updatedRows?.length) {
      setLoadError(
        "Could not save profile. No matching profile row was updated."
      );
      return;
    }

    await loadProfile();
  }

  if (!isActive) {
    return null;
  }

  const card = {
    padding: "18px 20px",
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
          Select a workspace to view your profile in context.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ ...panelShell, marginTop: 0 }}>
        <p style={{ ...muted, margin: 0 }}>Loading profile…</p>
      </div>
    );
  }

  const jobLine =
    jobTitle != null
      ? jobLevel
        ? `${jobTitle} · ${jobLevel}`
        : jobTitle
      : "No job profile assigned";

  return (
    <div
      style={{
        maxWidth: 640,
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      <div
        style={{
          ...card,
          backgroundColor: accentMuted,
          borderColor: "rgba(110, 176, 240, 0.22)",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 600,
            color: text,
            letterSpacing: "-0.02em",
          }}
        >
          {displayName}
        </h2>
        <p
          style={{
            margin: "10px 0 0",
            fontSize: 15,
            color: text,
            fontWeight: 500,
          }}
        >
          {jobLine}
        </p>
        <p style={{ margin: "6px 0 0", fontSize: 14, color: mutedColor }}>
          {organisationName ?? "—"}
        </p>
        {activeMembership?.workspace_role ? (
          <p
            style={{
              margin: "12px 0 0",
              fontSize: 12,
              color: mutedColor,
              opacity: 0.85,
            }}
          >
            Workspace role:{" "}
            {formatWorkspaceRole(activeMembership.workspace_role)}
          </p>
        ) : null}
      </div>

      {loadError ? (
        <p style={{ margin: 0, fontSize: 14, color: errorColor }}>{loadError}</p>
      ) : null}

      <form onSubmit={handleSave} style={{ ...card, margin: 0 }}>
        <p
          style={{
            margin: "0 0 14px",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: mutedColor,
          }}
        >
          Contact & links
        </p>
        <div style={{ display: "grid", gap: 14 }}>
          <label style={labelStyle}>
            Email
            <input
              readOnly
              value={profileEmail}
              style={{ ...inputStyle, opacity: 0.9 }}
            />
          </label>
          <label style={labelStyle}>
            Phone <span style={{ fontWeight: 400 }}>(optional)</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. +1 …"
              autoComplete="tel"
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Location <span style={{ fontWeight: 400 }}>(optional)</span>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="City, region, or country"
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            LinkedIn <span style={{ fontWeight: 400 }}>(optional)</span>
            <input
              type="url"
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              placeholder="https://www.linkedin.com/in/…"
              style={inputStyle}
            />
          </label>
        </div>

        <p
          style={{
            margin: "22px 0 10px",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: mutedColor,
          }}
        >
          About
        </p>
        <label style={{ ...labelStyle, marginBottom: 16 }}>
          Summary
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="A short statement about your role, strengths, or goals."
            rows={5}
            style={{
              ...inputStyle,
              resize: "vertical" as const,
              fontFamily: "inherit",
              lineHeight: 1.5,
            }}
          />
        </label>

        <button type="submit" disabled={saving} style={{ ...btn, fontSize: 13 }}>
          {saving ? "Saving…" : "Save profile"}
        </button>
      </form>
    </div>
  );
}
