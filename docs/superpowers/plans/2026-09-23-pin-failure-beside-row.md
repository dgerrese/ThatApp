# A failed pin is reported beside the row that failed (#109) Implementation Plan

**Date:** 2026-09-23
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a pin or unpin fails, the error alert sits at the top of the section that holds the
ticket's row after the redraw, not always in Pinned.

**Architecture:** One change to `undoOptimisticMark` in `web/src/views/today.ts`. It now takes the
ticket. After the redraw from server truth it finds the ticket's `that-ticket-row` by `instance-id`
and `key` in the two regions that hold rows (`regions.layoutGrid`: Pinned and off-list;
`regions.results`: the instance cards). The alert goes directly before that row's `that-table`. With
no row, it goes at the top of `regions.pinnedList`, as today. A row in Pinned lands in the same
place either way, so an unpin is unchanged. The search panel builds its own rows (not
`that-ticket-row`) and sits in `assignedSection`'s header, outside both regions, so it is never
matched.

**Tech Stack:** TypeScript (strict), Playwright e2e in `.claude/e2e/tests/pins.spec.ts`.

**Spec:** Codeberg issue #109, refined with the owner on 2026-09-23 (the placement rule is settled
there). The design of record does not reach this level.

## The drawing

The prototype (`docs/superpowers/prototypes/2026-09-03-app-prototype.html`) draws no failed pin.
The ticket settles where the alert goes: "the same `alertFor("error", …)` Pinned uses today, placed
above the section's table". The visual language spec
(`docs/superpowers/specs/2026-09-03-visual-language-design.md`, the `that-alert` rows near line 369)
settles how it looks, and this ticket must not change that. What gets compared: the alert in an
instance section and in the off-list section must look like the Pinned one does today. Same
element, same position relative to the heading and the table.

## Global Constraints

- Docker only: run everything through `make` or `docker compose`; never `go`, `node` or `npm` bare.
- TypeScript `strict` + `noUncheckedIndexedAccess`; no `any`, `as any` or non-null assertions in `web/src`.
- Light DOM `that-*` components; no frameworks.
- Browsers: Firefox and Chromium. No WebKit.
- The unit suite has no DOM, so every test here is e2e.
- Few comments: only a non-obvious "why".
- No change to how the alert looks; no alert inside the search panel (both out of scope).

## Running a single e2e file

```shell
docker compose --profile e2e rm --stop --force app-e2e
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/pins.spec.ts -g "a failed"'
docker compose --profile e2e rm --stop --force app-e2e
```

The rig starts its own disposable `app-e2e`, so no `make up` is needed. Leave the dev stack
(`thatapp-web-1`) alone.

---

### Task 1: The alert goes above the table holding the ticket's row

**Files:**
- Modify: `web/src/views/today.ts` (`pinTicket`, `unpinTicket`, `undoOptimisticMark`, plus one new helper)
- Test: `.claude/e2e/tests/pins.spec.ts` (a new `test.describe` appended at the end of the file)

- [ ] **Step 1: Write the four failing e2e tests**

Append to `.claude/e2e/tests/pins.spec.ts`. It reuses the file's `pin`, `stubPins`, `stubIssues`,
`stubSearch` and `sharedHit`, all defined above. The file's `beforeEach` stubs `/api/entries` with
no entries. A route registered later in a test takes precedence, which is how the off-list test
overrides it.

```ts
/**
 * #109: a failed pin or unpin reports at the top of whichever section holds
 * the ticket's row once the lists are redrawn from server truth. Pinned only
 * gets the report when the row is there (an unpin) or nowhere (a pin pressed
 * in the search panel).
 */
test.describe("a failed pin reports beside its row", () => {
  const failure = { code: "jira_error", message: "Jira did not take the pin." };

  async function failPinRequests(page: Page): Promise<void> {
    await page.route("**/api/pins**", async (route) => {
      if (route.request().method() === "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({ status: 502, json: failure });
    });
  }

  const pinned = (page: Page) => page.locator('section[aria-labelledby="today-pinned"]');
  const instance = (page: Page) => page.locator('section[aria-labelledby="today-instance-1"]');
  const offList = (page: Page) => page.locator('section[aria-labelledby="today-offlist"]');

  test("a pin that fails on an instance row reports at the top of that instance section", async ({
    page,
  }) => {
    await stubPins(page, []);
    await stubIssues(page, [
      {
        id: 1,
        name: "Ridgeline",
        error: null,
        issues: [
          {
            key: "RIDGE-7",
            summary: "Rotate the staging certificates",
            status: "To Do",
            url: "https://example.atlassian.net/browse/RIDGE-7",
          },
        ],
      },
    ]);
    await failPinRequests(page);

    await page.goto("/today");
    await page.getByRole("button", { name: "Pin RIDGE-7", exact: true }).click();

    await expect(instance(page).locator("that-alert + that-table")).toHaveCount(1);
    await expect(instance(page).locator("that-alert")).toHaveText(failure.message);
    await expect(pinned(page).locator("that-alert")).toHaveCount(0);
    await expect(instance(page).getByRole("button", { name: "Pin RIDGE-7", exact: true })).toBeVisible();
  });

  test("a pin that fails on an off-list row reports at the top of the off-list section", async ({
    page,
  }) => {
    await stubPins(page, []);
    await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
    await page.route("**/api/entries**", (route) =>
      route.fulfill({
        status: 200,
        json: {
          today: "2026-08-31",
          entries: [
            {
              id: 1,
              instanceId: 1,
              instanceName: "Ridgeline",
              instancePosition: 0,
              issueKey: "SHARED-40",
              day: "2026-08-31",
              startedAt: "2026-08-31T09:00:00+02:00",
              seconds: 1800,
              comment: "",
              pushState: "unpushed",
            },
          ],
        },
      }),
    );
    await stubSearch(page, [sharedHit]);
    await failPinRequests(page);

    await page.goto("/today");
    await expect(offList(page).getByText("Vendor security review")).toBeVisible();
    await page.getByRole("button", { name: "Pin SHARED-40", exact: true }).click();

    await expect(offList(page).locator("that-alert + that-table")).toHaveCount(1);
    await expect(offList(page).locator("that-alert")).toHaveText(failure.message);
    await expect(pinned(page).locator("that-alert")).toHaveCount(0);
    await expect(offList(page).getByRole("button", { name: "Pin SHARED-40", exact: true })).toBeVisible();
  });

  test("an unpin that fails reports at the top of Pinned", async ({ page }) => {
    await stubPins(page, [pin(1, "Ridgeline", "SHARED-12", "Weekly standup")]);
    await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
    await failPinRequests(page);

    await page.goto("/today");
    await page.getByRole("button", { name: "Unpin SHARED-12", exact: true }).click();

    await expect(pinned(page).locator("that-alert + that-table")).toHaveCount(1);
    await expect(pinned(page).locator("that-alert")).toHaveText(failure.message);
    await expect(instance(page).locator("that-alert")).toHaveCount(0);
    await expect(pinned(page).getByRole("button", { name: "Unpin SHARED-12", exact: true })).toBeVisible();
  });

  test("a pin that fails from the search panel, for an issue with no row, reports in Pinned", async ({
    page,
  }) => {
    await stubPins(page, []);
    await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
    await stubSearch(page, [sharedHit]);
    await failPinRequests(page);

    await page.goto("/today");
    await page.getByRole("textbox", { name: "Search all instances" }).fill("vendor");
    await page.getByRole("button", { name: "Pin SHARED-40", exact: true }).click();

    await expect(pinned(page).locator("that-alert")).toHaveText(failure.message);
    await expect(instance(page).locator("that-alert")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Pin SHARED-40", exact: true })).toBeVisible();
  });
});
```

Before relying on them, confirm these fixture facts by reading the code, and adjust the test (not
the product) if one is wrong. Report any adjustment:
- `PINNED_HEADING_ID` in `today.ts` is `"today-pinned"`. The off-list id is `"today-offlist"` (line 113).
- An empty Pinned list renders `cardHolding(...)`, not a `that-table`. So the search-panel test does
  not assert `that-alert + that-table` for Pinned.
- The search panel may close when focus leaves it. The last assertion of the search test only needs
  *some* `Pin SHARED-40` control visible. If the panel closes after the click, re-open it by
  re-filling the search box, then assert on its control.

- [ ] **Step 2: Run them and confirm the expected failures (RED)**

Run the single-file command above. Expected: the instance and off-list tests fail (the alert is in
Pinned, not in their section). The unpin and search tests already pass, because they describe
today's behaviour, which must survive. Paste the failing output into the task report.

- [ ] **Step 3: Implement**

In `web/src/views/today.ts`, pass the ticket through both callers:

```ts
    undoOptimisticMark(regions, ticket, error);
```

(once in `pinTicket`, once in `unpinTicket`).

Replace `undoOptimisticMark` and its doc comment with:

```ts
/**
 * Redraws both lists from what the server last said, so a row whose pin
 * control flipped optimistically stops claiming a change that never happened,
 * then names the failure above the table holding the ticket's row. The redraw
 * is server truth, so that is wherever the failed action left the row. A
 * ticket with no row on the page (a pin pressed in the search panel) reports
 * in Pinned. The alert goes in after the redraw because the redraw is what
 * would otherwise wipe it.
 */
function undoOptimisticMark(regions: Regions, ticket: EntryTicket, error: unknown): void {
  renderPinnedList(regions, regions.pins);
  if (regions.lastIssues) {
    renderResponse(regions, regions.lastIssues);
  } else {
    // Same reasoning as refreshPins' own branch: renderResponse would
    // otherwise be what redraws this, but a pin control can be pressed
    // before the assigned response has ever arrived.
    renderOffListSection(regions);
  }

  const alert = alertFor("error", messageOf(error));
  const table = ticketRowOf(regions, ticket)?.closest("that-table");
  if (table) {
    table.before(alert);
  } else {
    regions.pinnedList.prepend(alert);
  }
}

/** The ticket's row in Pinned, the off-list section or an instance card. The
 *  search panel's results are not that-ticket-rows and live outside both
 *  regions, so they never match. */
function ticketRowOf(regions: Regions, ticket: EntryTicket): Element | undefined {
  const rows = [
    ...regions.layoutGrid.querySelectorAll("that-ticket-row"),
    ...regions.results.querySelectorAll("that-ticket-row"),
  ];

  return rows.find(
    (row) =>
      row.getAttribute("instance-id") === String(ticket.instanceId) &&
      row.getAttribute("key") === ticket.issueKey,
  );
}
```

- [ ] **Step 4: Run the four tests again (GREEN)**

Same command. Expected: 4 passed per browser project. Paste the output.

- [ ] **Step 5: Run the gates**

```shell
make fmt       # then `git checkout --` any file it reformatted that this task did not change
make verify
make test-e2e
```

All green. Paste the tails.

- [ ] **Step 6: Commit**

```shell
git add web/src/views/today.ts .claude/e2e/tests/pins.spec.ts
git commit -m "[#109] A failed pin reports at the top of the section holding its row"
```

If signing fails because the 1Password vault is locked, retry with
`git -c commit.gpgsign=false commit …` and say so. Never push.
