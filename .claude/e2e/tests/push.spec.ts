import { expect, test, type Page } from "@playwright/test";

/**
 * The colour a Tailwind utility class actually resolves to in this browser,
 * read off a throwaway probe rather than a literal `oklch()` string in this
 * file — so the assertion tracks web/src/styles.css itself and cannot drift
 * from it the way index.html's classes once did.
 */
async function computedColor(
  page: Page,
  className: string,
  property: "color" | "backgroundColor",
): Promise<string> {
  return page.evaluate(
    ({ className, property }) => {
      const probe = document.createElement("span");
      probe.className = className;
      document.body.appendChild(probe);
      const value = getComputedStyle(probe)[property];
      probe.remove();

      return value;
    },
    { className, property },
  );
}

/** The three mutually-exclusive states #rail-unpushed's colour can be in — read
 *  back rather than asserted against the full class attribute, so the test
 *  doesn't care what order classList happens to leave the other, static
 *  classes in. */
async function unpushedStateClasses(page: Page): Promise<string[]> {
  return page.locator("#rail-unpushed").evaluate((el) =>
    [...el.classList].filter(
      (name) => name === "text-rail-muted" || name === "text-pending-rail" || name === "text-failed-rail",
    ),
  );
}

async function stubToday(
  page: Page,
  entries: Array<{ id: number; issueKey: string; pushState: "unpushed" | "pushed" | "dirty" }>,
): Promise<void> {
  await page.route("**/api/instances", (route) => route.fulfill({ status: 200, json: [] }));
  await page.route("**/api/issues", (route) =>
    route.fulfill({ status: 200, json: { instances: [{ id: 1, name: "Site", issues: [], error: null }] } }),
  );
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
  await page.route("**/api/entries**", (route) =>
    route.fulfill({
      status: 200,
      json: {
        today: "2026-08-31",
        entries: entries.map((entry) => ({
          ...entry,
          instanceId: 1,
          instanceName: "Site",
          instancePosition: 0,
          day: "2026-08-31",
          startedAt: "2026-08-31T09:00:00Z",
          seconds: 1800,
          comment: "",
        })),
      },
    }),
  );
}

/**
 * Proves the partial-failure case survives end to end: the failed entry is
 * named with its own reason, and the succeeded one is not swept in among the
 * failures. A count alone ("1 of 2 failed") would pass a test that only
 * checked the summary — the point of this spec is the per-entry list beside
 * it, matching the style of .claude/e2e/tests/entries.spec.ts.
 */
test("a push where one entry fails names the entry that did not make it", async ({ page }) => {
  await page.route("**/api/instances", (route) => route.fulfill({ status: 200, json: [] }));
  // At least one instance, or Today hides the header (and the Push button
  // with it) and shows "No Jira instances yet" instead — see
  // renderResponse in web/src/views/today.ts.
  await page.route("**/api/issues", (route) =>
    route.fulfill({ status: 200, json: { instances: [{ id: 1, name: "Site", issues: [], error: null }] } }),
  );
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));

  await page.route("**/api/entries**", (route) =>
    route.fulfill({
      status: 200,
      json: {
        today: "2026-08-31",
        entries: [
          {
            id: 1, instanceId: 1, instanceName: "Site", instancePosition: 0,
            issueKey: "RIDGE-1", day: "2026-08-31", startedAt: "2026-08-31T09:00:00Z",
            seconds: 3600, comment: "one", pushState: "unpushed",
          },
          {
            id: 2, instanceId: 1, instanceName: "Site", instancePosition: 0,
            issueKey: "RIDGE-2", day: "2026-08-31", startedAt: "2026-08-31T10:00:00Z",
            seconds: 1800, comment: "two", pushState: "unpushed",
          },
        ],
      },
    }),
  );

  await page.route("**/api/push**", (route) =>
    route.fulfill({
      status: 200,
      json: {
        day: "2026-08-31",
        results: [
          { entryId: 1, issueKey: "RIDGE-1", instanceId: 1, status: "pushed", worklogId: "wl-1" },
          {
            entryId: 2, issueKey: "RIDGE-2", instanceId: 1, status: "failed",
            error: { code: "instance_unreachable", message: "the Jira site could not be reached" },
          },
        ],
      },
    }),
  );

  await page.goto("/today");
  // The rail owns the only "Push worklogs" button — see web/src/rail.ts — so an
  // unscoped role query is unambiguous.
  await page.getByRole("button", { name: "Push worklogs" }).click();

  // The confirmation names what is about to be sent.
  await expect(page.getByText(/2 entries totalling/)).toBeVisible();
  await page.getByRole("button", { name: "Push", exact: true }).click();

  // The failure is named per entry, not summarised away.
  await expect(page.locator("that-toasts").getByText(/1 of 2 entries could not be pushed/)).toBeVisible();
  await expect(page.locator("that-toasts").getByText(/RIDGE-2 — the Jira site could not be reached/)).toBeVisible();
  await expect(page.locator("that-toasts").getByText("RIDGE-1 —")).toHaveCount(0);
  // #123: the report is a toast, but the rail's own count line stays a line of the rail.
  await expect(page.locator("#rail-unpushed")).toHaveText(/entr(y|ies) to push/);
});

test("each line of a push report is its own toast", async ({ page }) => {
  await stubToday(page, [
    { id: 1, issueKey: "RIDGE-1", pushState: "unpushed" },
    { id: 2, issueKey: "RIDGE-2", pushState: "unpushed" },
  ]);
  await page.route("**/api/push**", (route) =>
    route.fulfill({
      status: 200,
      json: {
        day: "2026-08-31",
        results: [
          {
            entryId: 1, issueKey: "RIDGE-1", instanceId: 1, status: "failed",
            error: { code: "instance_unreachable", message: "the Jira site could not be reached" },
          },
          {
            entryId: 2, issueKey: "RIDGE-2", instanceId: 1, status: "failed",
            error: { code: "store_failed", message: "disk full" },
          },
        ],
      },
    }),
  );

  await page.goto("/today");
  await page.getByRole("button", { name: "Push worklogs" }).click();
  await page.getByRole("button", { name: "Push", exact: true }).click();

  const toasts = page.locator("that-toasts that-toast");
  await expect(toasts).toHaveCount(2);
  const warning = page.locator("that-toasts that-toast[tone='warning']");
  const error = page.locator("that-toasts that-toast[tone='error']");
  await expect(warning.locator("li")).toHaveText(["RIDGE-1 — the Jira site could not be reached"]);
  await expect(error.locator("li")).toHaveText(["RIDGE-2"]);
});

test("the confirmation does not claim a correction will be created", async ({ page }) => {
  await stubToday(page, [
    { id: 1, issueKey: "RIDGE-1", pushState: "unpushed" },
    { id: 2, issueKey: "RIDGE-2", pushState: "dirty" },
  ]);

  await page.goto("/today");
  await page.getByRole("button", { name: "Push worklogs" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("2 entries totalling 1h 00m will be sent to 1 site.");
  await expect(dialog).not.toContainText("created");
});

test("a pending queue paints the unpushed count amber and Push live", async ({ page }) => {
  await stubToday(page, [{ id: 1, issueKey: "RIDGE-1", pushState: "unpushed" }]);

  await page.goto("/today");
  const unpushed = page.locator("#rail-unpushed");
  const push = page.getByRole("button", { name: "Push worklogs" });

  await expect(unpushed).toHaveText(/entry to push/);
  await expect(unpushed).toHaveCSS("color", await computedColor(page, "text-pending-rail", "color"));
  await expect(push).toBeEnabled();
  await expect(push).toHaveCSS(
    "background-color",
    await computedColor(page, "bg-primary-rail", "backgroundColor"),
  );
});

test("a push that cannot recheck what's pending leaves the rail failed alone, not failed and pending", async ({
  page,
}) => {
  await stubToday(page, [{ id: 1, issueKey: "RIDGE-1", pushState: "unpushed" }]);

  await page.goto("/today");
  const unpushed = page.locator("#rail-unpushed");
  await expect(unpushed).toHaveText(/entry to push/);
  await expect.poll(() => unpushedStateClasses(page)).toEqual(["text-pending-rail"]);

  // Overrides the route above: handlePush re-checks what's pending before
  // confirming (see web/src/rail.ts), and this is the request that fails.
  await page.route("**/api/entries**", (route) =>
    route.fulfill({ status: 500, json: { error: { code: "internal", message: "boom" } } }),
  );
  await page.getByRole("button", { name: "Push worklogs" }).click();

  await expect(unpushed).toHaveText("Could not check what's pending — press Push worklogs to retry.");
  // #123: the rail's own line carries this failure, never a toast.
  await expect(page.locator("that-toast")).toHaveCount(0);
  // Both writers used to only remove their own idea of what might be on the
  // element, so a failure while the queue was non-empty left text-pending-rail
  // and text-failed-rail on it together — whichever token's declared later in
  // styles.css happened to win the cascade. Exactly one state now, always.
  await expect.poll(() => unpushedStateClasses(page)).toEqual(["text-failed-rail"]);
});

test("a day whose only stale entry is a correction still offers a push", async ({ page }) => {
  await stubToday(page, [{ id: 1, issueKey: "RIDGE-1", pushState: "dirty" }]);

  await page.goto("/today");
  const unpushed = page.locator("#rail-unpushed");

  await expect(unpushed).toHaveText("1 entry to push");
  await expect(unpushed).toHaveCSS("color", await computedColor(page, "text-pending-rail", "color"));
  await expect(page.getByRole("button", { name: "Push worklogs" })).toBeEnabled();
});

test("pressing Push on a corrected-only day sends the correction and the rail returns to muted", async ({
  page,
}) => {
  await stubToday(page, [{ id: 1, issueKey: "RIDGE-1", pushState: "dirty" }]);

  let pushAnswered = false;
  await page.route("**/api/push**", async (route) => {
    pushAnswered = true;
    await route.fulfill({
      status: 200,
      json: {
        day: "2026-08-31",
        results: [{ entryId: 1, issueKey: "RIDGE-1", instanceId: 1, status: "pushed", worklogId: "wl-1" }],
      },
    });
  });

  // Overrides stubToday's blanket handler once the push has answered, so the
  // rail's own boot read — which is what makes the correction pending in the
  // first place — still sees pushState "dirty" beforehand.
  await page.route("**/api/entries**", async (route) => {
    if (!pushAnswered) {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      json: {
        today: "2026-08-31",
        entries: [
          {
            id: 1, instanceId: 1, instanceName: "Site", instancePosition: 0,
            issueKey: "RIDGE-1", day: "2026-08-31", startedAt: "2026-08-31T09:00:00Z",
            seconds: 1800, comment: "", pushState: "pushed",
          },
        ],
      },
    });
  });

  await page.goto("/today");
  const unpushed = page.locator("#rail-unpushed");
  await expect(unpushed).toHaveText("1 entry to push");

  await page.getByRole("button", { name: "Push worklogs" }).click();
  await page.getByRole("button", { name: "Push", exact: true }).click();

  await expect(unpushed).toHaveText("Nothing to push");
  await expect(unpushed).toHaveCSS("color", await computedColor(page, "text-rail-muted", "color"));
});

test("the count covers never-pushed and corrected entries as one number", async ({ page }) => {
  await stubToday(page, [
    { id: 1, issueKey: "RIDGE-1", pushState: "unpushed" },
    { id: 2, issueKey: "RIDGE-2", pushState: "dirty" },
    { id: 3, issueKey: "RIDGE-3", pushState: "pushed" },
    { id: 4, issueKey: "RIDGE-4", pushState: "pushed" },
  ]);

  await page.goto("/today");
  const unpushed = page.locator("#rail-unpushed");

  await expect(unpushed).toHaveText("2 entries to push");
  await expect(unpushed).toHaveCSS("color", await computedColor(page, "text-pending-rail", "color"));
  await expect(page.getByRole("button", { name: "Push worklogs" })).toBeEnabled();
});

test("a day whose entries are all pushed offers nothing", async ({ page }) => {
  await stubToday(page, [{ id: 1, issueKey: "RIDGE-1", pushState: "pushed" }]);

  await page.goto("/today");
  const unpushed = page.locator("#rail-unpushed");

  await expect(unpushed).toHaveText("Nothing to push");
  await expect(unpushed).toHaveCSS("color", await computedColor(page, "text-rail-muted", "color"));
  await expect(page.getByRole("button", { name: "Push worklogs" })).toBeDisabled();
});

test("an empty queue leaves the unpushed count muted and Push resting", async ({ page }) => {
  await stubToday(page, []);

  await page.goto("/today");
  const unpushed = page.locator("#rail-unpushed");
  const push = page.getByRole("button", { name: "Push worklogs" });

  await expect(unpushed).toHaveText("Nothing to push");
  await expect(unpushed).toHaveCSS("color", await computedColor(page, "text-rail-muted", "color"));
  await expect(push).toBeDisabled();
  await expect(push).toHaveCSS(
    "background-color",
    await computedColor(page, "bg-transparent", "backgroundColor"),
  );
});
