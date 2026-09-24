import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

/**
 * The declared value of a token, as written. `light-dark(a, b)` yields the pair
 * in that order — light first, which is how the function is defined and the
 * opposite of the order the design is authored in.
 */
function token(name: string): { light: string; dark: string } {
  const match = css.match(new RegExp(`^\\s*--${name}:\\s*([^;]+);`, "m"));
  assert.ok(match, `token --${name} is not declared in styles.css`);
  const raw = match[1]!.replace(/\s+/g, " ").trim();
  const pair = raw.match(/^light-dark\(\s*(.+?)\s*,\s*(.+?)\s*\)$/);
  return pair ? { light: pair[1]!, dark: pair[2]! } : { light: raw, dark: raw };
}

function oklch(value: string): [number, number, number] {
  const m = value.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  assert.ok(m, `not a plain oklch() colour: ${value}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Relative luminance, by the same route the spec's measured table took: OKLCh to
 * OKLab, to LMS, to linear sRGB, clamped to gamut. Luminance is computed on the
 * linear values, so no transfer function is applied.
 */
function luminance(value: string): number {
  const [L, C, h] = oklch(value);
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const r = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const bl = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

function contrast(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_FLOOR = 4.5;
const MARK_FLOOR = 3;

/** Every pair the spec's measured table calls text, in both themes. */
const textPairs: Array<[string, string, "light" | "dark"]> = [
  ["ink", "surface", "dark"],
  ["ink", "raised", "dark"],
  ["ink-muted", "surface", "dark"],
  ["ink-muted", "raised", "dark"],
  ["running", "raised", "dark"],
  ["pending", "raised", "dark"],
  ["failed", "raised", "dark"],
  ["ink", "surface", "light"],
  ["ink", "raised", "light"],
  ["ink-muted", "surface", "light"],
  ["ink-muted", "raised", "light"],
  ["running", "raised", "light"],
  ["pending", "raised", "light"],
  ["failed", "raised", "light"],
  ["primary", "surface", "light"],
];

test("every text pair clears 4.5:1 in the theme it is used in", () => {
  for (const [fg, bg, theme] of textPairs) {
    const ratio = contrast(token(`color-${fg}`)[theme], token(`color-${bg}`)[theme]);
    assert.ok(
      ratio >= TEXT_FLOOR,
      `${theme}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, below ${TEXT_FLOOR}`,
    );
  }
});

test("the rail's own pairs clear their floors, and the rail is one value", () => {
  const rail = token("color-rail");
  assert.equal(rail.light, rail.dark, "the rail carries one set of tones in both themes");
  for (const name of [
    "rail-ink",
    "rail-muted",
    "primary-rail",
    "running-rail",
    "pending-rail",
    "failed-rail",
  ]) {
    const ratio = contrast(token(`color-${name}`).dark, rail.dark);
    assert.ok(ratio >= TEXT_FLOOR, `${name} on the rail is ${ratio.toFixed(2)}:1`);
  }
});

test("the light primary is why the -rail variant exists", () => {
  const ratio = contrast(token("color-primary").light, token("color-rail").light);
  assert.ok(
    ratio < TEXT_FLOOR,
    `the light primary now clears ${ratio.toFixed(2)}:1 on the rail. If that is deliberate, ` +
      `--color-primary-rail can be reconsidered — see decision 2 in the spec.`,
  );
});

test("ink-faint clears the mark floor and fails the text floor, in both themes", () => {
  for (const theme of ["light", "dark"] as const) {
    const ratio = contrast(token("color-ink-faint")[theme], token("color-raised")[theme]);
    assert.ok(
      ratio >= MARK_FLOOR,
      `${theme}: ink-faint is ${ratio.toFixed(2)}:1, below the mark floor`,
    );
    assert.ok(
      ratio < TEXT_FLOOR,
      `${theme}: ink-faint now clears the text floor — the comment on it is wrong`,
    );
  }
});

/**
 * Decision 2. The rail separates from the page by value alone, and nothing else
 * enforces the distance: no contrast floor applies to it, because it is
 * decorative. Changing either number is a change to that decision.
 */
test("the rail stands 0.073 below the dark page, by value alone", () => {
  const railL = oklch(token("color-rail").dark)[0];
  const surfaceL = oklch(token("color-surface").dark)[0];
  assert.equal(
    railL,
    0.105,
    "the rail's lightness is decision 2 — see the spec before changing it",
  );
  assert.equal(
    surfaceL,
    0.178,
    "the dark page's lightness is decision 2 — see the spec before changing it",
  );
});

test("the retired ramp step is gone and the ramp starts at 12px", () => {
  assert.ok(!/--text-md:/.test(css), "--text-md was retired onto --text-base");
  assert.match(css, /--text-xs:\s*12px/);
  assert.match(css, /--text-sm:\s*13px/);
  assert.match(css, /--text-base:\s*14px/);
});

test("the root declares dark before light", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /color-scheme:\s*dark light/);
});

test("styles.css never carries a two-value color-scheme", () => {
  // The build's minifier reorders a two-value color-scheme, reversing the
  // dark-before-light decision — see index.html, where it is inlined instead.
  // Matched per declaration rather than across the file: a pattern that lets
  // whitespace span lines finds the newline after `light;` and the brace after
  // it, and reports a single-value declaration as a pair.
  for (const match of css.matchAll(/color-scheme:([^;\n]*)/g)) {
    const value = match[1] ?? "";
    assert.doesNotMatch(
      value.trim(),
      /\s/,
      `styles.css declares "color-scheme:${value}" — a two-value one belongs in index.html`,
    );
  }
});

test("light defines a surface by its edge, dark by depth", () => {
  const ring = token("color-edge-ring");
  assert.equal(ring.dark, "transparent", "dark has no hairline: its shadows already define a card");
  assert.notEqual(
    ring.light,
    "transparent",
    "light needs the hairline — a card is 0.023 off its page",
  );
  for (const name of ["shadow-card", "shadow-popover", "shadow-dialog"]) {
    assert.match(css, new RegExp(`--${name}:`), `--${name} is declared`);
  }
  assert.match(css, /--shadow-card:[^;]*inset 0 0 0 1px var\(--color-edge-ring\)/s);
});

test("the ring belongs to the card alone — a bordered surface takes no ring of its own", () => {
  // The popover and the dialog both carry a real border already, which is the
  // same hairline by another mechanism; a ring on top of it would double the
  // line in light, where the ring and the border resolve to the same colour.
  for (const name of ["shadow-popover", "shadow-dialog"]) {
    const declaration = css.match(new RegExp(`--${name}:([^;]+);`, "s"));
    assert.ok(declaration, `--${name} is declared`);
    assert.doesNotMatch(
      declaration[1]!,
      /inset 0 0 0 1px var\(--color-edge-ring\)/,
      `--${name} carries the card's ring, doubling its bordered surface's hairline in light`,
    );
  }
});

test("the hover wash is one formula in both themes", () => {
  const hover = token("color-hover");
  assert.equal(hover.light, hover.dark, "one formula, both themes — a pair can drift apart");
  assert.match(hover.dark, /color-mix\(in oklab, var\(--color-ink\) 11%, transparent\)/);
  const rail = token("color-hover-rail");
  assert.match(rail.dark, /color-mix\(in oklab, var\(--color-rail-ink\) 13%, transparent\)/);
});

test("both faces are declared, self-hosted, and preloaded", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(css, /font-family:\s*"Chivo";/);
  assert.match(css, /font-family:\s*"Chivo Mono";/);
  assert.ok(!/Space Grotesk/.test(css), "Space Grotesk is retired");
  assert.ok(
    !/fonts\.googleapis|fonts\.gstatic/.test(css),
    "no font CDN: the app is offline-capable",
  );
  for (const file of ["chivo-latin.woff2", "chivo-mono-latin.woff2"]) {
    assert.ok(html.includes(`/fonts/${file}`), `${file} is preloaded in index.html`);
  }
  assert.ok(!/space-grotesk/.test(html), "the retired preload is gone");
});
