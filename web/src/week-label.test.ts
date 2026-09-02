import test from "node:test";
import assert from "node:assert/strict";

import { weekLabel } from "./week-label.ts";

void test("a week inside one month names the month once", async (t) => {
  const cases: { start: string; end: string; want: string }[] = [
    { start: "2026-09-07", end: "2026-09-13", want: "7–13 Sep" },
    { start: "2026-09-01", end: "2026-09-07", want: "1–7 Sep" },
    { start: "2026-01-05", end: "2026-01-11", want: "5–11 Jan" },
    { start: "2026-12-21", end: "2026-12-27", want: "21–27 Dec" },
  ];

  for (const { start, end, want } of cases) {
    await t.test(`${start} to ${end} is ${want}`, () => {
      const got = weekLabel(start, end);
      assert.equal(got, want);
    });
  }
});

void test("a week spanning two months names both", async (t) => {
  const cases: { start: string; end: string; want: string }[] = [
    { start: "2026-08-31", end: "2026-09-06", want: "31 Aug – 6 Sep" },
    { start: "2026-11-30", end: "2026-12-06", want: "30 Nov – 6 Dec" },
  ];

  for (const { start, end, want } of cases) {
    await t.test(`${start} to ${end} is ${want}`, () => {
      const got = weekLabel(start, end);
      assert.equal(got, want);
    });
  }
});

void test("a week spanning two years names both", async (t) => {
  const cases: { start: string; end: string; want: string }[] = [
    { start: "2026-12-28", end: "2027-01-03", want: "28 Dec 2026 – 3 Jan 2027" },
  ];

  for (const { start, end, want } of cases) {
    await t.test(`${start} to ${end} is ${want}`, () => {
      const got = weekLabel(start, end);
      assert.equal(got, want);
    });
  }
});

// The bug this module exists to avoid: `new Date("2026-09-07")` parses as UTC
// midnight, and every getter on it reads in the browser's zone — so west of
// Greenwich it is the 6th. The label must not move when the process zone does.
void test("the label does not shift with the process timezone", async (t) => {
  const zones = ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"];

  for (const zone of zones) {
    await t.test(`7–13 Sep in ${zone}`, () => {
      process.env["TZ"] = zone;
      const got = weekLabel("2026-09-07", "2026-09-13");
      assert.equal(got, "7–13 Sep");
    });
  }
  process.env["TZ"] = "UTC";
});

void test("a day number keeps no leading zero", async (t) => {
  await t.test("2026-09-01 to 2026-09-07 is 1–7 Sep", () => {
    const got = weekLabel("2026-09-01", "2026-09-07");
    assert.equal(got, "1–7 Sep");
  });
});
