import { expect, test, type Page } from "@playwright/test";

// Pinned rows carry #7's duration cell now, and its figure comes from here.
// Stubbed for the same reason the pin and issue routes are: the e2e stack
// shares the dev database.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/entries**", (route) => route.fulfill({ status: 200, json: [] }));
});

interface StubPin {
  id: number;
  instanceId: number;
  instanceName: string;
  instancePosition: number;
  key: string;
  summary: string;
  status: string;
  url: string;
  error: { code: string; message: string } | null;
}

function pin(
  id: number,
  instanceName: string,
  key: string,
  summary: string,
  instancePosition = 0,
): StubPin {
  return {
    id,
    instanceId: id,
    instanceName,
    instancePosition,
    key,
    summary,
    status: "In Progress",
    url: `https://example.atlassian.net/browse/${key}`,
    error: null,
  };
}

/**
 * Stubs /api/pins. The route pattern must not also swallow /api/issues/search,
 * which is why it is anchored with the query-string wildcard rather than a bare
 * suffix.
 *
 * `first` is required rather than folded into the rest parameter: with none at
 * all, `Math.min(calls, responses.length - 1)` would index at -1 and fulfil
 * with `json: undefined`.
 */
async function stubPins(page: Page, first: StubPin[], ...rest: StubPin[][]): Promise<void> {
  const responses = [first, ...rest];
  let calls = 0;

  await page.route("**/api/pins**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    const index = Math.min(calls, responses.length - 1);
    calls += 1;
    await route.fulfill({ status: 200, json: responses[index] });
  });
}

async function stubIssues(page: Page, groups: unknown[]): Promise<void> {
  await page.route("**/api/issues", async (route) => {
    await route.fulfill({ status: 200, json: { instances: groups } });
  });
}

test("pinned issues render above the assigned cards", async ({ page }) => {
  await stubPins(page, [pin(1, "Ridgeline", "SHARED-12", "Weekly standup")]);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);

  await page.goto("/today");

  const card = page.getByRole("region", { name: "Pinned" });
  await expect(card.getByText("SHARED-12")).toBeVisible();
  await expect(card.getByText("Weekly standup")).toBeVisible();
  // A pinned row names its instance by dot alone (accessible via role="img"),
  // not as visible row text — the restyle decision this branch shipped without.
  await expect(card.getByRole("img", { name: "Ridgeline" })).toBeVisible();
  await expect(card.getByText("Ridgeline", { exact: true })).toHaveCount(0);

  // "Above" is a claim about document order, not just co-presence: compare the
  // Pinned card's top edge against the assigned-issues heading's.
  const assignedHeading = page.getByRole("heading", { name: "Assigned issues" });
  const pinnedBox = await card.boundingBox();
  const assignedBox = await assignedHeading.boundingBox();
  expect(pinnedBox).not.toBeNull();
  expect(assignedBox).not.toBeNull();
  expect(pinnedBox!.y).toBeLessThan(assignedBox!.y);
});

// Independent on purpose: the Pinned card must paint from /api/pins alone and
// must not wait on the assigned-issues fan-out, which may be slow or hang.
test("the pinned card paints before the assigned fan-out answers", async ({ page }) => {
  await stubPins(page, [pin(1, "Ridgeline", "SHARED-12", "Weekly standup")]);
  await page.route("**/api/issues", () => {
    // Never fulfilled: the fan-out hangs, and the Pinned card must not.
  });

  await page.goto("/today");

  const card = page.getByRole("region", { name: "Pinned" });
  await expect(card.getByText("SHARED-12")).toBeVisible();
  await expect(page.getByText("Loading…")).toBeVisible();
});

test("an issue that is both pinned and assigned appears once", async ({ page }) => {
  await stubPins(page, [pin(1, "Ridgeline", "SHARED-12", "Weekly standup")]);
  await stubIssues(page, [
    {
      id: 1,
      name: "Ridgeline",
      error: null,
      issues: [
        {
          key: "SHARED-12",
          summary: "Weekly standup",
          status: "In Progress",
          url: "https://example.atlassian.net/browse/SHARED-12",
        },
        {
          key: "WORK-412",
          summary: "Fix the CSV export encoding",
          status: "In Progress",
          url: "https://example.atlassian.net/browse/WORK-412",
        },
      ],
    },
  ]);

  await page.goto("/today");

  // Scoped rather than page-wide: a dedupe that filtered the Pinned section
  // instead of the assigned one would still leave exactly one "SHARED-12" on
  // the page. The spec is that the row survives in Pinned and is removed from
  // Ridgeline's assigned list specifically. Each section is a landmark named
  // by its own heading, which picks the assigned one out unambiguously — the
  // Pinned section also carries "Ridgeline", as the pinned row's dot.
  const pinnedCard = page.getByRole("region", { name: "Pinned" });
  const assignedCard = page.getByRole("region", { name: "Ridgeline" });
  await expect(pinnedCard.getByText("SHARED-12")).toBeVisible();
  await expect(assignedCard.getByText("SHARED-12")).toHaveCount(0);
  await expect(page.getByText("WORK-412")).toHaveCount(1);
});

test("the pinned card renders when every instance fails", async ({ page }) => {
  await stubPins(page, [pin(1, "Ridgeline", "SHARED-12", "Weekly standup")]);
  await stubIssues(page, [
    {
      id: 1,
      name: "Ridgeline",
      issues: [],
      error: { code: "instance_unreachable", message: "the Jira site could not be reached" },
    },
  ]);

  await page.goto("/today");

  await expect(page.getByText("SHARED-12")).toBeVisible();
  await expect(page.getByText("the Jira site could not be reached")).toBeVisible();
});

test("no pins shows nothing pinned", async ({ page }) => {
  await stubPins(page, []);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);

  await page.goto("/today");

  await expect(page.getByText("Nothing pinned.")).toBeVisible();
});

// With no instances there can be no pins either — the cascade took them with the
// last instance — so a Pinned card would be a control with nothing to do.
test("no instances configured hides the pinned card entirely", async ({ page }) => {
  await stubPins(page, []);
  await stubIssues(page, []);

  await page.goto("/today");

  await expect(page.getByText("No Jira instances yet.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Pinned" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pin an issue" })).toHaveCount(0);
});

// A regression that painted every dot the same hue — or the transparent-dot
// trap where --h reads correctly but the background never resolves at all —
// would leave every row identifiable only by luck; reading the resolved paint
// back is what catches both, where a class-based check would pass either way.
test("two pinned instances render two different dot hues", async ({ page }) => {
  await stubPins(page, [
    pin(1, "Ridgeline", "SHARED-12", "Weekly standup", 0),
    pin(2, "Personal", "MISC-3", "Admin overhead", 1),
  ]);
  await stubIssues(page, [
    { id: 1, name: "Ridgeline", issues: [], error: null },
    { id: 2, name: "Personal", issues: [], error: null },
  ]);

  await page.goto("/today");

  const card = page.getByRole("region", { name: "Pinned" });
  const dots = card.getByRole("img");
  await expect(dots).toHaveCount(2);

  // The resolved paint, not --h: the transparent-dot trap
  // (docs/superpowers/specs/2026-08-20-visual-design-language.md's "A trap this
  // system sets") leaves --h reading correctly while every dot renders fully
  // transparent with nothing in the console, and a 7x7 transparent box still
  // has a non-empty bounding box, so toBeVisible would not have caught it either.
  const colors = await dots.evaluateAll((elements) =>
    elements.map((element) => getComputedStyle(element).backgroundColor),
  );

  expect(colors[0]).not.toBe("rgba(0, 0, 0, 0)");
  expect(colors[1]).not.toBe("rgba(0, 0, 0, 0)");
  expect(colors[0]).not.toBe(colors[1]);
});

async function stubSearch(page: Page, results: unknown[], errors: unknown[] = []): Promise<void> {
  await page.route("**/api/issues/search**", async (route) => {
    await route.fulfill({ status: 200, json: { results, errors } });
  });
}

const sharedHit = {
  instanceId: 1,
  instanceName: "Ridgeline",
  instancePosition: 0,
  key: "SHARED-40",
  summary: "Vendor security review",
  status: "To Do",
  url: "https://example.atlassian.net/browse/SHARED-40",
};

// The deliberate divergence from the dot-alone rule: a search result is
// scanned across instances the user has not necessarily seen before, where a
// hue cannot disambiguate, so the name stays beside the dot.
test("a search result shows the instance name and the dot", async ({ page }) => {
  await stubPins(page, []);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
  await stubSearch(page, [sharedHit]);

  await page.goto("/today");
  await page.getByRole("button", { name: "Pin an issue" }).click();
  await page.getByRole("combobox", { name: "Find an issue" }).fill("security");

  const option = page.getByRole("option").first();
  await expect(option.getByRole("img", { name: "Ridgeline" })).toBeVisible();
  await expect(option).toContainText("Ridgeline");
});

test("searching finds issues across instances and pinning one adds it", async ({ page }) => {
  await stubPins(page, [], [pin(9, "Ridgeline", "SHARED-40", "Vendor security review")]);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
  await stubSearch(page, [
    sharedHit,
    {
      instanceId: 2,
      instanceName: "Personal",
      instancePosition: 1,
      key: "MISC-15",
      summary: "Security questionnaire",
      status: "Open",
      url: "https://example.atlassian.net/browse/MISC-15",
    },
  ]);
  await page.route("**/api/pins", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 201,
      json: pin(9, "Ridgeline", "SHARED-40", "Vendor security review"),
    });
  });

  await page.goto("/today");
  await page.getByRole("button", { name: "Pin an issue" }).click();
  await page.getByRole("combobox", { name: "Find an issue" }).fill("security");

  const options = page.getByRole("option");
  await expect(options).toHaveCount(2);
  await expect(options.first()).toContainText("SHARED-40");
  await expect(options.nth(1)).toContainText("Personal");

  await options.first().click();

  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(page.getByText("Vendor security review")).toBeVisible();
});

test("an already pinned issue cannot be chosen", async ({ page }) => {
  await stubPins(page, [pin(1, "Ridgeline", "SHARED-40", "Vendor security review")]);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
  await stubSearch(page, [{ ...sharedHit, instanceId: 1 }]);
  let posted = false;
  await page.route("**/api/pins", async (route) => {
    if (route.request().method() === "POST") {
      posted = true;
    }
    await route.fallback();
  });

  await page.goto("/today");
  await page.getByRole("button", { name: "Pin an issue" }).click();
  await page.getByRole("combobox", { name: "Find an issue" }).fill("security");

  const option = page.getByRole("option").first();
  await expect(option).toContainText("Pinned");
  await expect(option).toBeDisabled();

  // aria-disabled (required so a screen reader still announces "Pinned" rather
  // than skipping the option, unlike a native disabled attribute) does not stop
  // a click event from reaching the DOM the way disabled does — so proving this
  // option "cannot be chosen" needs a behavioural check, not just the visual
  // one above. force: true bypasses Playwright's own actionability wait, which
  // would otherwise refuse to click anything it considers disabled.
  await option.click({ force: true });
  await expect(page.getByRole("option")).toHaveCount(1);
  expect(posted).toBe(false);
});

test("the keyboard pins the highlighted row, not just the first one", async ({ page }) => {
  const secondHit = {
    instanceId: 2,
    instanceName: "Personal",
    instancePosition: 1,
    key: "MISC-15",
    summary: "Security questionnaire",
    status: "Open",
    url: "https://example.atlassian.net/browse/MISC-15",
  };
  await stubPins(page, [], [pin(9, "Personal", "MISC-15", "Security questionnaire")]);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
  await stubSearch(page, [sharedHit, secondHit]);
  await page.route("**/api/pins", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    // Proves Enter acts on the row ↓ moved to, not on whichever row happened
    // to be first: a bug that always chose index 0 would pin SHARED-40 and
    // trip this assertion instead of quietly passing.
    expect(route.request().postDataJSON()).toEqual({ instanceId: 2, issueKey: "MISC-15" });
    await route.fulfill({
      status: 201,
      json: pin(9, "Personal", "MISC-15", "Security questionnaire"),
    });
  });

  await page.goto("/today");
  await page.getByRole("button", { name: "Pin an issue" }).click();
  const box = page.getByRole("combobox", { name: "Find an issue" });
  await box.fill("security");
  await expect(page.getByRole("option")).toHaveCount(2);

  await box.press("ArrowDown");
  await box.press("Enter");

  await expect(page.getByText("Security questionnaire")).toBeVisible();
  await expect(page.getByText("Vendor security review")).toHaveCount(0);
});

test("↑ from the first option wraps to the last", async ({ page }) => {
  const secondHit = {
    instanceId: 2,
    instanceName: "Personal",
    instancePosition: 1,
    key: "MISC-15",
    summary: "Security questionnaire",
    status: "Open",
    url: "https://example.atlassian.net/browse/MISC-15",
  };
  await stubPins(page, [], [pin(9, "Personal", "MISC-15", "Security questionnaire")]);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
  await stubSearch(page, [sharedHit, secondHit]);
  await page.route("**/api/pins", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    // A sign error in the wrap arithmetic would land on index 0 (SHARED-40)
    // instead of wrapping backwards to the last option — this assertion is
    // what would catch that, not the mere fact that Enter picks something.
    expect(route.request().postDataJSON()).toEqual({ instanceId: 2, issueKey: "MISC-15" });
    await route.fulfill({
      status: 201,
      json: pin(9, "Personal", "MISC-15", "Security questionnaire"),
    });
  });

  await page.goto("/today");
  await page.getByRole("button", { name: "Pin an issue" }).click();
  const box = page.getByRole("combobox", { name: "Find an issue" });
  await box.fill("security");
  await expect(page.getByRole("option")).toHaveCount(2);

  await box.press("ArrowUp");
  await box.press("Enter");

  await expect(page.getByText("Security questionnaire")).toBeVisible();
});

test("↓ past the last option wraps to the first", async ({ page }) => {
  const secondHit = {
    instanceId: 2,
    instanceName: "Personal",
    instancePosition: 1,
    key: "MISC-15",
    summary: "Security questionnaire",
    status: "Open",
    url: "https://example.atlassian.net/browse/MISC-15",
  };
  await stubPins(page, [], [pin(9, "Ridgeline", "SHARED-40", "Vendor security review")]);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
  await stubSearch(page, [sharedHit, secondHit]);
  await page.route("**/api/pins", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    // A clamp instead of a wrap (or an off-by-one) would leave the active
    // index on the last option (MISC-15) rather than back at the first.
    expect(route.request().postDataJSON()).toEqual({ instanceId: 1, issueKey: "SHARED-40" });
    await route.fulfill({
      status: 201,
      json: pin(9, "Ridgeline", "SHARED-40", "Vendor security review"),
    });
  });

  await page.goto("/today");
  await page.getByRole("button", { name: "Pin an issue" }).click();
  const box = page.getByRole("combobox", { name: "Find an issue" });
  await box.fill("security");
  await expect(page.getByRole("option")).toHaveCount(2);

  await box.press("ArrowDown");
  await box.press("ArrowDown");
  await box.press("Enter");

  await expect(page.getByText("Vendor security review")).toBeVisible();
});

test("Escape closes the pin form", async ({ page }) => {
  await stubPins(page, []);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);

  await page.goto("/today");
  await page.getByRole("button", { name: "Pin an issue" }).click();
  const box = page.getByRole("combobox", { name: "Find an issue" });
  await expect(box).toBeVisible();

  await box.press("Escape");

  await expect(page.getByRole("combobox", { name: "Find an issue" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pin an issue" })).toBeVisible();
});

// Options are real <button> elements; without tabIndex="-1" on each and a Tab
// branch in onKeyDown, Tab from the input walks into the popup one option at a
// time instead of leaving it — and since aria-activedescendant only means
// anything while focus stays on the input, that silently breaks the pattern.
test("Tab closes the popup and moves focus on, not into an option", async ({ page }) => {
  await stubPins(page, []);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
  await stubSearch(page, [sharedHit]);

  await page.goto("/today");
  await page.getByRole("button", { name: "Pin an issue" }).click();
  const box = page.getByRole("combobox", { name: "Find an issue" });
  await box.fill("security");
  await expect(page.getByRole("option")).toHaveCount(1);

  await box.press("Tab");

  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
});

test("Cancel restores the Pin an issue button", async ({ page }) => {
  await stubPins(page, []);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);

  await page.goto("/today");
  await page.getByRole("button", { name: "Pin an issue" }).click();
  await expect(page.getByRole("combobox", { name: "Find an issue" })).toBeVisible();

  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByRole("combobox", { name: "Find an issue" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pin an issue" })).toBeVisible();
});

// A pending debounce timer that outlives the form closing would fire on a
// detached that-combobox, dispatch that-search anyway, and start an un-abortable
// fan-out the user can no longer see — this is what disconnectedCallback's
// clearTimeout (and close()'s) exists to prevent.
test("Cancel within the debounce window makes no request", async ({ page }) => {
  await stubPins(page, []);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
  let searched = false;
  await page.route("**/api/issues/search**", async (route) => {
    searched = true;
    await route.fulfill({ status: 200, json: { results: [], errors: [] } });
  });

  await page.goto("/today");
  await page.getByRole("button", { name: "Pin an issue" }).click();
  await page.getByRole("combobox", { name: "Find an issue" }).fill("security");
  // Well inside the 350ms debounce window: the timer it started has not fired.
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(500);

  expect(searched).toBe(false);
});

test("rapid keystrokes are coalesced into a single search", async ({ page }) => {
  await stubPins(page, []);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
  let calls = 0;
  await page.route("**/api/issues/search**", async (route) => {
    calls += 1;
    await route.fulfill({ status: 200, json: { results: [sharedHit], errors: [] } });
  });

  await page.goto("/today");
  await page.getByRole("button", { name: "Pin an issue" }).click();
  const box = page.getByRole("combobox", { name: "Find an issue" });

  // Each keystroke is 20ms apart — far under the 350ms debounce — so a correct
  // implementation fires exactly one request after the last one, not one per
  // keystroke.
  await box.pressSequentially("security", { delay: 20 });
  await expect(page.getByRole("option")).toHaveCount(1);

  expect(calls).toBe(1);
});

test("a query under two characters searches nothing", async ({ page }) => {
  await stubPins(page, []);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
  let searched = false;
  await page.route("**/api/issues/search**", async (route) => {
    searched = true;
    await route.fulfill({ status: 200, json: { results: [], errors: [] } });
  });

  await page.goto("/today");
  await page.getByRole("button", { name: "Pin an issue" }).click();
  await page.getByRole("combobox", { name: "Find an issue" }).fill("s");
  await page.waitForTimeout(600);

  expect(searched).toBe(false);
  await expect(page.getByText("Two characters to start.")).toBeVisible();
});

test("a query with no matches says so and names the query back", async ({ page }) => {
  await stubPins(page, []);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
  await stubSearch(page, []);

  await page.goto("/today");
  await page.getByRole("button", { name: "Pin an issue" }).click();
  await page.getByRole("combobox", { name: "Find an issue" }).fill("zzz");

  await expect(page.getByText("No issues match “zzz”.")).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(0);
});

test("every instance failing shows an error rather than an empty list", async ({ page }) => {
  await stubPins(page, []);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
  await stubSearch(page, [], [
    {
      instanceId: 1,
      instanceName: "Ridgeline",
      error: { code: "instance_unreachable", message: "the Jira site could not be reached" },
    },
  ]);

  await page.goto("/today");
  await page.getByRole("button", { name: "Pin an issue" }).click();
  await page.getByRole("combobox", { name: "Find an issue" }).fill("security");

  await expect(page.getByText("the Jira site could not be reached")).toBeVisible();
});

test("an instance that cannot be searched is named beside the results", async ({ page }) => {
  await stubPins(page, []);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
  await stubSearch(page, [sharedHit], [
    {
      instanceId: 2,
      instanceName: "Personal",
      error: { code: "instance_unreachable", message: "the Jira site could not be reached" },
    },
  ]);

  await page.goto("/today");
  await page.getByRole("button", { name: "Pin an issue" }).click();
  await page.getByRole("combobox", { name: "Find an issue" }).fill("security");

  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByText("Personal could not be searched.")).toBeVisible();
});

// A second keystroke aborts the first request's fetch. request()'s bare catch
// in api.ts turns any thrown error, AbortError included, into a user-facing
// "Could not reach the dashboard server." — that guard is what this proves:
// remove it and the superseded first search paints an outage message over a
// second search that is still working correctly.
test("a keystroke that supersedes a slow search never shows a network error", async ({ page }) => {
  await stubPins(page, []);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);

  let calls = 0;
  await page.route("**/api/issues/search**", async (route) => {
    calls += 1;
    const firstCall = calls === 1;
    if (firstCall) {
      // Long enough that the second keystroke's debounce fires and aborts this
      // request well before it would otherwise resolve.
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    await route.fulfill({ status: 200, json: { results: [sharedHit], errors: [] } }).catch(() => {
      // The client already cancelled the underlying network request for the
      // aborted first call; the route has nothing left to fulfil.
    });
  });

  await page.goto("/today");
  await page.getByRole("button", { name: "Pin an issue" }).click();
  const box = page.getByRole("combobox", { name: "Find an issue" });

  await box.fill("se");
  await expect(page.getByText("Searching…")).toBeVisible();
  await box.fill("security");

  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByText("Could not reach the dashboard server.")).toHaveCount(0);
});

test("unpinning removes the row without a reload", async ({ page }) => {
  await stubPins(page, [pin(1, "Ridgeline", "SHARED-12", "Weekly standup")], []);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
  let deleteMethod: string | null = null;
  await page.route("**/api/pins/1", async (route) => {
    deleteMethod = route.request().method();
    await route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/today");
  await expect(page.getByText("SHARED-12")).toBeVisible();
  // A reload would reset this; its survival is what proves the row's removal
  // came from the DOM update, not a fresh page.
  await page.evaluate(() => {
    (window as unknown as { __wd_marker: boolean }).__wd_marker = true;
  });

  await page.getByRole("button", { name: "Unpin" }).click();

  await expect(page.getByText("SHARED-12")).toHaveCount(0);
  await expect(page.getByText("Nothing pinned.")).toBeVisible();
  expect(deleteMethod).toBe("DELETE");
  expect(
    await page.evaluate(() => (window as unknown as { __wd_marker?: boolean }).__wd_marker),
  ).toBe(true);
});

test("refresh updates the pinned card as well as the assigned one", async ({ page }) => {
  await stubPins(
    page,
    [pin(1, "Ridgeline", "SHARED-12", "Weekly standup")],
    [pin(1, "Ridgeline", "SHARED-12", "Renamed standup")],
  );
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);

  await page.goto("/today");
  await expect(page.getByText("Weekly standup")).toBeVisible();

  await page.getByRole("button", { name: "Refresh" }).click();

  await expect(page.getByText("Renamed standup")).toBeVisible();
});

// A test that only watches one request would pass against a button that
// re-enables early — this is the case #6's report specifically calls out —
// so the pins response is held open until the assigned response has already
// resolved, and the button's disabled state is read in between.
test("Refresh disables the button until both the pins and the assigned calls settle", async ({
  page,
}) => {
  let issuesCalls = 0;
  let pinsRefreshCalls = 0;
  let issuesSettled = false;
  let releasePins: (() => void) | undefined;
  const pinsHeld = new Promise<void>((resolve) => {
    releasePins = resolve;
  });

  await page.route("**/api/pins**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    const url = new URL(route.request().url());
    if (url.searchParams.get("refresh") === "1") {
      pinsRefreshCalls += 1;
      await pinsHeld;
      await route.fulfill({
        status: 200,
        json: [pin(1, "Ridgeline", "SHARED-12", "Renamed standup")],
      });
      return;
    }
    await route.fulfill({
      status: 200,
      json: [pin(1, "Ridgeline", "SHARED-12", "Weekly standup")],
    });
  });
  await page.route("**/api/issues", async (route) => {
    issuesCalls += 1;
    await route.fulfill({
      status: 200,
      json: { instances: [{ id: 1, name: "Ridgeline", issues: [], error: null }] },
    });
    issuesSettled = true;
  });

  await page.goto("/today");
  await expect(page.getByText("Weekly standup")).toBeVisible();

  const refresh = page.getByRole("button", { name: "Refresh" });
  await refresh.click();
  await expect(refresh).toBeDisabled();

  // The assigned call has resolved (proven by issuesSettled) while the pins
  // call is still deliberately held open — a button gated on refreshResults
  // alone would already have re-enabled here.
  await expect.poll(() => issuesSettled).toBe(true);
  await expect(refresh).toBeDisabled();

  releasePins?.();

  await expect(page.getByText("Renamed standup")).toBeVisible();
  await expect(refresh).toBeEnabled();
  expect(pinsRefreshCalls).toBe(1);
  // 2, not 1: one for the initial mount's independent fetch, one for Refresh's.
  expect(issuesCalls).toBe(2);
});

test("a pin whose refresh failed keeps its cached values", async ({ page }) => {
  const stale = pin(1, "Ridgeline", "SHARED-12", "Weekly standup");
  const failed = {
    ...stale,
    error: { code: "instance_unreachable", message: "the Jira site could not be reached" },
  };
  await stubPins(page, [stale], [failed]);
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);

  await page.goto("/today");
  await page.getByRole("button", { name: "Refresh" }).click();

  await expect(page.getByText("Weekly standup")).toBeVisible();
  await expect(page.getByText("the Jira site could not be reached")).toBeVisible();
});

test("a Refresh with the pin form open leaves the typed query intact", async ({ page }) => {
  await stubPins(
    page,
    [pin(1, "Ridgeline", "SHARED-12", "Weekly standup")],
    [pin(1, "Ridgeline", "SHARED-12", "Renamed standup")],
  );
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
  await stubSearch(page, [sharedHit]);

  await page.goto("/today");
  await page.getByRole("button", { name: "Pin an issue" }).click();
  const box = page.getByRole("combobox", { name: "Find an issue" });
  await box.fill("security");
  await expect(page.getByRole("option")).toHaveCount(1);

  await page.getByRole("button", { name: "Refresh" }).click();

  // Waited on first: proves the refresh actually completed before the form
  // survival is checked, rather than the assertions below merely being true
  // on Playwright's first poll before refreshPins has done anything at all.
  await expect(page.getByText("Renamed standup")).toBeVisible();
  await expect(box).toHaveValue("security");
  await expect(page.getByRole("option")).toHaveCount(1);
});

test("a failing pins call during Refresh leaves the typed query intact", async ({ page }) => {
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
  await stubSearch(page, [sharedHit]);
  let calls = 0;
  await page.route("**/api/pins**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    calls += 1;
    if (calls === 1) {
      await route.fulfill({
        status: 200,
        json: [pin(1, "Ridgeline", "SHARED-12", "Weekly standup")],
      });
      return;
    }
    await route.fulfill({
      status: 500,
      json: { code: "unexpected", message: "the Jira site could not be reached" },
    });
  });

  await page.goto("/today");
  await page.getByRole("button", { name: "Pin an issue" }).click();
  const box = page.getByRole("combobox", { name: "Find an issue" });
  await box.fill("security");
  await expect(page.getByRole("option")).toHaveCount(1);

  await page.getByRole("button", { name: "Refresh" }).click();

  // The error is what proves this reached refreshPins' catch branch, not its
  // try — the branch whose wipe of pinnedForm this guards against.
  const pinnedCard = page.getByRole("region", { name: "Pinned" });
  await expect(pinnedCard.getByText("the Jira site could not be reached")).toBeVisible();
  await expect(box).toHaveValue("security");
  await expect(page.getByRole("option")).toHaveCount(1);
});

test("a newly-pinned key becomes un-choosable in an open popup", async ({ page }) => {
  // sharedHit's instanceId (1) must match the newly-added pin's, or the
  // disabled-keys check the test is proving would never have anything to key
  // against.
  const newlyPinned = {
    ...pin(9, "Ridgeline", "SHARED-40", "Vendor security review"),
    instanceId: 1,
  };
  await stubPins(
    page,
    [pin(1, "Ridgeline", "SHARED-12", "Weekly standup")],
    [pin(1, "Ridgeline", "SHARED-12", "Weekly standup"), newlyPinned],
  );
  await stubIssues(page, [{ id: 1, name: "Ridgeline", issues: [], error: null }]);
  await stubSearch(page, [sharedHit]);

  await page.goto("/today");
  await page.getByRole("button", { name: "Pin an issue" }).click();
  const box = page.getByRole("combobox", { name: "Find an issue" });
  await box.fill("security");

  const option = page.getByRole("option").first();
  await expect(option).not.toContainText("Pinned");

  // Someone else pins SHARED-40 elsewhere; this Refresh is what learns about it.
  await page.getByRole("button", { name: "Refresh" }).click();

  await expect(option).toContainText("Pinned");
  await expect(option).toBeDisabled();
});

/**
 * Task 3 of #95: the row itself carries a trailing pin control now, rather
 * than Today's pin form being the only way in. Today does not yet wire
 * `that-table` (that is Task 4), so these mount a row directly into a
 * `that-table` the way Task 4 eventually will — the same reasoning
 * tooltip.spec.ts's mountTrigger uses for that-tooltip's first test, since
 * that-ticket-row is that-table's first row and neither has a production
 * consumer wiring them together yet.
 */
test.describe("the ticket row's own pin control", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
    await page.route("**/api/issues", (route) =>
      route.fulfill({ status: 200, json: { instances: [] } }),
    );
    await page.goto("/today");
  });

  interface RowTicket {
    key: string;
    summary: string;
    status: string;
    url: string;
  }

  const ridge5301: RowTicket = {
    key: "RIDGE-5301",
    summary: "Timesheet export drops the last day of the month",
    status: "In Progress",
    url: "https://ridgeline.atlassian.net/browse/RIDGE-5301",
  };

  async function mountRows(page: Page, tickets: RowTicket[]): Promise<void> {
    await page.evaluate(async (list) => {
      // Both are registered by a dynamic import (that-table from main.ts,
      // that-ticket-row from today.ts's own dynamic view import), so a row
      // built before either resolves would be an un-upgraded element with no
      // .body / cell rendering at all.
      await Promise.all([
        customElements.whenDefined("that-table"),
        customElements.whenDefined("that-ticket-row"),
      ]);
      const table = document.createElement("that-table");
      const body = (table as unknown as { body: HTMLTableSectionElement }).body;
      for (const ticket of list) {
        const row = document.createElement("that-ticket-row");
        row.setAttribute("key", ticket.key);
        row.setAttribute("summary", ticket.summary);
        row.setAttribute("status", ticket.status);
        row.setAttribute("url", ticket.url);
        row.setAttribute("instance-id", "1");
        row.setAttribute("instance-name", "Ridgeline");
        body.append(row);
      }
      document.body.append(table);
    }, tickets);
  }

  test("every row carries its own pin control, named for its ticket", async ({ page }) => {
    const ridge4880: RowTicket = {
      key: "RIDGE-4880",
      summary: "Update the on-call rota document",
      status: "To Do",
      url: "https://ridgeline.atlassian.net/browse/RIDGE-4880",
    };
    await mountRows(page, [ridge5301, ridge4880]);

    await expect(page.getByRole("button", { name: "Pin RIDGE-5301", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pin RIDGE-4880", exact: true })).toBeVisible();
  });

  test("hovering the pin control shows a tooltip reading exactly \"pin ticket\"", async ({
    page,
  }) => {
    await mountRows(page, [ridge5301]);

    await page.getByRole("button", { name: "Pin RIDGE-5301", exact: true }).hover();

    // Scoped to the row's card: Today's own Refresh carries a tooltip too, and
    // an unscoped locator would match both.
    const tooltip = page.locator("that-table that-tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText("pin ticket");
  });

  test("clicking the pin control pins the ticket, turning it into the crossed pin", async ({
    page,
  }) => {
    await mountRows(page, [ridge5301]);

    await page.getByRole("button", { name: "Pin RIDGE-5301", exact: true }).click();

    await expect(page.getByRole("button", { name: "Pin RIDGE-5301", exact: true })).toHaveCount(0);
    const unpinControl = page.getByRole("button", { name: "Unpin RIDGE-5301", exact: true });
    await expect(unpinControl).toBeVisible();

    await unpinControl.hover();
    // Scoped to the row's card: Today's own Refresh carries a tooltip too, and
    // an unscoped locator would match both.
    const tooltip = page.locator("that-table that-tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText("unpin ticket");
  });

  // A trailing control's centred tooltip hangs past the card — decision 7's
  // reason for anchor="end". The row spans the full card width because
  // that-table's own <table> carries w-full, so a tooltip that centred on
  // this control would have nowhere to go but past the right edge.
  test("the pin control's tooltip does not extend past the card's right edge", async ({
    page,
  }) => {
    await mountRows(page, [ridge5301]);

    await page.getByRole("button", { name: "Pin RIDGE-5301", exact: true }).hover();

    // Scoped to the row's card: Today's own Refresh carries a tooltip too, and
    // an unscoped locator would match both.
    const tooltip = page.locator("that-table that-tooltip");
    await expect(tooltip).toBeVisible();

    const card = page.locator("that-table");
    const tooltipBox = await tooltip.boundingBox();
    const cardBox = await card.boundingBox();
    expect(tooltipBox).not.toBeNull();
    expect(cardBox).not.toBeNull();

    expect(tooltipBox!.x + tooltipBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 1);
  });
});
