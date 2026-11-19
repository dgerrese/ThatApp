import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * #259: no instance dot carries a native title; the ticket-row and Week dots
 * get the app's own hover-only tooltip. A dot is not focusable, so its
 * tooltip opens on pointer alone and the dot is never a Tab stop.
 */
const DAY = "2026-09-10";

const issue = {
  key: "WORK-412",
  summary: "Fix the CSV export encoding",
  status: "In Progress",
  url: "https://work.atlassian.net/browse/WORK-412",
};

const pinned = {
  id: 1,
  instanceId: 1,
  instanceName: "Ridgeline",
  instancePosition: 0,
  key: "SHARED-12",
  summary: "Weekly standup",
  status: "In Progress",
  url: "https://ridgeline.atlassian.net/browse/SHARED-12",
  error: null,
};

const hit = {
  instanceId: 1,
  instanceName: "Ridgeline",
  instancePosition: 0,
  key: "RIDGE-5140",
  summary: "Capacity planning spreadsheet is out of date",
  status: "To Do",
  url: "https://ridgeline.atlassian.net/browse/RIDGE-5140",
};

async function stubToday(page: Page): Promise<void> {
  await page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 200, json: { today: DAY, entries: [] } }),
  );
  await page.route("**/api/pins**", (route) => {
    if (route.request().method() !== "GET") return route.fallback();

    return route.fulfill({ status: 200, json: [pinned] });
  });
  await page.route("**/api/issues", (route) =>
    route.fulfill({
      status: 200,
      json: { instances: [{ id: 1, name: "Ridgeline", issues: [issue], error: null }] },
    }),
  );
  await page.route("**/api/issues/search**", (route) =>
    route.fulfill({ status: 200, json: { results: [hit], errors: [] } }),
  );
  await page.route("**/api/instances", (route) =>
    route.fulfill({
      status: 200,
      json: [
        {
          id: 1,
          name: "Ridgeline",
          siteUrl: "https://ridgeline.atlassian.net",
          apiBaseUrl: "https://api.atlassian.com/ex/jira/abc",
          email: "dion@this.nl",
          createdAt: "2026-09-01T09:00:00Z",
        },
      ],
    }),
  );
}

const WEEK_START = "2026-09-07";

async function stubWeek(page: Page): Promise<void> {
  const days = [7, 8, 9, 10, 11, 12, 13].map((d) => `2026-09-${String(d).padStart(2, "0")}`);
  const cells = days.map((_, i) =>
    i === 0 ? { seconds: 3600, pushState: "pushed" } : { seconds: 0, pushState: null },
  );
  await page.route("**/api/week**", (route) =>
    route.fulfill({
      status: 200,
      json: {
        start: WEEK_START,
        end: "2026-09-13",
        prevStart: "2026-08-31",
        nextStart: "2026-09-14",
        weekNumber: 37,
        days: days.map((day, i) => ({
          day,
          seconds: i === 0 ? 3600 : 0,
          pushState: i === 0 ? "pushed" : null,
        })),
        rows: [
          {
            instanceId: 1,
            instanceName: "Ridgeline",
            instancePosition: 0,
            issueKey: "RIDGE-1",
            url: "https://ridgeline.atlassian.net/browse/RIDGE-1",
            cells,
            seconds: 3600,
          },
        ],
        seconds: 3600,
      },
    }),
  );
}

async function expectNoTitledDot(page: Page): Promise<void> {
  expect(await page.locator(".that-dot").count()).toBeGreaterThan(0);
  await expect(page.locator(".that-dot[title]")).toHaveCount(0);
}

async function openTooltips(page: Page): Promise<number> {
  return page.locator("that-tooltip:popover-open").count();
}

async function openSearch(page: Page): Promise<Locator> {
  await page.getByRole("textbox", { name: "Search all instances" }).fill("capacity");
  const panel = page.locator("that-issue-search");
  await expect(panel.getByText("RIDGE-5140")).toBeVisible();

  return panel;
}

test("no instance dot carries a title, on Today, search, Week, the entry dialog and Settings", async ({
  page,
}) => {
  await stubToday(page);
  await page.goto("/today");
  await expect(page.getByRole("region", { name: "Pinned" }).getByText("SHARED-12")).toBeVisible();
  await expectNoTitledDot(page);

  await page.getByRole("button", { name: /Log time against WORK-412/ }).click();
  await expect(page.locator("that-entry-dialog dialog .that-dot")).toBeVisible();
  await expectNoTitledDot(page);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator("[data-row-dot]")).toBeVisible();
  await expectNoTitledDot(page);
  await page.keyboard.press("Escape");

  await openSearch(page);
  await expectNoTitledDot(page);

  await stubWeek(page);
  await page.goto("/week");
  await expect(page.locator("tbody tr", { hasText: "RIDGE-1" })).toBeVisible();
  await expectNoTitledDot(page);
});

test("every role=img dot still names its instance by aria-label", async ({ page }) => {
  await stubToday(page);
  await page.goto("/today");
  await expect(page.getByRole("region", { name: "Pinned" }).getByText("SHARED-12")).toBeVisible();
  await openSearch(page);

  const bare = page.locator(".that-dot[role='img']:not([aria-label='Ridgeline'])");
  await expect(bare).toHaveCount(0);
  expect(await page.locator(".that-dot[role='img']").count()).toBeGreaterThan(0);

  await stubWeek(page);
  await page.goto("/week");
  const dot = page.locator("tbody tr", { hasText: "RIDGE-1" }).locator(".that-dot");
  await expect(dot).toHaveAttribute("aria-label", "Ridgeline");
});

test("hovering a ticket row's dot opens a tooltip naming the instance", async ({ page }) => {
  await stubToday(page);
  await page.goto("/today");
  const card = page.getByRole("region", { name: "Pinned" });
  const dot = card.locator(".that-dot");
  await expect(dot).toBeVisible();

  const tip = card.locator("that-tooltip:popover-open");
  await expect(tip).toHaveCount(0);
  await dot.hover();
  await expect(tip).toHaveCount(1);
  await expect(tip).toHaveText("Ridgeline");
  await expect(dot).not.toHaveAttribute("tabindex");
});

test("hovering a Week row's dot opens a tooltip naming the instance", async ({ page }) => {
  await stubToday(page);
  await stubWeek(page);
  await page.goto("/week");
  const row = page.locator("tbody tr", { hasText: "RIDGE-1" });
  const dot = row.locator(".that-dot");
  await expect(dot).toBeVisible();

  const tip = row.locator("th that-tooltip:popover-open");
  await expect(tip).toHaveCount(0);
  await dot.hover();
  await expect(tip).toHaveCount(1);
  await expect(tip).toHaveText("Ridgeline");
});

test("the other four dots open no tooltip when hovered", async ({ page }) => {
  await stubToday(page);
  await page.goto("/today");
  await expect(page.getByRole("region", { name: "Pinned" }).getByText("SHARED-12")).toBeVisible();

  const heading = page.getByRole("heading", { name: "Ridgeline" }).locator("..").locator(".that-dot");
  await expect(heading).toBeVisible();
  await heading.hover();
  expect(await openTooltips(page)).toBe(0);

  await page.getByRole("button", { name: /Log time against WORK-412/ }).click();
  const entryDot = page.locator("that-entry-dialog dialog .that-dot");
  await expect(entryDot).toBeVisible();
  await entryDot.hover();
  expect(await openTooltips(page)).toBe(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const rowDot = page.locator("[data-row-dot]");
  await expect(rowDot).toBeVisible();
  await rowDot.hover();
  expect(await openTooltips(page)).toBe(0);
  await page.keyboard.press("Escape");

  const panel = await openSearch(page);
  const searchDot = panel.locator(".that-dot").first();
  await searchDot.hover();
  expect(await openTooltips(page)).toBe(0);
});

async function focusTrail(page: Page, presses: number): Promise<string[]> {
  const trail: string[] = [];
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press("Tab");
    trail.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return "none";

        return `${el.tagName.toLowerCase()}|${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 24) ?? ""}`;
      }),
    );
  }

  return trail;
}

const TODAY_TABS = ["button|Settings","a|Today","a|Week","a|How to switch (opens in ","button|Sort by Key","button|Sort by Summary","button|Sort by Status","button|Sort by Today","a|SHARED-12","span|Weekly standup","button|Log time against SHARED-12, 0:00 today","button|start timer","button|Unpin SHARED-12","button|Refresh","input|Search all instances"];
const WEEK_TABS = ["button|Settings","a|Today","a|Week","a|How to switch (opens in ","button|Refresh","button|Fetch worklogs","input|Add a ticket to this week","button|Previous week","button|This week","button|Next week","a|RIDGE-1","button|RIDGE-1, Mon 7, 1h 00m, pushed, click to edit","button|RIDGE-1, Tue 8, no time logged, click to add","button|RIDGE-1, Wed 9, no time logged, click to add","button|RIDGE-1, Thu 10, no time logged, click to add"];

test("a dot is never a Tab stop", async ({ page }) => {
  await stubToday(page);
  await page.goto("/today");
  await expect(page.getByRole("region", { name: "Pinned" }).getByText("SHARED-12")).toBeVisible();
  await expect(page.locator(".that-dot[tabindex]")).toHaveCount(0);
  expect(await focusTrail(page, 15)).toEqual(TODAY_TABS);

  await stubWeek(page);
  await page.goto("/week");
  await expect(page.locator("tbody tr", { hasText: "RIDGE-1" })).toBeVisible();
  await expect(page.locator(".that-dot[tabindex]")).toHaveCount(0);
  expect(await focusTrail(page, 15)).toEqual(WEEK_TABS);
});
