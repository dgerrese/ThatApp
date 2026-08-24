import { expect, test, type Page } from "@playwright/test";

// "/" leads to Today, which fetches on render; the e2e stack shares the dev
// database, so an unstubbed request would fan out to real Jira instances.
async function stubIssues(page: Page): Promise<void> {
  await page.route("**/api/issues", (route) =>
    route.fulfill({ status: 200, json: { instances: [] } }),
  );
}

// Resolves once the registration active for this page's scope reaches
// "activated" — the point at which install's precache and activate's cache
// eviction have both completed (they gate the state transition themselves,
// via event.waitUntil).
function waitForActivatedWorker(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        navigator.serviceWorker.ready
          .then((registration) => {
            const worker = registration.active;
            if (!worker) {
              reject(new Error("ready resolved without an active worker"));
              return;
            }
            if (worker.state === "activated") {
              resolve();
              return;
            }
            worker.addEventListener("statechange", () => {
              if (worker.state === "activated") resolve();
            });
          })
          .catch(reject);
      }),
  );
}

test("the service worker registered by the app shell reaches activated", async ({ page }) => {
  await stubIssues(page);
  await page.goto("/");

  await waitForActivatedWorker(page);
});

// window.caches is unavailable to this test in Firefox: under this rig's
// http-as-secure-context workaround (see playwright.config.ts), Firefox
// throws "The operation is insecure." from the page's CacheStorage binding
// specifically, even though the worker's own self.caches — what install()
// and activate() actually use — is unaffected by it. The "reaches activated"
// test above already proves that on Firefox too: activation is gated on
// precacheShell() and evictStaleCaches() resolving, so a worker that
// activates has necessarily opened and populated both caches correctly.
// This test asserts the cache contents directly and needs window.caches to
// do it, so it is Chromium-only.
test("activation leaves exactly the two current-build caches, with the shell holding the shipped files", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "window.caches throws SecurityError in this rig's Firefox — see comment above",
  );

  await stubIssues(page);
  await page.goto("/");
  await waitForActivatedWorker(page);

  const { cacheNames, shellPaths } = await page.evaluate(async () => {
    const names = await caches.keys();
    const shellName = names.find((name) => name.startsWith("wd-shell-"));
    const paths = shellName
      ? (await (await caches.open(shellName)).keys()).map((request) => new URL(request.url).pathname)
      : [];
    return { cacheNames: names, shellPaths: paths };
  });

  // Both cache names carry the same build id: they are the shell and data
  // cache of one build, not leftovers from two.
  expect(cacheNames).toHaveLength(2);
  const buildIds = cacheNames.map((name) => name.replace(/^wd-(shell|data)-/, ""));
  expect(buildIds[0]).toBe(buildIds[1]);
  expect(cacheNames.some((name) => name.startsWith("wd-shell-"))).toBe(true);
  expect(cacheNames.some((name) => name.startsWith("wd-data-"))).toBe(true);

  expect(shellPaths).toEqual(expect.arrayContaining(["/index.html", "/app.css", "/app.js"]));
  // Chunk filenames carry esbuild's content hash and are not known ahead of
  // time — see build.mjs — so this asserts the shape of at least one rather
  // than a specific name.
  expect(shellPaths.some((path) => /^\/chunk-[^/]+\.js$/.test(path))).toBe(true);
});

// Playwright's page.route does not see requests a service worker makes for
// itself (its install-time precache fetches included), so the mismatch here
// is staged with context.route filtered to request.serviceWorker() — which
// Playwright documents as Chromium-only (it reports null in other browsers),
// so this test is skipped on Firefox rather than passing without exercising
// the check it exists to catch.
test("install rejects a precache entry that answers HTML under a .js name, leaving no shell cache", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "request.serviceWorker() — needed to target only the worker's own fetch — is Chromium-only in Playwright",
  );

  await stubIssues(page);

  await context.route("**/app.js", async (route) => {
    if (route.request().serviceWorker()) {
      // The worker's own precache fetch: this is exactly the response shape
      // handleAsset's SPA fallback produces for a chunk that went missing —
      // 200, HTML, under the .js name the worker asked for.
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>fallback</title>",
      });
      return;
    }
    // The page's own <script> load of the real bundle: replaced with a
    // no-op module so main.ts's auto-registration on "load" never fires and
    // races the explicit register() call below — this test wants exactly
    // one, deterministic install attempt.
    await route.fulfill({ status: 200, contentType: "application/javascript", body: "export {};" });
  });

  await page.goto("/");

  const finalState = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register("/sw.js");
    const worker = registration.installing;
    if (!worker) throw new Error("register() resolved without an installing worker");
    if (worker.state === "redundant") return worker.state;
    return new Promise<string>((resolve) => {
      worker.addEventListener("statechange", () => {
        if (worker.state === "redundant") resolve(worker.state);
      });
    });
  });

  expect(finalState).toBe("redundant");

  const remainingCaches = await page.evaluate(() => caches.keys());
  expect(remainingCaches).toEqual([]);
});
