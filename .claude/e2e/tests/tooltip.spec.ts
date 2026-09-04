import { expect, test } from "@playwright/test";

// that-tooltip has no consumer yet (Task 3 is the first), so this spec builds
// its own trigger and tooltip in the running app rather than driving a view.
// /today is stubbed empty and used only to load the real bundle and stylesheet.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/issues", (route) =>
    route.fulfill({ status: 200, json: { instances: [] } }),
  );
  await page.route("**/api/entries**", (route) => route.fulfill({ status: 200, json: [] }));
  await page.goto("/today");
});

async function mountTrigger(
  page: import("@playwright/test").Page,
  options: { id: string; label: string; text: string; anchor?: string } = {
    id: "trigger",
    label: "Pin this issue",
    text: "Pin this issue",
  },
): Promise<void> {
  await page.evaluate((opts) => {
    const trigger = document.createElement("button");
    trigger.id = opts.id;
    trigger.type = "button";
    trigger.setAttribute("aria-label", opts.label);
    trigger.textContent = "•";

    const tooltip = document.createElement("that-tooltip");
    tooltip.setAttribute("for", opts.id);
    if (opts.anchor) tooltip.setAttribute("anchor", opts.anchor);
    tooltip.textContent = opts.text;

    document.body.append(trigger, tooltip);
  }, options);
}

test("hovering a trigger shows the tooltip, and pointerleave hides it again", async ({ page }) => {
  await mountTrigger(page);
  const tooltip = page.locator("that-tooltip");
  const trigger = page.locator("#trigger");

  await expect(tooltip).toBeHidden();

  await trigger.hover();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText("Pin this issue");

  // Move away rather than dispatch pointerleave by hand: the real event chain
  // is what the component listens for.
  await page.mouse.move(0, 0);
  await expect(tooltip).toBeHidden();
});

test("focusing the trigger by keyboard shows the tooltip too", async ({ page }) => {
  await mountTrigger(page);
  const tooltip = page.locator("that-tooltip");

  await page.locator("#trigger").focus();
  await expect(tooltip).toBeVisible();

  await page.locator("#trigger").blur();
  await expect(tooltip).toBeHidden();
});

test("the trigger's accessible name is unchanged by the tooltip's presence", async ({ page }) => {
  await mountTrigger(page);
  const trigger = page.locator("#trigger");

  await trigger.hover();
  await expect(page.locator("that-tooltip")).toBeVisible();

  // The tooltip is never wired as the accessible name or description: the
  // trigger's own aria-label is the only source of it, before or during.
  await expect(trigger).toHaveAttribute("aria-label", "Pin this issue");
  expect(await trigger.getAttribute("aria-describedby")).toBeNull();
  expect(await trigger.getAttribute("aria-labelledby")).toBeNull();
  await expect(page.getByRole("button", { name: "Pin this issue" })).toHaveCount(1);
});

// The point of the whole component: a tooltip parented to its trigger can be
// clipped by any ancestor that gains overflow: hidden, and that failure stays
// invisible until the day it does. The ancestor here also gains a transform,
// which establishes a new containing block — the realistic trap, since a
// plain position: fixed element (no top layer) is clipped by that too, not
// just by overflow: hidden alone.
test("the tooltip is not clipped by an ancestor with overflow: hidden", async ({ page }) => {
  await page.evaluate(() => {
    const region = document.createElement("div");
    region.id = "clip-region";
    region.style.cssText =
      "overflow: hidden; height: 40px; width: 200px; transform: translateZ(0); position: relative;";

    // Pushes the trigger's real layout position well past the region's own
    // 40px clipped height, so a tooltip positioned below it can only land
    // outside the region's box.
    const spacer = document.createElement("div");
    spacer.style.height = "120px";

    const trigger = document.createElement("button");
    trigger.id = "clipped-trigger";
    trigger.type = "button";
    trigger.setAttribute("aria-label", "Pin this issue");
    trigger.textContent = "•";

    const tooltip = document.createElement("that-tooltip");
    tooltip.setAttribute("for", "clipped-trigger");
    tooltip.textContent = "Pin this issue";

    region.append(spacer, trigger, tooltip);
    document.body.append(region);
  });

  await page.locator("#clipped-trigger").focus();

  const tooltip = page.locator("that-tooltip");
  await expect(tooltip).toBeVisible();

  const tooltipBox = await tooltip.boundingBox();
  const regionBox = await page.locator("#clip-region").boundingBox();
  expect(tooltipBox).not.toBeNull();
  expect(regionBox).not.toBeNull();

  // Not contained: the tooltip's box starts below the region's own bottom
  // edge, which a clipped rendering could never show as visible.
  expect(tooltipBox!.y).toBeGreaterThanOrEqual(regionBox!.y + regionBox!.height);
});

test('anchor="end" puts the tooltip\'s right edge within a pixel of the trigger\'s', async ({
  page,
}) => {
  await mountTrigger(page, {
    id: "trailing-trigger",
    label: "Unpin",
    text: "Unpin this issue",
    anchor: "end",
  });

  await page.locator("#trailing-trigger").hover();
  const tooltip = page.locator("that-tooltip");
  await expect(tooltip).toBeVisible();

  const tooltipBox = await tooltip.boundingBox();
  const triggerBox = await page.locator("#trailing-trigger").boundingBox();
  expect(tooltipBox).not.toBeNull();
  expect(triggerBox).not.toBeNull();

  const tooltipRight = tooltipBox!.x + tooltipBox!.width;
  const triggerRight = triggerBox!.x + triggerBox!.width;
  expect(Math.abs(tooltipRight - triggerRight)).toBeLessThanOrEqual(1);
});
