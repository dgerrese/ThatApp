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
