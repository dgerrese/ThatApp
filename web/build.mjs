import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, watch as watchPath } from "node:fs";
import { createHash } from "node:crypto";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const tailwindArgs = [
  "@tailwindcss/cli",
  "-i", "src/styles.css",
  "-o", "dist/app.css",
  "--minify",
];

const copyShell = () => copyFileSync("index.html", "dist/index.html");

// Space Grotesk is served from our own origin: #12 makes this an offline PWA
// and a font on someone else's host would not survive it. esbuild and Tailwind
// only emit what they are given, so the files are copied rather than bundled;
// //go:embed all:dist then carries them into the binary with no change there.
const copyFonts = () => {
  mkdirSync("dist/fonts", { recursive: true });
  for (const file of readdirSync("fonts")) {
    copyFileSync(`fonts/${file}`, `dist/fonts/${file}`);
  }
};

// The committed PNGs and SVGs in web/icons/ are pre-rendered, not built — see
// web/icons/README.md. README.md itself is source-only and stays out of dist/.
const copyIcons = () => {
  mkdirSync("dist/icons", { recursive: true });
  for (const file of readdirSync("icons")) {
    if (file === "README.md") continue;
    copyFileSync(`icons/${file}`, `dist/icons/${file}`);
  }
};

const copyManifest = () => copyFileSync("manifest.json", "dist/manifest.json");

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
  // Read after the build to derive the worker's precache list and build id —
  // see buildWorker().
  metafile: true,
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
// the build id that names its caches (#12 tasks 3-4) are derived from the app
// build's own outputs rather than hand-written, which would rot the first
// time a view is added. Source maps are excluded: they are a dev aid, not an
// asset the worker should own offline.
const buildWorker = async (metafile) => {
  const outputs = Object.keys(metafile.outputs)
    .filter((file) => !file.endsWith(".map"))
    .sort();
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

copyShell();
copyFonts();
copyIcons();
copyManifest();

if (watch) {
  // Tailwind's own watcher rescans the @source globs, so a class added to
  // index.html or a .ts file rebuilds app.css. `always` is required because
  // plain --watch quits the moment stdin reaches EOF, which it does immediately
  // in a container started by `docker compose up`.
  const css = spawn("npx", [...tailwindArgs, "--watch=always"], { stdio: "inherit" });

  const ctx = await esbuild.context(jsOptions);
  const { metafile } = await ctx.rebuild();
  await buildWorker(metafile);
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

  const stop = () => {
    css.kill();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  console.log("watching for changes");
} else {
  execFileSync("npx", tailwindArgs, { stdio: "inherit" });
  const { metafile } = await esbuild.build(jsOptions);
  await buildWorker(metafile);
}
