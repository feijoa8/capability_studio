-- Subject classification aligned with competency_type (practice | organisation | stretch)
ALTER TABLE competency_subjects
  ADD COLUMN IF NOT EXISTS type text;

UPDATE competency_subjects
SET type = 'practice'
WHERE type IS NULL OR trim(type) = '';

ALTER TABLE competency_subjects
  ALTER COLUMN type SET DEFAULT 'practice';

ALTER TABLE competency_subjects
  ALTER COLUMN type SET NOT NULL;

ALTER TABLE competency_subjects DROP CONSTRAINT IF EXISTS competency_subjects_type_check;
ALTER TABLE competency_subjects ADD CONSTRAINT competency_subjects_type_check
  CHECK (type IN ('practice', 'organisation', 'stretch'));
