import { expect, test, type Locator, type Page } from "@playwright/test";

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

/**
 * Settings is a dialog over a view, so every test opens Today first — stubbed
 * empty, so it never reaches a real Jira — and presses the rail's cog.
 */
async function stubToday(page: Page): Promise<void> {
  await page.route("**/api/issues", (route) =>
    route.fulfill({ status: 200, json: { instances: [] } }),
  );
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
}

async function openSettings(page: Page): Promise<Locator> {
  await stubToday(page);
  await page.goto("/today");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();

  return settings;
}

function listed(id: number, name: string): StubInstance {
  return {
    id,
    name,
    siteUrl: `https://${name.toLowerCase()}.atlassian.net`,
    apiBaseUrl: "https://api.atlassian.com/ex/jira/abc",
    email: "dion@this.nl",
    createdAt: `2026-09-0${String(id)}T09:00:00Z`,
  };
}

async function stubListed(page: Page, instances: StubInstance[]): Promise<void> {
  await page.route("**/api/instances", (route) => route.fulfill({ status: 200, json: instances }));
}

async function panelBox(settings: Locator): Promise<{ top: number; height: number }> {
  const box = await settings.locator("[data-settings-panel]").boundingBox();
  if (!box) throw new Error("the panel did not lay out");

  return { top: box.y, height: box.height };
}

const confirmDialog = (page: Page) => page.getByRole("dialog", { name: /^Remove / });

async function addInstance(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Add an instance" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Work");
  await page.getByLabel("Site URL").fill("https://example.atlassian.net");
  await page.getByLabel("Account email").fill("me@example.com");
  await page.getByLabel("API token", { exact: true }).fill("secret");
  await page.getByRole("button", { name: "Add instance" }).click();
}

test("an instance can be added and appears in the list", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await openSettings(page);

  await expect(page.getByText("No instances yet. Add one below.")).toBeVisible();

  await addInstance(page);

  // exact: true disambiguates from the shell's persistent "ThatApp"
  // heading, which the default substring match would otherwise also resolve.
  await expect(page.getByText("Work", { exact: true })).toBeVisible();
  await expect(page.getByText("example.atlassian.net · me@example.com")).toBeVisible();
});

/**
 * that-button's shared `h-[38px]` (#117 task 11, D3) reaches every consumer,
 * not just the entries dialog it was written for. "Add instance" is the one
 * always on screen with no instance needed first, so it stands in as the
 * regression net for this surface.
 */
test("the Add instance button carries the app-wide drawn 38px height", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await openSettings(page);
  await page.getByRole("button", { name: "Add an instance" }).click();

  const height = await page
    .getByRole("button", { name: "Add instance" })
    .evaluate((element) => Math.round(element.getBoundingClientRect().height));

  expect(height).toBe(38);
});

test("an untested instance reads Not tested, in muted ink with no mark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await stubListed(page, [listed(1, "Ridgeline")]);
  const settings = await openSettings(page);

  const health = settings.getByRole("listitem").filter({ hasText: "Ridgeline" }).locator("[data-row-health]");
  await expect(health).toHaveText("Not tested");
  await expect(health).toHaveCSS("color", "oklch(0.725 0.012 55)");
  await expect(health.locator("svg")).toHaveCount(0);
});

test("a successful connection test states Connected and the time it was taken", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await stubInstancesApi(page, { testStatus: 200 });
  const settings = await openSettings(page);
  await addInstance(page);

  const row = settings.getByRole("listitem").filter({ hasText: "Work" });
  await row.getByRole("button", { name: "Test Work" }).click();

  const health = row.locator("[data-row-health]");
  await expect(health).toHaveText(/^Connected · \d{2}:\d{2}$/);
  await expect(health).toHaveCSS("color", "oklch(0.75 0.15 150)");
  await expect(health.locator("svg")).toHaveAttribute("width", "15");
});

// Success and failure must be distinguishable, which is the whole point of a
// test button that asserts identity rather than a 2xx.
test("a rejected connection test reports the failure", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 401 });
  const settings = await openSettings(page);
  await addInstance(page);

  await settings.getByRole("button", { name: "Test Work" }).click();

  await expect(settings.getByText("Jira did not accept the API token for this request; check the token and its scopes")).toBeVisible();
  await expect(settings.getByText(/Connected ·/)).toBeHidden();
  await expect(settings.getByText("Not tested")).toBeHidden();
  // #123: a Test connection failure stays inline in the dialog, never a toast.
  await expect(settings.locator("that-alert", { hasText: "Jira did not accept the API token" })).toBeVisible();
  await expect(page.locator("that-toast")).toHaveCount(0);
});

test("removing an instance asks first, and cancelling changes nothing", async ({ page }) => {
  const stub = await stubInstancesApi(page, { testStatus: 200 });
  await openSettings(page);
  await addInstance(page);

  await page.getByRole("button", { name: "Remove" }).click();

  const dialog = confirmDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Work");
  await expect(dialog).toContainText("cannot be undone");

  await dialog.getByRole("button", { name: "Cancel" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText("example.atlassian.net · me@example.com")).toBeVisible();
  expect(stub.deleteCount()).toBe(0);
});

test("confirming the dialog removes the instance", async ({ page }) => {
  const stub = await stubInstancesApi(page, { testStatus: 200 });
  await openSettings(page);
  await addInstance(page);

  await page.getByRole("button", { name: "Remove" }).click();
  await confirmDialog(page).getByRole("button", { name: "Remove instance" }).click();

  await expect(page.getByText("No instances yet. Add one below.")).toBeVisible();
  expect(stub.deleteCount()).toBe(1);
});

// Esc is the platform's own dismissal path, so a regression here would be silent.
test("pressing Escape cancels the removal", async ({ page }) => {
  const stub = await stubInstancesApi(page, { testStatus: 200 });
  await openSettings(page);
  await addInstance(page);

  await page.getByRole("button", { name: "Remove" }).click();
  await expect(confirmDialog(page)).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(confirmDialog(page)).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("example.atlassian.net · me@example.com")).toBeVisible();
  expect(stub.deleteCount()).toBe(0);
});

async function addSecondInstance(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Add an instance" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Personal");
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
  await openSettings(page);
  await addInstance(page);

  // Waits for the add's own async round trip to finish resetting the form
  // before typing into it — without this, the fill below races the reset
  // and lands on the form save() is about to discard.
  await expect(page.getByText("Work", { exact: true })).toBeVisible();

  await addSecondInstance(page);

  await page.getByRole("button", { name: "Add an instance" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Half-typed");

  await page
    .getByRole("listitem")
    .filter({ hasText: "Work" })
    .getByRole("button", { name: "Remove" })
    .click();
  await confirmDialog(page).getByRole("button", { name: "Remove instance" }).click();

  await expect(page.getByText("Work", { exact: true })).toBeHidden();
  await expect(page.getByText("Personal", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Half-typed");
});

test("editing can be cancelled", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await openSettings(page);
  await addInstance(page);

  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Work");

  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit Work", exact: true })).toBeFocused();
  await expect(page.getByText("example.atlassian.net · me@example.com")).toBeVisible();
});

test("saving an edit returns focus to that row's Edit button", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await openSettings(page);
  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Edit Work", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Work Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit Work Renamed", exact: true })).toBeFocused();
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

    await openSettings(page);
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
  await openSettings(page);
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
  await page.getByLabel("Name", { exact: true }).fill("Personal Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Personal Renamed", { exact: true })).toBeVisible();

  await expect(workRow.locator("[data-row-health]")).toHaveText(/^Connected · /, { timeout: 5000 });
});

// A reused row's handlers must read the current instance, not the one the row
// was originally built from, or a destructive confirmation can name the wrong
// (stale) instance even though the delete itself still targets the right id.
test("removing a renamed instance names the confirm dialog correctly", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await openSettings(page);
  await addInstance(page);

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Renamed", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Remove" }).click();

  const dialog = confirmDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Renamed");
});

// patchRow must re-evaluate the warning on every reconciled row, not just at
// creation — the brief's original "re-rendered through the edit path anyway"
// reasoning held only under the wholesale rebuild this ticket removed.
test("editing an instance to add its site URL clears the missing-URL warning", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await openSettings(page);

  await page.getByRole("button", { name: "Add an instance" }).click();
  await page.getByLabel("Name", { exact: true }).fill("No Site");
  await page.getByLabel("Account email").fill("me@example.com");
  await page.getByLabel("API token", { exact: true }).fill("secret");
  await page.getByRole("button", { name: "Add instance" }).click();

  await expect(page.getByText("This instance has no site URL")).toBeVisible();
  // #123: a state notice stays inline in the dialog, never a toast.
  await expect(page.getByRole("dialog", { name: "Settings" }).locator("that-alert", { hasText: "This instance has no site URL" })).toBeVisible();
  await expect(page.locator("that-toast")).toHaveCount(0);

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
  await openSettings(page);
  await addInstance(page);

  // Waits for the add's own async round trip to finish before interacting
  // with the row it creates — see the same wait in "typed input survives
  // removing another instance" for why.
  await expect(page.getByText("Work", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Test" }).click();
  await expect(page.getByText("Jira did not accept the API token for this request; check the token and its scopes")).toBeVisible();

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("API token", { exact: true }).fill("corrected-secret");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("Jira did not accept the API token for this request; check the token and its scopes")).toBeHidden();
  await expect(page.getByText("Not tested")).toBeVisible();
});

// Before this branch, entering edit mode destroyed the list, so no Remove
// button was ever on screen while editing. The persistent list makes this
// reachable: removing the instance you are editing must not leave a stale
// form behind, PATCHing an id that no longer exists.
test("removing the instance you are editing clears the form", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await openSettings(page);
  await addInstance(page);

  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Work");

  await page.getByRole("button", { name: "Remove" }).click();
  await confirmDialog(page).getByRole("button", { name: "Remove instance" }).click();

  await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add an instance" })).toBeVisible();
});

test("a failed initial load still offers to add an instance", async ({ page }) => {
  await page.route("**/api/instances", (route) => route.abort());
  await openSettings(page);

  await expect(page.getByRole("button", { name: "Add an instance" })).toBeVisible();
  await expect(page.locator("that-alert[role='status']")).toBeVisible();
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
  await openSettings(page);

  await page.getByRole("button", { name: "Add an instance" }).click();
  await expectTokenNote(page, "[data-instance-form]:not([data-editing-id])");

  await addInstance(page);
  await page.getByRole("button", { name: "Edit" }).click();

  await expectTokenNote(page, "[data-instance-form][data-editing-id]");
});

// #161: save() must not reset a form the user has since replaced.
test("a save finishing after Edit on another row leaves that edit form alone", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await openSettings(page);
  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();
  await addSecondInstance(page);

  const held = await holdNextRequest(page, "**/api/instances/*", "PATCH");
  await page.getByRole("listitem").filter({ hasText: "Work" }).getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Work Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await held.arrived;

  await page.getByRole("listitem").filter({ hasText: "Personal" }).getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Personal typed");

  held.release();
  await expect(page.getByText("Work Renamed", { exact: true })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Edit Personal" })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Personal typed");
});

test("a save finishing after Cancel leaves the new Add form alone", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await openSettings(page);
  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();

  const held = await holdNextRequest(page, "**/api/instances/*", "PATCH");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Work Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await held.arrived;

  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Add an instance" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Half-typed");

  held.release();
  await expect(page.getByText("Work Renamed", { exact: true })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Add an instance" })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Half-typed");
});

test("a save finishing with its own form still shown closes the form", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await openSettings(page);
  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();

  const held = await holdNextRequest(page, "**/api/instances/*", "PATCH");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Work Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await held.arrived;

  held.release();
  await expect(page.getByText("Work Renamed", { exact: true })).toBeVisible();

  await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);
});

const saveFailure = { status: 500, json: { code: "store_failed", message: "could not save the instance" } };

test("a save failing after its form was replaced reports in a toast, not the error slot", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await openSettings(page);
  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();

  const held = await holdNextRequest(page, "**/api/instances/*", "PATCH");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Work Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await held.arrived;

  await page.getByRole("button", { name: "Cancel" }).click();
  held.release(saveFailure);

  await expect(
    page.locator("that-toasts that-toast[tone='error']").getByText("Could not save Work: could not save the instance"),
  ).toBeVisible();
  await expect(page.locator("[data-error-slot]")).not.toContainText("could not save the instance");
  await expect(page.locator("form").getByText("could not save the instance")).toHaveCount(0);
});

test("a save failing with its form still shown reports in the form", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await openSettings(page);
  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();

  const held = await holdNextRequest(page, "**/api/instances/*", "PATCH");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Work Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await held.arrived;

  held.release(saveFailure);

  await expect(page.locator("form").getByText("could not save the instance", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Edit Work" })).toBeVisible();
  // #123: the form's own error stays in the form, never a toast.
  await expect(page.locator("form that-alert", { hasText: "could not save the instance" })).toBeVisible();
  await expect(page.locator("that-toast")).toHaveCount(0);
});

// #205: the error slot keeps the section heading's 10px above the instance
// list while it holds a message, and adds nothing while it is empty. The gap
// is the slot's own bottom edge to the top of the element after it.
async function errorSlotGap(page: Page): Promise<{ gap: number; height: number }> {
  return page.locator("[data-error-slot]").evaluate((slot) => {
    const next = slot.nextElementSibling;
    if (!next) throw new Error("nothing follows the error slot");
    const own = slot.getBoundingClientRect();
    return { gap: next.getBoundingClientRect().top - own.bottom, height: own.height };
  });
}

async function failFirstListRead(page: Page): Promise<void> {
  let failed = false;
  await page.route("**/api/instances", async (route) => {
    if (route.request().method() !== "GET" || failed) {
      await route.fallback();
      return;
    }
    failed = true;
    await route.fulfill({
      status: 500,
      json: { code: "store_failed", message: "could not read the stored instances" },
    });
  });
}

test("a failed list read leaves 10px between its message and the instance list", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await failFirstListRead(page);
  await openSettings(page);
  await expect(page.locator("[data-error-slot]")).toContainText("could not read the stored instances");

  expect((await errorSlotGap(page)).gap).toBeCloseTo(10, 0);
});

test("a save error reported after its form closed is a toast over Settings and leaves the error slot empty", async ({
  page,
}) => {
  await stubInstancesApi(page, { testStatus: 200 });
  const settings = await openSettings(page);
  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();

  const held = await holdNextRequest(page, "**/api/instances/*", "PATCH");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Work Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await held.arrived;
  await page.getByRole("button", { name: "Cancel" }).click();
  held.release(saveFailure);

  const toast = settings.locator("that-toasts that-toast[tone='error']");
  await expect(toast).toContainText("Could not save Work: could not save the instance");
  await toast.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.locator("that-toasts that-toast")).toHaveCount(0);

  expect(await errorSlotGap(page)).toEqual({ gap: 0, height: 0 });
});

test("a failed removal is a toast over Settings, and the row's status holds no alert", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  const settings = await openSettings(page);
  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();

  await page.route("**/api/instances/*", (route) =>
    route.request().method() === "DELETE"
      ? route.fulfill({ status: 500, json: { code: "store_failed", message: "could not remove the instance" } })
      : route.fallback(),
  );
  await settings.getByRole("button", { name: "Remove Work" }).click();
  await confirmDialog(page).getByRole("button", { name: "Remove instance" }).click();

  const toast = settings.locator("that-toasts that-toast[tone='error']");
  await expect(toast).toContainText("could not remove the instance");
  await toast.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.locator("that-toasts that-toast")).toHaveCount(0);
  await expect(settings.locator("li[data-instance-id] that-alert")).toHaveCount(0);
  await expect(settings.getByRole("button", { name: "Remove Work" })).toBeEnabled();
});

test("an empty error slot adds nothing above the instance list", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await openSettings(page);
  await expect(page.getByText("No instances yet. Add one below.")).toBeVisible();

  expect(await errorSlotGap(page)).toEqual({ gap: 0, height: 0 });
});

test("a successful refresh clears the message and takes the gap out with it", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await failFirstListRead(page);
  await openSettings(page);
  await expect(page.locator("[data-error-slot]")).toContainText("could not read the stored instances");

  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();
  await expect(page.locator("[data-error-slot]")).toBeEmpty();

  expect(await errorSlotGap(page)).toEqual({ gap: 0, height: 0 });
});

// #200: a second Edit on an instance whose save has not answered would open
// on pre-save values and overwrite that save, so Edit is disabled until its
// own save answers — for that row only.
test("while a save is held, that row's Edit is disabled and other rows' are not", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await openSettings(page);
  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();
  await addSecondInstance(page);

  const held = await holdNextRequest(page, "**/api/instances/*", "PATCH");
  const work = page.locator("li[data-instance-id]", { hasText: "Work" });
  const personal = page.locator("li[data-instance-id]", { hasText: "Personal" });
  await work.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Work Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await held.arrived;

  await expect(work.getByRole("button", { name: "Edit" })).toBeDisabled();
  await expect(personal.getByRole("button", { name: "Edit" })).toBeEnabled();
  held.release();
});

test("when the held save succeeds, Edit is enabled again, focused, and opens on the saved values", async ({
  page,
}) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await openSettings(page);
  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();

  const held = await holdNextRequest(page, "**/api/instances/*", "PATCH");
  const row = page.locator("li[data-instance-id]", { hasText: "Work" });
  await row.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Work Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await held.arrived;

  await expect(row.getByRole("button", { name: "Edit" })).toBeDisabled();
  held.release();

  await expect(row.getByRole("button", { name: "Edit Work Renamed", exact: true })).toBeEnabled();
  await expect(row.getByRole("button", { name: "Edit Work Renamed", exact: true })).toBeFocused();
  await row.getByRole("button", { name: "Edit" }).click();

  await expect(page.getByRole("heading", { name: "Edit Work Renamed" })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Work Renamed");
});

test("when the held save fails, Edit is enabled again and the failure reports where #161 put it", async ({
  page,
}) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await openSettings(page);
  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();

  const row = page.locator("li[data-instance-id]", { hasText: "Work" });

  const heldShown = await holdNextRequest(page, "**/api/instances/*", "PATCH");
  await row.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Work Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await heldShown.arrived;

  heldShown.release(saveFailure);

  await expect(row.getByRole("button", { name: "Edit" })).toBeEnabled();
  await expect(page.locator("form").getByText("could not save the instance", { exact: true })).toBeVisible();

  // A second case: Cancel closes the form while the save is held, and the row
  // is patched by nothing until the failure answers.
  const heldReplaced = await holdNextRequest(page, "**/api/instances/*", "PATCH");
  await page.getByLabel("Name", { exact: true }).fill("Work Renamed Again");
  await page.getByRole("button", { name: "Save changes" }).click();
  await heldReplaced.arrived;

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(row.getByRole("button", { name: "Edit" })).toBeDisabled();
  heldReplaced.release(saveFailure);

  await expect(row.getByRole("button", { name: "Edit" })).toBeEnabled();
  await expect(
    page.locator("that-toasts that-toast[tone='error']").getByText("Could not save Work: could not save the instance"),
  ).toBeVisible();
  await expect(page.locator("[data-error-slot]")).not.toContainText("could not save the instance");
});

test("a list patch while a save is held keeps that row's Edit disabled", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await openSettings(page);
  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();

  const held = await holdNextRequest(page, "**/api/instances/*", "PATCH");
  const work = page.locator("li[data-instance-id]", { hasText: "Work" });
  await work.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Work Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await held.arrived;

  // Adding another instance re-reads the list, which patches the held row.
  await page.getByRole("button", { name: "Cancel" }).click();
  await addSecondInstance(page);

  await expect(work.getByRole("button", { name: "Edit" })).toBeDisabled();
  held.release();
  await expect(page.getByRole("button", { name: "Edit Work Renamed", exact: true })).toBeEnabled();
});

// savingIds is module-level and outlives the dialog, but each dialog owns its
// own rows. A finally that re-enabled through the dialog that started the save
// would write into its detached list, leaving the reopened row's Edit disabled.
test("closing and reopening Settings while a save is held still re-enables that row's Edit", async ({
  page,
}) => {
  await stubInstancesApi(page, { testStatus: 200 });
  const settings = await openSettings(page);
  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();

  const held = await holdNextRequest(page, "**/api/instances/*", "PATCH");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Work Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await held.arrived;

  // The first Escape closes the form while the save carries on (#250). The
  // row's Edit is disabled until the save answers, so focus falls back to Add.
  await page.keyboard.press("Escape");
  await expect(settings.getByLabel("Name", { exact: true })).toHaveCount(0);
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("button", { name: "Add an instance" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const row = page.locator("li[data-instance-id]", { hasText: "Work" });
  await expect(row.getByRole("button", { name: "Edit" })).toBeDisabled();

  held.release();

  await expect(row.getByRole("button", { name: "Edit" })).toBeEnabled();
});

test.describe("the dialog", () => {
  test("the cog opens Settings over the view, which stays mounted", async ({ page }) => {
    await stubListed(page, []);
    const settings = await openSettings(page);

    await expect(page).toHaveURL(/\/today$/);
    await expect(page.locator("#view").getByText("No Jira instances yet.")).toHaveCount(1);
    await expect(page.getByRole("navigation").getByRole("link")).toHaveText(["Today", "Week"]);
    await expect(settings.getByRole("heading", { name: "Jira instances" })).toBeVisible();
  });

  test("the cog sits beside the wordmark at the rail's top right, at 1.7 stroke", async ({ page }) => {
    await stubToday(page);
    await page.goto("/today");

    const cog = page.getByRole("button", { name: "Settings", exact: true });
    await expect(cog.locator("svg")).toHaveAttribute("stroke-width", "1.7");
    await expect(cog.locator("svg")).toHaveAttribute("width", "17");

    const cogBox = await cog.boundingBox();
    const navBox = await page.getByRole("link", { name: "Today", exact: true }).boundingBox();
    const markBox = await page.getByRole("heading", { name: "ThatApp" }).boundingBox();
    if (!cogBox || !navBox || !markBox) throw new Error("the rail did not lay out");

    expect(cogBox.width).toBe(34);
    // proto:64 — the hover box ends on the rail's content edge, as the nav rows do.
    expect(Math.abs(cogBox.x + cogBox.width - (navBox.x + navBox.width))).toBeLessThanOrEqual(1);
    expect(
      Math.abs(cogBox.y + cogBox.height / 2 - (markBox.y + markBox.height / 2)),
    ).toBeLessThanOrEqual(1);

    await cog.hover();
    const tip = page.locator('that-tooltip[for="settings-cog"]');
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText("Settings");
    const tipBox = await tip.boundingBox();
    if (!tipBox) throw new Error("the tooltip did not lay out");
    // proto:168, .tip.right — 9px to the right, centred on the cog.
    expect(Math.abs(tipBox.x - (cogBox.x + cogBox.width + 9))).toBeLessThanOrEqual(1);
    expect(
      Math.abs(tipBox.y + tipBox.height / 2 - (cogBox.y + cogBox.height / 2)),
    ).toBeLessThanOrEqual(1);
  });

  test("a panel shorter than the window is centred by its own auto margin", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1600 });
    await stubListed(page, []);
    const settings = await openSettings(page);

    const { top, height } = await panelBox(settings);
    expect(top).toBeGreaterThan(28);
    expect(Math.abs(top - (1600 - height) / 2)).toBeLessThanOrEqual(1);
  });

  test("a panel taller than the window scrolls as one piece, and its top is reachable", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 400 });
    await stubListed(page, [1, 2, 3, 4, 5, 6, 7, 8].map((id) => listed(id, `Site${String(id)}`)));
    const settings = await openSettings(page);
    await expect(settings.getByText("Site8", { exact: true })).toBeAttached();

    const scroll = await settings.evaluate((dialog) => {
      const panel = dialog.querySelector("[data-settings-panel]");
      if (!(panel instanceof HTMLElement)) throw new Error("no panel");
      dialog.scrollTop = 0;
      const top = panel.getBoundingClientRect().top;
      dialog.scrollTop = dialog.scrollHeight;
      const bottom = panel.getBoundingClientRect().bottom;

      return {
        top,
        bottom,
        viewport: window.innerHeight,
        dialogScrolls: dialog.scrollHeight > dialog.clientHeight,
        panelScrolls: panel.scrollHeight > panel.clientHeight,
      };
    });

    expect(scroll.dialogScrolls).toBe(true);
    expect(scroll.panelScrolls).toBe(false);
    expect(Math.abs(scroll.top - 28)).toBeLessThanOrEqual(1);
    expect(Math.abs(scroll.bottom - (scroll.viewport - 28))).toBeLessThanOrEqual(1);
  });

  test("Escape closes Settings", async ({ page }) => {
    await stubListed(page, []);
    const settings = await openSettings(page);

    await page.keyboard.press("Escape");

    await expect(settings).toHaveCount(0);
    await expect(page.locator("#settings-cog")).toBeFocused();
  });

  test("a second press while Settings loads opens one dialog, not two", async ({ page }) => {
    await stubListed(page, []);
    await stubToday(page);
    await page.goto("/today");

    await page.getByRole("button", { name: "Settings", exact: true }).dblclick();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    // No positive signal exists for "a second one did not arrive late".
    await page.waitForTimeout(300);

    expect(await page.locator("dialog").count()).toBe(1);
  });

  test("closing after a change redraws the view beneath; closing after none does not", async ({
    page,
  }) => {
    await stubInstancesApi(page, { testStatus: 200 });
    const settings = await openSettings(page);

    let issueReads = 0;
    await page.route("**/api/issues", (route) => {
      issueReads += 1;
      return route.fulfill({ status: 200, json: { instances: [] } });
    });

    await settings.getByRole("button", { name: "Close" }).click();
    await expect(settings).toHaveCount(0);
    await expect(page.locator("#settings-cog")).toBeFocused();
    await page.waitForTimeout(300);
    expect(issueReads).toBe(0);

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await addInstance(page);
    await expect(settings.getByText("Work", { exact: true })).toBeVisible();
    await settings.getByRole("button", { name: "Close" }).click();

    await expect.poll(() => issueReads).toBe(1);
    // A duplicate re-read would arrive after the first; give it the chance to.
    await page.waitForTimeout(300);
    expect(issueReads).toBe(1);
  });

  test("an add answered after Settings closed still redraws the view beneath, once", async ({ page }) => {
    await stubInstancesApi(page, { testStatus: 200 });
    const settings = await openSettings(page);
    await expect(page.locator("#view").getByText("No Jira instances yet.")).toHaveCount(1);

    let issueReads = 0;
    await page.route("**/api/issues", (route) => {
      issueReads += 1;
      return route.fulfill({
        status: 200,
        json: { instances: [{ id: 1, name: "Work", issues: [], error: null }] },
      });
    });

    const held = await holdNextRequest(page, "**/api/instances", "POST");
    await addInstance(page);
    await held.arrived;
    await settings.getByRole("button", { name: "Close" }).click();
    await expect(settings).toHaveCount(0);

    held.release();
    await expect.poll(() => issueReads).toBe(1);
    await page.waitForTimeout(300);
    expect(issueReads).toBe(1);
    await expect(page.locator("#view").getByText("No Jira instances yet.")).toHaveCount(0);
  });

  test("a removal answered after Settings closed still redraws the view beneath, once", async ({
    page,
  }) => {
    await stubListed(page, [listed(1, "Ridgeline")]);
    await page.route("**/api/instances/*", (route) =>
      route.request().method() === "DELETE"
        ? route.fulfill({ status: 204, body: "" })
        : route.fallback(),
    );
    const settings = await openSettings(page);

    let issueReads = 0;
    await page.route("**/api/issues", (route) => {
      issueReads += 1;
      return route.fulfill({ status: 200, json: { instances: [] } });
    });

    const held = await holdNextRequest(page, "**/api/instances/*", "DELETE");
    await settings.getByRole("button", { name: "Remove Ridgeline" }).click();
    await confirmDialog(page).getByRole("button", { name: "Remove instance" }).click();
    await held.arrived;
    await page.keyboard.press("Escape");
    await expect(settings).toHaveCount(0);

    held.release();
    await expect.poll(() => issueReads).toBe(1);
    await page.waitForTimeout(300);
    expect(issueReads).toBe(1);
  });

  test("closing after a change made from Today's Open Settings puts focus on the cog", async ({
    page,
  }) => {
    await stubInstancesApi(page, { testStatus: 200 });
    await stubToday(page);
    await page.goto("/today");

    await page.locator("#view").getByRole("button", { name: "Open Settings" }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await addInstance(page);
    await expect(settings.getByText("Work", { exact: true })).toBeVisible();
    await settings.getByRole("button", { name: "Close" }).click();

    await expect(settings).toHaveCount(0);
    await expect(page.locator("#settings-cog")).toBeFocused();
  });
});

// #250: Escape first closes the add/edit form, keeping what the rest of
// Settings shows; only a second Escape closes Settings.
test.describe("Escape with the instance form open", () => {
  test("the first closes the Add form and keeps Settings; the second closes Settings", async ({
    page,
  }) => {
    await stubListed(page, [listed(1, "Ridgeline")]);
    const settings = await openSettings(page);
    await settings.getByRole("button", { name: "Add an instance" }).click();
    await settings.getByLabel("Name", { exact: true }).fill("Half-typed");

    await page.keyboard.press("Escape");

    await expect(settings.getByLabel("Name", { exact: true })).toHaveCount(0);
    await expect(settings).toBeVisible();
    await expect(settings.getByRole("button", { name: "Add an instance" })).toBeFocused();

    await page.keyboard.press("Escape");

    await expect(settings).toHaveCount(0);
    await expect(page.locator("#settings-cog")).toBeFocused();
  });

  test("closing an Edit form hands focus back to that row's Edit", async ({ page }) => {
    await stubListed(page, [listed(1, "Ridgeline"), listed(2, "Harbour")]);
    const settings = await openSettings(page);
    await settings.getByRole("button", { name: "Edit Harbour", exact: true }).click();
    await expect(settings.getByLabel("Name", { exact: true })).toBeFocused();

    await page.keyboard.press("Escape");

    await expect(settings.getByLabel("Name", { exact: true })).toHaveCount(0);
    await expect(settings).toBeVisible();
    await expect(settings.getByRole("button", { name: "Edit Harbour", exact: true })).toBeFocused();
  });

  test("with focus elsewhere in Settings, the form closes and focus stays put", async ({ page }) => {
    await stubListed(page, [listed(1, "Ridgeline")]);
    const settings = await openSettings(page);
    await settings.getByRole("button", { name: "Add an instance" }).click();
    await expect(settings.getByLabel("Name", { exact: true })).toBeFocused();

    // Back past Add an instance onto the row's last control.
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    const remove = settings.getByRole("button", { name: "Remove Ridgeline", exact: true });
    await expect(remove).toBeFocused();
    // #267: keyboard focus shows Remove's tooltip, so the first Escape closes only it.
    const removeTip = settings.locator("that-tooltip", { hasText: "remove instance" });
    await expect(removeTip).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(removeTip).toBeHidden();
    await expect(settings.getByLabel("Name", { exact: true })).toBeVisible();
    await expect(remove).toBeFocused();

    await page.keyboard.press("Escape");

    await expect(settings.getByLabel("Name", { exact: true })).toHaveCount(0);
    await expect(settings).toBeVisible();
    await expect(remove).toBeFocused();
  });

  test("a Remove confirm over the form takes the Escape itself", async ({ page }) => {
    await stubListed(page, [listed(1, "Ridgeline")]);
    const settings = await openSettings(page);
    await settings.getByRole("button", { name: "Add an instance" }).click();
    await settings.getByLabel("Name", { exact: true }).fill("Half-typed");
    await settings.getByRole("button", { name: "Remove Ridgeline", exact: true }).click();
    await expect(confirmDialog(page)).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(confirmDialog(page)).toBeHidden();
    await expect(settings).toBeVisible();
    await expect(settings.getByLabel("Name", { exact: true })).toHaveValue("Half-typed");
  });
});

test.describe("instance rows", () => {
  test("each row carries its 8px instance-hue dot and host · email in mono", async ({ page }) => {
    await stubListed(page, [listed(1, "Ridgeline"), listed(2, "Northwind")]);
    const settings = await openSettings(page);

    const first = settings.getByRole("listitem").filter({ hasText: "Ridgeline" });
    const second = settings.getByRole("listitem").filter({ hasText: "Northwind" });
    await expect(first.locator("[data-row-dot]")).toHaveCSS("width", "8px");
    await expect(first.locator("[data-row-dot]")).toHaveCSS("height", "8px");
    await expect(first.getByRole("img", { name: "Ridgeline" })).toBeVisible();
    expect(await first.locator("[data-row-dot]").evaluate((dot) => dot.style.getPropertyValue("--h"))).toBe("265");
    expect(await second.locator("[data-row-dot]").evaluate((dot) => dot.style.getPropertyValue("--h"))).toBe("175");

    const host = first.locator("[data-row-host]");
    await expect(host).toHaveText("ridgeline.atlassian.net · dion@this.nl");
    await expect(host).toHaveCSS("font-family", /Chivo Mono/);
  });

  test("the row controls are icon buttons with their tooltips, primary on hover, remove failed", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await stubListed(page, [listed(1, "Ridgeline")]);
    const settings = await openSettings(page);
    const row = settings.getByRole("listitem").filter({ hasText: "Ridgeline" });

    for (const [name, words, hover] of [
      ["Test Ridgeline", "test connection", "oklch(0.72 0.19 330)"],
      ["Edit Ridgeline", "edit instance", "oklch(0.72 0.19 330)"],
      ["Remove Ridgeline", "remove instance", "oklch(0.72 0.17 25)"],
    ] as const) {
      const control = row.getByRole("button", { name, exact: true });
      await expect(control.locator("svg")).toHaveAttribute("width", "17");
      await control.hover();
      await expect(control).toHaveCSS("color", hover);
      const id = await control.getAttribute("id");
      await expect(page.locator(`that-tooltip[for="${String(id)}"]`)).toHaveText(words);
      await expect(page.locator(`that-tooltip[for="${String(id)}"]`)).toBeVisible();
    }
  });

  test("a verdict survives closing and reopening, and a reload forgets it", async ({ page }) => {
    await stubListed(page, [listed(1, "Ridgeline")]);
    await page.route("**/api/instances/*/test", (route) =>
      route.fulfill({ status: 200, json: { accountId: "a", displayName: "Dion" } }),
    );
    const settings = await openSettings(page);

    await settings.getByRole("button", { name: "Test Ridgeline" }).click();
    await expect(settings.locator("[data-row-health]")).toHaveText(/^Connected · /);

    await settings.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(settings.locator("[data-row-health]")).toHaveText(/^Connected · /);

    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(settings.locator("[data-row-health]")).toHaveText("Not tested");
  });

  test("a test still running when Settings closes shows its verdict on reopen", async ({ page }) => {
    await stubListed(page, [listed(1, "Ridgeline")]);
    let answer: () => void = () => {};
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    let arrive: () => void = () => {};
    const arrived = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    await page.route("**/api/instances/*/test", async (route) => {
      arrive();
      await answered;
      await route.fulfill({ status: 200, json: { accountId: "a", displayName: "Dion" } });
    });
    const settings = await openSettings(page);

    await settings.getByRole("button", { name: "Test Ridgeline" }).click();
    await arrived;
    await settings.getByRole("button", { name: "Close" }).click();
    const tested = page.waitForResponse("**/api/instances/*/test");
    answer();
    await tested;
    // One more round trip, so the app's own promise chain has settled the verdict.
    await page.evaluate(() => fetch("/api/health").then((response) => response.text()));

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(settings.locator("[data-row-health]")).toHaveText(/^Connected · /);
  });

  test("a test answered after Settings was reopened lands on the reopened row", async ({ page }) => {
    await stubListed(page, [listed(1, "Ridgeline")]);
    let answer: () => void = () => {};
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    let arrive: () => void = () => {};
    const arrived = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    await page.route("**/api/instances/*/test", async (route) => {
      arrive();
      await answered;
      await route.fulfill({ status: 200, json: { accountId: "a", displayName: "Dion" } });
    });
    const settings = await openSettings(page);

    await settings.getByRole("button", { name: "Test Ridgeline" }).click();
    await arrived;
    await settings.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(settings.locator("[data-row-health]")).toHaveText("Not tested");

    answer();
    await expect(settings.locator("[data-row-health]")).toHaveText(/^Connected · /);
  });

  test("a test answered after its instance was removed never lands on the next one given its id", async ({
    page,
  }) => {
    await stubInstancesApi(page, { testStatus: 200 });
    const settings = await openSettings(page);
    await addInstance(page);

    const held = await holdNextRequest(page, "**/api/instances/*/test", "POST");
    await settings.getByRole("button", { name: "Test Work" }).click();
    await held.arrived;

    await settings.getByRole("button", { name: "Remove Work" }).click();
    await confirmDialog(page).getByRole("button", { name: "Remove instance" }).click();
    await expect(settings.getByText("No instances yet. Add one below.")).toBeVisible();

    const tested = page.waitForResponse("**/api/instances/*/test");
    held.release();
    await tested;
    // One more round trip, so the app's own promise chain has settled the late answer.
    await page.evaluate(() => fetch("/api/health").then((response) => response.text()));

    // The stub numbers by list length, so this one is given id 1 again — as SQLite would.
    await addInstance(page);
    await expect(settings.locator("[data-row-health]")).toHaveText("Not tested");
  });

  test("a removed instance's verdict never lands on the next instance given its id", async ({ page }) => {
    await stubInstancesApi(page, { testStatus: 200 });
    const settings = await openSettings(page);
    await addInstance(page);

    await settings.getByRole("button", { name: "Test Work" }).click();
    await expect(settings.locator("[data-row-health]")).toHaveText(/^Connected · /);

    await settings.getByRole("button", { name: "Remove Work" }).click();
    await confirmDialog(page).getByRole("button", { name: "Remove instance" }).click();
    await expect(settings.getByText("No instances yet. Add one below.")).toBeVisible();

    // The stub numbers by list length, so this one is given id 1 again — as SQLite would.
    await addInstance(page);
    await expect(settings.locator("[data-row-health]")).toHaveText("Not tested");
  });
});

test.describe("the instance form", () => {
  test("is an action: hidden at rest, opened by Add an instance, closed by Cancel", async ({ page }) => {
    await stubListed(page, [listed(1, "Ridgeline")]);
    const settings = await openSettings(page);

    await expect(settings.getByLabel("Name", { exact: true })).toHaveCount(0);
    await settings.getByRole("button", { name: "Add an instance" }).click();
    await expect(settings.getByRole("heading", { name: "Add an instance" })).toBeVisible();
    await expect(settings.getByLabel("Name", { exact: true })).toBeFocused();

    await settings.getByRole("button", { name: "Cancel" }).click();
    await expect(settings.getByLabel("Name", { exact: true })).toHaveCount(0);
    await expect(settings.getByRole("button", { name: "Add an instance" })).toBeFocused();
  });

  test("the token's helper line says what happens to it, by mode", async ({ page }) => {
    await stubListed(page, [listed(1, "Ridgeline")]);
    const settings = await openSettings(page);

    await settings.getByRole("button", { name: "Add an instance" }).click();
    await expect(settings.getByLabel("API token", { exact: true })).toHaveAccessibleDescription(
      "Stored encrypted. It is never shown again.",
    );

    await settings.getByRole("button", { name: "Edit Ridgeline" }).click();
    await expect(settings.getByRole("heading", { name: "Edit Ridgeline" })).toBeVisible();
    await expect(settings.getByLabel("API token", { exact: true })).toHaveAccessibleDescription(
      "Leave blank to keep the stored one",
    );
  });

  test("inputs sit at the bottom of their row, so a helper lifts only its own label", async ({ page }) => {
    await stubListed(page, []);
    const settings = await openSettings(page);
    await settings.getByRole("button", { name: "Add an instance" }).click();

    const bottom = async (label: string) => {
      const box = await settings.getByLabel(label, { exact: true }).boundingBox();
      if (!box) throw new Error(`${label} did not lay out`);
      return box.y + box.height;
    };
    const top = async (text: string) => {
      const box = await settings.locator("label", { hasText: text }).boundingBox();
      if (!box) throw new Error(`${text} label did not lay out`);
      return box.y;
    };

    expect(Math.abs((await bottom("Account email")) - (await bottom("API token")))).toBeLessThanOrEqual(1);
    expect(await top("API token")).toBeLessThan(await top("Account email"));
    expect(Math.abs((await bottom("Name")) - (await bottom("Site URL")))).toBeLessThanOrEqual(1);
  });
});
