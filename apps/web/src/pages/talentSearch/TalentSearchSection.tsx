import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  buildSearchTerms,
  fetchTalentProfileDetail,
  runTalentSearch,
  type TalentProfileDetailPayload,
  type TalentSearchResultRow,
  type TalentSearchScope,
} from "./talentSearchApi";
import { TalentProfileDetailModal } from "./TalentProfileDetailModal";
import {
  accent,
  border,
  brandLimeMuted,
  btnPrimary,
  errorColor,
  fieldBg,
  muted,
  mutedColor,
  panelShell,
  surfaceHover,
  text,
} from "../hub/hubTheme";

type Props = {
  activeOrgId: string | null;
  isActive: boolean;
};

const SCOPE_OPTIONS: { id: TalentSearchScope; label: string }[] = [
  { id: "internal", label: "Internal only" },
  { id: "external", label: "External only" },
  { id: "both", label: "Both" },
];

export function TalentSearchSection({ activeOrgId, isActive }: Props) {
  const [naturalLanguage, setNaturalLanguage] = useState("");
  const [skillsKeywords, setSkillsKeywords] = useState("");
  const [industry, setIndustry] = useState("");
  const [minYears, setMinYears] = useState<number>(0);
  const [location, setLocation] = useState("");
  const [availability, setAvailability] = useState("");
  const [scope, setScope] = useState<TalentSearchScope>("both");
  const [referenceJobProfileId, setReferenceJobProfileId] = useState<string>("");
  const [referenceRoleText, setReferenceRoleText] = useState("");

  const [jobProfiles, setJobProfiles] = useState<{ id: string; title: string }[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);

  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<TalentSearchResultRow[]>([]);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<TalentProfileDetailPayload | null>(null);

  useEffect(() => {
    if (!isActive || !activeOrgId) return;
    let cancelled = false;
    setLoadingJobs(true);
    void (async () => {
      const { data, error } = await supabase
        .from("job_profiles")
        .select("id, title")
        .eq("organisation_id", activeOrgId)
        .order("title", { ascending: true })
        .limit(200);
      if (cancelled) return;
      if (error) {
        console.warn("talent search job profiles:", error.message);
        setJobProfiles([]);
      } else {
        setJobProfiles((data ?? []) as { id: string; title: string }[]);
      }
      setLoadingJobs(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isActive, activeOrgId]);

  const terms = useMemo(
    () =>
      buildSearchTerms({
        naturalLanguage,
        skillsKeywords,
        industry,
        location,
        availability,
      }),
    [naturalLanguage, skillsKeywords, industry, location, availability],
  );

  const runSearch = useCallback(async () => {
    if (!activeOrgId) return;
    setSearching(true);
    setSearchError(null);
    try {
      const rows = await runTalentSearch({
        organisationId: activeOrgId,
        scope,
        terms,
        minYears,
        referenceJobProfileId: referenceJobProfileId || null,
        referenceRoleText,
        limit: 30,
      });
      setResults(rows);
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Search failed.");
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [
    activeOrgId,
    scope,
    terms,
    minYears,
    referenceJobProfileId,
    referenceRoleText,
  ]);

  const openDetail = useCallback(
    async (row: TalentSearchResultRow) => {
      if (!activeOrgId) return;
      setDetailOpen(true);
      setDetailLoading(true);
      setDetailError(null);
      setDetailData(null);
      try {
        const data = await fetchTalentProfileDetail({
          organisationId: activeOrgId,
          kind: row.source_type,
          userId: row.user_id,
          applicationId: row.application_id,
        });
        setDetailData(data);
      } catch (e) {
        setDetailError(e instanceof Error ? e.message : "Could not load profile.");
      } finally {
        setDetailLoading(false);
      }
    },
    [activeOrgId],
  );

  if (!isActive) return null;

  if (!activeOrgId) {
    return (
      <div style={{ ...panelShell, marginTop: 0 }}>
        <p style={{ margin: 0, fontSize: 14, color: mutedColor }}>
          Select a workspace to search talent.
        </p>
      </div>
    );
  }

  return (
    <div style={{ ...panelShell, marginTop: 0 }}>
      <h2 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 650, color: text }}>
        Talent Search
      </h2>
      <p style={{ ...muted, margin: "0 0 18px", fontSize: 13, lineHeight: 1.55 }}>
        Find internal colleagues who opted into discovery, or external candidates who opted into the
        talent pool for this organisation. Matching is keyword-based (MVP) — refine with structured
        filters and an optional job profile reference.
      </p>

      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "1fr 1fr",
          marginBottom: 16,
        }}
      >
        <label style={{ gridColumn: "1 / -1", display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: mutedColor }}>Natural language</span>
          <textarea
            value={naturalLanguage}
            onChange={(e) => setNaturalLanguage(e.target.value)}
            placeholder='e.g. BA with MS Dynamics in finance'
            rows={2}
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: 14,
              borderRadius: 8,
              border: `1px solid ${border}`,
              background: fieldBg,
              color: text,
              resize: "vertical",
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: mutedColor }}>Scope</span>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as TalentSearchScope)}
            style={{
              padding: "9px 10px",
              fontSize: 14,
              borderRadius: 8,
              border: `1px solid ${border}`,
              background: fieldBg,
              color: text,
            }}
          >
            {SCOPE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: mutedColor }}>Minimum years experience</span>
          <input
            type="number"
            min={0}
            max={60}
            value={minYears || ""}
            onChange={(e) => setMinYears(Number(e.target.value) || 0)}
            placeholder="0"
            style={{
              padding: "9px 10px",
              fontSize: 14,
              borderRadius: 8,
              border: `1px solid ${border}`,
              background: fieldBg,
              color: text,
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: mutedColor }}>Skills / keywords</span>
          <input
            value={skillsKeywords}
            onChange={(e) => setSkillsKeywords(e.target.value)}
            placeholder="e.g. Dynamics, agile, stakeholder"
            style={{
              padding: "9px 10px",
              fontSize: 14,
              borderRadius: 8,
              border: `1px solid ${border}`,
              background: fieldBg,
              color: text,
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: mutedColor }}>Industry</span>
          <input
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="e.g. finance"
            style={{
              padding: "9px 10px",
              fontSize: 14,
              borderRadius: 8,
              border: `1px solid ${border}`,
              background: fieldBg,
              color: text,
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: mutedColor }}>Location</span>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="City or region"
            style={{
              padding: "9px 10px",
              fontSize: 14,
              borderRadius: 8,
              border: `1px solid ${border}`,
              background: fieldBg,
              color: text,
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: mutedColor }}>Availability</span>
          <input
            value={availability}
            onChange={(e) => setAvailability(e.target.value)}
            placeholder="e.g. immediate, 3 months"
            style={{
              padding: "9px 10px",
              fontSize: 14,
              borderRadius: 8,
              border: `1px solid ${border}`,
              background: fieldBg,
              color: text,
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: mutedColor }}>Reference job profile (optional)</span>
          <select
            value={referenceJobProfileId}
            onChange={(e) => setReferenceJobProfileId(e.target.value)}
            disabled={loadingJobs}
            style={{
              padding: "9px 10px",
              fontSize: 14,
              borderRadius: 8,
              border: `1px solid ${border}`,
              background: fieldBg,
              color: text,
            }}
          >
            <option value="">None</option>
            {jobProfiles.map((jp) => (
              <option key={jp.id} value={jp.id}>
                {jp.title}
              </option>
            ))}
          </select>
        </label>

        <label style={{ gridColumn: "1 / -1", display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, color: mutedColor }}>
            Paste role description (optional reference text)
          </span>
          <textarea
            value={referenceRoleText}
            onChange={(e) => setReferenceRoleText(e.target.value)}
            placeholder="Short role description to boost keyword overlap…"
            rows={3}
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: 14,
              borderRadius: 8,
              border: `1px solid ${border}`,
              background: fieldBg,
              color: text,
              resize: "vertical",
            }}
          />
        </label>
      </div>

      <button
        type="button"
        onClick={() => void runSearch()}
        disabled={searching}
        style={{
          ...btnPrimary,
          padding: "10px 18px",
          fontSize: 14,
          fontWeight: 600,
          cursor: searching ? "default" : "pointer",
          opacity: searching ? 0.75 : 1,
        }}
      >
        {searching ? "Searching…" : "Search"}
      </button>

      {searchError ? (
        <p style={{ color: errorColor, marginTop: 14, fontSize: 14 }}>{searchError}</p>
      ) : null}

      {results.length > 0 ? (
        <div style={{ marginTop: 22 }}>
          <h3
            style={{
              margin: "0 0 12px",
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: mutedColor,
            }}
          >
            Results ({results.length})
          </h3>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
            {results.map((row) => (
              <li
                key={`${row.source_type}-${row.user_id}-${row.application_id ?? "i"}`}
                style={{
                  border: `1px solid ${border}`,
                  borderRadius: 10,
                  padding: "14px 16px",
                  background: surfaceHover,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <span style={{ fontWeight: 650, fontSize: 15, color: text }}>
                    {row.display_name}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      padding: "3px 8px",
                      borderRadius: 6,
                      background:
                        row.source_type === "internal"
                          ? "var(--cs-accent-muted)"
                          : brandLimeMuted,
                      color: row.source_type === "internal" ? accent : text,
                      border:
                        row.source_type === "internal"
                          ? "1px solid var(--cs-btn-primary-border)"
                          : "1px solid rgba(196, 245, 66, 0.35)",
                    }}
                  >
                    {row.source_type === "internal" ? "Internal" : "External"}
                  </span>
                  <span style={{ fontSize: 12, color: mutedColor }}>
                    Match {row.match_score}%
                  </span>
                </div>
                <p style={{ margin: "0 0 6px", fontSize: 13, color: text }}>
                  {row.current_title?.trim() || "—"}
                  {row.years_experience != null ? (
                    <span style={{ color: mutedColor }}>
                      {" "}
                      · ~{Math.round(Number(row.years_experience))} yrs experience
                    </span>
                  ) : null}
                </p>
                {row.skills.length > 0 ? (
                  <p style={{ margin: "0 0 6px", fontSize: 12, color: mutedColor }}>
                    {row.skills.slice(0, 10).join(" · ")}
                  </p>
                ) : null}
                {row.highlights.filter(Boolean).length > 0 ? (
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12, color: mutedColor }}>
                    {row.highlights
                      .filter((h): h is string => Boolean(h && h.trim()))
                      .slice(0, 2)
                      .map((h, i) => (
                        <li key={i}>{h.length > 140 ? `${h.slice(0, 140)}…` : h}</li>
                      ))}
                  </ul>
                ) : null}
                <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => void openDetail(row)}
                    style={{
                      padding: "6px 12px",
                      fontSize: 13,
                      borderRadius: 8,
                      border: `1px solid ${border}`,
                      background: "transparent",
                      color: accent,
                      cursor: "pointer",
                    }}
                  >
                    View details
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : !searching && !searchError ? (
        <p style={{ ...muted, marginTop: 18, fontSize: 13 }}>
          Run a search to see results. Internal listings require colleagues to opt in under Profile →
          privacy; external listings require the candidate to allow talent pool discovery on their
          profile.
        </p>
      ) : null}

      <TalentProfileDetailModal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        loading={detailLoading}
        error={detailError}
        data={detailData}
      />
    </div>
  );
}
