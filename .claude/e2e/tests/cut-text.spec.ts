import { expect, test, type Page } from "@playwright/test";

interface StubIssue {
  key: string;
  summary: string;
  status: string;
  url: string;
}

interface StubGroup {
  id: number;
  name: string;
  issues: StubIssue[];
  error: { code: string; message: string } | null;
}

// Copied from today.spec.ts — see its own comment for why /api/issues is
// stubbed this way and why /api/pins and /api/entries are stubbed at all.
async function stubIssues(page: Page, ...responses: StubGroup[][]): Promise<void> {
  let calls = 0;

  await page.route("**/api/issues", async (route) => {
    const index = Math.min(calls, responses.length - 1);
    calls += 1;
    await route.fulfill({ status: 200, json: { instances: responses[index] } });
  });
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
  await page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 200, json: { today: "2026-09-09", entries: [] } }),
  );
});

function group(id: number, name: string, issues: StubIssue[]): StubGroup {
  return { id, name, issues, error: null };
}

function issue(key: string, summary: string): StubIssue {
  return { key, summary, status: "To Do", url: `https://work.atlassian.net/browse/${key}` };
}

// A pinned row is the only path that puts a failure note under a summary —
// today.ts's pinnedRow sets `error` from a pin's own error, never from an
// assigned issue (see today.ts's cardBuilding, which renders a whole-card
// alert for an instance error instead of touching any row). Copied and
// trimmed from pins.spec.ts's own `pin` — only the fields this file needs.
function pinWithError(summary: string, failureMessage: string): Record<string, unknown> {
  return {
    id: 1,
    instanceId: 1,
    instanceName: "Work",
    instancePosition: 0,
    key: "WORK-1",
    summary,
    status: "To Do",
    url: "https://work.atlassian.net/browse/WORK-1",
    error: { code: "instance_unreachable", message: failureMessage },
  };
}

async function stubPinWithError(
  page: Page,
  summary: string,
  failureMessage: string,
): Promise<void> {
  await page.route("**/api/pins**", (route) =>
    route.fulfill({ status: 200, json: [pinWithError(summary, failureMessage)] }),
  );
}

// Narrow enough that the summary column truncates a long summary.
test.use({ viewport: { width: 900, height: 700 } });

const longSummary =
  "Reconcile the quarterly capacity forecast against every team's actual booked hours, " +
  "including the contractors who log time in a different instance entirely";

test("a cut summary in a Today row shows its full text on hover", async ({ page }) => {
  await stubIssues(page, [group(1, "Work", [issue("WORK-1", longSummary)])]);
  await page.goto("/today");
  await page.getByText(longSummary, { exact: true }).first().hover();
  const tip = page.locator("that-tooltip", { hasText: longSummary });
  await expect(tip).toBeVisible();
});

// Owner, 2026-09-25: dropped `focus-for` from the Today row's own summary
// tooltip. It used to follow the key link so a keyboard user reached it too,
// but that opened both this tooltip and the key's own "open in Jira" one at
// once, and below ~900px the summary's covered the key's. The search panel's
// own copy of this pairing (search.spec.ts) is unaffected — it keeps
// `focus-for` and `below`.
test("a Today row's key focus shows only the key's own tooltip, not the cut summary's", async ({
  page,
}) => {
  await stubIssues(page, [group(1, "Work", [issue("WORK-1", longSummary)])]);
  await page.goto("/today");
  await page.getByRole("link", { name: "WORK-1" }).focus();
  await expect(page.locator("that-tooltip", { hasText: "open in Jira" })).toBeVisible();
  await expect(page.locator("that-tooltip", { hasText: longSummary })).toBeHidden();
});

// At the same viewport this file already uses (900px) where the owner saw the
// collision: exactly one tooltip on screen, the key's own.
test("at 900px, focusing a cut-summary row's key shows exactly one tooltip: open in Jira", async ({
  page,
}) => {
  await stubIssues(page, [group(1, "Work", [issue("WORK-1", longSummary)])]);
  await page.goto("/today");
  await page.getByRole("link", { name: "WORK-1" }).focus();

  const visible = page.locator("that-tooltip:visible");
  await expect(visible).toHaveCount(1);
  await expect(visible).toHaveText("open in Jira");
});

test("a Today summary that is not cut shows no tooltip on hover or focus", async ({ page }) => {
  await stubIssues(page, [group(1, "Work", [issue("WORK-2", "Short one")])]);
  await page.goto("/today");
  // .first(): the tooltip carries the same text too, even while hidden.
  await page.getByText("Short one", { exact: true }).first().hover();
  await expect(page.locator("that-tooltip", { hasText: "Short one" })).toBeHidden();
  await page.getByRole("link", { name: "WORK-2" }).focus();
  await expect(page.locator("that-tooltip", { hasText: "Short one" })).toBeHidden();
});

const longFailure =
  "The Jira site could not be reached because the gateway timed out after three retries " +
  "against every configured endpoint for this instance";

test("a cut failure note on a pinned row shows its full text on hover", async ({ page }) => {
  // One configured instance with nothing assigned — an empty instances array
  // hides the Pinned card entirely (pins.spec.ts's own "no instances
  // configured hides the pinned card" test), which is not what this test is
  // about.
  await stubIssues(page, [group(1, "Work", [])]);
  await stubPinWithError(page, "Weekly standup", longFailure);
  await page.goto("/today");
  await page.getByText(longFailure, { exact: true }).first().hover();
  const tip = page.locator("that-tooltip", { hasText: longFailure });
  await expect(tip).toBeVisible();
});

// Both the failure note's tooltip and (since 2026-09-25, owner) the
// summary's own are hover-only on a Today row — no focus-for on either, so
// focusing the row's key link opens only the key's own "open in Jira"
// tooltip. Both other texts are cut here, so the only thing distinguishing
// them from the key's is that wiring.
test("focusing a pinned row's key link shows only the key's own tooltip, neither the summary's nor the failure note's", async ({
  page,
}) => {
  await stubIssues(page, [group(1, "Work", [])]);
  await stubPinWithError(page, longSummary, longFailure);
  await page.goto("/today");
  await page.getByRole("link", { name: "WORK-1" }).focus();
  await expect(page.locator("that-tooltip", { hasText: "open in Jira" })).toBeVisible();
  await expect(page.locator("that-tooltip", { hasText: longSummary })).toBeHidden();
  await expect(page.locator("that-tooltip", { hasText: longFailure })).toBeHidden();
});

// The rail and the entry dialog give their cut text back too (#143).

const longInstanceName =
  "Ridgeline Analytics and Reporting Platform for the Quarterly Capacity and Utilisation Programme";

function stubEntries(page: Page, entries: Record<string, unknown>[]): Promise<void> {
  return page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 200, json: { today: "2026-09-09", entries } }),
  );
}

function railEntry(instanceName: string): Record<string, unknown> {
  return {
    id: 1,
    instanceId: 1,
    instanceName,
    instancePosition: 0,
    issueKey: "WORK-1",
    day: "2026-09-09",
    startedAt: "2026-09-09T09:00:00+02:00",
    seconds: 3600,
    comment: "",
    pushState: "unpushed",
  };
}

test("a cut rail instance name shows its full text on hover", async ({ page }) => {
  await stubIssues(page, [group(1, "Work", [])]);
  await stubEntries(page, [railEntry(longInstanceName)]);
  await page.goto("/today");
  await page.getByText(longInstanceName, { exact: true }).first().hover();
  await expect(page.locator("that-tooltip", { hasText: longInstanceName })).toBeVisible();
});

// Measured against the real rail width (216px column, 100px left for the key
// once the dot, the elapsed figure and the stop button take their share):
// even a realistic Jira key like this one already overflows it, so this is
// not a hypothetical case worth skipping.
test("a cut rail running key shows its full text when the stop button is focused", async ({
  page,
}) => {
  await stubIssues(page, [group(1, "Work", [])]);
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
  await page.route("**/api/timer", (route) =>
    route.fulfill({
      status: 200,
      json: {
        running: {
          instanceId: 1,
          issueKey: "RIDGELINE-4929",
          startedAt: new Date(Date.now() - 60_000).toISOString(),
        },
        stopped: null,
      },
    }),
  );
  await page.goto("/today");
  await page.locator("#rail-timer").getByRole("button", { name: "stop timer" }).focus();
  await expect(page.locator("that-tooltip", { hasText: "RIDGELINE-4929" })).toBeVisible();
});

function openDialog(page: Page): Promise<void> {
  return page.getByRole("button", { name: /Log time against WORK-1/ }).click();
}

test("a cut dialog instance name shows its full text on hover", async ({ page }) => {
  await stubIssues(page, [group(1, longInstanceName, [issue("WORK-1", "Ship it")])]);
  await stubEntries(page, []);
  await page.goto("/today");
  await openDialog(page);
  // Scoped to the dialog: Today's own card heading carries the same instance
  // name behind the modal overlay, and a bare getByText would resolve there.
  await page
    .locator("that-entry-dialog")
    .getByText(longInstanceName, { exact: true })
    .first()
    .hover();
  await expect(page.locator("that-tooltip", { hasText: longInstanceName })).toBeVisible();
});

const longComment =
  "Rewrote the ingestion pipeline's retry logic so a transient Jira timeout no longer drops " +
  "the whole day's sync silently, and added a metrics counter so an operator watching the " +
  "dashboard can see a retry happening in real time instead of guessing from the logs alone";

function dialogEntry(id: number, comment: string): Record<string, unknown> {
  return {
    id,
    instanceId: 1,
    instanceName: "Work",
    instancePosition: 0,
    issueKey: "WORK-1",
    day: "2026-09-09",
    startedAt: "2026-09-09T09:15:00+02:00",
    seconds: 3600,
    comment,
    pushState: "unpushed",
  };
}

test("a cut entry comment in the dialog shows its full text when the edit button is focused, and a short one shows none", async ({
  page,
}) => {
  await stubIssues(page, [group(1, "Work", [issue("WORK-1", "Ship it")])]);
  await stubEntries(page, [dialogEntry(1, longComment), dialogEntry(2, "Quick fix")]);
  await page.goto("/today");
  await openDialog(page);

  const rows = page.locator("that-entry-dialog li");
  await rows.nth(0).getByRole("button", { name: /Edit the/ }).focus();
  await expect(page.locator("that-tooltip", { hasText: longComment })).toBeVisible();

  await rows.nth(1).getByRole("button", { name: /Edit the/ }).focus();
  await expect(page.locator("that-tooltip", { hasText: longComment })).toBeHidden();
  await expect(page.locator("that-tooltip", { hasText: "Quick fix" })).toBeHidden();
});
