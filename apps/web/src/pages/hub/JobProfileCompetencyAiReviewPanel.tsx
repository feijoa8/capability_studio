import type { JobProfileCompetencyRelevance } from "./types";
import type {
  CompetencySuggestionReviewRow,
  JobProfileCompetencyAiGaps,
} from "../../lib/jobProfileCompetencySuggestions";
import {
  bg,
  border,
  borderSubtle,
  btnGhost,
  btnPrimary,
  errorColor,
  muted,
  mutedColor,
  sectionEyebrow,
  surface,
  text,
} from "./hubTheme";

export type JobProfileCompetencyAiReviewPanelProps = {
  competencyAiSuggestError: string | null;
  competencyAiSuggestLoading: boolean;
  competencyAiReviewCoreBySubject: [string, CompetencySuggestionReviewRow[]][];
  competencyAiReviewSupportingBySubject: [
    string,
    CompetencySuggestionReviewRow[],
  ][];
  competencyAiGaps: JobProfileCompetencyAiGaps | null;
  isSavingMapping: boolean;
  onPatchRow: (
    key: string,
    patch: Partial<CompetencySuggestionReviewRow>
  ) => void;
  onToggleSubjectGroup: (
    tier: "core" | "supporting",
    subjectName: string,
    selected: boolean
  ) => void;
  onApply: () => void;
  onBack: () => void;
};

function SubjectBlock({
  tier,
  subjectName,
  rows,
  isSavingMapping,
  onPatchRow,
  onToggleSubjectGroup,
}: {
  tier: "core" | "supporting";
  subjectName: string;
  rows: CompetencySuggestionReviewRow[];
  isSavingMapping: boolean;
  onPatchRow: JobProfileCompetencyAiReviewPanelProps["onPatchRow"];
  onToggleSubjectGroup: JobProfileCompetencyAiReviewPanelProps["onToggleSubjectGroup"];
}) {
  const allSelected = rows.length > 0 && rows.every((r) => r.selected);
  return (
    <div
      style={{
        border: `1px solid ${border}`,
        borderRadius: 8,
        padding: 12,
        backgroundColor: surface,
      }}
    >
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontWeight: 600,
          fontSize: 14,
          marginBottom: 12,
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <input
          type="checkbox"
          checked={allSelected}
          onChange={() => onToggleSubjectGroup(tier, subjectName, !allSelected)}
          disabled={isSavingMapping}
          style={{ width: 16, height: 16, cursor: "pointer" }}
        />
        {subjectName}
        <span style={{ ...muted, fontWeight: 400, fontSize: 12 }}>
          (toggle group)
        </span>
      </label>
      <div style={{ display: "grid", gap: 12 }}>
        {rows.map((r) => (
          <div
            key={r.key}
            style={{
              paddingBottom: 12,
              borderBottom: `1px solid ${borderSubtle}`,
            }}
          >
            <label
              style={{
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              <input
                type="checkbox"
                checked={r.selected}
                onChange={() => onPatchRow(r.key, { selected: !r.selected })}
                disabled={isSavingMapping}
                style={{
                  width: 16,
                  height: 16,
                  marginTop: 2,
                  cursor: "pointer",
                }}
              />
              <span
                style={{
                  fontWeight: 600,
                  fontSize: 14,
                  color: text,
                }}
              >
                {r.competencyName}
              </span>
            </label>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                marginLeft: 26,
                marginTop: 8,
              }}
            >
              <label
                style={{
                  display: "grid",
                  gap: 4,
                  fontSize: 12,
                  color: mutedColor,
                }}
              >
                Required level
                <select
                  value={r.requiredLevel}
                  onChange={(e) =>
                    onPatchRow(r.key, {
                      requiredLevel: e.target.value,
                    })
                  }
                  disabled={isSavingMapping || r.levelOptions.length === 0}
                  style={{
                    padding: "8px 10px",
                    fontSize: 14,
                    color: text,
                    backgroundColor: bg,
                    border: `1px solid ${border}`,
                    borderRadius: 8,
                  }}
                >
                  {r.levelOptions.map((ld) => (
                    <option key={ld.id} value={ld.level_name}>
                      {ld.level_order}. {ld.level_name}
                    </option>
                  ))}
                </select>
              </label>
              <label
                style={{
                  display: "grid",
                  gap: 4,
                  fontSize: 12,
                  color: mutedColor,
                }}
              >
                Relevance
                <select
                  value={r.relevance}
                  onChange={(e) =>
                    onPatchRow(r.key, {
                      relevance: e.target.value as JobProfileCompetencyRelevance,
                    })
                  }
                  disabled={isSavingMapping}
                  style={{
                    padding: "8px 10px",
                    fontSize: 14,
                    color: text,
                    backgroundColor: bg,
                    border: `1px solid ${border}`,
                    borderRadius: 8,
                  }}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
            </div>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginLeft: 26,
                marginTop: 8,
                fontSize: 13,
                color: mutedColor,
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              <input
                type="checkbox"
                checked={r.isRequired}
                onChange={(e) =>
                  onPatchRow(r.key, { isRequired: e.target.checked })
                }
                disabled={isSavingMapping}
                style={{ width: 16, height: 16, cursor: "pointer" }}
              />
              Required for this role
            </label>
            {r.reason ? (
              <p
                style={{
                  ...muted,
                  fontSize: 12,
                  margin: "8px 0 0 26px",
                  lineHeight: 1.4,
                }}
              >
                {r.reason}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function JobProfileCompetencyAiReviewPanel({
  competencyAiSuggestError,
  competencyAiSuggestLoading,
  competencyAiReviewCoreBySubject,
  competencyAiReviewSupportingBySubject,
  competencyAiGaps,
  isSavingMapping,
  onPatchRow,
  onToggleSubjectGroup,
  onApply,
  onBack,
}: JobProfileCompetencyAiReviewPanelProps) {
  const selectedCount =
    competencyAiReviewCoreBySubject.reduce(
      (n, [, rows]) => n + rows.filter((r) => r.selected).length,
      0,
    ) +
    competencyAiReviewSupportingBySubject.reduce(
      (n, [, rows]) => n + rows.filter((r) => r.selected).length,
      0,
    );

  const hasRows =
    competencyAiReviewCoreBySubject.length > 0 ||
    competencyAiReviewSupportingBySubject.length > 0;

  return (
    <div style={{ display: "grid", gap: 14, padding: "4px 0" }}>
      <h3
        id="job-profile-ai-comp-title"
        style={{
          margin: "0 0 8px",
          fontSize: 17,
          fontWeight: 600,
          color: text,
        }}
      >
        Review AI suggestions
      </h3>
      <p
        style={{
          ...muted,
          margin: 0,
          fontSize: 13,
          lineHeight: 1.45,
        }}
      >
        Core vs supporting are suggestions only — adjust, then apply. Only
        checked rows are added to the job profile. Nothing is saved until you
        apply.
      </p>
      {competencyAiSuggestLoading ? (
        <p style={{ ...muted, margin: 0, fontSize: 14 }}>
          Generating suggestions…
        </p>
      ) : null}
      {competencyAiSuggestError ? (
        <p style={{ color: errorColor, margin: 0, fontSize: 14 }}>
          {competencyAiSuggestError}
        </p>
      ) : null}
      {!hasRows && !competencyAiSuggestLoading ? (
        <p style={{ ...muted, margin: 0, fontSize: 14 }}>
          No new catalogue rows to add (names may not have matched, levels may
          be missing, or everything suggested is already on this role). Review
          potential gaps below if present.
        </p>
      ) : null}

      {competencyAiReviewCoreBySubject.length > 0 ? (
        <div style={{ display: "grid", gap: 10 }}>
          <p
            style={{
              ...sectionEyebrow,
              margin: 0,
              fontSize: 12,
              letterSpacing: "0.08em",
            }}
          >
            Core competencies
          </p>
          <p style={{ ...muted, margin: 0, fontSize: 12, lineHeight: 1.45 }}>
            Expected to be central to performing this role well.
          </p>
          {competencyAiReviewCoreBySubject.map(([subjectName, rows]) => (
            <SubjectBlock
              key={`core-${subjectName}`}
              tier="core"
              subjectName={subjectName}
              rows={rows}
              isSavingMapping={isSavingMapping}
              onPatchRow={onPatchRow}
              onToggleSubjectGroup={onToggleSubjectGroup}
            />
          ))}
        </div>
      ) : null}

      {competencyAiReviewSupportingBySubject.length > 0 ? (
        <div style={{ display: "grid", gap: 10 }}>
          <p
            style={{
              ...sectionEyebrow,
              margin: 0,
              fontSize: 12,
              letterSpacing: "0.08em",
            }}
          >
            Supporting competencies
          </p>
          <p style={{ ...muted, margin: 0, fontSize: 12, lineHeight: 1.45 }}>
            Useful context or occasional application — still from your existing
            catalogue.
          </p>
          {competencyAiReviewSupportingBySubject.map(([subjectName, rows]) => (
            <SubjectBlock
              key={`sup-${subjectName}`}
              tier="supporting"
              subjectName={subjectName}
              rows={rows}
              isSavingMapping={isSavingMapping}
              onPatchRow={onPatchRow}
              onToggleSubjectGroup={onToggleSubjectGroup}
            />
          ))}
        </div>
      ) : null}

      {competencyAiGaps &&
      ((competencyAiGaps.missing_competencies?.length ?? 0) > 0 ||
        (competencyAiGaps.missing_subjects?.length ?? 0) > 0) ? (
        <div
          style={{
            border: `1px dashed ${border}`,
            borderRadius: 8,
            padding: 12,
            backgroundColor: bg,
          }}
        >
          <p
            style={{
              margin: "0 0 6px",
              fontSize: 13,
              fontWeight: 600,
              color: text,
            }}
          >
            Potential taxonomy gaps
          </p>
          <p style={{ ...muted, margin: "0 0 10px", fontSize: 12 }}>
            Review only — nothing here is created or changed in the catalogue
            from this screen.
          </p>
          {(competencyAiGaps.missing_subjects?.length ?? 0) > 0 ? (
            <div style={{ marginBottom: 10 }}>
              <p style={{ ...muted, margin: "0 0 6px", fontSize: 12 }}>
                Missing subject ideas
              </p>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 18,
                  fontSize: 13,
                  color: text,
                  lineHeight: 1.45,
                }}
              >
                {competencyAiGaps.missing_subjects!.map((g, i) => (
                  <li key={i}>
                    <strong>{g.name}</strong>
                    {g.suggested_capability_area ? (
                      <span style={{ ...muted }}>
                        {" "}
                        (capability area: {g.suggested_capability_area})
                      </span>
                    ) : null}
                    {g.reason ? (
                      <span style={{ ...muted }}> — {g.reason}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {(competencyAiGaps.missing_competencies?.length ?? 0) > 0 ? (
            <div>
              <p style={{ ...muted, margin: "0 0 6px", fontSize: 12 }}>
                Missing competency ideas
              </p>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 18,
                  fontSize: 13,
                  color: text,
                  lineHeight: 1.45,
                }}
              >
                {competencyAiGaps.missing_competencies!.map((g, i) => (
                  <li key={i}>
                    <strong>{g.name}</strong>
                    {g.suggested_subject ? (
                      <span style={{ ...muted }}>
                        {" "}
                        (under subject: {g.suggested_subject})
                      </span>
                    ) : null}
                    {g.reason ? (
                      <span style={{ ...muted }}> — {g.reason}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
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
          type="button"
          onClick={onApply}
          disabled={
            isSavingMapping || selectedCount === 0 || competencyAiSuggestLoading
          }
          style={btnPrimary}
        >
          {isSavingMapping ? "Applying…" : `Apply selected (${selectedCount})`}
        </button>
        <button
          type="button"
          onClick={onBack}
          disabled={isSavingMapping}
          style={btnGhost}
        >
          Back to manual add
        </button>
      </div>
    </div>
  );
}
