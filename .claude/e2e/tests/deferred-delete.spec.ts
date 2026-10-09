import { expect, test, type Page } from "@playwright/test";

/**
 * #280: a delete of an entry Jira holds waits for the push. /api/entries is
 * stubbed with the server's own rules — DELETE marks a pushed or dirty entry
 * and removes an unpushed one, POST …/restore takes the mark back — for the
 * reason entries.spec.ts gives: the e2e stack shares the dev database.
 */
type State = "unpushed" | "pushed" | "dirty" | "deleted";

interface StubEntry {
  id: number;
  instanceId: number;
  instanceName: string;
  instancePosition: number;
  issueKey: string;
  day: string;
  startedAt: string;
  seconds: number;
  comment: string;
  pushState: State;
}

interface Recorder {
  deleted: number[];
  restored: number[];
}

const DAY = "2026-08-22";

/** Transcribed from @theme in web/src/styles.css, light side. */
const INK_LIGHT = "oklch(0.195 0.009 55)";
const INK_MUTED_LIGHT = "oklch(0.465 0.01 55)";
const INK_FAINT_LIGHT = "oklch(0.62 0.008 60)";
const DIRTY_LIGHT = "oklch(0.5 0.21 330)";

function entry(
  id: number,
  issueKey: string,
  seconds: number,
  pushState: State,
  clock = "09:15",
): StubEntry {
  return {
    id,
    instanceId: 1,
    instanceName: "Ridgeline",
    instancePosition: 0,
    issueKey,
    day: DAY,
    startedAt: `${DAY}T${clock}:00+02:00`,
    seconds,
    comment: `comment ${String(id)}`,
    pushState,
  };
}

async function stubEntries(page: Page, seed: StubEntry[]): Promise<Recorder> {
  const entries = [...seed];
  const before = new Map<number, State>();
  const recorder: Recorder = { deleted: [], restored: [] };

  await page.route("**/api/entries**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const id = Number(/\/api\/entries\/(\d+)/.exec(url.pathname)?.[1] ?? 0);
    const found = entries.find((candidate) => candidate.id === id);

    if (request.method() === "GET") {
      await route.fulfill({ status: 200, json: { today: DAY, entries } });

      return;
    }
    if (request.method() === "DELETE" && found) {
      recorder.deleted.push(id);
      if (found.pushState === "unpushed") {
        entries.splice(entries.indexOf(found), 1);
      } else if (found.pushState !== "deleted") {
        before.set(id, found.pushState);
        found.pushState = "deleted";
      }
      await route.fulfill({ status: 204, body: "" });

      return;
    }
    if (request.method() === "POST" && url.pathname.endsWith("/restore") && found) {
      recorder.restored.push(id);
      const earlier = before.get(id);
      if (found.pushState !== "deleted" || earlier === undefined) {
        await route.fulfill({
          status: 409,
          json: { code: "entry_not_pending_delete", message: "the entry is not waiting to be deleted" },
        });

        return;
      }
      found.pushState = earlier;
      await route.fulfill({ status: 200, json: found });

      return;
    }
    await route.fulfill({ status: 404, json: { code: "not_found", message: "no such entry" } });
  });

  return recorder;
}

/** One instance with WORK-412 assigned, nothing pinned, and `seed` logged today. */
async function openToday(page: Page, seed: StubEntry[]): Promise<Recorder> {
  const recorder = await stubEntries(page, seed);
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
  await page.route("**/api/issues", (route) =>
    route.fulfill({
      status: 200,
      json: {
        instances: [
          {
            id: 1,
            name: "Ridgeline",
            issues: [
              {
                key: "WORK-412",
                summary: "Fix the CSV export encoding",
                status: "In Progress",
                url: "https://work.atlassian.net/browse/WORK-412",
              },
            ],
            error: null,
          },
        ],
      },
    }),
  );
  await page.route("**/api/issues/search**", (route) =>
    route.fulfill({ status: 200, json: { results: [], errors: [] } }),
  );
  await page.goto("/today");

  return recorder;
}

function trigger(page: Page, key: string) {
  return page.getByRole("button", { name: new RegExp(`Log time against ${key}`) });
}

function dialog(page: Page) {
  return page.locator("that-entry-dialog dialog");
}

function rows(page: Page) {
  return dialog(page).locator("ul > li");
}

export async function confirmDelete(page: Page, clock: string): Promise<void> {
  await dialog(page).getByRole("button", { name: `Delete the ${clock} entry` }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
}

test("deleting a pushed entry strikes its row, marks it, and puts Restore where Delete was", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  const recorder = await openToday(page, [
    entry(1, "WORK-412", 5400, "pushed"),
    entry(2, "WORK-412", 3600, "pushed", "11:00"),
  ]);
  await trigger(page, "WORK-412").click();
  await expect(dialog(page).locator("#that-entry-dialog-total")).toHaveText("2h 30m");

  const row = rows(page).nth(0);
  const deleteBox = await row.getByRole("button", { name: "Delete the 09:15 entry" }).boundingBox();
  const markBox = await row.getByRole("img").boundingBox();

  await confirmDelete(page, "09:15");

  await expect.poll(() => recorder.deleted).toEqual([1]);
  await expect(rows(page)).toHaveCount(2);
  const restore = row.getByRole("button", { name: "Restore the 09:15 entry" });
  await expect(restore).toBeVisible();
  await expect(row.getByRole("button", { name: /^(Edit|Delete) the 09:15 entry$/ })).toHaveCount(0);

  const mark = row.getByRole("img");
  await expect(mark).toHaveAttribute("aria-label", "deleted at next push");
  await expect(mark).toHaveCSS("color", DIRTY_LIGHT);
  await expect(mark.locator("svg circle")).toHaveCount(1);

  // By class, not by text: the comment's cut-text tooltip carries the same words.
  for (const text of [row.locator("span.font-mono"), row.locator("span.truncate")]) {
    await expect(text).toHaveCSS("text-decoration-line", "line-through");
    await expect(text).toHaveCSS("text-decoration-color", INK_FAINT_LIGHT);
    await expect(text).toHaveCSS("color", INK_MUTED_LIGHT);
  }
  await expect(restore).toHaveCSS("color", INK_LIGHT);
  await expect(dialog(page).locator("#that-entry-dialog-total")).toHaveText("1h 00m");

  // Option C: Restore takes the delete slot and the edit slot keeps its width,
  // so nothing in the row moves.
  const restoreBox = await restore.boundingBox();
  expect(restoreBox?.x).toBeCloseTo(deleteBox?.x ?? -1, 0);
  expect(restoreBox?.y).toBeCloseTo(deleteBox?.y ?? -1, 0);
  expect((await mark.boundingBox())?.x).toBeCloseTo(markBox?.x ?? -1, 0);

  // Focus lands on the control that undoes what was just pressed.
  await expect(restore).toBeFocused();
  await restore.hover();
  await expect(row.locator("that-tooltip", { hasText: "restore entry" })).toBeVisible();
});

test("restore brings the entry, its earlier state and the dialog's total back", async ({ page }) => {
  const recorder = await openToday(page, [entry(1, "WORK-412", 5400, "dirty")]);
  await trigger(page, "WORK-412").click();
  await confirmDelete(page, "09:15");
  await expect(dialog(page).locator("#that-entry-dialog-total")).toHaveText("0h 00m");

  await rows(page).nth(0).getByRole("button", { name: "Restore the 09:15 entry" }).click();

  await expect.poll(() => recorder.restored).toEqual([1]);
  const row = rows(page).nth(0);
  await expect(row.getByRole("img")).toHaveAttribute("aria-label", "edited since it was pushed");
  await expect(row.locator("span.font-mono")).toHaveCSS("text-decoration-line", "none");
  await expect(dialog(page).locator("#that-entry-dialog-total")).toHaveText("1h 30m");
  await expect(row.getByRole("button", { name: "Delete the 09:15 entry" })).toBeFocused();
});

test("the confirm says when the delete happens: at the next push for an entry Jira holds, now for one it does not", async ({
  page,
}) => {
  await openToday(page, [
    entry(1, "WORK-412", 5400, "pushed"),
    entry(2, "WORK-412", 3600, "dirty", "11:00"),
    entry(3, "WORK-412", 900, "unpushed", "13:00"),
  ]);
  await trigger(page, "WORK-412").click();

  for (const [clock, body] of [
    ["09:15", "1h 30m logged at 09:15 will be deleted at the next push. You can restore it until then."],
    ["11:00", "1h 00m logged at 11:00 will be deleted at the next push. You can restore it until then."],
    ["13:00", "0h 15m logged at 13:00 will be removed."],
  ] as const) {
    await dialog(page).getByRole("button", { name: `Delete the ${clock} entry` }).click();
    await expect(page.getByText(body, { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText(body, { exact: true })).toHaveCount(0);
  }
});

test("deleting an unpushed entry removes its row at once", async ({ page }) => {
  const recorder = await openToday(page, [
    entry(1, "WORK-412", 5400, "pushed"),
    entry(2, "WORK-412", 3600, "unpushed", "11:00"),
  ]);
  await trigger(page, "WORK-412").click();

  await confirmDelete(page, "11:00");

  await expect.poll(() => recorder.deleted).toEqual([2]);
  await expect(rows(page)).toHaveCount(1);
  await expect(dialog(page).getByRole("button", { name: /Restore/ })).toHaveCount(0);
});
