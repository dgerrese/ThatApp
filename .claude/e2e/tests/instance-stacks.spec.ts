import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * #144: from the 80rem container breakpoint Today's instance cards go into two stacks, each card
 * to the shorter stack in instance order (a tie to the left), and keep their stack on every
 * redraw except Today opening and Refresh. Every row here is one line high, so a card's height
 * follows its row count, and two one-row cards tie exactly.
 */

interface StubIssue {
  key: string;
  summary: string;
  status: string;
  url: string;
}

interface StubGroup {
  id: number;
  name: string;
  issues: StubIssue[];
  error: null;
}

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

// 1920 leaves the content column well past 80rem beside the rail; 1100 leaves it well short.
const WIDE = { width: 1920, height: 900 };
const NARROW = { width: 1100, height: 900 };
const NAMES = ["Alpha", "Bravo", "Charlie", "Delta"];

function issue(key: string): StubIssue {
  return { key, summary: `Summary of ${key}`, status: "To Do", url: `https://jira.example/browse/${key}` };
}

function nameAt(position: number): string {
  return NAMES[position] ?? `Instance ${position}`;
}

/** One group per argument, in instance order: Alpha holds ALPHA-1…ALPHA-n, Bravo BRAVO-1…, and so on. */
function instances(...rowCounts: number[]): StubGroup[] {
  return rowCounts.map((rows, position) => {
    const name = nameAt(position);

    return {
      id: position + 1,
      name,
      issues: Array.from({ length: rows }, (_, index) => issue(`${name.toUpperCase()}-${index + 1}`)),
      error: null,
    };
  });
}

function pinFor(id: number, position: number, key: string): StubPin {
  return {
    id,
    instanceId: position + 1,
    instanceName: nameAt(position),
    instancePosition: position,
    key,
    summary: `Summary of ${key}`,
    status: "To Do",
    url: `https://jira.example/browse/${key}`,
    error: null,
  };
}

/** Each call to /api/issues takes the next response; the last one repeats. */
async function stubIssues(page: Page, ...responses: StubGroup[][]): Promise<void> {
  let calls = 0;

  await page.route("**/api/issues", async (route) => {
    const groups = responses[Math.min(calls, responses.length - 1)];
    calls += 1;
    await route.fulfill({ status: 200, json: { instances: groups } });
  });
}

/** A pin store answering GET, POST and DELETE the way the server does. */
async function stubPinStore(page: Page, initial: StubPin[]): Promise<void> {
  const pins = [...initial];

  await page.route("**/api/pins**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = request.postDataJSON() as { instanceId: number; issueKey: string };
      const created = pinFor(600 + pins.length, body.instanceId - 1, body.issueKey);
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
}

// Pins and entries answered empty unless a test says otherwise: the e2e stack shares the dev
// database, and a stray pin or entry would change the card heights these tests compare.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
  await page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 200, json: { today: "2026-09-09", entries: [] } }),
  );
});

const card = (page: Page, name: string): Locator => page.getByRole("region", { name, exact: true });
const rowsOf = (page: Page, name: string): Locator => card(page, name).locator("that-ticket-row");

async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("not laid out");

  return box;
}

/** Which stack a card sits in: the half of the Assigned issues section holding its left edge. */
async function stackOf(page: Page, name: string): Promise<"left" | "right"> {
  const section = await boxOf(page.getByRole("region", { name: "Assigned issues" }));
  const box = await boxOf(card(page, name));

  return box.x < section.x + section.width / 2 ? "left" : "right";
}

async function isBelow(page: Page, upper: string, lower: string): Promise<boolean> {
  const top = await boxOf(card(page, upper));
  const bottom = await boxOf(card(page, lower));

  return bottom.y >= top.y + top.height;
}

/** The instance headings in document order — the order Tab, the arrow keys and a screen reader take. */
function headingOrder(page: Page): Promise<string[]> {
  return page.locator("section[aria-labelledby^='today-instance-'] h3").allTextContents();
}

async function openToday(page: Page, viewport: { width: number; height: number }, ...names: string[]): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto("/today");
  for (const name of names) await expect(card(page, name)).toBeVisible();
}

test("the reported case: an empty card sits under the short card, not under the tall one", async ({ page }) => {
  await stubIssues(page, instances(8, 3, 0));
  await openToday(page, WIDE, "Alpha", "Bravo", "Charlie");

  expect.soft(await stackOf(page, "Alpha")).toBe("left");
  expect.soft(await stackOf(page, "Bravo")).toBe("right");
  expect.soft(await stackOf(page, "Charlie")).toBe("right");
  expect.soft(await isBelow(page, "Bravo", "Charlie")).toBe(true);
});

test("document order follows the stacks: the left stack top to bottom, then the right", async ({ page }) => {
  await stubIssues(page, instances(1, 3, 1));
  await openToday(page, WIDE, "Alpha", "Bravo", "Charlie");

  expect.soft(await stackOf(page, "Charlie")).toBe("left");
  expect.soft(await headingOrder(page)).toEqual(["Alpha", "Charlie", "Bravo"]);

  // Down from Alpha's only row lands in Charlie's, the card under it, not Bravo's beside it.
  await page.getByRole("link", { name: "ALPHA-1", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("link", { name: "CHARLIE-1", exact: true })).toBeFocused();
});

test("below the breakpoint the cards are one column in instance order", async ({ page }) => {
  await stubIssues(page, instances(1, 3, 1));
  await openToday(page, NARROW, "Alpha", "Bravo", "Charlie");

  expect.soft(await headingOrder(page)).toEqual(["Alpha", "Bravo", "Charlie"]);
  expect.soft(await isBelow(page, "Alpha", "Bravo")).toBe(true);
  expect.soft(await isBelow(page, "Bravo", "Charlie")).toBe(true);
  expect.soft(await stackOf(page, "Bravo")).toBe("left");
});

test("cards in both stacks share one key column", async ({ page }) => {
  await stubIssues(page, [
    { id: 1, name: "Alpha", issues: [issue("A-1")], error: null },
    { id: 2, name: "Bravo", issues: [issue("PLATFORM-4821")], error: null },
  ]);
  await openToday(page, WIDE, "Alpha", "Bravo");

  expect.soft(await stackOf(page, "Bravo")).toBe("right");

  const offsets = await page
    .locator("section[aria-labelledby^='today-instance-'] that-table")
    .evaluateAll((tables) =>
      tables.map((table) => {
        const summary = table.querySelector("tbody td.c-sum");
        if (!(summary instanceof HTMLElement)) return null;

        return Math.round(summary.getBoundingClientRect().left - table.getBoundingClientRect().left);
      }),
    );
  expect.soft(new Set(offsets).size).toBe(1);
});

test("crossing the breakpoint switches between one column and two stacks without a reload", async ({ page }) => {
  await stubIssues(page, instances(1, 3, 1));
  await openToday(page, WIDE, "Alpha", "Bravo", "Charlie");
  await page.evaluate(() => Object.assign(window, { stacksE2eMarker: true }));

  await page.setViewportSize(NARROW);
  await expect.poll(() => headingOrder(page)).toEqual(["Alpha", "Bravo", "Charlie"]);

  await page.setViewportSize(WIDE);
  await expect.poll(() => headingOrder(page)).toEqual(["Alpha", "Charlie", "Bravo"]);
  expect.soft(await page.evaluate(() => "stacksE2eMarker" in window)).toBe(true);
});

test("opened below the breakpoint, the cards are placed shortest first when they first get two stacks", async ({
  page,
}) => {
  await stubIssues(page, instances(3, 1, 1));
  await openToday(page, NARROW, "Alpha", "Bravo", "Charlie");

  await page.setViewportSize(WIDE);
  await expect.poll(() => stackOf(page, "Bravo")).toBe("right");
  expect.soft(await stackOf(page, "Charlie")).toBe("right");
  expect.soft(await isBelow(page, "Bravo", "Charlie")).toBe(true);
});

test("a redraw at one column does not restack the cards when they widen again", async ({ page }) => {
  await stubIssues(page, instances(2, 1, 1), instances(1, 1, 1));
  await openToday(page, WIDE, "Alpha", "Bravo", "Charlie");

  await page.setViewportSize(NARROW);
  await expect.poll(() => stackOf(page, "Bravo")).toBe("left"); // wait
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(rowsOf(page, "Alpha")).toHaveCount(1); // wait

  // Placed afresh, three one-row cards would tie and send Charlie left.
  await page.setViewportSize(WIDE);
  await expect.poll(() => stackOf(page, "Bravo")).toBe("right"); // wait
  expect(await stackOf(page, "Charlie")).toBe("right");
});

test("a focused row keeps its focus when the cards switch between one column and two stacks", async ({ page }) => {
  await stubIssues(page, instances(1, 3, 1));
  await openToday(page, WIDE, "Alpha", "Bravo", "Charlie");
  const link = page.getByRole("link", { name: "BRAVO-2", exact: true });
  await link.focus();

  await page.setViewportSize(NARROW);
  await expect.poll(() => headingOrder(page)).toEqual(["Alpha", "Bravo", "Charlie"]); // wait
  await expect(link).toBeFocused();
});

test("the pins arriving after the issues move no card", async ({ page }) => {
  let releasePins: (() => void) | undefined;
  const pinsHeld = new Promise<void>((resolve) => {
    releasePins = resolve;
  });
  await page.route("**/api/pins**", async (route) => {
    await pinsHeld;
    await route.fulfill({ status: 200, json: [pinFor(501, 0, "ALPHA-2")] });
  });
  await stubIssues(page, instances(2, 1, 1));
  await openToday(page, WIDE, "Alpha", "Bravo", "Charlie");
  expect.soft(await stackOf(page, "Charlie")).toBe("right");

  releasePins?.();
  await expect(rowsOf(page, "Alpha")).toHaveCount(1); // wait
  expect.soft(await stackOf(page, "Charlie")).toBe("right");
});

test("pinning a ticket moves no card", async ({ page }) => {
  await stubPinStore(page, []);
  await stubIssues(page, instances(2, 1, 1));
  await openToday(page, WIDE, "Alpha", "Bravo", "Charlie");

  await page.getByRole("button", { name: "Pin ALPHA-2", exact: true }).click();
  await expect(rowsOf(page, "Alpha")).toHaveCount(1); // wait
  expect(await stackOf(page, "Charlie")).toBe("right");
});

test("unpinning a ticket moves no card", async ({ page }) => {
  await stubPinStore(page, [pinFor(501, 0, "ALPHA-2")]);
  // The issues wait for the pins, so the cards are first placed with ALPHA-2 already in Pinned:
  // three one-row cards, Charlie on the left.
  let releaseIssues: (() => void) | undefined;
  const issuesHeld = new Promise<void>((resolve) => {
    releaseIssues = resolve;
  });
  await page.route("**/api/issues", async (route) => {
    await issuesHeld;
    await route.fulfill({ status: 200, json: { instances: instances(2, 1, 1) } });
  });
  await page.setViewportSize(WIDE);
  await page.goto("/today");
  await expect(page.getByRole("region", { name: "Pinned" }).locator("that-ticket-row")).toHaveCount(1); // wait
  releaseIssues?.();
  await expect(card(page, "Charlie")).toBeVisible(); // wait
  expect.soft(await stackOf(page, "Charlie")).toBe("left");

  // Placed afresh, Alpha's two rows would send Charlie right.
  await page.getByRole("button", { name: "Unpin ALPHA-2", exact: true }).click();
  await expect(rowsOf(page, "Alpha")).toHaveCount(2); // wait
  expect.soft(await stackOf(page, "Charlie")).toBe("left");
});

test("coming back to a stale Today moves no card", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/issues", async (route) => {
    calls += 1;
    if (calls === 1) {
      await route.fulfill({
        status: 200,
        headers: { "X-THAT-Cached-At": new Date().toISOString() },
        json: { instances: instances(2, 1, 1) },
      });
      return;
    }
    await route.fulfill({ status: 200, json: { instances: instances(1, 1, 1) } });
  });
  await openToday(page, WIDE, "Alpha", "Bravo", "Charlie");
  await expect(page.getByText("no connection to the server")).toBeVisible(); // wait

  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  await expect(rowsOf(page, "Alpha")).toHaveCount(1); // wait
  expect(await stackOf(page, "Charlie")).toBe("right");
});

test("the network returning moves no card", async ({ page }) => {
  await stubIssues(page, instances(2, 1, 1), instances(1, 1, 1));
  await openToday(page, WIDE, "Alpha", "Bravo", "Charlie");

  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(rowsOf(page, "Alpha")).toHaveCount(1); // wait
  expect(await stackOf(page, "Charlie")).toBe("right");
});

test("an instance that appears on a redraw goes to the shorter stack", async ({ page }) => {
  // Alpha's eight rows outweigh Bravo and Charlie together, so Delta joins them on the right.
  await stubIssues(page, instances(8, 1, 1), instances(8, 1, 1, 1));
  await openToday(page, WIDE, "Alpha", "Bravo", "Charlie");

  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(card(page, "Delta")).toBeVisible(); // wait
  expect.soft(await stackOf(page, "Delta")).toBe("right");
  expect.soft(await isBelow(page, "Charlie", "Delta")).toBe(true);
});

test("an instance that leaves on a redraw moves no other card", async ({ page }) => {
  // Alpha and Charlie on the left, Bravo alone on the right. Placed afresh without Bravo,
  // Charlie would go right.
  await stubIssues(page, instances(1, 3, 1), instances(1, 3, 1).filter((group) => group.name !== "Bravo"));
  await openToday(page, WIDE, "Alpha", "Bravo", "Charlie");

  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(card(page, "Bravo")).toHaveCount(0); // wait
  expect(await stackOf(page, "Charlie")).toBe("left");
});

test("a card left alone in the right stack stays in the right half", async ({ page }) => {
  // Alpha and Charlie on the left, Bravo alone on the right. Both left cards leave on the redraw.
  await stubIssues(page, instances(1, 3, 1), instances(1, 3, 1).filter((group) => group.name === "Bravo"));
  await openToday(page, WIDE, "Alpha", "Bravo", "Charlie");

  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(card(page, "Alpha")).toHaveCount(0); // wait
  expect(await stackOf(page, "Bravo")).toBe("right");
});

test("Refresh places the cards afresh, from the issues it fetched", async ({ page }) => {
  let releaseIssues: (() => void) | undefined;
  const issuesHeld = new Promise<void>((resolve) => {
    releaseIssues = resolve;
  });
  let calls = 0;
  await page.route("**/api/issues", async (route) => {
    calls += 1;
    if (calls > 1) await issuesHeld;
    await route.fulfill({ status: 200, json: { instances: calls > 1 ? instances(1, 1, 1) : instances(2, 1, 1) } });
  });
  // Refresh rereads the pins with ?refresh=1. That answer adds a pin no card holds, so its arrival
  // shows in Pinned and changes no card.
  await page.route("**/api/pins**", async (route) => {
    const refreshed = new URL(route.request().url()).searchParams.get("refresh") === "1";
    await route.fulfill({ status: 200, json: refreshed ? [pinFor(501, 0, "ALPHA-99")] : [] });
  });
  await openToday(page, WIDE, "Alpha", "Bravo", "Charlie");

  await page.getByRole("button", { name: "Refresh" }).click();
  // The pins answer lands first and redraws the cards from the issues already held.
  await expect(page.getByRole("region", { name: "Pinned" }).locator("that-ticket-row")).toHaveCount(1); // wait
  releaseIssues?.();
  await expect(rowsOf(page, "Alpha")).toHaveCount(1); // wait
  expect(await stackOf(page, "Charlie")).toBe("left");
});

test("opening Today again places the cards afresh", async ({ page }) => {
  await stubIssues(page, instances(2, 1, 1), instances(1, 1, 1));
  await openToday(page, WIDE, "Alpha", "Bravo", "Charlie");

  await page.getByRole("link", { name: "Week", exact: true }).click();
  await expect(page).toHaveURL(/\/week$/); // wait
  await page.getByRole("link", { name: "Today", exact: true }).click();
  await expect(rowsOf(page, "Alpha")).toHaveCount(1); // wait
  expect(await stackOf(page, "Charlie")).toBe("left");
});

test("a Refresh that succeeds after a failed one draws the cards and places them afresh", async ({ page }) => {
  let calls = 0;
  let pinsRefreshes = 0;
  let pinsAnsweredSecondRefresh: () => void = () => undefined;
  const pinsSettled = new Promise<void>((resolve) => {
    pinsAnsweredSecondRefresh = resolve;
  });
  await page.route("**/api/pins**", async (route) => {
    const refreshed = new URL(route.request().url()).searchParams.get("refresh") === "1";
    await route.fulfill({ status: 200, json: [] });
    if (refreshed && (pinsRefreshes += 1) === 2) pinsAnsweredSecondRefresh();
  });
  await page.route("**/api/issues", async (route) => {
    calls += 1;
    if (calls === 2) {
      await route.fulfill({ status: 500, json: { code: "store_failed", message: "could not read the stored instances" } });
      return;
    }
    // The pins answer lands first, while the earlier failure still stands.
    if (calls === 3) await pinsSettled;
    await route.fulfill({ status: 200, json: { instances: calls === 1 ? instances(2, 1, 1) : instances(1, 1, 1) } });
  });
  await openToday(page, WIDE, "Alpha", "Bravo", "Charlie");
  const refresh = page.getByRole("button", { name: "Refresh" });

  await refresh.click();
  // Enabled again once both reads settle. Not the alert: before #305 the pins answer could land
  // second and wipe it, which would make this guard flaky on the unfixed code.
  await expect(refresh).toBeEnabled(); // wait
  await refresh.click();

  await expect.soft(rowsOf(page, "Alpha")).toHaveCount(1);
  // Charlie sat right beside Alpha's two rows; placed afresh from one row each, a tie sends it left.
  expect.soft(await stackOf(page, "Charlie")).toBe("left");
});
