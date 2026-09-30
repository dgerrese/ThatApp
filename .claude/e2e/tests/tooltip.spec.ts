import { expect, test } from "@playwright/test";

// This spec builds its own trigger and tooltip in the running app rather than
// driving a view: what it is about is the component, not any one consumer of
// it. /today is stubbed empty and used only to load the real bundle and
// stylesheet — and it carries tooltips of its own now, which is why every
// locator below asks for the one this spec mounted, by data-fixture.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/issues", (route) =>
    route.fulfill({ status: 200, json: { instances: [] } }),
  );
  await page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 200, json: { today: "2026-09-09", entries: [] } }),
  );
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
    tooltip.dataset["fixture"] = "";
    tooltip.setAttribute("for", opts.id);
    if (opts.anchor) tooltip.setAttribute("anchor", opts.anchor);
    tooltip.textContent = opts.text;

    document.body.append(trigger, tooltip);
  }, options);
}

/**
 * main.ts registers that-tooltip from its own split chunk (see the comment
 * there), so a <that-tooltip> can sit in the DOM un-upgraded for as long as
 * that chunk takes to arrive — or forever, on a cache miss or a 404 in this
 * offline PWA's service worker. Un-upgraded, it is display: inline with a
 * real box, and its text renders as page content: a ticket row's own pin
 * control carries one reading "pin ticket" — an inline control, which keeps
 * its tooltip under Decision 12 where Today's Refresh no longer does. The
 * chunk's filename carries a build hash this spec cannot predict, so the
 * block below finds it by what it contains — fetching every script for real
 * and inspecting the body — rather than by name.
 */
test("a that-tooltip that never upgrades stays invisible, not printed into the page", async ({
  page,
}) => {
  const base = process.env["THAT_BASE_URL"] ?? "http://that-e2e:8080";

  // One issue is enough to render a ticket row, and its pin control is what
  // carries the real that-tooltip this test needs — that-ticket-row.ts is
  // part of Today's own chunk, not that-tooltip's, so blocking the latter
  // below leaves the row free to render normally.
  await page.route("**/api/issues", (route) =>
    route.fulfill({
      status: 200,
      json: {
        instances: [
          {
            id: 1,
            name: "Work",
            issues: [{ key: "WORK-1", summary: "Fix the thing", status: "To Do", url: "" }],
            error: null,
          },
        ],
      },
    }),
  );
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));

  await page.route("**/*.js", async (route) => {
    const requested = new URL(route.request().url());
    const response = await fetch(`${base}${requested.pathname}${requested.search}`);
    const body = await response.text();
    if (body.includes('customElements.define("that-tooltip"')) {
      await route.abort("failed");
      return;
    }
    await route.fulfill({
      status: response.status,
      body,
      contentType: response.headers.get("content-type") ?? "text/javascript",
    });
  });

  await page.reload();
  // .first(): #143 gave the summary its own cut-text that-tooltip, which
  // repeats this same text — un-upgraded, so it is the second match here too.
  await expect(page.getByText("Fix the thing").first()).toBeVisible();

  // Proves the block actually worked — the element never upgraded — so the
  // assertions below are proving the CSS rule in styles.css, not a
  // coincidence of timing.
  const upgraded = await page.evaluate(() => customElements.get("that-tooltip") !== undefined);
  expect(upgraded).toBe(false);

  const pinTooltip = page.locator("that-tooltip", { hasText: "pin ticket" });
  await expect(pinTooltip).toBeAttached();
  await expect(pinTooltip).toBeHidden();
  expect(await pinTooltip.boundingBox()).toBeNull();
});

test("hovering a trigger shows the tooltip, and pointerleave hides it again", async ({ page }) => {
  await mountTrigger(page);
  const tooltip = page.locator("that-tooltip[data-fixture]");
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

// #246: the tooltip wears the drawing's .tip skin (prototype line 167). The
// ground is compared against a probe carrying the drawing's own value, so the
// test does not depend on how each browser serialises an oklch() colour.
test("the tooltip wears the drawing's .tip skin", async ({ page }) => {
  await mountTrigger(page);
  await page.locator("#trigger").hover();
  const tooltip = page.locator("that-tooltip[data-fixture]");
  await expect(tooltip).toBeVisible();

  const skin = await tooltip.evaluate((el) => {
    const probe = document.createElement("div");
    probe.style.background = "oklch(0.06 0.004 60)";
    document.body.append(probe);
    const drawnGround = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const s = getComputedStyle(el);
    return {
      ground: s.backgroundColor,
      drawnGround,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      padding: `${s.paddingTop} ${s.paddingRight} ${s.paddingBottom} ${s.paddingLeft}`,
      shadow: s.boxShadow,
    };
  });

  expect(skin.ground).toBe(skin.drawnGround);
  expect(skin.fontSize).toBe("12px");
  expect(skin.fontWeight).toBe("500");
  expect(skin.padding).toBe("5px 9px 5px 9px");
  expect(skin.shadow).toBe("none");
});

// The drawing's .tip sits at bottom: calc(100% + 7px) — above the trigger,
// centred — and reveal() is meant to compute the same box. Fixed-positioned
// at mid-viewport rather than relying on mountTrigger's natural flow
// position: this is the case with room on both sides, distinct from the
// no-room-above case a trigger near the top of the viewport would raise.
test("the tooltip opens above its trigger, with the drawn 7px gap", async ({ page }) => {
  await page.evaluate(() => {
    const trigger = document.createElement("button");
    trigger.id = "midpoint-trigger";
    trigger.type = "button";
    trigger.setAttribute("aria-label", "Pin this issue");
    trigger.textContent = "•";
    trigger.style.cssText = "position: fixed; top: 300px; left: 300px;";

    const tooltip = document.createElement("that-tooltip");
    tooltip.dataset["fixture"] = "";
    tooltip.setAttribute("for", "midpoint-trigger");
    tooltip.textContent = "Pin this issue";

    document.body.append(trigger, tooltip);
  });

  await page.locator("#midpoint-trigger").hover();
  const tooltip = page.locator("that-tooltip[data-fixture]");
  await expect(tooltip).toBeVisible();

  const tooltipBox = await tooltip.boundingBox();
  const triggerBox = await page.locator("#midpoint-trigger").boundingBox();
  expect(tooltipBox).not.toBeNull();
  expect(triggerBox).not.toBeNull();

  // Tooltip's bottom edge sits 7px above the trigger's top edge.
  expect(triggerBox!.y - (tooltipBox!.y + tooltipBox!.height)).toBeCloseTo(7, 0);
});

// The drawing's own fallback — `.tip.below` (prototype line 144) — for the
// case a trigger flush against the window's own top edge raises: there is no
// room above it to open into. Week's header arrows and a Today row scrolled
// to the top of #content hit exactly this.
test("the tooltip falls back below when there is no room above", async ({ page }) => {
  await page.evaluate(() => {
    const trigger = document.createElement("button");
    trigger.id = "top-trigger";
    trigger.type = "button";
    trigger.setAttribute("aria-label", "Pin this issue");
    trigger.textContent = "•";
    trigger.style.cssText = "position: fixed; top: 10px; left: 300px;";

    const tooltip = document.createElement("that-tooltip");
    tooltip.dataset["fixture"] = "";
    tooltip.setAttribute("for", "top-trigger");
    tooltip.textContent = "Pin this issue";

    document.body.append(trigger, tooltip);
  });

  await page.locator("#top-trigger").hover();
  const tooltip = page.locator("that-tooltip[data-fixture]");
  await expect(tooltip).toBeVisible();

  const tooltipBox = await tooltip.boundingBox();
  const triggerBox = await page.locator("#top-trigger").boundingBox();
  expect(tooltipBox).not.toBeNull();
  expect(triggerBox).not.toBeNull();

  // Tooltip's top edge sits 7px below the trigger's bottom edge, not above it.
  expect(tooltipBox!.y - (triggerBox!.y + triggerBox!.height)).toBeCloseTo(7, 0);
});

// Task 7 fix: the search panel's summary tooltip covered a focused key link
// sitting directly above it, because reveal() always opens above by default.
// `below` is the opt-in the drawing gives this case (.tip.below, prototype
// line 166) — a trigger with room below it opens there instead. Fixed at
// mid-viewport, the same reasoning as "the tooltip opens above its trigger"
// above: room on both sides, so this is the plain case, not the edge one.
test("a below tooltip opens under its trigger, with the drawn 7px gap", async ({ page }) => {
  await page.evaluate(() => {
    const trigger = document.createElement("button");
    trigger.id = "below-trigger";
    trigger.type = "button";
    trigger.setAttribute("aria-label", "Pin this issue");
    trigger.textContent = "•";
    trigger.style.cssText = "position: fixed; top: 300px; left: 300px;";

    const tooltip = document.createElement("that-tooltip");
    tooltip.dataset["fixture"] = "";
    tooltip.setAttribute("for", "below-trigger");
    tooltip.setAttribute("below", "");
    tooltip.textContent = "Pin this issue";

    document.body.append(trigger, tooltip);
  });

  await page.locator("#below-trigger").hover();
  const tooltip = page.locator("that-tooltip[data-fixture]");
  await expect(tooltip).toBeVisible();

  const tooltipBox = await tooltip.boundingBox();
  const triggerBox = await page.locator("#below-trigger").boundingBox();
  expect(tooltipBox).not.toBeNull();
  expect(triggerBox).not.toBeNull();

  // Tooltip's top edge sits 7px below the trigger's bottom edge, not above it.
  expect(tooltipBox!.y - (triggerBox!.y + triggerBox!.height)).toBeCloseTo(7, 0);
});

// The drawing's own fallback for `below`: a trigger flush against the
// window's bottom edge has no room to open into, so it falls back to the
// same above placement a plain tooltip always uses.
test("a below tooltip falls back above when there is no room below", async ({ page }) => {
  await page.evaluate(() => {
    const trigger = document.createElement("button");
    trigger.id = "bottom-trigger";
    trigger.type = "button";
    trigger.setAttribute("aria-label", "Pin this issue");
    trigger.textContent = "•";
    trigger.style.cssText = "position: fixed; bottom: 10px; left: 300px;";

    const tooltip = document.createElement("that-tooltip");
    tooltip.dataset["fixture"] = "";
    tooltip.setAttribute("for", "bottom-trigger");
    tooltip.setAttribute("below", "");
    tooltip.textContent = "Pin this issue";

    document.body.append(trigger, tooltip);
  });

  await page.locator("#bottom-trigger").hover();
  const tooltip = page.locator("that-tooltip[data-fixture]");
  await expect(tooltip).toBeVisible();

  const tooltipBox = await tooltip.boundingBox();
  const triggerBox = await page.locator("#bottom-trigger").boundingBox();
  expect(tooltipBox).not.toBeNull();
  expect(triggerBox).not.toBeNull();

  // Tooltip's bottom edge sits 7px above the trigger's top edge, not below it.
  expect(triggerBox!.y - (tooltipBox!.y + tooltipBox!.height)).toBeCloseTo(7, 0);
});

test("focusing the trigger by keyboard shows the tooltip too", async ({ page }) => {
  await mountTrigger(page);
  const trigger = page.locator("#trigger");
  const before = page.locator("#before");
  const tooltip = page.locator("that-tooltip[data-fixture]");

  await trigger.evaluate((t) =>
    t.before(
      Object.assign(document.createElement("button"), { id: "before", textContent: "before" }),
    ),
  );

  await before.focus();
  await page.mouse.move(0, 0);
  await page.keyboard.press("Tab");
  await expect(trigger).toBeFocused();
  await expect(tooltip).toBeVisible();

  await page.keyboard.press("Shift+Tab");
  await expect(before).toBeFocused();
  await expect(tooltip).toBeHidden();
});

// A trigger can be hovered and focused at once, so each release event can
// find the popover already in the state it is asking for. Neither call throws
// on that in either target browser — measured 2026-09-04 — so these two do
// not prove the guards in the component; removing those guards leaves both
// green. They cover the interaction itself: whichever way round the release
// happens, the tooltip ends hidden and the page raises nothing.
test("hover then focus, released pointer-first, ends hidden and quiet", async ({ page }) => {
  await mountTrigger(page);
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.locator("#trigger").hover();
  await page.locator("#trigger").focus();
  await page.mouse.move(0, 0);
  await page.locator("#trigger").blur();

  await expect(page.locator("that-tooltip[data-fixture]")).toBeHidden();
  expect(errors).toEqual([]);
});

test("hover then focus, released focus-first, ends hidden and quiet", async ({ page }) => {
  await mountTrigger(page);
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.locator("#trigger").hover();
  await page.locator("#trigger").focus();
  await page.locator("#trigger").blur();
  await page.mouse.move(0, 0);

  await expect(page.locator("that-tooltip[data-fixture]")).toBeHidden();
  expect(errors).toEqual([]);
});

test("the trigger's accessible name is unchanged by the tooltip's presence", async ({ page }) => {
  await mountTrigger(page);
  const trigger = page.locator("#trigger");

  await trigger.hover();
  await expect(page.locator("that-tooltip[data-fixture]")).toBeVisible();

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
//
// Bounding-box geometry never changes under an ancestor's overflow: hidden —
// that property clips paint, not layout — so a box-containment check alone
// cannot tell a genuinely escaping popover from a plain absolutely
// positioned div that merely computes the same coordinates. The assertions
// below hit-test with document.elementFromPoint instead, which reports what
// is actually painted at a pixel, and the "naive control" element proves the
// hit-test discriminates: it is built with reveal()'s exact maths but never
// promoted to the top layer, planted in the same clipped ancestor, and it is
// asserted NOT to be found there — if it were found, the positive assertion
// on the real tooltip would prove nothing.
test("the tooltip is not clipped by an ancestor with overflow: hidden", async ({ page }) => {
  // Prepended, not appended: document.elementFromPoint only sees what is in
  // the viewport, and appending after the rest of the shell's content would
  // place this region below the fold.
  //
  // No spacer inside the region, and no explicit height on it: it is left to
  // size itself to the trigger, its only content, so the trigger sits flush
  // against the region's own top edge and needs no scrolling to reach — by
  // any interaction method — while the region's rendered box still ends
  // exactly at the trigger's bottom, with nothing below it visible. An
  // earlier version pushed the trigger down with a spacer instead, and both
  // hover and focus scroll a programmatically-scrollable overflow: hidden
  // ancestor to bring an off-screen target within reach, which moved this
  // region's own scrollTop and put the naive control at the wrong
  // coordinates — a false pass for a reason that had nothing to do with
  // clipping. Flush placement removes the scroll from the picture entirely.
  //
  // The region does carry a margin-top, unlike before reveal() opened
  // upward: with the region prepended flush at the page's own top edge, the
  // tooltip's box would land above the viewport and elementFromPoint below
  // could never hit it — the escape would be real but unobservable. The
  // margin only moves the region within the page; it adds no space between
  // the region's own top edge and the trigger inside it, so the flush
  // placement above still holds and the scrollTop guard below still applies.
  await page.evaluate(() => {
    const region = document.createElement("div");
    region.id = "clip-region";
    region.style.cssText =
      "overflow: hidden; width: 200px; margin-top: 80px; transform: translateZ(0); position: relative;";

    const trigger = document.createElement("button");
    trigger.id = "clipped-trigger";
    trigger.type = "button";
    trigger.setAttribute("aria-label", "Pin this issue");
    trigger.textContent = "•";

    const tooltip = document.createElement("that-tooltip");
    tooltip.dataset["fixture"] = "";
    tooltip.setAttribute("for", "clipped-trigger");
    tooltip.textContent = "Pin this issue";

    region.append(trigger, tooltip);
    document.body.prepend(region);
  });

  // Hover, not focus: a keyboard reveal of this same component is already
  // covered above, and this test's own reveal mechanism does not matter to
  // what it is proving — only that nothing about revealing it moves the
  // region's scroll position, which the comment above the DOM setup depends
  // on. Confirmed by direct check, in both target browsers, before trusting it.
  await page.locator("#clipped-trigger").hover();

  const scrollTop = await page.evaluate(
    () => document.getElementById("clip-region")?.scrollTop,
  );
  expect(scrollTop).toBe(0);

  const tooltip = page.locator("that-tooltip[data-fixture]");
  await expect(tooltip).toBeVisible();

  const tooltipBox = await tooltip.boundingBox();
  const regionBox = await page.locator("#clip-region").boundingBox();
  expect(tooltipBox).not.toBeNull();
  expect(regionBox).not.toBeNull();

  // Necessary but not sufficient on its own (see the comment above the
  // test): the tooltip's box ends above the region's own top edge — reveal()
  // opens upward, and the trigger sits flush against that edge.
  expect(tooltipBox!.y + tooltipBox!.height).toBeLessThanOrEqual(regionBox!.y);

  // What actually proves escape: the pixel at the tooltip's own centre is
  // painted by the tooltip itself.
  const paintedByTooltip = await page.evaluate(({ x, y, width, height }) => {
    const hit = document.elementFromPoint(x + width / 2, y + height / 2);
    return hit?.tagName.toLowerCase() === "that-tooltip";
  }, tooltipBox!);
  expect(paintedByTooltip).toBe(true);

  // Free the point for the control below: the real tooltip, being in the top
  // layer, would otherwise paint over it regardless of what the control does.
  // Far from the region, the trigger and the tooltip's box above it, so the
  // move reliably fires pointerleave.
  await page.mouse.move(500, 500);
  await expect(tooltip).toBeHidden();

  const control = await page.evaluate((box) => {
    const region = document.getElementById("clip-region");
    if (!region) throw new Error("clip-region missing");

    const naive = document.createElement("div");
    naive.id = "naive-control";
    naive.textContent = "Pin this issue";
    // The exact box the real tooltip just occupied, so this is "positioned
    // off the trigger's rect the same way" — the only difference from the
    // real tooltip is that this element is never promoted to the top layer.
    // region's own transform makes it this element's containing block, so a
    // position: fixed child is fixed to region's box, not the viewport —
    // box.y/box.x (viewport-relative, from the real tooltip's own rect) are
    // translated into the region's own coordinate space first.
    const regionRect = region.getBoundingClientRect();
    naive.style.cssText =
      `position: fixed; top: ${box.y - regionRect.top}px; left: ${box.x - regionRect.left}px; ` +
      `width: ${box.width}px; height: ${box.height}px;`;
    region.append(naive);

    const rendered = naive.getBoundingClientRect();
    return {
      intended: { x: box.x, y: box.y, width: box.width, height: box.height },
      rendered: { x: rendered.x, y: rendered.y, width: rendered.width, height: rendered.height },
    };
  }, tooltipBox!);

  // The control is only a fair comparison if it actually landed where it
  // was told to — this is what the spacer-based version got wrong. The
  // assertions' own diff reports the numbers if it has not.
  expect(control.rendered.x).toBeCloseTo(control.intended.x, 0);
  expect(control.rendered.y).toBeCloseTo(control.intended.y, 0);

  const paintedByControl = await page.evaluate(({ x, y, width, height }) => {
    const hit = document.elementFromPoint(x + width / 2, y + height / 2);
    return hit?.id === "naive-control";
  }, control.intended);

  // The discriminating half: a plain element positioned identically, inside
  // the same clipped-and-transformed ancestor, is NOT what paints at that
  // pixel. If this were true, the positive assertion above would be
  // meaningless — anything landing on that spot would pass it.
  expect(paintedByControl).toBe(false);
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
  const tooltip = page.locator("that-tooltip[data-fixture]");
  await expect(tooltip).toBeVisible();

  const tooltipBox = await tooltip.boundingBox();
  const triggerBox = await page.locator("#trailing-trigger").boundingBox();
  expect(tooltipBox).not.toBeNull();
  expect(triggerBox).not.toBeNull();

  const tooltipRight = tooltipBox!.x + tooltipBox!.width;
  const triggerRight = triggerBox!.x + triggerBox!.width;
  expect(Math.abs(tooltipRight - triggerRight)).toBeLessThanOrEqual(1);
});

// reveal() computes top/left once, at show time, from the trigger's box and
// this element's own width. that-ticket-row's pin control repaints this
// element's text — "pin ticket" to "unpin ticket" — on the same click that
// leaves the tooltip open under the pointer, which grows the box without
// reveal() ever hearing about it: measured in Firefox, primary target, where
// a clicked button does not gain focus and so nothing re-runs reveal() the
// way Chromium's own focus event does. This mutates the text directly rather
// than driving a real pin toggle: what is under test is the tooltip's own
// reaction to its content changing, not the row's.
test("the tooltip repositions when its text changes while open, keeping anchor=\"end\" aligned", async ({
  page,
}) => {
  await mountTrigger(page, {
    id: "growing-trigger",
    label: "Unpin",
    text: "pin ticket",
    anchor: "end",
  });

  await page.locator("#growing-trigger").hover();
  const tooltip = page.locator("that-tooltip[data-fixture]");
  await expect(tooltip).toBeVisible();

  await page.evaluate(() => {
    const el = document.querySelector("that-tooltip[data-fixture]");
    if (!el) throw new Error("tooltip fixture missing");
    el.textContent = "unpin ticket, now noticeably wider";
  });

  const tooltipBox = await tooltip.boundingBox();
  const triggerBox = await page.locator("#growing-trigger").boundingBox();
  expect(tooltipBox).not.toBeNull();
  expect(triggerBox).not.toBeNull();

  // Without the fix this box still sits at the shorter text's left, so its
  // now-wider content only grows the right edge further past the trigger's —
  // the same seam the pin control hits on every toggle.
  const tooltipRight = tooltipBox!.x + tooltipBox!.width;
  const triggerRight = triggerBox!.x + triggerBox!.width;
  expect(Math.abs(tooltipRight - triggerRight)).toBeLessThanOrEqual(1);
});

async function mountCutText(
  page: import("@playwright/test").Page,
  text: string,
  width: number,
): Promise<void> {
  await page.evaluate(
    ({ text, width }) => {
      const link = document.createElement("a");
      link.id = "cut-link";
      link.href = "#";
      link.textContent = "KEY-1";

      const span = document.createElement("span");
      span.id = "cut-text";
      span.className = "block truncate";
      span.style.width = `${width}px`;
      span.textContent = text;

      const tooltip = document.createElement("that-tooltip");
      tooltip.dataset["fixture"] = "";
      tooltip.setAttribute("for", "cut-text");
      tooltip.setAttribute("focus-for", "cut-link");
      tooltip.setAttribute("wrap", "");
      tooltip.setAttribute("when-cut", "");
      tooltip.textContent = text;

      document.body.prepend(link, span, tooltip);
    },
    { text, width },
  );
}

const longText =
  "A summary long enough that no reasonable column shows all of it, so the ellipsis engages";

test("a when-cut tooltip opens on hover of cut text and wraps", async ({ page }) => {
  await mountCutText(page, longText, 120);
  const tip = page.locator("that-tooltip[data-fixture]");
  await page.locator("#cut-text").hover();
  await expect(tip).toBeVisible();
  const box = await tip.boundingBox();
  expect(box?.width ?? 0).toBeLessThanOrEqual(341);
  expect(box?.height ?? 0).toBeGreaterThan(30); // more than one line: it wraps
});

test("a when-cut tooltip opens on focus of its focus-for element, and closes on blur", async ({
  page,
}) => {
  await mountCutText(page, longText, 120);
  const tip = page.locator("that-tooltip[data-fixture]");
  await page.locator("#cut-link").focus();
  await expect(tip).toBeVisible();
  await page.locator("#cut-link").blur();
  await expect(tip).toBeHidden();
});

test("a when-cut tooltip stays closed when the text is not cut, on hover and on focus", async ({
  page,
}) => {
  await mountCutText(page, "Short", 400);
  const tip = page.locator("that-tooltip[data-fixture]");
  await page.locator("#cut-text").hover();
  await expect(tip).toBeHidden();
  await page.locator("#cut-link").focus();
  await expect(tip).toBeHidden();
});

test("a tooltip removed while open leaves nothing in the top layer", async ({ page }) => {
  await mountCutText(page, longText, 120);
  await page.locator("#cut-link").focus();
  await expect(page.locator("that-tooltip[data-fixture]")).toBeVisible();
  const open = await page.evaluate(() => {
    document.querySelector("that-tooltip[data-fixture]")?.remove();
    return document.querySelectorAll(":popover-open").length;
  });
  expect(open).toBe(0);
});

test("a tooltip near the left edge stays inside the window", async ({ page }) => {
  await page.evaluate(() => {
    const span = document.createElement("span");
    span.id = "edge-text";
    span.className = "block truncate";
    span.style.cssText = "position:fixed;left:0;top:200px;width:40px";
    span.textContent = "An instance name far too long for the rail";
    const tooltip = document.createElement("that-tooltip");
    tooltip.dataset["fixture"] = "";
    tooltip.setAttribute("for", "edge-text");
    tooltip.setAttribute("wrap", "");
    tooltip.setAttribute("when-cut", "");
    tooltip.textContent = span.textContent;
    document.body.append(span, tooltip);
  });
  await page.locator("#edge-text").hover();
  const box = await page.locator("that-tooltip[data-fixture]").boundingBox();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
});
