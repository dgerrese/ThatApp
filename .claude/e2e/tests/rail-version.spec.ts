import { expect, test, type Page } from "@playwright/test";

const URL = "https://github.com/dgerrese/ThatApp/releases/tag/v2026.49.1";

async function open(page: Page, version: unknown | number): Promise<void> {
  await page.route("**/api/issues", (r) => r.fulfill({ status: 200, json: { instances: [] } }));
  await page.route("**/api/pins**", (r) => r.fulfill({ status: 200, json: [] }));
  await page.route("**/api/entries**", (r) =>
    r.fulfill({ status: 200, json: { today: "2026-09-30", entries: [] } }),
  );
  await page.route("**/api/version", (r) =>
    typeof version === "number"
      ? r.fulfill({ status: version, json: { error: "boom" } })
      : r.fulfill({ status: 200, json: version }),
  );
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto("/today");
}

async function footInsideRail(page: Page): Promise<void> {
  const rail = await page.locator("aside").boundingBox();
  const parts = await page.locator("#rail-version *").evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect),
  );
  expect(rail).not.toBeNull();
  expect(parts.length).toBeGreaterThan(0);
  for (const b of parts) {
    expect(b.left).toBeGreaterThanOrEqual((rail?.x ?? 0) - 0.5);
    expect(b.right).toBeLessThanOrEqual((rail?.x ?? 0) + (rail?.width ?? 0) + 0.5);
    expect(b.bottom).toBeLessThanOrEqual((rail?.y ?? 0) + (rail?.height ?? 0) + 0.5);
  }
}

test("up to date: only the version", async ({ page }) => {
  await open(page, { version: "2026.47.1", latest: null, error: "" });
  await expect(page.locator("#rail-version")).toHaveText("ThatApp 2026.47.1");
  await expect(page.locator("#rail-version a")).toHaveCount(0);
  await footInsideRail(page);
});

test("update: the newest release links out above the version", async ({ page }) => {
  await open(page, { version: "2026.47.1", latest: { version: "2026.49.1", url: URL }, error: "" });
  const link = page.locator("#rail-version a");
  await expect(link).toHaveText("2026.49.1 available");
  await expect(link).toHaveAttribute("href", URL);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(page.locator("#rail-version")).toHaveText(/2026\.49\.1 available\s*ThatApp 2026\.47\.1/);
  await footInsideRail(page);
});

test("failed: the label and the reason", async ({ page }) => {
  await open(page, { version: "2026.47.1", latest: null, error: "GitHub did not answer." });
  await expect(page.locator("#rail-version")).toHaveText(
    /Update check failed: GitHub did not answer\.\s*ThatApp 2026\.47\.1/,
  );
  await footInsideRail(page);
});

test("a 500 leaves the foot empty and throws nothing", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await open(page, 500);
  await expect(page.locator("#rail-version")).toBeAttached();
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#rail-version")).toHaveText("");
  expect(errors).toEqual([]);
});
