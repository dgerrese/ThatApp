import { execFileSync } from "node:child_process";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const buildCss = () =>
  execFileSync(
    "npx",
    [
      "@tailwindcss/cli",
      "-i", "src/styles.css",
      "-o", "dist/app.css",
      "--minify",
    ],
    { stdio: "inherit" },
  );

const jsOptions = {
  entryPoints: ["src/main.ts"],
  outfile: "dist/app.js",
  bundle: true,
  format: "esm",
  splitting: false,
  minify: true,
  sourcemap: watch,
  target: ["es2022"],
};

execFileSync("cp", ["index.html", "dist/index.html"], { stdio: "inherit" });
buildCss();

if (watch) {
  const ctx = await esbuild.context(jsOptions);
  await ctx.watch();
  console.log("watching for changes");
} else {
  await esbuild.build(jsOptions);
}
