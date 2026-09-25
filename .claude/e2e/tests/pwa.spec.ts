import { expect, test, type BrowserContext, type Locator, type Page, type Route } from "@playwright/test";

// This is the one suite whose subject is the worker, so it undoes the rig's
// default block — see the comment on `serviceWorkers` in playwright.config.ts
// for what that default is protecting every other spec from.
test.use({ serviceWorkers: "allow" });

// Today fetches issues on render; the e2e stack shares the dev database, so an
// unstubbed request would fan out to the owner's real Jira instances.
//
// Which level to stub at is not a style choice here. A page route never sees a
// request the worker makes, and the worker now claims /api/issues — a context
// route does see it, on Chromium. So a test that never opens a second page
// stubs at the context level, and its stub holds whoever the request comes
// from rather than resting on the page winning a race with registration.
//
// A test that does open a second page has to stay page-level: a context-level
// route costs any later page in the context its ability to reach its worker for
// a navigation (see the note above the offline-navigation tests), which is the
// one thing those tests exist to show. Two things keep those off real Jira.
// Their first page reads Today exactly once, during the load that registration
// only begins at the end of, so the request being stubbed is the page's own.
// And their second page — the controlled one, whose requests no route on
// Firefox can reach — never renders Today at all.
async function stubIssues(target: Page | BrowserContext): Promise<void> {
  await target.route("**/api/issues", (route) =>
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

/**
 * Resolves once this page's own requests actually go through the worker.
 * Reaching "activated" is not the same thing: clients.claim() has to land, and
 * every assertion about a request class is an assertion about a request the
 * page makes while controlled.
 */
function waitForControllingWorker(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        if (navigator.serviceWorker.controller) {
          resolve();
          return;
        }
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
      }),
  );
}

test("the service worker registered by the app shell reaches activated", async ({ page, context }) => {
  await stubIssues(context);
  await page.goto("/");

  await waitForActivatedWorker(page);
});

test("activation evicts stale caches and leaves exactly the two current-build ones, with the shell holding the shipped files", async ({
  page,
  context,
}) => {
  await stubIssues(context);

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
    await caches.open("that-shell-stale");
    await caches.open("that-data-stale");
  });

  await page.evaluate(() => navigator.serviceWorker.register("/sw.js"));
  await waitForActivatedWorker(page);

  const { cacheNames, shellPaths } = await page.evaluate(async () => {
    const names = await caches.keys();
    const shellName = names.find((name) => name.startsWith("that-shell-") && name !== "that-shell-stale");
    const paths = shellName
      ? (await (await caches.open(shellName)).keys()).map((request) => new URL(request.url).pathname)
      : [];
    return { cacheNames: names, shellPaths: paths };
  });

  // Named, not just counted: a count-only check would still pass if
  // eviction deleted the wrong cache, or deleted nothing and something else
  // happened to keep the total at two.
  expect(cacheNames).not.toContain("that-shell-stale");
  expect(cacheNames).not.toContain("that-data-stale");
  expect(cacheNames).toHaveLength(2);

  // Both remaining cache names carry the same build id: they are the shell
  // and data cache of one build, not leftovers from two.
  const buildIds = cacheNames.map((name) => name.replace(/^that-(shell|data)-/, ""));
  expect(buildIds[0]).toBe(buildIds[1]);
  expect(cacheNames.some((name) => name.startsWith("that-shell-"))).toBe(true);
  expect(cacheNames.some((name) => name.startsWith("that-data-"))).toBe(true);

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

  await stubIssues(context);

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
  await expect(page.locator(".that-rail")).toBeVisible();
  expect(await page.locator("#view > *").count()).toBeGreaterThan(0);
}

// Two things about context.setOffline(true) decide how every test below is
// written.
//
// It reaches the worker's own fetches on Chromium, so there the network arm of
// networkFirst really does fail and the cache arm really is what answers. It
// does NOT reach them on Firefox: measured while adding #12 task 5, an offline
// read of a path the worker claims comes back with a Date header seconds newer
// than the read before it, which only a live response can carry. So on Firefox
// an offline assertion shows that a request the worker does *not* claim fails,
// and cannot show what the worker serves from cache.
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
// the same limitation the two tests below are skipped for.
test("a same-page reload with the server unreachable re-serves the cached shell", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "aborting the worker's own fetches is Chromium-only — see comment above");

  await stubIssues(context);
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

test("a cold navigation to settings renders the shell while offline", async ({
  page,
  context,
  browserName,
}) => {
  // Firefox's worker keeps reaching the live server under setOffline, so the
  // shell would come back off the network there and this test's green would say
  // nothing about the cache — coverage its name claims. Cold navigation to
  // /settings and /week over a reachable server is settings.spec.ts's and
  // smoke.spec.ts's job, on both engines.
  test.skip(browserName !== "chromium", "only Chromium honours setOffline for the worker's own fetch — see above");

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
  //
  // The second address is /week and not /today, and that is not arbitrary. This
  // page is worker-controlled from its first byte, so a Today render here would
  // put GET /api/issues in the worker's hands — and a request the worker makes
  // is invisible to page.route on both engines and to context.route on Firefox,
  // where setOffline does not reach it either. It would go out live, to a server
  // sharing the dev database, and fan out to the owner's real Jira instances.
  // /week has no view in this build, so the router renders its placeholder and
  // fetches nothing, while still being a second real navigation to an address
  // nothing has ever requested — which is all this test needs of it.
  const cold = await context.newPage();
  await cold.goto("/settings");
  await expectShellRendered(cold);

  await cold.goto("/week");
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
  await expect(cold.locator(".that-rail")).toHaveCount(0);
});

test("a navigation to an /api/ path is never answered with the app shell", async ({ page, context }) => {
  await stubIssues(page);
  await page.goto("/today");
  await waitForActivatedWorker(page);

  // The ordinary way to check the server is up, and it still works.
  await page.goto("/api/health");
  expect(await page.evaluate(() => document.body.textContent)).toContain("ok");

  await context.setOffline(true);

  // An /api/ address nothing has fetched, so the browser's own HTTP cache has no
  // copy to answer with: offline this navigation must simply fail. The app shell
  // coming back under an /api/ address is what claiming every navigate-mode
  // request produces, since an endpoint name has no extension either. The two
  // Jira reads are the only /api/ paths the worker claims at all, and this is
  // not one of them.
  const cold = await context.newPage();
  await cold.goto("/api/no-such-endpoint").catch(() => undefined);
  await expect(cold.locator(".that-rail")).toHaveCount(0);
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

  // The reload below happens with the worker in control, so Today's own
  // /api/issues request comes from the worker and a page route would not see
  // it. Chromium is the one engine where a context route does.
  await stubIssues(context);
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

// A token no bundle contains by accident. The first version of this test used
// "lie", which "client", "believe" and "applied" all contain — #102.
const POISON = "THATAPP-POISON-SENTINEL-7f3a";

test("a runtime response whose content type contradicts its path is served but never cached", async ({
  page,
  context,
  browserName,
}) => {
  // Same Chromium-only constraint as the rebuild test above: routing a URL
  // the active worker itself fetches is unreliable in Firefox.
  test.skip(browserName !== "chromium", "routing a URL the active worker fetches is unreliable in Firefox");

  await stubIssues(context);
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
    return route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><title>${POISON}</title>`,
    });
  });

  // A direct fetch, not a reload: the lying response is still served as-is
  // to whoever asked for it (only the cache write is guarded), so this
  // would break a page that loaded it as a script — the assertion below
  // only needs the response body, not a working page.
  const served = await page.evaluate(async () => (await fetch("/app.js")).text());
  expect(served).toContain(POISON);

  const cacheKeptTheGoodCopy = await page.evaluate(async (poison) => {
    const shellName = (await caches.keys()).find((name) => name.startsWith("that-shell-"));
    if (!shellName) return false;
    const cached = await (await caches.open(shellName)).match("/app.js");
    if (!cached) return false;
    return !(await cached.text()).includes(poison);
  }, POISON);
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

test("a cache-first miss answered by the SPA fallback is served but never cached", async ({
  page,
  context,
}) => {
  await stubIssues(context);
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
    const shellName = (await caches.keys()).find((name) => name.startsWith("that-shell-"));
    if (!shellName) return "no shell cache";
    const cached = await (await caches.open(shellName)).match("/chunk-0000000000000000.js");
    return cached ? "cached" : "not cached";
  });
  expect(cachedUnderTheChunkName).toBe("not cached");
});

// ---------------------------------------------------------------------------
// The two /api/ request classes.
//
// What each engine can show here was measured, not assumed. Under
// context.setOffline(true) Firefox keeps letting the *worker's own* fetch
// reach the server: an offline read of a path the worker claims comes back
// with a Date header seconds newer than the one before it, so the network arm
// never fails and the cache fallback is never taken. Routing does not reach a
// Firefox worker's fetch either (see the rebuild test above). Between them
// that leaves no way to make the worker's network attempt fail on Firefox, so
// every assertion about serving from cache is Chromium-only — stated here
// rather than left to look like coverage this rig does not have.
//
// What Firefox does show is the class boundary: because its worker's fetch
// still succeeds offline, a path the worker claims answers 200 while a path it
// does not claim fails outright. That is exactly the fourth class, and the last
// two tests assert it on both engines.

async function readThroughWorker(
  page: Page,
  url: string,
): Promise<{ status: number; body: string; stamp: string | null }> {
  return page.evaluate(async (target) => {
    const response = await fetch(target);
    return {
      status: response.status,
      body: await response.text(),
      stamp: response.headers.get("X-THAT-Cached-At"),
    };
  }, url);
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

test("the pinned issues come back from cache, stamped with when they were stored, once the server is unreachable", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "a Firefox worker's own fetch cannot be made to fail in this rig — see above");

  // The stub is what keeps this off the owner's real Jira instances, and
  // changing what it answers is what stands in for the server going away.
  // ?refresh=1 below is the one spelling of GET /api/pins that makes the server
  // fan out to every pinned issue's instance, and a request the worker makes is
  // invisible to page.route — so nothing weaker than a context route on the
  // path may stand between this test and the real thing. A URL predicate rather
  // than a glob because a glob is matched against the whole URL, query string
  // included, and would miss the refresh spelling.
  let serverIsGone = false;
  await context.route(
    (url) => url.pathname === "/api/pins",
    async (route) => {
      if (serverIsGone) {
        await route.abort("failed");
        return;
      }
      await route.fulfill({ status: 200, json: [{ id: 1, key: "WORK-1" }] });
    },
  );

  // Settings, not Today: Settings reads only /api/instances, so nothing here
  // needs the assigned-issues list stubbed.
  await page.goto("/settings");
  await waitForActivatedWorker(page);
  await waitForControllingWorker(page);

  const live = await readThroughWorker(page, "/api/pins");
  expect(live.status).toBe(200);
  // A body off the wire is the current truth and must never be marked stale.
  // Task 6 reads this header to decide, so its absence carries as much as its
  // presence does.
  expect(live.stamp).toBeNull();

  serverIsGone = true;

  const offline = await readThroughWorker(page, "/api/pins");
  expect(offline.status).toBe(200);
  expect(offline.body).toBe(live.body);
  // Nothing but the worker can produce this header, so neither the stub nor the
  // browser's own HTTP cache can stand in for it.
  expect(offline.stamp).toMatch(ISO_UTC);

  // Today's Refresh asks for /api/pins?refresh=1. That query tells the server to
  // re-poll Jira; it does not name a different list. Nothing has ever fetched
  // this spelling, so only a cache keyed on the path can answer it, and a
  // refresh made with the server unreachable must fall back to the same copy
  // rather than finding nothing of its own.
  const refreshed = await readThroughWorker(page, "/api/pins?refresh=1");
  expect(refreshed.body).toBe(live.body);
  expect(refreshed.stamp).toBe(offline.stamp);
});

test("the assigned issues come back from cache, stamped, once the server is unreachable", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "a Firefox worker's own fetch cannot be made to fail in this rig — see above");

  // The stub is what keeps this off the owner's real Jira instances, and
  // changing what it answers is what stands in for the server's own moods: a
  // context route reaches the worker's own fetch on Chromium, which is the
  // whole reason this test is Chromium-only twice over.
  let serverIs: "healthy" | "erroring" | "gone" = "healthy";
  await context.route("**/api/issues", async (route) => {
    if (serverIs === "gone") {
      await route.abort("failed");
      return;
    }
    if (serverIs === "erroring") {
      await route.fulfill({ status: 500, json: { code: "internal", message: "boom" } });
      return;
    }
    await route.fulfill({ status: 200, json: { instances: [{ instanceId: 1, issues: [] }] } });
  });

  await page.goto("/settings");
  await waitForActivatedWorker(page);
  await waitForControllingWorker(page);

  const live = await readThroughWorker(page, "/api/issues");
  expect(live.status).toBe(200);
  expect(live.stamp).toBeNull();

  // A 500 is an answer, not a lost connection: it is handed straight back,
  // unstamped, and must not overwrite the last body that was actually a list.
  serverIs = "erroring";
  const errored = await readThroughWorker(page, "/api/issues");
  expect(errored.status).toBe(500);
  expect(errored.stamp).toBeNull();

  serverIs = "gone";
  const offline = await readThroughWorker(page, "/api/issues");
  expect(offline.status).toBe(200);
  expect(offline.body).toBe(live.body);
  expect(offline.stamp).toMatch(ISO_UTC);
});

/** The stubbed ticket's own summary span — scoped to the tag, because #143
 *  gave every summary a cut-text tooltip carrying the same text, which a
 *  bare `getByText` would match too. The tooltip is a `that-tooltip`
 *  element, never a `span`, so the tag alone excludes it. */
function shipItSummary(page: Page): Locator {
  return page.locator('span:text-is("Ship it")');
}

// Shared by every test below that needs Today already showing the stale
// banner: goes live, then unreachable, and hands back a server switch plus a
// count of every request that reached the route (aborted or fulfilled) —
// what the "one read" test needs to prove a return costs exactly one fetch.
async function openTodayStale(
  page: Page,
  context: BrowserContext,
): Promise<{ setServer: (state: "healthy" | "gone") => void; issueReads: () => number; warning: Locator }> {
  let serverIs: "healthy" | "gone" = "healthy";
  let reads = 0;
  await context.route("**/api/issues", async (route) => {
    reads += 1;
    if (serverIs === "gone") {
      await route.abort("failed");
      return;
    }
    await route.fulfill({
      status: 200,
      json: {
        instances: [
          {
            id: 1,
            name: "Work",
            issues: [
              { key: "THAT-1", summary: "Ship it", status: "In Progress", url: "https://example.test/WD-1" },
            ],
            error: null,
          },
        ],
      },
    });
  });

  // The first load's own /api/issues request can land before clients.claim()
  // takes effect, in which case the worker never sees it and nothing is
  // cached — the same reason the fetch-level tests above wait for a
  // controlling worker before making the request they need cached. A reload
  // once the worker already controls the page is what guarantees this one
  // goes through it.
  await page.goto("/today");
  await waitForActivatedWorker(page);
  await waitForControllingWorker(page);
  await page.reload();
  await waitForControllingWorker(page);

  await expect(shipItSummary(page)).toBeVisible();
  const warning = page.getByText(/Showing what was here at \d{2}:\d{2} — no connection to the server\./);
  await expect(warning).toBeHidden();

  // A further reload takes /api/issues back through the worker's
  // network-first fetch, which now fails and falls back to the cache the
  // live load above populated.
  serverIs = "gone";
  await page.reload();
  await waitForControllingWorker(page);

  // The list itself must survive under the banner — the cached fallback, not
  // an empty screen, is what "stale" means.
  await expect(shipItSummary(page)).toBeVisible();

  return {
    setServer: (state) => {
      serverIs = state;
    },
    issueReads: () => reads,
    warning,
  };
}

// Task 7's own coverage: the same server-unreachable/cache-fallback mechanism
// the two tests above prove at the fetch level, now proven at the view level
// — the warning names a time and clears on "online" with no reload. Chromium
// -only for the same reason: only there can the worker's own /api/issues
// fetch be made to fail.
test("the assigned-issues warning names a time while the server is unreachable, and clears on 'online' without a reload", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "a Firefox worker's own fetch cannot be made to fail in this rig — see above");

  const stale = await openTodayStale(page, context);
  await expect(stale.warning).toBeVisible();

  // The server recovering, plus the same event the browser itself fires: this
  // is what proves the view's own "online" listener re-runs the refresh,
  // rather than a manual reload standing in for it.
  stale.setServer("healthy");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  // Both assertions, not just the warning: refreshResults' catch branch also
  // clears the warning on a genuine failure (today.ts's error path), so
  // "hidden" alone cannot tell a real recovery from a fetch that threw and
  // wiped the list along with it. The list surviving is what pins this to the
  // success path specifically.
  await expect(stale.warning).toBeHidden();
  await expect(shipItSummary(page)).toBeVisible();
});

// #71: "online" only fires when the network itself recovers, so a server that
// restarts while the network stayed up needs a second trigger — coming back
// to the tab.
for (const [trigger, dispatch] of [
  ["the tab becoming visible", () => document.dispatchEvent(new Event("visibilitychange"))],
  ["the window regaining focus", () => window.dispatchEvent(new Event("focus"))],
] as const) {
  test(`the stale warning clears on ${trigger} once the server answers again`, async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium", "a Firefox worker's own fetch cannot be made to fail in this rig — see above");
    const stale = await openTodayStale(page, context);
    await expect(stale.warning).toBeVisible();

    stale.setServer("healthy");
    await page.evaluate(dispatch);

    await expect(stale.warning).toBeHidden();
    await expect(shipItSummary(page)).toBeVisible();
  });
}

test("the stale warning stays when coming back finds the server still gone, and one return costs one read", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "a Firefox worker's own fetch cannot be made to fail in this rig — see above");
  const stale = await openTodayStale(page, context);
  await expect(stale.warning).toBeVisible();
  const before = stale.issueReads();

  // Dispatched together, as a real return to the window delivers both — but
  // not in one task: the two fire as separate, back-to-back tasks. What
  // coalesces them into one refresh is handleReturn's own guard, via
  // refreshEverything disabling Refresh synchronously before the second
  // event's handler can run.
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });

  await expect.poll(() => stale.issueReads()).toBe(before + 1);
  await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
  expect(stale.issueReads()).toBe(before + 1);
  await expect(stale.warning).toBeVisible();
});

test("an /api/ read outside the two Jira lists is never answered from cache", async ({ page, context }) => {
  await page.goto("/settings");
  await waitForActivatedWorker(page);
  await waitForControllingWorker(page);

  // A successful online read of both classes, so whatever the worker was ever
  // going to store for either, it has stored by now.
  const instances = await readThroughWorker(page, "/api/instances");
  expect(instances.status).toBe(200);
  expect(instances.stamp).toBeNull();
  expect((await readThroughWorker(page, "/api/pins")).status).toBe(200);

  await context.setOffline(true);

  // Spelled with a query nothing has ever fetched, so the browser's own HTTP
  // cache has no entry to answer with — and since the worker's data cache is
  // keyed on the path, this spelling would still find the entry if
  // /api/instances had been stored. It has to fail.
  const denied = await page.evaluate(() =>
    fetch("/api/instances?cold=1")
      .then((response) => `resolved ${response.status}`)
      .catch(() => "rejected"),
  );
  expect(denied).toBe("rejected");

  // The same page, the same moment, still gets its Jira list: what separates
  // the two is the request class, not the state of the connection.
  expect((await readThroughWorker(page, "/api/pins")).status).toBe(200);
});

test("a write attempted with the server unreachable fails and is never replayed once it is back", async ({
  page,
  context,
}) => {
  await page.goto("/settings");
  await waitForActivatedWorker(page);
  await waitForControllingWorker(page);

  // Stocks the data cache with a Jira list first. It is not what this test is
  // about — it is what would let a worker that mistook a write for a read
  // answer the POST below with a body instead of failing, so without it the
  // test cannot tell a correct worker from one that never checked the method.
  expect((await readThroughWorker(page, "/api/pins")).status).toBe(200);

  let writesSeen = 0;
  // Registered before the blanket abort, so it is what matches once the abort
  // is lifted. It fulfils rather than continuing: a replay that did happen must
  // be counted here and must never reach the owner's real database.
  await context.route("**/api/pins", async (route) => {
    if (route.request().method() === "POST") {
      writesSeen += 1;
      await route.fulfill({ status: 201, json: { id: 1 } });
      return;
    }
    await route.fallback();
  });

  const abortEverything = (route: Route): Promise<void> => route.abort("failed");
  await context.route("**/*", abortEverything);

  const attempt = await page.evaluate(() =>
    fetch("/api/pins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId: 1, issueKey: "THAT-1" }),
    })
      .then((response) => `resolved ${response.status}`)
      .catch(() => "rejected"),
  );

  // Not "resolved 202": a worker that took the write to replay later would have
  // to answer the caller with something, and the view would report a save that
  // never happened. Failing is the contract — api.ts turns this into
  // ApiError(0, "network_error") and the view already says so.
  expect(attempt).toBe("rejected");
  expect(writesSeen).toBe(0);

  await context.unroute("**/*", abortEverything);

  // A reload with the connection back is the fullest chance a queue could ask
  // for: the document reloads through the worker, main.ts runs again, and the
  // worker sees a fresh client.
  await page.reload();
  await waitForControllingWorker(page);
  expect(await page.evaluate(() => fetch("/api/health").then((response) => response.text()))).toContain("ok");

  expect(writesSeen).toBe(0);
});
