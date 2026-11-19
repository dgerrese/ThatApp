import { expect, test, type Page } from "@playwright/test";

/**
 * One scrim token (CB#97) dims every native <dialog> behind it: 25% black on
 * light, 60% on dark. Colour strings are normalised rather than compared to a
 * browser's exact serialisation — both target engines currently render an
 * authored oklch() token back as oklch(), but a computed colour can just as
 * legitimately come back as rgb()/rgba() or color(), and this only cares that
 * the colour is black at the right alpha.
 */
const LIGHT_ALPHA = 0.25;
const DARK_ALPHA = 0.6;

function isBlackAt(value: string, alpha: number): boolean {
  const oklch = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+[\d.]+\s*(?:\/\s*([\d.]+))?\s*\)$/.exec(value);
  if (oklch) {
    const [, l, c, a] = oklch;
    return Number(l) === 0 && Number(c) === 0 && Math.abs((a === undefined ? 1 : Number(a)) - alpha) < 0.01;
  }

  const rgb = /^rgba?\(\s*([\d.]+),?\s*([\d.]+),?\s*([\d.]+)\s*(?:[,/]\s*([\d.]+))?\s*\)$/.exec(value);
  if (rgb) {
    const [, r, g, b, a] = rgb;
    return (
      Number(r) === 0 &&
      Number(g) === 0 &&
      Number(b) === 0 &&
      Math.abs((a === undefined ? 1 : Number(a)) - alpha) < 0.01
    );
  }

  const color = /^color\(\s*[\w-]+\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)$/.exec(value);
  if (color) {
    const [, r, g, b, a] = color;
    return (
      Number(r) === 0 &&
      Number(g) === 0 &&
      Number(b) === 0 &&
      Math.abs((a === undefined ? 1 : Number(a)) - alpha) < 0.01
    );
  }

  return false;
}

function backdropColor(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`no element matched ${sel}`);
    return getComputedStyle(el, "::backdrop").backgroundColor;
  }, selector);
}

function ownBackground(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`no element matched ${sel}`);
    return getComputedStyle(el).backgroundColor;
  }, selector);
}

async function stubShell(page: Page): Promise<void> {
  await page.route("**/api/issues", (route) => route.fulfill({ status: 200, json: { instances: [] } }));
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
}

async function openConfirm(page: Page, scheme: "light" | "dark"): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  await stubShell(page);
  await page.route("**/api/instances", (route) =>
    route.fulfill({
      status: 200,
      json: [
        {
          id: 1,
          name: "Work",
          siteUrl: "https://work.atlassian.net",
          apiBaseUrl: "https://api.atlassian.com/ex/jira/abc",
          email: "dion@this.nl",
          createdAt: "2026-09-01T00:00:00Z",
        },
      ],
    }),
  );
  await page.goto("/today");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("dialog", { name: /^Remove / })).toBeVisible();
}

async function openEntryDialog(page: Page, scheme: "light" | "dark"): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  await stubShell(page);
  await page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 200, json: { today: "2026-08-22", entries: [] } }),
  );
  await page.goto("/today");
  await page.evaluate(async () => {
    await customElements.whenDefined("that-entry-dialog");
    const element = document.createElement("that-entry-dialog") as unknown as { ticket: unknown };
    element.ticket = {
      instanceId: 1,
      instanceName: "Work",
      issueKey: "WORK-1",
      summary: "Fix the export",
      status: "In Progress",
      day: "2026-08-22",
    };
    document.body.append(element);
  });
  await expect(page.locator("that-entry-dialog dialog")).toBeVisible();
}

async function openStopDialog(page: Page, scheme: "light" | "dark"): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  await stubShell(page);
  await page.route("**/api/timer", (route) =>
    route.fulfill({ status: 200, json: { running: null, stopped: null } }),
  );
  await page.route("**/api/timer/start", (route) =>
    route.fulfill({
      status: 200,
      json: {
        running: { instanceId: 1, issueKey: "WORK-1", startedAt: new Date().toISOString() },
        stopped: null,
        discarded: false,
      },
    }),
  );
  await page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 200, json: { today: "2026-09-21", entries: [] } }),
  );
  await page.route("**/api/issues", (route) =>
    route.fulfill({
      status: 200,
      json: { instances: [{ id: 1, name: "Work", issues: [{ key: "WORK-1", summary: "Fix the export", status: "In Progress", url: "" }], error: null }] },
    }),
  );
  await page.goto("/today");
  const row = page.locator("that-ticket-row", { hasText: "WORK-1" });
  await row.getByRole("button", { name: "start timer" }).click();
  await expect(row.getByRole("button", { name: "stop timer" })).toBeVisible();
  await row.getByRole("button", { name: "stop timer" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function openSettingsSheet(page: Page, scheme: "light" | "dark"): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  await stubShell(page);
  await page.route("**/api/instances", (route) => route.fulfill({ status: 200, json: [] }));
  await page.goto("/today");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
}

for (const [theme, alpha] of [
  ["light", LIGHT_ALPHA],
  ["dark", DARK_ALPHA],
] as const) {
  test(`that-confirm's backdrop is the scrim in ${theme}`, async ({ page }) => {
    await openConfirm(page, theme);

    const color = await backdropColor(page, "that-confirm dialog");
    expect(isBlackAt(color, alpha), `${color} is not black at ${alpha}`).toBe(true);
  });

  test(`the entries dialog's backdrop is the scrim in ${theme}`, async ({ page }) => {
    await openEntryDialog(page, theme);

    const color = await backdropColor(page, "that-entry-dialog dialog");
    expect(isBlackAt(color, alpha), `${color} is not black at ${alpha}`).toBe(true);
  });

  test(`the stop dialog's backdrop is the scrim in ${theme}`, async ({ page }) => {
    await openStopDialog(page, theme);

    const color = await backdropColor(page, "that-stop-dialog dialog");
    expect(isBlackAt(color, alpha), `${color} is not black at ${alpha}`).toBe(true);
  });

  test(`Settings paints its own background as the scrim, its backdrop transparent, in ${theme}`, async ({
    page,
  }) => {
    await openSettingsSheet(page, theme);

    const own = await ownBackground(page, "[aria-labelledby='that-settings-heading']");
    expect(isBlackAt(own, alpha), `${own} is not black at ${alpha}`).toBe(true);

    const backdrop = await backdropColor(page, "[aria-labelledby='that-settings-heading']");
    expect(isBlackAt(backdrop, 0), `${backdrop} is not transparent`).toBe(true);
  });
}
