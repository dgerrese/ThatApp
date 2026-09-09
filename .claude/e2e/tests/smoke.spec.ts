import { expect, test, type Page } from "@playwright/test";

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

  test("keyboard focus reaches a nav row and rings it in the rail's hover wash", async ({ page }) => {
    await gotoEmptyToday(page);

    // Real Tab presses, not .focus(): a programmatic focus() does not reliably
    // arm :focus-visible the way keyboard navigation does.
    const navLink = page.locator("aside.that-rail a.that-nav:focus");
    let reached = false;
    for (let presses = 0; presses < 8 && !reached; presses++) {
      await page.keyboard.press("Tab");
      reached = (await navLink.count()) > 0;
    }
    expect(reached).toBe(true);

    const background = await navLink.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(background).not.toBe("rgba(0, 0, 0, 0)");
    expect(background).not.toBe(await computedColor(page, "bg-rail-active", "backgroundColor"));
  });

  // R3: the button's own words follow the period, not merely what was true on
  // first paint. week.ts and TODAY_PERIOD both hand the rail a pushLabel.
  test("Push's label follows the period after navigating, not only at boot", async ({ page }) => {
    await gotoEmptyToday(page);

    const push = page.getByRole("button", { name: "Push to Jira" });
    await expect(push).toBeVisible();

    await page.getByRole("link", { name: "Week", exact: true }).click();
    await expect(page).toHaveURL(/\/week$/);
    await expect(page.getByRole("button", { name: "Push this week" })).toBeVisible();
  });
});
