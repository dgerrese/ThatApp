export {};

declare const self: ServiceWorkerGlobalScope;

// Stamped in by esbuild's `define` from the app build's metafile — see
// build.mjs. Also exposed on self so a build's id and file list are
// inspectable from the worker's own DevTools console.
declare const __WD_PRECACHE__: string[];
declare const __WD_BUILD_ID__: string;
Object.assign(self, { __WD_PRECACHE__, __WD_BUILD_ID__ });

const SHELL_CACHE = `wd-shell-${__WD_BUILD_ID__}`;
const DATA_CACHE = `wd-data-${__WD_BUILD_ID__}`;

// One row per extension the build ships. A mismatch here is what
// handleAsset's index.html fallback would otherwise produce for anything
// missing — chunk, manifest, font or icon alike — a 200 of HTML wearing that
// extension's name. See "What it precaches" in
// docs/superpowers/specs/2026-08-24-pwa-shell-design.md. Substrings, not
// exact types, because http.ServeFileFS answers with a charset suffix on
// text types (e.g. "text/css; charset=utf-8") and manifest.json is served as
// "application/manifest+json", not "application/json".
const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  js: "javascript",
  css: "css",
  html: "html",
  json: "json",
  woff2: "font",
  svg: "svg",
  png: "png",
};

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
}

function answersAsExpectedType(path: string, contentType: string | null): boolean {
  const expected = EXTENSION_CONTENT_TYPES[extensionOf(path)];
  return expected === undefined || (contentType ?? "").toLowerCase().includes(expected);
}

// A worker may not answer a *navigation* with a response whose redirected flag
// is set — the browser rejects it outright ("the service worker navigation
// response redirected flag is set"). Go's http.ServeFileFS redirects any path
// ending in /index.html to ./, so the precache fetch for /index.html — the one
// entry every offline navigation falls back to — comes back redirected, and
// caching it as-is makes the entire offline fallback fail. Chromium enforces
// the rule and the navigation dies with ERR_FAILED; Firefox does not, which is
// what let this hide as a rig quirk. Re-wrapping loses nothing: status,
// headers and body are carried over, only the redirect history is dropped.
function withoutRedirectHistory(response: Response): Response {
  if (!response.redirected) return response;
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

// Fetches every precache entry and rejects the whole install if one answers
// the wrong Content-Type, rather than caching a lie that would only surface
// later as a syntax error in a view that used to work. A rejected install
// leaves nothing behind — the half-populated cache is deleted before the
// error propagates — so the previous worker keeps serving.
async function precacheShell(): Promise<void> {
  const cache = await caches.open(SHELL_CACHE);
  try {
    await Promise.all(
      __WD_PRECACHE__.map(async (path) => {
        const response = await fetch(path, { cache: "no-store" });
        const contentType = response.headers.get("Content-Type");
        if (!response.ok || !answersAsExpectedType(path, contentType)) {
          throw new Error(
            `refusing to precache ${path}: answered ${response.status} ${contentType ?? "(no content-type)"}`,
          );
        }
        await cache.put(path, withoutRedirectHistory(response));
      }),
    );
  } catch (err) {
    await caches.delete(SHELL_CACHE);
    throw err;
  }
}

// Old shells and old data caches alike are evicted — a shell from a new
// build must never render a body cached from an old response shape, see
// "Updating" in the design doc. The current build's data cache is opened
// here, empty, so it exists from activation onward for #12's task 5 to
// write into.
async function evictStaleCaches(): Promise<void> {
  const names = await caches.keys();
  await Promise.all(
    names.filter((name) => name !== SHELL_CACHE && name !== DATA_CACHE).map((name) => caches.delete(name)),
  );
  await caches.open(DATA_CACHE);
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(evictStaleCaches().then(() => self.clients.claim()));
});

// Chunk filenames carry esbuild's content hash (see build.mjs's chunkNames),
// so a name that matches can never change meaning under it.
function isHashedChunk(pathname: string): boolean {
  return /^\/chunk-[^/]+\.js$/.test(pathname);
}

function isFontOrIcon(pathname: string): boolean {
  return pathname.startsWith("/fonts/") || pathname.startsWith("/icons/");
}

// /today, /settings, / and any unknown path — the addresses handleAsset
// answers with the app shell. Every file this build ships carries an
// extension (.html, .css, .js, .woff2, .png, .svg, .json, and sw.js), and no
// view's address has one, so naming a file is what separates "a navigation to
// a view" from "someone opened an asset in its own tab". Only the first may
// be answered from the /index.html the shell cache holds.
function isAppRoute(pathname: string): boolean {
  return !/\.[^/]+$/.test(pathname);
}

// A cache-first entry is content-addressed or precached-and-static, so the
// cache is trusted first and the network is only a fallback for whatever
// was not (yet) precached. Guarded by the same content-type check install
// uses (see EXTENSION_CONTENT_TYPES above): a lying response is still
// returned to the caller, but never written into the cache, for the same
// reason precacheShell refuses to cache one — handleAsset answers any
// missing path with a 200 of index.html, and a runtime request can land in
// that window (a dev rebuild not yet finished writing dist/) just as easily
// as an install-time one can.
async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  const pathname = new URL(request.url).pathname;
  if (response.ok && answersAsExpectedType(pathname, response.headers.get("Content-Type"))) {
    await cache.put(request, withoutRedirectHistory(response.clone()));
  }
  return response;
}

// index.html, app.css, app.js and navigations change in place, so the
// network is the only source that is always right — see "The request
// classes" in the design doc. cacheKey is passed separately from request
// because a navigation's URL (e.g. /today) is never the cache's own key;
// every navigation instead falls back to the one cached /index.html. The
// content-type check is against cacheKey, not request's own URL, for the
// same reason: a navigation's response is checked as if it were index.html,
// which is the type it is actually stored — and served back — as.
async function networkFirst(request: Request, cacheKey: string): Promise<Response> {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && answersAsExpectedType(cacheKey, response.headers.get("Content-Type"))) {
      await cache.put(cacheKey, withoutRedirectHistory(response.clone()));
    }
    return response;
  } catch (err) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const pathname = url.pathname;

  // Never claimed, never cached — including a top-level navigation to
  // /api/health, the ordinary way to check the server is up. It names no file,
  // so isAppRoute below would otherwise take it for a view and answer it from
  // the shell cache whenever the server is unreachable. Task 5 (#12) adds the
  // two /api/ request classes; until then this handler must not call
  // respondWith() for anything under /api/, both because the design forbids
  // caching the app's own truth and because Playwright's page.route stubs for
  // /api/* only work on requests the worker never claims.
  if (pathname.startsWith("/api/")) return;

  // request.mode says nothing about what was asked for, so the mode alone is
  // not enough to claim a request for the shell: an icon, a font or the
  // manifest opened in its own tab is a navigation too, and answering one from
  // the /index.html the shell cache holds serves HTML under a .png address.
  if (request.mode === "navigate" && isAppRoute(pathname)) {
    event.respondWith(networkFirst(request, "/index.html"));
    return;
  }

  if (pathname === "/index.html" || pathname === "/app.css" || pathname === "/app.js") {
    event.respondWith(networkFirst(request, pathname));
    return;
  }

  if (isHashedChunk(pathname) || isFontOrIcon(pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Everything else falls through to the browser's own networking.
});
