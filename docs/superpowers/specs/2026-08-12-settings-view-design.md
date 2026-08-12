# Settings view — design

**Date:** 2026-08-12
**Supersedes:** nothing
**Superseded by:** nothing

The design for [#4](https://github.com/dgerrese/work-dashboard/issues/4). It elaborates the ticket
sequence's fourth entry in
[`2026-08-04-work-dashboard-design.md`](2026-08-04-work-dashboard-design.md), which stays the design
of record wherever the two disagree.

The ticket arrived heavily refined: four decisions were settled when #21 and #22 were folded into
it, and its acceptance criteria are complete. This document does not restate them. It records the
design those criteria still left open — the migration's treatment of an unrecoverable site URL, the
package boundary for cloud-id resolution, and how much frontend shell the first UI ticket builds.

---

## What this ticket is

The Settings view: instance CRUD with a test-connection button. It is the first user-facing surface,
the first caller of `internal/store` from `cmd/server`, and the first frontend code beyond the
scaffolding's placeholder.

Two facts from smoke-testing #3 shape all of it. Basic auth fails against the site host and succeeds
against `https://api.atlassian.com/ex/jira/{cloudId}`, so an instance needs two URLs rather than one.
And `POST /rest/api/3/search/jql` answers an unauthenticated caller with `200 {"issues":[]}` rather
than a 401, so only `GET /rest/api/3/myself` can tell working credentials from rejected ones.

## Schema and migration

A new migration rebuilds `instances` — create, copy, drop, rename — rather than `ALTER TABLE DROP
COLUMN`. The rebuild is safe on any SQLite build and runs inside the transaction `applyMigration`
already opens.

```sql
site_url      VARCHAR(255) NULL CHECK (site_url     IS NULL OR site_url     <> ''),
api_base_url  VARCHAR(255) NULL CHECK (api_base_url IS NULL OR api_base_url <> ''),
CHECK (site_url IS NOT NULL OR api_base_url IS NOT NULL)
```

The backfill classifies the old `base_url` by host: an `api.atlassian.com` host becomes
`api_base_url`, anything else becomes `site_url`. Whichever column that leaves unfilled stays `NULL`.

**Both columns are nullable because neither can always be recovered.** `api_base_url` cannot be
resolved at migration time — that needs a network call, and a migration makes none. `site_url`
cannot be derived from a gateway URL at all: the mapping runs one way, and inverting it would itself
need an authenticated call. A row that held the gateway URL therefore migrates with its site URL
unknown, and the user supplies it once through Settings.

That is a deliberate reading of "an instance stored before this change keeps working without manual
repair". What must survive untouched is the ability to *reach Jira*, and it does — the gateway URL is
preserved exactly. What degrades is issue linking, which belongs to #5 and does not exist yet. The
`NOT NULL`-with-empty-string alternative was rejected: it would leave the schema unable to tell
"not set" from "set to nothing", and every reader would have to remember the convention.

**A `NULL` `api_base_url` is only ever a legacy row.** This falls out of the ticket's third decision
rather than being chosen: the save-time identity check needs the API base, so resolving the cloud id
is already part of creating an instance. Resolution-on-demand is therefore a repair path for migrated
rows, not the normal one — a much smaller surface than the criterion reads as in isolation.

## Store

`Instance` gains `SiteURL` and `APIBaseURL` as plain `string`s. `NULL` converts to `""` and back at
the single scan/insert boundary, so the database stays honest about absence while Go callers keep the
ergonomics of a zero value. The `<> ''` checks are what stop the two representations blurring into
each other.

`CreateInstance` and `UpdateInstance` take four positional strings today. Six would be unreadable at
the call site, so both move to a `store.InstanceInput` struct. One method is added,
`SetInstanceAPIBase`, for persisting a late-resolved base.

Keeping a stored token through a `PATCH` is the handler's job: it reads the row, merges, and calls
`UpdateInstance` with complete values. The store gains no nullable-token variant and stays unaware of
the distinction.

## `internal/atlassian` (new package)

```go
NormalizeSiteURL(raw string) (string, error)              // scheme and host, path and trailing slash stripped
ResolveCloudID(ctx, *http.Client, siteURL) (string, error) // GET {site}/_edge/tenant_info
APIBaseURL(cloudID string) string                          // the one gateway template
```

This exists so the gateway's URL shape has exactly one home, and it is not `internal/jira`. The
ticket's first decision requires that the client derive neither URL from the other; putting the
template beside `jira.Client` would satisfy the letter of that and lose its point. `jira.Client` is
handed an API base and uses it verbatim, exactly as it does today.

`NormalizeSiteURL` is what rejects a malformed site URL at the API boundary rather than on first use
against Jira. All three functions test against an `httptest.Server`.

## `internal/jira`

One addition: `(*Client).Myself(ctx) (*User, error)`, over the existing `do`, returning `accountId`,
`displayName` and `active`. Nothing else in the package changes, and `jira.New` keeps its signature.

## `internal/server`

`clients.go` holds the per-instance client factory: unseal the token, resolve and persist
`api_base_url` if it is null, build the client. #5 through #10 all need this sequence, which is why
it is a named type rather than a helper inside a handler.

`instances.go` holds the five handlers. Responses use an explicit DTO rather than `store.Instance`,
so that adding a field to the store struct cannot leak a token into a response by accident. The
existing `writeJSON` takes a string literal and grows into a real encoder.

Errors carry a stable `code` alongside their message:

| condition | status | code |
|---|---|---|
| missing or blank name, email, token | 400 | `invalid_name`, `invalid_email`, `missing_token` |
| malformed site URL | 400 | `invalid_site_url` |
| `/_edge/tenant_info` unreadable | 502 | `tenant_unreadable` |
| `/myself` rejects the credentials | 401 | `credentials_rejected` |
| Jira unreachable or 5xx | 502 | `instance_unreachable` |

The last two are what make a failed connection test distinguishable from an unreachable host.

**The identity check runs on every write that stores an instance.** `POST` and `PATCH` both run it,
whether or not the credentials changed. `DELETE` does not — it removes the row, leaving nothing to
verify.

A `PATCH` that supplies no token verifies with the stored one, unsealed, so re-verification does not
force the credential to be re-entered.

The cost is accepted knowingly: renaming an instance requires Jira to be reachable, and a display
name cannot be corrected while offline. What it buys is that no write can leave a stored instance in
a state nothing has checked — the failure #22 was raised for. A rule with no exceptions is also
harder to erode than one carrying an "unless only the name changed" clause, which is the form this
check would most likely decay into.

`cmd/server` opens the store and builds the sealer, passing both into `server.New`. This is the
store's first caller.

## Frontend

```
web/src/
  main.ts       mounts the router
  router.ts     '/' → placeholder, '/settings' → import('./views/settings')
  api.ts        typed fetch wrappers
  types.ts      hand-written mirror of the Go response structs
  components/   wd-card.ts  wd-button.ts  wd-alert.ts
  views/        settings.ts
```

The router lands here rather than in #5 because `handleAsset` already falls back to the app shell for
client-side routes, so the shell promises routing that does not yet exist. `/` renders a short
placeholder linking to Settings until #5 brings Today.

Components are limited to what the form uses. `wd-ticket-row`, `wd-timer` and `wd-time-entry` are
named in the design of record but belong to #5 through #8; inventing their APIs against no caller
would mean rewriting them when a real one appears.

`api.ts` throws a typed `ApiError{status, code, message}`, which is what lets the view tell a
rejected credential from an unreachable host without matching on message text. An instance whose
`site_url` is null renders in a warning state naming what is missing.

Every control is a custom element in light DOM. No shadow roots: they would stop Tailwind's
utilities reaching component internals.

## Testing

- The migration runs against a database seeded with a pre-migration row in **both** URL shapes. This
  is the table-driven test the ticket asks for, and the gateway-shaped row is the case that would
  otherwise be discovered in production.
- Store tests cover the new columns, `InstanceInput` and `SetInstanceAPIBase`.
- `internal/atlassian` tests against an `httptest.Server`, including a site whose tenant info is
  unreadable.
- The `/myself` trap gets a case of its own: a stub answering `search/jql` with `200 {"issues":[]}`
  and `/myself` with `401` must make the connection test **fail**. This is the regression that #22
  was raised for.
- Handler tests cover the five routes, that no response carries the token, that `PATCH` without a
  token keeps the stored one and verifies with it, that a `PATCH` changing only the display name
  still runs the identity check and fails when Jira rejects it, and that deleting cascades.
- A Playwright spec adds an instance and runs a connection test, stubbing the backend with
  `page.route`.

No test contacts a real Jira instance.

## Out of scope

As the ticket has it: issue fetching, time logging, Jira Server/Data Center, scheduled re-testing of
stored credentials, and #19's error mapping. The connection test separates 401 from 502 with the
sentinels that exist today.
