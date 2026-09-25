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

test("a cut summary in a Today row shows its full text when the key link is focused", async ({
  page,
}) => {
  await stubIssues(page, [group(1, "Work", [issue("WORK-1", longSummary)])]);
  await page.goto("/today");
  await page.getByRole("link", { name: "WORK-1" }).focus();
  await expect(page.locator("that-tooltip", { hasText: longSummary })).toBeVisible();
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

// Decision from the brief: the failure note's tooltip is hover-only, unlike
// the summary's own — no focus-for, so focusing the row's key link (which
// opens the summary's tooltip) must never also open this one. Both texts are
// cut here, so the only thing distinguishing them is that wiring.
test("focusing a pinned row's key link shows the summary tooltip but not the failure note's", async ({
  page,
}) => {
  await stubIssues(page, [group(1, "Work", [])]);
  await stubPinWithError(page, longSummary, longFailure);
  await page.goto("/today");
  await page.getByRole("link", { name: "WORK-1" }).focus();
  await expect(page.locator("that-tooltip", { hasText: longSummary })).toBeVisible();
  await expect(page.locator("that-tooltip", { hasText: longFailure })).toBeHidden();
});
