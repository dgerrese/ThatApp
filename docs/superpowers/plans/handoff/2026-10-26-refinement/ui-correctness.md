# Refinement drafts: UI correctness (2026-10-26)

All five read from the tickets' bodies and every comment, against the tree as of branch handoff-2026-10-26.

## #325 Week's entry dialog shows no ticket summary

**Still valid?** Yes. `web/src/week-grid.ts:343` still passes `summary: ""` (and `status: ""` at :344); the dialog drops the summary line when empty (`web/src/components/that-entry-dialog.ts:251`). The comment at `week-grid.ts:281-284` still gives the old reason.

**Problem.** Opening the entry dialog from a Week cell shows no ticket summary, while Today shows one. `WeekRow` (`web/src/types.ts:202`, Go `weekRowDTO` at `internal/server/week.go:69`) has no summary field. Rows added through search (`AddedRow`, `web/src/views/week.ts:41`) drop the summary the search hit already carried (`IssueHit.summary`, `types.ts:71`). #326 needs the same data.

**Key fact the ticket does not state.** The server has no summary to put in the rollup today. `time_entries` has no summary column (`internal/store/migrations/2026-08-07_120000_initial.sql`). The only stored summary is `pinned_issues.summary_cache`, written only for pins (`internal/server/pins.go:117`). `rollUp` (`week.go:~205`) only sees entries, instances and pins. Option 1 ("the rollup carries it") therefore needs a place to read it from. Today's own off-list rows solve the same gap client-side with one `searchIssues(key)` per row (`web/src/views/today.ts:~790`, `fetchOffListInfo`).

**Approach (recommended).** Add a small server-side cache table `issue_cache(instance_id, issue_key, summary, status, updated_at)`, primary key (instance_id, issue_key), `ON DELETE CASCADE` on the instance like pins. Upsert it wherever the server already learns an issue's summary: the assigned-issues fan-out (`handleListIssues`, `issues.go:47`), issue search (`issue_search.go`) and the pin refresh (`pins.go:117`; pins can then read it too, but leave `summary_cache` alone). `rollUp` joins it per (instance_id, issue_key) and sets `WeekRow.summary`. Precedent: the pins list already writes a cache on a read. Frontend: `WeekRow.summary: string`; `ticketCell` passes `row.summary`; `AddedRow` gains `summary` copied from the hit and `syntheticRow` sets it; delete the stale comments (`week-grid.ts:281-284`, `week.ts:39-40`). Because search upserts at search time, a row added through search and then logged comes back from the rollup with its summary. The SW already caches `/api/week`, so offline keeps the last summary. A ticket never seen by the app (for example an entry created over MCP `create_entry` for an arbitrary key) has a blank summary, which is today's behaviour.
Alternative: Week resolves summaries client-side like Today's off-list rows (no Go change, but N lookups per render and nothing for #326 to build on cheaply). A live Jira call inside `/api/week` is rejected: it makes the rollup depend on Jira being up and breaks the "aggregated here, no browser opinion" shape.

**Acceptance criteria**
- [ ] `GET /api/week` rows carry `summary`; a Go table test covers: cached summary present, absent (empty string), the same issue key in two instances with different summaries (join must use instance id too), and an empty pinned row in the current week.
- [ ] A mutation that joins on issue_key only, or skips the join, fails a test.
- [ ] The summary cache is filled by the assigned-issues read, by issue search and by the pin refresh; each has a test that a later `/api/week` shows the summary.
- [ ] Opening the entry dialog from a Week cell shows the summary beneath the day line, same as Today (e2e in `week.spec.ts`, Firefox and Chromium).
- [ ] A row added through search shows the hit's summary in the dialog before anything is logged, and still shows it after the first entry is logged and the rollup replaces the synthetic row.
- [ ] `WeekRow.summary` is typed `string` (no `any`, no optional chaining around it); `week-grid.test.ts` asserts it reaches the dialog's ticket.
- [ ] The stale "Week rows stay keys only"/"carries neither" comments are removed; the grid itself still draws keys only (that is #326).
- [ ] Design of record API section and `docs/superpowers/specs/2026-09-03-today-and-week-design.md` mention the new field and table.

**Out of scope.** Showing the summary in the grid (#326). Backfilling summaries for old entries (they fill on the next issues read). Status in the Week dialog unless the owner says yes below.

**Questions for the owner**
1. The cache table also holds `status`, and Week's dialog passes `status: ""` too (`week-grid.ts:344`). Fill status in the same change? Recommend yes: same source, one more column, dialog parity with Today; it is the same bug class.
2. Entries for a ticket the app has never read (MCP `create_entry`, a deleted-then-gone issue) get a blank summary. Accept that, or fall back to a client lookup? Recommend accept; it is an edge case and the dialog already copes with blank.

**Design session needed?** No. The dialog already draws the summary line (Today, prototype); this only supplies the data.

**Type label.** `bug` is fine (the shared dialog is missing something it shows on the other view).

**Size.** M: a migration, three upserts, a join, DTO, frontend wiring, Go and e2e tests. #326 depends on it.

**Dependencies.** None. Blocks #326 (it builds on this data).

---

## #176 A plain Error's message is discarded, so every non-API failure reads 'Something went wrong.'

**Still valid?** Yes. `web/src/alert.ts:12-18` and the inline copy `web/src/components/that-issue-search.ts:440` still fall back to "Something went wrong."; `alert.test.ts:12-18` locks it in. The owner's 2026-10-26 rule (no generic fallback) decides the first and third questions.

**Facts that shape the wording**
- A failed `fetch` never reaches `messageOf` as a TypeError today. `request()` (`web/src/api.ts:50-60`) already turns it into `ApiError(0, "network_error", "Could not reach the dashboard server.")`, so offline writes already have words (PWA design doc line 184). The ticket's "TypeError from a failed fetch" case is already covered, except a caller-initiated abort, which is rethrown raw on purpose.
- What does arrive as a non-ApiError: `response.json()` throwing a `SyntaxError` on a 2xx with a non-JSON body (a proxy page, a service-worker fallback), a `DOMException`, and any `Error` thrown by view code. Today's catch sites do not say what was being attempted.
- Fourteen `messageOf` call sites: settings-dialog.ts:181, 535, 577, 701(705); that-timer.ts:123; week.ts:192, 222, 351, 382; today.ts:579, 969, 1003 (plus the inline one in that-issue-search.ts:440). Two dialogs already do it the right way with a per-action fallback and still discard `error.message`: `that-stop-dialog.ts:140` ("Could not stop the timer — try again.") and `that-entry-dialog.ts:791` (`showFailure(error, fallback)`).

**Problem.** The app's main path from failure to words on screen discards the detail of every error that is not an `ApiError`, and replaces it with a sentence that names nothing. The owner wants every failure to say what failed.

**Approach (recommended).** Change `messageOf(error)` to `messageOf(error, action)`, where `action` is a short infinitive phrase each call site supplies ("load the pinned tickets", "save the instance", "fetch from Jira"). Rules:
- `ApiError`: its own message, unchanged (it already names what the server or network refused).
- Any other `Error` with a message: `Could not <action>: <error.message>.` The raw message is kept because the owner wants the cause; the action keeps it in the app's voice and names what was attempted. A `SyntaxError` from a bad body reads for example "Could not load the pinned tickets: the server's reply could not be read (Unexpected token '<')." (special-case `SyntaxError` only if wanted; see question 1).
- `Error` with an empty message: `Could not <action> (<error.name>).`
- Non-Error thrown value (string or other): `Could not <action>: <String(value)>.` for a string; `Could not <action>.` for anything else, so the action is still named.
- Offline: `ApiError` status 0 stays "Could not reach the dashboard server." (it already says what failed). Optionally, when `navigator.onLine === false`, prefix: "You are offline. Could not <action>." This only matters where the failure is not already an ApiError.
Move the inline copy in `that-issue-search.ts:440` to call the shared helper (it cannot import `alert.ts` without checking chunking; `messageOf` only needs `ApiError`, so import is fine), and let `that-stop-dialog` and `that-entry-dialog` use the same helper with their existing action phrases so the rule has one home. Add the rule ("every failure names what failed; no generic fallback") to the design of record, as the owner asked.
Alternative: keep `messageOf(error)` and prefix at call sites. Rejected: 14 sites would each repeat the format.

**Acceptance criteria**
- [ ] `alert.test.ts` replaces the three fallback tests with a table: ApiError unchanged; plain `Error("boom")` gives "Could not save the instance: boom."; `Error("")` names the error `name`; string value; `undefined` still names the action; `TypeError`; `SyntaxError`.
- [ ] `git grep "Something went wrong"` over `web/src` returns nothing.
- [ ] Every one of the call sites listed above passes an action phrase; a mutation that drops the action (returns only `error.message`) fails a test.
- [ ] `that-issue-search.ts` uses the shared helper; a unit or e2e test shows a non-ApiError search failure says "Could not search ..." with the cause.
- [ ] `that-stop-dialog.ts:140` and `that-entry-dialog.ts:791` route through the same helper (or an explicit note says they were left), with their e2e behaviour unchanged for an ApiError.
- [ ] One e2e path (a mocked 200 with a non-JSON body on a Week or Today read) shows the action plus cause in the alert/toast.
- [ ] The rule is written into the design of record (error section near line 232) and the 2026-09-21 locked-in test comment/handoff note is superseded.

**Out of scope.** `ApiError`'s own handling; server-side failure classification (#19, #79); translating raw browser messages into friendlier prose beyond the format above; the stale-data banner.

**Questions for the owner**
1. Is the raw browser or internal message shown verbatim after the action ("Could not save the instance: Unexpected token '<' ...")? Recommend yes, exactly as you said ("what went wrong"), with only `SyntaxError` special-cased to "the server's reply could not be read" because its raw text is unreadable. Alternative: always verbatim.
2. Do you want the separate offline wording ("You are offline. ...")? Recommend no: `ApiError` status 0 already says "Could not reach the dashboard server.", and the stale-data banner covers reads. Add it only if you see non-ApiError failures while offline.

**Design session needed?** No new mark or control; this is copy only. The visual language leaves copy and voice to the owner (line 620), so wording is settled here in the ticket.

**Type label.** None today. `bug` would also be defensible (information is discarded); I would leave it unlabelled since it was an intentional behaviour locked by a test, and the owner's rule changes the decision rather than correcting a slip. Say if you prefer `bug`.

**Size.** M: small per site but fourteen-plus call sites, two dialogs, tests, a doc rule.

**Dependencies.** None.

---

## #313 A tooltip hovered before its chunk loads never opens, and Chromium drops :hover on the trigger at the upgrade

**Still valid?** Yes, as a known limitation; nothing in the tree fixes it. `web/src/main.ts:16` still registers `that-tooltip` through a dynamic `import()`, and `that-tooltip.ts:63-67` adds `pointerenter` only in `connectedCallback`. #309 only made the e2e helper wait (`tooltip.spec.ts:147-165`, `mountTrigger` etc.), it did not change the component.

**Problem.** A pointer already resting on a trigger when its tooltip upgrades never opens the tooltip; the user has to move off and back (Chromium sends no second `pointerenter`). A probe showed Chromium reports `trigger.matches(":hover")` true before the upgrade and false after it with the pointer unmoved, cause unknown, so an `:hover` check at upgrade time is not a safe fix. Real exposure is narrow: the chunk loads on every page start and is precached by the service worker, so it only bites on a cold, slow first load.

**Approach (recommended).** Spike first, bounded to one session, to find a hit test that works in both browsers: record the last pointer position in the shell (a tiny `pointermove` listener in `main.ts`, in the eager bundle, before the import), and in `ThatTooltip.connectedCallback` after listeners are attached, if a position is recorded, check `document.elementsFromPoint(x, y)` includes the trigger and `reveal()`. This avoids `:hover` entirely. If the spike shows it needs more than about 15 lines, or Firefox disagrees, close as wontfix with the finding recorded.
Alternative: close as wontfix now. Cost: one rare cold-load hover needs a re-hover; the only test cost already absorbed in #309's helper.

**Acceptance criteria** (if built)
- [ ] An e2e in `tooltip.spec.ts`: delay the chunk 1.5s (`routeTooltipChunk`), hover the trigger before the upgrade, do not move; the tooltip opens after the upgrade, in Firefox and Chromium.
- [ ] A pointer that has never moved (no recorded position) opens nothing and does not throw.
- [ ] A pointer that moved off the trigger before the upgrade does not open the tooltip (mutation: always reveal at upgrade fails it).
- [ ] `mountTrigger`'s workaround (wait for upgrade before hovering) is removed or left with a comment saying it is no longer needed; the e2e specs still pass.
- [ ] No `:hover` dependency in the fix.

**Out of scope.** Eager (non-split) loading of the tooltip; changing the 14 kB shell budget; the Escape/focus behaviours (#107, #267).

**Questions for the owner**
1. Build the fix, or close as wontfix? It is priority/low and the real-world hit is a slow cold load. Recommend a bounded spike; if it is not small, wontfix. This changes whether anything is built.

**Design session needed?** No. Behaviour of an existing component, nothing drawn.

**Type label.** Currently `priority/low` only. It is a defect against the component's own intent, so `bug` fits (the component should open when the pointer is on it).

**Size.** S for the code; M if the spike turns up a browser difference.

**Dependencies.** None.

---

## #110 "A tooltip is never the accessible name" is a rule nothing checks

**Still valid?** Yes. `web/src/vocabulary.test.ts` has radius, text-md, hover-wash, typed-glyph and `iconMarkup` aria-label checks (lines 27-155) and nothing on tooltips or ARIA. The rule is still stated at `docs/superpowers/specs/2026-09-03-visual-language-design.md:448, 484, 573` (line 573 even says "#110 exists because nothing checks that"), and `that-tooltip.ts:9-12` repeats it. A grep of `web/src` shows no `aria-labelledby` or `aria-describedby` that targets a tooltip today (the `aria-labelledby` uses are dialogs and sections pointing at headings; `aria-describedby` is on form help and `that-confirm`); `tooltip.spec.ts:717-719` only asserts the fixture trigger.

**Problem.** The rule that a tooltip never names its trigger is believed to be machine-enforced and is not, so the first component that breaks it does so silently.

**Approach (recommended).** Enforce it on the rendered DOM, not by grepping source. Tooltip ids are generated at runtime (`for=<trigger id>`), so a source regex cannot tell a tooltip id from a heading id and would flag the legitimate `aria-labelledby` in files that also build tooltips (`settings-dialog.ts`, `that-entry-dialog.ts`). Add an e2e sweep (a new case in `tooltip.spec.ts`, or in `keyboard-audit.spec.ts`'s sweep style) that, on Today, Week and the open Settings and entry dialogs, evaluates for every `that-tooltip[for]`: (a) no element's `aria-labelledby` id list contains that tooltip's id; (b) its trigger has an `aria-label` or, for text triggers, non-empty own text content. `aria-describedby` naming a tooltip is allowed (owner, 2026-10-26).
Alternative: a `happy-dom` unit test in `vocabulary.test.ts` style, if the views can be rendered without a server (`happy-dom` is installed); it is closer to the ticket's wording but needs each view mounted with stubbed data.

**Acceptance criteria**
- [ ] The check fails when a fixture trigger gets `aria-labelledby` pointing at its tooltip's id (negative test).
- [ ] The check fails when an icon-only trigger of a tooltip has no `aria-label` (negative test).
- [ ] The check passes with `aria-describedby` pointing at a tooltip.
- [ ] The check runs across Today, Week, Settings and the entry dialog and is green on the current app.
- [ ] The visual language lines 448/484/573 and any plan text claiming `vocabulary.test.ts` enforces the rule are corrected to name where it actually lives.

**Out of scope.** Auditing other ARIA relationships; tooltip behaviour; a static source lint.

**Questions for the owner**
1. Triggers whose accessible name is their own visible text (cut-text tooltips, `cut-text-tooltip.ts`; the "open in Jira" key links) have no `aria-label` and should not. Exempt triggers with non-empty text content? Recommend yes: the rule is "the tooltip is not the name", and visible text is a name of its own. The ticket's literal wording ("no `aria-label` of its own") would flag them.

**Design session needed?** No.

**Type label.** None (a missing guard, not a product misbehaviour). `priority/low` is correct.

**Size.** S: one e2e case and a docs correction.

**Dependencies.** None.

---

## #126 Two design tokens are declared and nothing consumes them

**Still valid?** Partly. The owner has answered both halves. `--color-ink-faint` is consumed now (`decoration-ink-faint`, `web/src/components/that-entry-dialog.ts:74`; the allowlist's `isConsumed` recognises the `decoration-` prefix, `web/tools/unused-tokens.mjs:~45`), so its allowlist entry (`web/tools/token-allowlist.json:6`) is stale. `--breakpoint-3xl` is still declared (`web/src/styles.css:149`) and still unconsumed (allowlist entry line 7). Note the lint only reports orphans, it does not fail on a stale allowlist entry, which is how this one survived.

**Problem.** One allowlist entry is stale, and one token is dead weight that the owner has decided to delete. The deleted breakpoint is named in the visual language and a comment.

**Approach (recommended).** Remove the `--color-ink-faint` entry from `token-allowlist.json`. Delete `--breakpoint-3xl` and its comment from `styles.css:146-149` and remove its allowlist entry. Keep `max-w-[120rem]` (`web/index.html:211`). Update the docs that name it: `docs/superpowers/specs/2026-09-03-visual-language-design.md` decision 8 (lines ~488-505: the `@theme { --breakpoint-3xl }` block and "one addition") to say there is no 3xl breakpoint and the cap is the explicit `max-w-[120rem]`; keep the `max-w-3xl` collision warning, which still applies to the container scale (also `web/index.html:203`, `today-and-week-design.md:26-27`, which reference it and stay true). The e2e `today.spec.ts:516-524` names `120rem` and `max-w-3xl` only in comments, so no spec change is needed; confirm no test requires the token itself.
Alternative: add a stale-entry check to `unused-tokens.mjs` (fail when an allowlisted token is consumed or no longer declared). Small, and would have caught this; offered, not required.

**Acceptance criteria**
- [ ] `--breakpoint-3xl` is gone from `styles.css`; the built CSS still produces `max-w-[120rem]` and the content column still caps at 120rem and centres (existing `today.spec.ts:524` stays green).
- [ ] Both allowlist entries are gone and `make verify` (unused-token lint) is green.
- [ ] Visual language decision 8 no longer says a 3xl breakpoint exists; it keeps the collision note.
- [ ] No source or spec references `--breakpoint-3xl` (`git grep` clean outside history/plans).
- [ ] If the optional stale-entry check is built: a unit test in `unused-tokens.test.ts` fails on an allowlist entry for a consumed token (mutation: skip the check, test fails).

**Out of scope.** The other seven tokens; changing the content-column cap; `--radius-lg`/`xl`, `--text-2xl`, `--color-running-rail` entries.

**Questions for the owner**
1. Add the stale-entry check to the lint? Recommend yes, but only if you want it in this ticket; otherwise skip (it is optional and this ticket is S either way).

**Design session needed?** No. Deleting a declared-but-unused token changes no rendering; the owner has decided it.

**Type label.** None (cleanup). `priority/low` is correct.

**Size.** S.

**Dependencies.** None.
