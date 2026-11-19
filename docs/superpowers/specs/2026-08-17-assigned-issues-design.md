# Assigned issues — concurrent fan-out and the Today view — design

**Date:** 2026-08-17
**Supersedes:** nothing
**Superseded by:** nothing

The design for [#5](https://codeberg.org/DionGerrese/ThatApp/issues/5). `GET /api/issues` fetches
the issues assigned to the user from every configured instance concurrently, and the Today view
renders them. It is the first view of the app's actual purpose: `/` has shown a placeholder since CB#4.

The design of record settles the endpoint's path and the JQL and nothing else about this ticket, which
is why it was brainstormed. `internal/jira.SearchAssigned` already exists and is untouched here.

## Decisions taken in brainstorming

1. **Today lives at `/today`, and `/` redirects to it.** The alternative of putting Today on `/`
   directly was rejected by the owner in favour of a nameable URL beside `/week` and `/settings`. The
   cost is accepted: the router has no redirect concept today, so this adds one.
2. **A card per instance, not one merged list.** Each instance gets a titled card holding its own
   issues in Jira's `updated DESC` order, so **no merge key is needed and `jira.Issue` is not
   touched** — a merged list would have needed a new `updated` field on it. A failing instance renders
   its error inside its own card, which is the most obvious place a user could look for it. The
   accepted cost: with one instance it is a card inside a card, and **CB#6's pinned issues span
   instances, so they have no natural home in this layout** — that is CB#6's problem to solve, and this
   document does not pre-empt it.
3. **Fetch on render, plus a Refresh button. No cache.** Navigating away and back refetches. The
   button earns its place because CB#7 and CB#8 park the user on this view all day, and without it the
   only way to see new Jira work is to navigate away and back. An in-memory cache was rejected: it
   adds a second copy of state that can disagree with the server, and a staleness question at every
   entry point.
4. **The response is grouped and always 200** when the request itself is well-formed. A
   reachable-but-broken Jira instance is per-instance data, not a request failure.

## `GET /api/issues`

```json
{ "instances": [
  { "id": 1, "name": "Work", "error": null, "issues": [
      { "key": "WORK-412", "summary": "Fix the CSV export encoding",
        "status": "In Progress", "url": "https://work.atlassian.net/browse/WORK-412" } ] },
  { "id": 2, "name": "Personal", "issues": [],
    "error": { "code": "credentials_rejected", "message": "Jira rejected the email and API token." } }
] }
```

- **Order mirrors `GET /api/instances`** — `store.Instances` orders by `created_at, id`, deliberately
  rather than by `id`, because `instances.id` is `INTEGER PRIMARY KEY` without `AUTOINCREMENT` and
  rowids can be reused. Ordering stays server-authoritative; the view never sorts.
- **`issues` is always an array, never `null`**, including for a failed instance. Zero configured
  instances gives `{"instances": []}` and a 200, not an error.
- **`url` is built server-side** as `site_url` + `/browse/` + `key`. It is **the empty string when the
  row has no site URL** — a migrated row, which CB#4's design made possible on purpose — and the view
  then renders the key as plain text. Building it here keeps URL construction out of the client and
  means the client never needs `siteUrl` at all.
- **`error` is the repo's existing `{code, message}` envelope**, so its codes are the ones the Settings
  view already renders: `credentials_rejected`, `account_not_found`, `instance_unreachable`,
  `tenant_unreadable`. It is `null` on success.
- **A non-200 means nothing could be attempted** — the instance list itself was unreadable. That is a
  500 with the usual top-level `{code, message}`.

### Sharing the error mapping

`writeInstanceError` in `internal/server/instances.go` maps a Go error to a status, a code and a
message, and writes it. The per-instance path needs the same mapping without the writing, so that
function splits into:

```go
func instanceErrorFor(err error) (status int, code, message string)
func writeInstanceError(w http.ResponseWriter, err error)  // now a thin caller
```

This is the only change to `instances.go`. **It does not trigger the file split** the handoff flags:
that condition was CB#5's issue routes landing in the same file, and they land in `issues.go` instead.

`jira.ErrRateLimited` does not exist — a 429 still falls to the mapping's `default` branch and becomes
a 500. That is CB#19's territory, unchanged here, and it means a rate-limited instance shows a generic
message in its card rather than a useful one.

## The fan-out — `internal/server/issues.go`

Load the instances from the store, then one goroutine per instance under
`errgroup.WithContext`, each writing into its own preallocated slot in a `[]instanceIssuesDTO` sized
to the instance count. No mutex, no shared append, and the result order is the store's order for free.

**Every goroutine returns `nil`.** `errgroup` is used for its `Wait` and its context, not for its
error propagation: the first failure must not cancel the others, which is precisely the criterion that
one failing instance does not blank the list. A per-instance failure is recorded into that instance's
slot as an `error` field. This needs a comment in the code, because a reader arrives expecting
`return err`.

Each goroutine bounds its own work with `context.WithTimeout(ctx, issueFetchTimeout)` where
`issueFetchTimeout` is **15 seconds**. One hung instance then produces its own `instance_unreachable`
rather than holding the whole response for `jira.Client`'s 30s internal timeout. This is deliberately a
second timeout stacked on the client's: bounding the whole handler instead would turn one slow instance
into *every* instance failing, which is the failure mode this ticket exists to prevent.

No `SetLimit`. The instance count is one person's Jira accounts — single digits by construction — and
a limit would be machinery guarding against a case that cannot occur.

Each goroutine's sequence is `clients.forInstance(ctx, &inst)` then `client.SearchAssigned(ctx)`.
`forInstance` already resolves and persists a missing `api_base_url` on first use, so a migrated row
repairs itself here as it does everywhere else; a row with neither URL fails with
`store.ErrInstanceNeedsURL` and shows that instance's error in its card.

## The frontend

### `types.ts` and `api.ts`

```ts
export interface Issue { key: string; summary: string; status: string; url: string; }
export interface InstanceIssues {
  id: number; name: string; issues: Issue[]; error: ApiErrorBody | null;
}
export interface IssuesResponse { instances: InstanceIssues[]; }

export function listIssues(): Promise<IssuesResponse>;
```

`url` is a plain `string` rather than optional, mirroring how `Instance.siteUrl` already models "not
set" as empty — the Go struct has no pointer there and `noUncheckedIndexedAccess` makes an optional
field cost a guard at every use.

### `that-ticket-row`

A light-DOM component with attributes `key`, `summary`, `status` and `url`, reactive through
`observedAttributes` — like `that-button` and `that-alert`, and **unlike `that-card`**, whose `heading` is
not reactive and silently ignores a later change.

It renders the key, the summary and the status. **The key is an `<a target="_blank" rel="noopener">`
when `url` is non-empty and plain text when it is not**, so a migrated instance's rows still render.
`rel="noopener"` is not optional: `target="_blank"` without it hands the opened page a `window.opener`
handle back into the app.

The component adds no controls of its own. CB#7 and CB#8 append a timer and a duration field into it,
which light DOM already permits without a slot.

### `today.ts`

```
Assigned issues                                  [ Refresh ]

┌─ Work ─────────────────────────────────────────────────────┐
│ WORK-412   Fix the CSV export encoding        In Progress   │
│ WORK-388   Flaky login test                   In Review     │
└─────────────────────────────────────────────────────────────┘
┌─ Personal ─────────────────────────────────────────────────┐
│ ⚠ Jira rejected the email and API token.                    │
└─────────────────────────────────────────────────────────────┘
```

A heading and a Refresh `that-button` above a `that-card` per instance. Each card holds exactly one of
three things:

- a `<ul>` of `that-ticket-row`, one per issue;
- a `that-alert` carrying the instance's `error.message`, when `error` is non-null;
- a muted "No issues assigned." when the instance succeeded with an empty list.

The card's title is the instance name, set **before the card is inserted**: `that-card` has no
`observedAttributes`, so a heading assigned after insertion is silently ignored.

**The four states the view itself can be in:**

- **First load** — a muted "Loading…" line, replaced when the response arrives.
- **Refreshing** — the existing cards stay on screen and the Refresh button disables. A refresh never
  flashes empty, because a list that blinks out and back is indistinguishable from one that broke.
- **No instances configured** — "No Jira instances yet." and an Open Settings link, **replacing the
  whole content area including the heading row**: a Refresh button that can only ever refetch an empty
  list is a control with nothing to do. This state takes over what the router placeholder says today,
  and it is the reason the placeholder's wording changes rather than being deleted outright.
- **The whole request failed** — one `that-alert` with the message, and Refresh stays usable so the user
  can retry without navigating.

**Today re-renders wholesale, and that is deliberate.** CB#29 gave the Settings view keyed
reconciliation because it holds typed input and per-row in-flight results; Today in CB#5 holds neither,
and building reconciliation for rows with nothing to preserve is machinery guarding a case that does
not exist yet. **CB#7 must revisit this** the moment a row carries a duration field the user types into —
at that point a wholesale re-render discards input mid-typing, which is exactly the bug CB#29 paid to
fix. This is written here so CB#7 finds it rather than rediscovering it.

`that-button` is given a `label` attribute, which is the sole source of its inner button's accessible
name; without it Playwright's role-based queries cannot find the button at all.

### The router

`renderCurrent` consults a redirect map before resolving a route:

```ts
const redirects: Record<string, string> = { "/": "/today" };
```

A match rewrites the URL with **`history.replaceState`, not `pushState`** — a pushed redirect leaves
`/` in the history stack, so Back lands on `/`, which redirects forward again and traps the user.

`renderPlaceholder` survives as the fallback for a genuinely unknown path, reworded: "Add a Jira
instance to get started" now belongs to Today's empty state, so the placeholder becomes a not-found
line with a link to Today. `index.html`'s nav gains a Today link beside Settings, which grows the app
shell by a few dozen bytes against a 14kB budget it currently uses 1314 bytes of.

## Testing

### Go — `internal/server/issues_test.go`

Table-driven with `httptest`, against fake Jira servers reached through the `apiBaseFor` injection
point `instanceClients` already exposes for exactly this. **No test contacts a real Jira instance.**

1. **Two instances both succeed** — both groups present, in the store's order, each issue tagged with
   its instance and carrying a `/browse/` URL built from that instance's site.
2. **One instance 401s** — the other's issues are still present, and the failing group carries
   `credentials_rejected` with an empty `issues` array. This is the criterion that a failure does not
   blank the list.
3. **Zero configured instances** — `{"instances": []}` and a 200.
4. **An instance with no site URL** — its issues render with `url` empty rather than a malformed
   `/browse/WORK-1`.
5. **The concurrency test** — two fake instances that each sleep 200ms before answering. Asserts the
   handler returns in under 350ms, where a serial fan-out takes at least 400ms. This is the criterion
   about total time being closer to the slowest instance than to the sum, and it is the one test here
   that a plausible refactor — dropping the goroutines for a loop — would fail.

### Playwright — `.claude/e2e/tests/today.spec.ts`

Stubbing `/api/issues` with `page.route`, the way `settings.spec.ts` stubs the instance routes:

1. **Two instances' issues render together**, each under its own instance's heading.
2. **One instance failing still shows the other's issues**, alongside that instance's error.
3. **An issue key links to the Jira issue**, and a row from an instance with no site URL renders the
   key as text.
4. **Refresh refetches** — the second response differs, and the view shows the new list.
5. **`/` lands on Today** with `/today` in the address bar, which is the redirect's regression test.

**CB#5 does run e2e.** The handoff records that "CB#5 and CB#9 will skip e2e" under the `paths:` filter in
`.github/workflows/e2e.yml` because they touch no frontend files. That holds for CB#9; it is wrong for
CB#5, which adds `today.ts` and `that-ticket-row.ts`. The gate needs no change — the note does, and this
ticket corrects it.

Everything runs through Docker: `make verify` and `make test-e2e`, both green before the pull request.

## Dependencies

- **CB#4 landed everything this builds on**: the split URL columns, `internal/atlassian`,
  `instanceClients`, the JSON error envelope, `api.ts`, the router and the first `that-*` components.
- **CB#6 follows and inherits a layout question.** Pinned issues span instances, and the card-per-instance
  layout has no place for them. CB#6 decides that; CB#5 does not constrain it beyond keeping
  `that-ticket-row` free of anything instance-specific.
- **CB#7 must revisit the wholesale re-render**, as above.

## Out of scope

- **Pinned issues** (CB#6) and **any time logging** (CB#7, CB#8) — no timer, no duration field, no day total.
  `that-ticket-row` is shaped to accept them and carries none of them.
- **Filtering, sorting or searching the list.** The JQL is fixed and the order is Jira's.
- **Pagination in the UI.** `SearchAssigned` already pages internally to 100 pages; a person's
  assigned open issues do not reach that.
- **Caching or a service worker** — CB#12 owns offline behaviour.
- **Rate-limit handling** (CB#19). A 429 shows a generic message in that instance's card.
- **A merged cross-instance list**, and therefore an `updated` field on `jira.Issue`. Rejected in
  brainstorming, recorded here so it is not reintroduced as an obvious improvement.
