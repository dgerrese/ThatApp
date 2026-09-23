import { test } from "node:test";
import assert from "node:assert/strict";
import { reachableFiles } from "../tools/reachable-files.mjs";

function reader(files: Record<string, string>): (file: string) => string | undefined {
  return (file) => files[file];
}

test("static, bare and dynamic imports are all followed, transitively", () => {
  const result = reachableFiles(
    "app.js",
    reader({
      "app.js": 'import{C as e}from"./chunk-A.js";import"./chunk-B.js";import("./chunk-C.js");',
      "chunk-A.js": 'var x=()=>import("./chunk-D.js");',
      "chunk-B.js": "",
      "chunk-C.js": 'export{y}from"./chunk-A.js";',
      "chunk-D.js": "",
    }),
  );

  assert.deepEqual(result.files, [
    "app.js",
    "chunk-A.js",
    "chunk-B.js",
    "chunk-C.js",
    "chunk-D.js",
  ]);
  assert.deepEqual(result.missing, []);
});

test("a chunk on disk that nothing imports is not precached", () => {
  const result = reachableFiles(
    "app.js",
    reader({ "app.js": 'import"./chunk-A.js";', "chunk-A.js": "", "chunk-STALE.js": "" }),
  );

  assert.deepEqual(result.files, ["app.js", "chunk-A.js"]);
});

test("an import of a file that is not on disk is reported with who imported it", () => {
  const result = reachableFiles("app.js", reader({ "app.js": 'import("./chunk-GONE.js");' }));

  assert.deepEqual(result.missing, [{ file: "chunk-GONE.js", from: "app.js" }]);
  assert.deepEqual(result.files, ["app.js"]);
});
