-- Classify competencies by development source (does not change hierarchy)
ALTER TABLE competencies
  ADD COLUMN IF NOT EXISTS competency_type text NOT NULL DEFAULT 'practice';

ALTER TABLE competencies DROP CONSTRAINT IF EXISTS competencies_competency_type_check;
ALTER TABLE competencies ADD CONSTRAINT competencies_competency_type_check
  CHECK (competency_type IN ('practice', 'organisation', 'stretch'));

CREATE INDEX IF NOT EXISTS competencies_org_competency_type_idx
  ON competencies (organisation_id, competency_type);
