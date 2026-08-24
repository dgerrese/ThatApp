import { expect, test, type Page } from "@playwright/test";

// "/" leads to Today, which fetches on render; the e2e stack shares the dev
// database, so an unstubbed request would fan out to real Jira instances.
async function stubIssues(page: Page): Promise<void> {
  await page.route("**/api/issues", (route) =>
    route.fulfill({ status: 200, json: { instances: [] } }),
  );
}

test("the service worker registered by the app shell reaches activated", async ({ page }) => {
  await stubIssues(page);
  await page.goto("/");

  const state = await page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        navigator.serviceWorker.ready
          .then((registration) => {
            const worker = registration.active;
            if (!worker) {
              reject(new Error("ready resolved without an active worker"));
              return;
            }
            if (worker.state === "activated") {
              resolve(worker.state);
              return;
            }
            worker.addEventListener("statechange", () => {
              if (worker.state === "activated") resolve(worker.state);
            });
          })
          .catch(reject);
      }),
  );

  expect(state).toBe("activated");
});
