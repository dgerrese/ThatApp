import { expect, test, type Locator, type Page } from "@playwright/test";

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
  /** Every GET's raw query string, oldest first — what proves a day-scoped
   *  dialog asked for `from`/`to` rather than the bare list. */
  queries: string[];
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
  const recorder: Recorder = { posted: [], patched: [], deleted: [], gets: 0, queries: [] };
  let nextId = 500;
  let nextHour = 10;

  await page.route("**/api/entries**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const id = Number(/\/api\/entries\/(\d+)/.exec(url.pathname)?.[1] ?? 0);

    switch (request.method()) {
      case "GET": {
        recorder.gets += 1;
        recorder.queries.push(url.search);
        // Both bounds default to DAY — this stub's "today" — the same rule
        // the real server applies in THAT_TIMEZONE.
        const from = url.searchParams.get("from") ?? DAY;
        const to = url.searchParams.get("to") ?? DAY;
        const scoped = entries.filter((candidate) => candidate.day >= from && candidate.day <= to);
        await route.fulfill({ status: 200, json: { today: DAY, entries: scoped } });

        return;
      }

      case "POST": {
        const body = request.postDataJSON() as Record<string, unknown>;
        recorder.posted.push(body);
        // Absent day means DAY, matching the real server's "today" default.
        const day = typeof body["day"] === "string" && body["day"] !== "" ? body["day"] : DAY;
        const created = entry(nextId, String(body["issueKey"]), Number(body["seconds"]), {
          instanceId: Number(body["instanceId"]),
          instanceName: Number(body["instanceId"]) === 2 ? "Personal" : "Ridgeline",
          instancePosition: Number(body["instanceId"]) === 2 ? 1 : 0,
          day,
          startedAt: `${day}T${String(nextHour).padStart(2, "0")}:15:00+02:00`,
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
          await route.fulfill({ status: 404, json: { code: "not_found", message: "no such entry" } });

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

/**
 * Opens the entries dialog against a day-scoped ticket, mounted directly
 * rather than clicked open. Week is the only production caller that puts a
 * `day` on an `EntryTicket`, and it does not exist until #105's task 5 — this
 * exercises the same contract the dialog will read from Week, the way
 * pins.spec.ts mounts a bare `that-ticket-row` before Today wires one up.
 */
async function openDialogWithDay(
  page: Page,
  ticket: {
    instanceId: number;
    instanceName: string;
    issueKey: string;
    day: string;
    summary?: string;
  },
): Promise<void> {
  await page.evaluate(async (ticket) => {
    await customElements.whenDefined("that-entry-dialog");
    const element = document.createElement("that-entry-dialog") as unknown as {
      ticket: unknown;
    };
    element.ticket = { summary: "", status: "", ...ticket };
    document.body.append(element);
  }, ticket);
}

/** The logged entries, and only those. The empty line is a `<p>` sibling of
 *  the list now (D6 of #117 task 11), not an `<li>` inside it, so a bare "li"
 *  selector would already exclude it; "ul >" keeps this scoped to the list's
 *  own rows regardless of what a row's descendants (each carries several
 *  `that-tooltip`s) might otherwise match. */
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
const FAILED_LIGHT = "oklch(0.49 0.19 25)";

/** No background painted at all, which is what an untouched row wears. */
const UNPAINTED = "rgba(0, 0, 0, 0)";

/**
 * The bar the active row draws: the primary, 2px wide, on the left edge, inset.
 * Pinned rather than merely "some shadow", because a hairline of any colour on
 * any side would satisfy that and this is the only thing on screen saying which
 * entry the foot form is bound to. Tailwind composes box-shadow out of five
 * slots and this one fills the last, so the match is anchored to the end.
 */
const ACTIVE_BAR = /oklch\(0\.5 0\.21 330\) 2px 0px 0px 0px inset$/;

/** The wash and the bar together — the design's active state, not half of it. */
async function expectActive(row: Locator): Promise<void> {
  await expect(row).toHaveCSS("box-shadow", ACTIVE_BAR);
  await expect(row).not.toHaveCSS("background-color", UNPAINTED);
}

async function expectResting(row: Locator): Promise<void> {
  await expect(row).toHaveCSS("box-shadow", "none");
  await expect(row).toHaveCSS("background-color", UNPAINTED);
}

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
  await expect(dialog(page).locator("#that-entry-dialog-summary")).toHaveText("Weekly standup");
  await expect(dialog(page)).not.toContainText("In Progress");
});

/**
 * The one assertion that fails if anything about the rail is wired through the
 * Today view. It lives in the shell precisely so Settings — and #11's Week —
 * keep showing the right figure without knowing it exists.
 */
test("the rail keeps the total while Settings is open over Today", async ({ page }) => {
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
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect(page).toHaveURL(/\/today$/);
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
  await expectActive(entryRows(page).first());
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
  await expectActive(entryRows(page).nth(1));

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

  await expectResting(entryRows(page).first());
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

  // .first(): #143 gave the comment its own cut-text that-tooltip, hidden but
  // carrying the same text.
  await expect(dialog(page).getByText("mine").first()).toBeVisible();
  await expect(dialog(page).getByText("someone else's row")).toHaveCount(0);
  // The rail still totals the whole day, which is the difference being tested.
  await expect(page.locator("#rail-total")).toHaveText("1h 30m");
});

const PAST_DAY = "2026-08-20";

/**
 * #105 task 3: a dialog carrying a day reads that day, not today's. Both
 * entries below are the same ticket; only one is on the day the dialog is
 * scoped to.
 */
test("a day-scoped dialog lists only that day's entries", async ({ page }) => {
  const recorder = await openToday(page, [
    entry(1, "WORK-412", 3600, { comment: "today's work" }),
    entry(2, "WORK-412", 1800, {
      day: PAST_DAY,
      startedAt: `${PAST_DAY}T09:15:00+02:00`,
      comment: "past work",
    }),
  ]);

  await openDialogWithDay(page, {
    instanceId: 1,
    instanceName: "Ridgeline",
    issueKey: "WORK-412",
    day: PAST_DAY,
  });

  // .first(): #143 gave the comment its own cut-text that-tooltip, hidden but
  // carrying the same text.
  await expect(dialog(page).getByText("past work").first()).toBeVisible();
  await expect(dialog(page).getByText("today's work")).toHaveCount(0);
  await expect(dialogTotal(page)).toHaveText("0h 30m");
  // The exact contract, not just its effect: a ranged read, not the bare one.
  // Not "the last query" — Today's own boot reads race this one and are not
  // guaranteed to have settled first.
  expect(recorder.queries).toContain(`?from=${PAST_DAY}&to=${PAST_DAY}`);
});

/**
 * #105 task 3: adding from a day-scoped dialog sends that day, so the server
 * stamps the entry's start against it rather than its own clock's today.
 */
test("adding from a day-scoped dialog sends that day", async ({ page }) => {
  const recorder = await openToday(page, [entry(1, "WORK-412", 3600)]);

  await openDialogWithDay(page, {
    instanceId: 1,
    instanceName: "Ridgeline",
    issueKey: "WORK-412",
    day: PAST_DAY,
  });
  await typeDuration(page, "45");
  await dialog(page).getByRole("button", { name: "Add entry" }).click();

  await expect.poll(() => recorder.posted.length).toBe(1);
  expect(recorder.posted[0]).toMatchObject({
    instanceId: 1,
    issueKey: "WORK-412",
    seconds: 2700,
    comment: "",
    day: PAST_DAY,
  });
});

/**
 * #105 task 3's subtle half. A dialog scoped to a day that is not today
 * announces with no payload, so Today's own listeners re-read their own
 * period instead of repainting from a past day's rows. A test that only
 * checked "something happened" would pass on an announcement that leaked the
 * past day's list straight into Today's totals — this instead pins the exact
 * figures that leak would change.
 */
test("adding against a past day's dialog leaves Today's own figures unchanged", async ({
  page,
}) => {
  await openToday(page, [entry(1, "WORK-412", 3600)]);

  await expect(trigger(page, "WORK-412")).toHaveText("Log1:00");
  await expect(page.locator("#rail-total")).toHaveText("1h 00m");

  await openDialogWithDay(page, {
    instanceId: 1,
    instanceName: "Ridgeline",
    issueKey: "WORK-412",
    day: PAST_DAY,
  });
  await typeDuration(page, "45");
  await dialog(page).getByRole("button", { name: "Add entry" }).click();

  // The day-scoped dialog's own total does move — it is reading the day it
  // was scoped to, and this add is on it.
  await expect(dialogTotal(page)).toHaveText("0h 45m");

  // Today's row and the rail must not have moved: a leaked announcement would
  // repaint WORK-412's row at 0h 45m (the past day's own list) or the rail at
  // the same, not leave either where today's own entry left them.
  await expect(trigger(page, "WORK-412")).toHaveText("Log1:00");
  await expect(page.locator("#rail-total")).toHaveText("1h 00m");
});

/**
 * #105 task 4, Decisions 1 and 2: a scoped dialog names its own day, on the
 * line beneath the key — full weekday and month, above the summary when one
 * exists rather than in the identity row or the total.
 */
test("a day-scoped dialog names its own day, above the summary", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openToday(page);

  await openDialogWithDay(page, {
    instanceId: 1,
    instanceName: "Ridgeline",
    issueKey: "WORK-412",
    day: PAST_DAY,
    summary: "Fix the CSV export encoding",
  });

  const dayLine = dialog(page).locator("#that-entry-dialog-day");
  const summary = dialog(page).locator("#that-entry-dialog-summary");
  await expect(dayLine).toHaveText("Thursday 20 August");
  await expect(dayLine).toHaveCSS("color", INK_MUTED_LIGHT);

  const precedingId = await summary.evaluate((el) => el.previousElementSibling?.id);
  expect(precedingId).toBe("that-entry-dialog-day");
});

/**
 * #105 task 4, Decision 4: the empty line names the day it is empty for when
 * the dialog is scoped. The unscoped "... today." wording is covered above,
 * by "a ticket with nothing logged says so".
 */
test("a day-scoped dialog with nothing logged names the day it is empty for", async ({ page }) => {
  await openToday(page);

  await openDialogWithDay(page, {
    instanceId: 1,
    instanceName: "Ridgeline",
    issueKey: "WORK-412",
    day: PAST_DAY,
  });

  await expect(
    dialog(page).getByText("Nothing logged against this ticket on Thursday 20 August."),
  ).toBeVisible();
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
    await route.fulfill({ status: 200, json: { today: DAY, entries: [entry(1, "WORK-412", 3600)] } });
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
 * Review finding on #204: the split's rebuild-once-a-minute signature used to
 * carry only a slice's position and its figure, so a read that renamed an
 * instance (same position, same seconds) left the old name on screen until a
 * figure happened to cross a minute — a regression, since paint() used to
 * redraw the split on every read regardless. Editing an entry is what fires a
 * real re-announce with a fresh server response, the same path a rename
 * reaching this instance's row would take.
 */
test("a renamed instance redraws the split at once, not on the next minute crossing", async ({
  page,
}) => {
  await openToday(page, [entry(1, "WORK-412", 3600)]);

  let instanceName = "Ridgeline";
  await page.route("**/api/entries**", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();

    await route.fulfill({
      status: 200,
      json: { today: DAY, entries: [entry(1, "WORK-412", 3600, { instanceName })] },
    });
  });

  await expect(page.locator("#rail-split")).toContainText("Ridgeline");

  instanceName = "Basecamp";
  await trigger(page, "WORK-412").click();
  await dialog(page).getByRole("button", { name: "Edit the 09:15 entry" }).click();
  await dialog(page).getByRole("button", { name: "Save" }).click();

  await expect(page.locator("#rail-split")).toContainText("Basecamp");
  await expect(page.locator("#rail-split")).not.toContainText("Ridgeline");
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

  // The OS flips to dark first, so the light attribute below has something to
  // outrank. Set against a light OS it would pass on `color-scheme: dark light`
  // alone, and the attribute rule could be deleted without this noticing.
  await page.emulateMedia({ colorScheme: "dark" });
  // What setThemePreference does, on a dialog that is already open.
  await page.evaluate(() => {
    document.documentElement.dataset["theme"] = "light";
  });

  await expect(dialog(page)).toHaveCSS("color", INK_LIGHT);
});

/**
 * `.sheet { border: 1px solid var(--edge) }` beneath `--shadow-dialog` —
 * #117 task 11, D1. The shadow alone was the shipped state; the border is
 * what the drawing adds under it.
 */
test("the dialog carries a 1px edge border beneath its shadow", async ({ page }) => {
  await openToday(page);
  await trigger(page, "WORK-412").click();

  await expect(dialog(page)).toHaveCSS("border-width", "1px");
  await expect(dialog(page)).toHaveCSS("border-style", "solid");
  const shadow = await dialog(page).evaluate((el) => getComputedStyle(el).boxShadow);
  expect(shadow).not.toBe("none");
});

/**
 * The same edge, on that-confirm's own dialog — D1 names it "the same edge"
 * for a reason: the drift and the fix are one component's rule, not two.
 */
test("the confirm dialog carries the same 1px edge border", async ({ page }) => {
  await openToday(page, [entry(1, "WORK-412", 3600)]);
  await trigger(page, "WORK-412").click();
  await dialog(page).getByRole("button", { name: "Delete the 09:15 entry" }).click();

  const confirm = page.locator("that-confirm dialog");
  await expect(confirm).toBeVisible();
  await expect(confirm).toHaveCSS("border-width", "1px");
  await expect(confirm).toHaveCSS("border-style", "solid");
});

/**
 * The row's edit and delete controls carry their own `.tip` popover, like
 * cancel beside them — #117 task 11, D2. The visible words are the plain
 * "edit entry" / "delete entry": the tooltip is never the accessible name,
 * which stays the time-specific aria-label asserted elsewhere in this file.
 */
test("the row's edit and delete controls carry a tooltip, like cancel beside them", async ({
  page,
}) => {
  await openToday(page, [entry(1, "WORK-412", 3600)]);
  await trigger(page, "WORK-412").click();

  const row = entryRows(page).nth(0);
  // 0 is the comment's own cut-text tooltip (#143), 1 is the push mark's.
  const editTip = row.locator("that-tooltip").nth(2);
  const deleteTip = row.locator("that-tooltip").nth(3);

  await expect(editTip).toBeHidden();
  await dialog(page).getByRole("button", { name: "Edit the 09:15 entry" }).hover();
  await expect(editTip).toBeVisible();
  await expect(editTip).toHaveText("edit entry");

  await expect(deleteTip).toBeHidden();
  await dialog(page).getByRole("button", { name: "Delete the 09:15 entry" }).hover();
  await expect(deleteTip).toBeVisible();
  await expect(deleteTip).toHaveText("delete entry");
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
  // Named, not a bare "p": the empty line beneath the list (D6 of #117 task
  // 11) is a second <p> in the sheet.
  const subtitle = dialog(page).locator("#that-entry-dialog-summary");
  await expect(subtitle).toHaveText(workIssue.summary);
  await expect(subtitle).toHaveCSS("color", INK_MUTED_LIGHT);
});

/**
 * #105 task 4, Decision 2: every dialog names its day, not only a scoped one.
 * Today's ticket carries no day of its own, so the header names the `today`
 * the envelope carried instead of staying silent about its subject.
 */
test("the header names today's own day when the dialog carries none", async ({ page }) => {
  await openToday(page, [entry(1, "WORK-412", 3600)]);

  await trigger(page, "WORK-412").click();

  await expect(dialog(page).locator("#that-entry-dialog-day")).toHaveText("Saturday 22 August");
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
  await expect(dialog(page).locator("#that-entry-dialog-summary")).toHaveCount(0);
});

/**
 * Muted, not faint. --color-ink-faint clears the 3:1 floor for a mark and fails
 * the 4.5:1 floor for text in both themes, and these are words.
 */
test("an entry with no comment reads No comment in the muted tone", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openToday(page, [entry(1, "WORK-412", 3600)]);

  await trigger(page, "WORK-412").click();

  // .first(): #143 gave the comment its own cut-text that-tooltip, hidden but
  // carrying the same text.
  const none = dialog(page).getByText("No comment").first();
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
  await expectResting(rows.nth(1));
  await expect(dialog(page).getByRole("button", { name: "Stop editing" })).toBeHidden();

  await dialog(page).getByRole("button", { name: "Edit the 14:45 entry" }).click();

  await expectActive(rows.nth(1));
  await expectResting(rows.nth(0));
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
    "not pushed",
  );
  await expect(entryRows(page).nth(1).getByRole("img")).toHaveAttribute(
    "aria-label",
    "pushed",
  );

  // Scoped to this row and to its push mark's tooltip specifically: Today and
  // Week both put tooltips on the page already, edit and delete carry their
  // own beside this one (D2 of #117 task 11), and the comment now carries its
  // own cut-text one ahead of it in the DOM (#143).
  const popover = entryRows(page).nth(0).locator("that-tooltip").nth(1);
  await expect(popover).toBeHidden();
  await entryRows(page).nth(0).getByRole("img").hover();
  await expect(popover).toBeVisible();
  await expect(popover).toHaveText("not pushed");
});

/**
 * The one control that announces itself before it is pressed. It is asserted on
 * the computed colour under the pointer rather than on a class, because the
 * class was there and never reached the screen: `hover:text-failed` and the
 * shared button's `hover:text-ink` are the same specificity in the same layer,
 * so Tailwind's emission order decided it and ink won. Edit is checked in the
 * same breath so a fix cannot simply turn every icon button red.
 */
test("delete goes red under the pointer, and edit stays ink", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openToday(page, [entry(1, "WORK-412", 3600)]);

  await trigger(page, "WORK-412").click();
  const remove = dialog(page).getByRole("button", { name: "Delete the 09:15 entry" });
  const edit = dialog(page).getByRole("button", { name: "Edit the 09:15 entry" });

  await expect(remove).toHaveCSS("color", INK_MUTED_LIGHT);

  await remove.hover();
  await expect(remove).toHaveCSS("color", FAILED_LIGHT);

  await edit.hover();
  await expect(edit).toHaveCSS("color", INK_LIGHT);
  await expect(remove).toHaveCSS("color", INK_MUTED_LIGHT);
});

/**
 * The foot form reads as one bar or it reads as a mistake. Measured rather than
 * eyeballed: the duration group, the comment field and the submit are three
 * components with three different paddings, and nothing but this says they have
 * to agree. 38px is `.btn`'s own drawn height — #117 task 11, D3.
 */
test("the foot form's three controls share the drawn 38px height", async ({ page }) => {
  await openToday(page);

  await trigger(page, "WORK-412").click();
  const heights = await dialog(page).evaluate((sheet) => {
    const of = (selector: string) =>
      Math.round(sheet.querySelector(selector)?.getBoundingClientRect().height ?? 0);

    return {
      duration: of("that-duration > div"),
      comment: of("input[placeholder]"),
      submit: of("that-button button"),
    };
  });

  expect(heights.comment).toBe(heights.duration);
  expect(heights.submit).toBe(heights.duration);
  expect(heights.duration).toBe(38);
});

/**
 * `.durgroup input` and `.ecomment-in`'s own drawn paddings — #117 task 11,
 * D3. Longhand rather than the shorthand `padding`, matching how this suite
 * already asserts a computed padding elsewhere.
 */
test("the duration input and comment field carry the drawn padding", async ({ page }) => {
  await openToday(page);

  await trigger(page, "WORK-412").click();

  const duration = durationField(page);
  await expect(duration).toHaveCSS("padding-top", "9px");
  await expect(duration).toHaveCSS("padding-bottom", "9px");
  await expect(duration).toHaveCSS("padding-left", "8px");
  await expect(duration).toHaveCSS("padding-right", "8px");

  const comment = dialog(page).locator("input[placeholder]");
  await expect(comment).toHaveCSS("padding-top", "10px");
  await expect(comment).toHaveCSS("padding-bottom", "10px");
  await expect(comment).toHaveCSS("padding-left", "12px");
  await expect(comment).toHaveCSS("padding-right", "12px");
});

/**
 * `.durgroup input` wears Chivo Mono with tabular figures — #117 task 11, D4:
 * figures are set in the mono face throughout the app, and the duration field
 * was the one place still typing them in the prose face.
 */
test("the duration field is set in the mono face with tabular figures", async ({ page }) => {
  await openToday(page);

  await trigger(page, "WORK-412").click();
  const duration = durationField(page);

  expect(await duration.evaluate((el) => getComputedStyle(el).fontFamily)).toContain("Chivo Mono");
  expect(await duration.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toBe(
    "tabular-nums",
  );
});

/**
 * `.eempty` sits beneath `.elist`, not inside it, padded to the header's own
 * 20px gutter rather than the list's 14px — #117 task 11, D6.
 */
test("the empty line sits beneath the list, flush with the header's gutter", async ({ page }) => {
  await openToday(page);

  await trigger(page, "WORK-9").click();

  await expect(entryRows(page)).toHaveCount(0);
  const empty = dialog(page).getByText("Nothing logged against this ticket today.");
  await expect(empty).toBeVisible();

  const position = await empty.evaluate((el) => ({
    followsList: el.previousElementSibling?.tagName === "UL",
    insideList: el.closest("ul") !== null,
  }));
  expect(position.followsList).toBe(true);
  expect(position.insideList).toBe(false);
  await expect(empty).toHaveCSS("padding-left", "20px");
});

/**
 * The stepper's glyphs read at the icon language's own default — 18px at a
 * 1.9 stroke — rather than the prototype's own one-off 15px/2.1 markup for
 * this one pair of icons. #117 task 11, D7.
 */
test("the duration stepper's glyphs match the icon language's size and stroke", async ({
  page,
}) => {
  await openToday(page);

  await trigger(page, "WORK-412").click();
  const glyph = dialog(page).locator("that-duration svg").first();

  await expect(glyph).toHaveAttribute("width", "18");
  await expect(glyph).toHaveAttribute("height", "18");
  await expect(glyph).toHaveAttribute("stroke-width", "1.9");
});

/**
 * The primary's hover lifts the colour itself rather than compositing toward
 * whatever sits behind it — #117 task 11, D8. #rail-push already carries the
 * drawn form; this asserts the shared component matches it.
 */
test("the primary button's hover lifts brightness rather than fading", async ({ page }) => {
  await openToday(page);

  await trigger(page, "WORK-412").click();
  const submit = dialog(page).getByRole("button", { name: "Add entry" });

  await expect(submit).toHaveCSS("filter", "none");
  await submit.hover();
  await expect(submit).toHaveCSS("filter", "brightness(1.07)");
  await expect(submit).toHaveCSS("opacity", "1");
});

/**
 * The prototype's `.etotal { flex: none }`. Without it the total is a
 * shrinkable flex item and a long instance name takes its width, wrapping the
 * figure instead of truncating itself — and the figure is the one thing on this
 * line nobody can afford to have re-flow.
 */
test("a long instance name truncates rather than squeezing the total", async ({ page }) => {
  const longName = "Ridgeline Programme Delivery and Platform Engineering";
  await stubEntries(page, [entry(1, "WORK-412", 3600, { instanceName: longName })]);
  await stubPins(page, []);
  await stubIssues(page, [{ id: 1, name: longName, issues: [workIssue], error: null }]);
  await page.goto("/today");

  await trigger(page, "WORK-412").click();

  await expect(dialogTotal(page)).toHaveText("1h 00m");
  const laidOut = await dialog(page).evaluate((sheet) => {
    const box = (selector: string) => {
      const node = sheet.querySelector(selector) as HTMLElement;

      return { width: node.clientWidth, wanted: node.scrollWidth, height: Math.round(node.getBoundingClientRect().height) };
    };

    return { total: box("#that-entry-dialog-total"), instance: box("h2 > span") };
  });

  // The name gives ground; the figure keeps every pixel it asked for.
  expect(laidOut.instance.wanted).toBeGreaterThan(laidOut.instance.width);
  expect(laidOut.total.wanted).toBe(laidOut.total.width);
  // One line, not two: 22px type wrapped would be nearer 44.
  expect(laidOut.total.height).toBeLessThan(30);
});
