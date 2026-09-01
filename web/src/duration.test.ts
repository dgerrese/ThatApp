/**
 * RUDIMENTARY, AND KNOWN TO BE — the same shape and the same caveats as
 * `format.test.ts` beside it. #51 owns the frontend test gate; this is not
 * wired into `make verify`.
 *
 * Run it with: make test-web
 *
 * It lives here rather than beside the component because a `node:test` file
 * cannot import `components/that-duration.ts`: node has no `HTMLElement`, so the
 * class declaration throws at module evaluation. Keeping the rule DOM-free is
 * what makes it testable at all.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  exactSecondsFromTyped,
  fieldFigure,
  secondsFromTyped,
  steppedSeconds,
} from "./duration.ts";

/**
 * The table in the design is the specification, reproduced here in the units
 * the control actually commits. `null` is a refusal: the field reverts to what
 * it held before rather than committing something the user did not mean.
 */
test("the parse rule follows the design's table", () => {
  const cases: [string, number | null][] = [
    ["300", 10800],
    ["1100", 39600],
    ["45", 2700],
    ["7", 900],
    ["130", 5400],
    ["175", 8100],
    ["8:15", 29700],
    ["0", 0],
    ["12345", null],
    ["2500", null],
  ];

  for (const [typed, want] of cases) {
    assert.equal(secondsFromTyped(typed), want, `secondsFromTyped(${JSON.stringify(typed)})`);
  }
});

/**
 * The clause a later reader will "simplify" away. Rounding to nearest gives
 * zero for anything under seven and a half minutes, and a control that
 * swallows what you typed reads as broken — so any non-zero input keeps at
 * least one step. Only a typed zero reaches zero.
 */
test("any non-zero input keeps at least one step", () => {
  for (const typed of ["1", "5", "7", "0007"]) {
    assert.equal(secondsFromTyped(typed), 900, `secondsFromTyped(${JSON.stringify(typed)})`);
  }

  assert.equal(secondsFromTyped("0"), 0, "a typed zero is the only way to reach zero");
  assert.equal(secondsFromTyped("0000"), 0, "a padded zero is still zero");
});

test("everything else rounds to the nearest quarter hour", () => {
  const cases: [string, number][] = [
    ["8", 900],
    ["22", 900],
    ["23", 1800],
    ["37", 1800],
    ["38", 2700],
    ["100", 3600],
    ["107", 3600],
    ["108", 4500],
  ];

  for (const [typed, want] of cases) {
    assert.equal(secondsFromTyped(typed), want, `secondsFromTyped(${JSON.stringify(typed)})`);
  }
});

/**
 * A typed colon is structure, not noise: what follows it is minutes however
 * many digits either side carries. Stripping it first read "1:5" as 15 minutes
 * — an hour typed and a quarter of it logged.
 */
test("a colon splits hours from minutes even unpadded", () => {
  const cases: [string, number | null][] = [
    ["1:5", 3600], // 1h05m, rounded down to the hour by the grid
    ["1:75", 8100], // minutes past sixty still carry into hours
    ["2:", 7200], // a bare hour
    [":45", 2700], // bare minutes
    ["24:00", 86400],
    ["24:01", null], // past a day is refused in this spelling too
  ];

  for (const [typed, want] of cases) {
    assert.equal(secondsFromTyped(typed), want, `secondsFromTyped(${JSON.stringify(typed)})`);
  }
});

/**
 * What stepping starts from: the typed figure before the snap, so the first
 * press of + from a typed 7 lands on 0:15 rather than snapping to 0:15 first
 * and stepping clean past it.
 */
test("the exact reading carries no snap", () => {
  const cases: [string, number | null][] = [
    ["7", 420],
    ["1:5", 3900],
    ["0", 0],
    ["abc", null],
    ["12345", null],
  ];

  for (const [typed, want] of cases) {
    assert.equal(exactSecondsFromTyped(typed), want, `exactSecondsFromTyped(${JSON.stringify(typed)})`);
  }
});

/**
 * Minutes are the last two digits whatever precedes them, so a minute count of
 * 60 or more carries into hours rather than being refused.
 */
test("minutes of sixty or more carry into hours", () => {
  assert.equal(secondsFromTyped("175"), 8100, "1h75m is 2h15m");
  assert.equal(secondsFromTyped("199"), 9900, "1h99m is 2h39m, rounded to 2h45m");
  assert.equal(secondsFromTyped("099"), 6300, "0h99m is 1h39m, rounded to 1h45m");
});

/**
 * Twenty-four hours exactly is allowed; past it is refused. The bound is the
 * raw typed figure, not the rounded one — someone who types 24h01m is telling
 * the control something it should reject rather than quietly round back.
 */
test("a day is the ceiling", () => {
  assert.equal(secondsFromTyped("2400"), 86400, "exactly a day commits");
  assert.equal(secondsFromTyped("2359"), 86400, "23h59m rounds up to the ceiling");
  assert.equal(secondsFromTyped("2401"), null, "past a day is refused");
  assert.equal(secondsFromTyped("9999"), null, "well past a day is refused");
});

test("input carrying no digits is refused", () => {
  for (const typed of ["", "   ", ":", "abc", "-"]) {
    assert.equal(secondsFromTyped(typed), null, `secondsFromTyped(${JSON.stringify(typed)})`);
  }
});

/**
 * More than four digits is refused rather than truncated: 12345 could mean
 * 123h45m or a slipped keystroke, and guessing between them is how a control
 * commits something nobody typed.
 */
test("more than four digits is refused", () => {
  for (const typed of ["12345", "000000", "1:23:45"]) {
    assert.equal(secondsFromTyped(typed), null, `secondsFromTyped(${JSON.stringify(typed)})`);
  }
});

/**
 * What the field shows after a commit. Hours are unpadded and minutes always
 * padded — `H:MM`, which is the editable shape, distinct from the `Nh Nm` a
 * total is required to wear.
 */
test("the field reformats to H:MM", () => {
  const cases: [number, string][] = [
    [0, "0:00"],
    [900, "0:15"],
    [10800, "3:00"],
    [29700, "8:15"],
    [39600, "11:00"],
    [86400, "24:00"],
  ];

  for (const [seconds, want] of cases) {
    assert.equal(fieldFigure(seconds), want, `fieldFigure(${seconds})`);
  }
});

/**
 * The round trip is what the e2e spec asserts against the posted payload, so
 * it is worth pinning here where the failure is legible.
 */
test("typing a figure and reading it back gives the same figure", () => {
  for (const typed of ["0:00", "0:15", "3:00", "8:15", "11:00", "24:00"]) {
    const seconds = secondsFromTyped(typed);
    assert.notEqual(seconds, null, `secondsFromTyped(${JSON.stringify(typed)}) was refused`);
    assert.equal(fieldFigure(seconds ?? -1), typed, `round trip of ${JSON.stringify(typed)}`);
  }
});

/**
 * Stepping lands on the grid rather than adding a fixed 900 to whatever it
 * finds. That is the same for every figure this ticket can produce, and it is
 * what keeps the control honest once #8's timer hands it a run of 7m13s: the
 * first press up should reach 0h 15m, not 0h 22m.
 */
test("stepping moves to the next quarter hour, not by one", () => {
  const cases: [number, 1 | -1, number][] = [
    [0, 1, 900],
    [900, 1, 1800],
    [900, -1, 0],
    [10800, -1, 9900],
    [433, 1, 900],
    [433, -1, 0],
    [901, 1, 1800],
    [899, -1, 0],
  ];

  for (const [seconds, direction, want] of cases) {
    assert.equal(
      steppedSeconds(seconds, direction),
      want,
      `steppedSeconds(${seconds}, ${direction})`,
    );
  }
});

test("stepping stops at zero and at a day", () => {
  assert.equal(steppedSeconds(0, -1), 0, "down from zero stays at zero");
  assert.equal(steppedSeconds(86400, 1), 86400, "up from a day stays at a day");
  assert.equal(steppedSeconds(85500, 1), 86400, "the last step up reaches the ceiling");
});
