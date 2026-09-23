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
