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

// Today now fetches /api/pins on every render too (#6's Task 9). This suite is
// not about pins, so every test gets an empty answer here rather than each one
// stubbing it, or — worse — relying on the dev store actually having none: a
// stray pin would add a wd-ticket-row and a wd-card ul the geometry and count
// assertions below never budgeted for.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
  // #7 put a duration cell on every row and made the rail's total live, both
  // fed by this endpoint. The e2e stack shares the dev database, so without
  // this a single entry logged by hand would move every figure these tests
  // measure — the same reason pins are stubbed above.
  await page.route("**/api/entries**", (route) => route.fulfill({ status: 200, json: [] }));
});

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

/**
 * Today registers an "online" listener that re-runs its refresh (task 7).
 * router.ts's teardown hook is what is supposed to remove it once Today is
 * no longer the mounted view — this proves that actually happens, rather
 * than trusting the router's own reading of its own code. Deleting either
 * side of the hook (today.ts's registerTeardown call, or router.ts's call to
 * it before the next view mounts) leaves every other suite green; this is
 * the one test that would fail.
 */
test("navigating away from Today removes its 'online' listener, so reconnecting elsewhere refetches nothing", async ({
  page,
}) => {
  let issuesCalls = 0;
  await page.route("**/api/issues", async (route) => {
    issuesCalls += 1;
    await route.fulfill({ status: 200, json: { instances: [group(1, "Work", [workIssue])] } });
  });
  await page.route("**/api/instances", (route) => route.fulfill({ status: 200, json: [] }));

  await page.goto("/today");
  await expect(page.getByText("Fix the CSV export encoding")).toBeVisible();
  expect(issuesCalls).toBe(1);

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);

  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  // No positive signal exists for "nothing happened" — a leaked listener's
  // refetch would land well inside this window, the same margin
  // pins.spec.ts's own debounce-silence tests give a timer that must not fire.
  await page.waitForTimeout(500);

  expect(issuesCalls).toBe(1);
});

/**
 * A long summary must not push the status out of the card. It did: the row's
 * inner boxes sized to their content, so the summary's truncation never
 * engaged and the status left the card entirely on a narrow viewport.
 *
 * Asserted geometrically rather than by class, because the bug was invisible to
 * every class-based check — the truncate utility was present and correct the
 * whole time, and simply never had an effect.
 */
test("a long summary truncates instead of pushing the status out of the card", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubIssues(page, [
    group(1, "Work", [
      {
        key: "WORK-99999",
        summary:
          "A deliberately overlong summary that no narrow viewport could ever hope to lay out in full without truncating it somewhere",
        status: "In Progress",
        url: "https://work.atlassian.net/browse/WORK-99999",
      },
    ]),
  ]);
  await page.goto("/today");

  const row = page.locator("wd-ticket-row").first();
  await expect(row).toBeVisible();

  const overflow = await row.evaluate((element) => {
    const card = element.closest("wd-card") as HTMLElement;
    const inner =
      card.getBoundingClientRect().right - parseFloat(getComputedStyle(card).paddingRight);
    const status = element.querySelector("span:last-child") as HTMLElement;

    return status.getBoundingClientRect().right - inner;
  });

  expect(overflow).toBeLessThanOrEqual(0);

  // And the page itself must not have grown a horizontal scrollbar.
  const scrollsSideways = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(scrollsSideways).toBe(false);
});

/**
 * The rail shows where you are by fill and weight, and both read it from
 * aria-current. Nothing set it until the router was taught to.
 */
test("the rail marks the view you are on", async ({ page }) => {
  await stubIssues(page, [group(1, "Work", [workIssue])]);
  await page.goto("/today");

  await expect(page.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Settings" })).not.toHaveAttribute(
    "aria-current",
    /.*/,
  );

  await page.getByRole("link", { name: "Settings" }).click();

  await expect(page.getByRole("link", { name: "Settings" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("link", { name: "Today" })).not.toHaveAttribute("aria-current", /.*/);
});

/**
 * A button has to look clickable. Tailwind v4's Preflight deliberately leaves
 * <button> on the default arrow cursor, so this is not something the framework
 * supplies — and nothing else in the suite would notice it missing.
 */
test("buttons say whether they can be clicked", async ({ page }) => {
  await stubIssues(page, [group(1, "Work", [workIssue])]);
  await page.goto("/today");

  await expect(page.getByRole("button", { name: "Refresh" })).toHaveCSS("cursor", "pointer");
  // The rail's Push has nothing to push yet, and says so the same way.
  await expect(page.locator("#rail-push")).toHaveCSS("cursor", "not-allowed");
});

/**
 * The key is a column, not a word: fixing its width is what makes every summary
 * in a card start at the same x. Without it each row begins its title wherever
 * its own key happened to end, and the list reads as ragged.
 *
 * Geometry again rather than classes — the difference is entirely in layout.
 */
test("summaries line up down the card whatever the key's length", async ({ page }) => {
  await stubIssues(page, [
    group(1, "Work", [
      { key: "A-1", summary: "Short key", status: "To Do", url: "https://w.atlassian.net/browse/A-1" },
      {
        key: "PLATFORM-4821",
        summary: "Much longer key",
        status: "To Do",
        url: "https://w.atlassian.net/browse/PLATFORM-4821",
      },
      { key: "ESS-35", summary: "Middling key", status: "QA", url: "https://w.atlassian.net/browse/ESS-35" },
    ]),
  ]);
  await page.goto("/today");
  await expect(page.locator("wd-ticket-row")).toHaveCount(3);

  const lefts = await page.locator("wd-ticket-row").evaluateAll((rows) =>
    rows.map((row) => {
      const key = row.querySelector(".wd-key") as HTMLElement;

      return Math.round((key.nextElementSibling as HTMLElement).getBoundingClientRect().left);
    }),
  );

  // PLATFORM-4821 is wider than the 76px the design drew, which is exactly the
  // case that used to go ragged: the column is sized from the widest key in the
  // list, so all three share an edge rather than two of them agreeing.
  expect(new Set(lefts).size).toBe(1);
});

/**
 * Each list carries its own column. Two instances whose project keys differ in
 * length must not be forced to the same width — they are separate lists, and
 * padding the short one to suit the long one wastes the space that the summary
 * needs on a narrow viewport.
 */
test("each instance's list sizes its own key column", async ({ page }) => {
  await stubIssues(page, [
    group(1, "Short", [
      { key: "A-1", summary: "One", status: "To Do", url: "https://w.atlassian.net/browse/A-1" },
      { key: "A-2", summary: "Two", status: "To Do", url: "https://w.atlassian.net/browse/A-2" },
    ]),
    group(2, "Long", [
      {
        key: "PLATFORM-4821",
        summary: "Three",
        status: "To Do",
        url: "https://w.atlassian.net/browse/PLATFORM-4821",
      },
      {
        key: "PLATFORM-4822",
        summary: "Four",
        status: "To Do",
        url: "https://w.atlassian.net/browse/PLATFORM-4822",
      },
    ]),
  ]);
  await page.goto("/today");
  await expect(page.locator("wd-ticket-row")).toHaveCount(4);

  const columns = await page
    .locator("wd-card ul")
    .evaluateAll((lists) =>
      lists.map((list) => parseFloat((list as HTMLElement).style.getPropertyValue("--wd-key-col"))),
    );

  expect(columns).toHaveLength(2);
  // The short list keeps the design's floor; the long one grows past it.
  expect(columns[0]).toBe(76);
  expect(columns[1]).toBeGreaterThan(76);
});
