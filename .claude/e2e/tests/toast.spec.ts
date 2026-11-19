import { expect, test, type Page } from "@playwright/test";

// The host is upgraded from its own chunk, like that-tooltip, so a test waits
// for the definition and then drives the host directly. Views are stubbed
// empty: this spec is about the component, not a consumer.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/issues", (r) => r.fulfill({ status: 200, json: { instances: [] } }));
  await page.route("**/api/pins**", (r) => r.fulfill({ status: 200, json: [] }));
  await page.route("**/api/entries**", (r) =>
    r.fulfill({ status: 200, json: { today: "2026-09-30", entries: [] } }),
  );
  await page.goto("/today");
  await page.waitForFunction(() => customElements.get("that-toasts") !== undefined);
});

async function add(page: Page, tone: string, message: string, items: string[] = []): Promise<void> {
  await page.evaluate(
    ({ tone, message, items }) => {
      const host = document.querySelector("that-toasts") as HTMLElement & {
        add(tone: string, message: string, items: string[]): HTMLElement;
      };
      host.add(tone, message, items);
    },
    { tone, message, items },
  );
}

test("the host is a polite live region from first render, empty and zero-size", async ({ page }) => {
  const host = page.locator("that-toasts");
  await expect(host).toHaveAttribute("role", "status");
  await expect(host).toHaveAttribute("aria-live", "polite");
  await expect(host).toBeHidden();
});

test("a toast's text is inside the live region, with its mark and its list", async ({ page }) => {
  await add(page, "warning", "1 of 2 entries could not be pushed.", ["RIDGE-2 — unreachable"]);
  const toast = page.locator("that-toasts that-toast");
  await expect(toast).toHaveCount(1);
  await expect(toast).toContainText("1 of 2 entries could not be pushed.");
  await expect(toast.getByRole("listitem")).toHaveText("RIDGE-2 — unreachable");
  await expect(toast.getByRole("img", { name: "Warning" })).toBeVisible();
  await expect(page.locator("that-toasts [role='status']")).toHaveCount(0);
});

test("toasts stack bottom-right, 16px from the edges, 8px apart, newest at the bottom", async ({ page }) => {
  await add(page, "error", "first");
  await add(page, "error", "second");
  const boxes = await page.locator("that-toast").evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect),
  );
  const [first, second] = boxes;
  const view = page.viewportSize()!;
  expect(second!.top).toBeGreaterThan(first!.top);
  expect(second!.top - first!.bottom).toBeCloseTo(8, 0);
  expect(view.height - second!.bottom).toBeCloseTo(16, 0);
  expect(view.width - second!.right).toBeCloseTo(16, 0);
  expect(second!.width).toBeCloseTo(320, 0);
});

test("the anatomy matches the design's table", async ({ page }) => {
  await add(page, "success", "Pushed 1 entry.");
  const toast = page.locator("that-toast");
  const style = await toast.evaluate((el) => {
    const s = getComputedStyle(el);
    const probe = document.createElement("div");
    probe.className = "bg-raised";
    document.body.append(probe);
    const raised = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      background: s.backgroundColor,
      raised,
      radius: s.borderTopLeftRadius,
      padding: `${s.paddingTop} ${s.paddingRight} ${s.paddingBottom} ${s.paddingLeft}`,
    };
  });
  expect(style.background).toBe(style.raised);
  expect(style.radius).toBe("8px");
  expect(style.padding).toBe("11px 12px 11px 14px");
  const dismiss = toast.getByRole("button", { name: "Dismiss" });
  await expect(dismiss).toBeVisible();
  expect((await dismiss.locator("svg").getAttribute("width"))).toBe("16");
  await expect(toast.locator("[data-countdown]")).toBeVisible();
});

test("a success leaves after about 4 seconds; a warning or error does not", async ({ page }) => {
  await page.mouse.move(0, 0);
  await add(page, "success", "Pushed 1 entry.");
  await add(page, "error", "stays");
  await expect(page.locator("that-toast", { hasText: "Pushed 1 entry." })).toBeVisible();
  await expect(page.locator("that-toast", { hasText: "Pushed 1 entry." })).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator("that-toast", { hasText: "stays" })).toBeVisible();
  await expect(page.locator("that-toast[tone='error'] [data-countdown]")).toHaveCount(0);
});

// The countdown's clock starts at add, not at hover, so the pause is proved on
// the animation itself rather than by outliving it.
async function countdownState(page: Page): Promise<{ playState: string; currentTime: number }> {
  return page.evaluate(() => {
    const fill = document.querySelector("[data-countdown] span");
    const animation = fill?.getAnimations()[0];
    if (!animation) throw new Error("no countdown animation");
    return { playState: animation.playState, currentTime: Number(animation.currentTime) };
  });
}

async function seekCountdown(page: Page, ms: number): Promise<void> {
  await page.evaluate((ms) => {
    const animation = document.querySelector("[data-countdown] span")?.getAnimations()[0];
    if (!animation) throw new Error("no countdown animation");
    animation.currentTime = ms;
  }, ms);
}

async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
}

test("hovering a success pauses its countdown, and leaving resumes it", async ({ page }) => {
  await add(page, "success", "Pushed 1 entry.");
  const toast = page.locator("that-toast");
  await toast.hover();
  await expect.poll(async () => (await countdownState(page)).playState).toBe("paused");
  await seekCountdown(page, 2000);
  await nextFrames(page);
  expect((await countdownState(page)).currentTime).toBe(2000);

  await page.mouse.move(0, 0);
  await expect.poll(async () => (await countdownState(page)).playState).toBe("running");
  expect((await countdownState(page)).currentTime).toBeGreaterThanOrEqual(2000);
  await expect(toast).toHaveCount(0, { timeout: 10_000 });
});

test("focus on Dismiss pauses the countdown, and Dismiss closes the toast", async ({ page }) => {
  await add(page, "success", "Pushed 1 entry.");
  const dismiss = page.getByRole("button", { name: "Dismiss" });
  await dismiss.focus();
  await expect.poll(async () => (await countdownState(page)).playState).toBe("paused");
  await seekCountdown(page, 2000);
  await nextFrames(page);
  expect((await countdownState(page)).currentTime).toBe(2000);
  await expect(page.locator("that-toast")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("that-toast")).toHaveCount(0);
  await expect(page.locator("that-toasts")).toBeHidden();
});

test("an error survives moving to Week and back", async ({ page }) => {
  await page.route("**/api/week**", (r) => r.fulfill({ status: 500, json: { code: "x", message: "y" } }));
  await add(page, "error", "stays across views");
  await page.getByRole("link", { name: "Week", exact: true }).click();
  await page.getByRole("link", { name: "Today", exact: true }).click();
  await expect(page.locator("that-toast", { hasText: "stays across views" })).toBeVisible();
});

test("a toast added while a dialog is open sits above it, and Dismiss works", async ({ page }) => {
  await page.evaluate(() => {
    const dialog = document.createElement("dialog");
    dialog.id = "fixture-dialog";
    dialog.textContent = "a dialog";
    document.body.append(dialog);
    dialog.showModal();
  });
  await add(page, "error", "above the dialog");
  const dismiss = page.locator("that-toast").getByRole("button", { name: "Dismiss" });
  await dismiss.click();
  await expect(page.locator("that-toast")).toHaveCount(0);
  await expect(page.locator("#fixture-dialog")).toBeVisible();
});

test("a toast added over a second modal dialog is clickable", async ({ page }) => {
  await openFixtureDialog(page);
  await page.evaluate(() => {
    const top = document.createElement("dialog");
    top.id = "top-dialog";
    top.textContent = "on top";
    document.body.append(top);
    top.showModal();
  });
  await add(page, "error", "over both");
  await page.locator("that-toast").getByRole("button", { name: "Dismiss" }).click();
  await expect(page.locator("that-toast")).toHaveCount(0);
});

async function openFixtureDialog(page: Page): Promise<void> {
  await page.evaluate(() => {
    const dialog = document.createElement("dialog");
    dialog.id = "fixture-dialog";
    dialog.textContent = "a dialog";
    document.body.append(dialog);
    dialog.showModal();
  });
}

test("closing the dialog returns the host to body, keeping its toast", async ({ page }) => {
  await openFixtureDialog(page);
  await add(page, "error", "outlives the dialog");
  await page.evaluate(() => document.querySelector<HTMLDialogElement>("#fixture-dialog")?.close());
  await expect
    .poll(() => page.evaluate(() => document.querySelector("that-toasts")?.parentElement === document.body))
    .toBe(true);
  await expect(page.locator("that-toast", { hasText: "outlives the dialog" })).toBeVisible();
  await add(page, "error", "after");
  const view = page.viewportSize()!;
  const box = await page.locator("that-toast", { hasText: "after" }).boundingBox();
  expect(view.height - (box!.y + box!.height)).toBeCloseTo(16, 0);
  expect(view.width - (box!.x + box!.width)).toBeCloseTo(16, 0);
});

test("removing an open dialog without closing it does not lose the host", async ({ page }) => {
  await openFixtureDialog(page);
  await add(page, "error", "first");
  await page.evaluate(() => document.querySelector("#fixture-dialog")?.remove());
  await add(page, "error", "still works");
  await expect(page.locator("that-toast", { hasText: "still works" })).toBeVisible();
});

// CB#123, decision 3: state messages stay inline. The other guards are count-0
// assertions inside the tests that already set each case up; this is the one
// case none of them stubs.
test("the pinned list's read failure is an inline alert, not a toast", async ({ page }) => {
  await page.route("**/api/pins**", (r) =>
    r.fulfill({ status: 500, json: { code: "store_failed", message: "could not read the stored pins" } }),
  );
  // Pinned only shows once an instance exists.
  await page.route("**/api/issues", (r) =>
    r.fulfill({ status: 200, json: { instances: [{ id: 1, name: "Work", issues: [], error: null }] } }),
  );
  await page.route("**/api/week**", (r) => 
    r.fulfill({
      status: 200,
      json: {
        start: "2026-09-28",
        end: "2026-10-04",
        prevStart: "2026-09-21",
        nextStart: "2026-10-05",
        weekNumber: 40,
        days: [],
        rows: [],
        seconds: 0,
      },
    }),
  );
  // The beforeEach already loaded Today; leave and return so it reads pins again.
  await page.getByRole("link", { name: "Week", exact: true }).click();
  await page.getByRole("link", { name: "Today", exact: true }).click();

  await expect(page.locator("#view that-alert", { hasText: "could not read the stored pins" })).toBeVisible();
  await expect(page.locator("that-toast")).toHaveCount(0);
});
