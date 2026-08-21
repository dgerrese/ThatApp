-- status_cache lets a refreshed pin still look refreshed after a reload.
-- ADD COLUMN needs no table rebuild, so unlike the URL split this cannot
-- cascade into time_entries.
ALTER TABLE pinned_issues ADD COLUMN status_cache TEXT;
