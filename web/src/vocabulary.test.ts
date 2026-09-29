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

test("no component steps off the five-step ruler by name", () => {
  // @theme extends Tailwind's default theme rather than replacing it, so
  // rounded-2xl, -3xl and -4xl still resolve — to values this language never
  // approved. That is a name away from the arbitrary-value literal the test
  // above already forbids, and it is not caught by it.
  const ALLOWED = new Set(["xs", "sm", "md", "lg", "xl", "full", "none"]);
  const SIDE = "tl|tr|br|bl|ss|se|ee|es|t|r|b|l|s|e";
  const namedSize = new RegExp(`\\brounded(?:-(?:${SIDE}))?-([a-zA-Z0-9]+)`, "g");

  const offenders: string[] = [];
  for (const { path, text } of sources()) {
    for (const match of text.matchAll(namedSize)) {
      if (!ALLOWED.has(match[1]!)) offenders.push(`${path}: ${match[0]}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `every radius names a step on the ruler — xs, sm, md, lg, xl, full, none:\n${offenders.join("\n")}`,
  );
});

test("the retired ramp step has no callers left", () => {
  const offenders = sources()
    .filter(({ text }) => /\btext-md\b/.test(text))
    .map(({ path }) => path);
  assert.deepEqual(
    offenders,
    [],
    `--text-md was retired onto --text-base:\n${offenders.join("\n")}`,
  );
});

test("a hover paints the wash, not a ground", () => {
  const offenders: string[] = [];
  for (const { path, text } of sources()) {
    for (const match of text.matchAll(/hover:bg-(surface|raised)\b/g)) {
      offenders.push(`${path}: ${match[0]}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `hover uses --color-hover, not a ground token:\n${offenders.join("\n")}`,
  );
});

test("no typed character stands in for a drawn mark", () => {
  const offenders: string[] = [];
  for (const { path, text } of sources()) {
    // Punctuation is deliberately absent from this list: an em dash meaning "no
    // value" and a middot between two facts are typography, not icons. The
    // opening delimiter is captured and matched again on the way out, so a
    // stray apostrophe or an unrelated backtick many lines later can never
    // close a match that a different delimiter opened — only newlines are
    // excluded, which is what stops one string or comment reaching into
    // another's. Backtick stays in the set: icons.ts itself builds markup with
    // backtick template literals, and a typed glyph landing in one must still
    // be caught.
    for (const match of text.matchAll(/(["'`])[^\n]*?[●▲×−✓✗←→↗][^\n]*?\1/g)) {
      offenders.push(`${path}: ${match[0]}`);
    }
  }
  assert.deepEqual(offenders, [], `every mark is drawn:\n${offenders.join("\n")}`);
});

/**
 * True when the ±600-character window around an iconMarkup() call carries
 * neither an aria-label nor a visible-text assignment.
 *
 * ponytail: a textContent = belonging to an unrelated nearby element can
 * make this pass wrongly; a DOM-based check would close that gap.
 */
function iconLabelMissing(window: string): boolean {
  return !/aria-label|ariaLabel|setAttribute\("aria-label"|\btextContent\s*=/.test(window);
}

test("iconLabelMissing reads the window around an iconMarkup() call", () => {
  const cases: Array<[string, string, boolean]> = [
    ["icon only, no label", 'x.innerHTML = iconMarkup("fetch", 17);', true],
    [
      "icon with aria-label",
      'b.setAttribute("aria-label", "Fetch"); m.innerHTML = iconMarkup("fetch", 17);',
      false,
    ],
    [
      "icon with visible text",
      'm.innerHTML = iconMarkup("fetch", 17); t.textContent = label;',
      false,
    ],
  ];
  for (const [name, window, expected] of cases) {
    assert.equal(iconLabelMissing(window), expected, name);
  }
});

test("a control whose only content is a drawn mark carries its own label", () => {
  const offenders: string[] = [];
  for (const { path, text } of sources()) {
    // A button that inserts icon markup and nothing else. The label has to come
    // from aria-label, because the mark itself is aria-hidden by construction.
    // The lookbehind excludes iconMarkup's own declaration in icons.ts, which
    // matches the same text without being a call.
    for (const match of text.matchAll(/(?<!function )iconMarkup\(/g)) {
      const window = text.slice(Math.max(0, match.index - 600), match.index + 600);
      if (iconLabelMissing(window)) {
        offenders.push(`${path}: an iconMarkup() call with no aria-label within 600 characters`);
      }
    }
  }
  assert.deepEqual(offenders, [], `every icon-only control names itself:\n${offenders.join("\n")}`);
});
