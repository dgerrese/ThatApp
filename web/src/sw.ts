export {};

declare const self: ServiceWorkerGlobalScope;

// Stamped in by esbuild's `define` from the app build's metafile — see
// build.mjs. Precaching and cache eviction that act on them are #12's tasks 3
// and 4; referenced here, ahead of that, so a build's id and file list are
// inspectable from the worker's own DevTools console rather than compiled
// away as unread.
declare const __WD_PRECACHE__: string[];
declare const __WD_BUILD_ID__: string;
Object.assign(self, { __WD_PRECACHE__, __WD_BUILD_ID__ });

self.addEventListener("install", () => {});
self.addEventListener("activate", () => {});
