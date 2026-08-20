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

/**
 * Stubs /api/issues so these specs cover the view; the fan-out has its own
 * httptest coverage. It is also what keeps the browser away from real Jira: the
 * e2e stack shares the dev database, so an unstubbed Today would fan out to
 * whatever instances are configured in it.
 *
 * Each call to the endpoint takes the next response, and the last one repeats,
 * so a Refresh test can hand over two different lists.
 */
async function stubIssues(page: Page, ...responses: StubGroup[][]): Promise<void> {
  let calls = 0;

  await page.route("**/api/issues", async (route) => {
    const index = Math.min(calls, responses.length - 1);
    calls += 1;
    await route.fulfill({ status: 200, json: { instances: responses[index] } });
  });
}

function group(id: number, name: string, issues: StubIssue[]): StubGroup {
  return { id, name, issues, error: null };
}

const workIssue: StubIssue = {
  key: "WORK-412",
  summary: "Fix the CSV export encoding",
  status: "In Progress",
  url: "https://work.atlassian.net/browse/WORK-412",
};

const personalIssue: StubIssue = {
  key: "PERS-7",
  summary: "Renew the domain",
  status: "To Do",
  url: "https://personal.atlassian.net/browse/PERS-7",
};

test("both instances' issues render under their own headings", async ({ page }) => {
  await stubIssues(page, [group(1, "Work", [workIssue]), group(2, "Personal", [personalIssue])]);
  await page.goto("/today");

  // exact: true — the app shell's permanent <h1>Work Dashboard</h1> is a
  // substring match for "Work" under Playwright's default name matching.
  await expect(page.getByRole("heading", { name: "Work", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Personal" })).toBeVisible();
  await expect(page.getByText("Fix the CSV export encoding")).toBeVisible();
  await expect(page.getByText("Renew the domain")).toBeVisible();
  await expect(page.getByText("In Progress")).toBeVisible();
});

// The criterion: one instance failing must not cost the other its issues.
test("one instance failing still shows the other's issues", async ({ page }) => {
  await stubIssues(page, [
    group(1, "Work", [workIssue]),
    {
      id: 2,
      name: "Personal",
      issues: [],
      error: { code: "credentials_rejected", message: "Jira rejected the email and API token" },
    },
  ]);
  await page.goto("/today");

  await expect(page.getByText("Fix the CSV export encoding")).toBeVisible();
  await expect(page.getByText("Jira rejected the email and API token")).toBeVisible();
});

test("an issue key links to Jira, and a row with no site URL does not", async ({ page }) => {
  await stubIssues(page, [
    group(1, "Work", [workIssue, { ...personalIssue, key: "MIGR-3", url: "" }]),
  ]);
  await page.goto("/today");

  const link = page.getByRole("link", { name: "WORK-412" });
  await expect(link).toHaveAttribute("href", "https://work.atlassian.net/browse/WORK-412");
  await expect(link).toHaveAttribute("target", "_blank");
  // Without noopener the opened page gets a handle back into this one.
  await expect(link).toHaveAttribute("rel", "noopener");

  await expect(page.getByText("MIGR-3")).toBeVisible();
  await expect(page.getByRole("link", { name: "MIGR-3" })).toHaveCount(0);
});

test("an instance with nothing assigned says so", async ({ page }) => {
  await stubIssues(page, [group(1, "Work", [])]);
  await page.goto("/today");

  // exact: true — see the same note above.
  await expect(page.getByRole("heading", { name: "Work", exact: true })).toBeVisible();
  await expect(page.getByText("No issues assigned.")).toBeVisible();
});

// With nothing configured there is nothing to refresh, so the control that could
// only ever refetch an empty list is not on screen at all.
test("no configured instances offers Settings instead of a Refresh button", async ({ page }) => {
  await stubIssues(page, []);
  await page.goto("/today");

  await expect(page.getByText("No Jira instances yet.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeHidden();
});

test("Refresh replaces the list", async ({ page }) => {
  await stubIssues(page, [group(1, "Work", [workIssue])], [group(1, "Work", [personalIssue])]);
  await page.goto("/today");

  await expect(page.getByText("Fix the CSV export encoding")).toBeVisible();

  await page.getByRole("button", { name: "Refresh" }).click();

  await expect(page.getByText("Renew the domain")).toBeVisible();
  await expect(page.getByText("Fix the CSV export encoding")).toBeHidden();
});

test("a failed request shows the error and leaves Refresh usable", async ({ page }) => {
  await page.route("**/api/issues", (route) =>
    route.fulfill({
      status: 500,
      json: { code: "store_failed", message: "could not read the stored instances" },
    }),
  );
  await page.goto("/today");

  await expect(page.getByText("could not read the stored instances")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
});

test("/ leads to Today and leaves no history trap", async ({ page }) => {
  await stubIssues(page, [group(1, "Work", [workIssue])]);
  await page.route("**/api/instances", (route) => route.fulfill({ status: 200, json: [] }));

  await page.goto("/");

  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByText("Fix the CSV export encoding")).toBeVisible();

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);

  await page.goBack();

  // replaceState, not pushState: "/" never entered the history stack, so Back
  // lands on Today instead of on "/" redirecting forward again.
  await expect(page).toHaveURL(/\/today$/);
});

test("an unknown path offers a way back to Today", async ({ page }) => {
  await page.goto("/nowhere");

  await expect(page.getByText("There is nothing at this address.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to Today" })).toBeVisible();
});
