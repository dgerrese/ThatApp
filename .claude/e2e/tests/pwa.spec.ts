import { expect, test, type BrowserContext, type Page } from "@playwright/test";

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
test("activation evicts stale caches and leaves exactly the two current-build ones, with the shell holding the shipped files", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "window.caches throws SecurityError in this rig's Firefox — see comment above",
  );

  await stubIssues(page);

  // main.ts's own auto-registration on "load" would race the stale-cache
  // seeding below — it must land before this page's worker installs and
  // activates. Replacing the page's own bundle with a no-op removes that
  // race; the worker's own precache fetch for /app.js is unaffected, since
  // this stubs the URL for every requester, not just the page's <script>.
  await context.route("**/app.js", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: "export {};" }),
  );

  await page.goto("/");

  // Caches a previous build would have left behind — evictStaleCaches must
  // delete both, shell and data alike, not just leave them uncontested
  // because nothing this test does happens to collide with the current
  // build's own two names.
  await page.evaluate(async () => {
    await caches.open("wd-shell-stale");
    await caches.open("wd-data-stale");
  });

  await page.evaluate(() => navigator.serviceWorker.register("/sw.js"));
  await waitForActivatedWorker(page);

  const { cacheNames, shellPaths } = await page.evaluate(async () => {
    const names = await caches.keys();
    const shellName = names.find((name) => name.startsWith("wd-shell-") && name !== "wd-shell-stale");
    const paths = shellName
      ? (await (await caches.open(shellName)).keys()).map((request) => new URL(request.url).pathname)
      : [];
    return { cacheNames: names, shellPaths: paths };
  });

  // Named, not just counted: a count-only check would still pass if
  // eviction deleted the wrong cache, or deleted nothing and something else
  // happened to keep the total at two.
  expect(cacheNames).not.toContain("wd-shell-stale");
  expect(cacheNames).not.toContain("wd-data-stale");
  expect(cacheNames).toHaveLength(2);

  // Both remaining cache names carry the same build id: they are the shell
  // and data cache of one build, not leftovers from two.
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

// The rail is static shell markup and the view container gets at least one
// child synchronously — both today.ts and settings.ts append their DOM
// before awaiting any fetch — so checking for content here does not depend
// on /api/* succeeding, which task 4 deliberately leaves uncached.
async function expectShellRendered(page: Page): Promise<void> {
  await expect(page.locator(".wd-rail")).toBeVisible();
  expect(await page.locator("#view > *").count()).toBeGreaterThan(0);
}

// Registering ANY Playwright route on a page — even one that never matches a
// URL involved below, even later removed with unroute() — leaves that page's
// CDP/BiDi session unable to reach its own service worker for a later
// navigation made while context.setOffline(true) is active: the navigation
// fails outright (net::ERR_FAILED on Chromium, NS_ERROR_OFFLINE on Firefox)
// before the worker's fetch handler ever runs, confirmed by a direct A/B
// probe (a sibling page with no route ever registered, same context, same
// origin, succeeds every time). The service worker and its caches are scoped
// to the origin, not the page, so a second, never-routed page in the same
// context sees the same activated worker and the same precached shell
// without registering or precaching anything itself. This is the shape 2
// escape hatch from the brief's rig-hazard warning, aimed one layer deeper
// than the page.route-stub-bypass it named: not "the worker steals traffic
// page.route wants", but "page.route poisons a page's own future offline
// navigations", which is why setOffline(true) is used here alongside a
// second page instead of `serviceWorkers: 'block'`.
async function newUnroutedPage(context: BrowserContext): Promise<Page> {
  return context.newPage();
}

test("the shell survives a reload while offline", async ({ page, context }) => {
  await stubIssues(page);
  await page.goto("/today");
  await waitForActivatedWorker(page);

  await context.setOffline(true);

  const shellPage = await newUnroutedPage(context);
  await shellPage.goto("/today");

  await expectShellRendered(shellPage);
});

test("today and settings each survive a full navigation while offline", async ({ page, context }) => {
  await stubIssues(page);
  await page.goto("/today");
  await waitForActivatedWorker(page);

  await context.setOffline(true);

  // Real navigations (goto), not client-side routing: this exercises the
  // worker's navigate-mode handler for two distinct URLs, both of which the
  // server would answer with the SPA fallback if it were reachable — proving
  // the cached /index.html stands in for either address, not just the one
  // last loaded.
  const shellPage = await newUnroutedPage(context);
  await shellPage.goto("/today");
  await expectShellRendered(shellPage);

  await shellPage.goto("/settings");
  await expectShellRendered(shellPage);
});

test("a rebuild's app.js is what the next load takes, not the cached one", async ({ page, context, browserName }) => {
  // route.request().serviceWorker() — used below to prove the fulfilled
  // response actually answered the worker's own fetch, not a request that
  // slipped past it — is Chromium-only in Playwright (also the reason task
  // 3's negative install test is Chromium-only). On Firefox, a route
  // targeting a URL the active worker also fetches does not intercept the
  // worker's attempt at all: the request reaches the real server untouched,
  // which is a Playwright/Firefox routing gap, not a sw.ts defect — the same
  // networkFirst code path is what task 4's offline tests already prove
  // correct on both engines.
  test.skip(browserName !== "chromium", "routing a URL the active worker fetches is unreliable in Firefox");

  await stubIssues(page);
  await page.goto("/today");
  await waitForActivatedWorker(page);

  // Simulates `go run -tags dev` serving a freshly rebuilt bundle: index.html
  // is untouched, only what /app.js answers changes. If the worker cached
  // app.js first, this reload would still run the old bundle and the marker
  // below would never be set.
  await context.route("**/app.js", (route) => {
    if (!route.request().serviceWorker()) {
      return route.continue();
    }
    return route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "export {}; window.__wd_rebuilt = true;",
    });
  });

  await page.reload();

  expect(
    await page.evaluate(() => (window as unknown as { __wd_rebuilt?: boolean }).__wd_rebuilt),
  ).toBe(true);
});
