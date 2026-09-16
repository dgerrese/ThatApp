import { expect, test, type Page } from "@playwright/test";

/**
 * The colour a Tailwind utility class actually resolves to in this browser,
 * read off a throwaway probe rather than a literal `oklch()` string here —
 * see push.spec.ts's own copy of this helper for why: it tracks
 * web/src/styles.css itself rather than a value that could drift from it.
 */
async function computedColor(
  page: Page,
  className: string,
  property: "color" | "backgroundColor",
): Promise<string> {
  return page.evaluate(
    ({ className, property }) => {
      const probe = document.createElement("span");
      probe.className = className;
      document.body.appendChild(probe);
      const value = getComputedStyle(probe)[property];
      probe.remove();

      return value;
    },
    { className, property },
  );
}

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

/** Enough hits under one instance to overflow any plausible viewport — task
 *  10's own scenario for a panel that would otherwise run past the window. */
function manyHits(count: number): StubHit[] {
  return Array.from({ length: count }, (_, i) =>
    hit(1, "Ridgeline", 0, `RIDGE-${5000 + i}`, `Capacity issue number ${i}`),
  );
}

/** The panel itself — `that-issue-search`'s last direct `<div>`, the same
 *  locator search.spec.ts's own width test already uses. */
function panel(page: Page) {
  return page.locator("that-issue-search").locator("> div").last();
}

/** The rows area inside the panel — its first child once task 10 splits the
 *  panel into a scrolling rows region and a fixed footer beneath it. */
function rowsArea(page: Page) {
  return panel(page).locator("> div").first();
}

test.describe("that-issue-search on Today", () => {
  test.beforeEach(async ({ page }) => {
    await stubPins(page, []);
    await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
    // The off-list section (#84's own decision 2 addendum) now reads today's
    // entries on every mount and looks up any that are neither assigned nor
    // pinned — which, against the shared dev database this e2e stack points
    // at, could be any stray entry left over from other use. Left unstubbed,
    // that lookup is a real /api/issues/search call this describe block's
    // own request-count assertions never budgeted for.
    await stubEntries(page);
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

  // Round 2 finding: the prototype draws two bargains for the "Log" hint —
  // reserved width, opacity-only fade (right in a table) and no width at
  // rest (right in this 300px panel, where reserving it costs the summary).
  // Every result row in the drawing uses the second. This is the case that
  // would fail against the first: the hint claiming space before it is ever
  // hovered.
  test("the duration control's hint claims no width until hovered", async ({ page }) => {
    await stubSearch(page, [ridge5140]);
    await page.goto("/today");

    await searchField(page).fill("capacity");
    const trigger = resultRow(page, "RIDGE-5140").getByRole("button", {
      name: "Log time against RIDGE-5140",
      exact: true,
    });
    await expect(trigger).toBeVisible();

    const hintWidth = () =>
      trigger.evaluate((el) => el.querySelector("span")?.getBoundingClientRect().width ?? -1);

    expect(await hintWidth()).toBeLessThanOrEqual(1);

    await trigger.hover();
    await expect.poll(hintWidth).toBeGreaterThan(10);
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

  // Each keystroke is 20ms apart — far under the 350ms debounce — so a correct
  // implementation fires exactly one request after the last one, not one per
  // keystroke. Moved from the deleted pin form's own coverage: the debounce is
  // this component's own logic (runSearch/scheduleSearch), not something that
  // left with the form.
  test("rapid keystrokes are coalesced into a single search", async ({ page }) => {
    const search = await stubSearch(page, [ridge5140]);
    await page.goto("/today");

    await searchField(page).pressSequentially("capacity", { delay: 20 });
    await expect(page.getByText("RIDGE-5140")).toBeVisible();

    expect(search.calls()).toBe(1);
  });

  // A pending debounce timer that outlives the panel closing would fire on a
  // superseded query and repaint a panel the user has already dismissed —
  // this is what scheduleSearch's clearTimeout (and close()'s) guards
  // against. Escape is this component's own way to close, replacing the
  // deleted form's Cancel button.
  test("closing the field within the debounce window makes no request", async ({ page }) => {
    const search = await stubSearch(page, []);
    await page.goto("/today");

    const field = searchField(page);
    await field.fill("capacity");
    // Well inside the 350ms debounce window: the timer it started has not fired.
    await field.press("Escape");
    await page.waitForTimeout(500);

    expect(search.calls()).toBe(0);
  });

  // A second keystroke aborts the first request's fetch. request()'s bare
  // catch in api.ts turns any thrown error, AbortError included, into a
  // user-facing "Could not reach the dashboard server." — that guard is what
  // this proves: remove it and the superseded first search paints an outage
  // message over a second search that is still working correctly.
  test("a keystroke that supersedes a slow search never shows a network error", async ({ page }) => {
    let calls = 0;
    await page.route("**/api/issues/search**", async (route) => {
      calls += 1;
      const firstCall = calls === 1;
      if (firstCall) {
        // Long enough that the second keystroke's debounce fires and aborts
        // this request well before it would otherwise resolve.
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      await route.fulfill({ status: 200, json: { results: [ridge5140], errors: [] } }).catch(() => {
        // The client already cancelled the underlying network request for the
        // aborted first call; the route has nothing left to fulfil.
      });
    });
    await page.goto("/today");
    const field = searchField(page);

    await field.fill("ca");
    await expect(page.getByText("Searching…")).toBeVisible();
    await field.fill("capacity");

    await expect(page.getByText("RIDGE-5140")).toBeVisible();
    await expect(page.getByText("Could not reach the dashboard server.")).toHaveCount(0);
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

  // Distinct from the mixed case above: zero results and every instance
  // failing must not fall into showResults' "no issues match" branch, which
  // is for a search that ran cleanly and found nothing — a reader here must
  // see why there is nothing, not a false "no matches".
  test("every instance failing shows an error rather than an empty list", async ({ page }) => {
    await stubSearch(page, [], [
      {
        instanceId: 1,
        instanceName: "Ridgeline",
        error: { code: "instance_unreachable", message: "the Jira site could not be reached" },
      },
    ]);
    await page.goto("/today");

    await searchField(page).fill("capacity");

    await expect(page.getByText("Ridgeline could not be searched.")).toBeVisible();
    await expect(page.getByText(/No issues match/)).toHaveCount(0);
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

  // 2026-09-10 review of #84's own Task 7: the deleted pin form disabled an
  // option for a ticket already pinned; the panel had no equivalent, so
  // pressing pin on an already-pinned result sent a request the server could
  // only refuse. The panel now shows the truth instead — the filled pin mark,
  // exactly as that-ticket-row's own control draws it for a pinned row — and
  // pressing it unpins.
  test("a result already pinned renders the filled pin mark, and pressing it unpins", async ({
    page,
  }) => {
    await stubSearch(page, [ridge5140]);
    await stubPins(
      page,
      [
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
      ],
      [],
    );
    let deleteMethod: string | null = null;
    await page.route("**/api/pins/9", async (route) => {
      deleteMethod = route.request().method();
      await route.fulfill({ status: 204, body: "" });
    });

    await page.goto("/today");
    const pinnedCard = page.getByRole("region", { name: "Pinned" });
    await expect(pinnedCard.getByText("RIDGE-5140")).toBeVisible();

    await searchField(page).fill("capacity");

    const unpinButton = resultRow(page, "RIDGE-5140").getByRole("button", {
      name: "Unpin RIDGE-5140",
      exact: true,
    });
    // The filled mark alone says "pinned" now (2026-09-10): the control took
    // text-primary at rest before that date, but the colour moved to hover
    // and focus-visible, so the proof here is the crossed-pin role name, not
    // a class.
    await expect(unpinButton).toBeVisible();
    await expect(
      resultRow(page, "RIDGE-5140").getByRole("button", { name: "Pin RIDGE-5140", exact: true }),
    ).toHaveCount(0);

    await unpinButton.hover();
    await expect(page.locator("that-issue-search that-tooltip")).toHaveText("unpin ticket");

    await unpinButton.click();

    await expect.poll(() => deleteMethod).toBe("DELETE");
    await expect(pinnedCard.getByText("RIDGE-5140")).toHaveCount(0);
  });

  // 2026-09-10, folded into #84: the panel's own icon control mirrors
  // that-ticket-row's paintPinned deliberately, so it takes the same
  // treatment that ticket gave the row's control — muted at rest, primary
  // only on hover or focus, pinned or not.
  test("the panel's icon control is muted at rest and primary on hover, pinned or not", async ({
    page,
  }) => {
    await stubSearch(page, [ridge5140]);
    await stubPins(page, []);

    await page.goto("/today");
    await searchField(page).fill("capacity");

    const mutedColor = await computedColor(page, "text-ink-muted", "color");
    const primaryColor = await computedColor(page, "text-primary", "color");

    const pinButton = resultRow(page, "RIDGE-5140").getByRole("button", {
      name: "Pin RIDGE-5140",
      exact: true,
    });
    await expect(pinButton).toHaveCSS("color", mutedColor);
    await pinButton.hover();
    await expect(pinButton).toHaveCSS("color", primaryColor);
    await pinButton.focus();
    await expect(pinButton).toHaveCSS("color", primaryColor);
  });

  // Follow-up to the review above, an hour later: the control unpinning had
  // no way to say so itself — it kept reading "Unpin", filled, until the
  // panel was searched again. The owner's decision was "legible before the
  // press", which a stale control after the press defeats just as much as
  // never showing pinned state at all. Covers both directions, and proves
  // each is a local repaint (search.calls() never moves past the one fill)
  // rather than a second network round trip standing in for one.
  test("the panel repaints after a pin or unpin lands, with no new search", async ({ page }) => {
    const search = await stubSearch(page, [ridge5140]);
    const pinnedHit = {
      id: 9,
      instanceId: 1,
      instanceName: "Ridgeline",
      instancePosition: 0,
      key: "RIDGE-5140",
      summary: ridge5140.summary,
      status: "To Do",
      url: ridge5140.url,
      error: null,
    };
    await stubPins(page, [pinnedHit], [], [{ ...pinnedHit, id: 10 }]);
    await page.route("**/api/pins/9", (route) => route.fulfill({ status: 204, body: "" }));
    let pinPosts = 0;
    await page.route("**/api/pins", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      pinPosts += 1;
      await route.fulfill({ status: 201, json: { ...pinnedHit, id: 10 } });
    });

    await page.goto("/today");
    await searchField(page).fill("capacity");

    const row = resultRow(page, "RIDGE-5140");
    const pinButton = row.getByRole("button", { name: "Pin RIDGE-5140", exact: true });
    const unpinButton = row.getByRole("button", { name: "Unpin RIDGE-5140", exact: true });

    await expect(unpinButton).toBeVisible();
    expect(search.calls()).toBe(1);

    await unpinButton.click();

    // Repainted in place: the control itself flips without searchField ever
    // being touched again, and search.calls() proves nothing asked Jira for
    // it. The mark (role name) is the proof, not a class — see 2026-09-10's
    // note above on where the colour moved to.
    await expect(pinButton).toBeVisible();
    await expect(unpinButton).toHaveCount(0);
    expect(search.calls()).toBe(1);

    await pinButton.click();

    // The reverse direction, same guard: pinning repaints the same row back
    // to "Unpin", filled, with still no second search.
    await expect(unpinButton).toBeVisible();
    await expect(pinButton).toHaveCount(0);
    expect(search.calls()).toBe(1);
    expect(pinPosts).toBe(1);
  });
});

// Task 10, added 2026-09-16 after the plan and the fix wave: the panel grew
// without limit, so a wide result set pushed the real scroll region's content
// past its own bottom and the page scrolled to reach it. The owner's rule:
// the panel grows only until it would reach the window's bottom edge (minus
// the app's 16px gutter — gap-4's own step), then scrolls inside itself.
test.describe("the search panel's height stops at the window's edge", () => {
  test.beforeEach(async ({ page }) => {
    await stubPins(page, []);
    await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
    await stubEntries(page);
    await page.setViewportSize({ width: 1280, height: 600 });
  });

  test("a small viewport with many hits caps the panel at the gutter, scrolls the rows, and never scrolls the real region", async ({
    page,
  }) => {
    await stubSearch(page, manyHits(25));
    await page.goto("/today");

    // The real scroll region: index.html's grid fixes itself to the screen
    // from md: up and splits its own overflow between the rail and #content
    // — this is what would have to scroll to reach the panel's end before
    // task 10, not the document.
    const content = page.locator("#content");
    const before = await content.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(before.scrollHeight).toBeLessThanOrEqual(before.clientHeight);

    await searchField(page).fill("capacity");
    await expect(panel(page)).toBeVisible();

    const panelBox = await panel(page).boundingBox();
    expect(panelBox).not.toBeNull();
    // At or above window.innerHeight - 16, the standard gutter.
    expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(600 - 16 + 0.5);

    const rows = await rowsArea(page).evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(rows.scrollHeight).toBeGreaterThan(rows.clientHeight);

    const after = await content.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(after.scrollHeight).toBeLessThanOrEqual(after.clientHeight);
    expect(after.scrollHeight).toBe(before.scrollHeight);
  });

  test("the last result row is reachable by scrolling the rows area, and the footer stays put", async ({
    page,
  }) => {
    const hits = manyHits(25);
    await stubSearch(page, hits);
    await page.goto("/today");
    await searchField(page).fill("capacity");
    await expect(panel(page)).toBeVisible();

    const footer = page.getByText(
      "Searching all instances by key and summary. Not limited to issues assigned to you.",
    );
    const footerBefore = await footer.boundingBox();
    expect(footerBefore).not.toBeNull();

    const lastKey = hits[hits.length - 1]!.key;
    const lastRow = resultRow(page, lastKey);
    const areaBoxBefore = await rowsArea(page).boundingBox();
    const rowBoxBefore = await lastRow.boundingBox();
    expect(areaBoxBefore).not.toBeNull();
    expect(rowBoxBefore).not.toBeNull();
    // Off the bottom of the rows area before scrolling — proves it needs it.
    expect(rowBoxBefore!.y).toBeGreaterThan(areaBoxBefore!.y + areaBoxBefore!.height);

    await rowsArea(page).evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });

    const rowBoxAfter = await lastRow.boundingBox();
    const areaBoxAfter = await rowsArea(page).boundingBox();
    expect(rowBoxAfter).not.toBeNull();
    expect(areaBoxAfter).not.toBeNull();
    expect(rowBoxAfter!.y).toBeGreaterThanOrEqual(areaBoxAfter!.y - 1);
    expect(rowBoxAfter!.y + rowBoxAfter!.height).toBeLessThanOrEqual(
      areaBoxAfter!.y + areaBoxAfter!.height + 1,
    );

    const footerAfter = await footer.boundingBox();
    expect(footerAfter).not.toBeNull();
    expect(footerAfter!.y).toBeCloseTo(footerBefore!.y, 0);
  });

  test("with few hits the panel is no taller than its content", async ({ page }) => {
    await stubSearch(page, [ridge5140]);
    await page.goto("/today");
    await searchField(page).fill("capacity");
    await expect(panel(page)).toBeVisible();

    const rows = await rowsArea(page).evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    // Nothing to scroll: the one row fits, so no internal scrollbar opens.
    expect(rows.scrollHeight).toBeLessThanOrEqual(rows.clientHeight + 1);

    const panelBox = await panel(page).boundingBox();
    expect(panelBox).not.toBeNull();
    // Comfortably short of the ~580px the 600px viewport's gutter would
    // allow — proof the panel sized to its own content, not to the cap.
    expect(panelBox!.height).toBeLessThan(200);
  });

  test("the first row's tooltip stays fully visible on hover, not clipped by the rows area", async ({
    page,
  }) => {
    await stubSearch(page, manyHits(25));
    await page.goto("/today");
    await searchField(page).fill("capacity");
    await expect(panel(page)).toBeVisible();

    const firstPin = resultRow(page, "RIDGE-5000").getByRole("button", {
      name: "Pin RIDGE-5000",
      exact: true,
    });
    await firstPin.hover();

    // Every row carries its own that-tooltip; :popover-open narrows to the
    // one hover actually opened, the same disambiguation a real reader gets
    // for free by only ever seeing one at a time.
    const tooltip = page.locator("that-issue-search that-tooltip:popover-open");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText("pin ticket");

    const box = await tooltip.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(600);
  });

  // Not one of task 10's four named tests, but its own ruling demands the
  // browser's default focus-follows-scroll still works once rows sit inside
  // an overflow container — Element.focus() scrolls its target into view by
  // default, the same mechanism a real Tab keypress relies on.
  test("focusing a control deep in the scrolled list scrolls the rows area to reach it", async ({
    page,
  }) => {
    const hits = manyHits(25);
    await stubSearch(page, hits);
    await page.goto("/today");
    await searchField(page).fill("capacity");
    await expect(panel(page)).toBeVisible();

    const lastKey = hits[hits.length - 1]!.key;
    const lastPin = resultRow(page, lastKey).getByRole("button", {
      name: `Pin ${lastKey}`,
      exact: true,
    });

    await lastPin.focus();
    await expect(lastPin).toBeFocused();

    const scrollTop = await rowsArea(page).evaluate((el) => el.scrollTop);
    expect(scrollTop).toBeGreaterThan(0);
  });
});
