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
      json: { code: "credentials_rejected", message: "Jira rejected the email and API token" },
    });
  });

  let deletes = 0;

  // A single path segment, so this never catches /api/instances/{id}/test.
  await page.route("**/api/instances/*", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.fallback();
      return;
    }

    const id = Number(new URL(route.request().url()).pathname.split("/").pop());
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

  // exact: true disambiguates from the shell's persistent "Work Dashboard"
  // heading, which the default substring match would otherwise also resolve.
  await expect(page.getByText("Work", { exact: true })).toBeVisible();
  await expect(page.getByText("me@example.com · https://example.atlassian.net")).toBeVisible();
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

  await expect(page.getByText("Jira rejected the email and API token")).toBeVisible();
  await expect(page.getByText("Connected as")).toBeHidden();
});

test("settings is reachable from the shell nav", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/");

  // exact: true disambiguates from the placeholder's "Open Settings" link,
  // which is also on screen at "/" and whose accessible name contains
  // "Settings" as a substring.
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
