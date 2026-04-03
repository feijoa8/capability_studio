-- Lifecycle: status (active | deprecated | archived), deprecation metadata, optional replacement pointer (same table)

-- competency_practices
ALTER TABLE competency_practices
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

ALTER TABLE competency_practices DROP CONSTRAINT IF EXISTS competency_practices_status_check;
ALTER TABLE competency_practices ADD CONSTRAINT competency_practices_status_check
  CHECK (status IN ('active', 'deprecated', 'archived'));

ALTER TABLE competency_practices
  ADD COLUMN IF NOT EXISTS deprecated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deprecated_reason text;

ALTER TABLE competency_practices
  ADD COLUMN IF NOT EXISTS replaced_by_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'competency_practices_replaced_by_id_fkey'
  ) THEN
    ALTER TABLE competency_practices
      ADD CONSTRAINT competency_practices_replaced_by_id_fkey
      FOREIGN KEY (replaced_by_id) REFERENCES competency_practices (id) ON DELETE SET NULL;
  END IF;
END $$;

UPDATE competency_practices
SET status = CASE WHEN is_active THEN 'active' ELSE 'archived' END;

UPDATE competency_practices SET is_active = false WHERE status = 'archived';
UPDATE competency_practices SET is_active = true WHERE status IN ('active', 'deprecated');

CREATE INDEX IF NOT EXISTS competency_practices_org_status_idx
  ON competency_practices (organisation_id, status);

-- competency_subjects
ALTER TABLE competency_subjects
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

ALTER TABLE competency_subjects DROP CONSTRAINT IF EXISTS competency_subjects_status_check;
ALTER TABLE competency_subjects ADD CONSTRAINT competency_subjects_status_check
  CHECK (status IN ('active', 'deprecated', 'archived'));

ALTER TABLE competency_subjects
  ADD COLUMN IF NOT EXISTS deprecated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deprecated_reason text;

ALTER TABLE competency_subjects
  ADD COLUMN IF NOT EXISTS replaced_by_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'competency_subjects_replaced_by_id_fkey'
  ) THEN
    ALTER TABLE competency_subjects
      ADD CONSTRAINT competency_subjects_replaced_by_id_fkey
      FOREIGN KEY (replaced_by_id) REFERENCES competency_subjects (id) ON DELETE SET NULL;
  END IF;
END $$;

UPDATE competency_subjects
SET status = CASE WHEN is_active THEN 'active' ELSE 'archived' END;

UPDATE competency_subjects SET is_active = false WHERE status = 'archived';
UPDATE competency_subjects SET is_active = true WHERE status IN ('active', 'deprecated');

CREATE INDEX IF NOT EXISTS competency_subjects_org_status_idx
  ON competency_subjects (organisation_id, status);

-- competencies
ALTER TABLE competencies
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

ALTER TABLE competencies DROP CONSTRAINT IF EXISTS competencies_status_check;
ALTER TABLE competencies ADD CONSTRAINT competencies_status_check
  CHECK (status IN ('active', 'deprecated', 'archived'));

ALTER TABLE competencies
  ADD COLUMN IF NOT EXISTS deprecated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deprecated_reason text;

ALTER TABLE competencies
  ADD COLUMN IF NOT EXISTS replaced_by_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'competencies_replaced_by_id_fkey'
  ) THEN
    ALTER TABLE competencies
      ADD CONSTRAINT competencies_replaced_by_id_fkey
      FOREIGN KEY (replaced_by_id) REFERENCES competencies (id) ON DELETE SET NULL;
  END IF;
END $$;

UPDATE competencies
SET status = CASE WHEN is_active THEN 'active' ELSE 'archived' END;

UPDATE competencies SET is_active = false WHERE status = 'archived';
UPDATE competencies SET is_active = true WHERE status IN ('active', 'deprecated');

CREATE INDEX IF NOT EXISTS competencies_org_status_idx
  ON competencies (organisation_id, status);
