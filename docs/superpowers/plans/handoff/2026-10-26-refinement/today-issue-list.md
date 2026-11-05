# Today: issue list — refinement drafts (2026-10-26)

## #300 The owner sets the order of the instances by hand

**Still valid?** Yes. Order is `ORDER BY created_at, id` (internal/store/instances.go:136) and the browser keys hue off the array index (web/src/views/today.ts:1089-1096; `instancePositions` at internal/server/instances.go:49). #144 (the dependency) is merged (PR #306), so the stacks exist and `placeInStacks` places cards "in instance position order" (web/src/card-stacks.ts:11).

**Problem.** Today draws instance cards in creation order and the owner cannot choose which reads first. "Position" is derived, not stored, and it does three jobs at once: card order, the hue (`instanceHue(position)`, web/src/instance-hue.ts:18) and the order of every DTO that carries `instancePosition` (entries, pins, week, timer, search: entries.go:32, pins.go:25, week.go:72, timer.go:27, issue_search.go:33). Settings lists instances in the same order (settings-dialog.ts:221).

**Approach (recommended).** Add `instances.sort_order INTEGER NOT NULL` (migration backfills from the current `created_at, id` order; new instances get max+1). `store.Instances` orders by `sort_order, id`. Keep the hue stable by adding a separate server-supplied `hueIndex` (= creation-order index) so reordering never recolours; `instancePosition` stays what it is named for (display order). Order is set by `PUT /api/instances/order` taking the full id list (rejects a list that is not exactly the stored ids). Today's `placeInStacks` already takes cards in the order given, so it needs no change.
Alternative: reuse `position` for hue too (follows the new order). Smaller, but reordering recolours every dot, every dot on every screen.

**Acceptance criteria**
- [ ] Migration adds `sort_order`, backfills existing rows in current creation order; a table-driven migration test proves an existing DB keeps its order.
- [ ] A new instance is placed last, including after a delete (no reused slot sorts it in the middle).
- [ ] `PUT /api/instances/order` rejects a list with a missing, duplicate or unknown id (400) and changes nothing on rejection; accepts a full permutation.
- [ ] `GET /api/instances` and `GET /api/issues` return instances in the manual order.
- [ ] Today places cards into the stacks in the manual order (unit test on the order passed to `placeInStacks`; e2e: reorder, reload, assert card order).
- [ ] Hue behaviour matches the owner's answer to Q1 (test: reorder leaves, or changes, each instance's dot hue accordingly).
- [ ] Week, search results and the entry dialog follow the order per Q2.
- [ ] The control is operable by keyboard and announces its result (accessibility).
- [ ] Reordering survives a reload and is not tied to the browser (server-stored).

**Out of scope.** Ordering issues within a card (table sort #83), choosing a column (#144 forbids it), per-view orders.

**Questions for the owner**
1. Hue: stay on creation order, or follow the new order? Recommend stay (`hueIndex`), the ticket's own first reading, so reordering never recolours.
2. Which places follow the order: Today only, or Today + Week + search + pins + entry dialog dot? Recommend all places that group or list by instance follow it, since `instancePosition` is one shared notion; only the hue is decoupled.

**Design session needed?** Yes. No reorder control is drawn in the visual language, the settings design (2026-08-12) or the prototype. Session must answer: where it lives (Settings list rows vs. drag on Today cards), the gesture (drag handle vs. up/down buttons; keyboard equivalent), save model (instant vs. explicit), what the instance row shows while moving, and empty/one-instance state.

**Type label.** `enhancement` (clear addition, not in the initial design). Currently only `status/needs-refinement`; add it.

**Size.** M: migration + API + DTO field + one new control; the control is the risky part.

**Dependencies.** #144 (merged). Soft: none open.

---

## #290 Issues show their remaining estimate from Jira

**Still valid?** Yes, nothing built. Evidence: the Jira client requests only `summary,status` everywhere (internal/jira/search.go:60 `SearchAssigned`, :127 `SearchText`; internal/jira/issue.go:21 `Issue`). The `Issue` struct has Key/Summary/Status only (search.go:21-25). No `timetracking` anywhere.

**Facts that settle some of the ticket's questions**
- Push already touches the estimate: `worklogQuery()` sends `adjustEstimate=auto` on every worklog create/update/delete (internal/jira/worklog.go:79-88), so Jira itself lowers the remaining estimate on push (and raises it on delete). The ticket's question "does a push leave it alone" is answered: no, it does not, and that is deliberate (matches the Jira UI).
- The estimate is only fresh after a refresh. Today's list is a live fan-out on every load (`handleListIssues`, internal/server/issues.go:52-59) - there is no stored issue cache; only pins cache summary+status (`status_cache`, migration 2026-08-20; pins.go:115-117). So the assigned list gets the field for free; pins and search hits need it added too.
- `timetracking` can be requested in the same `fields` list (`"fields": ["summary","status","timetracking"]`); no extra request. `remainingEstimate` is a Jira duration string ("2h 30m") and `remainingEstimateSeconds` is also returned; prefer seconds (the app already has duration code, web/src/duration.ts). When time tracking is off on an instance, or the issue has no estimate, the field is absent/empty: model as nullable.
- Testing: all Jira tests use `httptest.Server` (CLAUDE.md); a fake serving a JSON `timetracking` object covers present, absent, `{}` and zero cases. Nothing needs a real instance.

**Problem.** The app shows key, summary and status but not how much time Jira thinks is left, so the owner cannot see budget while logging. The data is one extra field on requests the app already makes.

**Approach (recommended).** Read-only. Add `timetracking` to the three field lists; `jira.Issue` gets `RemainingSeconds *int64`; DTOs for issues, pins and search results carry `remainingSeconds` (nullable). Pins persist it in the cache like status (new nullable column, migration) so a pin looks the same after reload. Display the Jira value as-is; do not subtract unpushed local time (Q1).
Alternative: also show "remaining after local unpushed time". More useful at end of day, but a computed number that matches neither Jira nor the entries, and it must agree with push semantics (derived state; the day boundary); defer.

**Acceptance criteria**
- [ ] `SearchAssigned`, `SearchText`, `Issue` request `timetracking` and parse `remainingEstimateSeconds` (httptest fake; cases: present, absent, empty `timetracking: {}`, zero).
- [ ] Missing/empty/disabled time tracking yields null, never 0 (a 0 means "nothing remaining", not "no estimate"); test that the two stay distinct end to end.
- [ ] `/api/issues`, `/api/pins` and `/api/issues/search` include `remainingSeconds`; pin cache stores and returns it; a failed pin refresh keeps the cached value (as status does).
- [ ] The UI shows the value in the places the design session chose, formatted by the existing duration formatter, with an accessible label (not colour alone).
- [ ] The "no estimate" and "none remaining" states are drawn per the design session.
- [ ] Pushing does not need a code change; an e2e or doc note states the value refreshes on the next fetch, not instantly (see Q2).

**Out of scope.** Editing the estimate; changing `adjustEstimate` behaviour; original estimate and time spent; subtracting unpushed time; Week totals.

**Questions for the owner**
1. Show the Jira value as-is, or subtract unpushed local time? Recommend as-is: it is Jira's number, simple, and push already moves it.
2. After a push, should the shown estimate update at once (re-fetch the pushed issues) or wait for the next refresh? Recommend wait for next refresh (Today reloads from Jira already); revisit if it confuses.
3. Over the estimate (remaining 0 or negative-by-logging): own mark or plain "0m"? Recommend a plain value in v1 of the feature and a mark only if the design session draws one. Note Jira never reports negative remaining.

**Design session needed?** Yes. No estimate column or marker is drawn. Session must answer: which surfaces (Today tables, Pinned, Week rows, issue picker, entry dialog), a new column vs. inline with status (row height is fixed; "a row gaining a fourth thing" rule), sortability of the column (table sort #83), the none/zero/over states, narrow-screen behaviour.

**Type label.** `enhancement`. Currently unlabelled; add it.

**Size.** M: small backend (three field lists, one DTO field, one pin migration), UI depends on the session.

**Dependencies.** None hard. Touches the same row/table as #268 and #131 only visually.

---

## #268 Today: filter the issue list

**Still valid?** Yes. Today has sort (`that-table`, table-sort.ts) and search (lookup only: today-and-week design line 83, #84) but no filter; no "filter" in web/src beyond CSS. Sort state persists in localStorage per table (that-table.ts:336-351), a precedent for persistence.

**Problem.** Today lists every assigned issue across all instances, with Pinned above, and nothing narrows it. The owner wants to cut the list down. What to filter on is unsettled, and so is how it relates to search, which must stay a lookup.

**Approach (recommended).** Client-side only; no API change, since the whole list is already in the browser (live fan-out, /api/issues). Start with the two fields every row already has: status (multi-select from the statuses present) and instance, plus "logged today" if the entries are already loaded on Today (check in the session). Filters AND together; an empty result says which filters are active and offers "clear". Applies to the assigned tables; Pinned is untouched (Q1). Not persisted across reloads by default.
Alternative: a free-text filter box. Overlaps with the search (which already finds by key/summary) and was named as the overlap risk, so skip it.

**Acceptance criteria**
- [ ] A pure filter function (statuses, instances, optional logged-today) with table-driven tests: each filter alone, combined (AND), nothing selected = all, a selected value no longer present after refresh.
- [ ] Today renders only matching issues in each card; a card whose issues all filter out says so (not a vanished card or the "no issues" state), and instance cards still stack per #144 without holes after filtering.
- [ ] An empty result names the active filters and has a clear action.
- [ ] Filters survive a Refresh and sorting; persistence across reload/visits follows Q2.
- [ ] The search is unchanged and the filter does not hide search results.
- [ ] Controls are keyboard operable and announce the result count change (accessibility).
- [ ] e2e: apply, reload, clear, in Firefox and Chromium.

**Out of scope.** Text filtering; filtering Week; saved filter sets; server-side filtering; changing the search.

**Questions for the owner**
1. Which filters, and do they apply to Pinned? Recommend status + instance (+ logged today if cheap), assigned tables only: Pinned is a curated shortlist.
2. Persist across reloads and Week visits, or reset? Recommend persist in localStorage like sort, with a visible "filtered" cue so a stale filter cannot hide work silently; this is the thing to decide, because it changes the empty-state design and the e2e.

**Design session needed?** Yes. The drawing has no filter control (ticket says so; visual language and prototype confirm no mention). Must answer: placement beside search and Refresh, control form (chips, menu, popover), the "filtered" indicator, empty-result and all-filtered-card states, narrow screens.

**Type label.** `enhancement`. Currently unlabelled; add it.

**Size.** M: logic is small and client-only; the control and its states are the work.

**Dependencies.** #144 merged (stacks must repack when cards shrink). Possible interplay with #290 (an estimate column could become filterable) but no blocker.

---

## #131 A ticket's details open in a modal

**Still valid?** Yes. The key is an anchor to Jira, `target=_blank` (web/src/components/that-ticket-row.ts:432-436, tooltip "open in Jira" at :449; same in web/src/week-grid.ts:98). No details view exists.

**What the app has today.** Per issue: key, summary, status, and a server-built Jira URL (issueDTO, internal/server/issues.go:23-28). Nothing else is requested: `fields` is `summary,status` everywhere (search.go:60,127; issue.go:21). No description, assignee, priority, comments or dates are fetched, and nothing is stored beyond a pin's summary/status cache. A modal that shows what a ticket "actually says" therefore needs a new fetch.
Jira v3 returns `description` and comments as ADF (rich-text node tree). The repo only has an ADF writer for one paragraph (internal/jira/adf.go), no reader. Rendering ADF in vanilla JS safely is the real cost.

**Problem.** Reading a ticket means leaving the app. The owner wants a modal on clicking the key. The data is not available yet and the key link is currently the way out.

**Approach (recommended).** New endpoint `GET /api/issues/{instanceId}/{key}` (instance-scoped, since keys alone are ambiguous across instances) that fetches live from Jira with `fields=summary,status,description,assignee,priority,issuetype,created,updated,duedate` (+ `renderedFields` via `expand=renderedFields` to get server-rendered HTML for the description, avoiding an ADF renderer; the HTML must still be sanitised before insertion, as it is untrusted content). The modal is a native `<dialog>` + `showModal()` like the existing dialogs, a `that-*` light-DOM component; the key click opens it, with a link "Open in Jira" inside. No storage: live read, per-modal loading and error state; the error says what failed (owner's rule on #176). Cache nothing.
Alternative: plain-text description by flattening ADF server-side (small adf reader, text only). Safer and smaller, but loses lists, code and links; the cost is lower and it can be upgraded.

**Acceptance criteria**
- [ ] `jira.Client` gets a method returning the chosen fields (httptest fake: full issue, empty description, unknown key = `ErrNotFound`, missing/permission error).
- [ ] `/api/issues/{instanceId}/{key}` returns 200 with the details, 404 for an unknown key/instance, and the per-instance error shape the app already uses for unreachable sites.
- [ ] Description content is sanitised/escaped: a test feeds markup and script in the description and asserts it is inert in the DOM (XSS is the risk of this ticket).
- [ ] Clicking a key in Today (assigned, Pinned), Week and search results opens the modal; modified clicks (ctrl/middle) still open Jira, and a key with no site URL behaves as today (not a link) or per Q3.
- [ ] Loading, failure (says what went wrong, with retry) and success states are shown; closing during a fetch aborts or ignores the response.
- [ ] Focus moves into the modal and returns to the key on close; Esc closes; no conflict with the entry dialog (opening from within a dialog, or from the timer/rail, is defined by the session).
- [ ] The modal has an "Open in Jira" link; the existing "open in Jira" tooltip text changes to match the new click meaning.
- [ ] e2e against the fake Jira in both browsers; light and dark screenshots on the PR.

**Out of scope.** Editing the ticket, commenting, transitions, attachments, caching/offline, showing the worklog history, the remaining estimate (#290 may later add one line).

**Questions for the owner**
1. Which fields: key, summary, status, description, assignee, priority, type, dates, comments? Recommend summary, status, assignee, priority, description; no comments in the first version (they are another ADF tree and paging).
2. Description rendering: rich (server-rendered HTML, sanitised) or flattened text? Recommend rich via `renderedFields` + a strict sanitiser, since a text-only description loses tables and lists and the owner wants to read the ticket; text-only is the cheaper fallback.
3. Does a plain key click open the modal everywhere (Today, Week, search, entry dialog, rail timer), with Jira reachable only via the modal's link? Recommend yes in Today/Week/search/pins, and leave the entry dialog and rail alone.

**Design session needed?** Yes. No modal for ticket details is drawn anywhere (visual language, today-and-week design, prototype). Must answer: layout and field order, sizing (narrow screens), the loading and error states, the Jira link, how it stacks with the entry dialog and the settings dialog, description styling.

**Type label.** `enhancement`. Currently unlabelled; add it.

**Size.** L: new Jira call, new endpoint, HTML sanitising, new dialog component with three states and focus handling, wiring into four views.

**Dependencies.** None hard. #290 would add one line to this modal later; #268 independent.
