/**
 * RUDIMENTARY, AND KNOWN TO BE. #51 owns the frontend test runner properly:
 * where the gate lives, what the conventions are, and bringing this file into
 * them. It is not wired into `make verify`, because choosing that gate is #51's
 * decision rather than a side effect of #44.
 *
 * It exists anyway because the format rule is the one thing here that tickets
 * 7 to 11 all depend on and that no other gate would catch eroding.
 *
 * Run it with: make test-web
 *
 * It is excluded from tsconfig's `include`, so tsc does not type-check this
 * file. That is not a loosening of strict mode — nothing checked got weaker —
 * but it is a real gap, and it is here because the alternatives both belong to
 * #51: node's ESM resolver requires the `.ts` extension below, which tsc
 * rejects without `allowImportingTsExtensions`, and `node:test` has no types
 * without adding `@types/node`. Picking either is #51's call, not a side effect
 * of a design ticket.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { clockTime, timerFigure, totalFigure } from "./format.ts";

test("a timer is always HH:MM", () => {
  const cases: [number, string][] = [
    [0, "00:00"],
    [59, "00:00"],
    [60, "00:01"],
    [9000, "02:30"],
    [36000, "10:00"],
    [-1, "00:00"],
  ];

  for (const [seconds, want] of cases) {
    assert.equal(timerFigure(seconds), want, `timerFigure(${seconds})`);
  }
});

test("a total is always Nh Nm", () => {
  const cases: [number, string][] = [
    [0, "0h 00m"],
    [2700, "0h 45m"],
    [3600, "1h 00m"],
    [18900, "5h 15m"],
    [36000, "10h 00m"],
    [-1, "0h 00m"],
  ];

  for (const [seconds, want] of cases) {
    assert.equal(totalFigure(seconds), want, `totalFigure(${seconds})`);
  }
});

/**
 * The rule that matters: a colon is the mark of something you can start and
 * stop. A total growing one would tell the reader a control exists where none
 * does, which is the failure this whole convention is built to prevent.
 */
test("a total never carries a colon", () => {
  for (const seconds of [0, 59, 60, 3599, 3600, 18900, 359999]) {
    assert.ok(!totalFigure(seconds).includes(":"), `totalFigure(${seconds}) grew a colon`);
  }
});

test("a clock time is always zero-padded HH:MM, local to the Date given", () => {
  const cases: [Date, string][] = [
    [new Date(2026, 0, 1, 14, 32), "14:32"],
    [new Date(2026, 0, 1, 0, 5), "00:05"],
    [new Date(2026, 0, 1, 9, 0), "09:00"],
    [new Date(2026, 0, 1, 23, 59), "23:59"],
    [new Date(2026, 0, 1, 0, 0), "00:00"],
  ];

  for (const [date, want] of cases) {
    assert.equal(clockTime(date), want, `clockTime(${date.toISOString()})`);
  }
});
