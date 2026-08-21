# Pinned issues — logging against shared tickets — design

**Date:** 2026-08-20
**Supersedes:** nothing
**Superseded by:** nothing

The design for [#6](https://github.com/dgerrese/work-dashboard/issues/6). Pins are how time gets
logged against tickets that are not assigned to the user — shared work, standing meetings,
miscellaneous overhead. `GET/POST/DELETE /api/pins` back them, `GET /api/issues/search` finds the
issue to pin, and the Today view grows a Pinned card above the assigned instance cards.

The design of record settles the endpoint paths and the `pinned_issues` table and nothing else about
this ticket. #5 left it one question by name — pins span instances and the card-per-instance layout
has no place for them — and this document answers it.

**#6 builds on #5**, whose Today view was on `issue-5-assigned-issues` and in PR #38, unmerged when
this was written. **#38 merged on 2026-08-20**, so the stacking this document planned for is moot;
see *Branching*.

## Decisions taken in brainstorming

1. **A "Pinned" card above the assigned section, spanning instances.** Each row carries its instance
   name, so the card needs no per-instance grouping. The two alternatives were rejected: folding pins
   into their own instance's card means an instance whose Jira fetch failed renders as an error and
   its pins vanish with it, and flipping Today to one merged list discards #5's layout and leaves
   per-instance errors homeless. **The chosen layout renders from the local database alone**, which is
   what `summary_cache` exists for: pins paint instantly and survive every instance being down.
2. **Pinning is a search box inside the Pinned card** — one combobox that searches by issue key *and*
   by title, across every instance at once, and pins the issue you pick. A pin control on assigned rows
   was rejected as extra surface that makes the assigned-and-pinned collision routine, and competes for
   room in `wd-ticket-row` that #7 and #8 want. Pinning from Settings was rejected as putting a daily
   action two clicks away.
3. **The search spans instances, so there is no instance picker.** An earlier draft paired an instance
   `<select>` with a free-form key field; the owner replaced it on 2026-08-20 with a search select, and
   searching within one chosen instance was rejected in the same breath. Pins span instances by
   definition, and requiring the user to know *which* instance a shared ticket lives on before they can
   look for it asks them for the answer the search exists to give. The form is one control as a result.
   **What it costs is written down rather than discovered:** a Jira search per instance per keystroke
   pause, a new endpoint, and a new component — see *The search*.
4. **Cache on load, refresh on demand.** `GET /api/pins` reads the store and makes no Jira call.
   `GET /api/pins?refresh=1` re-looks-up every pin and rewrites the cache. Cache-only-forever was
   rejected because a renamed ticket would stay wrong until unpinned and re-pinned; refreshing on
   every load was rejected because it spends the round trip the cache column was added to avoid.
5. **The status is cached too**, which needs a migration adding `status_cache` to `pinned_issues`.
   Without it a refreshed pin shows a status chip that disappears on the next load — the same data on
   the server rendering two different rows, which reads as a glitch rather than a policy. With it a
   pinned row and an assigned row read identically.
6. **Deduplication is client-side.** An issue that is both pinned and assigned renders in the Pinned
   card only, and `today.ts` drops it from its instance card. `/api/issues` is **not touched**: making
   the fan-out aware of pins couples two resources and puts #5's most carefully tested code back in
   play for no gain.
7. **Unpinning gets no confirmation.** `time_entries` rows are keyed by `(instance_id, issue_key)` and
   have no foreign key to `pinned_issues`, so unpinning destroys nothing. #29 built `wd-confirm` for
   instance removal because that cascade *does* destroy logged time; reusing it here would train the
   user to click through a dialog that never guards anything.

## Branching

`issue-6-pinned-issues` was cut from `issue-5-assigned-issues`, not from `origin/main`, because
`web/src/views/today.ts` existed only there — a deliberate exception to the handoff's "branch from
`origin/main`" default, and the reason this document planned for GitHub's stacked pull requests.

**That is all settled now.** PR #38 merged on 2026-08-20 and PR #52 (#44, the visual design
language) on 2026-08-21, and this branch was rebased onto `main` afterwards, carrying only its three
documentation commits. #6's pull request is therefore an ordinary one against `main`, with no
`gh stack link` and no bottom layer, and the "merging a stack lands every layer below it" hazard this
section was written to record no longer applies.

Nothing about this changes the hard constraints: one issue, one branch, one pull request, and every
merge is the owner's, on GitHub, never local.

## The schema

```sql
ALTER TABLE pinned_issues ADD COLUMN status_cache TEXT;
```

as `internal/store/migrations/2026-08-20_100000_pin_status_cache.sql`, plus the matching line in the
design of record's schema block so the two do not drift. `ALTER TABLE ... ADD COLUMN` needs no table
rebuild and cannot cascade, unlike the split-URL migration.

Both cache columns are nullable and both read as the empty string in Go. **In practice neither is ever
empty:** `POST /api/pins` looks the issue up before storing it and writes both from that one response,
so a pin has a summary and a status from the moment it exists. An empty `status_cache` is reachable
only for a row written before this migration, and there are none — the table has never held a row. The
columns stay nullable because the schema cannot express that and a rebuild to add a `CHECK` would
cascade into `time_entries`, which is the same reason the split-URL migration left its own invariant to
`validate`.

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

### Searching by title — `internal/jira/search.go`

```go
func (c *Client) SearchText(ctx context.Context, query string, limit int) ([]Issue, error)
```

It reuses `SearchAssigned`'s `POST /rest/api/3/search/jql` path, request struct and response struct —
same `Fields: []string{"summary", "status"}`, same decoding — with a different JQL and **no paging**:
one page of `limit`, because a type-ahead that walks 100 pages is a bug, not thoroughness.

```
summary ~ "<escaped>*" AND statusCategory != Done ORDER BY updated DESC
```

**The issue picker endpoint (`/rest/api/3/issue/picker`) was rejected**, despite being purpose-built
for type-ahead: it returns no status, and `status_cache` needs one at pin time, so it would have cost a
second round trip per pinned issue to learn what `search/jql` already returns in the first.

Three properties of Jira's `~` operator that the implementation must respect, and that the UI copy has
to be honest about:

- **It matches word prefixes, not substrings.** `secur*` finds "security"; `curity*` finds nothing.
- **A leading wildcard is rejected outright** by the endpoint, so `*curity` is not a workaround.
- **`*` must sit inside the quotes**, and the quotes are JQL syntax rather than part of the query.

`escapeJQL` therefore escapes `\` and `"` in that order and is the only thing standing between a typed
`"` and a malformed query. It is worth its own table-driven test: a query of `He said "hi"` must reach
Jira as one intact clause.

**Key matching is deliberately not JQL.** `key = "NOSUCH-1"` is a query *error* when the project does
not exist — Jira answers 400, not an empty result — so a key-shaped query cannot simply be ORed into
the clause. The handler instead calls `Issue` for it, where a miss is `ErrNotFound` and costs nothing.
That is the same call `POST /api/pins` already needs, so this adds no third Jira mechanism.

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
where a 404 means the key does not exist on that instance. The branch comes first, and the rest of
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

## The search — `internal/server/issue_search.go`

```
GET /api/issues/search?q=<text>
```

Its own file rather than more of `issues.go`: that file is #5's fan-out and its most carefully tested
code, and the handoff's warning about `instances.go` growing across tickets applies here before it
happens rather than after.

```json
{ "results": [
    { "instanceId": 1, "instanceName": "Ridgeline", "key": "SHARED-40",
      "summary": "Vendor security review", "status": "To Do",
      "url": "https://ridgeline.atlassian.net/browse/SHARED-40" }
  ],
  "errors": [
    { "instanceId": 2, "instanceName": "Personal",
      "error": { "code": "instance_unreachable", "message": "the Jira site could not be reached" } }
  ] }
```

**A flat `results` list with `errors` beside it**, rather than `/api/issues`'s per-instance grouping:
the consumer is one combobox rendering one ordered list, and a grouped response would only be flattened
in the browser. Both arrays are always present and never null.

Per instance, concurrently:

1. **If `q` is key-shaped** (`^[A-Za-z][A-Za-z0-9_]*-[0-9]+$`, case-folded to upper), `Issue(ctx, q)`.
   A hit leads the results for that instance; `ErrNotFound` is discarded rather than recorded as an
   error, because "no issue by that key here" is an ordinary outcome of typing.
2. `SearchText(ctx, q, searchLimit)` with `searchLimit = 10`.
3. Drop a text hit whose key equals the key hit, so an exact match is not listed twice.

A `q` shorter than two characters answers `200` with both arrays empty and reaches no instance at all —
the same floor the browser debounces to, enforced server-side so a hand-made request cannot fan a
one-character query across every site.

**Ordering is by instance, in the store's order, then Jira's `updated DESC` within each.** Merging by
recency across instances was rejected for the reason #5 gives for its card-per-instance layout: it
needs an `updated` field on `jira.Issue` that nothing else wants.

### One fan-out, three callers

There are now three places that run one goroutine per instance and record per-instance failures without
cancelling siblings: assigned issues, the pin refresh, and this. The third is where copying it a second
time stops being cheaper than naming it, so `issues.go` grows:

```go
func fanOutInstances[T any](ctx context.Context, instances []store.Instance,
    timeout time.Duration, work func(context.Context, store.Instance) T) []T
```

— preallocated results by index, `errgroup` for `Wait` and its context only, every goroutine returning
`nil`, each bounded by its own `context.WithTimeout`. The three callers keep their own DTO shapes and
their own error mapping; only the concurrency moves.

**This touches #5's most load-bearing test**, so its guard runs again against the extracted version:
`TestGetIssuesKeepsWorkingInstancesWhenOneFails` keeps the delay on the healthy instance that makes the
cancellation observable, and the extraction is not done until that test has been shown to fail when
`fanOutInstances` is mutated to propagate the first error. #5's review found the zero-delay version
green while the property was broken; re-proving it by mutation is the only thing that makes moving this
code safe.

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

export interface IssueHit {
  instanceId: number;
  instanceName: string;
  key: string;
  summary: string;
  status: string;
  url: string;
}
export interface InstanceFailure {
  instanceId: number;
  instanceName: string;
  error: ApiErrorBody;
}
export interface IssueSearchResponse { results: IssueHit[]; errors: InstanceFailure[]; }

export function listPins(options?: { refresh?: boolean }): Promise<Pin[]>;
export function createPin(instanceId: number, issueKey: string): Promise<Pin>;
export function deletePin(id: number): Promise<void>;
export function searchIssues(query: string, signal: AbortSignal): Promise<IssueSearchResponse>;
```

`searchIssues` takes an `AbortSignal` and it is not optional. Type-ahead is the first place in this app
where a second request can overtake the first, and the last response to arrive is not reliably the last
one asked for; aborting the previous request is what stops a stale result painting over a fresh one.
`request()` in `api.ts` gains a `signal` pass-through, and an `AbortError` is swallowed by the caller
rather than rendered as a failure.

`summary`, `status` and `url` are plain strings rather than optional, mirroring `Issue` — under
`noUncheckedIndexedAccess` an optional field costs a guard at every use.

### `today.ts`

```
┌─ Pinned ────────────────────────────────────────────────────┐
│ Ridgeline   SHARED-12   Weekly standup   In Progress [Unpin]│
│ Personal    MISC-3      Admin overhead   Open        [Unpin]│
│─────────────────────────────────────────────────────────────│
│ Find an issue                                               │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ security                                                │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Ridgeline  SHARED-40  Vendor security review      To Do │ │
│ │ Personal   MISC-15    Security questionnaire      Open  │ │
│ └─────────────────────────────────────────────────────────┘ │
│ [ Cancel ]                                                  │
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

**The form** is hidden behind a "Pin an issue" button. Revealed, it is a single labelled combobox —
"Find an issue" — and a Cancel button. There is no instance picker and no separate submit: **choosing a
result is the act of pinning**, which is what one control instead of three buttons buys. `listInstances()`
is not called at all.

Failures render a `wd-alert` inside the card carrying the server's message.

**Unpinning** removes the row from the list region on success, with no reload and no confirmation. The
control is a secondary `wd-button` labelled **"Unpin"**, not an ✕: `wd-button` renders `textContent`
only, so an icon would mean a new component, and Settings already establishes text buttons in row
actions (Test / Edit / Remove). Matching that costs nothing and invents nothing.

### `wd-combobox`

The one genuinely new component, and the first `wd-*` with interaction logic rather than presentation.
A native `<select>` cannot be searched, so this is a text input plus a listbox:

```
wd-combobox
  input   role="combobox" aria-autocomplete="list" aria-expanded aria-controls
          aria-activedescendant
  ul      role="listbox" id
    li > button  role="option" id aria-selected
```

Attributes in: `label`, `placeholder`, `disabled`. Out: `wd-search`, `wd-select` and `wd-cancel`
`CustomEvent`s — `wd-select` carries the chosen hit. The `wd-` prefix is load-bearing, not decorative:
an earlier `search`/`select` pairing collided with native events and crashed the app in Firefox, and
`cancel` was renamed alongside them by the same argument even though no native `cancel` fires on a text
input — closing the hazard by construction rather than by an argument that happens to hold today. It
owns keyboard behaviour — **↓/↑** move the active option and wrap, **Enter** chooses it, **Escape**
closes the form, **Tab** closes the popup — and it owns nothing about Jira: `today.ts` feeds it results
and decides what choosing one means. The active option is tracked by index and mirrored into
`aria-activedescendant`; focus never leaves the input, which is what makes the pattern work for a
screen reader.

**Debounce is 350ms and the floor is two characters**, both in the component. Each pause costs one Jira
call per instance, so this is the difference between a search and a denial-of-service against the
owner's own sites. The in-flight request is aborted when a new one starts.

**Already-pinned issues appear but cannot be chosen** — rendered muted with a "Pinned" tag in place of
the status, and `aria-disabled`, not the `disabled` attribute: a disabled button is skipped by a screen
reader entirely, and "already pinned" is worth announcing rather than hiding. `aria-disabled` does not
stop a click or an Enter keypress on its own, so `choose()` is what actually refuses the pin. This turns
the duplicate case from an error you meet by typing into one you can see coming; `pin_exists` stays in
the API as a race guard, not as a routine outcome.

**Refresh refreshes both.** #5's button calls `listIssues()`; it now also calls
`listPins({ refresh: true })`, and stays disabled until both settle. One button, both lists, because
two refresh buttons on one screen is a question the user should not have to answer.

**The states the Pinned card can be in:**

- **No instances configured** — the card is not rendered at all. #5's "No Jira instances yet." state
  takes over the whole content area, the Pinned card included, and a search that can only ever reach
  zero instances is a control with nothing to do. Because the two fetches are independent, an empty
  Pinned card can paint first and be replaced when `/api/issues` answers; that is the one case where the
  card is removed after being shown, and it is correct — with no instances there can be no pins either,
  since `ON DELETE CASCADE` took them with the last instance.
- **No pins** — the card renders with a muted "Nothing pinned." and the Pin button.
- **Loading** — a muted "Loading…" line in the list region, as #5 does.
- **`/api/pins` failed outright** — one `wd-alert` in place of the list, with the Pin button hidden.
  The server would still reject a duplicate, but a pin created against a list that could not be read
  has nowhere to appear, which looks indistinguishable from the pin having failed.
- **A pin's refresh failed** — the row renders its cached values with its error message beside them.
  The rest of the card is unaffected.

**And the states the search itself can be in**, all inside the popup except the first:

- **Under two characters** — no popup, and a muted line under the input: "Searches every instance. Two
  characters to start." It states the scope, which is otherwise invisible once the instance picker is
  gone.
- **Searching** — a muted "Searching…" line. The previous results are replaced rather than left
  stale, because a list that lags the query reads as a wrong answer.
- **Results** — the list. Each option carries instance, key, summary and status **in the same order and
  the same columns as the pinned row it will become**, so choosing one holds no surprise.
- **No matches** — "No issues match “<query>”." Worth naming the query back: with word-prefix matching,
  a fruitless search is usually a query problem rather than an empty Jira.
- **Some instances failed** — the results that did arrive, plus a muted footer naming the instances that
  did not: "Personal could not be searched." One instance being down must not blank the others, which is
  the same property `fanOutInstances` exists to preserve.
- **Every instance failed** — a `wd-alert` in the popup carrying the first error's message.
- **Pinning** — the input is disabled and the popup closes while `POST /api/pins` is in flight. On
  success the form collapses and the row appears; on failure the alert renders and the form stays open
  with the query intact.

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

**The Jira client.** `SearchText` sends the JQL the design names, with `summary`, `status` and the
limit; `escapeJQL` is table-driven over a quote, a backslash, both, and neither; a query already
containing `*` is not double-wildcarded. No paging: a response carrying a `nextPageToken` is not
followed, asserted by failing the fake server on a second call.

**The search handler.** A key-shaped query calls `Issue` and leads with the hit; a key-shaped query
that misses discards `ErrNotFound` and still returns the text results; an exact hit also present in the
text results appears once; a query under two characters answers 200 with empty arrays and makes **no**
Jira request at all; one instance failing puts that instance in `errors` while the other's results are
returned — again **with the healthy instance delayed**, which is the only version of that test that
fails when the fan-out is broken.

**`fanOutInstances`.** Its extraction is verified by re-running #5's guard against it and by mutating
the helper to propagate the first error, which must turn that test red. A refactor that cannot be shown
to break the test it was supposed to preserve has not been verified.

**Playwright**, in `.claude/e2e/tests/`: typing two characters searches and renders matches from more
than one instance; choosing one pins it and it appears in the Pinned card; an already-pinned issue
appears in the results marked and cannot be chosen; ↓ and Enter pin without the mouse; unpinning removes
the row without a reload; a pinned issue that is also assigned appears once. The e2e rig stubs Jira, so
none of this reaches a real site.

## Out of scope

- **Time logging against a pin** — #7 and #8. This ticket renders rows; it adds no timer and no
  duration field.
- **Reordering pins.** They render oldest first.
- **Pinning from an assigned row**, per decision 2.
- **Searching by description, comment or reporter.** `SearchText` matches the summary only. Jira's
  `text ~` would widen it to description and comments, which for a pin-by-title box returns matches the
  user cannot see the reason for.
- **A count of what an instance's removal destroys.** #29 left its warning static and noted counts as a
  later intake; pins make those counts non-zero for the first time, which makes the intake worth
  raising — but raising it is not doing it.
- **`jira.ErrRateLimited`.** A 429 still falls to the mapping's `default` and becomes a 500. That is
  #19's territory, unchanged here.

## Acceptance criteria, mapped

| Criterion | Where it is met |
|---|---|
| `GET/POST/DELETE /api/pins` served and covered by handler tests | *The API*, *Testing* |
| Pinning stores `summary_cache` so pins render without a Jira round trip | Decision 5; `GET` asserted to make no Jira call |
| Pinning the same issue twice on one instance is rejected | `ErrPinExists` → 409 `pin_exists` |
| Pinning a key that does not exist on that instance is rejected | `jira.ErrNotFound` → 404 `issue_not_found`, and see the note below |
| Pins render in Today alongside assigned issues, visually distinguishable | The Pinned card, above and separate |
| An issue both assigned and pinned appears once | Decision 6, client-side dedupe |
| Unpinning removes it from the view without a reload | The list region, decision 6 |
| A Playwright spec covers pinning, rendering and unpinning | *Testing* |

**Two criteria changed meaning when the form became a search**, and both are met differently from how
#6's issue body describes them:

- **"Pinning an issue key that does not exist on that instance is rejected."** The UI no longer offers a
  way to type a key that does not exist — you choose from results Jira returned. The rejection stays and
  stays tested, because `POST /api/pins` is reachable without the UI and the issue may vanish between
  the search and the pin. It is a server guard now, not a user-facing outcome.
- **"Pinning the same issue twice on one instance is rejected."** Same: already-pinned issues are
  visible but unselectable, so 409 `pin_exists` guards a race rather than a routine mistake.

Neither is weakened — both are enforced and both carry a handler test. What changed is that a user has
to work to reach them, which is the point.
