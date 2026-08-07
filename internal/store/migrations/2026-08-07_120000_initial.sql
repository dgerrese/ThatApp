CREATE TABLE instances (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL,
  base_url       TEXT NOT NULL,
  email          TEXT NOT NULL,
  api_token_enc  BLOB NOT NULL,
  created_at     TEXT NOT NULL
);

CREATE TABLE pinned_issues (
  id             INTEGER PRIMARY KEY,
  instance_id    INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  issue_key      TEXT NOT NULL,
  summary_cache  TEXT,
  created_at     TEXT NOT NULL,
  UNIQUE(instance_id, issue_key)
);

CREATE TABLE time_entries (
  id             INTEGER PRIMARY KEY,
  instance_id    INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  issue_key      TEXT NOT NULL,
  day            TEXT NOT NULL,
  started_at     TEXT NOT NULL,
  seconds        INTEGER NOT NULL,
  comment        TEXT,
  worklog_id     TEXT,
  pushed_at      TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX idx_entries_day ON time_entries(day);
CREATE INDEX idx_entries_issue_day ON time_entries(instance_id, issue_key, day);

CREATE TABLE timers (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  instance_id    INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  issue_key      TEXT NOT NULL,
  started_at     TEXT NOT NULL
);
