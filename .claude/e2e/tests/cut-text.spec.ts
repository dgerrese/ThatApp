import { expect, test, type Locator, type Page } from "@playwright/test";

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
  error: { code: string; message: string } | null;
}

// Copied from today.spec.ts — see its own comment for why /api/issues is
// stubbed this way and why /api/pins and /api/entries are stubbed at all.
async function stubIssues(page: Page, ...responses: StubGroup[][]): Promise<void> {
  let calls = 0;

  await page.route("**/api/issues", async (route) => {
    const index = Math.min(calls, responses.length - 1);
    calls += 1;
    await route.fulfill({ status: 200, json: { instances: responses[index] } });
  });
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
  await page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 200, json: { today: "2026-09-09", entries: [] } }),
  );
});

function group(id: number, name: string, issues: StubIssue[]): StubGroup {
  return { id, name, issues, error: null };
}

function issue(key: string, summary: string): StubIssue {
  return { key, summary, status: "To Do", url: `https://work.atlassian.net/browse/${key}` };
}

// A pinned row is the only path that puts a failure note under a summary —
// today.ts's pinnedRow sets `error` from a pin's own error, never from an
// assigned issue (see today.ts's cardBuilding, which renders a whole-card
// alert for an instance error instead of touching any row). Copied and
// trimmed from pins.spec.ts's own `pin` — only the fields this file needs.
function pinWithError(summary: string, failureMessage: string): Record<string, unknown> {
  return {
    id: 1,
    instanceId: 1,
    instanceName: "Work",
    instancePosition: 0,
    key: "WORK-1",
    summary,
    status: "To Do",
    url: "https://work.atlassian.net/browse/WORK-1",
    error: { code: "instance_unreachable", message: failureMessage },
  };
}

async function stubPinWithError(
  page: Page,
  summary: string,
  failureMessage: string,
): Promise<void> {
  await page.route("**/api/pins**", (route) =>
    route.fulfill({ status: 200, json: [pinWithError(summary, failureMessage)] }),
  );
}

/** #217: the element under test is reached by a real Tab from the one before
 *  it, with the pointer parked so no hover opens anything on its own. */
async function tabTo(page: Page, before: Locator, target: Locator): Promise<void> {
  await before.focus();
  await page.mouse.move(0, 0);
  await page.keyboard.press("Tab");
  await expect(target).toBeFocused();
}

// Narrow enough that the summary column truncates a long summary.
test.use({ viewport: { width: 900, height: 700 } });

const longSummary =
  "Reconcile the quarterly capacity forecast against every team's actual booked hours, " +
  "including the contractors who log time in a different instance entirely";

test("a cut summary in a Today row shows its full text on hover", async ({ page }) => {
  await stubIssues(page, [group(1, "Work", [issue("WORK-1", longSummary)])]);
  await page.goto("/today");
  await page.getByText(longSummary, { exact: true }).first().hover();
  const tip = page.locator("that-tooltip", { hasText: longSummary });
  await expect(tip).toBeVisible();
});

// Owner, 2026-09-25: the Today row's own summary is its own tab stop now
// rather than following the key link's focus. It used to follow the key link
// so a keyboard user reached it too, but that opened both this tooltip and
// the key's own "open in Jira" one at once, and below ~900px the summary's
// covered the key's.
test("a Today row's key focus shows only the key's own tooltip, not the cut summary's", async ({
  page,
}) => {
  await stubIssues(page, [group(1, "Work", [issue("WORK-1", longSummary)])]);
  await page.goto("/today");
  const key = page.getByRole("link", { name: "WORK-1" });
  const summary = page.getByText(longSummary, { exact: true }).first();
  // #217: reach the key by a real Shift+Tab from the summary right after it
  // in DOM order, never by focusing the key itself — it is the element under
  // test.
  await summary.focus();
  await page.mouse.move(0, 0);
  await page.keyboard.press("Shift+Tab");
  await expect(key).toBeFocused();
  await expect(page.locator("that-tooltip", { hasText: "open in Jira" })).toBeVisible();
  await expect(page.locator("that-tooltip", { hasText: longSummary })).toBeHidden();
});

// At the same viewport this file already uses (900px) where the owner saw the
// collision: exactly one tooltip on screen, the key's own.
test("at 900px, focusing a cut-summary row's key shows exactly one tooltip: open in Jira", async ({
  page,
}) => {
  await stubIssues(page, [group(1, "Work", [issue("WORK-1", longSummary)])]);
  await page.goto("/today");
  await page.getByRole("link", { name: "WORK-1" }).focus();

  const visible = page.locator("that-tooltip:visible");
  await expect(visible).toHaveCount(1);
  await expect(visible).toHaveText("open in Jira");
});

// Task 9 (#143): the summary is its own tab stop now, reached by tabbing off
// the key link, and opens only its own tooltip — never the key's "open in
// Jira" one, which the test above already proves the reverse of.
test("tabbing from a Today row's key link reaches the cut summary and shows its own tooltip only", async ({
  page,
}) => {
  await stubIssues(page, [group(1, "Work", [issue("WORK-1", longSummary)])]);
  await page.goto("/today");
  await page.getByRole("link", { name: "WORK-1" }).focus();
  await page.keyboard.press("Tab");
  const summary = page.getByText(longSummary, { exact: true }).first();
  await expect(summary).toBeFocused();
  await expect(page.locator("that-tooltip", { hasText: longSummary })).toBeVisible();
  await expect(page.locator("that-tooltip", { hasText: "open in Jira" })).toBeHidden();
});

test("a Today summary that is not cut shows no tooltip on hover or focus", async ({ page }) => {
  await stubIssues(page, [group(1, "Work", [issue("WORK-2", "Short one")])]);
  await page.goto("/today");
  // .first(): the tooltip carries the same text too, even while hidden.
  const summary = page.getByText("Short one", { exact: true }).first();
  await summary.hover();
  await expect(page.locator("that-tooltip", { hasText: "Short one" })).toBeHidden();
  await page.getByRole("link", { name: "WORK-2" }).focus();
  await expect(page.locator("that-tooltip", { hasText: "Short one" })).toBeHidden();
  // The summary is focusable regardless of whether it is cut (#143 task 9);
  // `when-cut` is what keeps its tooltip from opening here, not its absence
  // from the tab order.
  await summary.focus();
  await expect(page.locator("that-tooltip", { hasText: "Short one" })).toBeHidden();
});

const longFailure =
  "The Jira site could not be reached because the gateway timed out after three retries " +
  "against every configured endpoint for this instance";

test("a cut failure note on a pinned row shows its full text on hover", async ({ page }) => {
  // One configured instance with nothing assigned — an empty instances array
  // hides the Pinned card entirely (pins.spec.ts's own "no instances
  // configured hides the pinned card" test), which is not what this test is
  // about.
  await stubIssues(page, [group(1, "Work", [])]);
  await stubPinWithError(page, "Weekly standup", longFailure);
  await page.goto("/today");
  await page.getByText(longFailure, { exact: true }).first().hover();
  const tip = page.locator("that-tooltip", { hasText: longFailure });
  await expect(tip).toBeVisible();
});

// #236: the note is its own Tab stop, reached from the summary above it.
test("a cut failure note is its own Tab stop and opens only its own tooltip", async ({ page }) => {
  await stubIssues(page, [group(1, "Work", [])]);
  await stubPinWithError(page, "Weekly standup", longFailure);
  await page.goto("/today");

  const row = page.locator('that-ticket-row[key="WORK-1"]');
  const summary = row.locator('[id^="that-sum-"]');
  const note = row.locator('[id^="that-fail-"]');
  await tabTo(page, summary, note);

  const visible = page.locator("that-tooltip:visible");
  await expect(visible).toHaveCount(1);
  await expect(visible).toHaveText(longFailure);

  await page.keyboard.press("Shift+Tab");
  await expect(summary).toBeFocused();
  await expect(page.locator("that-tooltip", { hasText: longFailure })).toBeHidden();
});

test("a failure note that is not cut is still a Tab stop and opens nothing", async ({ page }) => {
  await stubIssues(page, [group(1, "Work", [])]);
  await stubPinWithError(page, "Weekly standup", "Offline");
  await page.goto("/today");

  const row = page.locator('that-ticket-row[key="WORK-1"]');
  await tabTo(page, row.locator('[id^="that-sum-"]'), row.locator('[id^="that-fail-"]'));
  await expect(page.locator("that-tooltip:visible")).toHaveCount(0);
});

// The key link's focus opens only the key's own "open in Jira": the summary
// and the failure note are Tab stops of their own (#143 task 9, #236), each
// opening its tooltip on its own focus. Both are cut here, so the only thing
// that could open them on the key's focus is wiring that must not exist.
test("focusing a pinned row's key link shows only the key's own tooltip, neither the summary's nor the failure note's", async ({
  page,
}) => {
  await stubIssues(page, [group(1, "Work", [])]);
  await stubPinWithError(page, longSummary, longFailure);
  await page.goto("/today");

  const key = page.getByRole("link", { name: "WORK-1" });
  const row = page.locator('that-ticket-row[key="WORK-1"]');
  const summary = row.locator('[id^="that-sum-"]');
  // #217: reach the key by a real Shift+Tab from the summary right after it
  // in DOM order, never by focusing the key itself — it is the element under
  // test.
  await summary.focus();
  await page.mouse.move(0, 0);
  await page.keyboard.press("Shift+Tab");
  await expect(key).toBeFocused();
  await expect(page.locator("that-tooltip", { hasText: "open in Jira" })).toBeVisible();
  await expect(page.locator("that-tooltip", { hasText: longSummary })).toBeHidden();
  await expect(page.locator("that-tooltip", { hasText: longFailure })).toBeHidden();
});

// The rail and the entry dialog give their cut text back too (#143).

const longInstanceName =
  "Ridgeline Analytics and Reporting Platform for the Quarterly Capacity and Utilisation Programme";

function stubEntries(page: Page, entries: Record<string, unknown>[]): Promise<void> {
  return page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 200, json: { today: "2026-09-09", entries } }),
  );
}

function railEntry(instanceName: string): Record<string, unknown> {
  return {
    id: 1,
    instanceId: 1,
    instanceName,
    instancePosition: 0,
    issueKey: "WORK-1",
    day: "2026-09-09",
    startedAt: "2026-09-09T09:00:00+02:00",
    seconds: 3600,
    comment: "",
    pushState: "unpushed",
  };
}

test("a cut rail instance name shows its full text on hover", async ({ page }) => {
  await stubIssues(page, [group(1, "Work", [])]);
  await stubEntries(page, [railEntry(longInstanceName)]);
  await page.goto("/today");
  await page.getByText(longInstanceName, { exact: true }).first().hover();
  await expect(page.locator("that-tooltip", { hasText: longInstanceName })).toBeVisible();
});

// #236: the settings cog is the rail's last Tab stop before the split — the
// period label and the total between them are not focusable.
test("a cut rail instance name is its own Tab stop and opens only its own tooltip", async ({
  page,
}) => {
  await stubIssues(page, [group(1, "Work", [])]);
  await stubEntries(page, [railEntry(longInstanceName)]);
  await page.goto("/today");

  const name = page.locator('#rail-split [id^="that-rail-name-"]').first();
  await tabTo(page, page.locator("#settings-cog"), name);

  const visible = page.locator("that-tooltip:visible");
  await expect(visible).toHaveCount(1);
  await expect(visible).toHaveText(longInstanceName);
});

test("a rail instance name that is not cut is still a Tab stop and opens nothing", async ({
  page,
}) => {
  await stubIssues(page, [group(1, "Work", [])]);
  await stubEntries(page, [railEntry("Work")]);
  await page.goto("/today");

  const name = page.locator('#rail-split [id^="that-rail-name-"]').first();
  await tabTo(page, page.locator("#settings-cog"), name);
  await expect(page.locator("that-tooltip:visible")).toHaveCount(0);
});

// Measured against the real rail width (216px column, 100px left for the key
// once the dot, the elapsed figure and the stop button take their share):
// even a realistic Jira key like this one already overflows it, so this is
// not a hypothetical case worth skipping.
//
// Task 9 (#143), folding in #235: the key span is its own tab stop now, and
// the stop button carries its own "stop timer" tooltip rather than sharing
// the key's — so each control's focus opens only its own tooltip, never a
// neighbour's.
test("the rail's running key and stop button each open only their own tooltip on focus", async ({
  page,
}) => {
  await stubIssues(page, [group(1, "Work", [])]);
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
  await page.route("**/api/timer", (route) =>
    route.fulfill({
      status: 200,
      json: {
        running: {
          instanceId: 1,
          issueKey: "RIDGELINE-4929",
          startedAt: new Date(Date.now() - 60_000).toISOString(),
        },
        stopped: null,
      },
    }),
  );
  await page.goto("/today");

  const railTimer = page.locator("#rail-timer");
  // .first(): the key's own tooltip carries the same text too, hidden.
  await railTimer.getByText("RIDGELINE-4929", { exact: true }).first().focus();
  await expect(page.locator("that-tooltip", { hasText: "RIDGELINE-4929" })).toBeVisible();
  await expect(page.locator("that-tooltip", { hasText: "stop timer" })).toBeHidden();

  await railTimer.getByRole("button", { name: "stop timer" }).focus();
  await expect(page.locator("that-tooltip", { hasText: "stop timer" })).toBeVisible();
  await expect(page.locator("that-tooltip", { hasText: "RIDGELINE-4929" })).toBeHidden();
});

function openDialog(page: Page): Promise<void> {
  return page.getByRole("button", { name: /Log time against WORK-1/ }).click();
}

test("a cut dialog instance name shows its full text on hover", async ({ page }) => {
  await stubIssues(page, [group(1, longInstanceName, [issue("WORK-1", "Ship it")])]);
  await stubEntries(page, []);
  await page.goto("/today");
  await openDialog(page);
  // Scoped to the dialog: Today's own card heading carries the same instance
  // name behind the modal overlay, and a bare getByText would resolve there.
  await page
    .locator("that-entry-dialog")
    .getByText(longInstanceName, { exact: true })
    .first()
    .hover();
  await expect(page.locator("that-tooltip", { hasText: longInstanceName })).toBeVisible();
});

const longComment =
  "Rewrote the ingestion pipeline's retry logic so a transient Jira timeout no longer drops " +
  "the whole day's sync silently, and added a metrics counter so an operator watching the " +
  "dashboard can see a retry happening in real time instead of guessing from the logs alone";

function dialogEntry(id: number, comment: string): Record<string, unknown> {
  return {
    id,
    instanceId: 1,
    instanceName: "Work",
    instancePosition: 0,
    issueKey: "WORK-1",
    day: "2026-09-09",
    startedAt: "2026-09-09T09:15:00+02:00",
    seconds: 3600,
    comment,
    pushState: "unpushed",
  };
}

function dialogRows(page: Page): Locator {
  return page.locator("that-entry-dialog li");
}

function commentOf(row: Locator): Locator {
  return row.locator('[id^="that-entry-comment-"]');
}

// A guard, not a new behaviour: Close is what showModal() focuses today. The
// instance name sits before it in tree order, so once the name is a Tab stop
// only Close's autofocus keeps it that way (#236).
test("opening the entry dialog by keyboard focuses Close", async ({ page }) => {
  await stubIssues(page, [group(1, longInstanceName, [issue("WORK-1", "Ship it")])]);
  await stubEntries(page, [dialogEntry(1, longComment)]);
  await page.goto("/today");
  await page.getByRole("button", { name: /Log time against WORK-1/ }).focus();
  await page.mouse.move(0, 0);
  await page.keyboard.press("Enter");

  await expect(page.locator("that-entry-dialog").getByRole("button", { name: "Close" })).toBeFocused();
  await expect(page.locator("that-tooltip:visible")).toHaveCount(0);
});

test("focusing an entry's Edit opens only its own tooltip, never the comment's", async ({ page }) => {
  await stubIssues(page, [group(1, "Work", [issue("WORK-1", "Ship it")])]);
  await stubEntries(page, [dialogEntry(1, longComment)]);
  await page.goto("/today");
  await openDialog(page);

  const row = dialogRows(page).nth(0);
  // The push mark is the Tab stop just before Edit.
  await tabTo(page, row.locator('[id^="that-entry-mark-"]'), row.getByRole("button", { name: /Edit the/ }));

  const visible = page.locator("that-tooltip:visible");
  await expect(visible).toHaveCount(1);
  await expect(visible).toHaveText("edit entry");
});

test("a cut entry comment is its own Tab stop and opens its full text on focus and on hover", async ({
  page,
}) => {
  await stubIssues(page, [group(1, "Work", [issue("WORK-1", "Ship it")])]);
  await stubEntries(page, [dialogEntry(1, longComment)]);
  await page.goto("/today");
  await openDialog(page);

  const dialog = page.locator("that-entry-dialog");
  // Nothing focusable sits between Close and the first row's comment.
  await tabTo(page, dialog.getByRole("button", { name: "Close" }), commentOf(dialogRows(page).nth(0)));
  const visible = page.locator("that-tooltip:visible");
  await expect(visible).toHaveCount(1);
  await expect(visible).toHaveText(longComment);

  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("that-tooltip:visible")).toHaveCount(0);
  await commentOf(dialogRows(page).nth(0)).hover();
  await expect(page.locator("that-tooltip", { hasText: longComment })).toBeVisible();
});

test("a short comment and \"No comment\" are Tab stops that open nothing", async ({ page }) => {
  await stubIssues(page, [group(1, "Work", [issue("WORK-1", "Ship it")])]);
  await stubEntries(page, [dialogEntry(1, "Quick fix"), dialogEntry(2, "")]);
  await page.goto("/today");
  await openDialog(page);

  const dialog = page.locator("that-entry-dialog");
  const rows = dialogRows(page);
  await tabTo(page, dialog.getByRole("button", { name: "Close" }), commentOf(rows.nth(0)));
  await expect(page.locator("that-tooltip:visible")).toHaveCount(0);

  // The row above's Delete is the Tab stop just before the next comment.
  await tabTo(page, rows.nth(0).getByRole("button", { name: /Delete the/ }), commentOf(rows.nth(1)));
  await expect(commentOf(rows.nth(1))).toHaveText("No comment");
  await expect(page.locator("that-tooltip:visible")).toHaveCount(0);
});

// The instance name is the dialog's first Tab stop, so the one real key that
// reaches it is Shift+Tab from Close (#217's rule, run backwards).
test("a cut dialog instance name is its own Tab stop and opens only its own tooltip", async ({
  page,
}) => {
  await stubIssues(page, [group(1, longInstanceName, [issue("WORK-1", "Ship it")])]);
  await stubEntries(page, []);
  await page.goto("/today");
  await openDialog(page);

  const dialog = page.locator("that-entry-dialog");
  await dialog.getByRole("button", { name: "Close" }).focus();
  await page.mouse.move(0, 0);
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.locator('[id^="that-entry-dialog-instance-"]')).toBeFocused();

  const visible = page.locator("that-tooltip:visible");
  await expect(visible).toHaveCount(1);
  await expect(visible).toHaveText(longInstanceName);
});
