# Search any issue, log against it, leave nothing behind — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-09-10
**Supersedes:** nothing
**Superseded by:** nothing

**Goal:** A search in each view's header finds any issue on any instance, logs time against it
without pinning it, and puts a ticket into a week without leaving a record that it was added.

**Architecture:** One `that-issue-search` component owns the field, the panel and the fan-out, and is
told by its host which controls a result row carries. Today's rows carry Log and pin; Week's carry
the new pull-into-week mark and pin. Nothing about a search result is stored: a Week row with no
entries lives in the view's own state and dies with it. The server's existing search endpoint widens
rather than gaining a sibling, because this ticket deletes its only other consumer.

**Tech Stack:** Go standard library with `modernc.org/sqlite`, vanilla TypeScript (`strict`,
`noUncheckedIndexedAccess`), Tailwind v4 with tokens in `@theme`, `node --test` for unit tests,
Playwright for end-to-end.

**Spec:** [`2026-09-10-week-rows-and-global-search-design.md`](../specs/2026-09-10-week-rows-and-global-search-design.md),
which holds the four decisions of the 2026-09-10 session. The ticket is
[#84](https://codeberg.org/DionGerrese/ThatApp/issues/84) and carries the acceptance criteria; its
own body holds the surface settled on 2026-09-03. Also binding:
[`2026-09-03-visual-language-design.md`](../specs/2026-09-03-visual-language-design.md) and the
prototype at `docs/superpowers/prototypes/2026-09-03-app-prototype.html`.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Local development runs in Docker.** No Go, Node or npm on the host. Everything through `make` or
  `docker compose run --rm --no-deps <service> <cmd>`.
- **The browser never derives a date.** Every date came from a server response.
- **`started_at` is stamped by the server, always.** The browser never sends one.
- **Go: standard library first.** Wrap errors with `%w` and context about what was attempted.
  Table-driven tests with `t.Run` subtests, `httptest` and `testing/fstest`. **No test ever contacts
  a real Jira instance** — the Jira client's tests run against an `httptest.Server`.
- **TypeScript is `strict` with `noUncheckedIndexedAccess`.** No `any`, no `as any`, no non-null
  assertion to get past a type error.
- **Tailwind v4, CSS-first.** Theme values live in `@theme` in `web/src/styles.css`;
  `web/src/vocabulary.test.ts` forbids arbitrary literals for some properties, and
  `web/src/unused-tokens.test.ts` fails when a declared token has no consumer.
- **Reusable UI is a `that-*` WebComponent in light DOM.** Never shadow DOM.
- **A tooltip is never the accessible name.** Every icon-only control carries an `aria-label`.
- **Comments are few** — a non-obvious why, an external workaround, a subtle invariant.
- **A function's name must let a reader predict what it returns.**
- Commit style: `feat(#84):` / `fix(#84):` / `docs(#84):`, a body explaining why, and the session's
  trailers.

## File structure

| File | What changes |
| --- | --- |
| `internal/jira/search.go` | `SearchText` matches key as well as summary, and stops excluding Done. |
| `internal/server/issue_search.go` | `searchLimit` rises from 10 to 25. |
| `web/src/icons.ts` | A new `add-to-week` mark. |
| `web/src/components/that-issue-search.ts` | **New.** The field, the panel, the fan-out, the grouping, the footer. |
| `web/src/views/today.ts` | The field in the Assigned issues header; the two-column Pinned row; the pin form deleted. |
| `web/src/views/week.ts` | The field in the header; transient rows from search results. |
| `.claude/e2e/tests/search.spec.ts` | **New.** The panel, both views' controls, and what the panel does when an instance fails. |
| `.claude/e2e/tests/today.spec.ts`, `pins.spec.ts` | The pin form's tests go; pinning-from-search replaces them. |
| `docs/superpowers/specs/2026-09-02-week-view-design.md` | Decision 1's row rule corrected. |
| `docs/superpowers/prototypes/2026-09-03-app-prototype.html` | Week's result row gains the new mark; its footer wording follows the design. |

**`web/src/views/today.ts` is already 844 lines and `week.ts` 911.** Neither grows by more than the
wiring: the panel itself lives in the new component, and its host passes a configuration object. Do
not restructure either file — Week's split is #91 and is not this ticket's to take.

## Task order, and what depends on what

Nine tasks. Task 1 is server-only and independent. Task 2 is one icon. Task 3 builds the component
against a stub host and is what Tasks 4 and 6 mount. Task 5 is Today's layout and touches no search
code. Task 7 can only run once Task 4 has made pinning reachable from the search. Task 8 is
documents. **Task 9 is unrelated to the search** — it was folded in on the owner's instruction
on 2026-09-10, and it is deliberately last so a reviewer can see it apart from the rest.

---

### Task 1: The search finds keys, and finds finished work

**Covers:** the criteria for searching by key and for including Done issues, and the result limit.

**Files:**
- Modify: `internal/jira/search.go` (`SearchText`), `internal/jira/search_test.go`
- Modify: `internal/server/issue_search.go` (`searchLimit`)

**Interfaces:**
- Produces: `SearchText(ctx, query, limit)` unchanged in signature; its JQL changes.

**The JQL, exactly.** Today it is:

```go
`summary ~ "%s*" AND statusCategory != Done ORDER BY updated DESC`
```

It becomes a disjunction, with the status filter gone:

```go
`(key = "%s" OR summary ~ "%s*") ORDER BY updated DESC`
```

**`key = ` is exact and rejects a malformed key**, so it is only added when the query looks like one.
A Jira key is `PROJECT-123`: letters, digits and underscores, a hyphen, then digits. When the query
does not match that shape, the clause is omitted entirely and the JQL is the summary term alone —
otherwise every ordinary word search sends Jira a key comparison it will reject.

```go
// A Jira issue key, which `key = ` demands exactly: a project code, a hyphen,
// and a number. Anything else in that clause is a 400 from Jira rather than an
// empty result, so a query that is not a key does not get the clause at all.
var issueKeyPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]*-[0-9]+$`)
```

- [ ] **Step 1: Write the failing tests, table-driven**

In `internal/jira/search_test.go`, beside the existing `SearchText` cases. Assert the JQL the client
sends, which is what the existing tests already do.

```go
{
    name:  "a key-shaped query searches the key and the summary",
    query: "RIDGE-4102",
    want:  `(key = "RIDGE-4102" OR summary ~ "RIDGE-4102*") ORDER BY updated DESC`,
},
{
    name:  "an ordinary word searches the summary alone",
    query: "capacity",
    want:  `summary ~ "capacity*" ORDER BY updated DESC`,
},
{
    name:  "a lowercase key still counts as a key",
    query: "ridge-4102",
    want:  `(key = "ridge-4102" OR summary ~ "ridge-4102*") ORDER BY updated DESC`,
},
{
    name:  "a hyphenated word is not a key",
    query: "capacity-review",
    want:  `summary ~ "capacity-review*" ORDER BY updated DESC`,
},
```

Every existing case in that table loses ` AND statusCategory != Done`; update them in the same edit
rather than leaving the table half true.

- [ ] **Step 2: Run them and watch them fail**

Run: `docker compose run --rm --no-deps app go test ./internal/jira/ -run TestSearchText -v`
Expected: FAIL — the sent JQL still carries the status filter and no key clause.

- [ ] **Step 3: Build the JQL**

Escape both interpolations with the existing `escapeJQL`, and keep `stripTrailingWildcard` on the
summary term only — the key term takes the query as given.

- [ ] **Step 4: Raise the limit**

`internal/server/issue_search.go`, `searchLimit` from 10 to 25, and rewrite its comment: it no longer
backs a type-ahead, it backs a lookup for one specific issue among many.

- [ ] **Step 5: Run the Go suite, then `make verify`**

- [ ] **Step 6: Commit**

```bash
git add internal/jira internal/server
git commit -m "feat(#84): the search finds keys, and stops hiding finished work"
```

---

### Task 2: A mark for pulling a ticket into the week

**Covers:** the icon the design settled.

**Files:**
- Modify: `web/src/icons.ts`, `web/src/icons.test.ts`

**Interfaces:**
- Produces: `"add-to-week"` in `ICON_NAMES`, usable as `iconMarkup("add-to-week")`.

The path, exactly as drawn and chosen:

```ts
"add-to-week": '<path d="M4 5h16"/><path d="M4 10h16"/>' +
  '<path d="M20 14v1a2 2 0 0 1-2 2H8"/><path d="M11 14l-3 3 3 3"/>',
```

Two full-width rules, then the return glyph turning its corner into the row beneath. The design
document records why return rather than an arrow: return is the one arrow that never reads as
transfer.

- [ ] **Step 1: Add the name and the path**

`ICON_NAMES` is a `const` tuple and `PATHS` is a `Record<IconName, string>`, so adding the name
without the path is a type error — which is the existing test's point.

- [ ] **Step 2: Run the icon tests**

Run: `docker compose run --rm --no-deps web node --test 'src/icons.test.ts'`
Expected: PASS. If the suite asserts a count of names, update it.

- [ ] **Step 3: Commit**

```bash
git add web/src/icons.ts web/src/icons.test.ts
git commit -m "feat(#84): a mark for pulling a ticket into the week"
```

---

### Task 3: `that-issue-search`

**Covers:** the panel itself — grouping, the footer, the empty state, per-instance failures, and the
abort behaviour.

**Files:**
- Create: `web/src/components/that-issue-search.ts`
- Test: `.claude/e2e/tests/search.spec.ts` (new)

**Interfaces:**
- Produces: `<that-issue-search>`, a light-DOM component registered as `that-issue-search`.
  Configured by property, not attribute, because two of the three fields are functions:

```ts
export interface IssueSearchConfig {
  /** The field's placeholder. Today and Week word it differently. */
  placeholder: string;
  /** The sentence under the results. Stated in words so an empty panel is not
   *  mistaken for a filter that found nothing. */
  footer: string;
  /** The controls one result row carries, left to right. */
  controls: IssueSearchControl[];
}

export interface IssueSearchControl {
  /** Icon name, or the word a text control shows. */
  icon: IconName;
  /** The accessible name. A tooltip is never the accessible name. */
  label: string;
  /** Called with the hit the row is for. */
  onPress: (hit: IssueHit) => void | Promise<void>;
}
```

- Consumes: `searchIssues(query, signal)` from `web/src/api.ts`, unchanged.

**What it owns:** the input, the panel, the debounce, the `AbortController` that supersedes an
in-flight read, grouping hits by instance with the instance dot and name as the group label, the
footer sentence, the empty state, and a line naming any instance that did not answer.

**What it does not own:** what a control does. Both hosts pass that in, which is what lets Today's
row carry Log and pin while Week's carries the new mark and pin.

- [ ] **Step 1: Write the failing end-to-end assertions**

In a new `.claude/e2e/tests/search.spec.ts`. Stub `/api/issues/search` and mount the component on
Today, which Task 4 wires — so this task's tests are written against Today's field and go green when
Task 4 lands. **Write them now and expect them red until then**; the component cannot be reached
without a host.

Assert: typing fewer than two characters reaches no network; results group under their instance name
with the instance dot; the footer sentence is present; an instance in the `errors` array is named on
screen rather than silently dropped; and a search that matches nothing shows an empty state distinct
from the failure line.

- [ ] **Step 2: Run them and watch them fail**

Run: `docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/search.spec.ts'`
Expected: FAIL — there is no field to type into.

- [ ] **Step 3: Write the component**

Light DOM, `that-` prefix, no shadow root. Classes come from the prototype's `.field`, `.results`,
`.rgroup`, `.rrow`, `.rk`, `.rs` and `.rfoot`, translated to the app's Tailwind vocabulary the way
the existing components translate theirs — read `that-ticket-row.ts` for the house style before
writing. The field is **300px wide** and the panel spans it exactly.

- [ ] **Step 4: Run the gates**

- [ ] **Step 5: Commit**

```bash
git add web/src/components/that-issue-search.ts .claude/e2e/tests/search.spec.ts
git commit -m "feat(#84): a search panel that reports which instance did not answer"
```

---

### Task 4: Today's search, and logging without pinning

**Covers:** the field in the Assigned issues header, the Log control, and the pin control.

**Files:**
- Modify: `web/src/views/today.ts`
- Test: `.claude/e2e/tests/search.spec.ts`

**Interfaces:**
- Consumes: `that-issue-search` from Task 3.

**The configuration Today passes:**

- placeholder `Search all instances`
- footer `Searching all instances by key and summary. Not limited to issues assigned to you.`
- controls: a duration control that opens the entry dialog for that issue, then a pin control.

**The two things that matter:**

1. **Logging from a result creates an entry and no pin.** The dialog is the one `that-entry-dialog`
   already provides, given an `EntryTicket` with no `day` — which means today, as the server resolves
   it.
2. **The list underneath is untouched while results are open.** It is a lookup, not a filter. A test
   asserts the assigned rows are unchanged while the panel is showing.

- [ ] **Step 1: Write the failing assertions**

Assert: the field sits in the Assigned issues header beside Refresh; typing does not change the rows
underneath; logging from a result posts to `/api/entries` with no `day` and no pin request; the
pinned list gains a row when the pin control is pressed.

- [ ] **Step 2: Run them and watch them fail**
- [ ] **Step 3: Mount and configure the component**
- [ ] **Step 4: Run both gates**
- [ ] **Step 5: Commit**

```bash
git add web/src/views/today.ts .claude/e2e/tests/search.spec.ts
git commit -m "feat(#84): Today searches every instance, and logs without pinning"
```

---

### Task 5: Pinned takes the left half, and off-list time takes the right

**Covers:** decision 2 of the design in full.

**Files:**
- Modify: `web/src/views/today.ts`
- Test: `.claude/e2e/tests/today.spec.ts`

**What the design settled**, and the order it must be built in:

- **A two-column grid**, Pinned left, the new section right, collapsing to one column at the same
  breakpoint the instance grid already uses. Read `.instgrid` in the prototype: one column, then
  `1fr 1fr` at its container breakpoint.
- **Pinned takes the left half permanently.** It never spans the full width.
- **The right half carries nothing at all when empty** — no heading, no card, no line.
- **Pinned keeps `Nothing pinned.`**, because that empty state is an invitation and the other is not.
- The section's heading is `Logged today, not on your list`.
- Its rows are the day's entries whose issue is neither assigned nor pinned, each carrying the same
  duration control and a pin control.

**The three states in the design's table each get a test.** The one that matters most is the first:
an ordinary day must render the right half empty and Pinned at half width, and the test asserts
Pinned's width does not change when the right half fills. That is the whole reason for the layout.

- [ ] **Step 1: Write the failing assertions, one per state**
- [ ] **Step 2: Run them and watch them fail**
- [ ] **Step 3: Build the layout**
- [ ] **Step 4: Run both gates**
- [ ] **Step 5: Commit**

```bash
git add web/src/views/today.ts .claude/e2e/tests/today.spec.ts
git commit -m "feat(#84): off-list time sits beside Pinned, and nothing resizes"
```

---

### Task 6: Week's search puts a ticket in the week

**Covers:** decision 3, and the transient row.

**Files:**
- Modify: `web/src/views/week.ts`
- Test: `.claude/e2e/tests/week.spec.ts`

**The configuration Week passes:**

- placeholder `Add a ticket to this week`
- footer `Searching all instances. Choosing a result adds it to this week; click a day to log time.`
- controls: the `add-to-week` mark, labelled `add to this week`, then a pin control.

**The transient row, exactly:**

- Choosing a result adds a row to the grid **in the same sort position any row takes** — instance
  position, then key — with seven empty cells and an em dash total, per decision 1.
- **It logs nothing.** Week's result rows carry no duration control.
- The row lives in the view's own state. **It is not stored, not pinned, and not sent anywhere.**
- **It dies with the view.** Navigating away and back loses it. A re-read of the week that returns no
  entries for it also loses it — the row is not re-added on every paint.
- Once time is logged into one of its cells it is an ordinary row with entries, and it survives
  because the rollup now carries it, not because anything remembered the add.

**The test that carries this task's risk:** add a ticket, log an hour into Wednesday, navigate to
Today and back, and assert the row is still there with its hour. Then add a second ticket, log
nothing, navigate away and back, and assert that one is gone. Both halves are needed: the first alone
would pass if rows were stored, and the second alone would pass if they were never added.

- [ ] **Step 1: Write the failing assertions**
- [ ] **Step 2: Run them and watch them fail**
- [ ] **Step 3: Mount the component and hold the added keys in the view's state**
- [ ] **Step 4: Run both gates**
- [ ] **Step 5: Commit**

```bash
git add web/src/views/week.ts .claude/e2e/tests/week.spec.ts
git commit -m "feat(#84): a week's search puts a ticket in the grid and logs nothing"
```

---

### Task 7: The Pinned card's own pin form goes

**Covers:** the criterion that deletes it, decided by the owner on 2026-09-03.

**Files:**
- Modify: `web/src/views/today.ts` (the `pinnedForm` region and its combobox)
- Delete: `web/src/components/that-combobox.ts` **only if nothing else uses it** — check first
- Modify: `.claude/e2e/tests/pins.spec.ts`, `.claude/e2e/tests/today.spec.ts`

This is a deliberate removal of shipped, tested UI. The tests that covered the form go with it; the
tests that cover **pinning** move to the search panel rather than being deleted, because the
behaviour survives even though its control moved.

- [ ] **Step 1: Find every consumer of `that-combobox`**

Run: `docker compose run --rm --no-deps web sh -c 'grep -rn "that-combobox\|ThatCombobox" src/ ../.claude/e2e/tests/ || true'`

If the pin form is the only one, the component and its tests go too. If not, leave it.

- [ ] **Step 2: Delete the form and its region**
- [ ] **Step 3: Move the pinning assertions to the search panel**
- [ ] **Step 4: Run both gates**
- [ ] **Step 5: Commit**

```bash
git add -A web/src .claude/e2e/tests
git commit -m "feat(#84): the Pinned card's form goes, its job done by the search"
```

---

### Task 8: The drawings catch up

**Covers:** the last criterion, and the corrections this branch forces.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-02-week-view-design.md`
- Modify: `docs/superpowers/prototypes/2026-09-03-app-prototype.html`

**Three corrections, each in the document's own voice:**

1. **The week view design's row rule.** It says *"A row appears when it has at least one entry in the
   week. The grid is not a list of assigned or pinned tickets; it is what the week actually
   contains."* Decision 1 of this ticket's design replaces it. Say what the rule is now, that it
   changed deliberately, and cite #84 and #139. **If #139 landed first, this correction is already
   made** — check before writing, and if so, leave it alone.
2. **The prototype's Week result row** carries a pin control and a Log control. It gains the
   `add-to-week` mark and loses the Log control, because logging happens in the cells.
3. **The prototype's Week footer** reads *"Searching all instances. Logging against a result adds it
   to this week."* That is no longer what happens. It takes the wording from the design.

Do not delete a line without replacing its reasoning.

- [ ] **Step 1: Correct all three**
- [ ] **Step 2: Run `make verify`**
- [ ] **Step 3: Commit**

```bash
git add docs/superpowers
git commit -m "docs(#84): the drawings catch up with the week's own search"
```

---

### Task 9: The unpin control takes its colour on hover

**Covers:** a change the owner asked for on 2026-09-10, folded into this ticket on their instruction
rather than kept as #142.

**Files:**
- Modify: `web/src/components/that-ticket-row.ts` (`paintPinned`)
- Modify: `docs/superpowers/prototypes/2026-09-03-app-prototype.html`
- Test: `.claude/e2e/tests/pins.spec.ts`

**What is there now.** `paintPinned` toggles `text-primary` on the trigger whenever the row is
pinned, so a pinned row's control is coloured at rest. The prototype draws the same thing:
`.iconbtn.on { color: var(--pri); }`.

**What it becomes.** The control sits at the same ink as an unpinned row's, and takes the primary
colour on hover — and on `focus-visible`, which shares the hover rule everywhere else in this app.
The mark still changes shape between the two states, `pin` against `pin-off`, so pinned is still
legible at rest.

**This changes the drawing rather than correcting a drift**, so the prototype's rule moves with the
app. The instance list already has the behaviour being asked for here — `ul.inst .iconbtn:hover
{ color: var(--pri); }` — so the two end up saying the same thing; state it once if that reads
better in context.

- [ ] **Step 1: Write the failing assertion**

In `.claude/e2e/tests/pins.spec.ts`: a pinned row's control carries the muted ink at rest and the
primary colour on hover. Assert the computed colour both ways, the way the rail's tests do with
`computedColor`; asserting the class alone would pass against a stylesheet that no longer paints it.

- [ ] **Step 2: Run it and watch it fail**
- [ ] **Step 3: Make the change, in the app and in the prototype**
- [ ] **Step 4: Run both gates**

**In your report, say what the two states look like side by side at rest**, with the colour gone. The
owner has not seen it yet, and the open question is whether `pin` and `pin-off` are distinct enough
at 18px without the colour to carry it alone. If they are not, that is a finding for the owner, not a
reason to put the colour back.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/that-ticket-row.ts docs/superpowers/prototypes .claude/e2e/tests/pins.spec.ts
git commit -m "feat(#84): the unpin control takes its colour on hover, not at rest"
```

---

## Finishing

1. **The whole-branch review is not optional.** This branch's risk is Task 6: a row that exists in
   one view's memory and nowhere else is a shape this app has never had.
2. **`make verify` and `make test-e2e` both green, output pasted into the pull request.**
3. **Tick the ticket's criteria as the reviews confirm them**, and untick anything a later pass shows
   regressed.
4. **Open the pull request with `Closes #84`.** The ticket keeps `status/in-progress`.
5. **Never merge to `main` locally.**
6. **Report to the owner** anything this branch forced that the design did not settle.

## Risks worth stating before starting

- **The transient row has no precedent here.** Every other row in this app comes from the server. One
  that exists only in the view's state can be re-added by a repaint, survive a navigation it should
  not, or vanish on a refresh the user did not expect. Task 6's paired test is the guard, and it needs
  both halves.
- **The search panel is 300px wide and carries two controls.** The summary clips, and that was
  accepted at true size — but a reviewer measuring against a mockup rather than the running app will
  read it as a defect. It is not.
- **Deleting the pin form removes tested behaviour.** The risk is deleting the *tests for pinning*
  along with the tests for the form. Pinning still exists; only its control moved.
- **Widening the JQL changes what a search returns for everyone**, and the only consumer that is not
  this ticket's is the pin form, which Task 7 deletes. If Task 7 is dropped, Task 1 changes the pin
  picker's behaviour silently.
