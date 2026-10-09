import { expect, test, type Page } from "@playwright/test";

/**
 * #305: once an issues read fails, its error alert is the only report of the failure. No redraw
 * from the last good response may put the old cards back over it — not the pins answer landing
 * after it, not a pin or unpin, succeeding or failing — until an issues read succeeds.
 */

interface StubPin {
  id: number;
  instanceId: number;
  instanceName: string;
  instancePosition: number;
  key: string;
  summary: string;
  status: string;
  url: string;
  error: null;
}

const failure = { code: "store_failed", message: "could not read the stored instances" };
const pinFailure = { code: "jira_error", message: "Jira did not take the pin." };

function pinFor(id: number, key: string): StubPin {
  return {
    id,
    instanceId: 1,
    instanceName: "Work",
    instancePosition: 0,
    key,
    summary: `Summary of ${key}`,
    status: "To Do",
    url: `https://jira.example/browse/${key}`,
    error: null,
  };
}

const sharedPin = pinFor(40, "SHARED-40");
const otherPin = pinFor(41, "OTHER-1");

function entry(id: number, issueKey: string): Record<string, unknown> {
  return {
    id,
    instanceId: 1,
    instanceName: "Work",
    instancePosition: 0,
    issueKey,
    day: "2026-08-31",
    startedAt: "2026-08-31T09:00:00+02:00",
    seconds: 1800,
    comment: "",
    pushState: "unpushed",
  };
}

function hold(): { held: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { held, release };
}

const alert = (page: Page) => page.locator("#view that-alert", { hasText: failure.message });
const workCard = (page: Page) => page.getByRole("region", { name: "Work", exact: true });
const pinned = (page: Page) => page.getByRole("region", { name: "Pinned" });
const offList = (page: Page) => page.locator('section[aria-labelledby="today-offlist"]');

// Time logged today against WORK-1, which is assigned, and SHARED-40, which is not — so
// SHARED-40 sits in the off-list section while unpinned, and WORK-1 only ever would if the
// off-list section were judged against no issues response at all.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/entries**", (route) =>
    route.fulfill({
      status: 200,
      json: { today: "2026-08-31", entries: [entry(1, "WORK-1"), entry(2, "SHARED-40")] },
    }),
  );
  await page.route("**/api/issues/search**", (route) =>
    route.fulfill({
      status: 200,
      json: {
        results: [
          {
            instanceId: 1,
            instanceName: "Work",
            instancePosition: 0,
            key: "SHARED-40",
            summary: "Vendor security review",
            status: "To Do",
            url: "https://jira.example/browse/SHARED-40",
          },
        ],
        errors: [],
      },
    }),
  );
});

/** The first /api/issues call answers the Work card; every later one fails once `held` settles. */
async function stubIssues(page: Page, held: Promise<void> = Promise.resolve()): Promise<void> {
  let calls = 0;
  await page.route("**/api/issues", async (route) => {
    calls += 1;
    if (calls === 1) {
      await route.fulfill({
        status: 200,
        json: {
          instances: [
            {
              id: 1,
              name: "Work",
              issues: [
                {
                  key: "WORK-1",
                  summary: "Fix the export",
                  status: "To Do",
                  url: "https://jira.example/browse/WORK-1",
                },
              ],
              error: null,
            },
          ],
        },
      });
      return;
    }
    await held;
    await route.fulfill({ status: 500, json: failure });
  });
}

/** A pin store answering GET, POST and DELETE the way the server does. Returns its live array. */
async function stubPinStore(page: Page, initial: StubPin[]): Promise<StubPin[]> {
  const pins = [...initial];
  await page.route("**/api/pins**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = request.postDataJSON() as { issueKey: string };
      const created = pinFor(600 + pins.length, body.issueKey);
      pins.push(created);
      await route.fulfill({ status: 201, json: created });
      return;
    }
    if (request.method() === "DELETE") {
      const id = Number(new URL(request.url()).pathname.split("/").pop());
      const index = pins.findIndex((pin) => pin.id === id);
      if (index >= 0) pins.splice(index, 1);
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ status: 200, json: pins });
  });

  return pins;
}

async function openToday(page: Page, pinnedReady: string): Promise<void> {
  await page.goto("/today");
  await expect(workCard(page)).toBeVisible(); // wait
  await expect(pinned(page).getByText(pinnedReady, { exact: true })).toBeVisible(); // wait
}

/**
 * Refresh, with its pins answer landing (it adds OTHER-1) before the issues read fails — the
 * order that never wiped the alert. The pin tests start here, so nothing has wiped it before they
 * act.
 */
async function refreshFailingAfterPins(page: Page, store: StubPin[], releaseIssues: () => void): Promise<void> {
  store.push(otherPin);
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(pinned(page).getByText("OTHER-1", { exact: true })).toBeVisible(); // wait
  releaseIssues();
  await expect(alert(page)).toBeVisible(); // wait
}

const triggers: [string, (page: Page) => Promise<void>][] = [
  ["Refresh", (page) => page.getByRole("button", { name: "Refresh" }).click()],
  [
    "the network returning",
    (page) => page.evaluate(() => window.dispatchEvent(new Event("online"))),
  ],
];

for (const [name, trigger] of triggers) {
  test(`${name} whose issues read fails keeps its alert when the pins answer lands after it`, async ({
    page,
  }) => {
    await stubIssues(page);
    const store = await stubPinStore(page, []);
    const pinsRefresh = hold();
    await page.route("**/api/pins**", async (route) => {
      if (new URL(route.request().url()).searchParams.get("refresh") === "1") await pinsRefresh.held;
      await route.fallback();
    });
    await openToday(page, "Nothing pinned.");
    await expect(offList(page).getByText("SHARED-40", { exact: true })).toBeVisible(); // wait

    // The refreshed pins hold SHARED-40, so their arrival shows in Pinned and empties off-list.
    store.push(sharedPin);
    await trigger(page);
    await expect(alert(page)).toBeVisible(); // wait
    pinsRefresh.release();
    await expect(pinned(page).getByText("SHARED-40", { exact: true })).toBeVisible(); // wait

    await expect.soft(alert(page)).toBeVisible();
    await expect.soft(workCard(page)).toHaveCount(0);
    await expect.soft(offList(page)).toHaveCount(0);
  });
}

test("the pins answering first, then the issues read failing, ends on the alert", async ({ page }) => {
  const issues = hold();
  await stubIssues(page, issues.held);
  const store = await stubPinStore(page, []);
  await openToday(page, "Nothing pinned.");

  await refreshFailingAfterPins(page, store, issues.release);

  await expect.soft(alert(page)).toBeVisible();
  await expect.soft(workCard(page)).toHaveCount(0);
});

test("a pin that succeeds while the alert stands keeps it", async ({ page }) => {
  const issues = hold();
  await stubIssues(page, issues.held);
  const store = await stubPinStore(page, []);
  await openToday(page, "Nothing pinned.");
  await refreshFailingAfterPins(page, store, issues.release);

  await offList(page).getByRole("button", { name: "Pin SHARED-40", exact: true }).click();
  await expect(pinned(page).getByText("SHARED-40", { exact: true })).toBeVisible(); // wait

  await expect.soft(alert(page)).toBeVisible();
  await expect.soft(workCard(page)).toHaveCount(0);
  await expect.soft(offList(page)).toHaveCount(0);
});

test("an unpin that succeeds while the alert stands keeps it", async ({ page }) => {
  const issues = hold();
  await stubIssues(page, issues.held);
  const store = await stubPinStore(page, [sharedPin]);
  await openToday(page, "SHARED-40");
  await refreshFailingAfterPins(page, store, issues.release);

  await pinned(page).getByRole("button", { name: "Unpin SHARED-40", exact: true }).click();
  await expect(pinned(page).getByText("SHARED-40", { exact: true })).toHaveCount(0); // wait

  await expect.soft(alert(page)).toBeVisible();
  await expect.soft(workCard(page)).toHaveCount(0);
  await expect.soft(offList(page).getByText("SHARED-40", { exact: true })).toBeVisible();
  await expect.soft(offList(page).getByText("WORK-1", { exact: true })).toHaveCount(0);
});

test("a pin that fails while the alert stands keeps it, undoes the mark and still toasts", async ({
  page,
}) => {
  const issues = hold();
  await stubIssues(page, issues.held);
  const store = await stubPinStore(page, []);
  await page.route("**/api/pins**", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 502, json: pinFailure });
      return;
    }
    await route.fallback();
  });
  await openToday(page, "Nothing pinned.");
  await refreshFailingAfterPins(page, store, issues.release);

  await offList(page).getByRole("button", { name: "Pin SHARED-40", exact: true }).click();
  // The toast is raised after the redraw, so it is also the point the redraw is done.
  await expect(page.locator("that-toasts that-toast[tone='error']")).toContainText(pinFailure.message);

  await expect.soft(alert(page)).toBeVisible();
  await expect.soft(workCard(page)).toHaveCount(0);
  await expect
    .soft(offList(page).getByRole("button", { name: "Pin SHARED-40", exact: true }))
    .toBeVisible();
});
