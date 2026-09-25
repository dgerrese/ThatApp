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
 *  is fixed per IssueSearchControl and repeats across every row. Reaches the
 *  ancestor carrying `data-hit-key` rather than a fixed number of `..` hops
 *  (#143 nested the key inside its own text column), so it stays correct
 *  regardless of how deep the key sits. By role and exact name rather than
 *  `getByTitle` (#143 dropped the key link's native title for the app's own
 *  tooltip) — `exact` so e.g. "RIDGE-5000" does not also match "RIDGE-50001". */
function resultRow(page: Page, key: string) {
  return page
    .getByRole("link", { name: key, exact: true })
    .locator("xpath=ancestor::*[@data-hit-key]");
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

    // :popover-open: the row's own summary carries a cut-text tooltip too
    // (#143), so a bare "that-tooltip" locator would match both.
    const tooltip = page.locator("that-issue-search that-tooltip:popover-open");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText("pin ticket");
  });

  // #143: the key link drops its native title for the app's own tooltip, the
  // same treatment the pin control's tooltip above already gets.
  test("the key link carries a tooltip reading exactly \"open in Jira\", not a native title", async ({
    page,
  }) => {
    await stubSearch(page, [ridge5140]);
    await page.goto("/today");

    await searchField(page).fill("capacity");
    const key = resultRow(page, "RIDGE-5140").getByRole("link", { name: "RIDGE-5140" });
    await expect(key).not.toHaveAttribute("title");

    // hasText, not :popover-open: the row's own summary carries a cut-text
    // tooltip too (#143), and focusing the key link opens that one as well
    // when the summary is cut — this scopes to the key's own tooltip by its
    // fixed text regardless.
    const tooltip = page.locator("that-issue-search that-tooltip", { hasText: "open in Jira" });

    await key.hover();
    await expect(tooltip).toBeVisible();

    await page.mouse.move(0, 0);
    await expect(tooltip).toBeHidden();

    await key.focus();
    await expect(tooltip).toBeVisible();
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
    // :popover-open: the row's own summary carries a cut-text tooltip too
    // (#143), so a bare "that-tooltip" locator would match both.
    await expect(page.locator("that-issue-search that-tooltip:popover-open")).toHaveText(
      "unpin ticket",
    );

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

  // Whole-branch review, final pass: showResults rebuilt a brand-new rows
  // container on every call, so repaint() (routed through it) threw a
  // scrolled reader back to the top and dropped focus to <body> the moment
  // any repaint fired while the panel was open and scrolled — a pin, an
  // unpin, or a background Refresh elsewhere on the page (today.ts calls
  // regions.search.repaint() on every path through refreshPins). 25 hits,
  // same as the height tests, but this is the one thing they never did:
  // scroll, then act.
  test("pinning from a scrolled result list keeps the scroll position", async ({ page }) => {
    const hits = manyHits(25);
    await stubSearch(page, hits);
    const target = hits[19]!;
    const pinnedHit = {
      id: 9,
      instanceId: target.instanceId,
      instanceName: target.instanceName,
      instancePosition: target.instancePosition,
      key: target.key,
      summary: target.summary,
      status: target.status,
      url: target.url,
      error: null,
    };
    // A second GET response, not just the POST's own: pinTicket re-fetches
    // /api/pins after a successful post, and the row's own icon reads
    // pinnedKeysOf(regions) — fed by that fetch, not the POST body.
    await stubPins(page, [], [pinnedHit]);
    await page.route("**/api/pins", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      await route.fulfill({ status: 201, json: pinnedHit });
    });

    await page.goto("/today");
    await searchField(page).fill("capacity");
    await expect(panel(page)).toBeVisible();

    const targetRow = resultRow(page, target.key);
    await targetRow.scrollIntoViewIfNeeded();
    const scrollBefore = await rowsArea(page).evaluate((el) => el.scrollTop);
    expect(scrollBefore).toBeGreaterThan(0);

    await targetRow.getByRole("button", { name: `Pin ${target.key}`, exact: true }).click();
    await expect(
      targetRow.getByRole("button", { name: `Unpin ${target.key}`, exact: true }),
    ).toBeVisible();

    const scrollAfter = await rowsArea(page).evaluate((el) => el.scrollTop);
    expect(scrollAfter).toBeGreaterThan(0);
    expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThanOrEqual(2);
  });

  // Same finding, the other half: replaceChildren tore out whichever
  // control had focus — the one just pressed — and nothing put focus back
  // anywhere, so it fell to <body>. Enter, not click(): a click's own
  // focus-follows-activation behaviour already differs between the target
  // browsers (see that-tooltip.ts's own note on it) and would mask whether
  // this component's own repaint is what kept focus, rather than the click.
  test("activating a control by keyboard keeps focus on its equivalent after the repaint", async ({
    page,
  }) => {
    await stubSearch(page, [ridge5140]);
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
    await stubPins(page, [], [pinnedHit]);
    await page.route("**/api/pins", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      await route.fulfill({ status: 201, json: pinnedHit });
    });

    await page.goto("/today");
    await searchField(page).fill("capacity");

    const row = resultRow(page, "RIDGE-5140");
    const pinButton = row.getByRole("button", { name: "Pin RIDGE-5140", exact: true });
    await pinButton.focus();
    await pinButton.press("Enter");

    const unpinButton = row.getByRole("button", { name: "Unpin RIDGE-5140", exact: true });
    await expect(unpinButton).toBeVisible();
    await expect(unpinButton).toBeFocused();
  });

  // Re-review of the blocker fix: captureFocus only ever recognised an
  // element carrying data-control-index, which the row's own key link
  // (keyLabel's <a>) never did — the one focusable thing in a row that is
  // not one of config.controls. Live path: tab into a row, land on the key,
  // a background Refresh elsewhere on the page calls repaint() — simulated
  // directly here (repaint() is already today.ts's own external contract
  // with this component) rather than wiring up a whole Refresh press just
  // to reach the same call.
  test("focus on the key link survives a repaint, not only a control", async ({ page }) => {
    await stubSearch(page, [ridge5140]);
    await stubPins(page, []);

    await page.goto("/today");
    await searchField(page).fill("capacity");

    const keyLink = page.getByRole("link", { name: "RIDGE-5140", exact: true });
    await keyLink.focus();
    await expect(keyLink).toBeFocused();

    await page.evaluate(() => {
      const search = document.querySelector("that-issue-search") as unknown as {
        repaint: () => void;
      };
      search.repaint();
    });

    await expect(keyLink).toBeFocused();
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

  // Review round 1: getBoundingClientRect/boundingBox() are unaffected by
  // ancestor clipping and toBeVisible() does not check it either, so a bound
  // check against the viewport alone (the row sits ~150px into a 600px
  // window either way) would hold whether or not the tooltip actually
  // escapes rowsArea's overflow-y: auto. This compares against rowsArea's
  // own box instead: an ordinary clipped descendant could never legitimately
  // render above that box's own top edge, so this only holds because
  // that-tooltip is a top-layer popover, positioned in the viewport's own
  // coordinate space rather than the rows area's.
  //
  // #143 update: stacking the key over the summary made a row taller than
  // the pin control it centres, which pushes the control (and so the
  // tooltip that opens above it) down within the row. Unscrolled, the very
  // first row now sits close enough under the group heading that its
  // tooltip no longer needs to clear rowsArea's own top edge at all — the
  // scenario this test exists to prove would stop proving anything. Scrolled
  // by exactly the first row's own distance from the top (measured, not
  // hard-coded, so this stays correct if either height changes again), the
  // same row sits flush with rowsArea's top instead, which restores the
  // original scenario: opening above it pushes the tooltip past the area's
  // own edge regardless of how tall the row itself is.
  test("the first row's tooltip escapes the rows area's own clipping box via the top layer", async ({
    page,
  }) => {
    await stubSearch(page, manyHits(25));
    await page.goto("/today");
    await searchField(page).fill("capacity");
    await expect(panel(page)).toBeVisible();

    const areaBox = await rowsArea(page).boundingBox();
    expect(areaBox).not.toBeNull();

    const firstRow = resultRow(page, "RIDGE-5000");
    const firstRowBox = await firstRow.boundingBox();
    expect(firstRowBox).not.toBeNull();
    await rowsArea(page).evaluate((el, delta) => {
      el.scrollTop = delta;
    }, firstRowBox!.y - areaBox!.y);

    const firstPin = firstRow.getByRole("button", {
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
    expect(box!.y).toBeLessThan(areaBox!.y);
    expect(box!.y).toBeGreaterThanOrEqual(0);
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

  // Controller ruling, review round 1: the cap only ever re-measured on
  // open, repaint and resize — not while the scrolling region itself moves
  // under an already-open panel. Repro: open the panel, scroll the region so
  // the field rises high (a generous cap gets computed from that position),
  // then scroll back so the field drops part way back down — the panel's
  // own top follows it (drawn under it in CSS), but a max-height computed
  // once would not, and the panel would run past the window's bottom again.
  //
  // Real page content bounds how high the field can rise only by exactly as
  // much room as whatever trails it (#content can never scroll further than
  // its own last pixel) — today's own "no issues assigned" card leaves that
  // margin too tight to clear MIN_PANEL_HEIGHT_PX cleanly in both positions
  // this repro needs. Two plain spacers, one on each side of the view's own
  // content, buy a wide, predictable scroll range without depending on that
  // fixed, easy-to-break amount of real content.
  test("the cap re-measures while the scrolling region scrolls, not only on open, repaint or resize", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 700 });
    await stubSearch(page, manyHits(25));
    await page.goto("/today");
    await page.locator("that-issue-search").waitFor();

    await page.evaluate(() => {
      const view = document.querySelector("#view");
      if (!view) return;
      const before = document.createElement("div");
      before.style.height = "900px";
      view.prepend(before);
      const after = document.createElement("div");
      after.style.height = "900px";
      view.append(after);
    });

    // fill() scrolls the field into view on its own terms before typing, so
    // the panel opens first, at whatever position that leaves — the repro
    // only needs the two scrolls that follow, both with the panel already
    // open, not a particular starting position.
    await searchField(page).fill("capacity");
    await expect(panel(page)).toBeVisible();

    const content = page.locator("#content");
    const maxScroll = await content.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(maxScroll).toBeGreaterThan(0);

    const maxHeightPx = () =>
      panel(page).evaluate((el) => parseFloat((el as HTMLElement).style.maxHeight));

    // High: the field rises well above the middle of the window, so a cap
    // computed here is generous — most of the window's own height. Checked
    // explicitly, not folded into the final assertion below: without this,
    // a stale cap left over from wherever fill() happened to land the panel
    // could coincidentally still satisfy that assertion at the lower
    // position, since a cap that never grew is a cap that never has to
    // shrink back either.
    await content.evaluate((el, amount) => {
      el.scrollTop = amount;
    }, maxScroll * 0.9);
    await expect.poll(maxHeightPx).toBeGreaterThan(400);

    // Low: scrolled back to the middle, not all the way to 0 — the field
    // drops, but stays comfortably clear of MIN_PANEL_HEIGHT_PX's own floor,
    // which is a different, accepted trade-off (finding 5) this test does
    // not mean to exercise. A cap stuck at the generous value the high
    // position just proved would let the panel run past the window's bottom
    // again here — the ticket's own original bug.
    await content.evaluate((el, amount) => {
      el.scrollTop = amount;
    }, maxScroll * 0.5);

    await expect
      .poll(async () => {
        const box = await panel(page).boundingBox();

        return box ? box.y + box.height : null;
      })
      .toBeLessThanOrEqual(700 - 16 + 0.5);
  });
});

// #143: the row stacks the key over the summary rather than sitting them side
// by side, so the summary reads at the row's full text width instead of
// whatever the key's own width leaves it.
test.describe("the search results row stacks key over summary (#143)", () => {
  test.beforeEach(async ({ page }) => {
    await stubPins(page, []);
    await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
    await stubEntries(page);
  });

  test("a search result draws its key above its summary, on the row's full text width", async ({
    page,
  }) => {
    await stubSearch(page, [ridge5140]);
    await page.goto("/today");

    await searchField(page).fill("capacity");

    const row = page.locator("[data-hit-key]").first();
    const key = row.getByRole("link", { name: "RIDGE-5140" });
    // .first(): the row's own that-tooltip carries the same text, hidden.
    const summary = row.getByText("Capacity planning spreadsheet is out of date", {
      exact: true,
    }).first();
    const k = await key.boundingBox();
    const s = await summary.boundingBox();
    expect((k?.y ?? 0) + (k?.height ?? 0)).toBeLessThanOrEqual((s?.y ?? 0) + 1);
    expect(Math.abs((k?.x ?? 0) - (s?.x ?? 0))).toBeLessThan(2);
  });
});

// #143: the summary's own cut-text tooltip, the same contract that-ticket-row
// already gives its summary — on hover of the text and on focus of the row's
// key link, never as the accessible name. Proved on both hosts of
// that-issue-search, since neither owns the tooltip wiring itself.
test.describe("a cut summary in the search panel comes back in a tooltip (#143)", () => {
  const longSummary =
    "Reconcile the capacity forecast against every team's actual booked hours, including " +
    "contractors who log their time in an entirely different Jira instance from ours";

  function fieldFor(page: Page, path: "/today" | "/week") {
    return path === "/today"
      ? searchField(page)
      : page.getByRole("textbox", { name: "Add a ticket to this week", exact: true });
  }

  for (const path of ["/today", "/week"] as const) {
    test(`shows the full text on key focus and on hover of the text, on ${path}`, async ({
      page,
    }) => {
      const longHit = hit(1, "Ridgeline", 0, "RIDGE-9100", longSummary);

      if (path === "/today") {
        await stubPins(page, []);
        await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
        await stubEntries(page);
      } else {
        // Week's own minimal render — an empty rollup is enough, since this
        // test is about the search panel rather than the grid underneath it.
        // Copied from week.spec.ts's own openWeek/rollup shape.
        await page.route("**/api/entries**", (route) =>
          route.fulfill({ status: 200, json: { today: "2026-09-10", entries: [] } }),
        );
        await page.route("**/api/week**", (route) =>
          route.fulfill({
            status: 200,
            json: {
              start: "2026-09-07",
              end: "2026-09-13",
              prevStart: "2026-08-31",
              nextStart: "2026-09-14",
              weekNumber: 37,
              days: Array.from({ length: 7 }, (_, i) => ({
                day: `2026-09-0${String(i + 7)}`,
                seconds: 0,
                pushState: null,
              })),
              rows: [],
              seconds: 0,
            },
          }),
        );
      }
      await stubSearch(page, [longHit]);
      await page.goto(path);

      const field = fieldFor(page, path);
      await field.fill("capacity");

      const row = resultRow(page, "RIDGE-9100");
      const keyLink = row.getByRole("link", { name: "RIDGE-9100" });
      const tooltip = page.locator("that-issue-search that-tooltip", { hasText: longSummary });

      await keyLink.focus();
      await expect(tooltip).toBeVisible();

      // Back to the field rather than a bare blur: this component closes the
      // whole panel on a focusout whose relatedTarget it does not itself
      // contain (see build()'s own focusout listener), and a blur to nowhere
      // is exactly that — the field is still part of the component, so
      // "focus elsewhere" the brief asks for is this, not a closed panel.
      await field.focus();
      await expect(tooltip).toBeHidden();

      await row.getByText(longSummary, { exact: true }).first().hover();
      await expect(tooltip).toBeVisible();
    });
  }

  // Task 7 fix: the controller's screenshots showed the tooltip's default
  // above-opening covering the key link that keyboard focus had just moved
  // to — the row stacks the key directly above the summary (#143's own
  // refinement). `below` is the search panel's opt-in for this row shape.
  test("the summary tooltip opens below the summary, clear of the focused key link", async ({
    page,
  }) => {
    const longHit = hit(1, "Ridgeline", 0, "RIDGE-9200", longSummary);
    await stubPins(page, []);
    await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
    await stubEntries(page);
    await stubSearch(page, [longHit]);
    await page.goto("/today");

    await searchField(page).fill("capacity");
    const row = resultRow(page, "RIDGE-9200");
    await expect(row).toBeVisible();

    await searchField(page).press("ArrowDown");
    const keyLink = row.getByRole("link", { name: "RIDGE-9200" });
    await expect(keyLink).toBeFocused();

    const tooltip = page.locator("that-issue-search that-tooltip", { hasText: longSummary });
    await expect(tooltip).toBeVisible();

    const summary = row.getByText(longSummary, { exact: true }).first();
    const tooltipBox = await tooltip.boundingBox();
    const keyBox = await keyLink.boundingBox();
    const summaryBox = await summary.boundingBox();
    expect(tooltipBox).not.toBeNull();
    expect(keyBox).not.toBeNull();
    expect(summaryBox).not.toBeNull();

    // Opens below the summary, not above it where the focused key link sits.
    expect(tooltipBox!.y).toBeGreaterThanOrEqual(summaryBox!.y + summaryBox!.height - 1);

    // No overlap with the focused key link's own box.
    const overlaps =
      tooltipBox!.y < keyBox!.y + keyBox!.height &&
      tooltipBox!.y + tooltipBox!.height > keyBox!.y &&
      tooltipBox!.x < keyBox!.x + keyBox!.width &&
      tooltipBox!.x + tooltipBox!.width > keyBox!.x;
    expect(overlaps).toBe(false);
  });
});

// #143, point 4: arrow-key movement across the results, and Escape back to
// the field. The focused element's row and column are read fresh off the DOM
// on every press (that-issue-search's own moveFocus), never tracked as
// separate state, which is what test 6 below exists to prove survives a
// repaint mid-navigation.
test.describe("the search panel moves by arrow keys and Escape returns to the field (#143)", () => {
  const rowA = hit(1, "Ridgeline", 0, "RIDGE-6001", "Row A summary");
  const rowB = hit(1, "Ridgeline", 0, "RIDGE-6002", "Row B summary");
  const rowC = hit(1, "Ridgeline", 0, "RIDGE-6003", "Row C summary");

  test.beforeEach(async ({ page }) => {
    await stubPins(page, []);
    await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
    await stubEntries(page);
  });

  test("down in the input focuses the first row's key link", async ({ page }) => {
    await stubSearch(page, [rowA, rowB, rowC]);
    await page.goto("/today");

    await searchField(page).fill("row");
    await expect(page.getByText("RIDGE-6001")).toBeVisible();

    await searchField(page).press("ArrowDown");
    await expect(
      resultRow(page, "RIDGE-6001").getByRole("link", { name: "RIDGE-6001" }),
    ).toBeFocused();
  });

  test("down again moves to the second row's key link, and right then moves to its Log control", async ({
    page,
  }) => {
    await stubSearch(page, [rowA, rowB, rowC]);
    await page.goto("/today");

    await searchField(page).fill("row");
    await expect(page.getByText("RIDGE-6001")).toBeVisible();

    await searchField(page).press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(
      resultRow(page, "RIDGE-6002").getByRole("link", { name: "RIDGE-6002" }),
    ).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(
      resultRow(page, "RIDGE-6002").getByRole("button", {
        name: "Log time against RIDGE-6002",
        exact: true,
      }),
    ).toBeFocused();
  });

  test("up from the first row returns to the field, and the panel stays open", async ({ page }) => {
    await stubSearch(page, [rowA, rowB, rowC]);
    await page.goto("/today");

    const field = searchField(page);
    await field.fill("row");
    await expect(page.getByText("RIDGE-6001")).toBeVisible();

    await field.press("ArrowDown");
    await page.keyboard.press("ArrowUp");

    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute("aria-expanded", "true");
  });

  test("escape in a row returns to the field without closing; a second escape closes it", async ({
    page,
  }) => {
    await stubSearch(page, [rowA, rowB, rowC]);
    await page.goto("/today");

    const field = searchField(page);
    await field.fill("row");
    await expect(page.getByText("RIDGE-6001")).toBeVisible();

    await field.press("ArrowDown");
    await page.keyboard.press("Escape");

    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute("aria-expanded", "true");

    await field.press("Escape");
    await expect(field).toHaveAttribute("aria-expanded", "false");
  });

  // Controller ruling: "Tab leaves the panel, as today" means Tab keeps its
  // native order and no arrow handler intercepts it. aria-expanded alone
  // proves nothing here — a Tab whose keydown handler called preventDefault
  // would leave focus on the field and aria-expanded untouched, and this
  // test would still pass. So this checks where focus actually lands: the
  // first row's key link on the first Tab (native order, not an arrow-key
  // jump), and that tabbing out of the last row's last control leaves the
  // component entirely and closes the panel, the same as any other focusout
  // this component does not contain.
  test("tab from the field leaves the panel as today, with no arrow handler interfering", async ({
    page,
  }) => {
    // A real assigned row, linked, so tabbing off the panel's own last
    // control has somewhere native to land — without one, tabbing off the
    // last focusable element on the page is a browser-chrome affair
    // Playwright cannot observe consistently across engines, which would
    // make this half of the test about that quirk rather than about Tab.
    await stubIssues(page, [
      {
        id: 1,
        name: "Ridgeline",
        error: null,
        issues: [
          {
            key: "WORK-1",
            summary: "An assigned ticket",
            status: "To Do",
            url: "https://example.atlassian.net/browse/WORK-1",
          },
        ],
      },
    ]);
    await stubSearch(page, [rowA, rowB, rowC]);
    await page.goto("/today");

    const field = searchField(page);
    await field.fill("row");
    await expect(page.getByText("RIDGE-6001")).toBeVisible();

    await field.press("Tab");
    await expect(
      resultRow(page, "RIDGE-6001").getByRole("link", { name: "RIDGE-6001" }),
    ).toBeFocused();
    await expect(field).toHaveAttribute("aria-expanded", "true");

    const lastRowPin = resultRow(page, "RIDGE-6003").getByRole("button", {
      name: "Pin RIDGE-6003",
      exact: true,
    });
    await lastRowPin.focus();
    await lastRowPin.press("Tab");
    // The assigned table's own first control, immediately after the search
    // panel in DOM order — proof focus actually left the panel via native
    // order, not merely that some flag flipped.
    await expect(page.getByRole("button", { name: "Sort by Key" })).toBeFocused();
    await expect(field).toHaveAttribute("aria-expanded", "false");
  });

  test("pressing pin with Enter, then Down, moves to the next row's pin control across the repaint", async ({
    page,
  }) => {
    await stubSearch(page, [rowA, rowB]);
    const pinnedRowA = {
      id: 9,
      instanceId: rowA.instanceId,
      instanceName: rowA.instanceName,
      instancePosition: rowA.instancePosition,
      key: rowA.key,
      summary: rowA.summary,
      status: rowA.status,
      url: rowA.url,
      error: null,
    };
    await stubPins(page, [], [pinnedRowA]);
    await page.route("**/api/pins", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      await route.fulfill({ status: 201, json: pinnedRowA });
    });

    await page.goto("/today");
    await searchField(page).fill("row");
    await expect(page.getByText("RIDGE-6001")).toBeVisible();

    const pinButtonA = resultRow(page, "RIDGE-6001").getByRole("button", {
      name: "Pin RIDGE-6001",
      exact: true,
    });
    await pinButtonA.focus();
    await pinButtonA.press("Enter");

    const unpinButtonA = resultRow(page, "RIDGE-6001").getByRole("button", {
      name: "Unpin RIDGE-6001",
      exact: true,
    });
    await expect(unpinButtonA).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(
      resultRow(page, "RIDGE-6002").getByRole("button", { name: "Pin RIDGE-6002", exact: true }),
    ).toBeFocused();
  });

  test("on Week, down in the input focuses the first row's first control", async ({ page }) => {
    await page.route("**/api/entries**", (route) =>
      route.fulfill({ status: 200, json: { today: "2026-09-10", entries: [] } }),
    );
    await page.route("**/api/week**", (route) =>
      route.fulfill({
        status: 200,
        json: {
          start: "2026-09-07",
          end: "2026-09-13",
          prevStart: "2026-08-31",
          nextStart: "2026-09-14",
          weekNumber: 37,
          days: Array.from({ length: 7 }, (_, i) => ({
            day: `2026-09-0${String(i + 7)}`,
            seconds: 0,
            pushState: null,
          })),
          rows: [],
          seconds: 0,
        },
      }),
    );
    // No url: keyLabel draws a plain, unfocusable span for the key, so
    // column 0 is the add-to-week button rather than a link — proving the
    // rule reads "the row's first focusable element", not the key link every
    // other case above happens to have there.
    const noUrlHit = { ...rowA, url: "" };
    await stubSearch(page, [noUrlHit]);
    await page.goto("/week");

    const field = page.getByRole("textbox", { name: "Add a ticket to this week", exact: true });
    await field.fill("row");
    await expect(page.getByText("RIDGE-6001")).toBeVisible();

    await field.press("ArrowDown");
    await expect(
      page.getByRole("button", { name: "Add RIDGE-6001 to this week", exact: true }),
    ).toBeFocused();
  });
});
