# Pinned issues — logging against shared tickets — design

**Date:** 2026-08-20
**Supersedes:** nothing
**Superseded by:** nothing

The design for [#6](https://github.com/dgerrese/work-dashboard/issues/6). Pins are how time gets
logged against tickets that are not assigned to the user — shared work, standing meetings,
miscellaneous overhead. `GET/POST/DELETE /api/pins` back them, and the Today view grows a Pinned card
above the assigned instance cards.

The design of record settles the endpoint paths and the `pinned_issues` table and nothing else about
this ticket. #5 left it one question by name — pins span instances and the card-per-instance layout
has no place for them — and this document answers it.

**#6 builds on #5**, whose Today view is on `issue-5-assigned-issues` and in PR #38, unmerged at the
time of writing. `issue-6-pinned-issues` is a **stacked pull request** on top of it; see *Branching*.

## Decisions taken in brainstorming

1. **A "Pinned" card above the assigned section, spanning instances.** Each row carries its instance
   name, so the card needs no per-instance grouping. The two alternatives were rejected: folding pins
   into their own instance's card means an instance whose Jira fetch failed renders as an error and
   its pins vanish with it, and flipping Today to one merged list discards #5's layout and leaves
   per-instance errors homeless. **The chosen layout renders from the local database alone**, which is
   what `summary_cache` exists for: pins paint instantly and survive every instance being down.
2. **Pinning is a form inside the Pinned card** — instance `<select>`, issue-key field, Pin and
   Cancel. It is the only route that can pin an issue *not* assigned to the user, which is the entire
   purpose of pins. A pin control on assigned rows was rejected as extra surface that makes the
   assigned-and-pinned collision routine, and competes for room in `wd-ticket-row` that #7 and #8 want.
   Pinning from Settings was rejected as putting a daily action two clicks away.
3. **Cache on load, refresh on demand.** `GET /api/pins` reads the store and makes no Jira call.
   `GET /api/pins?refresh=1` re-looks-up every pin and rewrites the cache. Cache-only-forever was
   rejected because a renamed ticket would stay wrong until unpinned and re-pinned; refreshing on
   every load was rejected because it spends the round trip the cache column was added to avoid.
4. **The status is cached too**, which needs a migration adding `status_cache` to `pinned_issues`.
   Without it a refreshed pin shows a status chip that disappears on the next load — the same data on
   the server rendering two different rows, which reads as a glitch rather than a policy. With it a
   pinned row and an assigned row read identically.
5. **Deduplication is client-side.** An issue that is both pinned and assigned renders in the Pinned
   card only, and `today.ts` drops it from its instance card. `/api/issues` is **not touched**: making
   the fan-out aware of pins couples two resources and puts #5's most carefully tested code back in
   play for no gain.
6. **Unpinning gets no confirmation.** `time_entries` rows are keyed by `(instance_id, issue_key)` and
   have no foreign key to `pinned_issues`, so unpinning destroys nothing. #29 built `wd-confirm` for
   instance removal because that cascade *does* destroy logged time; reusing it here would train the
   user to click through a dialog that never guards anything.

## Branching

`issue-6-pinned-issues` is cut from `issue-5-assigned-issues`, not from `origin/main`, because
`web/src/views/today.ts` exists only there. This is a deliberate exception to the handoff's "branch
from `origin/main`" default and is recorded there.

GitHub's **stacked pull requests** carry it: public preview since 2026-07-30, all repositories, no
opt-in. When #6 is ready its pull request is opened with

```shell
gh stack link 38 issue-6-pinned-issues
```

which adopts PR #38 as the bottom layer and opens #6's on top of it, targeting
`issue-5-assigned-issues`. `gh stack link` is the no-local-tracking entry point, which suits this
repo's standing branch-in-place decision. Merging #38 then **rebases and retargets #6 onto `main` on
GitHub's servers**, with no local rebase and no `--force-with-lease`.

**Merging a stacked pull request lands every unmerged layer below it in one operation.** Merging #6's
pull request would therefore merge #5 as well, moving two tickets to `status:done` in one action. That
is the owner's to choose, and it is the reason it is written down here rather than discovered.

Nothing about this changes the hard constraints: one issue, one branch, one pull request, and every
merge is the owner's, on GitHub, never local.

## The schema

```sql
ALTER TABLE pinned_issues ADD COLUMN status_cache TEXT;
```

as `internal/store/migrations/2026-08-20_100000_pin_status_cache.sql`, plus the matching line in the
design of record's schema block so the two do not drift. `ALTER TABLE ... ADD COLUMN` needs no table
rebuild and cannot cascade, unlike the split-URL migration.

Both cache columns are nullable and both read as the empty string in Go. A pin created and never
refreshed has a summary from its creation and no status.

## The store — `internal/store/pins.go`

```go
type Pin struct {
    ID           int64
    InstanceID   int64
    IssueKey     string
    SummaryCache string
    StatusCache  string
    CreatedAt    time.Time
}

type PinInput struct {
    InstanceID   int64
    IssueKey     string
    SummaryCache string
    StatusCache  string
}

func (s *Store) Pins(ctx context.Context) ([]Pin, error)
func (s *Store) CreatePin(ctx context.Context, in PinInput) (*Pin, error)
func (s *Store) SetPinCache(ctx context.Context, id int64, summary, status string) error
func (s *Store) DeletePin(ctx context.Context, id int64) error
```

`Pins` returns oldest first, matching `Instances`, and returns an empty slice rather than nil.

**A duplicate is a sentinel, not a driver error.** `UNIQUE(instance_id, issue_key)` fails inside
SQLite, and the handler needs to tell that apart from a disk failure to answer 409 rather than 500:

```go
var ErrPinExists = errors.New("store: issue already pinned on this instance")
```

`CreatePin` maps the constraint violation onto it, the way `ErrInstanceNeedsURL` gives the handler
something to switch on. `SetPinCache` and `DeletePin` reuse `errNoRowsIfUnaffected`, so a missing id
is `sql.ErrNoRows` rather than a silent success.

The instance's `ON DELETE CASCADE` already removes an instance's pins; `TestDeleteInstanceCascadesToChildren`
covers the table today and gains the `status_cache` column for free.

## The Jira client — `internal/jira/issue.go`

```go
func (c *Client) Issue(ctx context.Context, key string) (*Issue, error)
```

`GET rest/api/3/issue/{key}?fields=summary,status`, returning the existing `jira.Issue` so nothing
downstream learns a new type. The key is **path-escaped** — `TestIssueKeyIsPathEscaped` in
`worklog_test.go` sets that precedent, and an unescaped key is how a stray character becomes a
different URL.

Status mapping is the client's existing one, unchanged: a 404 is `ErrNotFound`, a 401 or 403 is
`ErrUnauthorized`, a 5xx or transport failure is `ErrUnreachable`. This is the client's first
single-issue read; `SearchAssigned` is untouched.

## The API — `internal/server/pins.go`

```
GET    /api/pins              store only
GET    /api/pins?refresh=1    each pin re-looked-up, caches rewritten
POST   /api/pins              { "instanceId": 1, "issueKey": "SHARED-12" }
DELETE /api/pins/{id}
```

registered in `server.go` beside the existing routes, using the same `{id}` pattern as
`/api/instances/{id}`.

### The response

```json
[
  { "id": 3, "instanceId": 1, "instanceName": "Ridgeline", "key": "SHARED-12",
    "summary": "Weekly standup", "status": "In Progress",
    "url": "https://ridgeline.atlassian.net/browse/SHARED-12", "error": null }
]
```

**A bare array, and `POST` answers with a bare object.** Pins are a CRUD resource like instances, and
`/api/instances` is the shape to match; `/api/issues` wraps because it is a fan-out report whose
envelope has somewhere to grow.

- **`instanceName` is joined in by the handler** from the instances it already loads. The view renders
  the name, and making the browser fetch `/api/instances` to resolve an id is a round trip to answer a
  question the server had in hand.
- **`url` is built server-side** by the existing `browseURL`, empty when the instance has no site URL —
  identical to `/api/issues`, so `wd-ticket-row` needs no new rule.
- **`error` is non-null only on a refresh that failed**, and the pin still carries its cached summary
  and status. It is always null on the plain `GET`, which touches no network and cannot fail per-pin.
- **`summary` and `status` are the cached values**, empty string for "never fetched".

`POST` answers **201** with the created pin in that same row shape.
`DELETE` answers **204** with no body, and **404** `pin_not_found` when the id matches nothing.

### Validating a new pin

`POST /api/pins` is the only route that can reject, and it does so in this order:

1. **A malformed body or a blank `issueKey`** — 400 `invalid_request`.
2. **An unknown `instanceId`** — 404 `instance_not_found`, matching how the instance routes answer.
3. **The issue does not exist on that instance** — the `jira.Client.Issue` call returns
   `jira.ErrNotFound`, which is **404 `issue_not_found`**.
4. **Already pinned** — `store.ErrPinExists`, which is **409 `pin_exists`**.
5. Anything else from Jira falls through to the existing `instanceErrorFor` mapping.

**Step 3 needs its own branch and cannot be delegated.** `instanceErrorFor` maps `jira.ErrNotFound` to
`account_not_found` with a 502 and the message "the site answered but this account has no access to
it" — correct for the `/myself` probe it was written for, and wrong to the point of misleading here,
where a 404 means the user typed a key that does not exist. The branch comes first, and the rest of
the mapping is reused unchanged.

The lookup's summary and status are what get stored, so a successful pin is cached from the moment it
exists and the Pinned card never has a row with nothing in it.

### The refresh fan-out

`?refresh=1` fans out one goroutine per pin under `errgroup.WithContext`, each bounded by its own
`context.WithTimeout`, exactly as `issues.go` does — including the part a reader arrives not
expecting: **every goroutine returns `nil`**. A pin whose instance is unreachable must not blank the
others, and returning an error would cancel every sibling through the group's context. A failure is
recorded in that pin's own slot as its `error` field, its cached values are left untouched, and the
response is still 200.

Results are written into a preallocated `[]pinDTO` by index, so the order is the store's order with no
mutex and no sort.

**A refresh never unpins anything.** A pin whose issue has been deleted in Jira comes back
`ErrNotFound`, which surfaces as that row's error and leaves the row in place. Deleting a user's pin
because a Jira call said 404 is not a decision this endpoint gets to make.

Clients are resolved per instance, not per pin: two pins on one instance share one `clients.forInstance`
result, which also keeps `forInstance`'s first-use `api_base_url` repair from running twice
concurrently on the same row.

## The frontend

### `types.ts` and `api.ts`

```ts
export interface Pin {
  id: number;
  instanceId: number;
  instanceName: string;
  key: string;
  summary: string;
  status: string;
  url: string;
  error: ApiErrorBody | null;
}

export function listPins(options?: { refresh?: boolean }): Promise<Pin[]>;
export function createPin(instanceId: number, issueKey: string): Promise<Pin>;
export function deletePin(id: number): Promise<void>;
```

`summary`, `status` and `url` are plain strings rather than optional, mirroring `Issue` — under
`noUncheckedIndexedAccess` an optional field costs a guard at every use.

### `today.ts`

```
┌─ Pinned ────────────────────────────────────────────────────┐
│ Ridgeline · SHARED-12   Weekly standup      In Progress   ✕ │
│ Personal  · MISC-3      Admin overhead                    ✕ │
│                                                             │
│ [ Pin an issue ]                                            │
└─────────────────────────────────────────────────────────────┘

Assigned issues                                     [ Refresh ]

┌─ Ridgeline ─────────────────────────────────────────────────┐
│ WORK-412   Fix the CSV export encoding       In Progress    │
└─────────────────────────────────────────────────────────────┘
```

The Pinned card is a `wd-card` above #5's heading row. Its heading is set before insertion, because
`wd-card` has no `observedAttributes`.

**Pins and issues are fetched independently**, both started on render. The Pinned card paints as soon
as `/api/pins` answers and does not wait on the fan-out, which is the point of decision 1: with every
instance unreachable the assigned cards fill with errors and the pins are still there.

**The card is built from persistent regions**, not re-rendered wholesale: a `list` region and a `form`
region, threaded through a `Regions` object as #5 already does for the view. The form holds typed
input, and replacing the card on every mutation discards a half-typed issue key — the exact bug #29
paid to fix in Settings. The list region may be replaced wholesale, because it holds no input; keyed
reconciliation for rows with nothing to preserve is machinery guarding a case that does not exist.
This is narrower than #5's parked note for #7, which is about the assigned rows and stays open.

**The row is an `<li class="flex items-baseline gap-3">** holding a muted instance-name span, a
`<div class="flex-1">` wrapping the `wd-ticket-row`, and the unpin `wd-button`. **`wd-ticket-row` is
not modified**: #5 kept it free of anything instance-specific and that holds. It also sets its own
`className` in `connectedCallback`, so a class applied from outside before insertion would be
discarded — hence the wrapping div rather than a utility on the element.

**Deduplication** happens where the response is rendered: `today.ts` builds a `Set` of
`` `${instanceId}:${key}` `` from the pins and filters each instance's issues through it. Because both
fetches are independent, a failed `/api/pins` means no filtering rather than no issues.

**The form** is hidden behind a "Pin an issue" button. Revealed, it holds an instance `<select>`
populated by `listInstances()`, fetched when the form is first revealed and kept for the life of the
view. **It must be the full instance list, not the names in the pins response**: those name only
instances that already have a pin, so deriving the dropdown from them would make an instance
unpinnable until it had a pin — and the empty state unpinnable altogether. The names in the response
serve the rows, which is a different job.

Submitting disables the button, and a rejection renders a `wd-alert` inside the card carrying the
server's message: `pin_exists` and `issue_not_found` are both ordinary outcomes of typing, and both
must say which one happened.

**Unpinning** removes the row from the list region on success, with no reload and no confirmation.

**Refresh refreshes both.** #5's button calls `listIssues()`; it now also calls
`listPins({ refresh: true })`, and stays disabled until both settle. One button, both lists, because
two refresh buttons on one screen is a question the user should not have to answer.

**The states the Pinned card can be in:**

- **No instances configured** — the card is not rendered at all. #5's "No Jira instances yet." state
  takes over the whole content area, the Pinned card included, and a Pin form whose dropdown is empty
  is a control with nothing to do. Because the two fetches are independent, an empty Pinned card can
  paint first and be replaced when `/api/issues` answers; that is the one case where the card is
  removed after being shown, and it is correct — with no instances there can be no pins either, since
  `ON DELETE CASCADE` took them with the last instance.
- **No pins** — the card renders with a muted "Nothing pinned." and the Pin button.
- **Loading** — a muted "Loading…" line in the list region, as #5 does.
- **`/api/pins` failed outright** — one `wd-alert` in place of the list, with the Pin button hidden.
  The server would still reject a duplicate, but a pin created against a list that could not be read
  has nowhere to appear, which looks indistinguishable from the pin having failed.
- **A pin's refresh failed** — the row renders its cached values with its error message beside them.
  The rest of the card is unaffected.

## Testing

**Store.** A pin round-trips including both cache columns; a second pin of the same key on the same
instance returns `ErrPinExists`; the same key on a *different* instance is allowed; `SetPinCache`
rewrites both columns; deleting an instance takes its pins; `DeletePin` on a missing id is
`sql.ErrNoRows`; `Pins` is empty rather than nil when nothing is stored.

**Handlers**, against an `httptest.Server` standing in for Jira, never a real instance:

- `POST` stores the summary and status the lookup returned;
- each of the five rejections above answers its own status and code — in particular that a Jira 404
  is `issue_not_found` and **not** `account_not_found`;
- `GET` makes no Jira request at all, asserted by failing the fake server on any call;
- `GET ?refresh=1` rewrites the caches and reports a per-pin failure without a non-200;
- **the sibling guard**: with one instance failing and a healthy one **delayed**, the healthy pin
  still returns its refreshed values. The delay is the whole test — #5's whole-branch review found
  the zero-delay version stayed green while the property it named was broken, because the failing
  goroutine cancelled its sibling only after that sibling had already stored its result. It is proven
  by mutation, not by argument, and this ticket touches the fan-out pattern it guards.

**Playwright**, in `.claude/e2e/tests/`: pinning an issue renders it in the Pinned card; pinning the
same key twice shows the duplicate message rather than a second row; unpinning removes the row
without a reload; a pinned issue that is also assigned appears once.

## Out of scope

- **Time logging against a pin** — #7 and #8. This ticket renders rows; it adds no timer and no
  duration field.
- **Reordering pins.** They render oldest first.
- **Pinning from an assigned row**, per decision 2.
- **A count of what an instance's removal destroys.** #29 left its warning static and noted counts as a
  later intake; pins make those counts non-zero for the first time, which makes the intake worth
  raising — but raising it is not doing it.
- **`jira.ErrRateLimited`.** A 429 still falls to the mapping's `default` and becomes a 500. That is
  #19's territory, unchanged here.

## Acceptance criteria, mapped

| Criterion | Where it is met |
|---|---|
| `GET/POST/DELETE /api/pins` served and covered by handler tests | *The API*, *Testing* |
| Pinning stores `summary_cache` so pins render without a Jira round trip | Decision 3; `GET` asserted to make no Jira call |
| Pinning the same issue twice on one instance is rejected | `ErrPinExists` → 409 `pin_exists` |
| Pinning a key that does not exist on that instance is rejected | `jira.ErrNotFound` → 404 `issue_not_found` |
| Pins render in Today alongside assigned issues, visually distinguishable | The Pinned card, above and separate |
| An issue both assigned and pinned appears once | Decision 5, client-side dedupe |
| Unpinning removes it from the view without a reload | The list region, decision 6 |
| A Playwright spec covers pinning, rendering and unpinning | *Testing* |
