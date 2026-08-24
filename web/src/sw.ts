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
        await cache.put(path, response);
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

// A cache-first entry is content-addressed or precached-and-static, so the
// cache is trusted first and the network is only a fallback for whatever
// was not (yet) precached.
async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

// index.html, app.css, app.js and navigations change in place, so the
// network is the only source that is always right — see "The request
// classes" in the design doc. cacheKey is passed separately from request
// because a navigation's URL (e.g. /today) is never the cache's own key;
// every navigation instead falls back to the one cached /index.html.
async function networkFirst(request: Request, cacheKey: string): Promise<Response> {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(cacheKey, response.clone());
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

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "/index.html"));
    return;
  }

  const pathname = url.pathname;
  if (pathname === "/index.html" || pathname === "/app.css" || pathname === "/app.js") {
    event.respondWith(networkFirst(request, pathname));
    return;
  }

  if (isHashedChunk(pathname) || isFontOrIcon(pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Everything else — /api/* above all — is left to the browser's own
  // networking. Task 5 (#12) adds the two /api/ request classes here; until
  // then this handler must not call respondWith() for them, both because the
  // design forbids caching the app's own truth and because Playwright's
  // page.route stubs for /api/* only work on requests the worker never
  // claims.
});
