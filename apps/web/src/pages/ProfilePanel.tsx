import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../lib/supabase";
import type { ProfileRow, WorkspaceMembership } from "./hub/types";
import {
  fullNameFromProfile,
  organisationLabel,
  profileInitials,
} from "./hub/hubUtils";
import {
  accent,
  bg,
  border,
  btnPrimary,
  errorColor,
  mutedColor,
  surface,
  text,
} from "./hub/hubTheme";
import styles from "./MyDashboard.module.css";
import { ProfileSecurity2fa } from "./ProfileSecurity2fa";
import { ProfileCvPrefillSection } from "./ProfileCvPrefillSection";

function profileNamePreview(
  fn: string,
  ln: string,
  legacy: string | null,
  email: string,
): string {
  const f = fn.trim();
  const l = ln.trim();
  if (f || l) return [f, l].filter(Boolean).join(" ");
  const d = legacy?.trim();
  if (d) return d;
  return fullNameFromProfile({ email });
}

type Props = {
  open: boolean;
  onClose: () => void;
  userEmail: string;
  activeOrgId: string | null;
  activeMembership: WorkspaceMembership | undefined;
  onProfileUpdated?: () => void;
};

export function ProfilePanel({
  open,
  onClose,
  userEmail,
  activeOrgId,
  activeMembership,
  onProfileUpdated,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  /** Legacy single field; cleared when structured first/last are saved. */
  const [legacyDisplayName, setLegacyDisplayName] = useState<string | null>(
    null,
  );
  const [initialsSource, setInitialsSource] = useState<{
    first_name?: string | null;
    last_name?: string | null;
    display_name?: string | null;
    email?: string | null;
  }>({});
  const [profileEmail, setProfileEmail] = useState(userEmail);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [jobTitle, setJobTitle] = useState<string | null>(null);
  const [jobLevel, setJobLevel] = useState<string | null>(null);
  const [organisationName, setOrganisationName] = useState<string | null>(null);

  const [summary, setSummary] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [primaryAccountType, setPrimaryAccountType] = useState<string | null>(
    null,
  );

  const loadProfile = useCallback(async () => {
    if (!open) {
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

    const profRes = await supabase
      .from("profiles")
      .select(
        "id, email, recovery_email, display_name, first_name, last_name, avatar_url, summary, phone, location, linkedin_url, primary_account_type"
      )
      .eq("id", uid)
      .maybeSingle();

    if (profRes.error) {
      console.error(profRes.error);
      setLoadError(profRes.error.message);
      setLoading(false);
      return;
    }

    const row = profRes.data as ProfileRow | null;
    const pat =
      (row?.primary_account_type as string | null | undefined) ?? null;
    setPrimaryAccountType(pat);

    if (row) {
      setFirstName((row.first_name ?? "").trim());
      setLastName((row.last_name ?? "").trim());
      setLegacyDisplayName(row.display_name?.trim() || null);
      setInitialsSource({
        first_name: row.first_name,
        last_name: row.last_name,
        display_name: row.display_name,
        email: row.email ?? userEmail,
      });
      setProfileEmail(row.email?.trim() || userEmail);
      setRecoveryEmail((row.recovery_email ?? "").trim());
      setAvatarUrl(row.avatar_url ?? null);
      setSummary(row.summary ?? "");
      setPhone(row.phone ?? "");
      setLocation(row.location ?? "");
      setLinkedinUrl(row.linkedin_url ?? "");
    } else {
      setFirstName("");
      setLastName("");
      setLegacyDisplayName(null);
      setInitialsSource({ email: userEmail });
      setProfileEmail(userEmail);
      setRecoveryEmail("");
      setAvatarUrl(null);
      setSummary("");
      setPhone("");
      setLocation("");
      setLinkedinUrl("");
    }

    let jpTitle: string | null = null;
    let jpLevel: string | null = null;
    if (activeOrgId) {
      const ujpRes = await supabase
        .from("user_job_profiles")
        .select("job_profile_id")
        .eq("organisation_id", activeOrgId)
        .eq("user_id", uid)
        .maybeSingle();

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
    }
    setJobTitle(jpTitle);
    setJobLevel(jpLevel);

    if (activeMembership) {
      setOrganisationName(organisationLabel(activeMembership));
    } else if (pat === "personal") {
      setOrganisationName("Personal Account");
    } else if (pat === "organisation") {
      setOrganisationName("Workspace access");
    } else {
      setOrganisationName(null);
    }

    setLoading(false);
  }, [open, userEmail, activeOrgId, activeMembership]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    setInitialsSource((prev) => ({
      ...prev,
      first_name: firstName || null,
      last_name: lastName || null,
    }));
  }, [firstName, lastName]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !userId) return;

    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const allowed = ["jpg", "jpeg", "png", "webp", "gif"];
    if (!allowed.includes(ext)) {
      setLoadError("Please choose a JPEG, PNG, WebP, or GIF image.");
      return;
    }

    setUploadingAvatar(true);
    setLoadError(null);

    const path = `${userId}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("profile-images")
      .upload(path, file, {
        cacheControl: "3600",
        upsert: true,
        contentType: file.type || `image/${ext === "jpg" ? "jpeg" : ext}`,
      });

    if (upErr) {
      console.error(upErr);
      setLoadError(upErr.message || "Could not upload image.");
      setUploadingAvatar(false);
      return;
    }

    const { data: pub } = supabase.storage
      .from("profile-images")
      .getPublicUrl(path);
    const publicUrl = pub.publicUrl;

    const { error: dbErr } = await supabase
      .from("profiles")
      .update({ avatar_url: publicUrl })
      .eq("id", userId);

    if (dbErr) {
      console.error(dbErr);
      setLoadError(dbErr.message || "Could not save avatar URL.");
      setUploadingAvatar(false);
      return;
    }

    setAvatarUrl(publicUrl);
    setUploadingAvatar(false);
    onProfileUpdated?.();
  }

  async function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!userId) return;

    setSaving(true);
    setLoadError(null);

    const re = recoveryEmail.trim();
    if (re && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(re)) {
      setLoadError("Recovery email should look like a valid email address.");
      setSaving(false);
      return;
    }

    const fn = firstName.trim();
    const ln = lastName.trim();
    const payload: Record<string, string | null> = {
      summary: summary.trim() || null,
      phone: phone.trim() || null,
      location: location.trim() || null,
      linkedin_url: linkedinUrl.trim() || null,
      first_name: fn || null,
      last_name: ln || null,
      recovery_email: re || null,
    };
    if (fn || ln) {
      payload.display_name = null;
    }

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
    onProfileUpdated?.();
  }

  const namePreview = useMemo(
    () =>
      profileNamePreview(
        firstName,
        lastName,
        legacyDisplayName,
        profileEmail,
      ),
    [firstName, lastName, legacyDisplayName, profileEmail],
  );

  if (!open) {
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

  const sectionHeading = {
    margin: "0 0 12px",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: mutedColor,
  };

  const initials = profileInitials(initialsSource);

  const profileAllowedWithoutWorkspace =
    primaryAccountType === "personal" ||
    primaryAccountType === "organisation";

  const jobLine =
    jobTitle != null
      ? jobLevel
        ? `${jobTitle} · ${jobLevel}`
        : jobTitle
      : "No job profile assigned";

  const panelBody = loading ? (
      <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>
        Loading profile…
      </p>
    ) : !activeOrgId && !profileAllowedWithoutWorkspace ? (
      <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>
        Select a workspace to view your profile in context.
      </p>
    ) : (
      <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        {loadError ? (
          <p style={{ margin: 0, fontSize: 14, color: errorColor }}>{loadError}</p>
        ) : null}

        <div style={card}>
          <p style={sectionHeading}>Identity</p>
          <div
            style={{
              display: "flex",
              gap: 16,
              alignItems: "flex-start",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              disabled={uploadingAvatar}
              onClick={() => fileInputRef.current?.click()}
              className={styles.avatarButton}
              aria-label="Upload profile photo"
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt=""
                  className={styles.avatarImage}
                  width={72}
                  height={72}
                />
              ) : (
                <span className={styles.avatarFallback}>{initials}</span>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className={styles.hiddenFileInput}
              onChange={(ev) => void handleAvatarChange(ev)}
            />
            <div style={{ flex: "1 1 200px", minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 18, fontWeight: 600, color: text }}>
                {namePreview}
              </p>
              {organisationName ? (
                <p
                  style={{
                    margin: "8px 0 0",
                    fontSize: 13,
                    fontWeight: primaryAccountType === "personal" ? 600 : 500,
                    color:
                      primaryAccountType === "personal" ? accent : mutedColor,
                  }}
                >
                  {organisationName}
                </p>
              ) : null}
              <p style={{ margin: "8px 0 0", fontSize: 14, color: text }}>
                {jobLine}
              </p>
              {uploadingAvatar ? (
                <p style={{ margin: "8px 0 0", fontSize: 12, color: mutedColor }}>
                  Uploading…
                </p>
              ) : null}
            </div>
          </div>
          <div
            className={styles.profileNameFields}
            style={{ marginTop: 18 }}
          >
            <label style={labelStyle}>
              First name
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
                placeholder="Given name"
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Last name
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
                placeholder="Family name"
                style={inputStyle}
              />
            </label>
          </div>
        </div>

        {primaryAccountType === "personal" && userId ? (
          <ProfileCvPrefillSection
            userId={userId}
            current={{
              firstName,
              lastName,
              summary,
              location,
              linkedinUrl,
            }}
            onApplied={() => {
              void loadProfile();
              onProfileUpdated?.();
            }}
          />
        ) : null}

        <div style={card}>
          <p style={sectionHeading}>Contact &amp; links</p>
          <div className={styles.profileContactGrid}>
            <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
              Sign-in email
              <input
                readOnly
                value={profileEmail}
                style={{ ...inputStyle, opacity: 0.9 }}
              />
              <span
                style={{
                  fontSize: 12,
                  color: mutedColor,
                  fontWeight: 400,
                  marginTop: 4,
                }}
              >
                Used to sign in. From your authentication provider.
              </span>
            </label>
            <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
              Recovery email <span style={{ fontWeight: 400 }}>(optional)</span>
              <input
                type="email"
                value={recoveryEmail}
                onChange={(e) => setRecoveryEmail(e.target.value)}
                autoComplete="email"
                placeholder="alternate@example.com"
                style={inputStyle}
              />
              <span
                style={{
                  fontSize: 12,
                  color: mutedColor,
                  fontWeight: 400,
                  marginTop: 4,
                }}
              >
                Personal fallback for account recovery and contact if your sign-in email
                changes, or if you join or leave an organisation.
              </span>
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
        </div>

        {userId ? (
          <ProfileSecurity2fa userId={userId} onChanged={onProfileUpdated} />
        ) : null}

        <div style={card}>
          <p style={sectionHeading}>About</p>
          <label style={{ ...labelStyle, marginBottom: 0 }}>
            Summary
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="A short statement about your role, strengths, or goals."
              className={styles.profileSummaryArea}
              style={{
                ...inputStyle,
                resize: "vertical" as const,
                fontFamily: "inherit",
                lineHeight: 1.5,
                minHeight: 120,
                width: "100%",
              }}
            />
          </label>
        </div>

        <div style={{ ...card, display: "flex", justifyContent: "flex-end" }}>
          <button type="submit" disabled={saving} style={{ ...btnPrimary, fontSize: 13 }}>
            {saving ? "Saving…" : "Save profile"}
          </button>
        </div>
      </form>
    );

  return createPortal(
    <>
      <div
        className={styles.profilePanelBackdrop}
        role="presentation"
        onClick={onClose}
      />
      <aside
        className={styles.profilePanel}
        aria-label="My profile"
      >
        <div className={styles.profilePanelHeader}>
          <h2 className={styles.profilePanelTitle}>My profile</h2>
          <button
            type="button"
            className={styles.profilePanelClose}
            onClick={onClose}
            aria-label="Close profile"
          >
            ×
          </button>
        </div>
        <div className={styles.profilePanelBody}>{panelBody}</div>
      </aside>
    </>,
    document.body
  );
}
