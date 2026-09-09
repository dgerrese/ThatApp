import { test } from "node:test";
import assert from "node:assert/strict";
import { unconsumedTokens } from "../tools/unused-tokens.mjs";

test("a token used only by another token in @theme is consumed", () => {
  const css = `@theme {\n  --color-ring: oklch(0.9 0 0);\n  --shadow-card: inset 0 0 0 1px var(--color-ring);\n}`;
  assert.deepEqual(unconsumedTokens(css, ["body { box-shadow: var(--shadow-card); }"]), []);
});

test("a token named only in a test file is not consumed", () => {
  const css = `@theme {\n  --color-pending-rail: oklch(0.8 0.13 85);\n}`;
  assert.deepEqual(unconsumedTokens(css, []), ["--color-pending-rail"]);
});

test("a Tailwind utility class counts as a consumer", () => {
  const css = `@theme {\n  --color-pending-rail: oklch(0.8 0.13 85);\n}`;
  assert.deepEqual(unconsumedTokens(css, ['<span class="text-pending-rail">']), []);
});
