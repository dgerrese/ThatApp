import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanDir } from "../tools/clean-dir.mjs";

function withTempDir(body: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "clean-dir-"));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("removes files and nested subdirectories", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "chunk-A.js"), "x");
    mkdirSync(join(dir, "fonts", "deep"), { recursive: true });
    writeFileSync(join(dir, "fonts", "deep", "f.woff2"), "x");

    cleanDir(dir);

    assert.deepEqual(readdirSync(dir), []);
  });
});

test("keeps the names it is told to keep", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, ".gitkeep"), "");
    writeFileSync(join(dir, "chunk-A.js"), "x");

    cleanDir(dir, [".gitkeep"]);

    assert.deepEqual(readdirSync(dir), [".gitkeep"]);
  });
});

test("a missing directory is left missing and does not throw", () => {
  withTempDir((dir) => {
    const missing = join(dir, "nope");

    cleanDir(missing, [".gitkeep"]);

    assert.equal(existsSync(missing), false);
  });
});
