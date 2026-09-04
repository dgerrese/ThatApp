import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL(".", import.meta.url));

/** Every source file a class name can hide in: the TypeScript and the shell. */
function sources(): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
        out.push({ path, text: readFileSync(path, "utf8") });
      }
    }
  };
  walk(root);
  const html = fileURLToPath(new URL("../index.html", import.meta.url));
  out.push({ path: html, text: readFileSync(html, "utf8") });
  return out;
}

test("no component carries a radius literal", () => {
  const offenders: string[] = [];
  for (const { path, text } of sources()) {
    for (const match of text.matchAll(/rounded-\[[^\]]+\]/g)) {
      offenders.push(`${path}: ${match[0]}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `every radius refers to a step by name — xs 2, sm 4, md 8:\n${offenders.join("\n")}`,
  );
});

test("the retired ramp step has no callers left", () => {
  const offenders = sources()
    .filter(({ text }) => /\btext-md\b/.test(text))
    .map(({ path }) => path);
  assert.deepEqual(offenders, [], `--text-md was retired onto --text-base:\n${offenders.join("\n")}`);
});
