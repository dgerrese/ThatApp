# Week view milestone: refinement drafts

Both tickets were asked for by the owner on 2026-10-26. Neither has comments beyond what is quoted below (#326 has none; #327 has none; #325 has one comment saying the rollup should carry the summary).

Fact that shapes #326: `time_entries` has no summary column (`internal/store/migrations/2026-08-07_120000_initial.sql:19-31`). The only stored summary is `pinned_issues.summary_cache` (`internal/store/pins.go:41`). `rollUp` (`internal/server/week.go:178`) builds rows from entries and pins only and never calls Jira. So "the rollup carries the summary" is not free: it needs either a live Jira lookup on each week read, or a new summary cache. That is #325's decision to make, and #326 inherits it.

## #326 Week's rows show the ticket summary

**Still valid?** Yes. `WeekRow` has no summary (`web/src/types.ts`, `weekRowDTO` at `internal/server/week.go:69-80`), `AddedRow` carries none (`web/src/views/week.ts:41-47`), and the spec still says "Week rows stay keys only" (`docs/superpowers/specs/2026-09-03-today-and-week-design.md:105`). The owner has reversed it.

**Problem.** Week shows only the instance dot and key per row, so the owner has to remember what each ticket is. Week rows have no summary because the rollup is built from entries and pins and never touches Jira, and a search-added row is built from a result that knew its summary but `AddedRow` drops it. The design doc must be updated to record the reversal.

**Approach.** Build on #325's source decision. Recommended: the rollup carries `summary` per row, from one source for every row kind.
- Worked rows (entries only): need a summary from somewhere. Recommended is a small server-side summary cache keyed by (instance_id, issue_key), filled whenever the app already sees an issue (issue list, search, pin, fetch) and read by `rollUp`. A cache means the week read stays offline-safe and fast, and a ticket no longer assigned still shows its last known summary. Pins already have `summary_cache`; this generalises it.
- Pinned rows: use the existing `summary_cache`, or the new cache if it supersedes it.
- Search-added rows: `AddedRow` gains `summary`; `syntheticRow` copies it. Once the row is logged against, the server cache supplies it on the next read, and the cache must already hold it from the search.
- The row renders it once the design session settles placement. `that-tooltip` / cut-text handling follows the Today precedent (#143, `that-ticket-row.ts` summary cell and tooltip).
- Alternative: live Jira fan-out inside `handleWeek`. No new table, but the week read then depends on every instance being reachable and gets slow; the current read cannot fail on Jira. Not recommended.

**Acceptance criteria**
- [ ] `/api/week` rows each carry `summary` (string; empty when none is known). Same value for the same ticket whether the row is worked, pinned or both.
- [ ] A worked ticket that is no longer assigned to the user still shows its last known summary.
- [ ] A week read with an unreachable Jira instance still succeeds and still shows cached summaries.
- [ ] A row added through search shows its summary immediately, and still shows it after the first entry is logged and the week is re-read.
- [ ] Go table-driven test on `rollUp` (rows from entries only, pins only, both, and no cache hit); a plausible refactor dropping the cache read must fail it. If a migration is added, a migrate test covers it.
- [ ] Frontend test: a row renders its summary; empty summary renders no stray text; long summary is cut and reachable by the cut-text tooltip rule; the summary is keyboard-reachable the way Today's is if it carries a tooltip.
- [ ] Up/Down (#227) still moves between rows (`web/src/table-keys.ts`) with the new focusable if any; a table-keys-level test covers the new slot layout.
- [ ] The Week grid's design drawing is verified against the build in both themes; screenshots on the PR.
- [ ] `docs/superpowers/specs/2026-09-03-today-and-week-design.md:105` is rewritten to the new rule, and `week.ts` comment (lines 39-40) and `week-grid.ts` comment (lines 281-284) are updated.
- [ ] #325's dialog reads the same field (no `summary: ""` at `week-grid.ts:343`). If #325 ships first this is already done.
- [ ] MCP `get_week` output (`internal/server/mcp_tools.go:69`) either carries the field or the ticket says why not.

**Out of scope.** Issue status in Week; a summary in the weekly Jira push; editing summaries; the phone layout (#13).

**Questions for the owner**
1. Where does a worked ticket's summary come from: a server summary cache (recommended), or a live Jira lookup on every week read? This is #325's call; if the owner has not made it, make it once for both. Recommended: cache.
2. Should a cached summary be refreshed when it changes in Jira? Recommended: yes, refreshed whenever the issue list, search or fetch sees it; no separate background job.

**Design session needed?** Yes. Neither the visual language, the Week design nor the prototype (`docs/superpowers/prototypes/2026-09-03-app-prototype.html`) draws a summary in Week. The session must answer:
- Its own column, or beneath the key as Today draws it (the prototype's `.c-sum`/key-above-summary rule from #143)?
- Truncation: how many characters or what max width, one line or two, and what the tooltip does.
- How the key column's width and the seven day columns and total hold up at the desktop width, and what happens to the grid at the narrow end (the phone is #13).
- Does the row height change, and does the footer's "Total" label still align?
- Does the summary link, focus or open the entry dialog, or is it inert text?
- How a row with no known summary looks (blank, or key only).
- #327 interaction: with weekend columns hidden the summary may get room back. Settle both together if the owner wants.

**Type label.** enhancement is right (new capability, reverses a design call). Not a bug.

**Size.** M if the cache is built here, S if #325 already delivered the field. Frontend change is small; the data path is the bulk.

**Dependencies.** Depends on #325 for the data source (and ideally for the field itself). Both touch `week-grid.ts` and the rollup DTO, so land #325 first. Relates to #327 (grid space).

## #327 Week's weekend columns can be hidden

**Still valid?** Yes. The grid still draws Monday to Sunday then the row total (`docs/superpowers/specs/2026-09-02-week-view-design.md:112`), `daysInWeek` is 7 and the rollup always carries exactly seven days (`internal/server/week.go:101-120`). No hide control exists.

**Problem.** Most weeks the Saturday and Sunday columns are empty, and they take width from the grid. The owner wants to hide and show them. Hiding must never make logged weekend time vanish unnoticed.

**Approach.** Recommended: a purely client-side display preference. The server rollup is unchanged (always seven days, cells and totals unchanged), so totals stay correct by construction.
- Storage: browser `localStorage`, same pattern as the theme (`web/src/theme.ts:7-40`, key `"theme"`, with try/catch so storage failures only lose persistence) and the table sort state (`that-table.ts:336-351`, prefix plus id). New key, e.g. `week.weekend`. It is a per-device display choice, not data, so the server and `THAT_*` config stay untouched. It persists across week navigation because it is read at paint time, not stored per week.
- Hiding: the Sat and Sun `th`/`td` cells are not rendered (or hidden with CSS). Row total and the footer week total still sum all seven days, since they come from the server. Hidden weekend time must stay visible: a hidden column that holds time shows its time somewhere. Recommended: when hidden and the displayed week has weekend time, the control itself carries the figure and push marker (for example "Weekend 1h 30m" with the worst push state), and a failed or unpushed weekend entry still shows its marker. Otherwise the footer would not add up to the visible days with no explanation.
- Alternative: auto-show the weekend columns whenever that week has weekend time, ignoring the preference. Simpler and no trace-problem, but the layout then jumps between weeks; rejected unless the owner prefers it.
- Keyboard (#227): `enableRowArrowKeys` works by cell index in `slotsOf` (`web/src/table-keys.ts:59-75`, `rowStepTarget`). If the weekend cells are not rendered, the columns that remain keep their indices, so Up/Down still land on the same column. If they are hidden with `display:none` the `isVisible` filter (`table-keys.ts:57`) already drops them. Either works; not rendering them is cleaner for tab order and screen readers.

**Acceptance criteria**
- [ ] A control hides and shows Saturday and Sunday; hidden removes both header cells, every row's two cells and the footer's two day totals, and the grid reflows.
- [ ] The choice survives reload and moving between weeks, in the same browser; with storage unavailable the grid shows all seven days and nothing throws (theme.ts precedent).
- [ ] Row totals and the week total are unchanged by hiding (they equal the seven-day sums) in a test with weekend time present.
- [ ] When columns are hidden and the week holds weekend time, that time and its push state are visible somewhere on screen (per design session); when it holds none, nothing extra appears.
- [ ] Failed or unpushed weekend entries stay reportable while hidden (derived push state is never lost to the display; Where correctness lives).
- [ ] Up/Down moves between rows with weekend hidden and shown, and lands on the nearest column when starting from the last visible cell; Tab order skips hidden cells. Tests at the `table-keys`/`week-grid` level.
- [ ] The control is a 36px-high control matching the others (`weekButton`, `h-9`, `web/src/views/week.ts:525-547`), keyboard operable, has an accessible name and a pressed/expanded state, and a that-tooltip like its neighbours.
- [ ] The entry dialog opened from a visible cell is unaffected by the preference.
- [ ] Verified against the design drawing in both themes; screenshots on the PR.
- [ ] Week design doc and the prototype are updated with the control.

**Out of scope.** Hiding other days; a server-side or per-user setting; changing what the week rollup or the push covers; the phone layout (#13).

**Questions for the owner**
1. When weekend columns are hidden and the week holds weekend time, how should it show? Recommended: the control carries the weekend sum and push marker, so nothing disappears without a trace and the footer adds up. Alternative: auto-reveal the columns for that week.
2. Default on first visit: weekend shown (recommended; today's behaviour, nothing changes until the owner chooses) or hidden?

**Design session needed?** Yes. No drawing exists for the control. The session must answer: where the control sits among the 36px controls (`wctl` row in the prototype, lines 463-465), its shape (icon, label, toggle), its labelled and pressed states, how it shows hidden weekend time (question 1), the total label's wording if a total no longer equals the visible days, and how the grid's column widths take the freed room.

**Type label.** enhancement is right.

**Size.** S to M. Pure frontend: one preference helper, a grid change and the control. M if the hidden-time indicator needs its own mark. No server change.

**Dependencies.** None hard. Ideally decided with #326, since both change the grid's widths and the footer.
