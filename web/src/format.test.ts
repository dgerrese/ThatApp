import { test } from "node:test";
import assert from "node:assert/strict";

import { clockTime, elapsedFigure, longDay, timerFigure, totalFigure } from "./format.ts";

test("a timer is always HH:MM", async (t) => {
  const cases: [number, string][] = [
    [0, "00:00"],
    [59, "00:00"],
    [60, "00:01"],
    [9000, "02:30"],
    [36000, "10:00"],
    [-1, "00:00"],
  ];

  for (const [seconds, want] of cases) {
    await t.test(`${seconds} seconds is ${want}`, () => {
      const got = timerFigure(seconds);
      assert.equal(got, want);
    });
  }
});

test("a total is always Nh Nm", async (t) => {
  const cases: [number, string][] = [
    [0, "0h 00m"],
    [2700, "0h 45m"],
    [3600, "1h 00m"],
    [18900, "5h 15m"],
    [36000, "10h 00m"],
    [-1, "0h 00m"],
  ];

  for (const [seconds, want] of cases) {
    await t.test(`${seconds} seconds is ${want}`, () => {
      const got = totalFigure(seconds);
      assert.equal(got, want);
    });
  }
});

/**
 * The rule that matters: a colon is the mark of something you can start and
 * stop. A total growing one would tell the reader a control exists where none
 * does, which is the failure this whole convention is built to prevent.
 */
test("a total never carries a colon", async (t) => {
  const cases: number[] = [0, 59, 60, 3599, 3600, 18900, 359999];

  for (const seconds of cases) {
    await t.test(`${seconds} seconds`, () => {
      const got = totalFigure(seconds);
      assert.ok(!got.includes(":"), `${got} grew a colon`);
    });
  }
});

/**
 * The rail's own ticking shape, per the timer design: M:SS under an hour,
 * H:MM:SS from an hour on. Neither timerFigure (HH:MM, no seconds) nor
 * totalFigure (Nh Nm) is this — see the prototype's drawn 42:18.
 */
test("elapsed is M:SS under an hour, H:MM:SS from an hour on", async (t) => {
  const cases: [number, string][] = [
    [0, "0:00"],
    [5, "0:05"],
    [59, "0:59"],
    [60, "1:00"],
    [2538, "42:18"],
    [3599, "59:59"],
    [3600, "1:00:00"],
    [3661, "1:01:01"],
    [36000, "10:00:00"],
    [-1, "0:00"],
  ];

  for (const [seconds, want] of cases) {
    await t.test(`${seconds} seconds is ${want}`, () => {
      const got = elapsedFigure(seconds);
      assert.equal(got, want);
    });
  }
});

test("a clock time is always zero-padded HH:MM", async (t) => {
  const cases: [Date, string][] = [
    [new Date(2026, 0, 1, 14, 32), "14:32"],
    [new Date(2026, 0, 1, 0, 5), "00:05"],
    [new Date(2026, 0, 1, 9, 0), "09:00"],
    [new Date(2026, 0, 1, 23, 59), "23:59"],
    [new Date(2026, 0, 1, 0, 0), "00:00"],
  ];

  for (const [date, want] of cases) {
    await t.test(`${date.getHours()}h${date.getMinutes()} is ${want}`, () => {
      const got = clockTime(date);
      assert.equal(got, want);
    });
  }
});

/**
 * The case above builds and reads its Dates from the same local components,
 * so it cannot tell `getHours`/`getMinutes` apart from `getUTCHours`/
 * `getUTCMinutes` — and the container this runs in (`node:26-alpine`, no
 * `TZ`) is UTC, so the two would also agree there by accident. Pinning a zone
 * with a real, known offset from a fixed UTC instant is what makes "local to
 * the browser" an assertion this test can actually fail on.
 */
test("a clock time reads the zone it runs in, not UTC", () => {
  const originalTz = process.env["TZ"];
  process.env["TZ"] = "Europe/Amsterdam";

  try {
    // 13:32 UTC in January is 14:32 CET (UTC+1, outside any DST window) —
    // getUTCHours() would read back "13:32" here instead.
    assert.equal(clockTime(new Date("2026-01-15T13:32:00Z")), "14:32");
  } finally {
    if (originalTz === undefined) {
      delete process.env["TZ"];
    } else {
      process.env["TZ"] = originalTz;
    }
  }
});

/**
 * The brief's own worked example paired 2026-09-08 with "Monday", but the
 * Gregorian calendar puts it on a Tuesday (confirmed independently against
 * `cal 9 2026` and Python's `datetime`/`calendar` modules). Asserting the
 * brief's word here would bake a wrong weekday into a feature that will show
 * real dates the owner actually works on, so this pins the calendar's answer
 * instead — flagged in the task report rather than absorbed silently.
 */
test("a day renders as its full weekday and month", () => {
  assert.equal(longDay("2026-09-08"), "Tuesday 8 September");
  assert.equal(longDay("2026-01-01"), "Thursday 1 January");
  assert.equal(longDay("2024-02-29"), "Thursday 29 February");
});
