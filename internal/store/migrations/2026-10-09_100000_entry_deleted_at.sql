-- A delete of an entry Jira holds waits for the next push (#280). A timestamp
-- rather than a flag, so the push state stays derived from columns: a
-- worklog_id with a deleted_at is a pending delete.
ALTER TABLE time_entries ADD COLUMN deleted_at DATETIME;
