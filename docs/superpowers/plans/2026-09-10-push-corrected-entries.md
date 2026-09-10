# The rail offers corrected entries too — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-09-10
**Supersedes:** nothing
**Superseded by:** nothing

**Goal:** An entry corrected after it was pushed is counted by the rail and sent by Push, so #10's
corrections are reachable from the interface they belong to.

**Architecture:** One predicate replaces two hand-written filters. Everything that is not `pushed` is
pending — never-pushed and corrected alike — and both the count and the push read the same function,
so they cannot drift apart. No wording on the rail changes.

**Tech Stack:** Vanilla TypeScript (`strict`, `noUncheckedIndexedAccess`), Tailwind v4 with tokens in
`@theme`, Playwright for end-to-end. No Go changes: the server already sweeps dirty entries.

**Spec:** [#121](https://codeberg.org/DionGerrese/ThatApp/issues/121), which carries the problem, the
approach and the acceptance criteria. The push semantics it rests on are in
[`2026-08-04-thatapp-design.md`](../specs/2026-08-04-thatapp-design.md) — derived push state, and a
push that is not transactional.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Local development runs in Docker.** No Go, Node or npm on the host. Everything through `make` or
  `docker compose run --rm --no-deps <service> <cmd>`.
- **Derived push state is computed, never stored.** `unpushed`, `pushed` and `dirty` come from
  `worklog_id`, `updated_at` and `pushed_at`. A push across instances is not transactional: each
  entry succeeds or fails on its own, and the interface must show which did not make it.
- **The browser never derives a date.** Every date came from a server response.
- **TypeScript is `strict` with `noUncheckedIndexedAccess`.** No `any`, no `as any`, no non-null
  assertion to get past a type error.
- **Tailwind v4, CSS-first.** Theme values live in `@theme` in `web/src/styles.css`;
  `web/src/vocabulary.test.ts` forbids arbitrary literals for some properties.
- **Comments are few** — a non-obvious why, an external workaround, a subtle invariant.
- **A function's name must let a reader predict what it returns.**
- Commit style: `fix(#121):` / `feat(#121):`, a body explaining why, and the session's trailers.

## File structure

| File | What changes |
| --- | --- |
| `web/src/rail.ts` | One `isPending` predicate; both filters use it. The confirmation body stops claiming creation. |
| `.claude/e2e/tests/push.spec.ts` | Three cases: a corrected-only day, a mixed day, an all-pushed day. |
| `.claude/e2e/tests/week.spec.ts` | `rail.ts` is shared with Week, so Task 1 flips the existing dirty-only-week test from "offers no Push" to "still offers a push". |
| `docs/superpowers/specs/2026-09-02-week-view-design.md` | Decision 8 corrected: a dirty day is pushable as of #121, not forbidden pending #10. Added mid-execution — Task 3. |

Three tasks. Task 1 is the defect. Task 2 is a sentence that becomes false once Task 1 lands, and a
reviewer could reasonably approve one and reject the other. **Task 3 was added mid-execution**: Task
1's own review found the week view's design document still asserting, as design, the exact rule
Task 1 had just disproved — a stale claim that would have led #11's implementer straight back to the
restriction this ticket removes. Neither of the first two tasks owned that document, so fixing it
here beat opening a follow-up ticket for two paragraphs.

---

### Task 1: Pending means anything not pushed

**Covers:** every acceptance criterion except the confirmation wording.

**Files:**
- Modify: `web/src/rail.ts` — the `paint` filter and the `handlePush` re-check filter
- Test: `.claude/e2e/tests/push.spec.ts`

**Interfaces:**
- Produces: `isPending(entry: Entry): boolean` in `web/src/rail.ts`, module-scope, returning
  `entry.pushState !== "pushed"`. Task 2 does not use it.

**Why a predicate rather than two edited filters.** The two sites are 100 lines apart and were
already inconsistent with the server. The criterion asks that they cannot drift; a named function
both call is how that is enforced rather than hoped for.

- [ ] **Step 1: Write the failing end-to-end tests**

In `.claude/e2e/tests/push.spec.ts`, beside the existing rail tests. `stubToday` already accepts
`dirty`, so no fixture change is needed.

```ts
test("a day whose only stale entry is a correction still offers a push", async ({ page }) => {
  await stubToday(page, [{ id: 1, issueKey: "RIDGE-1", pushState: "dirty" }]);

  await page.goto("/today");
  const unpushed = page.locator("#rail-unpushed");

  await expect(unpushed).toHaveText("1 entry to push");
  await expect(unpushed).toHaveCSS("color", await computedColor(page, "text-pending-rail", "color"));
  await expect(page.getByRole("button", { name: "Push to Jira" })).toBeEnabled();
});

test("the count covers never-pushed and corrected entries as one number", async ({ page }) => {
  await stubToday(page, [
    { id: 1, issueKey: "RIDGE-1", pushState: "unpushed" },
    { id: 2, issueKey: "RIDGE-2", pushState: "dirty" },
    { id: 3, issueKey: "RIDGE-3", pushState: "pushed" },
  ]);

  await page.goto("/today");

  await expect(page.locator("#rail-unpushed")).toHaveText("2 entries to push");
  await expect(page.getByRole("button", { name: "Push to Jira" })).toBeEnabled();
});

test("a day whose entries are all pushed offers nothing", async ({ page }) => {
  await stubToday(page, [{ id: 1, issueKey: "RIDGE-1", pushState: "pushed" }]);

  await page.goto("/today");
  const unpushed = page.locator("#rail-unpushed");

  await expect(unpushed).toHaveText("Nothing to push");
  await expect(unpushed).toHaveCSS("color", await computedColor(page, "text-rail-muted", "color"));
  await expect(page.getByRole("button", { name: "Push to Jira" })).toBeDisabled();
});
```

Each asserts the text, the colour and the button together. An assertion on the count alone passes
with the button still dead, which is the defect being fixed.

- [ ] **Step 2: Run them and watch them fail**

Run: `docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/push.spec.ts'`

Expected: the first two FAIL — `Nothing to push` received where `1 entry to push` and
`2 entries to push` are expected, and the button disabled. The third PASSES already; it is there to
pin the boundary Task 1 must not move.

- [ ] **Step 3: Add the predicate and use it at both sites**

In `web/src/rail.ts`, at module scope beside the other helpers:

```ts
// Everything that is not pushed is pending: never sent, or sent and edited
// since. The server's push sweeps both (internal/server/push.go), and the two
// filters below drifted from it because each was written by hand — #121.
const isPending = (entry: Entry): boolean => entry.pushState !== "pushed";
```

Then in `paint`:

```ts
    pending = entries.filter(isPending);
```

And in `handlePush`, replacing the `due` filter:

```ts
      const due = entries.filter(isPending);
```

- [ ] **Step 4: Run them and watch them pass**

Run the same command. Expected: all three PASS.

- [ ] **Step 5: Run both gates**

Run `make verify` and `make test-e2e`. Paste both. `pwa.spec.ts` crashes chromium intermittently on
this rig — ticket #134 — so a crash there is re-run, not chased.

- [ ] **Step 6: Commit**

```bash
git add web/src/rail.ts .claude/e2e/tests/push.spec.ts
git commit -m "fix(#121): a corrected entry is pending too, and the rail says so"
```

---

### Task 2: The confirmation stops claiming everything is created

**Covers:** a sentence Task 1 makes false. Not in the ticket's own criteria — see the ruling below.

**Files:**
- Modify: `web/src/rail.ts` — the `confirmDestructive` body
- Test: `.claude/e2e/tests/push.spec.ts`

**Interfaces:**
- Consumes: nothing from Task 1 beyond it having landed.

**The ruling this task implements.** The confirmation reads *"N entries totalling Xh will be created
as worklogs on N sites."* Once corrections are included, that is false for some of them: a corrected
entry updates a worklog Jira already has. The rail's own count wording was settled on 2026-09-10 and
does not change, but this sentence is a different string and the ticket did not anticipate it. The
smallest truthful change is to stop naming creation, keeping one number as the owner chose:

> N entries totalling 7h 30m across 2 days will be sent to 2 sites.

**This is a change to user-facing copy the ticket does not authorise, so it is reported to the owner
rather than absorbed.** If they would rather the confirmation distinguish new entries from
corrections, that is a state no drawing expresses and would need a design session; this task does
not attempt it.

- [ ] **Step 1: Write the failing test**

```ts
test("the confirmation does not claim a correction will be created", async ({ page }) => {
  await stubToday(page, [
    { id: 1, issueKey: "RIDGE-1", pushState: "unpushed" },
    { id: 2, issueKey: "RIDGE-2", pushState: "dirty" },
  ]);

  await page.goto("/today");
  await page.getByRole("button", { name: "Push to Jira" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("2 entries totalling 1h 00m will be sent to 1 site.");
  await expect(dialog).not.toContainText("created");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/push.spec.ts -g "does not claim"'`

Expected: FAIL — the body still reads `will be created as worklogs on 1 site.`

- [ ] **Step 3: Reword the body**

In `web/src/rail.ts`, in the `confirmDestructive` call:

```ts
        body:
          `${label} totalling ${totalFigure(seconds)}${across} will be sent to ` +
          `${String(sites)} ${sites === 1 ? "site" : "sites"}.`,
```

- [ ] **Step 4: Run it and watch it pass**

- [ ] **Step 5: Run both gates**

Run `make verify` and `make test-e2e`. Paste both.

- [ ] **Step 6: Commit**

```bash
git add web/src/rail.ts .claude/e2e/tests/push.spec.ts
git commit -m "fix(#121): the confirmation stops promising creation for a correction"
```

---

### Task 3: Correct the week view's design document to match Task 1

**Added mid-execution.** Task 1's review read decision 8 in
`docs/superpowers/specs/2026-09-02-week-view-design.md` — the design of record for #11 — and found
it still forbidding exactly what Task 1 had just shipped: "A dirty day is not pushable, and must not
offer a Push", justified because updating a worklog Jira already had "is #10's whole subject and
does not exist yet". #10 shipped on 2026-09-08. Leaving the document as it stood would let #11's
implementer read the design, find the old rule, and rebuild the restriction this ticket removes.

**Covers:** no acceptance criterion of #121's — the document, not the product.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-02-week-view-design.md` — decision 8

**Interfaces:** none. Documentation only; there is no test cycle to run red before green.

- [ ] **Step 1: Rewrite decision 8's second and third paragraphs**

State the rule as it now is — a dirty day is pushable, `handlePushDay` skips only entries already
`pushed` — and why the old rule was right when written but its precondition expired rather than its
reasoning being wrong. Also correct the paragraph's last sentence, which claimed the rail's *total*
was filtered to unpushed time; `web/src/rail.ts` has always summed every entry regardless of push
state, so only the *count* was ever filtered.

- [ ] **Step 2: Rewrite decision 8's opening bold sentence**

The first pass corrected the two paragraphs beneath it but left the bold sentence two lines above
still reading "Push sends every day holding unpushed entries" — the same stale claim, sitting
directly above its own correction. Reuse "unpushed or dirty" from the paragraph it introduces rather
than a third way of naming the same set.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-09-02-week-view-design.md
git commit -m "docs(#121): a corrected day is pushable, and why it was not"
```

---

## Finishing

1. **The whole-branch review is not optional**, small as this branch is. Its risk is derived push
   state, which this project's guidance names as one of the two places its bugs live.
2. **Tick the ticket's criteria as the reviews confirm them**, and untick anything a later pass shows
   regressed.
3. `make verify` and `make test-e2e` green, output pasted into the pull request.
4. **Open the pull request with `Closes #121`.** The ticket keeps `status/in-progress`.
5. **Never merge to `main` locally.**
6. **Report Task 2's wording change to the owner** in the pull request body and in the session's
   report, so the decision is theirs to keep or reverse.

## Risks worth stating before starting

- **The predicate is the whole fix, and it is one character away from inverting.** `!== "pushed"`
  against `=== "pushed"` is a silent disaster: everything already sent would be pushed again. The
  all-pushed test is what stands between that and the user.
- **Nothing here tests the server.** The Go side already handles corrections and is out of scope, so
  a green suite proves the rail offers the push, not that Jira received it.
