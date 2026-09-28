import { expect, test, type Page } from "@playwright/test";

/**
 * #143's keyboard audit found two places where a repaint that follows a
 * keyboard action drops focus to <body> instead of keeping it on something
 * the next Tab or Enter can reach: Settings' Remove (the row holding the
 * pressed button is deleted from the list) and Today's pin/unpin controls
 * (pinning or unpinning moves the ticket's row between the Pinned table, an
 * instance card and the off-list table, all three rebuilt from scratch —
 * see today.ts's renderPinnedList/renderResponse/renderOffListSection).
 * Both are fixed here; see today.ts's focusedPinTicket/restorePinFocus and
 * settings-dialog.ts's refocusAfterRemoval.
 */

async function stubIssues(page: Page, groups: unknown[]): Promise<void> {
  await page.route("**/api/issues", async (route) => {
    await route.fulfill({ status: 200, json: { instances: groups } });
  });
}

async function stubEntries(page: Page): Promise<void> {
  await page.route("**/api/entries**", async (route) => {
    await route.fulfill({ status: 200, json: { today: "2026-09-25", entries: [] } });
  });
}

async function stubSearchEmpty(page: Page): Promise<void> {
  await page.route("**/api/issues/search**", async (route) => {
    await route.fulfill({ status: 200, json: { results: [], errors: [] } });
  });
}

async function openSettingsOverToday(page: Page): Promise<void> {
  await page.route("**/api/issues", (route) =>
    route.fulfill({ status: 200, json: { instances: [] } }),
  );
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
  await page.goto("/today");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
}

async function stubTimerIdle(page: Page): Promise<void> {
  await page.route("**/api/timer", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ status: 200, json: { running: null, stopped: null } });
  });
}

const RIDGE_1 = {
  key: "RIDGE-1",
  summary: "Ridge summary",
  status: "In Progress",
  url: "https://example.atlassian.net/browse/RIDGE-1",
};

test.describe("Settings: Remove does not drop focus to <body> (#143)", () => {
  test("removing one of two instances refocuses the next row's own control", async ({ page }) => {
    let instances = [
      {
        id: 1,
        name: "Ridgeline",
        siteUrl: "https://example.atlassian.net",
        apiBaseUrl: "https://api.atlassian.com/ex/jira/abc",
        email: "dion@this.nl",
        createdAt: "2026-09-01T09:00:00Z",
      },
      {
        id: 2,
        name: "Northwind",
        siteUrl: "https://northwind.atlassian.net",
        apiBaseUrl: "https://api.atlassian.com/ex/jira/def",
        email: "dion@this.nl",
        createdAt: "2026-09-02T09:00:00Z",
      },
    ];
    await page.route("**/api/instances", async (route) => {
      await route.fulfill({ status: 200, json: instances });
    });
    await page.route("**/api/instances/1", async (route) => {
      if (route.request().method() === "DELETE") {
        instances = instances.filter((instance) => instance.id !== 1);
        await route.fulfill({ status: 204 });
        return;
      }
      await route.fallback();
    });
    await stubTimerIdle(page);

    await openSettingsOverToday(page);
    await expect(page.getByText("Ridgeline", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Remove Ridgeline" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Remove instance" }).focus();
    await page.keyboard.press("Enter");

    await expect(page.getByText("Northwind", { exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toBeFocused();
    await expect(page.getByRole("button", { name: "Test Northwind", exact: true })).toBeFocused();
  });

  test("removing the last instance refocuses the add-instance form", async ({ page }) => {
    let instances = [
      {
        id: 1,
        name: "Ridgeline",
        siteUrl: "https://example.atlassian.net",
        apiBaseUrl: "https://api.atlassian.com/ex/jira/abc",
        email: "dion@this.nl",
        createdAt: "2026-09-01T09:00:00Z",
      },
    ];
    await page.route("**/api/instances", async (route) => {
      await route.fulfill({ status: 200, json: instances });
    });
    await page.route("**/api/instances/1", async (route) => {
      if (route.request().method() === "DELETE") {
        instances = [];
        await route.fulfill({ status: 204 });
        return;
      }
      await route.fallback();
    });
    await stubTimerIdle(page);

    await openSettingsOverToday(page);
    await expect(page.getByText("Ridgeline", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Remove Ridgeline" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Remove instance" }).focus();
    await page.keyboard.press("Enter");

    await expect(page.getByText("No instances yet. Add one below.")).toBeVisible();
    await expect(page.locator("body")).not.toBeFocused();
    await expect(page.getByRole("heading", { name: "Add an instance" })).toBeVisible();
    await expect(page.getByLabel("Name", { exact: true })).toBeFocused();
  });
});

test.describe("Today: pin/unpin does not drop focus to <body> (#143)", () => {
  test("unpinning a pinned ticket keeps focus off <body>", async ({ page }) => {
    // RIDGE-9 is both pinned and assigned, so unpinning it does not make it
    // vanish from the page — it reappears in the Ridgeline card below, which
    // is the row this test expects focus to land back on.
    await stubIssues(page, [
      { id: 1, name: "Ridgeline", issues: [{ ...RIDGE_1, key: "RIDGE-9" }], error: null },
    ]);
    let pinned = [
      {
        id: 9,
        instanceId: 1,
        instanceName: "Ridgeline",
        instancePosition: 0,
        key: "RIDGE-9",
        summary: "A pinned ticket",
        status: "To Do",
        url: "https://example.atlassian.net/browse/RIDGE-9",
        error: null,
      },
    ];
    await page.route("**/api/pins**", async (route) => {
      if (route.request().method() === "DELETE") {
        pinned = [];
        await route.fulfill({ status: 204 });
        return;
      }
      await route.fulfill({ status: 200, json: pinned });
    });
    await stubEntries(page);
    await stubSearchEmpty(page);
    await stubTimerIdle(page);

    await page.goto("/today");
    await expect(page.getByText("RIDGE-9")).toBeVisible();

    await page.getByRole("button", { name: "Unpin RIDGE-9" }).focus();
    await page.keyboard.press("Enter");

    await expect(page.locator("body")).not.toBeFocused();
    await expect(page.getByRole("button", { name: "Pin RIDGE-9" })).toBeFocused();
  });

  test("pinning an off-list ticket keeps focus off <body>", async ({ page }) => {
    await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
    let pinned: unknown[] = [];
    await page.route("**/api/pins**", async (route) => {
      if (route.request().method() === "POST") {
        pinned = [
          {
            id: 9,
            instanceId: 1,
            instanceName: "Ridgeline",
            instancePosition: 0,
            key: "OFF-1",
            summary: "Off-list ticket",
            status: "To Do",
            url: "",
            error: null,
          },
        ];
        await route.fulfill({ status: 201, json: pinned[0] });
        return;
      }
      await route.fulfill({ status: 200, json: pinned });
    });
    await page.route("**/api/entries**", async (route) => {
      await route.fulfill({
        status: 200,
        json: {
          today: "2026-09-25",
          entries: [
            {
              id: 1,
              instanceId: 1,
              instanceName: "Ridgeline",
              instancePosition: 0,
              issueKey: "OFF-1",
              day: "2026-09-25",
              startedAt: "2026-09-25T09:00:00+02:00",
              seconds: 900,
              comment: "",
              pushState: "unpushed",
            },
          ],
        },
      });
    });
    await page.route("**/api/issues/search?q=OFF-1**", async (route) => {
      await route.fulfill({ status: 200, json: { results: [], errors: [] } });
    });
    await stubSearchEmpty(page);
    await stubTimerIdle(page);

    await page.goto("/today");
    await expect(page.getByText("OFF-1")).toBeVisible();

    await page.getByRole("button", { name: "Pin OFF-1" }).focus();
    await page.keyboard.press("Enter");

    await expect(page.locator("body")).not.toBeFocused();
    await expect(page.getByRole("button", { name: "Unpin OFF-1" })).toBeFocused();
  });
});

test.describe("Entry dialog: deleting an entry does not drop focus out of the dialog (#143)", () => {
  test("deleting the only entry keeps focus inside the still-open dialog", async ({ page }) => {
    await page.route("**/api/issues", async (route) => {
      await route.fulfill({
        status: 200,
        json: { instances: [{ id: 1, name: "Ridgeline", issues: [RIDGE_1], error: null }] },
      });
    });
    await page.route("**/api/pins**", async (route) => {
      await route.fulfill({ status: 200, json: [] });
    });
    await stubSearchEmpty(page);
    await stubTimerIdle(page);
    let entries = [
      {
        id: 1,
        instanceId: 1,
        instanceName: "Ridgeline",
        instancePosition: 0,
        issueKey: "RIDGE-1",
        day: "2026-09-25",
        startedAt: "2026-09-25T09:00:00+02:00",
        seconds: 1800,
        comment: "",
        pushState: "unpushed",
      },
    ];
    await page.route("**/api/entries**", async (route) => {
      const url = new URL(route.request().url());
      const id = Number(/\/api\/entries\/(\d+)/.exec(url.pathname)?.[1] ?? 0);
      if (route.request().method() === "DELETE") {
        entries = entries.filter((entry) => entry.id !== id);
        await route.fulfill({ status: 204 });
        return;
      }
      await route.fulfill({ status: 200, json: { today: "2026-09-25", entries } });
    });

    await page.goto("/today");
    await page.getByRole("button", { name: /Log time against RIDGE-1/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("dialog[open]")).toBeVisible();

    await page.getByRole("button", { name: /Delete the .* entry/ }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Delete", exact: true }).focus();
    await page.keyboard.press("Enter");

    await expect(page.locator("dialog[open]")).toBeVisible();
    await expect(page.getByRole("button", { name: "Close" })).toBeFocused();
  });
});
