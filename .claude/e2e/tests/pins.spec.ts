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

// Pinned rows carry #7's duration cell now, and its figure comes from here.
// Stubbed for the same reason the pin and issue routes are: the e2e stack
// shares the dev database.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 200, json: { today: "2026-08-31", entries: [] } }),
  );
});

interface StubPin {
  id: number;
  instanceId: number;
  instanceName: string;
  instancePosition: number;
  key: string;
  summary: string;
  status: string;
  url: string;
  error: { code: string; message: string } | null;
}

function pin(
  id: number,
  instanceName: string,
  key: string,
  summary: string,
  instancePosition = 0,
): StubPin {
  return {
    id,
    instanceId: id,
    instanceName,
    instancePosition,
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

  const card = page.getByRole("region", { name: "Pinned" });
  await expect(card.getByText("SHARED-12")).toBeVisible();
  // .first(): #143 gave every summary a that-tooltip carrying the same text,
  // so an unscoped match now finds two elements — the summary and its tooltip.
  await expect(card.getByText("Weekly standup").first()).toBeVisible();
  // A pinned row names its instance by dot alone (accessible via role="img"),
  // not as visible row text — the restyle decision this branch shipped without.
  await expect(card.getByRole("img", { name: "Ridgeline" })).toBeVisible();
  await expect(card.getByText("Ridgeline", { exact: true })).toHaveCount(0);

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

  const card = page.getByRole("region", { name: "Pinned" });
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

  // Scoped rather than page-wide: a dedupe that filtered the Pinned section
  // instead of the assigned one would still leave exactly one "SHARED-12" on
  // the page. The spec is that the row survives in Pinned and is removed from
  // Ridgeline's assigned list specifically. Each section is a landmark named
  // by its own heading, which picks the assigned one out unambiguously — the
  // Pinned section also carries "Ridgeline", as the pinned row's dot.
  const pinnedCard = page.getByRole("region", { name: "Pinned" });
  const assignedCard = page.getByRole("region", { name: "Ridgeline" });
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
  await expect(page.getByRole("region", { name: "Pinned" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pin an issue" })).toHaveCount(0);
});

// A regression that painted every dot the same hue — or the transparent-dot
// trap where --h reads correctly but the background never resolves at all —
// would leave every row identifiable only by luck; reading the resolved paint
// back is what catches both, where a class-based check would pass either way.
test("two pinned instances render two different dot hues", async ({ page }) => {
  await stubPins(page, [
    pin(1, "Ridgeline", "SHARED-12", "Weekly standup", 0),
    pin(2, "Personal", "MISC-3", "Admin overhead", 1),
  ]);
  await stubIssues(page, [
    { id: 1, name: "Ridgeline", issues: [], error: null },
    { id: 2, name: "Personal", issues: [], error: null },
  ]);

  await page.goto("/today");

  const card = page.getByRole("region", { name: "Pinned" });
  const dots = card.getByRole("img");
  await expect(dots).toHaveCount(2);

  // The resolved paint, not --h: the transparent-dot trap
  // (docs/superpowers/specs/2026-08-20-visual-design-language.md's "A trap this
  // system sets") leaves --h reading correctly while every dot renders fully
  // transparent with nothing in the console, and a 7x7 transparent box still
  // has a non-empty bounding box, so toBeVisible would not have caught it either.
  const colors = await dots.evaluateAll((elements) =>
    elements.map((element) => getComputedStyle(element).backgroundColor),
  );

  expect(colors[0]).not.toBe("rgba(0, 0, 0, 0)");
  expect(colors[1]).not.toBe("rgba(0, 0, 0, 0)");
  expect(colors[0]).not.toBe(colors[1]);
});

async function stubSearch(page: Page, results: unknown[], errors: unknown[] = []): Promise<void> {
  await page.route("**/api/issues/search**", async (route) => {
    await route.fulfill({ status: 200, json: { results, errors } });
  });
}

const sharedHit = {
  instanceId: 1,
  instanceName: "Ridgeline",
  instancePosition: 0,
  key: "SHARED-40",
  summary: "Vendor security review",
  status: "To Do",
  url: "https://example.atlassian.net/browse/SHARED-40",
};

// The pin form and its combobox are gone (#84's own decision: the search does
// this job now) — this proves the same outcome, pinning a result found across
// instances, through the search panel that replaced it.
test("searching finds issues across instances and pinning one adds it to Pinned", async ({
  page,
}) => {
  await stubPins(page, [], [pin(9, "Ridgeline", "SHARED-40", "Vendor security review")]);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
  await stubSearch(page, [
    sharedHit,
    {
      instanceId: 2,
      instanceName: "Personal",
      instancePosition: 1,
      key: "MISC-15",
      summary: "Security questionnaire",
      status: "Open",
      url: "https://example.atlassian.net/browse/MISC-15",
    },
  ]);
  await page.route("**/api/pins", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 201,
      json: pin(9, "Ridgeline", "SHARED-40", "Vendor security review"),
    });
  });

  await page.goto("/today");
  await page.getByRole("textbox", { name: "Search all instances" }).fill("security");

  await expect(page.getByText("SHARED-40")).toBeVisible();
  await expect(page.getByText("MISC-15")).toBeVisible();

  await page.getByRole("button", { name: "Pin SHARED-40", exact: true }).click();

  const pinnedCard = page.getByRole("region", { name: "Pinned" });
  // .first(): see the same note above — the tooltip repeats this text too.
  await expect(pinnedCard.getByText("Vendor security review").first()).toBeVisible();
});

test("unpinning removes the row without a reload", async ({ page }) => {
  await stubPins(page, [pin(1, "Ridgeline", "SHARED-12", "Weekly standup")], []);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
  let deleteMethod: string | null = null;
  await page.route("**/api/pins/1", async (route) => {
    deleteMethod = route.request().method();
    await route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/today");
  await expect(page.getByText("SHARED-12")).toBeVisible();
  // A reload would reset this; its survival is what proves the row's removal
  // came from the DOM update, not a fresh page.
  await page.evaluate(() => {
    (window as unknown as { __wd_marker: boolean }).__wd_marker = true;
  });

  // The row's own control, named for its ticket: the list's dedicated Unpin
  // button is gone, and an unanchored "Unpin" would match this by substring
  // without saying which row it had found.
  await page.getByRole("button", { name: "Unpin SHARED-12", exact: true }).click();

  await expect(page.getByText("SHARED-12")).toHaveCount(0);
  await expect(page.getByText("Nothing pinned.")).toBeVisible();
  expect(deleteMethod).toBe("DELETE");
  expect(
    await page.evaluate(() => (window as unknown as { __wd_marker?: boolean }).__wd_marker),
  ).toBe(true);
});

test("refresh updates the pinned card as well as the assigned one", async ({ page }) => {
  await stubPins(
    page,
    [pin(1, "Ridgeline", "SHARED-12", "Weekly standup")],
    [pin(1, "Ridgeline", "SHARED-12", "Renamed standup")],
  );
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);

  await page.goto("/today");
  // .first(): see the note above pinned issues render above the assigned cards.
  await expect(page.getByText("Weekly standup").first()).toBeVisible();

  await page.getByRole("button", { name: "Refresh" }).click();

  await expect(page.getByText("Renamed standup").first()).toBeVisible();
});

// A test that only watches one request would pass against a button that
// re-enables early — this is the case #6's report specifically calls out —
// so the pins response is held open until the assigned response has already
// resolved, and the button's disabled state is read in between.
test("Refresh disables the button until both the pins and the assigned calls settle", async ({
  page,
}) => {
  let issuesCalls = 0;
  let pinsRefreshCalls = 0;
  let issuesSettled = false;
  let releasePins: (() => void) | undefined;
  const pinsHeld = new Promise<void>((resolve) => {
    releasePins = resolve;
  });

  await page.route("**/api/pins**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    const url = new URL(route.request().url());
    if (url.searchParams.get("refresh") === "1") {
      pinsRefreshCalls += 1;
      await pinsHeld;
      await route.fulfill({
        status: 200,
        json: [pin(1, "Ridgeline", "SHARED-12", "Renamed standup")],
      });
      return;
    }
    await route.fulfill({
      status: 200,
      json: [pin(1, "Ridgeline", "SHARED-12", "Weekly standup")],
    });
  });
  await page.route("**/api/issues", async (route) => {
    issuesCalls += 1;
    await route.fulfill({
      status: 200,
      json: { instances: [{ id: 1, name: "Ridgeline", issues: [], error: null }] },
    });
    issuesSettled = true;
  });

  await page.goto("/today");
  await expect(page.getByText("Weekly standup").first()).toBeVisible();

  const refresh = page.getByRole("button", { name: "Refresh" });
  await refresh.click();
  await expect(refresh).toBeDisabled();

  // The assigned call has resolved (proven by issuesSettled) while the pins
  // call is still deliberately held open — a button gated on refreshResults
  // alone would already have re-enabled here.
  await expect.poll(() => issuesSettled).toBe(true);
  await expect(refresh).toBeDisabled();

  releasePins?.();

  await expect(page.getByText("Renamed standup").first()).toBeVisible();
  await expect(refresh).toBeEnabled();
  expect(pinsRefreshCalls).toBe(1);
  // 2, not 1: one for the initial mount's independent fetch, one for Refresh's.
  expect(issuesCalls).toBe(2);
});

test("a pin whose refresh failed keeps its cached values", async ({ page }) => {
  const stale = pin(1, "Ridgeline", "SHARED-12", "Weekly standup");
  const failed = {
    ...stale,
    error: { code: "instance_unreachable", message: "the Jira site could not be reached" },
  };
  await stubPins(page, [stale], [failed]);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);

  await page.goto("/today");
  await page.getByRole("button", { name: "Refresh" }).click();

  await expect(page.getByText("Weekly standup").first()).toBeVisible();
  // .first(): #143 gave the failure note its own hover-only that-tooltip.
  await expect(page.getByText("the Jira site could not be reached").first()).toBeVisible();
});

/**
 * Task 3 of #95: the row itself carries a trailing pin control now, rather
 * than Today's pin form being the only way in. Today does not yet wire
 * `that-table` (that is Task 4), so these mount a row directly into a
 * `that-table` the way Task 4 eventually will — the same reasoning
 * tooltip.spec.ts's mountTrigger uses for that-tooltip's first test, since
 * that-ticket-row is that-table's first row and neither has a production
 * consumer wiring them together yet.
 */
test.describe("the ticket row's own pin control", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
    await page.route("**/api/issues", (route) =>
      route.fulfill({ status: 200, json: { instances: [] } }),
    );
    await page.goto("/today");
  });

  interface RowTicket {
    key: string;
    summary: string;
    status: string;
    url: string;
  }

  const ridge5301: RowTicket = {
    key: "RIDGE-5301",
    summary: "Timesheet export drops the last day of the month",
    status: "In Progress",
    url: "https://ridgeline.atlassian.net/browse/RIDGE-5301",
  };

  async function mountRows(page: Page, tickets: RowTicket[]): Promise<void> {
    await page.evaluate(async (list) => {
      // Both are registered by a dynamic import (that-table from main.ts,
      // that-ticket-row from today.ts's own dynamic view import), so a row
      // built before either resolves would be an un-upgraded element with no
      // .body / cell rendering at all.
      await Promise.all([
        customElements.whenDefined("that-table"),
        customElements.whenDefined("that-ticket-row"),
      ]);
      const table = document.createElement("that-table");
      const body = (table as unknown as { body: HTMLTableSectionElement }).body;
      for (const ticket of list) {
        const row = document.createElement("that-ticket-row");
        row.setAttribute("key", ticket.key);
        row.setAttribute("summary", ticket.summary);
        row.setAttribute("status", ticket.status);
        row.setAttribute("url", ticket.url);
        row.setAttribute("instance-id", "1");
        row.setAttribute("instance-name", "Ridgeline");
        body.append(row);
      }
      document.body.append(table);
    }, tickets);
  }

  test("every row carries its own pin control, named for its ticket", async ({ page }) => {
    const ridge4880: RowTicket = {
      key: "RIDGE-4880",
      summary: "Update the on-call rota document",
      status: "To Do",
      url: "https://ridgeline.atlassian.net/browse/RIDGE-4880",
    };
    await mountRows(page, [ridge5301, ridge4880]);

    await expect(page.getByRole("button", { name: "Pin RIDGE-5301", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pin RIDGE-4880", exact: true })).toBeVisible();
  });

  test("hovering the pin control shows a tooltip reading exactly \"pin ticket\"", async ({
    page,
  }) => {
    await mountRows(page, [ridge5301]);

    await page.getByRole("button", { name: "Pin RIDGE-5301", exact: true }).hover();

    // Scoped to the row's card and to the one actually shown: Today's own
    // Refresh carries a tooltip too, and #143 gave the row's summary a
    // hidden one of its own — an unscoped locator would match all three.
    const tooltip = page.locator("that-table that-tooltip:visible");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText("pin ticket");
  });

  test("clicking the pin control repaints it optimistically into the crossed pin", async ({
    page,
  }) => {
    await mountRows(page, [ridge5301]);

    await page.getByRole("button", { name: "Pin RIDGE-5301", exact: true }).click();

    await expect(page.getByRole("button", { name: "Pin RIDGE-5301", exact: true })).toHaveCount(0);
    const unpinControl = page.getByRole("button", { name: "Unpin RIDGE-5301", exact: true });
    await expect(unpinControl).toBeVisible();

    await unpinControl.hover();
    // Scoped to the row's card and to the one actually shown — see the note
    // in the previous test.
    const tooltip = page.locator("that-table that-tooltip:visible");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText("unpin ticket");
  });

  // 2026-09-10: the control used to carry text-primary at rest whenever the
  // row was pinned. It now takes that colour only on hover or focus — the
  // mark itself (pin vs pin-off) is what says "pinned" at rest — matching
  // ul.inst's own iconbtn in the prototype. Asserted on the computed colour,
  // not the class list: a class survives a stylesheet that stops painting it.
  test("the pin control's colour is muted at rest and primary on hover, pinned or not, and on focus while unpinned", async ({
    page,
  }) => {
    await mountRows(page, [ridge5301]);

    const mutedColor = await computedColor(page, "text-ink-muted", "color");
    const primaryColor = await computedColor(page, "text-primary", "color");

    const unpinnedControl = page.getByRole("button", { name: "Pin RIDGE-5301", exact: true });
    await expect(unpinnedControl).toHaveCSS("color", mutedColor);
    await unpinnedControl.hover();
    await expect(unpinnedControl).toHaveCSS("color", primaryColor);
    // Task 10's residual: focusing while still hovered proved nothing about
    // :focus-visible, since :hover alone already gives primary. Moving the
    // pointer away first is what makes this a real focus assertion.
    await page.mouse.move(0, 0);
    await unpinnedControl.focus();
    await expect(unpinnedControl).toHaveCSS("color", primaryColor);

    await unpinnedControl.click();

    const pinnedControl = page.getByRole("button", { name: "Unpin RIDGE-5301", exact: true });
    // Neither the mouse nor the focus left the control across the click
    // above — it is both still hovered and still :focus-visible, so both
    // have to be cleared before its true resting colour can be read.
    await page.mouse.move(0, 0);
    await pinnedControl.evaluate((el) => (el as HTMLElement).blur());
    await expect(pinnedControl).toHaveCSS("color", mutedColor);
    await pinnedControl.hover();
    await expect(pinnedControl).toHaveCSS("color", primaryColor);
  });

  // A trailing control's centred tooltip hangs past the card — decision 7's
  // reason for anchor="end". The row spans the full card width because
  // that-table's own <table> carries w-full, so a tooltip that centred on
  // this control would have nowhere to go but past the right edge.
  test("the pin control's tooltip does not extend past the card's right edge", async ({
    page,
  }) => {
    await mountRows(page, [ridge5301]);

    await page.getByRole("button", { name: "Pin RIDGE-5301", exact: true }).hover();

    // Scoped to the row's card and to the one actually shown — see the note
    // two tests up.
    const tooltip = page.locator("that-table that-tooltip:visible");
    await expect(tooltip).toBeVisible();

    const card = page.locator("that-table");
    const tooltipBox = await tooltip.boundingBox();
    const cardBox = await card.boundingBox();
    expect(tooltipBox).not.toBeNull();
    expect(cardBox).not.toBeNull();

    expect(tooltipBox!.x + tooltipBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 1);
  });

  // .iconbtn's margin-right: -8px (T4). The button's own hit area already
  // reaches the card's content edge without it — the cell shrinks to the
  // button's width, and it is the last column — so the assertion is on the
  // mark itself, centred inside the 34px button, which stops 8px short of
  // that edge until the negative margin carries the whole box past it.
  test("the pin control's ink reaches the card's content edge", async ({ page }) => {
    await mountRows(page, [ridge5301]);

    const card = page.locator("that-table");
    const trigger = page.getByRole("button", { name: "Pin RIDGE-5301", exact: true });

    const cardBox = await card.boundingBox();
    const svgBox = await trigger.locator("svg").boundingBox();
    expect(cardBox).not.toBeNull();
    expect(svgBox).not.toBeNull();

    const paddingRight = await card.evaluate((el) => parseFloat(getComputedStyle(el).paddingRight));
    const contentEdge = cardBox!.x + cardBox!.width - paddingRight;

    expect(Math.abs(svgBox!.x + svgBox!.width - contentEdge)).toBeLessThanOrEqual(1.5);
  });

  // .durbtn's own values (T5): padding: 9px 13px; margin: -9px -13px -9px 0.
  // Asserting on computed style rather than only on a bounding box, because a
  // box that is merely wider than its text passes whether or not the margin
  // gives the padding back — it is the cancellation itself that keeps the
  // row's height, and so its neighbours, from moving.
  test("the duration control gives back exactly the padding it took, except on the left", async ({
    page,
  }) => {
    await mountRows(page, [ridge5301]);

    const trigger = page.locator("that-table tbody .c-today button");
    const style = await trigger.evaluate((el) => {
      const computed = getComputedStyle(el);
      return {
        paddingTop: computed.paddingTop,
        paddingRight: computed.paddingRight,
        paddingBottom: computed.paddingBottom,
        paddingLeft: computed.paddingLeft,
        marginTop: computed.marginTop,
        marginRight: computed.marginRight,
        marginBottom: computed.marginBottom,
        marginLeft: computed.marginLeft,
      };
    });

    expect(style.paddingTop).toBe("9px");
    expect(style.paddingRight).toBe("13px");
    expect(style.paddingBottom).toBe("9px");
    expect(style.paddingLeft).toBe("13px");
    expect(style.marginTop).toBe("-9px");
    expect(style.marginRight).toBe("-13px");
    expect(style.marginBottom).toBe("-9px");
    // Not given back on the left, so the figure stays clear of the summary.
    expect(style.marginLeft).toBe("0px");
  });

  test("the duration control's hover box is wider than its figure", async ({ page }) => {
    await mountRows(page, [ridge5301]);

    const trigger = page.locator("that-table tbody .c-today button");
    const figure = trigger.locator(".that-tnum");

    const triggerBox = await trigger.boundingBox();
    const figureBox = await figure.boundingBox();
    expect(triggerBox).not.toBeNull();
    expect(figureBox).not.toBeNull();

    expect(triggerBox!.width).toBeGreaterThan(figureBox!.width);
  });
});

/**
 * #109: a failed pin or unpin reports at the top of whichever section holds
 * the ticket's row once the lists are redrawn from server truth. Pinned only
 * gets the report when the row is there (an unpin) or nowhere (a pin pressed
 * in the search panel).
 */
test.describe("a failed pin reports beside its row", () => {
  const failure = { code: "jira_error", message: "Jira did not take the pin." };

  async function failPinRequests(page: Page): Promise<void> {
    await page.route("**/api/pins**", async (route) => {
      if (route.request().method() === "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({ status: 502, json: failure });
    });
  }

  const pinned = (page: Page) => page.locator('section[aria-labelledby="today-pinned"]');
  const instance = (page: Page) => page.locator('section[aria-labelledby="today-instance-1"]');
  const offList = (page: Page) => page.locator('section[aria-labelledby="today-offlist"]');

  test("a pin that fails on an instance row reports at the top of that instance section", async ({
    page,
  }) => {
    await stubPins(page, []);
    await stubIssues(page, [
      {
        id: 1,
        name: "Ridgeline",
        error: null,
        issues: [
          {
            key: "RIDGE-7",
            summary: "Rotate the staging certificates",
            status: "To Do",
            url: "https://example.atlassian.net/browse/RIDGE-7",
          },
        ],
      },
    ]);
    await failPinRequests(page);

    await page.goto("/today");
    await page.getByRole("button", { name: "Pin RIDGE-7", exact: true }).click();

    await expect(instance(page).locator("that-alert + that-table")).toHaveCount(1);
    await expect(instance(page).locator("that-alert")).toHaveText(failure.message);
    await expect(pinned(page).locator("that-alert")).toHaveCount(0);
    await expect(instance(page).getByRole("button", { name: "Pin RIDGE-7", exact: true })).toBeVisible();
  });

  test("a pin that fails on an off-list row reports at the top of the off-list section", async ({
    page,
  }) => {
    await stubPins(page, []);
    await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
    await page.route("**/api/entries**", (route) =>
      route.fulfill({
        status: 200,
        json: {
          today: "2026-08-31",
          entries: [
            {
              id: 1,
              instanceId: 1,
              instanceName: "Ridgeline",
              instancePosition: 0,
              issueKey: "SHARED-40",
              day: "2026-08-31",
              startedAt: "2026-08-31T09:00:00+02:00",
              seconds: 1800,
              comment: "",
              pushState: "unpushed",
            },
          ],
        },
      }),
    );
    await stubSearch(page, [sharedHit]);
    await failPinRequests(page);

    await page.goto("/today");
    await expect(offList(page).getByText("Vendor security review").first()).toBeVisible();
    await page.getByRole("button", { name: "Pin SHARED-40", exact: true }).click();

    await expect(offList(page).locator("that-alert + that-table")).toHaveCount(1);
    await expect(offList(page).locator("that-alert")).toHaveText(failure.message);
    await expect(pinned(page).locator("that-alert")).toHaveCount(0);
    await expect(offList(page).getByRole("button", { name: "Pin SHARED-40", exact: true })).toBeVisible();
  });

  test("an unpin that fails reports at the top of Pinned", async ({ page }) => {
    await stubPins(page, [pin(1, "Ridgeline", "SHARED-12", "Weekly standup")]);
    await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
    await failPinRequests(page);

    await page.goto("/today");
    await page.getByRole("button", { name: "Unpin SHARED-12", exact: true }).click();

    await expect(pinned(page).locator("that-alert + that-table")).toHaveCount(1);
    await expect(pinned(page).locator("that-alert")).toHaveText(failure.message);
    await expect(instance(page).locator("that-alert")).toHaveCount(0);
    await expect(pinned(page).getByRole("button", { name: "Unpin SHARED-12", exact: true })).toBeVisible();
  });

  test("a pin that fails from the search panel, for an issue with no row, reports in Pinned", async ({
    page,
  }) => {
    await stubPins(page, []);
    await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
    await stubSearch(page, [sharedHit]);
    await failPinRequests(page);

    await page.goto("/today");
    await page.getByRole("textbox", { name: "Search all instances" }).fill("vendor");
    await page.getByRole("button", { name: "Pin SHARED-40", exact: true }).click();

    await expect(pinned(page).locator("that-alert")).toHaveText(failure.message);
    await expect(instance(page).locator("that-alert")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Pin SHARED-40", exact: true })).toBeVisible();
  });
});
