import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, watch as watchPath } from "node:fs";
import { createHash } from "node:crypto";
import * as esbuild from "esbuild";
import { reachableFiles } from "./tools/reachable-files.mjs";

const watch = process.argv.includes("--watch");

const tailwindArgs = [
  "@tailwindcss/cli",
  "-i", "src/styles.css",
  "-o", "dist/app.css",
  "--minify",
];

// Each copy* returns the dist/ paths it wrote: buildWorker() unions them with
// what it finds by walking dist/app.js's own import graph, because a precache
// list or a build id built from that graph alone would never see these files
// — see the request-class table in
// docs/superpowers/specs/2026-08-24-pwa-shell-design.md.
const copyShell = () => {
  copyFileSync("index.html", "dist/index.html");
  return ["dist/index.html"];
};

// Chivo is served from our own origin: #12 makes this an offline PWA
// and a font on someone else's host would not survive it. esbuild and Tailwind
// only emit what they are given, so the files are copied rather than bundled;
// //go:embed all:dist then carries them into the binary with no change there.
const copyFonts = () => {
  mkdirSync("dist/fonts", { recursive: true });
  return readdirSync("fonts").map((file) => {
    copyFileSync(`fonts/${file}`, `dist/fonts/${file}`);
    return `dist/fonts/${file}`;
  });
};

// The committed PNGs and SVGs in web/icons/ are pre-rendered, not built — see
// web/icons/README.md. README.md itself is source-only and stays out of dist/.
const copyIcons = () => {
  mkdirSync("dist/icons", { recursive: true });
  return readdirSync("icons")
    .filter((file) => file !== "README.md")
    .map((file) => {
      copyFileSync(`icons/${file}`, `dist/icons/${file}`);
      return `dist/icons/${file}`;
    });
};

const copyManifest = () => {
  copyFileSync("manifest.json", "dist/manifest.json");
  return ["dist/manifest.json"];
};

const jsOptions = {
  entryPoints: ["src/main.ts"],
  // outdir, not outfile: code splitting emits chunks alongside the entry, and
  // esbuild rejects outfile when splitting is on. entryNames keeps the entry at
  // dist/app.js so index.html needs no change.
  outdir: "dist",
  entryNames: "app",
  chunkNames: "chunk-[hash]",
  bundle: true,
  format: "esm",
  // Views load through dynamic import(). Without splitting, esbuild inlines
  // them into the entry bundle and the lazy loading is a lie.
  splitting: true,
  minify: true,
  sourcemap: watch,
  target: ["es2022"],
};

const workerOptions = {
  entryPoints: ["src/sw.ts"],
  outfile: "dist/sw.js",
  bundle: true,
  format: "iife",
  splitting: false,
  minify: true,
  sourcemap: watch,
  target: ["es2022"],
};

// Chunk filenames carry esbuild's own content hash, so the precache list and
// the build id that names its caches (#12 tasks 3-4) are derived from what
// actually shipped rather than hand-written, which would rot the first time a
// view is added. reachableFiles walks dist/app.js's own import graph on disk
// rather than trusting a captured esbuild metafile: in watch mode, a
// sw.ts-only rebuild had no fresh metafile of its own and reused a stale one
// captured by the last app rebuild, so an out-of-watcher `make build-web`
// could leave the worker precaching chunks the current dist/app.js does not
// import (#67). assetPaths covers everything copied or written outside
// esbuild (the shell, app.css, fonts, icons, the manifest) — the request-class
// table in docs/superpowers/specs/2026-08-24-pwa-shell-design.md needs both
// cached. Sorted before hashing so the id depends only on content, not on
// filesystem enumeration order.
const buildWorker = async (assetPaths) => {
  const { files, missing } = reachableFiles("app.js", (file) => {
    try {
      return readFileSync(`dist/${file}`, "utf8");
    } catch {
      return undefined;
    }
  });
  if (missing.length > 0) {
    const detail = missing.map(({ file, from }) => `${file} (imported by ${from})`).join(", ");
    throw new Error(`precache: dist/app.js reaches files that are not on disk: ${detail}`);
  }

  const outputs = [...files.map((file) => `dist/${file}`), ...assetPaths].sort();
  const hash = createHash("sha256");
  for (const file of outputs) {
    hash.update(readFileSync(file));
  }

  await esbuild.build({
    ...workerOptions,
    define: {
      __WD_PRECACHE__: JSON.stringify(outputs.map((file) => `/${file.slice("dist/".length)}`)),
      __WD_BUILD_ID__: JSON.stringify(hash.digest("hex").slice(0, 16)),
    },
  });
};

const assetPaths = [...copyShell(), ...copyFonts(), ...copyIcons(), ...copyManifest(), "dist/app.css"];

if (watch) {
  // One blocking pass before handing off to the watcher below: buildWorker()
  // now reads dist/app.css too, and without this it does not exist yet when
  // esbuild's own initial build fires the rebuild-worker plugin.
  execFileSync("npx", tailwindArgs, { stdio: "inherit" });

  // Tailwind's own watcher rescans the @source globs, so a class added to
  // index.html or a .ts file rebuilds app.css. `always` is required because
  // plain --watch quits the moment stdin reaches EOF, which it does immediately
  // in a container started by `docker compose up`.
  const css = spawn("npx", [...tailwindArgs, "--watch=always"], { stdio: "inherit" });

  // esbuild's own watcher rebuilds the app on every source edit; without this
  // hook the worker was only ever built once, at startup, and dist/sw.js
  // would name superseded chunk hashes from the first dev edit onward. Errors
  // are logged rather than thrown so a bad edit doesn't kill the watcher.
  const rebuildWorkerPlugin = {
    name: "rebuild-worker",
    setup(build) {
      build.onEnd(() =>
        buildWorker(assetPaths).catch((err) => {
          console.error(err.message);
        }),
      );
    },
  };
  const ctx = await esbuild.context({ ...jsOptions, plugins: [rebuildWorkerPlugin] });
  await ctx.watch();

  // Watch the directory rather than the file: editors that save by writing a
  // temporary file and renaming it over the original would orphan a file watch.
  let pending;
  watchPath(".", (_event, filename) => {
    if (filename !== "index.html") return;
    clearTimeout(pending);
    pending = setTimeout(() => {
      try {
        copyShell();
      } catch (err) {
        console.error(`copying index.html into dist/ failed: ${err.message}`);
      }
    }, 50);
  });

  // sw.ts is bundled on its own (see workerOptions), not part of main.ts's
  // dependency graph, so the esbuild watcher above never rebuilds it — a
  // sw.ts-only edit under a long-running `make up` left dist/sw.js stale
  // indefinitely (found the hard way in #12 task 4: hours of a Playwright
  // rig behaving as if the worker had no fetch handler, because it still
  // didn't). Same directory-not-file watch reasoning as index.html's, above.
  let pendingWorker;
  watchPath("src", (_event, filename) => {
    if (filename !== "sw.ts") return;
    clearTimeout(pendingWorker);
    pendingWorker = setTimeout(() => {
      buildWorker(assetPaths).catch((err) => {
        console.error(`rebuilding sw.ts failed: ${err.message}`);
      });
    }, 50);
  });

  const stop = () => {
    css.kill();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  console.log("watching for changes");
} else {
  execFileSync("npx", tailwindArgs, { stdio: "inherit" });
  await esbuild.build(jsOptions);
  await buildWorker(assetPaths);
}
