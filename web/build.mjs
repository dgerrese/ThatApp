import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, watch as watchPath } from "node:fs";
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

copyShell();
copyFonts();

if (watch) {
  // Tailwind's own watcher rescans the @source globs, so a class added to
  // index.html or a .ts file rebuilds app.css. `always` is required because
  // plain --watch quits the moment stdin reaches EOF, which it does immediately
  // in a container started by `docker compose up`.
  const css = spawn("npx", [...tailwindArgs, "--watch=always"], { stdio: "inherit" });

  const ctx = await esbuild.context(jsOptions);
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
  await esbuild.build(jsOptions);
}
