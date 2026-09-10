import { expect, test, type Page } from "@playwright/test";

/**
 * Task 3 (that-issue-search) and Task 4 (Today's use of it) were dispatched
 * as one task — see .superpowers/sdd/2026-09-10-global-search/progress.md's
 * pre-flight ruling — because Task 3's own assertions type into a field only
 * Task 4 creates. Both briefs name this file as their test, so both live
 * here rather than being split across a red commit and a green one.
 */

interface StubHit {
  instanceId: number;
  instanceName: string;
  instancePosition: number;
  key: string;
  summary: string;
  status: string;
  url: string;
}

interface StubFailure {
  instanceId: number;
  instanceName: string;
  error: { code: string; message: string };
}

function hit(
  instanceId: number,
  instanceName: string,
  instancePosition: number,
  key: string,
  summary: string,
): StubHit {
  return {
    instanceId,
    instanceName,
    instancePosition,
    key,
    summary,
    status: "To Do",
    url: `https://example.atlassian.net/browse/${key}`,
  };
}

async function stubSearch(
  page: Page,
  results: StubHit[],
  errors: StubFailure[] = [],
): Promise<{ calls: () => number }> {
  let calls = 0;
  await page.route("**/api/issues/search**", async (route) => {
    calls += 1;
    await route.fulfill({ status: 200, json: { results, errors } });
  });
  return { calls: () => calls };
}

async function stubPins(page: Page, first: unknown[], ...rest: unknown[][]): Promise<void> {
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

async function stubEntries(page: Page): Promise<{ posted: Record<string, unknown>[] }> {
  const posted: Record<string, unknown>[] = [];
  await page.route("**/api/entries**", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      posted.push(body);
      await route.fulfill({
        status: 201,
        json: {
          id: 900 + posted.length,
          instanceId: body["instanceId"],
          instanceName: "Ridgeline",
          instancePosition: 0,
          issueKey: body["issueKey"],
          day: "2026-09-10",
          startedAt: "2026-09-10T09:15:00+02:00",
          seconds: body["seconds"],
          comment: body["comment"] ?? "",
          pushState: "unpushed",
        },
      });
      return;
    }
    await route.fulfill({ status: 200, json: { today: "2026-09-10", entries: [] } });
  });
  return { posted };
}

const ridge5140 = hit(1, "Ridgeline", 0, "RIDGE-5140", "Capacity planning spreadsheet is out of date");
const nw1204 = hit(2, "Northwind", 1, "NW-1204", "Capacity alerts fire twice for the same threshold");

function searchField(page: Page) {
  return page.getByRole("textbox", { name: "Search all instances" });
}

/** The result row for `key`, scoped from the key's own link — the only
 *  element in a row that names its ticket, since a control's accessible name
 *  is fixed per IssueSearchControl and repeats across every row. */
function resultRow(page: Page, key: string) {
  return page.getByTitle(`Open ${key} in Jira`).locator("..");
}

test.describe("that-issue-search on Today", () => {
  test.beforeEach(async ({ page }) => {
    await stubPins(page, []);
    await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
  });

  test("the field sits in the Assigned issues header beside Refresh", async ({ page }) => {
    await page.goto("/today");

    const region = page.getByRole("region", { name: "Assigned issues" });
    const refresh = region.getByRole("button", { name: "Refresh" });
    const field = searchField(page);

    await expect(field).toBeVisible();
    const refreshBox = await refresh.boundingBox();
    const fieldBox = await field.boundingBox();
    expect(refreshBox).not.toBeNull();
    expect(fieldBox).not.toBeNull();
    expect(fieldBox!.x).toBeGreaterThan(refreshBox!.x);
  });

  // Called out twice in the task's own brief: the drawing gives the field an
  // exact width and has the panel span it exactly, not merely "about as wide".
  test("the field is 300px wide and the panel spans it exactly", async ({ page }) => {
    await stubSearch(page, [ridge5140]);
    await page.goto("/today");

    const field = page.locator("that-issue-search");
    await expect(field).toHaveJSProperty("offsetWidth", 300);

    await searchField(page).fill("capacity");
    const panel = field.locator("> div").last();
    await expect(panel).toBeVisible();

    const fieldBox = await field.boundingBox();
    const panelBox = await panel.boundingBox();
    expect(fieldBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    // Within a couple of pixels rather than exact: the panel is positioned
    // against the field's padding box (inset-x-0), one border-width narrower
    // than its border box on each side — the same reading the prototype's own
    // `.results { left:0; right:0 }` against `.field`'s bordered box gives.
    expect(Math.abs(panelBox!.x - fieldBox!.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(panelBox!.width - fieldBox!.width)).toBeLessThanOrEqual(2);
  });

  // Review finding 1: the duration control is the same one a real row draws
  // (#84's own body), rendered here as a static variant — the "Log" hint over
  // a fixed 0:00 figure, not a plain icon.
  test("a result row carries the drawn duration control, not a bare icon", async ({ page }) => {
    await stubSearch(page, [ridge5140]);
    await page.goto("/today");

    await searchField(page).fill("capacity");

    const trigger = resultRow(page, "RIDGE-5140").getByRole("button", {
      name: "Log time against RIDGE-5140",
      exact: true,
    });
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveText("Log0:00");
  });

  // Review finding 4: a fixed label would read identically on every row —
  // this proves the two rows above carry two different accessible names.
  test("two rows' duration controls carry two different accessible names", async ({ page }) => {
    await stubSearch(page, [ridge5140, nw1204]);
    await page.goto("/today");

    await searchField(page).fill("capacity");

    await expect(
      page.getByRole("button", { name: "Log time against RIDGE-5140", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Log time against NW-1204", exact: true }),
    ).toBeVisible();
  });

  // Review finding 3: the drawing's `.iconbtn` carries a `.tip` popover, and
  // the assigned list's own pin control already does too — this result row's
  // pin should not read as a different kind of control.
  test("the pin control carries a tooltip reading exactly \"pin ticket\"", async ({ page }) => {
    await stubSearch(page, [ridge5140]);
    await page.goto("/today");

    await searchField(page).fill("capacity");
    await resultRow(page, "RIDGE-5140")
      .getByRole("button", { name: "Pin RIDGE-5140", exact: true })
      .hover();

    const tooltip = page.locator("that-issue-search that-tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText("pin ticket");
  });

  // Review finding 2: the missing screen-reader signal that typing opened a
  // popup, and that closing it closes one.
  test("the field's aria-expanded follows the panel open and closed", async ({ page }) => {
    await stubSearch(page, [ridge5140]);
    await page.goto("/today");

    const field = searchField(page);
    await expect(field).toHaveAttribute("aria-expanded", "false");

    await field.fill("capacity");
    await expect(page.getByText("RIDGE-5140")).toBeVisible();
    await expect(field).toHaveAttribute("aria-expanded", "true");

    await field.press("Escape");
    await expect(field).toHaveAttribute("aria-expanded", "false");
  });

  test("the field's aria-controls names the panel it expands", async ({ page }) => {
    await page.goto("/today");

    const field = searchField(page);
    const controls = await field.getAttribute("aria-controls");
    expect(controls).toBeTruthy();

    const panel = page.locator(`#${controls}`);
    await expect(panel).toHaveCount(1);
    // The panel it names is inside the same component, not a stray id match.
    await expect(page.locator("that-issue-search").locator(`#${controls}`)).toHaveCount(1);
  });

  test("typing fewer than two characters reaches no network", async ({ page }) => {
    const search = await stubSearch(page, []);
    await page.goto("/today");

    await searchField(page).fill("r");
    await page.waitForTimeout(600);

    expect(search.calls()).toBe(0);
  });

  test("results group under their instance name with the instance dot", async ({ page }) => {
    await stubSearch(page, [ridge5140, nw1204]);
    await page.goto("/today");

    await searchField(page).fill("capacity");

    // Scoped to the panel itself: the assigned Ridgeline card carries its own
    // instance dot, of the same accessible name, right below.
    const panel = page.locator("that-issue-search");
    await expect(panel.getByText("RIDGE-5140")).toBeVisible();
    await expect(panel.getByText("NW-1204")).toBeVisible();
    await expect(panel.getByRole("img", { name: "Ridgeline" })).toBeVisible();
    await expect(panel.getByRole("img", { name: "Northwind" })).toBeVisible();

    // The dot precedes the row it groups, not the other way round: proves
    // grouping rather than mere co-presence of a dot and a row somewhere.
    const ridgelineDotY = (await panel.getByRole("img", { name: "Ridgeline" }).boundingBox())!.y;
    const ridge5140Y = (await panel.getByText("RIDGE-5140").boundingBox())!.y;
    expect(ridgelineDotY).toBeLessThan(ridge5140Y);
  });

  test("the footer sentence is present", async ({ page }) => {
    await stubSearch(page, [ridge5140]);
    await page.goto("/today");

    await searchField(page).fill("capacity");

    await expect(
      page.getByText(
        "Searching all instances by key and summary. Not limited to issues assigned to you.",
      ),
    ).toBeVisible();
  });

  test("an instance in the errors array is named on screen rather than silently dropped", async ({
    page,
  }) => {
    await stubSearch(page, [ridge5140], [
      {
        instanceId: 2,
        instanceName: "Northwind",
        error: { code: "instance_unreachable", message: "the Jira site could not be reached" },
      },
    ]);
    await page.goto("/today");

    await searchField(page).fill("capacity");

    await expect(page.getByText("Northwind could not be searched.")).toBeVisible();
  });

  test("a search that matches nothing shows an empty state distinct from the failure line", async ({
    page,
  }) => {
    await stubSearch(page, []);
    await page.goto("/today");

    await searchField(page).fill("zzz");

    await expect(page.getByText("No issues match “zzz”.")).toBeVisible();
    await expect(page.getByText("could not be searched.")).toHaveCount(0);
  });

  test("typing does not change the rows underneath", async ({ page }) => {
    await stubIssues(page, [
      {
        id: 1,
        name: "Ridgeline",
        error: null,
        issues: [
          {
            key: "WORK-412",
            summary: "Fix the CSV export encoding",
            status: "In Progress",
            url: "https://example.atlassian.net/browse/WORK-412",
          },
        ],
      },
    ]);
    await stubSearch(page, [nw1204]);
    await page.goto("/today");

    await expect(page.getByText("WORK-412")).toBeVisible();
    const before = await page.locator("that-ticket-row").count();

    await searchField(page).fill("capacity");
    await expect(page.getByText("NW-1204")).toBeVisible();

    // It is a lookup, not a filter: the assigned rows survive a search that
    // matches neither of them, unchanged in count and content.
    await expect(page.getByText("WORK-412")).toBeVisible();
    expect(await page.locator("that-ticket-row").count()).toBe(before);
  });

  test("logging from a result posts to /api/entries with no day and no pin request", async ({
    page,
  }) => {
    await stubSearch(page, [ridge5140]);
    const entries = await stubEntries(page);
    let pinPosted = false;
    await page.route("**/api/pins", async (route) => {
      if (route.request().method() === "POST") pinPosted = true;
      await route.fallback();
    });

    await page.goto("/today");
    await searchField(page).fill("capacity");
    await expect(page.getByText("RIDGE-5140")).toBeVisible();

    await resultRow(page, "RIDGE-5140")
      .getByRole("button", { name: "Log time against RIDGE-5140", exact: true })
      .click();

    const dialog = page.locator("that-entry-dialog dialog");
    await dialog.getByLabel("Duration").fill("15");
    await dialog.getByLabel("Duration").press("Enter");
    await dialog.getByRole("button", { name: "Add entry" }).click();

    await expect.poll(() => entries.posted.length).toBe(1);
    expect(entries.posted[0]).toMatchObject({ instanceId: 1, issueKey: "RIDGE-5140" });
    expect(entries.posted[0]["day"]).toBeUndefined();
    expect(pinPosted).toBe(false);
  });

  test("the pinned list gains a row when the pin control is pressed", async ({ page }) => {
    await stubSearch(page, [ridge5140]);
    await stubPins(page, [], [
      {
        id: 9,
        instanceId: 1,
        instanceName: "Ridgeline",
        instancePosition: 0,
        key: "RIDGE-5140",
        summary: ridge5140.summary,
        status: "To Do",
        url: ridge5140.url,
        error: null,
      },
    ]);
    await page.route("**/api/pins", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 201,
        json: {
          id: 9,
          instanceId: 1,
          instanceName: "Ridgeline",
          instancePosition: 0,
          key: "RIDGE-5140",
          summary: ridge5140.summary,
          status: "To Do",
          url: ridge5140.url,
          error: null,
        },
      });
    });

    await page.goto("/today");
    await searchField(page).fill("capacity");
    await expect(page.getByText("RIDGE-5140")).toBeVisible();

    await resultRow(page, "RIDGE-5140")
      .getByRole("button", { name: "Pin RIDGE-5140", exact: true })
      .click();

    const pinnedCard = page.getByRole("region", { name: "Pinned" });
    await expect(pinnedCard.getByText("RIDGE-5140")).toBeVisible();
  });
});
