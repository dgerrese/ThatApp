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

test("the host is a polite live region from first render, hidden while empty", async ({ page }) => {
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
  await expect(page.locator("that-toast", { hasText: "Pushed 1 entry." })).toHaveCount(0, { timeout: 6000 });
  await page.waitForTimeout(1000);
  await expect(page.locator("that-toast", { hasText: "stays" })).toBeVisible();
  await expect(page.locator("that-toast[tone='error'] [data-countdown]")).toHaveCount(0);
});

test("hovering a success pauses its countdown, and leaving resumes it", async ({ page }) => {
  await add(page, "success", "Pushed 1 entry.");
  const toast = page.locator("that-toast");
  await toast.hover();
  await page.waitForTimeout(5000);
  await expect(toast).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(toast).toHaveCount(0, { timeout: 6000 });
});

test("focus on Dismiss pauses the countdown, and Dismiss closes the toast", async ({ page }) => {
  await add(page, "success", "Pushed 1 entry.");
  const dismiss = page.getByRole("button", { name: "Dismiss" });
  await dismiss.focus();
  await page.waitForTimeout(5000);
  await expect(page.locator("that-toast")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("that-toast")).toHaveCount(0);
  await expect(page.locator("that-toasts")).toBeHidden();
});

test("an error survives moving to Week and back", async ({ page }) => {
  await page.route("**/api/week**", (r) => r.fulfill({ status: 500, json: { code: "x", message: "y" } }));
  await add(page, "error", "stays across views");
  await page.getByRole("link", { name: "Week" }).click();
  await page.getByRole("link", { name: "Today" }).click();
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
  expect(await page.evaluate(() => document.querySelector("that-toasts")?.parentElement === document.body)).toBe(true);
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
