# One definition of the push-state marks (#106) Implementation Plan

**Date:** 2026-09-23
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every push-state mark — shape, tone, size, words — is defined once, in
`web/src/push-marks.ts`, typed over the union of push states, and both Week's grid and the entries
dialog read it.

**Architecture:** `push-marks.ts` exports `PUSH_MARKS`, a table that `satisfies
Record<MarkedPushState, PushMark>`, where `MarkedPushState` is `Entry["pushState"] | "failed"`. A
state added to `Entry["pushState"]` therefore fails `tsc` until it has a mark — that is the test
the ticket asks for. Every shape draws in `currentColor` and the mark's `tone` supplies the colour,
so a colour is named once. A single guard, `knownPushState`, maps a state this build does not know
(it crosses the network, typed only at compile time) to `unpushed` — the dialog's existing safe
direction, now shared by the grid, which used to call such a state "pushed". Consumers still choose
what they draw: the grid draws nothing for `pushed`, the dialog draws its `success` icon.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Tailwind v4 utilities, `node --test`
with happy-dom.

**Spec:** Codeberg issue #106 (refined 2026-09-23) and the prototype
`docs/superpowers/prototypes/2026-09-03-app-prototype.html` lines 225–230 (`.m-unpushed`,
`.m-dirty`, `.m-failed`, `.dmark`).

## Global Constraints

- Docker only: run tests through `make` / `docker compose`, never bare `node`/`npm`/`go`.
- No `any`, `as any` or non-null assertions; do not weaken `tsconfig.json`.
- Disc and ring are 7px (`size-[7px]`) everywhere; the failed triangle stays 9×8
  (`border-x-[4.5px] border-b-[8px]`).
- Words, verbatim: `not pushed`, `edited since it was pushed`, `push failed`, `pushed`.
- Tones: `text-pending`, `text-dirty`, `text-failed`, `text-running`.
- `MARKERS`, `PUSH_STATES` and `UNPUSHED` no longer exist anywhere in `web/src`; no lookup into
  `PUSH_MARKS` uses a `??` fallback.
- Push state is derived server-side; nothing here changes how it is derived.

---

### Task 1: `push-marks.ts` and both consumers

**Files:**
- Create: `web/src/push-marks.ts`
- Create: `web/src/push-marks.test.ts`
- Modify: `web/src/week-grid.ts` (the `MARKERS` block, `markerFor`, `pushWords`, and the two places
  that build a mark span, in `ticketCell` and `dayTotal`)
- Modify: `web/src/week-grid.test.ts` (the class assertions on markers)
- Modify: `web/src/components/that-entry-dialog.ts` (`PushMarkStyle`, `UNPUSHED`, `PUSH_STATES`,
  `pushMark`)

**Interfaces:**
- Produces: `export type MarkedPushState = Entry["pushState"] | "failed"`;
  `export interface PushMark { words: string; tone: string; shape?: string; icon?: "success" }`;
  `export const PUSH_MARKS`; `export function knownPushState<S extends MarkedPushState>(state: S): S | "unpushed"`.

- [ ] **Step 1: Write the failing tests**

`web/src/push-marks.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { PUSH_MARKS, knownPushState, type MarkedPushState } from "./push-marks.ts";

test("every state carries its own words, unchanged from before the merge", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(PUSH_MARKS).map(([state, mark]) => [state, mark.words])),
    {
      unpushed: "not pushed",
      dirty: "edited since it was pushed",
      failed: "push failed",
      pushed: "pushed",
    },
  );
});

test("the disc and the ring are 7px, as the prototype draws them", () => {
  for (const state of ["unpushed", "dirty"] as const) {
    assert.ok(PUSH_MARKS[state].shape.split(" ").includes("size-[7px]"), `${state} is not 7px`);
  }
});

test("a state this build does not know reads as not pushed, never as pushed", () => {
  // Crosses the network typed only at compile time: a cached shell against a
  // newer server can hand over a state the union does not name.
  const stranger = "archived" as string as MarkedPushState;
  assert.equal(knownPushState(stranger), "unpushed");
  assert.equal(knownPushState("dirty"), "dirty");
  assert.equal(knownPushState("failed"), "failed");
});
```

In `web/src/week-grid.test.ts`, the marker assertions move from colour classes to the 7px size plus
the tone, because the colour now arrives through `currentColor`:

- In `"each push state draws its own marker, and pushed draws none"`, change the `cases` markers:
  `{ state: "unpushed", marker: "text-pending", ... }` and `{ state: "dirty", marker: "text-dirty", ... }`,
  and inside the non-null branch add, after the existing `assert.ok`:

  ```ts
  assert.ok(mark?.classList.contains("size-[7px]"), `${String(state)} marker is not 7px`);
  ```

- In `"a failed push marks its own cell and day, outranking the rollup's state"`, change
  `"border-b-failed"` to `"text-failed"` and the second `"bg-pending"` to `"text-pending"`.

- In `"a day total wears its day's marker, named for a reader who cannot see it"`, add:

  ```ts
  assert.ok(
    monday?.querySelector("span[aria-hidden='true']")?.classList.contains("size-[7px]"),
    "day total's marker is not 7px",
  );
  ```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose run --rm --no-deps web node --test src/push-marks.test.ts src/week-grid.test.ts`
Expected: `push-marks.test.ts` fails to load (module not found); the grid's marker assertions fail on
`text-pending` / `size-[7px]`.

- [ ] **Step 3: Write `web/src/push-marks.ts`**

```ts
import type { Entry } from "./types.ts";

/**
 * Every state a push mark speaks for: an entry's own, plus `failed`, which
 * comes off a push response rather than the entry. Because PUSH_MARKS is
 * checked against this union, a state added to `Entry["pushState"]` fails to
 * compile until it has a mark.
 */
export type MarkedPushState = Entry["pushState"] | "failed";

export interface PushMark {
  /** What a reader who cannot see the mark hears, and what the popover says. */
  words: string;
  /** The colour. Every shape draws in `currentColor`, so it is named once. */
  tone: string;
  /** A drawn silhouette: disc, ring, triangle — one each, so no two states
   *  are told apart by hue alone. */
  shape?: string;
  /** Or a real icon, for the one state only a roomy consumer draws. */
  icon?: "success";
}

/**
 * The words are the same in every place a mark shows, because a state that is
 * "not pushed" in one view and something else in another is two states to a
 * reader. Disc and ring are 7px, as the prototype draws them; the triangle is
 * 9×8 — grown from 6×5, which read as a smudge rather than a triangle — drawn
 * out of borders so its size is the layout's rather than the font's.
 */
export const PUSH_MARKS = {
  unpushed: {
    words: "not pushed",
    tone: "text-pending",
    shape: "size-[7px] rounded-full bg-current",
  },
  dirty: {
    words: "edited since it was pushed",
    tone: "text-dirty",
    shape: "size-[7px] rounded-full border-[1.5px] border-current",
  },
  failed: {
    words: "push failed",
    tone: "text-failed",
    shape: "size-0 border-x-[4.5px] border-b-[8px] border-x-transparent border-b-current",
  },
  pushed: {
    words: "pushed",
    tone: "text-running",
    icon: "success",
  },
} satisfies Record<MarkedPushState, PushMark>;

/**
 * pushState crosses the network and is only typed at compile time, so a state
 * this build does not know (a cached shell against a newer server) has to
 * resolve to something. "Not pushed" is the safe direction: telling someone
 * their time reached Jira when it did not is the one wrong answer that is
 * indistinguishable from a true one.
 */
export function knownPushState<S extends MarkedPushState>(state: S): S | "unpushed" {
  return Object.hasOwn(PUSH_MARKS, state) ? state : "unpushed";
}
```

If `tsc` widens `icon: "success"` to `string` despite `satisfies`, write it as `icon: "success" as const`.

- [ ] **Step 4: Rewire `web/src/week-grid.ts`**

Add `import { PUSH_MARKS, knownPushState } from "./push-marks.ts";`. Delete the `MARKERS` constant
and its doc comment, keeping the two paragraphs that are about the grid (no legend, so the words
reach the reader through the title; amber and red never rest on colour alone) on `markerFor`.
Replace `markerFor` and `pushWords` with:

```ts
/** The mark a cell or day draws, or undefined for `pushed` — the ordinary
 *  state a grid this dense has no business decorating. `failed` outranks
 *  whatever the rollup said, because it is newer than the rollup: it comes
 *  off the push that just happened, and a re-read reports those entries as
 *  unpushed again — true, but not the thing the reader needs in the seconds
 *  after Push. */
function markerFor(pushState: PushState, failed: boolean): { className: string; words: string } | undefined {
  const state = knownPushState(failed ? "failed" : (pushState ?? "pushed"));
  if (state === "pushed") return undefined;
  const mark = PUSH_MARKS[state];

  return { className: `${mark.tone} ${mark.shape}`, words: mark.words };
}

/** Every state's own words, `pushed` included: it draws no marker, but a
 *  cell's popover still has to name it. */
function pushWords(pushState: PushState, failed: boolean): string {
  return PUSH_MARKS[knownPushState(failed ? "failed" : (pushState ?? "pushed"))].words;
}
```

The two call sites in `ticketCell` and `dayTotal` keep using `marker.className` and `marker.words`
unchanged. (`PUSH_MARKS[state]` after excluding `"pushed"` is a union whose members all have
`shape: string`, so no fallback is needed; if `tsc` disagrees, stop and report rather than adding one.)

- [ ] **Step 5: Rewire `web/src/components/that-entry-dialog.ts`**

Add `import { PUSH_MARKS, knownPushState } from "../push-marks";` (this file imports without the
`.ts` extension). Delete `PushMarkStyle`, `UNPUSHED` and `PUSH_STATES` with their doc comments, but
move the paragraph beginning "`unpushed` draws a mark rather than nothing" onto `pushMark`'s doc
comment, since it is the dialog's own choice. In `pushMark`, replace

```ts
const state = PUSH_STATES[entry.pushState] ?? UNPUSHED;
```

with

```ts
const state: PushMark = PUSH_MARKS[knownPushState(entry.pushState)];
```

importing `type PushMark` too. The rest of `pushMark` stays as it is: the holder wears
`state.tone`, draws `iconMarkup(state.icon, 15)` when there is an icon, else a span with
`state.shape`.

- [ ] **Step 6: Run the tests and the type check**

Run: `docker compose run --rm --no-deps web node --test src/push-marks.test.ts src/week-grid.test.ts`
Expected: all pass.

Run: `make tsc && make lint`
Expected: clean.

Run: `grep -rn "MARKERS\|PUSH_STATES\|UNPUSHED\|size-1.5 rounded-full" web/src`
Expected: no output.

Prove the compile-time test: temporarily add `| "queued"` to `Entry["pushState"]` in
`web/src/types.ts`, run `make tsc`, and paste the error naming `PUSH_MARKS` into the report; then
revert that line.

- [ ] **Step 7: Format and commit**

Run: `make fmt`, then `git checkout` any file it changed that this task did not otherwise touch.

```bash
git add web/src/push-marks.ts web/src/push-marks.test.ts web/src/week-grid.ts web/src/week-grid.test.ts web/src/components/that-entry-dialog.ts
git commit -m "Push-state marks are defined once, in push-marks.ts (#106)"
```
