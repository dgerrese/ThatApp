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
