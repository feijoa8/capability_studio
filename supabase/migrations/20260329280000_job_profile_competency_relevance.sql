-- Importance of a competency within a specific job profile (same competency, different roles)
ALTER TABLE job_profile_competencies
  ADD COLUMN IF NOT EXISTS relevance text NOT NULL DEFAULT 'medium';

ALTER TABLE job_profile_competencies
  DROP CONSTRAINT IF EXISTS job_profile_competencies_relevance_check;

ALTER TABLE job_profile_competencies
  ADD CONSTRAINT job_profile_competencies_relevance_check
  CHECK (relevance IN ('low', 'medium', 'high'));
