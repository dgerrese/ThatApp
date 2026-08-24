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

// The two extensions the design cares about: a mismatch here is what
// handleAsset's index.html fallback would otherwise produce for a missing
// chunk — 200 HTML wearing a .js or .css name. See "What it precaches" in
// docs/superpowers/specs/2026-08-24-pwa-shell-design.md.
const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  js: "javascript",
  css: "css",
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
