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

// Two things about context.setOffline(true) decide how every test below is
// written.
//
// It does reach the worker's own fetches as well as the page's, on both engines,
// so the network arm of networkFirst really does fail and the cache arm really
// is what answers.
//
// It does not reach either browser's own HTTP cache. A URL some page in the
// context already fetched can still be answered from there, worker or no worker,
// so going offline and revisiting a warm URL proves nothing about sw.ts. Every
// assertion below is therefore either about a URL nothing in its context has
// fetched, or about *what* came back rather than that anything came back at all.

// A reload is its own code path — a fresh page that goto()s is not the same
// thing as a page reloading the document it is already showing — and it is the
// one the spec's "the shell survives a reload while offline" describes.
//
// It is Chromium-only, and not for want of trying. page.reload() under
// context.setOffline(true) never reaches the worker on either engine: the
// navigation is failed before the fetch handler is dispatched, which shows up as
// NS_ERROR_OFFLINE on Firefox and ERR_FAILED on Chromium. What made it look
// green in an earlier revision was reloading /today, which the browser's own
// HTTP cache could still answer. Aborting every route instead of going offline
// does reach the worker's own fetches, and that is Chromium-only in Playwright —
// the same limitation the two tests below are skipped for. The worker's
// navigate branch is exercised on Firefox by the cold-navigation test above.
test("a same-page reload with the server unreachable re-serves the cached shell", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "aborting the worker's own fetches is Chromium-only — see comment above");

  await stubIssues(page);
  await page.goto("/today");
  await waitForActivatedWorker(page);

  // Routed client-side to Settings before the server goes away: the address
  // changes but nothing fetches /settings, so there is no HTTP cache entry for
  // the reload below to be answered from and the worker is the only thing that
  // can serve it. exact: true disambiguates from Today's own "Open Settings"
  // link, on screen in the no-instances state stubIssues produces.
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);

  await context.route("**/*", (route) => route.abort("failed"));
  await page.reload();

  await expectShellRendered(page);
});

test("a cold navigation to settings renders the shell while offline", async ({ page, context }) => {
  await stubIssues(page);
  await page.goto("/today");
  await waitForActivatedWorker(page);

  await context.setOffline(true);

  // Settings first, on a page that has never been to it and in a context where
  // nothing has fetched it — deliberately the order an earlier revision of this
  // test avoided. Nothing but the worker can answer /settings here: there is no
  // HTTP cache entry for it and no network. Real navigations, not client-side
  // routing, so this exercises the worker for two distinct URLs and proves the
  // one cached /index.html stands in for either address.
  const cold = await context.newPage();
  await cold.goto("/settings");
  await expectShellRendered(cold);

  await cold.goto("/today");
  await expectShellRendered(cold);
});

test("a navigation to a path that names a file is never answered with the app shell", async ({ page, context }) => {
  await stubIssues(page);
  await page.goto("/today");
  await waitForActivatedWorker(page);

  await context.setOffline(true);

  // manifest.json, sw.js and a stale chunk all reduce to this once the worker has
  // had its say: a navigation naming a file nothing claims, which offline simply
  // fails. The app shell must never come back under such an address, and that is
  // exactly what claiming every navigate-mode request produces. A name nothing
  // has ever requested, so the browser's own HTTP cache has no copy to answer
  // with and only the worker's behaviour decides the outcome.
  const cold = await context.newPage();
  await cold.goto("/a-file-this-build-never-shipped.png").catch(() => undefined);
  await expect(cold.locator(".wd-rail")).toHaveCount(0);
});

test("a navigation to an /api/ path is never claimed by the worker", async ({ page, context }) => {
  await page.goto("/today");
  await waitForActivatedWorker(page);

  // The ordinary way to check the server is up, and it still works.
  await page.goto("/api/health");
  expect(await page.evaluate(() => document.body.textContent)).toContain("ok");

  await context.setOffline(true);

  // An /api/ address nothing has fetched, so the browser's own HTTP cache has no
  // copy to answer with: offline this navigation must simply fail. The app shell
  // coming back under an /api/ address is what claiming every navigate-mode
  // request produces, since an endpoint name has no extension either. Task 5
  // (#12) adds the /api/ request classes; until then the worker must not call
  // respondWith() for anything under /api/ at all.
  const cold = await context.newPage();
  await cold.goto("/api/no-such-endpoint").catch(() => undefined);
  await expect(cold.locator(".wd-rail")).toHaveCount(0);
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

test("a runtime response whose content type contradicts its path is served but never cached", async ({
  page,
  context,
  browserName,
}) => {
  // Same Chromium-only constraint as the rebuild test above: routing a URL
  // the active worker itself fetches is unreliable in Firefox.
  test.skip(browserName !== "chromium", "routing a URL the active worker fetches is unreliable in Firefox");

  await stubIssues(page);
  await page.goto("/today");
  await waitForActivatedWorker(page);

  // The exact shape handleAsset's SPA fallback produces for a chunk or
  // unhashed file gone missing mid-rebuild: 200, but the wrong Content-Type
  // for the path asked for. install already refuses to cache this
  // (precacheShell, sw.ts); this proves the runtime path refuses too.
  await context.route("**/app.js", (route) => {
    if (!route.request().serviceWorker()) {
      return route.continue();
    }
    return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>lie</title>" });
  });

  // A direct fetch, not a reload: the lying response is still served as-is
  // to whoever asked for it (only the cache write is guarded), so this
  // would break a page that loaded it as a script — the assertion below
  // only needs the response body, not a working page.
  const served = await page.evaluate(async () => (await fetch("/app.js")).text());
  expect(served).toContain("lie");

  const cacheKeptTheGoodCopy = await page.evaluate(async () => {
    const shellName = (await caches.keys()).find((name) => name.startsWith("wd-shell-"));
    if (!shellName) return false;
    const cached = await (await caches.open(shellName)).match("/app.js");
    if (!cached) return false;
    return !(await cached.text()).includes("lie");
  });
  expect(cacheKeptTheGoodCopy).toBe(true);
});

test("a plain fetch of index.html leaves the shell cache usable for navigations", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "only Chromium refuses a redirected response for a navigation — see withoutRedirectHistory in sw.ts",
  );

  await stubIssues(page);
  await page.goto("/today");
  await waitForActivatedWorker(page);

  // handleAsset redirects /index.html to ./, so this response arrives with its
  // redirected flag set, and networkFirst writes it straight to the one entry
  // every offline navigation falls back to. A worker may not answer a
  // navigation with a redirected response, so storing one here breaks the whole
  // offline fallback — and it breaks it nowhere near the fetch that did it.
  await page.evaluate(() => fetch("/index.html").then((response) => response.text()));

  await context.route("**/*", (route) => route.abort("failed"));

  const cold = await context.newPage();
  await cold.goto("/settings");
  await expectShellRendered(cold);
});

test("a cache-first miss answered by the SPA fallback is served but never cached", async ({ page, browserName }) => {
  test.skip(
    browserName !== "chromium",
    "window.caches throws SecurityError in this rig's Firefox — see the comment above the eviction test",
  );

  await stubIssues(page);
  await page.goto("/today");
  await waitForActivatedWorker(page);

  // No such chunk was ever built, so handleAsset answers it with index.html —
  // 200, text/html, under a .js name. This is the real fallback, not a routed
  // stub: it is exactly what a chunk request lands in during a dev rebuild
  // window, and it is the lie install already refuses to precache.
  const served = await page.evaluate(async () => {
    const response = await fetch("/chunk-0000000000000000.js");
    return { status: response.status, contentType: response.headers.get("Content-Type") ?? "" };
  });
  expect(served.status).toBe(200);
  expect(served.contentType).toContain("html");

  const cachedUnderTheChunkName = await page.evaluate(async () => {
    const shellName = (await caches.keys()).find((name) => name.startsWith("wd-shell-"));
    if (!shellName) return "no shell cache";
    const cached = await (await caches.open(shellName)).match("/chunk-0000000000000000.js");
    return cached ? "cached" : "not cached";
  });
  expect(cachedUnderTheChunkName).toBe("not cached");
});
