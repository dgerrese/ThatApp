import { expect, test, type Locator, type Page } from "@playwright/test";

test("the app shell boots and the bundle runs", async ({ page }) => {
  // Today fetches on render, and the e2e stack shares the dev database, so this
  // has to be stubbed or the fan-out reaches real Jira instances.
  await page.route("**/api/issues", (route) =>
    route.fulfill({ status: 200, json: { instances: [] } }),
  );

  await page.goto("/");

  await expect(page).toHaveTitle("ThatApp");
  await expect(page.getByRole("heading", { name: "ThatApp" })).toBeVisible();

  // The shell ships an empty #view. Seeing Today's empty state proves the bundle
  // parsed, "/" redirected, and the dynamic import() of a view resolved.
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByText("No Jira instances yet.")).toBeVisible();
});

test("an unknown route still serves the app shell", async ({ page }) => {
  // Client-side routing: /week is a view, not a file. A 404 here would mean the
  // server's shell fallback regressed.
  const response = await page.goto("/week");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "ThatApp" })).toBeVisible();
});

// Every stub in every spec but pwa.spec.ts rests on this. A request a service
// worker claims never reaches page.route, and sw.ts claims GET /api/issues and
// GET /api/pins (#12 task 5) — so a worker registering here would send those two
// to the real server, which shares the dev database and fans out to the owner's
// real Jira instances. playwright.config.ts blocks registration for exactly that
// reason; this is the standing check that the block is honoured, on both
// engines, on every run, rather than a claim measured once and taken on trust.
test("no service worker registers in a spec that has not opted back in", async ({ page }) => {
  await page.route("**/api/issues", (route) =>
    route.fulfill({ status: 200, json: { instances: [] } }),
  );

  await page.goto("/");

  // main.ts registers on the window load event, which goto() has already waited
  // for, so the attempt is in flight by the time this runs. Polled rather than
  // read once: blocked, the count is zero on the first probe and this returns
  // immediately; unblocked, it goes to one and never comes back.
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.getRegistrations().then((all) => all.length)))
    .toBe(0);
});

/**
 * The colour a Tailwind utility class actually resolves to in this browser,
 * read off a throwaway probe rather than a literal `oklch()` string in this
 * file — see the identical helper in push.spec.ts.
 */
async function computedColor(
  page: Page,
  className: string,
  property: "backgroundColor",
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

async function gotoEmptyToday(page: Page): Promise<void> {
  await page.route("**/api/issues", (route) =>
    route.fulfill({ status: 200, json: { instances: [] } }),
  );
  await page.goto("/today");
}

/**
 * Real Tab presses, not `.focus()`: a programmatic focus() does not reliably
 * arm `:focus-visible` the way keyboard navigation does. `target` is a
 * `:focus`-scoped locator, re-queried on every press, so this stops the
 * moment whichever element it names is the one that has it.
 */
async function tabUntilFocused(page: Page, target: Locator, maxPresses = 8): Promise<boolean> {
  for (let presses = 0; presses < maxPresses; presses++) {
    await page.keyboard.press("Tab");
    if ((await target.count()) > 0) return true;
  }

  return false;
}

/**
 * #117: the shipped rail drifted from the drawing it was built from. These
 * assertions read the drawing's own values back off the live page —
 * docs/superpowers/prototypes/2026-09-03-app-prototype.html's .rail, .sbar,
 * .hr and nav.rn button rules — rather than trusting that a past "looks
 * right" still holds.
 */
test.describe("the rail's geometry", () => {
  test("the rail's own padding and row gap match the drawing", async ({ page }) => {
    await gotoEmptyToday(page);

    const rail = page.locator("aside.that-rail");
    // The shorthand's serialised form (2-value vs. 4-value) is not consistent
    // across engines, so each longhand is asserted on its own.
    await expect(rail).toHaveCSS("padding-top", "22px");
    await expect(rail).toHaveCSS("padding-bottom", "22px");
    await expect(rail).toHaveCSS("padding-left", "14px");
    await expect(rail).toHaveCSS("padding-right", "14px");
    await expect(rail).toHaveCSS("row-gap", "26px");
  });

  test("two dividers cut the rail, each styled as the drawing's .hr", async ({ page }) => {
    await gotoEmptyToday(page);

    const activeColor = await computedColor(page, "bg-rail-active", "backgroundColor");
    const dividers = await page.locator("aside.that-rail").evaluate(
      (rail, activeColor) =>
        [...rail.querySelectorAll<HTMLElement>("div")].filter((el) => {
          const style = getComputedStyle(el);

          // The drawing's border-radius: 1px is named as rounded-xs (2px) —
          // web/src/vocabulary.test.ts forbids a radius literal off the ramp
          // — which renders identically here anyway: CSS clamps a corner
          // radius to half the box's own dimension, and this box is 2px
          // tall, so both 1px and 2px paint the same curve.
          return (
            style.backgroundColor === activeColor &&
            style.height === "2px" &&
            style.borderRadius === "2px" &&
            style.marginTop === "4px" &&
            style.marginBottom === "4px"
          );
        }).length,
      activeColor,
    );

    expect(dividers).toBe(2);
  });

  test("hovering an inactive nav row washes it in the rail's active tone", async ({ page }) => {
    await gotoEmptyToday(page);

    // Week, not Today: Today carries aria-current="page" at rest, which paints
    // the same background regardless of hover and would prove nothing.
    const week = page.getByRole("link", { name: "Week", exact: true });
    const activeColor = await computedColor(page, "bg-rail-active", "backgroundColor");

    await expect(week).not.toHaveCSS("background-color", activeColor);
    await week.hover();
    await expect(week).toHaveCSS("background-color", activeColor);
  });

  test("the current nav row keeps its active fill when it gains keyboard focus", async ({ page }) => {
    await gotoEmptyToday(page);

    // Today is aria-current="page" at rest on /today. Where you are is shown
    // by fill and weight (2026-08-20-visual-design-language.md) — focus must
    // not trade that solid fill for the translucent wash other rows take.
    const current = page.locator("aside.that-rail .that-nav[aria-current='page']:focus");
    expect(await tabUntilFocused(page, current)).toBe(true);

    await expect(current).toHaveCSS(
      "background-color",
      await computedColor(page, "bg-rail-active", "backgroundColor"),
    );
  });

  test("a non-current nav row takes the rail's hover wash when it gains keyboard focus", async ({
    page,
  }) => {
    await gotoEmptyToday(page);

    const notCurrent = page.locator("aside.that-rail a.that-nav:focus:not([aria-current='page'])");
    expect(await tabUntilFocused(page, notCurrent)).toBe(true);

    const background = await notCurrent.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(background).not.toBe("rgba(0, 0, 0, 0)");
    expect(background).not.toBe(await computedColor(page, "bg-rail-active", "backgroundColor"));
  });

  // R3: the button's own words follow the period, not merely what was true on
  // first paint. week.ts and TODAY_PERIOD both hand the rail a pushLabel.
  test("Push's label follows the period after navigating, not only at boot", async ({ page }) => {
    await gotoEmptyToday(page);

    const push = page.getByRole("button", { name: "Push worklogs" });
    await expect(push).toBeVisible();

    await page.getByRole("link", { name: "Week", exact: true }).click();
    await expect(page).toHaveURL(/\/week$/);
    await expect(page.getByRole("button", { name: "Push this week" })).toBeVisible();
  });
});

/**
 * #117 task 3: the drawing puts the scroll on `.viewport`, not the page, so
 * the rail — the instrument you glance at — never leaves the screen. These
 * assertions stub enough rows into both Today and Week that each overflows
 * the default viewport on its own, so a passing scrollTop-of-0 proves the
 * router actually reset it rather than merely finding nothing to scroll.
 */
test.describe("the content region owns the scroll, not the page", () => {
  const MANY_ISSUES = Array.from({ length: 40 }, (_, index) => ({
    key: `WORK-${1000 + index}`,
    summary: `Row ${index}`,
    status: "To Do",
    url: `https://work.atlassian.net/browse/WORK-${1000 + index}`,
  }));

  const WEEK_DAYS = [
    "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10",
    "2026-09-11", "2026-09-12", "2026-09-13",
  ];

  const MANY_WEEK_ROWS = Array.from({ length: 40 }, (_, index) => ({
    instanceId: 1,
    instanceName: "Work",
    instancePosition: 0,
    issueKey: `WORK-${1000 + index}`,
    url: `https://work.atlassian.net/browse/WORK-${1000 + index}`,
    cells: WEEK_DAYS.map(() => ({ seconds: 0, pushState: null })),
    seconds: 0,
  }));

  test.beforeEach(async ({ page }) => {
    await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
    await page.route("**/api/entries**", (route) =>
      route.fulfill({ status: 200, json: { today: "2026-09-09", entries: [] } }),
    );
    await page.route("**/api/issues", (route) =>
      route.fulfill({
        status: 200,
        json: { instances: [{ id: 1, name: "Work", issues: MANY_ISSUES, error: null }] },
      }),
    );
    await page.route("**/api/week**", (route) =>
      route.fulfill({
        status: 200,
        json: {
          start: WEEK_DAYS[0],
          end: WEEK_DAYS[6],
          prevStart: "2026-08-31",
          nextStart: "2026-09-14",
          weekNumber: 37,
          days: WEEK_DAYS.map((day) => ({ day, seconds: 0, pushState: null })),
          rows: MANY_WEEK_ROWS,
          seconds: 0,
        },
      }),
    );
  });

  /** `main#content`, index.html's scrolling region — see its overflow-y-auto comment. */
  function content(page: Page): Locator {
    return page.locator("#content");
  }

  test("the window stays put while the content region scrolls, and the rail does not move", async ({
    page,
  }) => {
    await page.goto("/today");
    await expect(page.getByText("Row 39")).toBeAttached();

    const rail = page.locator("aside.that-rail");
    const before = await rail.boundingBox();

    await content(page).evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });

    await expect.poll(() => content(page).evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await rail.boundingBox()).toEqual(before);
  });

  test("navigating Today to Week to Today resets the content region's scroll each time", async ({
    page,
  }) => {
    await page.goto("/today");
    await expect(page.getByText("Row 39")).toBeAttached();

    await content(page).evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(() => content(page).evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    await page.getByRole("link", { name: "Week", exact: true }).click();
    await expect(page).toHaveURL(/\/week$/);
    await expect(page.getByText("WORK-1039")).toBeAttached();
    expect(await content(page).evaluate((element) => element.scrollTop)).toBe(0);

    await content(page).evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(() => content(page).evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    await page.getByRole("link", { name: "Today", exact: true }).click();
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.getByText("Row 39")).toBeAttached();
    expect(await content(page).evaluate((element) => element.scrollTop)).toBe(0);
  });

  // #117 task 3, fix round 1: the md:-gating that keeps the rail from being
  // pinned below that breakpoint (see the task report) had no committed
  // test — an unconditional h-screen passed every other test in this file,
  // because none of them run under md:. 390×844 matches today.spec.ts's own
  // narrow-viewport tests, which only ever assert horizontal overflow.
  test("below md:, the page itself scrolls and the rail travels with it, not the content region", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/today");
    await expect(page.getByText("Row 39")).toBeAttached();

    const rail = page.locator("aside.that-rail");
    const before = await rail.boundingBox();

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // window.scrollY is the direct claim ("the page itself scrolls"); the
    // rail's box moving by the same amount is the honest sign that it is not
    // pinned in place the way it is at md: and up — a fixed rail would stay
    // at the same y while the page scrolled past it.
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    const after = await rail.boundingBox();
    expect(after?.y).toBeLessThan(before?.y ?? 0);

    // The counterpart to the md: tests above: #content never becomes the
    // scrolling region below the breakpoint, so its own scrollTop stays 0
    // throughout — the scroll happened on window, not here.
    expect(await content(page).evaluate((element) => element.scrollTop)).toBe(0);
  });

  // R7 says a view change resets scroll. router.ts's resetContentScroll used
  // to reset only #content, which is a no-op below md: — window is the
  // scroller there, per the test above — so a phone landed Today-to-Week
  // navigation mid-page. Asserting #content.scrollTop === 0 here would be
  // trivially true regardless, since it is never the scroller at this width.
  test("below md:, navigating Today to Week resets the window's scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/today");
    await expect(page.getByText("Row 39")).toBeAttached();

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    await page.getByRole("link", { name: "Week", exact: true }).click();
    await expect(page).toHaveURL(/\/week$/);
    await expect(page.getByText("WORK-1039")).toBeAttached();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
});
