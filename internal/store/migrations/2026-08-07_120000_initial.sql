CREATE TABLE instances (
  id             INTEGER PRIMARY KEY,
  name           VARCHAR(120) NOT NULL,
  base_url       VARCHAR(255) NOT NULL,
  email          VARCHAR(255) NOT NULL,
  api_token_enc  BLOB NOT NULL,
  created_at     DATETIME NOT NULL
);

CREATE TABLE pinned_issues (
  id             INTEGER PRIMARY KEY,
  instance_id    INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  issue_key      VARCHAR(20) NOT NULL,
  summary_cache  TEXT,
  created_at     DATETIME NOT NULL,
  UNIQUE(instance_id, issue_key)
);

CREATE TABLE time_entries (
  id             INTEGER PRIMARY KEY,
  instance_id    INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  issue_key      VARCHAR(20) NOT NULL,
  day            DATE NOT NULL,
  started_at     DATETIME NOT NULL,
  seconds        INTEGER NOT NULL,
  comment        TEXT,
  worklog_id     VARCHAR(32),
  pushed_at      DATETIME,
  created_at     DATETIME NOT NULL,
  updated_at     DATETIME NOT NULL
);

CREATE INDEX idx_entries_day ON time_entries(day);
CREATE INDEX idx_entries_issue_day ON time_entries(instance_id, issue_key, day);

CREATE TABLE timers (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  instance_id    INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  issue_key      VARCHAR(20) NOT NULL,
  started_at     DATETIME NOT NULL
);
