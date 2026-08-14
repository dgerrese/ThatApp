-- Two URLs, because they are two different things: REST calls go to the API
-- gateway at api.atlassian.com, while issue links the user clicks go to the
-- site host. Basic auth is rejected by the site host and accepted by the
-- gateway, so a single column cannot serve both.
--
-- ADD COLUMN and DROP COLUMN, never a table rebuild: applyMigration runs this
-- inside a transaction, PRAGMA foreign_keys is a no-op there, and DROP TABLE
-- with foreign keys on would cascade into time_entries and delete logged time.
ALTER TABLE instances ADD COLUMN site_url VARCHAR(255)
  CHECK (site_url IS NULL OR site_url <> '');
ALTER TABLE instances ADD COLUMN api_base_url VARCHAR(255)
  CHECK (api_base_url IS NULL OR api_base_url <> '');

-- A gateway URL carries no recoverable site, and resolving one needs a network
-- call a migration cannot make. Such a row keeps working for REST calls and is
-- flagged in Settings so the user supplies the site URL once.
UPDATE instances SET
  site_url = CASE
    WHEN base_url LIKE 'https://api.atlassian.com/%' THEN NULL ELSE base_url END,
  api_base_url = CASE
    WHEN base_url LIKE 'https://api.atlassian.com/%' THEN base_url ELSE NULL END;

ALTER TABLE instances DROP COLUMN base_url;
