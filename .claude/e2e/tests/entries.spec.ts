import { expect, test, type Page } from "@playwright/test";

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
  /** Present because the real DTO always carries it — a stub without it would
   *  exercise a state the server never sends. */
  pushState: "unpushed" | "pushed" | "dirty";
}

interface Recorder {
  posted: Record<string, unknown>[];
  patched: { id: number; body: Record<string, unknown> }[];
  deleted: number[];
  /** Every GET answered, so a test can price a mutation in round trips. */
  gets: number;
}

const DAY = "2026-08-22";

function entry(id: number, issueKey: string, seconds: number, options?: Partial<StubEntry>) {
  return {
    id,
    instanceId: 1,
    instanceName: "Ridgeline",
    instancePosition: 0,
    issueKey,
    day: DAY,
    startedAt: `${DAY}T09:15:00+02:00`,
    seconds,
    comment: "",
    pushState: "unpushed",
    ...options,
  } satisfies StubEntry;
}

/**
 * A whole /api/entries in the browser: it answers GET from a list the mutations
 * actually change, so the row totals, the dialog and the rail are exercised
 * against a store that behaves like the real one.
 *
 * It is a stub and not the real endpoint because the e2e stack shares the dev
 * database — the same reason the pins and issues routes are stubbed. Posting
 * real entries would leave one developer's afternoon in it, and two browsers
 * running fullyParallel would log against each other.
 *
 * The recorder is the point of several tests below: what the control renders
 * and what it posts are different claims, and a control that shows `3h 00m`
 * while sending the wrong integer is the defect class this ticket is most
 * exposed to.
 */
async function stubEntries(page: Page, seed: StubEntry[] = []): Promise<Recorder> {
  const entries = [...seed];
  const recorder: Recorder = { posted: [], patched: [], deleted: [], gets: 0 };
  let nextId = 500;
  let nextHour = 10;

  await page.route("**/api/entries**", async (route) => {
    const request = route.request();
    const id = Number(/\/api\/entries\/(\d+)/.exec(new URL(request.url()).pathname)?.[1] ?? 0);

    switch (request.method()) {
      case "GET":
        recorder.gets += 1;
        await route.fulfill({ status: 200, json: entries });

        return;

      case "POST": {
        const body = request.postDataJSON() as Record<string, unknown>;
        recorder.posted.push(body);
        const created = entry(nextId, String(body["issueKey"]), Number(body["seconds"]), {
          instanceId: Number(body["instanceId"]),
          instanceName: Number(body["instanceId"]) === 2 ? "Personal" : "Ridgeline",
          instancePosition: Number(body["instanceId"]) === 2 ? 1 : 0,
          startedAt: `${DAY}T${String(nextHour).padStart(2, "0")}:15:00+02:00`,
          comment: String(body["comment"] ?? ""),
        });
        nextId += 1;
        nextHour += 1;
        entries.push(created);
        await route.fulfill({ status: 201, json: created });

        return;
      }

      case "PATCH": {
        const body = request.postDataJSON() as Record<string, unknown>;
        recorder.patched.push({ id, body });
        const found = entries.find((candidate) => candidate.id === id);
        if (!found) {
          await route.fulfill({ status: 404, json: { code: "entry_not_found", message: "gone" } });

          return;
        }
        if (typeof body["seconds"] === "number") found.seconds = body["seconds"];
        if (typeof body["comment"] === "string") found.comment = body["comment"];
        await route.fulfill({ status: 200, json: found });

        return;
      }

      default: {
        recorder.deleted.push(id);
        const index = entries.findIndex((candidate) => candidate.id === id);
        if (index >= 0) entries.splice(index, 1);
        await route.fulfill({ status: 204, body: "" });
      }
    }
  });

  return recorder;
}

async function stubIssues(page: Page, groups: unknown[]): Promise<void> {
  await page.route("**/api/issues", (route) =>
    route.fulfill({ status: 200, json: { instances: groups } }),
  );
}

async function stubPins(page: Page, pins: unknown[]): Promise<void> {
  await page.route("**/api/pins**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();

      return;
    }
    await route.fulfill({ status: 200, json: pins });
  });
}

const workIssue = {
  key: "WORK-412",
  summary: "Fix the CSV export encoding",
  status: "In Progress",
  url: "https://work.atlassian.net/browse/WORK-412",
};

const otherIssue = {
  key: "WORK-9",
  summary: "Retry a worklog push that failed",
  status: "To Do",
  url: "https://work.atlassian.net/browse/WORK-9",
};

/** One instance, two assigned issues, nothing pinned and nothing logged. */
async function openToday(page: Page, seed: StubEntry[] = []): Promise<Recorder> {
  const recorder = await stubEntries(page, seed);
  await stubPins(page, []);
  await stubIssues(page, [
    { id: 1, name: "Ridgeline", issues: [workIssue, otherIssue], error: null },
  ]);
  await page.goto("/today");

  return recorder;
}

function trigger(page: Page, key: string) {
  return page.getByRole("button", { name: new RegExp(`Log time against ${key}`) });
}

function dialog(page: Page) {
  return page.locator("that-entry-dialog dialog");
}

function dialogTotal(page: Page) {
  return page.locator("#that-entry-dialog-total");
}

function durationField(page: Page) {
  return dialog(page).getByLabel("Duration");
}

async function typeDuration(page: Page, typed: string): Promise<void> {
  await durationField(page).fill(typed);
  await durationField(page).press("Enter");
}

/** The logged entries, and only those: the empty line is an <li> too, and each
 *  row now carries a that-tooltip of its own that must not be counted. */
function entryRows(page: Page) {
  return dialog(page).locator("ul > li");
}

/**
 * Computed colours rather than class names, for the same reason theme.spec.ts
 * uses them: a spec asserting classes passes against a stylesheet that never
 * loaded. Transcribed from @theme in web/src/styles.css.
 */
const INK_LIGHT = "oklch(0.195 0.009 55)";
const INK_DARK = "oklch(0.962 0.005 70)";
const INK_MUTED_LIGHT = "oklch(0.465 0.01 55)";

test("the duration control posts the seconds its table promises, not what was typed", async ({
  page,
}) => {
  const recorder = await openToday(page);

  await trigger(page, "WORK-412").click();
  await typeDuration(page, "300");
  await expect(durationField(page)).toHaveValue("3:00");
  await dialog(page).getByRole("button", { name: "Add entry" }).click();

  await expect.poll(() => recorder.posted.length).toBe(1);
  expect(recorder.posted[0]).toMatchObject({
    instanceId: 1,
    issueKey: "WORK-412",
    seconds: 10800,
  });
});

/**
 * The clause a later reader will "simplify" into a plain round, which turns
 * this into zero. Asserted on the payload rather than the field, because the
 * field could render 0:15 while posting 420 and nothing on screen would say so.
 */
test("typing 7 posts a quarter of an hour rather than nothing", async ({ page }) => {
  const recorder = await openToday(page);

  await trigger(page, "WORK-412").click();
  await typeDuration(page, "7");
  await expect(durationField(page)).toHaveValue("0:15");
  await dialog(page).getByRole("button", { name: "Add entry" }).click();

  await expect.poll(() => recorder.posted.length).toBe(1);
  expect(recorder.posted[0]).toMatchObject({ seconds: 900 });
});

test("adding moves the row total and the rail total with no reload", async ({ page }) => {
  await openToday(page);

  await expect(trigger(page, "WORK-412")).toHaveText("Log0:00");
  await expect(page.locator("#rail-total")).toHaveText("0h 00m");

  await trigger(page, "WORK-412").click();
  await typeDuration(page, "130");
  await dialog(page).getByRole("button", { name: "Add entry" }).click();

  await expect(dialogTotal(page)).toHaveText("1h 30m");
  await expect(trigger(page, "WORK-412")).toHaveText("Log1:30");
  await expect(page.locator("#rail-total")).toHaveText("1h 30m");
  await expect(page.locator("#rail-split")).toContainText("Ridgeline");
});

test("editing and deleting move both totals too", async ({ page }) => {
  await openToday(page, [entry(1, "WORK-412", 3600)]);

  await expect(page.locator("#rail-total")).toHaveText("1h 00m");
  await trigger(page, "WORK-412").click();

  await dialog(page).getByRole("button", { name: "Edit the 09:15 entry" }).click();
  await typeDuration(page, "230");
  await dialog(page).getByRole("button", { name: "Save" }).click();

  await expect(trigger(page, "WORK-412")).toHaveText("Log2:30");
  await expect(page.locator("#rail-total")).toHaveText("2h 30m");

  await dialog(page).getByRole("button", { name: "Delete the 09:15 entry" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(trigger(page, "WORK-412")).toHaveText("Log0:00");
  await expect(page.locator("#rail-total")).toHaveText("0h 00m");
  // No bar rather than a bar of zero width, which is what the resting line says.
  await expect(page.locator("#rail-split")).toHaveText("Nothing to split yet");
});

/**
 * A modal <dialog> opened from inside a modal <dialog>. The top layer is a
 * stack, so Esc must dismiss only the confirmation — asserted rather than
 * assumed, because the failure mode is losing an entry the user was editing.
 */
test("Esc on the delete confirmation closes only the confirmation", async ({ page }) => {
  const recorder = await openToday(page, [entry(1, "WORK-412", 3600)]);

  await trigger(page, "WORK-412").click();
  const deleteRow = dialog(page).getByRole("button", { name: "Delete the 09:15 entry" });
  await deleteRow.click();
  await expect(page.getByText("Delete this entry?")).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page.getByText("Delete this entry?")).toHaveCount(0);
  await expect(dialog(page)).toBeVisible();
  await expect(deleteRow).toBeFocused();
  expect(recorder.deleted).toEqual([]);
});

test("the dialog opens from a pinned row as well as an assigned one", async ({ page }) => {
  await stubEntries(page);
  await stubPins(page, [
    {
      id: 3,
      instanceId: 1,
      instanceName: "Ridgeline",
      instancePosition: 0,
      key: "SHARED-12",
      summary: "Weekly standup",
      status: "In Progress",
      url: "https://work.atlassian.net/browse/SHARED-12",
      error: null,
    },
  ]);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [workIssue], error: null }]);
  await page.goto("/today");

  await trigger(page, "SHARED-12").click();

  await expect(dialog(page).getByRole("heading")).toHaveText(/Ridgeline\s*·\s*SHARED-12/);
  // The summary is the subtitle now, and the status is off the sheet entirely.
  await expect(dialog(page).locator("p")).toHaveText("Weekly standup");
  await expect(dialog(page)).not.toContainText("In Progress");
});

/**
 * The one assertion that fails if anything about the rail is wired through the
 * Today view. It lives in the shell precisely so Settings — and #11's Week —
 * keep showing the right figure without knowing it exists.
 */
test("the rail keeps the total after navigating to Settings", async ({ page }) => {
  await page.route("**/api/instances", (route) => route.fulfill({ status: 200, json: [] }));
  await openToday(page);

  await trigger(page, "WORK-412").click();
  await typeDuration(page, "45");
  await dialog(page).getByRole("button", { name: "Add entry" }).click();
  await expect(page.locator("#rail-total")).toHaveText("0h 45m");

  // Closed first, because the dialog is modal and nothing behind it is
  // clickable — which is the platform behaviour this ticket relies on.
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await page.getByRole("link", { name: "Settings" }).click();

  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.locator("#rail-total")).toHaveText("0h 45m");
});

/**
 * #29's bug in new clothes: a re-render that reaches the element being typed
 * into. Today rebuilds its lists wholesale on Refresh, which is why the dialog
 * is appended to the view root and never to the row that opened it.
 */
test("Refresh leaves an open dialog and its mid-edit state alone", async ({ page }) => {
  await openToday(page, [entry(1, "WORK-412", 3600)]);

  await trigger(page, "WORK-412").click();
  await dialog(page).getByRole("button", { name: "Edit the 09:15 entry" }).click();
  await dialog(page).getByPlaceholder("What did you work on?").fill("half typed");

  // Dispatched rather than clicked: the dialog is modal, so Refresh is behind
  // an inert background and no pointer can reach it. What is under test is the
  // re-render it triggers, not the click — Today rebuilds both its lists, and
  // that is what would destroy a dialog nested in a row.
  await page.getByRole("button", { name: "Refresh" }).dispatchEvent("click");

  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByPlaceholder("What did you work on?")).toHaveValue("half typed");
  // Still bound to the entry it was bound to: the active row is what says so.
  await expect(entryRows(page).first()).not.toHaveCSS("box-shadow", "none");
});

test("the trigger opens from the keyboard", async ({ page }) => {
  await openToday(page);

  const cell = trigger(page, "WORK-412");
  await cell.focus();
  await expect(cell).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole("heading")).toHaveText(/WORK-412/);
});

/**
 * The foot form is bound to one entry, and the only thing on screen saying
 * which is that its row is the one left undimmed. Save must PATCH that id and
 * Cancel must change nothing at all.
 */
test("editing binds the foot form to one entry", async ({ page }) => {
  const recorder = await openToday(page, [
    entry(1, "WORK-412", 3600, { comment: "morning", startedAt: `${DAY}T09:15:00+02:00` }),
    entry(2, "WORK-412", 1800, { comment: "afternoon", startedAt: `${DAY}T14:45:00+02:00` }),
  ]);

  await trigger(page, "WORK-412").click();
  await dialog(page).getByRole("button", { name: "Edit the 14:45 entry" }).click();

  await expect(durationField(page)).toHaveValue("0:30");
  await expect(dialog(page).getByPlaceholder("What did you work on?")).toHaveValue("afternoon");
  await expect(entryRows(page).nth(1)).not.toHaveCSS("box-shadow", "none");

  await dialog(page).getByPlaceholder("What did you work on?").fill("afternoon, revised");
  await dialog(page).getByRole("button", { name: "Save" }).click();

  await expect.poll(() => recorder.patched.length).toBe(1);
  expect(recorder.patched[0]?.id).toBe(2);
  expect(recorder.patched[0]?.body).toMatchObject({ seconds: 1800, comment: "afternoon, revised" });
});

test("cancelling an edit changes nothing", async ({ page }) => {
  const recorder = await openToday(page, [entry(1, "WORK-412", 3600, { comment: "morning" })]);

  await trigger(page, "WORK-412").click();
  await dialog(page).getByRole("button", { name: "Edit the 09:15 entry" }).click();
  await typeDuration(page, "800");
  await dialog(page).getByRole("button", { name: "Stop editing" }).click();

  await expect(entryRows(page).first()).toHaveCSS("box-shadow", "none");
  await expect(dialog(page).getByRole("button", { name: "Stop editing" })).toBeHidden();
  // Back to adding, not still holding the edited figure.
  await expect(dialog(page).getByRole("button", { name: "Add entry" })).toBeVisible();
  await expect(durationField(page)).toHaveValue("0:00");
  await expect(trigger(page, "WORK-412")).toHaveText("Log1:00");
  expect(recorder.patched).toEqual([]);
});

test("a ticket with nothing logged says so", async ({ page }) => {
  await openToday(page);

  await trigger(page, "WORK-9").click();

  await expect(dialog(page).getByText("Nothing logged against this ticket today.")).toBeVisible();
  await expect(dialogTotal(page)).toHaveText("0h 00m");
});

/**
 * The dialog shows one ticket's day, not the whole day's. Both entries below
 * are today's and only one belongs to the ticket being opened.
 */
test("the dialog shows only the ticket it was opened from", async ({ page }) => {
  await openToday(page, [
    entry(1, "WORK-412", 3600, { comment: "mine" }),
    entry(2, "WORK-9", 1800, { comment: "someone else's row" }),
  ]);

  await trigger(page, "WORK-412").click();

  await expect(dialog(page).getByText("mine")).toBeVisible();
  await expect(dialog(page).getByText("someone else's row")).toHaveCount(0);
  // The rail still totals the whole day, which is the difference being tested.
  await expect(page.locator("#rail-total")).toHaveText("1h 30m");
});

/**
 * The colon the user typed carries structure. Stripping it first read "1:5" as
 * the digits 15 — an hour typed, a quarter of it posted, and only the field's
 * snap-back as a clue.
 */
test("an unpadded H:M means hours and minutes, not a digit string", async ({ page }) => {
  const recorder = await openToday(page);

  await trigger(page, "WORK-412").click();
  await typeDuration(page, "1:5");
  await expect(durationField(page)).toHaveValue("1:00");
  await dialog(page).getByRole("button", { name: "Add entry" }).click();

  await expect.poll(() => recorder.posted.length).toBe(1);
  expect(recorder.posted[0]).toMatchObject({ seconds: 3600 });
});

/**
 * The API deliberately accepts seconds off the 15-minute grid, and #8's timer
 * will create them routinely. The field shows such an entry rounded for
 * display, and a blur that re-read its own rounding would commit the snap —
 * so merely tabbing through the field must not rewrite the duration.
 */
test("tabbing through the duration field does not rewrite a loaded entry", async ({ page }) => {
  const recorder = await openToday(page, [entry(1, "WORK-412", 433)]);

  await trigger(page, "WORK-412").click();
  await dialog(page).getByRole("button", { name: "Edit the 09:15 entry" }).click();
  await expect(durationField(page)).toHaveValue("0:07");

  await durationField(page).focus();
  await page.keyboard.press("Tab");
  await dialog(page).getByRole("button", { name: "Save" }).click();

  await expect.poll(() => recorder.patched.length).toBe(1);
  expect(recorder.patched[0]?.body).toMatchObject({ seconds: 433 });
});

/**
 * Stepping starts from the figure as typed, before the quarter-hour snap. A
 * parse that snapped first turned 7 into 0:15 and then stepped clean past it
 * to 0:30 — the step its own promise says lands on 0:15.
 */
test("the first step up from a typed figure lands on the next quarter hour", async ({ page }) => {
  const recorder = await openToday(page);

  await trigger(page, "WORK-412").click();
  await durationField(page).fill("7");
  await durationField(page).press("ArrowUp");
  await expect(durationField(page)).toHaveValue("0:15");

  await dialog(page).getByRole("button", { name: "Add entry" }).click();
  await expect.poll(() => recorder.posted.length).toBe(1);
  expect(recorder.posted[0]).toMatchObject({ seconds: 900 });
});

/**
 * The dialog's trigger is what showModal() returns focus to on close. A save
 * repaints every row's total, and a repaint that rebuilt the row would detach
 * that button — closing the dialog would then drop a keyboard user at <body>,
 * back to the top of the page.
 */
test("closing the dialog after a save returns focus to the row's trigger", async ({ page }) => {
  await openToday(page);

  const cell = trigger(page, "WORK-412");
  await cell.click();
  await typeDuration(page, "45");
  await dialog(page).getByRole("button", { name: "Add entry" }).click();
  await expect(cell).toHaveText("Log0:45");

  await page.keyboard.press("Escape");

  await expect(dialog(page)).toHaveCount(0);
  await expect(cell).toBeFocused();
});

/**
 * One save, one read. The dialog re-reads the day and the announcement carries
 * that response to the rail and the row totals, so three consumers repaint
 * from one request — which is also what keeps their figures agreeing.
 */
test("one save costs one read of the day", async ({ page }) => {
  const recorder = await openToday(page);

  // Boot costs two reads — the rail's and the row totals' — and opening the
  // dialog a third. The claim under test is that the save adds exactly one.
  await trigger(page, "WORK-412").click();
  await typeDuration(page, "130");
  await dialog(page).getByRole("button", { name: "Add entry" }).click();

  await expect(page.locator("#rail-total")).toHaveText("1h 30m");
  await expect(trigger(page, "WORK-412")).toHaveText("Log1:30");
  expect(recorder.gets).toBe(4);
});

/**
 * At boot the rail's regions hold index.html's hardcoded 0h 00m — a
 * placeholder, not a figure. The refresh policy of leaving the regions alone
 * on failure assumes they held a truth; for the first paint it must retry
 * instead, or a container restart leaves a wrong-looks-real zero up all day.
 */
test("a failed first fetch retries until the rail holds a real figure", async ({ page }) => {
  let failures = 0;
  await page.route("**/api/entries**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();

      return;
    }
    // Both boot reads fail — the rail's and the row totals' — so whichever
    // arrives first, the rail's own is among them.
    if (failures < 2) {
      failures += 1;
      await route.abort();

      return;
    }
    await route.fulfill({ status: 200, json: [entry(1, "WORK-412", 3600)] });
  });
  await stubPins(page, []);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [workIssue], error: null }]);
  await page.goto("/today");

  await expect(page.locator("#rail-total")).toHaveText("1h 00m", { timeout: 10_000 });
});

test("the split names every instance with time against it", async ({ page }) => {
  await stubEntries(page, [
    entry(1, "WORK-412", 3600),
    entry(2, "PERS-7", 1800, { instanceId: 2, instanceName: "Personal", instancePosition: 1 }),
  ]);
  await stubPins(page, []);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [workIssue], error: null }]);
  await page.goto("/today");

  await expect(page.locator("#rail-total")).toHaveText("1h 30m");
  await expect(page.locator("#rail-split")).toContainText("Ridgeline");
  await expect(page.locator("#rail-split")).toContainText("Personal");
  await expect(page.locator("#rail-split")).toContainText("1h 00m");
  await expect(page.locator("#rail-split")).toContainText("0h 30m");
  // One segment per instance, sized by its share.
  await expect(page.locator("#rail-split .that-split-bar > span")).toHaveCount(2);
});

/**
 * Trap 4 of the design, and the one this ticket exists to nail down. A native
 * <dialog> is in the top layer and the user-agent stylesheet gives it
 * `color: CanvasText` — a declaration, which beats inheritance — so a dialog
 * that does not state a colour wears the browser's ink rather than the app's.
 * On a dark ground the two are near enough to look identical, which is how the
 * defect survived thirteen prototype passes.
 *
 * This half exercises the *auto* path: nothing stored, no data-theme on the
 * root, `prefers-color-scheme` alone deciding. A test that only ever ran one
 * theme is exactly what let the original through.
 */
test("the dialog names the app's ink in both themes the OS can ask for", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openToday(page);
  await trigger(page, "WORK-412").click();

  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  await expect(dialog(page)).toHaveCSS("color", INK_LIGHT);

  await page.emulateMedia({ colorScheme: "dark" });

  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  await expect(dialog(page)).toHaveCSS("color", INK_DARK);
});

/**
 * The other half of the theme mechanics: an explicit choice stamps data-theme
 * on the root and outranks the OS. Both directions, because the stylesheet
 * declares the two attribute cases separately and one of them could be dropped
 * without the other noticing.
 */
test("the dialog names the app's ink under a stored preference too", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await openToday(page);
  await trigger(page, "WORK-412").click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(dialog(page)).toHaveCSS("color", INK_DARK);

  // What setThemePreference does, on a dialog that is already open.
  await page.evaluate(() => {
    document.documentElement.dataset["theme"] = "light";
  });

  await expect(dialog(page)).toHaveCSS("color", INK_LIGHT);
});

/**
 * The header is the instance, the key and the total. The status was there and
 * is not any more — the row that opened this already draws it — and the start
 * time is off the entry lines for the same reason.
 */
test("the header carries the dot, the instance, the key and the total, and no status", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openToday(page, [entry(1, "WORK-412", 3600, { comment: "morning" })]);

  await trigger(page, "WORK-412").click();

  await expect(dialog(page).getByRole("heading")).toHaveText(/^Ridgeline\s*·\s*WORK-412$/);
  await expect(dialog(page).locator(".that-dot")).toBeVisible();
  await expect(dialogTotal(page)).toHaveText("1h 00m");

  await expect(dialog(page)).not.toContainText("In Progress");
  await expect(dialog(page)).not.toContainText("09:15");

  // The summary is a subtitle beneath the identity line, muted, not the heading.
  const subtitle = dialog(page).locator("p");
  await expect(subtitle).toHaveText(workIssue.summary);
  await expect(subtitle).toHaveCSS("color", INK_MUTED_LIGHT);
});

/**
 * Week's rows carry keys only and open this dialog with a blank summary. A
 * subtitle element rendered empty would still cost its line box and its margin,
 * which is a gap under a header for no reason anybody could see.
 */
test("a ticket with no summary renders no subtitle at all", async ({ page }) => {
  await stubEntries(page);
  await stubPins(page, []);
  await stubIssues(page, [
    { id: 1, name: "Ridgeline", issues: [{ ...workIssue, summary: "" }], error: null },
  ]);
  await page.goto("/today");

  await trigger(page, "WORK-412").click();

  await expect(dialog(page).getByRole("heading")).toHaveText(/^Ridgeline\s*·\s*WORK-412$/);
  await expect(dialog(page).locator("p")).toHaveCount(0);
});

/**
 * Muted, not faint. --color-ink-faint clears the 3:1 floor for a mark and fails
 * the 4.5:1 floor for text in both themes, and these are words.
 */
test("an entry with no comment reads No comment in the muted tone", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openToday(page, [entry(1, "WORK-412", 3600)]);

  await trigger(page, "WORK-412").click();

  const none = dialog(page).getByText("No comment");
  await expect(none).toBeVisible();
  await expect(none).toHaveCSS("color", INK_MUTED_LIGHT);
});

/**
 * What binds the foot form to one entry, now that no line of text names it: the
 * row being edited takes the active state, and — the half that replaced the old
 * behaviour — every other row is left exactly as it was rather than dimmed.
 */
test("editing marks its own row active, offers Save and Cancel, and dims no other row", async ({
  page,
}) => {
  await openToday(page, [
    entry(1, "WORK-412", 3600, { comment: "morning", startedAt: `${DAY}T09:15:00+02:00` }),
    entry(2, "WORK-412", 1800, { comment: "afternoon", startedAt: `${DAY}T14:45:00+02:00` }),
  ]);

  await trigger(page, "WORK-412").click();
  const rows = entryRows(page);
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toHaveCSS("box-shadow", "none");
  await expect(dialog(page).getByRole("button", { name: "Stop editing" })).toBeHidden();

  await dialog(page).getByRole("button", { name: "Edit the 14:45 entry" }).click();

  await expect(rows.nth(1)).not.toHaveCSS("box-shadow", "none");
  await expect(rows.nth(0)).toHaveCSS("box-shadow", "none");
  await expect(rows.nth(0)).toHaveCSS("opacity", "1");
  await expect(dialog(page).getByRole("button", { name: "Save" })).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: "Stop editing" })).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: "Add entry" })).toHaveCount(0);
});

/**
 * The group is the control; the field inside it is borderless and takes no ring
 * of its own. Pressing + must light the whole thing rather than nothing, which
 * is why the group uses :focus-within and not the input's :focus.
 */
test("the duration group takes the focus ring, not the field inside it", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openToday(page);

  await trigger(page, "WORK-412").click();
  const group = dialog(page).locator("that-duration > div");

  const resting = await group.evaluate((el) => getComputedStyle(el).borderTopColor);
  await durationField(page).focus();
  const focused = await group.evaluate((el) => getComputedStyle(el).borderTopColor);

  expect(focused).not.toBe(resting);
  expect(focused).toBe(INK_LIGHT);
  await expect(durationField(page)).toHaveCSS("outline-style", "none");
});

/**
 * A new entry is unpushed, and the marker beside it is what says so — the
 * design took away the explanatory line on the grounds that the marker says the
 * same thing where it matters. The popover is not the accessible name: the mark
 * carries its own label whether or not anything is hovered.
 */
test("each entry carries a push-state mark naming its state", async ({ page }) => {
  await openToday(page, [
    entry(1, "WORK-412", 3600, { comment: "morning" }),
    entry(2, "WORK-412", 1800, { comment: "afternoon", pushState: "pushed" }),
  ]);

  await trigger(page, "WORK-412").click();

  await expect(entryRows(page).nth(0).getByRole("img")).toHaveAttribute(
    "aria-label",
    "not pushed to Jira",
  );
  await expect(entryRows(page).nth(1).getByRole("img")).toHaveAttribute(
    "aria-label",
    "pushed to Jira",
  );

  // Scoped to this row: Today and Week both put tooltips on the page already,
  // and an unscoped that-tooltip locator is a strict-mode violation.
  const popover = entryRows(page).nth(0).locator("that-tooltip");
  await expect(popover).toBeHidden();
  await entryRows(page).nth(0).getByRole("img").hover();
  await expect(popover).toBeVisible();
  await expect(popover).toHaveText("not pushed to Jira");
});
