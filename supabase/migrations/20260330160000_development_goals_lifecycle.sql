-- Lifecycle for development goals: backlog (future / career-sourced) vs active execution vs completed.
-- Existing progress field `status` remains not_started | in_progress | completed for in-flight work.

ALTER TABLE development_goals
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('backlog', 'active', 'completed'));

UPDATE development_goals
SET lifecycle_status = 'completed'
WHERE status = 'completed';

ALTER TABLE development_goals
  ALTER COLUMN competency_id DROP NOT NULL;

ALTER TABLE development_goals
  ADD COLUMN IF NOT EXISTS career_focus_source_id text;

CREATE UNIQUE INDEX IF NOT EXISTS development_goals_career_focus_source_uniq
  ON development_goals (organisation_id, user_id, career_focus_source_id)
  WHERE career_focus_source_id IS NOT NULL;
