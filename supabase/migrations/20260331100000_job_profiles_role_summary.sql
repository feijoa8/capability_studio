-- Narrative for the role, including AI-refined organisation-grounded summary
ALTER TABLE job_profiles ADD COLUMN IF NOT EXISTS role_summary text;
