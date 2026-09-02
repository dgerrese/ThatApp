/**
 * These rules live in `duration.ts` rather than beside the component because a
 * `node:test` file cannot import `components/that-duration.ts`: node has no
 * `HTMLElement`, so the class declaration throws at module evaluation. Keeping
 * the rule DOM-free is what makes it testable at all.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  exactSecondsFromTyped,
  fieldFigure,
  secondsFromTyped,
  steppedSeconds,
} from "./duration.ts";

/** A refusal reads as one, rather than as the literal `null` the table holds. */
function caseName(typed: string, want: number | null): string {
  return want === null
    ? `${JSON.stringify(typed)} is refused`
    : `${JSON.stringify(typed)} is ${want} seconds`;
}

/**
 * The table in the design is the specification, reproduced here in the units
 * the control actually commits. A refusal means the field reverts to what it
 * held before rather than committing something the user did not mean.
 */
test("the parse rule follows the design's table", async (t) => {
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
    await t.test(caseName(typed, want), () => {
      const got = secondsFromTyped(typed);
      assert.equal(got, want);
    });
  }
});

/**
 * The clause a later reader will "simplify" away. Rounding to nearest gives
 * zero for anything under seven and a half minutes, and a control that
 * swallows what you typed reads as broken — so any non-zero input keeps at
 * least one step. Only a typed zero reaches zero.
 */
test("any non-zero input keeps at least one step", async (t) => {
  const cases: [string, number][] = [
    ["1", 900],
    ["5", 900],
    ["7", 900],
    ["0007", 900],
    ["0", 0],
    ["0000", 0],
  ];

  for (const [typed, want] of cases) {
    await t.test(caseName(typed, want), () => {
      const got = secondsFromTyped(typed);
      assert.equal(got, want);
    });
  }
});

test("everything else rounds to the nearest quarter hour", async (t) => {
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
    await t.test(caseName(typed, want), () => {
      const got = secondsFromTyped(typed);
      assert.equal(got, want);
    });
  }
});

/**
 * A typed colon is structure, not noise: what follows it is minutes however
 * many digits either side carries. Stripping it first read "1:5" as 15 minutes
 * — an hour typed and a quarter of it logged.
 */
test("a colon splits hours from minutes even unpadded", async (t) => {
  const cases: [string, string, number | null][] = [
    ["1h05m, rounded down to the hour by the grid", "1:5", 3600],
    ["minutes past sixty still carry into hours", "1:75", 8100],
    ["a bare hour", "2:", 7200],
    ["bare minutes", ":45", 2700],
    ["a day exactly", "24:00", 86400],
    ["past a day is refused in this spelling too", "24:01", null],
  ];

  for (const [name, typed, want] of cases) {
    await t.test(name, () => {
      const got = secondsFromTyped(typed);
      assert.equal(got, want);
    });
  }
});

/**
 * What stepping starts from: the typed figure before the snap, so the first
 * press of + from a typed 7 lands on 0:15 rather than snapping to 0:15 first
 * and stepping clean past it.
 */
test("the exact reading carries no snap", async (t) => {
  const cases: [string, number | null][] = [
    ["7", 420],
    ["1:5", 3900],
    ["0", 0],
    ["abc", null],
    ["12345", null],
  ];

  for (const [typed, want] of cases) {
    await t.test(caseName(typed, want), () => {
      const got = exactSecondsFromTyped(typed);
      assert.equal(got, want);
    });
  }
});

/**
 * Minutes are the last two digits whatever precedes them, so a minute count of
 * 60 or more carries into hours rather than being refused.
 */
test("minutes of sixty or more carry into hours", async (t) => {
  const cases: [string, string, number][] = [
    ["1h75m is 2h15m", "175", 8100],
    ["1h99m is 2h39m, rounded to 2h45m", "199", 9900],
    ["0h99m is 1h39m, rounded to 1h45m", "099", 6300],
  ];

  for (const [name, typed, want] of cases) {
    await t.test(name, () => {
      const got = secondsFromTyped(typed);
      assert.equal(got, want);
    });
  }
});

/**
 * Twenty-four hours exactly is allowed; past it is refused. The bound is the
 * raw typed figure, not the rounded one — someone who types 24h01m is telling
 * the control something it should reject rather than quietly round back.
 */
test("a day is the ceiling", async (t) => {
  const cases: [string, string, number | null][] = [
    ["exactly a day commits", "2400", 86400],
    ["23h59m rounds up to the ceiling", "2359", 86400],
    ["past a day is refused", "2401", null],
    ["well past a day is refused", "9999", null],
  ];

  for (const [name, typed, want] of cases) {
    await t.test(name, () => {
      const got = secondsFromTyped(typed);
      assert.equal(got, want);
    });
  }
});

test("input carrying no digits is refused", async (t) => {
  const cases: string[] = ["", "   ", ":", "abc", "-"];

  for (const typed of cases) {
    await t.test(caseName(typed, null), () => {
      const got = secondsFromTyped(typed);
      assert.equal(got, null);
    });
  }
});

/**
 * More than four digits is refused rather than truncated: 12345 could mean
 * 123h45m or a slipped keystroke, and guessing between them is how a control
 * commits something nobody typed.
 */
test("more than four digits is refused", async (t) => {
  const cases: string[] = ["12345", "000000", "1:23:45"];

  for (const typed of cases) {
    await t.test(caseName(typed, null), () => {
      const got = secondsFromTyped(typed);
      assert.equal(got, null);
    });
  }
});

/**
 * What the field shows after a commit. Hours are unpadded and minutes always
 * padded — `H:MM`, which is the editable shape, distinct from the `Nh Nm` a
 * total is required to wear.
 */
test("the field reformats to H:MM", async (t) => {
  const cases: [number, string][] = [
    [0, "0:00"],
    [900, "0:15"],
    [10800, "3:00"],
    [29700, "8:15"],
    [39600, "11:00"],
    [86400, "24:00"],
  ];

  for (const [seconds, want] of cases) {
    await t.test(`${seconds} seconds shows as ${want}`, () => {
      const got = fieldFigure(seconds);
      assert.equal(got, want);
    });
  }
});

/**
 * The round trip is what the e2e spec asserts against the posted payload, so
 * it is worth pinning here where the failure is legible.
 */
test("typing a figure and reading it back gives the same figure", async (t) => {
  const cases: string[] = ["0:00", "0:15", "3:00", "8:15", "11:00", "24:00"];

  for (const typed of cases) {
    await t.test(`${JSON.stringify(typed)} survives the round trip`, () => {
      const seconds = secondsFromTyped(typed);
      assert.notEqual(seconds, null, `${JSON.stringify(typed)} was refused`);

      const got = fieldFigure(seconds ?? -1);
      assert.equal(got, typed);
    });
  }
});

/**
 * Stepping lands on the grid rather than adding a fixed 900 to whatever it
 * finds. That is the same for every figure this ticket can produce, and it is
 * what keeps the control honest once #8's timer hands it a run of 7m13s: the
 * first press up should reach 0h 15m, not 0h 22m.
 */
test("stepping moves to the next quarter hour, not by one", async (t) => {
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
    await t.test(`${seconds} stepped ${direction === 1 ? "up" : "down"} is ${want}`, () => {
      const got = steppedSeconds(seconds, direction);
      assert.equal(got, want);
    });
  }
});

test("stepping stops at zero and at a day", async (t) => {
  const cases: [string, number, 1 | -1, number][] = [
    ["down from zero stays at zero", 0, -1, 0],
    ["up from a day stays at a day", 86400, 1, 86400],
    ["the last step up reaches the ceiling", 85500, 1, 86400],
  ];

  for (const [name, seconds, direction, want] of cases) {
    await t.test(name, () => {
      const got = steppedSeconds(seconds, direction);
      assert.equal(got, want);
    });
  }
});
