import { expect, test, type Page } from "@playwright/test";

type VersionStatus = {
  version: string;
  latest: { version: string; url: string } | null;
  error: string;
};

const URL = "https://github.com/dgerrese/ThatApp/releases/tag/v2026.49.1";

async function open(page: Page, version: VersionStatus | number): Promise<void> {
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
  await page.locator("aside").evaluate((el) => el.scrollTo(0, el.scrollHeight));
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
  await expect(page.locator("#rail-version [data-version]")).toHaveText("ThatApp 2026.47.1");
  await expect(page.locator("#rail-version [data-version] a")).toHaveCount(0);
  await footInsideRail(page);
});

test("update: the newest release links out above the version", async ({ page }) => {
  await open(page, { version: "2026.47.1", latest: { version: "2026.49.1", url: URL }, error: "" });
  const link = page.locator("#rail-version [data-version] a");
  await expect(link).toHaveText("2026.49.1 available (opens in a new tab)");
  await expect(link.locator(".sr-only")).toHaveText("(opens in a new tab)");
  await expect(link).toHaveAttribute("href", URL);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(page.locator("#rail-version [data-version]")).toHaveText(
    /2026\.49\.1 available[^T]*ThatApp 2026\.47\.1/,
  );
  await footInsideRail(page);
});

test("failed: the label and the reason", async ({ page }) => {
  await open(page, { version: "2026.47.1", latest: null, error: "GitHub did not answer." });
  await expect(page.locator("#rail-version [data-version]")).toHaveText(
    /Update check failed: GitHub did not answer\.\s*ThatApp 2026\.47\.1/,
  );
  await footInsideRail(page);
});

test("a 500 leaves the version box out and throws nothing", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await open(page, 500);
  await expect(page.locator("#rail-version")).toBeAttached();
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#rail-version [data-version]")).toHaveCount(0);
  await expect(page.locator("[data-moved]")).toBeVisible();
  expect(errors).toEqual([]);
});

const MOVED_LINK = "https://github.com/dgerrese/ThatApp#moving-from-codeberg";
const FAILED_STATUS: VersionStatus = { version: "2026.47.1", latest: null, error: "GitHub did not answer." };

for (const path of ["/today", "/week"]) {
  test(`moved: the notice shows on ${path}`, async ({ page }) => {
    await open(page, FAILED_STATUS);
    await page.goto(path);
    const moved = page.locator("[data-moved]");
    await expect(moved).toContainText("ThatApp moved to GitHub");
    await expect(moved).toContainText("Change your image to");
    await expect(moved).toContainText("ghcr.io/dgerrese/thatapp:stable");
    const link = moved.locator("a");
    await expect(link).toContainText("How to switch");
    await expect(link).toHaveAttribute("href", MOVED_LINK);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener");
    await expect(link.locator(".sr-only")).toHaveText("(opens in a new tab)");
  });
}

test("moved: first in the foot, and the whole foot reachable in a short window", async ({ page }) => {
  await open(page, FAILED_STATUS);
  await page.setViewportSize({ width: 1280, height: 480 });
  await expect(page.locator("#rail-version [data-version]")).toBeVisible();
  expect(await page.locator("#rail-version > *").first().getAttribute("data-moved")).toBe("");
  await footInsideRail(page);
});

test("moved: the image name wraps only after the slash", async ({ page }) => {
  await open(page, FAILED_STATUS);
  const lines = await page.locator("[data-moved] code").evaluate((el) => {
    const out: string[] = [];
    let lastTop = Number.NaN;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const text = n.textContent ?? "";
      for (let i = 0; i < text.length; i++) {
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + 1);
        const top = Math.round(r.getBoundingClientRect().top);
        if (top !== lastTop) out.push("");
        lastTop = top;
        out[out.length - 1] += text.charAt(i);
      }
    }
    return out;
  });
  expect(lines).toEqual(["ghcr.io/dgerrese/", "thatapp:stable"]);
});
