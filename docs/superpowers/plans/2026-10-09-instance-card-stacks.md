# Today's instance cards go into two stacks — Implementation Plan

**Date:** 2026-10-09
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the 80rem container breakpoint, Today's instance cards sit in two column stacks, each card placed in instance order into the shorter stack (a tie goes left), and each card keeps its stack on every redraw except Today opening and Refresh. Below the breakpoint they are one column in instance order (#144).

**Architecture:** `results` keeps its grid classes (`grid-cols-1`, `@min-[80rem]:grid-cols-2`) but holds two flex-column stack `div`s instead of the cards. A pure `placeInStacks(cards, remembered)` in a new `web/src/card-stacks.ts` decides placement from measured heights. Today keeps the result in `regions.stackOf`. Every render puts all cards into the left stack, measures them at a column's width, places them and moves the right-hand ones over with `moveBefore`. A `ResizeObserver` on `results` re-runs the arrangement when the grid's computed column count changes. It never recomputes placement. Only Refresh, once its issues answer arrives, empties `stackOf`. Today opening gets a fresh `regions`, so it starts empty.

**Tech Stack:** TypeScript (vanilla, light-DOM `that-*` components); Tailwind v4 utilities; `node --test` for unit tests; Playwright (Firefox and Chromium).

**Spec:** Codeberg #144. Its body is the design of record for this change, settled with the owner in the 2026-10-09 design session; it has no comments. The session's drawing is `.superpowers/brainstorm/152669-1791539370/content/instance-layout.html`, option 2, "Two stacks, shortest first". Its script measures each stack's `offsetHeight` and appends to the shorter one, `<=` sending a tie left. Today's layout decisions: `docs/superpowers/specs/2026-09-03-today-and-week-design.md` (*Layout*, decision 2: "Never three"). Prototype: `docs/superpowers/prototypes/2026-09-03-app-prototype.html` (`.instgrid`).

## Global Constraints

- All tooling goes through `make` or `docker compose`. Never run Node or npm on the host. Nothing here needs the dev stack. If you open it anyway, read `THAT_PORT` from `.env`; do not assume a port.
- Vanilla TS with `strict` + `noUncheckedIndexedAccess`. No `any`, no `as any`, no `!`. Light DOM only. No new dependency and no new `THAT_*` variable.
- Firefox and Chromium only. Never add WebKit.
- Keep comments few: a non-obvious why only. Names must say what they return.
- **Two stacks at most.** "Never three" stands (ticket, *Out of scope*).
- **The Pinned / off-list grid (`layoutGrid`) is not touched.** No line of this plan edits it or its classes.
- **The breakpoint is written once**, as the `@min-[80rem]:grid-cols-2` class on `results`. JavaScript reads the grid's computed column count (`showsTwoStacks`) and never restates 80rem.
- **TDD, per task.** RED must fail on an **assertion**, for the reason the test names. It must never be a compile error (a task's first step adds the bare declarations its tests need), and never a timeout on a typo'd locator. An `expect.poll` that times out showing the wrong received value counts as an assertion. The task report quotes the RED line.
- **Guard tests.** A test marked *guard* passes before its task's change and is proven entirely by mutation.
- **Every assertion a task adds is proven by mutation.** Break the guarded code by hand, run that one test, show it red, restore, show it green. The report lists each mutation with its red line. Assertions after the first in a test use `expect.soft` wherever an earlier one would otherwise stop the test, so each line is reachable under its own mutation. Lines marked `// wait` only synchronise. They are not guards.
- Commands:

  ```shell
  # Frontend unit tests: one file, or all of them
  docker compose run --build --rm --no-deps web node --test src/card-stacks.test.ts
  make test-web
  # Prettier on web/src only (never on .claude/e2e — it has no config)
  docker compose run --rm --no-deps web npx prettier --write src/card-stacks.ts src/card-stacks.test.ts src/views/today.ts src/components/that-table.ts
  # Type check, lint
  make tsc
  make lint
  # One e2e spec — the rig's own disposable app-e2e; always clean up around it
  docker compose --profile e2e rm --stop --force app-e2e
  docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test instance-stacks.spec.ts --reporter=line'
  docker compose --profile e2e rm --stop --force app-e2e
  ```

  Add `-g "<title fragment>"` to the Playwright command to run one test (every mutation run).
- Commits: if `git commit` fails on signing (a locked 1Password vault), retry the same commit with `git -c commit.gpgsign=false commit …` and carry on. Note the last signed commit in the report. **Never push.** Never merge into `main`.
- Branch: `issue-144-instance-stacks`, already checked out. Do not switch, stash or reset.
- This plan does not touch `docs/superpowers/plans/handoff.md`. The controller takes the screenshots after the plan; no task captures them.

## Rulings made before execution

The ticket and the drawing decide the behaviour; these are the places they are silent. They are the controller's rulings, and the owner can reverse any of them.

1. **"Shorter" means measured height, not row count.** The drawing's script compares `offsetHeight`. Each card is measured at a column's width, while all of them sit in the left stack. The stack's row gap is added to each card's height. That makes the comparison match the stacks' real heights, since a stack of *n* cards has *n − 1* gaps, and adding one gap to each side cancels out.
2. **An instance with no remembered stack goes to the stack that is shorter with every remembered card counted in full.** It is not placed by a running total in instance order. That is the ticket's wording ("goes to the shorter stack"), and it differs only when a new instance lands between remembered ones. When Today opens, nothing is remembered, so this is exactly "each in turn to the shorter stack".
3. **Opened below the breakpoint, nothing is placed until the cards first get two stacks.** At that crossing, every card is an instance with no remembered stack, so it is placed shortest-first. Crossing back and forth never recomputes. A redraw while in one column keeps the memory.
4. **A container query fires no event,** so a `ResizeObserver` on `results` watches for the computed column count changing. The arrangement runs one animation frame later. Moving cards inside the callback would resize the observed element and trip the observer's loop-limit error.
5. **Refresh starts placement over when its issues answer arrives, not when it is pressed.** Refresh also rereads the pins, and a pins answer that lands first redraws from the issues already held. That redraw must not be the one that places the cards. A Refresh whose issues read fails keeps the memory.
6. **Cards move between stacks with `moveBefore`, where the engine has it.** `that-table` gains a no-op `connectedMoveCallback`, as `that-ticket-row` already has (#83). Moving a card then rebuilds no row, and a focused control keeps focus across a crossing, for example on a browser zoom. On Firefox ESR before 144 the move falls back to `insertBefore` and loses focus, the same trade #83 accepted.
7. **The memory is replaced by each new placement.** An instance that leaves on a redraw is forgotten, and if it comes back it is placed as a new one. The cards that stay do not move up to fill its place.
8. **The "visual language" in the ticket is the Today layout decision.** The 2026-08-20 visual design language never describes the instance grid. Today's "one across, two from `xl`, never three" lives in `2026-09-03-today-and-week-design.md` (*Layout* decision 2 and its acceptance line), so that is the document Task 5 updates. The second edition's decision 8 ("the cap…, not a third column of cards") still holds as written.
9. **The prototype draws two instances, so its picture does not change.** With two cards, two stacks look exactly like two grid cells. Its structure and CSS change to two `.stack` columns. Its hue lookup, `b.closest('.instgrid > div')`, would otherwise match a stack, so it becomes `b.closest('.inst')`.

## Review Focus

1. **A browser zoom (or window resize) across the breakpoint while a row's control has focus.** Focus must stay on that control and must not drop to `<body>`. Task 3's "a focused row keeps its focus…".
2. **Today opened in a narrow window and then widened.** The cards must be placed shortest-first at that moment, not left all in the left stack and not dealt alternately. Task 3's "opened below the breakpoint…".
3. **The data changes while Today is one column wide, and the window then widens.** The cards must return to the stacks they had, not be placed afresh. Task 3's "a redraw at one column…".
4. **An instance is removed in Settings, and the next redraw lacks it.** The remaining cards keep their stacks, with no repacking. Task 4's "an instance that leaves on a redraw…".
5. **A Refresh whose pins answer lands before its issues answer.** The cards are placed from the issues that Refresh fetched, not from the ones on screen before it. Task 4's "Refresh places the cards afresh…".

---

### Task 1: The placement rule, as a pure function

**Files:**
- Create: `web/src/card-stacks.ts`
- Test: `web/src/card-stacks.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (later tasks rely on these exact names):
  - `export type Stack = "left" | "right";`
  - `export interface CardHeight { id: number; height: number; }`
  - `export function placeInStacks(cards: readonly CardHeight[], remembered: ReadonlyMap<number, Stack>): Map<number, Stack>`. It returns a stack for every card in `cards` and for nothing else.

- [ ] **Step 1: Bare declarations.** Create `web/src/card-stacks.ts`:

```ts
export type Stack = "left" | "right";

export interface CardHeight {
  id: number;
  height: number;
}

export function placeInStacks(
  cards: readonly CardHeight[],
  remembered: ReadonlyMap<number, Stack>,
): Map<number, Stack> {
  return new Map();
}
```

- [ ] **Step 2: Write the failing test.** Create `web/src/card-stacks.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { placeInStacks, type CardHeight, type Stack } from "./card-stacks.ts";

/** Cards with ids 1… in instance order, of the given heights. */
function cards(...heights: number[]): CardHeight[] {
  return heights.map((height, index) => ({ id: index + 1, height }));
}

void test("placeInStacks", async (t) => {
  const cases: {
    name: string;
    cards: CardHeight[];
    remembered: [number, Stack][];
    want: Stack[];
  }[] = [
    {
      name: "the reported case: an empty card after a tall and a short one joins the short one",
      cards: cards(400, 150, 60),
      remembered: [],
      want: ["left", "right", "right"],
    },
    {
      name: "a tie goes left, for the first card and for a later one",
      cards: cards(100, 100, 50),
      remembered: [],
      want: ["left", "right", "left"],
    },
    {
      name: "cards are placed in instance order, not tallest first",
      cards: cards(50, 300, 100),
      remembered: [],
      want: ["left", "right", "left"],
    },
    {
      name: "a remembered stack is kept, even where the other stack is now the shorter",
      cards: cards(50, 300, 40),
      remembered: [
        [1, "right"],
        [2, "left"],
        [3, "left"],
      ],
      want: ["right", "left", "left"],
    },
    {
      name: "a new card goes to the stack that is shorter with every remembered card counted",
      cards: cards(100, 50, 300),
      remembered: [
        [1, "left"],
        [3, "right"],
      ],
      want: ["left", "left", "right"],
    },
    {
      name: "a new last card joins the shorter stack",
      cards: cards(400, 150, 60, 80),
      remembered: [
        [1, "left"],
        [2, "right"],
        [3, "right"],
      ],
      want: ["left", "right", "right", "right"],
    },
    {
      name: "a remembered instance that is gone is forgotten",
      cards: cards(100),
      remembered: [[9, "right"]],
      want: ["left"],
    },
    {
      name: "nothing to place places nothing",
      cards: [],
      remembered: [],
      want: [],
    },
  ];

  for (const c of cases) {
    await t.test(c.name, () => {
      const got = placeInStacks(c.cards, new Map(c.remembered));

      assert.deepEqual(
        c.cards.map((card) => got.get(card.id)),
        c.want,
      );
      assert.equal(got.size, c.cards.length, "the placement holds a card that is not on screen");
    });
  }
});
```

- [ ] **Step 3: Run it; see RED.**

Run: `docker compose run --build --rm --no-deps web node --test src/card-stacks.test.ts`
Expected: every case except "nothing to place places nothing" fails on `deepEqual`, because each expected stack is `undefined`. "Nothing to place" passes as a guard.

- [ ] **Step 4: Implement.** Replace `placeInStacks` in `web/src/card-stacks.ts` with:

```ts
/**
 * Which of Today's two stacks each instance card goes in (#144). A card with a remembered stack
 * keeps it, however the heights have changed since. Each other card, in the order given (instance
 * position order), goes to the stack that is shorter at that moment, counting every remembered
 * card in full; a tie goes left. `height` is what a card adds to its stack — its own height plus
 * the gap below it.
 */
export function placeInStacks(
  cards: readonly CardHeight[],
  remembered: ReadonlyMap<number, Stack>,
): Map<number, Stack> {
  const placement = new Map<number, Stack>();
  const heights: Record<Stack, number> = { left: 0, right: 0 };

  for (const card of cards) {
    const stack = remembered.get(card.id);
    if (stack === undefined) continue;
    placement.set(card.id, stack);
    heights[stack] += card.height;
  }

  for (const card of cards) {
    if (placement.has(card.id)) continue;
    const stack: Stack = heights.left <= heights.right ? "left" : "right";
    placement.set(card.id, stack);
    heights[stack] += card.height;
  }

  return placement;
}
```

- [ ] **Step 5: Run it; see GREEN.** Run Prettier on `src/card-stacks.ts` and `src/card-stacks.test.ts`, then `make tsc`, `make lint` and the unit command above.

- [ ] **Step 6: Mutations.** Run each one, see the named case red, then restore it:
  1. `heights.left <= heights.right` becomes `heights.left < heights.right`. Red: "a tie goes left…".
  2. The first loop's body becomes `continue;` (memory ignored). Red: "a remembered stack is kept…".
  3. Fold both loops into one in-order loop. A remembered card takes its stack, a new card takes the shorter, and both add their height as they go. Red: "a new card goes to the stack that is shorter with every remembered card counted".
  4. Iterate `[...cards].sort((a, b) => b.height - a.height)` in the second loop. Red: "cards are placed in instance order…".
  5. Drop `heights[stack] += card.height;` in the second loop. Red: "the reported case…".
  6. Drop `heights[stack] += card.height;` in the first loop. Red: "a new last card joins the shorter stack".
  7. Start from `const placement = new Map<number, Stack>(remembered);`. Red: "a remembered instance that is gone is forgotten", on `the placement holds a card that is not on screen`.

- [ ] **Step 7: Commit.**

```bash
git add web/src/card-stacks.ts web/src/card-stacks.test.ts
git commit -m "feat(#144): the rule that places an instance card in one of two stacks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DhrQjSkmUmfVxLZHhaYLwQ"
```

---

### Task 2: Today lays its instance cards out in two stacks

**Files:**
- Modify: `web/src/card-stacks.ts`: adds `showsTwoStacks` and `moveIntoStack`.
- Modify: `web/src/views/today.ts`: imports, `StackCard`, `Regions`, the `results` block in `render`, the `regions` literal, `renderResponse`, a new `arrangeCards` and a new `cardStack`.
- Test: `.claude/e2e/tests/instance-stacks.spec.ts` (new)

**Interfaces:**
- Consumes (Task 1): `Stack`, `placeInStacks`. From the codebase: `alignKeyColumn(scope)`, `instanceSection(group, position, pins)`, and the global `ParentNode.moveBefore?` declared in `web/src/components/that-table.ts`.
- Produces:
  - `export function showsTwoStacks(grid: HTMLElement): boolean` in `card-stacks.ts`
  - `export function moveIntoStack(stack: HTMLElement, elements: readonly HTMLElement[]): void` in `card-stacks.ts`
  - In `today.ts`: `interface StackCard { id: number; element: HTMLElement }`, and the `Regions` fields `stacks: [HTMLElement, HTMLElement]`, `cards: StackCard[]`, `stackOf: Map<number, Stack>` and `twoStacks: boolean`
  - In `today.ts`: `function arrangeCards(regions: Regions): void`, which is safe to call at any time and does nothing while the stacks are not in the document
  - E2E helpers in `instance-stacks.spec.ts`: `instances`, `issue`, `pinFor`, `stubIssues`, `stubPinStore`, `card`, `rowsOf`, `stackOf`, `isBelow`, `headingOrder`, `openToday`, `WIDE`, `NARROW`

- [ ] **Step 1: Bare declarations.** Append to `web/src/card-stacks.ts`:

```ts
export function showsTwoStacks(grid: HTMLElement): boolean {
  return false;
}

export function moveIntoStack(stack: HTMLElement, elements: readonly HTMLElement[]): void {}
```

- [ ] **Step 2: Write the failing e2e tests.** Create `.claude/e2e/tests/instance-stacks.spec.ts`:

```ts
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * #144: from the 80rem container breakpoint Today's instance cards go into two stacks, each card
 * to the shorter stack in instance order (a tie to the left), and keep their stack on every
 * redraw except Today opening and Refresh. Every row here is one line high, so a card's height
 * follows its row count, and two one-row cards tie exactly.
 */

interface StubIssue {
  key: string;
  summary: string;
  status: string;
  url: string;
}

interface StubGroup {
  id: number;
  name: string;
  issues: StubIssue[];
  error: null;
}

interface StubPin {
  id: number;
  instanceId: number;
  instanceName: string;
  instancePosition: number;
  key: string;
  summary: string;
  status: string;
  url: string;
  error: null;
}

// 1920 leaves the content column well past 80rem beside the rail; 1100 leaves it well short.
const WIDE = { width: 1920, height: 900 };
const NARROW = { width: 1100, height: 900 };
const NAMES = ["Alpha", "Bravo", "Charlie", "Delta"];

function issue(key: string): StubIssue {
  return { key, summary: `Summary of ${key}`, status: "To Do", url: `https://jira.example/browse/${key}` };
}

function nameAt(position: number): string {
  return NAMES[position] ?? `Instance ${position}`;
}

/** One group per argument, in instance order: Alpha holds ALPHA-1…ALPHA-n, Bravo BRAVO-1…, and so on. */
function instances(...rowCounts: number[]): StubGroup[] {
  return rowCounts.map((rows, position) => {
    const name = nameAt(position);

    return {
      id: position + 1,
      name,
      issues: Array.from({ length: rows }, (_, index) => issue(`${name.toUpperCase()}-${index + 1}`)),
      error: null,
    };
  });
}

function pinFor(id: number, position: number, key: string): StubPin {
  return {
    id,
    instanceId: position + 1,
    instanceName: nameAt(position),
    instancePosition: position,
    key,
    summary: `Summary of ${key}`,
    status: "To Do",
    url: `https://jira.example/browse/${key}`,
    error: null,
  };
}

/** Each call to /api/issues takes the next response; the last one repeats. */
async function stubIssues(page: Page, ...responses: StubGroup[][]): Promise<void> {
  let calls = 0;

  await page.route("**/api/issues", async (route) => {
    const groups = responses[Math.min(calls, responses.length - 1)];
    calls += 1;
    await route.fulfill({ status: 200, json: { instances: groups } });
  });
}

/** A pin store answering GET, POST and DELETE the way the server does. */
async function stubPinStore(page: Page, initial: StubPin[]): Promise<void> {
  const pins = [...initial];

  await page.route("**/api/pins**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = request.postDataJSON() as { instanceId: number; issueKey: string };
      const created = pinFor(600 + pins.length, body.instanceId - 1, body.issueKey);
      pins.push(created);
      await route.fulfill({ status: 201, json: created });
      return;
    }
    if (request.method() === "DELETE") {
      const id = Number(new URL(request.url()).pathname.split("/").pop());
      const index = pins.findIndex((pin) => pin.id === id);
      if (index >= 0) pins.splice(index, 1);
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ status: 200, json: pins });
  });
}

// Pins and entries answered empty unless a test says otherwise: the e2e stack shares the dev
// database, and a stray pin or entry would change the card heights these tests compare.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
  await page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 200, json: { today: "2026-09-09", entries: [] } }),
  );
});

const card = (page: Page, name: string): Locator => page.getByRole("region", { name, exact: true });
const rowsOf = (page: Page, name: string): Locator => card(page, name).locator("that-ticket-row");

async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("not laid out");

  return box;
}

/** Which stack a card sits in: the half of the Assigned issues section holding its left edge. */
async function stackOf(page: Page, name: string): Promise<"left" | "right"> {
  const section = await boxOf(page.getByRole("region", { name: "Assigned issues" }));
  const box = await boxOf(card(page, name));

  return box.x < section.x + section.width / 2 ? "left" : "right";
}

async function isBelow(page: Page, upper: string, lower: string): Promise<boolean> {
  const top = await boxOf(card(page, upper));
  const bottom = await boxOf(card(page, lower));

  return bottom.y >= top.y + top.height;
}

/** The instance headings in document order — the order Tab, the arrow keys and a screen reader take. */
function headingOrder(page: Page): Promise<string[]> {
  return page.locator("section[aria-labelledby^='today-instance-'] h3").allTextContents();
}

async function openToday(page: Page, viewport: { width: number; height: number }, ...names: string[]): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto("/today");
  for (const name of names) await expect(card(page, name)).toBeVisible();
}

test("the reported case: an empty card sits under the short card, not under the tall one", async ({ page }) => {
  await stubIssues(page, instances(8, 3, 0));
  await openToday(page, WIDE, "Alpha", "Bravo", "Charlie");

  expect.soft(await stackOf(page, "Alpha")).toBe("left");
  expect.soft(await stackOf(page, "Bravo")).toBe("right");
  expect.soft(await stackOf(page, "Charlie")).toBe("right");
  expect.soft(await isBelow(page, "Bravo", "Charlie")).toBe(true);
});

test("document order follows the stacks: the left stack top to bottom, then the right", async ({ page }) => {
  await stubIssues(page, instances(1, 3, 1));
  await openToday(page, WIDE, "Alpha", "Bravo", "Charlie");

  expect.soft(await stackOf(page, "Charlie")).toBe("left");
  expect.soft(await headingOrder(page)).toEqual(["Alpha", "Charlie", "Bravo"]);

  // Down from Alpha's only row lands in Charlie's, the card under it, not Bravo's beside it.
  await page.getByRole("link", { name: "ALPHA-1", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("link", { name: "CHARLIE-1", exact: true })).toBeFocused();
});

test("below the breakpoint the cards are one column in instance order", async ({ page }) => {
  await stubIssues(page, instances(1, 3, 1));
  await openToday(page, NARROW, "Alpha", "Bravo", "Charlie");

  expect.soft(await headingOrder(page)).toEqual(["Alpha", "Bravo", "Charlie"]);
  expect.soft(await isBelow(page, "Alpha", "Bravo")).toBe(true);
  expect.soft(await isBelow(page, "Bravo", "Charlie")).toBe(true);
  expect.soft(await stackOf(page, "Bravo")).toBe("left");
});

test("cards in both stacks share one key column", async ({ page }) => {
  await stubIssues(page, [
    { id: 1, name: "Alpha", issues: [issue("A-1")], error: null },
    { id: 2, name: "Bravo", issues: [issue("PLATFORM-4821")], error: null },
  ]);
  await openToday(page, WIDE, "Alpha", "Bravo");

  expect.soft(await stackOf(page, "Bravo")).toBe("right");

  const offsets = await page
    .locator("section[aria-labelledby^='today-instance-'] that-table")
    .evaluateAll((tables) =>
      tables.map((table) => {
        const summary = table.querySelector("tbody td.c-sum");
        if (!(summary instanceof HTMLElement)) return null;

        return Math.round(summary.getBoundingClientRect().left - table.getBoundingClientRect().left);
      }),
    );
  expect.soft(new Set(offsets).size).toBe(1);
});
```

- [ ] **Step 3: Run it; see RED.** Run the e2e spec.
Expected: "the reported case…" fails on `Charlie` (`"left"` received). The grid wraps it to the second row, under Alpha. "Document order…" fails on `headingOrder` (`["Alpha","Bravo","Charlie"]` received) and on the ArrowDown focus (BRAVO-1 receives it). "Below the breakpoint…" and "…share one key column" pass. Both are *guards*.

- [ ] **Step 4: The stack helpers.** In `web/src/card-stacks.ts`, replace the two stubs from Step 1 with:

```ts
/** True while the results grid draws two columns. The 80rem container query in its class decides;
 *  this reads the verdict rather than restating the number. */
export function showsTwoStacks(grid: HTMLElement): boolean {
  return getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length === 2;
}

/**
 * Makes `elements` the first children of `stack`, in order, moving each one that is elsewhere.
 * `moveBefore` moves a card without the disconnect a plain insert fires, so no row rebuilds and a
 * focused control keeps focus — that-table's reorder() has the same reasoning, and the same
 * fallback for an engine without it.
 */
export function moveIntoStack(stack: HTMLElement, elements: readonly HTMLElement[]): void {
  elements.forEach((element, index) => {
    const current = stack.children[index] ?? null;
    if (current === element) return;

    if (typeof Element.prototype.moveBefore === "function") {
      stack.moveBefore?.(element, current);
    } else {
      stack.insertBefore(element, current);
    }
  });
}
```

- [ ] **Step 5: Today's state.** In `web/src/views/today.ts`:

After `import { alignKeyColumn } from "../key-column";` add:

```ts
import { moveIntoStack, placeInStacks, showsTwoStacks, type Stack } from "../card-stacks";
```

Above `interface Regions {` add:

```ts
/** An instance card as the stacks hold it: its section, and the instance it shows. */
interface StackCard {
  id: number;
  element: HTMLElement;
}
```

In `Regions`, after `results: HTMLElement;`, add:

```ts
  /** The two column stacks inside `results` that the instance cards go into (#144). Detached
   *  while `results` shows a message instead of cards. */
  stacks: [HTMLElement, HTMLElement];
  /** The instance cards last rendered, in instance position order. */
  cards: StackCard[];
  /** Each instance's stack, kept across every redraw so that none moves a card. Empty when Today
   *  opens, and emptied by Refresh — the only two moments placement starts over. */
  stackOf: Map<number, Stack>;
  /** Whether the cards were last arranged in two stacks, so a resize acts only on a crossing. */
  twoStacks: boolean;
```

- [ ] **Step 6: The results region.** In `render`, replace:

```ts
  const results = document.createElement("div");
  // One card across, two from the point the content column can hold two
  // without taking it out of the summary. Never three: see the design's
  // layout decision 2. The breakpoint is a container query against the region
  // in index.html, not the window, so the rail costs the grid nothing.
  results.className = "grid grid-cols-1 gap-4 @min-[80rem]:grid-cols-2";
  results.append(cardHolding(loadingLine()));
```

with:

```ts
  const results = document.createElement("div");
  // One column of cards, two stacks from the point the content column can
  // hold two without taking it out of the summary. Never three: see the
  // design's layout decision 2. The breakpoint is a container query against
  // the region in index.html, not the window, so the rail costs the grid
  // nothing — and this class is the one place it is written: showsTwoStacks
  // reads the grid's verdict.
  results.className = "grid grid-cols-1 gap-4 @min-[80rem]:grid-cols-2";
  results.append(cardHolding(loadingLine()));
  // Stacks rather than a grid of cards (#144): a grid row is as tall as its
  // tallest card, which left a hole beside a tall card that a short one fitted.
  const stacks: [HTMLElement, HTMLElement] = [cardStack(), cardStack()];
```

In the `regions = { … }` literal, after `results,` add:

```ts
    stacks,
    cards: [],
    stackOf: new Map(),
    twoStacks: false,
```

- [ ] **Step 7: Rendering into the stacks.** In `renderResponse`, replace from `regions.refresh.hidden = false;` through `alignKeyColumn(regions.results);`:

```ts
  regions.refresh.hidden = false;
  regions.results.replaceChildren(
    // The index is the instance's position in created_at order, which is what
    // the hue ramp is keyed off: the store lists instances in that order and
    // the fan-out preserves it. /api/issues carries no position of its own,
    // unlike a pin or a search hit.
    ...response.instances.map((group, position) => instanceSection(group, position, regions.pins)),
  );

  // The results grid, not the whole view: one shared key column across the
  // instance cards, which is what makes them agree with each other, and the
  // property lands on the one element that holds all of them and nothing else.
  // After insertion, not before — an element outside the document has no
  // layout, so every key in it would measure zero.
  alignKeyColumn(regions.results);
```

with:

```ts
  regions.refresh.hidden = false;
  // The index is the instance's position in created_at order, which is what
  // the hue ramp is keyed off: the store lists instances in that order and
  // the fan-out preserves it. /api/issues carries no position of its own,
  // unlike a pin or a search hit.
  regions.cards = response.instances.map((group, position) => ({
    id: group.id,
    element: instanceSection(group, position, regions.pins),
  }));
  const [left, right] = regions.stacks;
  left.replaceChildren(...regions.cards.map((card) => card.element));
  right.replaceChildren();
  regions.results.replaceChildren(left, right);

  // The results grid, not the whole view: one shared key column across the
  // instance cards in both stacks, which is what makes them agree with each
  // other. After insertion, not before — an element outside the document has
  // no layout, so every key in it would measure zero. And before the cards
  // are measured for their stacks, since the key column's width moves where a
  // summary wraps.
  alignKeyColumn(regions.results);
  arrangeCards(regions);
```

(`paintTotals(regions);` and `renderOffListSection(regions);` stay where they are, after it.)

After `renderResponse`, add:

```ts
/**
 * Puts the instance cards into their stacks: one column in instance order below the breakpoint;
 * above it, each card in its remembered stack and every other card in the shorter one (#144).
 * Every card goes into the left stack first — that is the one column, and it is where a card is
 * measured at a column's width before it is placed.
 */
function arrangeCards(regions: Regions): void {
  const [left, right] = regions.stacks;
  if (!left.isConnected) return;

  regions.twoStacks = showsTwoStacks(regions.results);
  moveIntoStack(
    left,
    regions.cards.map((card) => card.element),
  );
  if (!regions.twoStacks) return;

  const gap = Number.parseFloat(getComputedStyle(left).rowGap) || 0;
  regions.stackOf = placeInStacks(
    regions.cards.map((card) => ({ id: card.id, height: card.element.offsetHeight + gap })),
    regions.stackOf,
  );
  moveIntoStack(
    right,
    regions.cards
      .filter((card) => regions.stackOf.get(card.id) === "right")
      .map((card) => card.element),
  );
}
```

After `cardHolding` at the end of the file, add:

```ts
/** One of the two columns the instance cards stack in. Hidden while empty, so one column — or one
 *  instance — leaves no gap for the other. */
function cardStack(): HTMLElement {
  const stack = document.createElement("div");
  stack.className = "flex min-w-0 flex-col gap-4 empty:hidden";

  return stack;
}
```

- [ ] **Step 8: Run them; see GREEN.** Run Prettier on `src/card-stacks.ts` and `src/views/today.ts`, then `make tsc`, `make lint`, `make test-web` and the e2e spec. Then run `today.spec.ts`, `pins.spec.ts`, `table-keys.spec.ts` and `keyboard-audit.spec.ts`, which cover the instance cards, the Pinned / off-list grid and the arrow keys. All must be green. "Instance cards are one across on a narrow screen and two on a wide one" in `today.spec.ts` resizes from narrow to wide and will fail until Task 3. Record that failure as expected here, and note that Task 3 turns it green. No other failure is expected.

- [ ] **Step 9: Mutations.** Run each one, see the named line red, then restore it:
  1. In `placeInStacks`, `<=` becomes `<`. Red: the reported case's `Alpha` line.
  2. Delete the final `moveIntoStack(right, …)` in `arrangeCards`. Red: the reported case's `Bravo`, document order's `headingOrder` and its ArrowDown focus, and key column's `Bravo`.
  3. In `placeInStacks`' second loop, use `const stack: Stack = placement.size % 2 === 0 ? "left" : "right";`. Red: the reported case's `Charlie`.
  4. Pass `….map((card) => card.element).reverse()` to the right-hand `moveIntoStack`. Red: the reported case's `isBelow(Bravo, Charlie)`.
  5. In `placeInStacks`, `heights.left <= heights.right ? "left" : "right"` becomes `heights.left > heights.right ? "left" : "right"`. Red: document order's `Charlie` (received `"right"`).
  6. Delete `if (!regions.twoStacks) return;`. Red: below the breakpoint's `headingOrder` and `isBelow(Bravo, Charlie)`.
  7. Change `results`' class to `grid grid-cols-2 gap-4` (breakpoint dropped). Red: below the breakpoint's `isBelow(Alpha, Bravo)` and `stackOf(Bravo)`.
  8. `alignKeyColumn(regions.results)` becomes `alignKeyColumn(regions.stacks[0])`. Red: key column's `new Set(offsets).size`.

- [ ] **Step 10: Commit.**

```bash
git add web/src/card-stacks.ts web/src/views/today.ts .claude/e2e/tests/instance-stacks.spec.ts
git commit -m "feat(#144): Today lays its instance cards out in two stacks, shortest first

Document order follows the stacks, so focus and reading order match the screen.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DhrQjSkmUmfVxLZHhaYLwQ"
```

---

### Task 3: Crossing the breakpoint switches the layout in place

**Files:**
- Modify: `web/src/views/today.ts` (`render`: a `ResizeObserver` after the `regions` literal)
- Modify: `web/src/components/that-table.ts` (a no-op `connectedMoveCallback`)
- Test: `.claude/e2e/tests/instance-stacks.spec.ts`

**Interfaces:**
- Consumes (Task 2): `arrangeCards(regions)`, `showsTwoStacks(grid)`, `regions.twoStacks`, and the e2e helpers.
- Produces: nothing later tasks consume.

- [ ] **Step 1: Write the failing e2e tests.** Append to `instance-stacks.spec.ts`:

```ts
test("crossing the breakpoint switches between one column and two stacks without a reload", async ({ page }) => {
  await stubIssues(page, instances(1, 3, 1));
  await openToday(page, WIDE, "Alpha", "Bravo", "Charlie");
  await page.evaluate(() => Object.assign(window, { stacksE2eMarker: true }));

  await page.setViewportSize(NARROW);
  await expect.poll(() => headingOrder(page)).toEqual(["Alpha", "Bravo", "Charlie"]);

  await page.setViewportSize(WIDE);
  await expect.poll(() => headingOrder(page)).toEqual(["Alpha", "Charlie", "Bravo"]);
  expect.soft(await page.evaluate(() => "stacksE2eMarker" in window)).toBe(true);
});

test("opened below the breakpoint, the cards are placed shortest first when they first get two stacks", async ({
  page,
}) => {
  await stubIssues(page, instances(3, 1, 1));
  await openToday(page, NARROW, "Alpha", "Bravo", "Charlie");

  await page.setViewportSize(WIDE);
  await expect.poll(() => stackOf(page, "Bravo")).toBe("right");
  expect.soft(await stackOf(page, "Charlie")).toBe("right");
  expect.soft(await isBelow(page, "Bravo", "Charlie")).toBe(true);
});

test("a redraw at one column does not restack the cards when they widen again", async ({ page }) => {
  await stubIssues(page, instances(2, 1, 1), instances(1, 1, 1));
  await openToday(page, WIDE, "Alpha", "Bravo", "Charlie");

  await page.setViewportSize(NARROW);
  await expect.poll(() => stackOf(page, "Bravo")).toBe("left"); // wait
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(rowsOf(page, "Alpha")).toHaveCount(1); // wait

  // Placed afresh, three one-row cards would tie and send Charlie left.
  await page.setViewportSize(WIDE);
  await expect.poll(() => stackOf(page, "Bravo")).toBe("right"); // wait
  expect(await stackOf(page, "Charlie")).toBe("right");
});

test("a focused row keeps its focus when the cards switch between one column and two stacks", async ({ page }) => {
  await stubIssues(page, instances(1, 3, 1));
  await openToday(page, WIDE, "Alpha", "Bravo", "Charlie");
  const link = page.getByRole("link", { name: "BRAVO-2", exact: true });
  await link.focus();

  await page.setViewportSize(NARROW);
  await expect.poll(() => headingOrder(page)).toEqual(["Alpha", "Bravo", "Charlie"]); // wait
  await expect(link).toBeFocused();
});
```

- [ ] **Step 2: Run them; see RED.** Run the e2e spec.
Expected: "crossing the breakpoint…" fails on its first `headingOrder` poll. It receives `["Alpha","Charlie","Bravo"]`, because without a resize hook the stacks only stack vertically. "Opened below the breakpoint…" fails on its `Bravo` poll (`"left"` received; every card is still in the left stack). "A redraw at one column…" fails on its last `Bravo` poll (`"left"` received). "A focused row…" fails on its `headingOrder` poll. Task 2's four tests stay green.

- [ ] **Step 3: Watch the breakpoint.** In `render` in `web/src/views/today.ts`, directly after the closing `};` of the `regions = { … }` literal, add:

```ts
  // A container query fires no event, so the results grid's own column count
  // is watched instead. A frame later: moving cards inside the callback would
  // resize the element it observes and trip ResizeObserver's loop limit.
  const breakpointWatch = new ResizeObserver(() => {
    requestAnimationFrame(() => {
      if (showsTwoStacks(results) !== regions.twoStacks) arrangeCards(regions);
    });
  });
  breakpointWatch.observe(results);
  registerTeardown(() => {
    breakpointWatch.disconnect();
  });
```

- [ ] **Step 4: Let a card move without rebuilding its rows.** In `web/src/components/that-table.ts`, directly after the `disconnectedCallback() { … }` method, add:

```ts
  // Today moves a whole instance card between its two stacks with moveBefore
  // (#144). Without this the move runs disconnectedCallback and
  // connectedCallback, and connectedCallback's replaceChildren would rebuild
  // every row inside — dropping the focus moveBefore exists to keep.
  connectedMoveCallback(): void {}
```

- [ ] **Step 5: Run them; see GREEN.** Run Prettier on `src/views/today.ts` and `src/components/that-table.ts`, then `make tsc`, `make lint`, the e2e spec, and then `today.spec.ts` (its "one across on a narrow screen and two on a wide one" is now green), `table.spec.ts` (that-table's own) and `pins.spec.ts`.

- [ ] **Step 6: Mutations.** Run each one, see the named line red, then restore it:
  1. Delete `breakpointWatch.observe(results);`. Red: crossing's first `headingOrder` poll, and opened-below's `Bravo` poll.
  2. The observer's condition becomes `if (!showsTwoStacks(results) && regions.twoStacks)`, so it only ever goes to one column. Red: crossing's second `headingOrder` poll.
  3. Add `location.reload();` inside the `requestAnimationFrame` callback, after `arrangeCards`. Red: crossing's `stacksE2eMarker` line.
  4. In `placeInStacks`' second loop, `const stack: Stack = placement.size % 2 === 0 ? "left" : "right";`. Red: opened-below's `Charlie`.
  5. Pass `….reverse()` to the right-hand `moveIntoStack`. Red: opened-below's `isBelow(Bravo, Charlie)`.
  6. In `arrangeCards`, `if (!regions.twoStacks) return;` becomes `if (!regions.twoStacks) { regions.stackOf = new Map(); return; }`. Red: one-column redraw's last `Charlie` line.
  7. Delete `that-table`'s `connectedMoveCallback`. Red: the focused row's `toBeFocused`.
  8. In `moveIntoStack`, always take the `insertBefore` branch. Red: the focused row's `toBeFocused`.

- [ ] **Step 7: Commit.**

```bash
git add web/src/views/today.ts web/src/components/that-table.ts .claude/e2e/tests/instance-stacks.spec.ts
git commit -m "feat(#144): crossing the breakpoint moves Today's cards between one column and two stacks

The cards move without a rebuild, so a focused row keeps its focus, and their
stacks are remembered across the crossing.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DhrQjSkmUmfVxLZHhaYLwQ"
```

---

### Task 4: Redraws keep every card in its stack; Refresh places them afresh

**Files:**
- Modify: `web/src/views/today.ts` (the Refresh click handler, `refreshResults`, `refreshEverything`)
- Test: `.claude/e2e/tests/instance-stacks.spec.ts`

**Interfaces:**
- Consumes (Tasks 2–3): `regions.stackOf`, `arrangeCards`, and the e2e helpers.
- Produces: `refreshResults(regions: Regions, options?: { restack?: boolean }): Promise<void>` and `refreshEverything(regions: Regions, options?: { restack?: boolean }): Promise<void>`. Only the Refresh control passes `restack: true`.

Each redraw test below opens on `instances(2, 1, 1)`: Alpha on the left, Bravo and Charlie stacked on the right. Its trigger then shrinks Alpha to one row. Placed afresh, three one-row cards would tie and send Charlie left. A card that keeps its stack leaves Charlie on the right.

- [ ] **Step 1: Write the tests.** Append to `instance-stacks.spec.ts`:

```ts
test("the pins arriving after the issues move no card", async ({ page }) => {
  let releasePins: (() => void) | undefined;
  const pinsHeld = new Promise<void>((resolve) => {
    releasePins = resolve;
  });
  await page.route("**/api/pins**", async (route) => {
    await pinsHeld;
    await route.fulfill({ status: 200, json: [pinFor(501, 0, "ALPHA-2")] });
  });
  await stubIssues(page, instances(2, 1, 1));
  await openToday(page, WIDE, "Alpha", "Bravo", "Charlie");
  expect.soft(await stackOf(page, "Charlie")).toBe("right");

  releasePins?.();
  await expect(rowsOf(page, "Alpha")).toHaveCount(1); // wait
  expect.soft(await stackOf(page, "Charlie")).toBe("right");
});

test("pinning a ticket moves no card", async ({ page }) => {
  await stubPinStore(page, []);
  await stubIssues(page, instances(2, 1, 1));
  await openToday(page, WIDE, "Alpha", "Bravo", "Charlie");

  await page.getByRole("button", { name: "Pin ALPHA-2", exact: true }).click();
  await expect(rowsOf(page, "Alpha")).toHaveCount(1); // wait
  expect(await stackOf(page, "Charlie")).toBe("right");
});

test("unpinning a ticket moves no card", async ({ page }) => {
  await stubPinStore(page, [pinFor(501, 0, "ALPHA-2")]);
  // The issues wait for the pins, so the cards are first placed with ALPHA-2 already in Pinned:
  // three one-row cards, Charlie on the left.
  let releaseIssues: (() => void) | undefined;
  const issuesHeld = new Promise<void>((resolve) => {
    releaseIssues = resolve;
  });
  await page.route("**/api/issues", async (route) => {
    await issuesHeld;
    await route.fulfill({ status: 200, json: { instances: instances(2, 1, 1) } });
  });
  await page.setViewportSize(WIDE);
  await page.goto("/today");
  await expect(page.getByRole("region", { name: "Pinned" }).locator("that-ticket-row")).toHaveCount(1); // wait
  releaseIssues?.();
  await expect(card(page, "Charlie")).toBeVisible(); // wait
  expect.soft(await stackOf(page, "Charlie")).toBe("left");

  // Placed afresh, Alpha's two rows would send Charlie right.
  await page.getByRole("button", { name: "Unpin ALPHA-2", exact: true }).click();
  await expect(rowsOf(page, "Alpha")).toHaveCount(2); // wait
  expect.soft(await stackOf(page, "Charlie")).toBe("left");
});

test("coming back to a stale Today moves no card", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/issues", async (route) => {
    calls += 1;
    if (calls === 1) {
      await route.fulfill({
        status: 200,
        headers: { "X-THAT-Cached-At": new Date().toISOString() },
        json: { instances: instances(2, 1, 1) },
      });
      return;
    }
    await route.fulfill({ status: 200, json: { instances: instances(1, 1, 1) } });
  });
  await openToday(page, WIDE, "Alpha", "Bravo", "Charlie");
  await expect(page.getByText("no connection to the server")).toBeVisible(); // wait

  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  await expect(rowsOf(page, "Alpha")).toHaveCount(1); // wait
  expect(await stackOf(page, "Charlie")).toBe("right");
});

test("the network returning moves no card", async ({ page }) => {
  await stubIssues(page, instances(2, 1, 1), instances(1, 1, 1));
  await openToday(page, WIDE, "Alpha", "Bravo", "Charlie");

  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(rowsOf(page, "Alpha")).toHaveCount(1); // wait
  expect(await stackOf(page, "Charlie")).toBe("right");
});

test("an instance that appears on a redraw goes to the shorter stack", async ({ page }) => {
  // Alpha's eight rows outweigh Bravo and Charlie together, so Delta joins them on the right.
  await stubIssues(page, instances(8, 1, 1), instances(8, 1, 1, 1));
  await openToday(page, WIDE, "Alpha", "Bravo", "Charlie");

  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(card(page, "Delta")).toBeVisible(); // wait
  expect.soft(await stackOf(page, "Delta")).toBe("right");
  expect.soft(await isBelow(page, "Charlie", "Delta")).toBe(true);
});

test("an instance that leaves on a redraw moves no other card", async ({ page }) => {
  // Alpha and Charlie on the left, Bravo alone on the right. Placed afresh without Bravo,
  // Charlie would go right.
  await stubIssues(page, instances(1, 3, 1), instances(1, 3, 1).filter((group) => group.name !== "Bravo"));
  await openToday(page, WIDE, "Alpha", "Bravo", "Charlie");

  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(card(page, "Bravo")).toHaveCount(0); // wait
  expect(await stackOf(page, "Charlie")).toBe("left");
});

test("Refresh places the cards afresh, from the issues it fetched", async ({ page }) => {
  let releaseIssues: (() => void) | undefined;
  const issuesHeld = new Promise<void>((resolve) => {
    releaseIssues = resolve;
  });
  let calls = 0;
  await page.route("**/api/issues", async (route) => {
    calls += 1;
    if (calls > 1) await issuesHeld;
    await route.fulfill({ status: 200, json: { instances: calls > 1 ? instances(1, 1, 1) : instances(2, 1, 1) } });
  });
  // Refresh rereads the pins with ?refresh=1. That answer adds a pin no card holds, so its arrival
  // shows in Pinned and changes no card.
  await page.route("**/api/pins**", async (route) => {
    const refreshed = new URL(route.request().url()).searchParams.get("refresh") === "1";
    await route.fulfill({ status: 200, json: refreshed ? [pinFor(501, 0, "ALPHA-99")] : [] });
  });
  await openToday(page, WIDE, "Alpha", "Bravo", "Charlie");

  await page.getByRole("button", { name: "Refresh" }).click();
  // The pins answer lands first and redraws the cards from the issues already held.
  await expect(page.getByRole("region", { name: "Pinned" }).locator("that-ticket-row")).toHaveCount(1); // wait
  releaseIssues?.();
  await expect(rowsOf(page, "Alpha")).toHaveCount(1); // wait
  expect(await stackOf(page, "Charlie")).toBe("left");
});

test("opening Today again places the cards afresh", async ({ page }) => {
  await stubIssues(page, instances(2, 1, 1), instances(1, 1, 1));
  await openToday(page, WIDE, "Alpha", "Bravo", "Charlie");

  await page.getByRole("link", { name: "Week", exact: true }).click();
  await expect(page).toHaveURL(/\/week$/); // wait
  await page.getByRole("link", { name: "Today", exact: true }).click();
  await expect(rowsOf(page, "Alpha")).toHaveCount(1); // wait
  expect(await stackOf(page, "Charlie")).toBe("left");
});
```

- [ ] **Step 2: Run them; see RED.** Run the e2e spec.
Expected: "Refresh places the cards afresh…" fails on its last line (`"right"` received). Task 2 already remembers every stack and nothing yet empties the memory. Every other test in this step passes. Each one is a *guard*, proven by the mutations in Step 5.

- [ ] **Step 3: Refresh starts placement over.** In `web/src/views/today.ts`:

The Refresh click handler becomes:

```ts
  refresh.addEventListener("click", () => {
    void refreshEverything(regions, { restack: true });
  });
```

`refreshResults`' signature becomes `async function refreshResults(regions: Regions, options?: { restack?: boolean }): Promise<void> {`. In its `try`, between `regions.assignedSettled = true;` and `renderResponse(regions, response);`, add:

```ts
    // Refresh is one of the two moments the cards are placed afresh (#144) —
    // Today opening is the other, with a fresh regions. Here, once the issues
    // are in hand rather than at the press: the pins answer may land first,
    // and its redraw from the old issues must not be what places the cards.
    if (options?.restack) regions.stackOf = new Map();
```

`refreshEverything` becomes:

```ts
async function refreshEverything(regions: Regions, options?: { restack?: boolean }): Promise<void> {
  regions.refresh.setAttribute("disabled", "");
  try {
    // Settled rather than all: a failing pins refresh must not stop the assigned
    // cards updating, and each already renders its own failure.
    await Promise.allSettled([
      refreshResults(regions, options),
      refreshPins(regions, { refresh: true }),
    ]);
  } finally {
    regions.refresh.removeAttribute("disabled");
  }
}
```

`handleOnline` and `handleReturn` still call `refreshEverything(regions)`, with no options. Do not change them.

- [ ] **Step 4: Run them; see GREEN.** Run Prettier on `src/views/today.ts`, then `make tsc`, `make lint`, the e2e spec, and then `today.spec.ts`, `pins.spec.ts` and `tab-return.spec.ts`, which cover Refresh, online and the tab returning.

- [ ] **Step 5: Mutations.** Run each one, see the named line red, then restore it:
  1. Add `regions.stackOf = new Map();` as the first line of `renderResponse`, so every redraw recomputes. Red: the last line of pins-late, pinning, unpinning, stale return, network returning and instance-leaves.
  2. Delete the `if (options?.restack) …` line. Red: Refresh's last line.
  3. Move the clearing to the press: the click handler runs `regions.stackOf = new Map();` before `refreshEverything(regions, { restack: true })`, and the line in `refreshResults` is deleted. Red: Refresh's last line, because the pins answer re-places the cards from the old issues and they stay remembered.
  4. `handleReturn` calls `refreshEverything(regions, { restack: true })`. Red: stale return's last line.
  5. `handleOnline` calls `refreshEverything(regions, { restack: true })`. Red: network returning's last line.
  6. In `placeInStacks`' second loop, `const stack: Stack = "left";`. Red: instance-appears' `Delta`, and the first `Charlie` line of pins-late (received `"left"`).
  7. Pass `….reverse()` to the right-hand `moveIntoStack`. Red: instance-appears' `isBelow(Charlie, Delta)`.
  8. In `placeInStacks`, `<=` becomes `<`. Red: unpinning's first `Charlie` line (the tie goes right).
  9. Hoist the memory out of the view: declare `const rememberedStacks = new Map<number, Stack>();` at module scope, and set `stackOf: rememberedStacks` in the `regions` literal. Red: opening-again's last line.

- [ ] **Step 6: Commit.**

```bash
git add web/src/views/today.ts .claude/e2e/tests/instance-stacks.spec.ts
git commit -m "feat(#144): only opening Today and Refresh place the instance cards afresh

A pin, the pins arriving late, the tab returning and the network returning
redraw the cards without moving one to the other stack.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DhrQjSkmUmfVxLZHhaYLwQ"
```

---

### Task 5: The prototype and Today's layout decision describe the stacks; then the gate

**Files:**
- Modify: `docs/superpowers/prototypes/2026-09-03-app-prototype.html` (`.instgrid` CSS, its markup, and the hue lookup in the script)
- Modify: `docs/superpowers/specs/2026-09-03-today-and-week-design.md` (*Layout* decision 2, the acceptance line)

The prototype is a fragment rendered inside the brainstorming companion's frame. **Do not add a doctype** or any document skeleton to it.

- [ ] **Step 1: The prototype's markup.** Change the markup first, while its line numbers are still those below. Check them first:

```shell
sed -n '430,435p' docs/superpowers/prototypes/2026-09-03-app-prototype.html | cut -c1-90
```

Expected: line 430 is `      <div class="instgrid">`. Line 431 starts `        <div><div class="grouph">` and names Ridgeline. Line 433 starts the same way and names Northwind. Lines 432 and 434 are each card's `tcard` line. Line 435 is `      </div>`. If the numbers differ, find the same five lines and use their numbers. Then:

```shell
sed -i \
  -e '431s|^        <div><div class="grouph">|        <div class="stack"><div class="inst"><div class="grouph">|' \
  -e '433s|^        <div><div class="grouph">|        <div class="stack"><div class="inst"><div class="grouph">|' \
  -e '432s|$|</div>|' \
  -e '434s|$|</div>|' \
  docs/superpowers/prototypes/2026-09-03-app-prototype.html
grep -c 'class="stack"><div class="inst">' docs/superpowers/prototypes/2026-09-03-app-prototype.html   # 2
```

- [ ] **Step 2: The prototype's CSS.** Replace:

```css
  .instgrid { display: grid; grid-template-columns: 1fr; gap: 16px; }
  @container (min-width: 80rem) { .instgrid { grid-template-columns: 1fr 1fr; } }
```

with:

```css
  /* Two stacks from 80rem, never three (#144). Each instance card goes, in
     instance order, to the stack that is shorter at that moment, a tie to the
     left, and keeps it until Today is opened again or refreshed. Below 80rem
     the cards are one column in instance order. A grid row would be as tall as
     its tallest card and leave a hole beside it. With two instances, as here,
     the stacks look like two cells. */
  .instgrid { display: grid; grid-template-columns: 1fr; gap: 16px; }
  .instgrid > .stack { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
  .instgrid > .stack:empty { display: none; }
  @container (min-width: 80rem) { .instgrid { grid-template-columns: 1fr 1fr; } }
```

- [ ] **Step 3: The prototype's hue lookup.** Replace `var g = b.closest('.instgrid > div');` with `var g = b.closest('.inst');`. Then check:

```shell
grep -c "instgrid > div" docs/superpowers/prototypes/2026-09-03-app-prototype.html   # 0
head -c 15 docs/superpowers/prototypes/2026-09-03-app-prototype.html                 # <link rel="sty — no doctype
```

- [ ] **Step 4: Today's layout decision.** In `docs/superpowers/specs/2026-09-03-today-and-week-design.md`, change the header's `**Superseded by:** nothing` line to:

```markdown
**Superseded by:** nothing. *Layout* decision 2 was amended on 2026-10-09 by #144 (two stacks).
```

Replace *Layout* decision 2:

```markdown
2. **Instance cards are one across, and two from `xl`. Never three.** Two instances is the real case;
   a third column would only fill if a third Jira were added, and it would pay for it out of the
   summary.
```

with:

```markdown
2. **Instance cards are one across, and two stacks from `xl`. Never three.** Two instances is the
   real case; a third column would only fill if a third Jira were added, and it would pay for it
   out of the summary. From `xl`, measured against the content column, the cards go into two column
   stacks, not a grid. Each card goes, in instance position order, to the stack that is shorter at
   that moment, and a tie goes left. A grid row is as tall as its tallest card, and with one tall
   card it left a hole beside it that a short card would have filled (#144). A card keeps its stack
   on every redraw: a pin added or removed, the pins arriving late, the tab returning, the network
   returning. Placement is computed again only when Today is opened or Refresh is pressed. An
   instance with no stack yet goes to the shorter one. Document order follows the stacks, the left
   one top to bottom and then the right, so focus and reading order match the screen. Below `xl`
   the cards are one column in instance order. The Pinned / off-list grid above them holds two
   fixed sections, not a list of cards, and stays a grid.
```

In *Acceptance criteria*, replace `- Instance cards are one across below \`xl\` and two above it, never three.` with:

```markdown
- Instance cards are one across below `xl` and in two stacks above it, each to the shorter stack in
  instance order, never three.
```

- [ ] **Step 5: The gate.**

```shell
make verify
make test-e2e
```

Expected: both green, in Firefox and Chromium. If `make test-e2e` fails outside `instance-stacks.spec.ts`, rerun that spec alone once. A second failure is a finding, not a flake: report it. Paste the last lines of both outputs into the report.

- [ ] **Step 6: Commit.**

```bash
git add docs/superpowers/prototypes/2026-09-03-app-prototype.html docs/superpowers/specs/2026-09-03-today-and-week-design.md
git commit -m "docs(#144): the prototype and Today's layout decision draw two stacks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DhrQjSkmUmfVxLZHhaYLwQ"
```

The controller takes light and dark screenshots of Today with uneven cards after this plan and uploads them with `.claude/tools/pr-attach.sh`. Nothing in this plan captures or commits them.

---

## Acceptance criteria → tests

| Criterion (#144) | Task | Test(s) |
|---|---|---|
| From 80rem, two stacks in instance order, each card to the shorter stack, a tie left | 1, 2 | unit `placeInStacks` (all cases); e2e "the reported case…", "document order…" |
| The reported case: C under B, in the right stack | 1, 2 | unit "the reported case…"; e2e "the reported case…" |
| Below the breakpoint, one column in instance order | 2 | e2e "below the breakpoint…" |
| Placement computed on opening Today and on Refresh, on no other redraw | 4 | e2e "Refresh places the cards afresh…", "opening Today again…", and the redraw tests below |
| A pin added or removed, pins arriving late, the tab returning and the network returning move no card | 4 | e2e "the pins arriving after the issues…", "pinning…", "unpinning…", "coming back to a stale Today…", "the network returning…" |
| An instance with no remembered stack goes to the shorter stack on the redraw it appears in | 1, 3, 4 | unit "a new card goes to…", "a new last card…"; e2e "an instance that appears…", "opened below the breakpoint…" |
| Crossing 80rem while Today is open switches layouts without a reload | 3 | e2e "crossing the breakpoint…", "a focused row keeps its focus…" |
| Document order follows the stacks (Tab, arrow keys, screen readers) | 2 | e2e "document order…" (heading order and ArrowDown) |
| The two stacks share one key column width | 2 | e2e "cards in both stacks share one key column" |
| The Pinned / off-list grid is unchanged | 2 | no line touches `layoutGrid`; `today.spec.ts` off-list tests rerun in Task 2 Step 8 |
| The prototype's Today and the layout description show two stacks | 5 | review of Steps 1–4 (ruling 8 names the document) |
| A table-driven placement test that a plausible refactor would fail, including the tie and remembered cases | 1 | unit `placeInStacks` with mutations 1–7 |
| An e2e test with uneven card heights passes in Firefox and Chromium | 2–5 | `instance-stacks.spec.ts` under `make test-e2e` |
| Light and dark screenshots on the PR | — | controller, after Task 5 |
