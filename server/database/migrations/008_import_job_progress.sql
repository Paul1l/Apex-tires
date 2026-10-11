-- Last sign of work of a CSV import: set when the import starts and with
-- every committed batch. An import left in queued/processing without progress
-- for longer than IMPORT_JOB_STALE_MINUTES (process killed, database restarted
-- while the final status was being saved) is then marked failed.
ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS last_progress_at TIMESTAMPTZ;
