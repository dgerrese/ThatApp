import { test } from "node:test";
import assert from "node:assert/strict";
import { pushReportLines } from "./push-report.ts";
import type { PushResult } from "./types.ts";

function result(entryId: number, status: PushResult["status"], code?: string): PushResult {
  return {
    entryId,
    issueKey: `RIDGE-${String(entryId)}`,
    instanceId: 1,
    status,
    ...(code === undefined ? {} : { error: { code, message: `${code} happened` } }),
  };
}

test("a clean push names its deletes beside what it pushed", () => {
  const lines = pushReportLines(
    [
      {
        day: "2026-10-09",
        results: [result(1, "pushed"), result(2, "pushed"), result(3, "deleted")],
      },
    ],
    [],
  );

  assert.deepEqual(
    lines.map((line) => [line.tone, line.message]),
    [["success", "Pushed 2 entries and deleted 1."]],
  );
});

test("a push with no deletes reads as it always has", () => {
  const lines = pushReportLines([{ day: "2026-10-09", results: [result(1, "pushed")] }], []);

  assert.deepEqual(
    lines.map((line) => line.message),
    ["Pushed 1 entry."],
  );
});

// Review focus 2: Jira deleted the worklog and the row survived. Pushing again
// is the fix, so this is offered a retry — never the store_failed line that
// tells the reader to stop.
test("a delete the store could not record is offered a retry", () => {
  const lines = pushReportLines(
    [{ day: "2026-10-09", results: [result(1, "failed", "delete_unrecorded")] }],
    [],
  );

  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.tone, "warning");
  assert.match(lines[0]?.message ?? "", /Press Push worklogs again/);
});
