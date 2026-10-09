import { test } from "node:test";
import assert from "node:assert/strict";

import { PUSH_MARKS, countsInTotals, knownPushState, type MarkedPushState } from "./push-marks.ts";

test("every state carries its own words, unchanged from before the merge", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(PUSH_MARKS).map(([state, mark]) => [state, mark.words])),
    {
      unpushed: "not pushed",
      dirty: "edited since it was pushed",
      failed: "push failed",
      pushed: "pushed",
      deleted: "deleted at next push",
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
  assert.equal(knownPushState("deleted"), "deleted");
});

test("deleted is dirty's ring with a slash, drawn on the 9 box the design session drew", () => {
  const mark = PUSH_MARKS.deleted;
  assert.equal(mark.tone, PUSH_MARKS.dirty.tone, "a pending delete wears dirty's hue");
  assert.ok(mark.shape.split(" ").includes("size-[9px]"), "the slashed ring is not 9px");
  assert.match(mark.markup, /viewBox="0 0 9 9"/);
  assert.match(
    mark.markup,
    /<circle cx="4\.5" cy="4\.5" r="3\.75" fill="none" stroke="currentColor" stroke-width="1\.5"\/>/,
  );
  assert.match(
    mark.markup,
    /<path d="M2\.15 6\.85 6\.85 2\.15" stroke="currentColor" stroke-width="1\.5" stroke-linecap="round"\/>/,
  );
  assert.match(mark.markup, /aria-hidden="true"/);
});

test("a pending delete counts in no total, and every other state does", () => {
  for (const state of ["unpushed", "pushed", "dirty"] as const) {
    assert.equal(countsInTotals({ pushState: state }), true, state);
  }
  assert.equal(countsInTotals({ pushState: "deleted" }), false);
});
