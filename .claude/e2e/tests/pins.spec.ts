import { expect, test, type Page } from "@playwright/test";

interface StubPin {
  id: number;
  instanceId: number;
  instanceName: string;
  key: string;
  summary: string;
  status: string;
  url: string;
  error: { code: string; message: string } | null;
}

function pin(id: number, instanceName: string, key: string, summary: string): StubPin {
  return {
    id,
    instanceId: id,
    instanceName,
    key,
    summary,
    status: "In Progress",
    url: `https://example.atlassian.net/browse/${key}`,
    error: null,
  };
}

/**
 * Stubs /api/pins. The route pattern must not also swallow /api/issues/search,
 * which is why it is anchored with the query-string wildcard rather than a bare
 * suffix.
 *
 * `first` is required rather than folded into the rest parameter: with none at
 * all, `Math.min(calls, responses.length - 1)` would index at -1 and fulfil
 * with `json: undefined`.
 */
async function stubPins(page: Page, first: StubPin[], ...rest: StubPin[][]): Promise<void> {
  const responses = [first, ...rest];
  let calls = 0;

  await page.route("**/api/pins**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    const index = Math.min(calls, responses.length - 1);
    calls += 1;
    await route.fulfill({ status: 200, json: responses[index] });
  });
}

async function stubIssues(page: Page, groups: unknown[]): Promise<void> {
  await page.route("**/api/issues", async (route) => {
    await route.fulfill({ status: 200, json: { instances: groups } });
  });
}

test("pinned issues render above the assigned cards", async ({ page }) => {
  await stubPins(page, [pin(1, "Ridgeline", "SHARED-12", "Weekly standup")]);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);

  await page.goto("/today");

  const card = page.locator("wd-card").filter({ hasText: "Pinned" });
  await expect(card.getByText("SHARED-12")).toBeVisible();
  await expect(card.getByText("Weekly standup")).toBeVisible();
  await expect(card.getByText("Ridgeline")).toBeVisible();

  // "Above" is a claim about document order, not just co-presence: compare the
  // Pinned card's top edge against the assigned-issues heading's.
  const assignedHeading = page.getByRole("heading", { name: "Assigned issues" });
  const pinnedBox = await card.boundingBox();
  const assignedBox = await assignedHeading.boundingBox();
  expect(pinnedBox).not.toBeNull();
  expect(assignedBox).not.toBeNull();
  expect(pinnedBox!.y).toBeLessThan(assignedBox!.y);
});

// Independent on purpose: the Pinned card must paint from /api/pins alone and
// must not wait on the assigned-issues fan-out, which may be slow or hang.
test("the pinned card paints before the assigned fan-out answers", async ({ page }) => {
  await stubPins(page, [pin(1, "Ridgeline", "SHARED-12", "Weekly standup")]);
  await page.route("**/api/issues", () => {
    // Never fulfilled: the fan-out hangs, and the Pinned card must not.
  });

  await page.goto("/today");

  const card = page.locator("wd-card").filter({ hasText: "Pinned" });
  await expect(card.getByText("SHARED-12")).toBeVisible();
  await expect(page.getByText("Loading…")).toBeVisible();
});

test("an issue that is both pinned and assigned appears once", async ({ page }) => {
  await stubPins(page, [pin(1, "Ridgeline", "SHARED-12", "Weekly standup")]);
  await stubIssues(page, [
    {
      id: 1,
      name: "Ridgeline",
      error: null,
      issues: [
        {
          key: "SHARED-12",
          summary: "Weekly standup",
          status: "In Progress",
          url: "https://example.atlassian.net/browse/SHARED-12",
        },
        {
          key: "WORK-412",
          summary: "Fix the CSV export encoding",
          status: "In Progress",
          url: "https://example.atlassian.net/browse/WORK-412",
        },
      ],
    },
  ]);

  await page.goto("/today");

  // Scoped rather than page-wide: a dedupe that filtered the Pinned card
  // instead of the assigned one would still leave exactly one "SHARED-12" on
  // the page. The spec is that the row survives in Pinned and is removed from
  // Ridgeline's assigned list specifically. The heading attribute (rather than
  // hasText) picks out the assigned card unambiguously, since the Pinned card
  // also shows "Ridgeline" as the pinned row's instance label.
  const pinnedCard = page.locator("wd-card").filter({ hasText: "Pinned" });
  const assignedCard = page.locator('wd-card[heading="Ridgeline"]');
  await expect(pinnedCard.getByText("SHARED-12")).toBeVisible();
  await expect(assignedCard.getByText("SHARED-12")).toHaveCount(0);
  await expect(page.getByText("WORK-412")).toHaveCount(1);
});

test("the pinned card renders when every instance fails", async ({ page }) => {
  await stubPins(page, [pin(1, "Ridgeline", "SHARED-12", "Weekly standup")]);
  await stubIssues(page, [
    {
      id: 1,
      name: "Ridgeline",
      issues: [],
      error: { code: "instance_unreachable", message: "the Jira site could not be reached" },
    },
  ]);

  await page.goto("/today");

  await expect(page.getByText("SHARED-12")).toBeVisible();
  await expect(page.getByText("the Jira site could not be reached")).toBeVisible();
});

test("no pins shows nothing pinned", async ({ page }) => {
  await stubPins(page, []);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);

  await page.goto("/today");

  await expect(page.getByText("Nothing pinned.")).toBeVisible();
});

// With no instances there can be no pins either — the cascade took them with the
// last instance — so a Pinned card would be a control with nothing to do.
test("no instances configured hides the pinned card entirely", async ({ page }) => {
  await stubPins(page, []);
  await stubIssues(page, []);

  await page.goto("/today");

  await expect(page.getByText("No Jira instances yet.")).toBeVisible();
  await expect(page.locator("wd-card").filter({ hasText: "Pinned" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pin an issue" })).toHaveCount(0);
});
