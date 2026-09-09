import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FAMILIES = ["color", "text", "radius", "font", "shadow", "breakpoint"];

/**
 * Every `--family-key: value;` declared directly inside the stylesheet's
 * `@theme` block. Declarations may span several lines — `--shadow-card` is
 * one comma-separated value ending in a single trailing `;` — so the value is
 * read up to the next `;` rather than to the end of the line.
 */
function themeDeclarations(css) {
  const block = css.match(/@theme\s*{([\s\S]*?)\n}/);
  if (!block) return { body: "", declarations: [] };

  const declarations = [...block[1].matchAll(/--([a-z][a-z0-9-]*):\s*([\s\S]*?);/g)].map(([, name, value]) => ({
    name,
    value,
  }));

  return { body: block[1], declarations };
}

function familyAndKey(name) {
  const family = FAMILIES.find((f) => name.startsWith(`${f}-`));

  return family ? { family, key: name.slice(family.length + 1) } : null;
}

/**
 * A Tailwind or `var()` consumer form for one token, precise enough not to
 * match a *longer* token's own class — `bg-primary` must not read `bg-primary-rail`
 * as its own consumer, so every class pattern refuses a trailing `-` or word
 * character rather than stopping at Tailwind's own hyphens.
 */
function isConsumed(haystack, family, key) {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`var\\(--${family}-${k}\\)`).test(haystack)) return true;

  switch (family) {
    case "color":
      return new RegExp(
        `\\b(?:text|bg|border|fill|stroke|ring|outline|decoration|divide|accent|caret|placeholder|from|via|to|shadow)-${k}(?![\\w-])`,
      ).test(haystack);
    case "text":
      return new RegExp(`\\btext-${k}(?![\\w-])`).test(haystack);
    case "radius":
      return new RegExp(`\\brounded(?:-[a-z]+)?-${k}(?![\\w-])`).test(haystack);
    case "font":
      return new RegExp(`\\bfont-${k}(?![\\w-])`).test(haystack);
    case "shadow":
      return new RegExp(`\\bshadow-${k}(?![\\w-])`).test(haystack);
    case "breakpoint":
      return new RegExp(`\\b${k}:`).test(haystack);
    default:
      return false;
  }
}

/**
 * The tokens `@theme` declares that nothing outside the allowlist consumes.
 * `css` is the stylesheet's own text; `sources` are the other files the
 * matching table names (`index.html`, `*.ts` excluding `*.test.ts`) — the
 * caller decides what counts as a source, this function only matches.
 *
 * A token referenced by `var(--x)` inside another token's own `@theme` value
 * counts as consumed regardless of whether that other token has an outside
 * consumer of its own: `--color-edge-ring` is used only by `--shadow-card`,
 * and without this rule the lint's first run is a false positive.
 */
export function unconsumedTokens(css, sources) {
  const { body, declarations } = themeDeclarations(css);

  const referencedInTheme = new Set();
  for (const { value } of declarations) {
    for (const match of value.matchAll(/var\(--([a-z0-9-]+)\)/g)) {
      referencedInTheme.add(match[1]);
    }
  }

  const outsideTheme = body ? css.replace(body, "") : css;
  const haystack = [outsideTheme, ...sources].join("\n");

  const orphans = [];
  for (const { name } of declarations) {
    if (referencedInTheme.has(name)) continue;
    const parsed = familyAndKey(name);
    if (!parsed) continue;
    if (isConsumed(haystack, parsed.family, parsed.key)) continue;
    orphans.push(`--${name}`);
  }

  return orphans;
}

function listSourceFiles(dir) {
  return readdirSync(dir, { recursive: true })
    .filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"))
    .map((entry) => path.join(dir, entry));
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${path.resolve(process.argv[1])}`;

if (isMain) {
  const css = readFileSync("src/styles.css", "utf8");
  const sourcePaths = ["index.html", ...listSourceFiles("src")];
  const sources = sourcePaths.map((file) => readFileSync(file, "utf8"));

  const allowlistPath = fileURLToPath(new URL("./token-allowlist.json", import.meta.url));
  const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));

  const orphans = unconsumedTokens(css, sources).filter((name) => !(name in allowlist));

  for (const name of orphans) {
    console.error(name);
  }
  if (orphans.length > 0) {
    process.exitCode = 1;
  }
}
