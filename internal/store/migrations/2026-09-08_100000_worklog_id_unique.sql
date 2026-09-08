-- One local entry per Jira worklog. The fetch matches a remote worklog to a
-- local entry by this column, and two rows claiming one worklog would make that
-- lookup ambiguous and would push the same time twice.
--
-- Partial, because an unpushed entry has no worklog and there are many of them:
-- SQLite treats NULLs as distinct in a plain unique index, but saying so here
-- makes the intent explicit and keeps the index off every unpushed row.
CREATE UNIQUE INDEX idx_entries_worklog
    ON time_entries(instance_id, worklog_id)
 WHERE worklog_id IS NOT NULL;
