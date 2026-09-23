import { expect, test, type Page } from "@playwright/test";

interface StubInstance {
  id: number;
  name: string;
  siteUrl: string;
  apiBaseUrl: string;
  email: string;
  createdAt: string;
}

interface InstancesStub {
  deleteCount: () => number;
}

/**
 * Stubs the instances API in the browser, so the spec covers the view rather
 * than the server. The server's own behaviour is covered by httptest, and no
 * test anywhere contacts a real Jira instance.
 */
async function stubInstancesApi(
  page: Page,
  options: { testStatus: number },
): Promise<InstancesStub> {
  const instances: StubInstance[] = [];

  await page.route("**/api/instances", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { name: string; siteUrl: string; email: string };
      const created: StubInstance = {
        id: instances.length + 1,
        name: body.name,
        siteUrl: body.siteUrl,
        apiBaseUrl: "https://api.atlassian.com/ex/jira/7c41e2b6",
        email: body.email,
        createdAt: "2026-08-12T09:00:00Z",
      };
      instances.push(created);
      await route.fulfill({ status: 201, json: created });
      return;
    }

    await route.fulfill({ status: 200, json: instances });
  });

  await page.route("**/api/instances/*/test", async (route) => {
    if (options.testStatus === 200) {
      await route.fulfill({ status: 200, json: { accountId: "5b10a2", displayName: "Dion" } });
      return;
    }
    await route.fulfill({
      status: options.testStatus,
      json: { code: "credentials_rejected", message: "Jira did not accept the API token for this request; check the token and its scopes" },
    });
  });

  let deletes = 0;

  // A single path segment, so this never catches /api/instances/{id}/test.
  await page.route("**/api/instances/*", async (route) => {
    const method = route.request().method();
    const id = Number(new URL(route.request().url()).pathname.split("/").pop());

    if (method === "PATCH") {
      const body = route.request().postDataJSON() as { name: string; siteUrl: string; email: string };
      const existing = instances.find((instance) => instance.id === id);
      if (!existing) {
        await route.fulfill({ status: 404, json: { code: "not_found", message: "no such instance" } });
        return;
      }
      existing.name = body.name;
      existing.siteUrl = body.siteUrl;
      existing.email = body.email;
      await route.fulfill({ status: 200, json: existing });
      return;
    }

    if (method !== "DELETE") {
      await route.fallback();
      return;
    }

    const index = instances.findIndex((instance) => instance.id === id);
    if (index >= 0) {
      instances.splice(index, 1);
    }
    deletes += 1;
    await route.fulfill({ status: 204, body: "" });
  });

  return { deleteCount: () => deletes };
}

async function addInstance(page: Page): Promise<void> {
  await page.getByLabel("Name").fill("Work");
  await page.getByLabel("Site URL").fill("https://example.atlassian.net");
  await page.getByLabel("Account email").fill("me@example.com");
  await page.getByLabel("API token", { exact: true }).fill("secret");
  await page.getByRole("button", { name: "Add instance" }).click();
}

test("an instance can be added and appears in the list", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");

  await expect(page.getByText("No instances yet. Add one below.")).toBeVisible();

  await addInstance(page);

  // exact: true disambiguates from the shell's persistent "ThatApp"
  // heading, which the default substring match would otherwise also resolve.
  await expect(page.getByText("Work", { exact: true })).toBeVisible();
  await expect(page.getByText("me@example.com · https://example.atlassian.net")).toBeVisible();
});

/**
 * that-button's shared `h-[38px]` (#117 task 11, D3) reaches every consumer,
 * not just the entries dialog it was written for. "Add instance" is the one
 * always on screen with no instance needed first, so it stands in as the
 * regression net for this surface.
 */
test("the Add instance button carries the app-wide drawn 38px height", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");

  const height = await page
    .getByRole("button", { name: "Add instance" })
    .evaluate((element) => Math.round(element.getBoundingClientRect().height));

  expect(height).toBe(38);
});

test("a successful connection test names the account", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");
  await addInstance(page);

  await page.getByRole("button", { name: "Test" }).click();

  await expect(page.getByText("Connected as Dion.")).toBeVisible();
});

// Success and failure must be distinguishable, which is the whole point of a
// test button that asserts identity rather than a 2xx.
test("a rejected connection test reports the failure", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 401 });
  await page.goto("/settings");
  await addInstance(page);

  await page.getByRole("button", { name: "Test" }).click();

  await expect(page.getByText("Jira did not accept the API token for this request; check the token and its scopes")).toBeVisible();
  await expect(page.getByText("Connected as")).toBeHidden();
});

test("settings is reachable from the shell nav", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.route("**/api/issues", (route) =>
    route.fulfill({ status: 200, json: { instances: [] } }),
  );
  await page.goto("/");

  // exact: true disambiguates from the "Open Settings" link in Today's
  // no-instances state, which is on screen at "/" and whose accessible name
  // contains "Settings" as a substring.
  await page.getByRole("link", { name: "Settings", exact: true }).click();

  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Add an instance" })).toBeVisible();
});

test("removing an instance asks first, and cancelling changes nothing", async ({ page }) => {
  const stub = await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");
  await addInstance(page);

  await page.getByRole("button", { name: "Remove" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Work");
  await expect(dialog).toContainText("cannot be undone");

  await dialog.getByRole("button", { name: "Cancel" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText("me@example.com · https://example.atlassian.net")).toBeVisible();
  expect(stub.deleteCount()).toBe(0);
});

test("confirming the dialog removes the instance", async ({ page }) => {
  const stub = await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");
  await addInstance(page);

  await page.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove instance" }).click();

  await expect(page.getByText("No instances yet. Add one below.")).toBeVisible();
  expect(stub.deleteCount()).toBe(1);
});

// Esc is the platform's own dismissal path, so a regression here would be silent.
test("pressing Escape cancels the removal", async ({ page }) => {
  const stub = await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");
  await addInstance(page);

  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText("me@example.com · https://example.atlassian.net")).toBeVisible();
  expect(stub.deleteCount()).toBe(0);
});

async function addSecondInstance(page: Page): Promise<void> {
  await page.getByLabel("Name").fill("Personal");
  await page.getByLabel("Site URL").fill("https://personal.atlassian.net");
  await page.getByLabel("Account email").fill("me@personal.com");
  await page.getByLabel("API token", { exact: true }).fill("secret2");
  await page.getByRole("button", { name: "Add instance" }).click();
  await expect(page.getByText("Personal", { exact: true })).toBeVisible();
}

interface HeldAnswer {
  status: number;
  json: unknown;
}

interface HeldRequest {
  arrived: Promise<void>;
  release: (answer?: HeldAnswer) => void;
}

/**
 * Holds the next `method` request to `url` open until release() — registered
 * after stubInstancesApi, so it runs first. Released with no answer, the stub
 * answers it as usual.
 */
async function holdNextRequest(page: Page, url: string, method: string): Promise<HeldRequest> {
  let arrive: () => void = () => {};
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  let release: (answer?: HeldAnswer) => void = () => {};
  const released = new Promise<HeldAnswer | undefined>((resolve) => {
    release = resolve;
  });
  let held = false;

  await page.route(url, async (route) => {
    if (route.request().method() !== method || held) {
      await route.fallback();
      return;
    }
    held = true;
    arrive();
    const answer = await released;
    if (answer) {
      await route.fulfill(answer);
    } else {
      await route.fallback();
    }
  });

  return { arrived, release };
}

test("typed input survives removing another instance", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");
  await addInstance(page);

  // Waits for the add's own async round trip to finish resetting the form
  // before typing into it — without this, the fill below races the reset
  // and lands on the form save() is about to discard.
  await expect(page.getByText("Work", { exact: true })).toBeVisible();

  await addSecondInstance(page);

  await page.getByLabel("Name").fill("Half-typed");

  await page
    .getByRole("listitem")
    .filter({ hasText: "Work" })
    .getByRole("button", { name: "Remove" })
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove instance" }).click();

  await expect(page.getByText("Work", { exact: true })).toBeHidden();
  await expect(page.getByText("Personal", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Half-typed");
});

test("editing can be cancelled", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");
  await addInstance(page);

  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByLabel("Name")).toHaveValue("Work");

  await page.getByRole("button", { name: "Cancel changes" }).click();

  await expect(page.getByRole("button", { name: "Add instance" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("");
  await expect(page.getByText("me@example.com · https://example.atlassian.net")).toBeVisible();
});

// #56: the initial list read is answered after a save has already redrawn the
// list. Whatever that stale read carries — the empty list it saw, or a
// failure — must not replace what the save's own read put on screen.
for (const stale of [
  { name: "an empty list", answer: { status: 200, json: [] } },
  {
    name: "a failure",
    answer: { status: 500, json: { code: "store_failed", message: "could not read the stored instances" } },
  },
] as const) {
  test(`a list read answered late with ${stale.name} leaves a just-saved instance listed`, async ({ page }) => {
    await stubInstancesApi(page, { testStatus: 200 });

    let releaseFirstRead: () => void = () => {};
    const firstReadReleased = new Promise<void>((resolve) => {
      releaseFirstRead = resolve;
    });
    let firstReadAnswered: () => void = () => {};
    const firstReadWasAnswered = new Promise<void>((resolve) => {
      firstReadAnswered = resolve;
    });
    let heldOne = false;

    await page.route("**/api/instances", async (route) => {
      if (route.request().method() !== "GET" || heldOne) {
        await route.fallback();
        return;
      }
      heldOne = true;
      await firstReadReleased;
      await route.fulfill(stale.answer);
      firstReadAnswered();
    });

    await page.goto("/settings");
    await addInstance(page);
    await expect(page.getByText("Work", { exact: true })).toBeVisible();

    releaseFirstRead();
    await firstReadWasAnswered;
    await page.evaluate(() => fetch("/api/health").then((response) => response.text()));

    await expect(page.getByText("Work", { exact: true })).toBeVisible();
    await expect(page.getByText("could not read the stored instances")).toHaveCount(0);
  });
}

// The row's node must survive a sibling's save, or the awaited result renders
// into detached DOM and the user never sees it. Two rows, so this also catches
// a sibling being dropped by reconciliation, not just detached.
test("an in-flight connection test survives another row being saved", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");
  await addInstance(page);

  // Waits for the first add's own async round trip to finish resetting the
  // form before starting the second — see the same wait in "typed input
  // survives removing another instance" for why.
  await expect(page.getByText("Work", { exact: true })).toBeVisible();
  await addSecondInstance(page);

  await page.route("**/api/instances/*/test", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({ status: 200, json: { accountId: "5b10a2", displayName: "Dion" } });
  });

  const workRow = page.getByRole("listitem").filter({ hasText: "Work" });
  const personalRow = page.getByRole("listitem").filter({ hasText: "Personal" });

  await workRow.getByRole("button", { name: "Test" }).click();
  await expect(workRow.getByText("Testing…")).toBeVisible();

  await personalRow.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("Personal Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Personal Renamed", { exact: true })).toBeVisible();

  await expect(workRow.getByText("Connected as Dion.")).toBeVisible({ timeout: 5000 });
});

// A reused row's handlers must read the current instance, not the one the row
// was originally built from, or a destructive confirmation can name the wrong
// (stale) instance even though the delete itself still targets the right id.
test("removing a renamed instance names the confirm dialog correctly", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");
  await addInstance(page);

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Renamed", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Remove" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Renamed");
});

// patchRow must re-evaluate the warning on every reconciled row, not just at
// creation — the brief's original "re-rendered through the edit path anyway"
// reasoning held only under the wholesale rebuild this ticket removed.
test("editing an instance to add its site URL clears the missing-URL warning", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");

  await page.getByLabel("Name").fill("No Site");
  await page.getByLabel("Account email").fill("me@example.com");
  await page.getByLabel("API token", { exact: true }).fill("secret");
  await page.getByRole("button", { name: "Add instance" }).click();

  await expect(page.getByText("This instance has no site URL")).toBeVisible();

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Site URL").fill("https://example.atlassian.net");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("This instance has no site URL")).toBeHidden();
});

// A reused row keeps its status node so an in-flight test survives a reconcile
// (see the test above this comment's sibling in the suite), but that same
// preservation must not let a *completed* result outlive the edit that
// invalidated it.
test("saving over a failed connection test clears the stale result", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 401 });
  await page.goto("/settings");
  await addInstance(page);

  // Waits for the add's own async round trip to finish before interacting
  // with the row it creates — see the same wait in "typed input survives
  // removing another instance" for why.
  await expect(page.getByText("Work", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Test" }).click();
  await expect(page.getByText("Jira did not accept the API token for this request; check the token and its scopes")).toBeVisible();

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("API token (leave blank to keep the stored one)").fill("corrected-secret");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("Jira did not accept the API token for this request; check the token and its scopes")).toBeHidden();
});

// Before this branch, entering edit mode destroyed the list, so no Remove
// button was ever on screen while editing. The persistent list makes this
// reachable: removing the instance you are editing must not leave a stale
// form behind, PATCHing an id that no longer exists.
test("removing the instance you are editing clears the form", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");
  await addInstance(page);

  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByLabel("Name")).toHaveValue("Work");

  await page.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove instance" }).click();

  await expect(page.getByRole("heading", { name: "Add an instance" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("");
});

test("a failed initial load still renders the Add form", async ({ page }) => {
  await page.route("**/api/instances", (route) => route.abort());
  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Add an instance" })).toBeVisible();
  await expect(page.getByRole("status")).toBeVisible();
});

const TOKEN_PAGE = "https://id.atlassian.com/manage-profile/security/api-tokens";

async function expectTokenNote(page: Page, form: string): Promise<void> {
  const note = page.locator(`${form} [data-token-note]`);
  await expect(note).toBeVisible();
  for (const scope of ["read:jira-user", "read:jira-work", "write:jira-work"]) {
    await expect(note).toContainText(scope);
  }
  await expect(note).toContainText("Without write:jira-work your issues still list, but pushes fail.");
  await expect(note).not.toContainText("↗");

  // Exact name: the external mark is aria-hidden, so it adds nothing to it.
  const link = note.getByRole("link", { name: "Create a token", exact: true });
  await expect(link).toHaveAttribute("href", TOKEN_PAGE);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener");
  await expect(link.locator("svg")).toHaveAttribute("width", "14");
  // The info mark is the note's first svg in document order.
  await expect(note.locator("svg").first()).toHaveAttribute("width", "18");
}

test("the add and edit forms say what a token needs before it can push", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");

  await expectTokenNote(page, "that-card:not([data-editing-id])");

  await addInstance(page);
  await page.getByRole("button", { name: "Edit" }).click();

  await expectTokenNote(page, "that-card[data-editing-id]");
});

// #161: save() must not reset a form the user has since replaced.
test("a save finishing after Edit on another row leaves that edit form alone", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");
  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();
  await addSecondInstance(page);

  const held = await holdNextRequest(page, "**/api/instances/*", "PATCH");
  await page.getByRole("listitem").filter({ hasText: "Work" }).getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("Work Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await held.arrived;

  await page.getByRole("listitem").filter({ hasText: "Personal" }).getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("Personal typed");

  held.release();
  await expect(page.getByText("Work Renamed", { exact: true })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Edit Personal" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Personal typed");
});

test("a save finishing after Cancel leaves the new Add form alone", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");
  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();

  const held = await holdNextRequest(page, "**/api/instances/*", "PATCH");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("Work Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await held.arrived;

  await page.getByRole("button", { name: "Cancel changes" }).click();
  await page.getByLabel("Name").fill("Half-typed");

  held.release();
  await expect(page.getByText("Work Renamed", { exact: true })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Add an instance" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Half-typed");
});

test("a save finishing with its own form still shown resets to Add an instance", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");
  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();

  const held = await holdNextRequest(page, "**/api/instances/*", "PATCH");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("Work Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await held.arrived;

  held.release();
  await expect(page.getByText("Work Renamed", { exact: true })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Add an instance" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("");
});

const saveFailure = { status: 500, json: { code: "store_failed", message: "could not save the instance" } };

test("a save failing after its form was replaced reports in the page error slot", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");
  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();

  const held = await holdNextRequest(page, "**/api/instances/*", "PATCH");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("Work Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await held.arrived;

  await page.getByRole("button", { name: "Cancel changes" }).click();
  held.release(saveFailure);

  await expect(page.getByText("Could not save Work: could not save the instance")).toBeVisible();
  await expect(page.locator("form").getByText("could not save the instance")).toHaveCount(0);
});

test("a save failing with its form still shown reports in the form", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");
  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();

  const held = await holdNextRequest(page, "**/api/instances/*", "PATCH");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("Work Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await held.arrived;

  held.release(saveFailure);

  await expect(page.locator("form").getByText("could not save the instance", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Edit Work" })).toBeVisible();
});

test("an Edit form opened on the instance being saved shows the saved values", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");
  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();

  const held = await holdNextRequest(page, "**/api/instances/*", "PATCH");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("Work Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await held.arrived;

  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByLabel("Name")).toHaveValue("Work");

  held.release();

  await expect(page.getByRole("heading", { name: "Edit Work Renamed" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Work Renamed");
});
