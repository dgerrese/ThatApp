import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchReportLines } from "./fetch-report.ts";
import type { WeekFetchResponse } from "./types.ts";

const base: WeekFetchResponse = {
  start: "2026-08-31",
  end: "2026-09-06",
  created: 0,
  updated: 0,
  keptLocal: [],
  failures: [],
};

test("a clean run is one line and names nothing", () => {
  const lines = fetchReportLines({ ...base, created: 3, updated: 1 });

  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.tone, "success");
  assert.equal(lines[0]?.message, "Added 3 entries and updated 1.");
  assert.deepEqual(lines[0]?.items, []);
});

test("a run that changed nothing says so rather than counting to zero", () => {
  const lines = fetchReportLines(base);

  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.message, "Nothing to add or update.");
});

test("one of each is singular", () => {
  const lines = fetchReportLines({ ...base, created: 1, updated: 1 });

  assert.equal(lines[0]?.message, "Added 1 entry and updated 1.");
});

test("entries that were kept are named, because only the user can choose", () => {
  const lines = fetchReportLines({
    ...base,
    created: 1,
    keptLocal: [
      { day: "2026-09-01", issueKey: "RID-1", instanceId: 1 },
      { day: "2026-09-03", issueKey: "NW-806", instanceId: 2 },
    ],
  });

  assert.equal(lines.length, 2);
  assert.equal(lines[1]?.tone, "warning");
  assert.match(lines[1]?.message ?? "", /2 entries have changes you have not pushed/);
  assert.deepEqual(lines[1]?.items, ["2026-09-01 · RID-1", "2026-09-03 · NW-806"]);
});

test("an instance that refused is named with what it said", () => {
  const lines = fetchReportLines({
    ...base,
    created: 2,
    failures: [
      {
        instanceId: 2,
        instanceName: "Northwind",
        error: {
          code: "jira_unauthorized",
          message: "the token does not carry the scope this needs",
        },
      },
    ],
  });

  assert.equal(lines.length, 2);
  assert.equal(lines[1]?.tone, "error");
  assert.match(lines[1]?.message ?? "", /Northwind could not be read/);
  assert.deepEqual(lines[1]?.items, ["the token does not carry the scope this needs"]);
});

test("no line names the service", () => {
  const lines = fetchReportLines({
    ...base,
    created: 1,
    keptLocal: [{ day: "2026-09-01", issueKey: "RID-1", instanceId: 1 }],
    failures: [
      { instanceId: 2, instanceName: "Northwind", error: { code: "x", message: "refused" } },
    ],
  });

  for (const line of lines) {
    assert.doesNotMatch(line.message, /Jira/, "copy this ticket adds names no service");
  }
});
