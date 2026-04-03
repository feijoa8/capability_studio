-- Optional column for assessment workflow (safe if already present)
ALTER TABLE org_user_competencies
  ADD COLUMN IF NOT EXISTS last_assessed_at timestamptz;
