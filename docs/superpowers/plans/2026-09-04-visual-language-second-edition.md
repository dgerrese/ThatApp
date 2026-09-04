# The visual language, second edition — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-09-04
**Supersedes:** nothing
**Superseded by:** nothing

**Goal:** Move the shipped frontend onto the second-edition vocabulary — its ground, rail, radius
scale, two faces, hover wash, elevation rule and drawn icons — without changing a single view's
layout.

**Architecture:** Almost everything lands in one file. `web/src/styles.css` holds the `@theme` block,
so a token change reaches every Tailwind utility at once; the work is then following that change out
into the handful of places that hard-code what a token should have carried. One new module,
`web/src/icons.ts`, replaces the typed characters currently standing in for drawn marks. No view is
restructured — reshaping Today and Week is #95.

**Tech Stack:** Tailwind CSS v4 (CSS-first, `@theme`), vanilla TypeScript, native WebComponents in
light DOM, `node --test` for unit tests, Playwright for e2e.

**Spec:** [`../specs/2026-09-03-visual-language-design.md`](../specs/2026-09-03-visual-language-design.md)

## Global Constraints

Every task's requirements implicitly include these. They come from `CLAUDE.md` and the spec.

- **Everything runs in Docker.** No Go, Node or npm on this host. Drive every command through `make`
  or `docker compose`. The one standing exception is `convert` in Task 8, granted 2026-08-24 for the
  app icons and for nothing else.
- **No JavaScript frameworks.** Vanilla only; TypeScript for typing.
- **Tailwind v4 is CSS-first.** There is no `tailwind.config.js`. Theme values live in `@theme` in
  `web/src/styles.css`.
- **The initial HTTP response stays under 14kB.** `index.html` carries the shell and critical CSS
  only.
- **Reusable UI is a `that-*` WebComponent in light DOM, never shadow DOM.**
- **Firefox and Chromium only.** Safari and WebKit are an explicit non-goal.
- **`tsconfig.json` is `strict` with `noUncheckedIndexedAccess`** and is not to be weakened. No `any`,
  no `as any`, no non-null assertion to get past a type error.
- **No component may carry a radius literal.** Every one refers to a step by name. The two exceptions
  are marks rather than containers and stay fully round: `.that-dot` and the split bar's segments.
- **`--color-ink-faint` is not a text colour.** It clears the 3:1 mark floor and fails the 4.5:1 text
  floor in both themes. Words use `ink` or `ink-muted`; there is no third option.
- **No typed character stands in for a drawn mark.** Punctuation is not an icon — an em dash meaning
  "no value" and a middot separating two facts stay characters.
- **Comments are few and earn their place.** A non-obvious why, a workaround, a subtle invariant.
  Never narrate the next line.

## What this plan deliberately does not do

- **It does not reshape a view.** Today, Week and Settings keep their current layout. #95 reshapes
  the first two, #89 redesigns the third.
- **It does not cap the content column.** `--breakpoint-3xl` is added here because it is vocabulary;
  spending it on `main` is #95's rule 1, and doing it here would change a layout this ticket promises
  not to touch.
- **It does not switch the Log hint from reveal to reserve.** Decision 10 reverses the 2026-08-21
  arrangement *in a table*, and this ticket builds no table. `that-ticket-row` keeps the reveal
  behaviour it has, which the same decision preserves as the modifier for narrow panels. #95 is where
  the tables appear and where the switch belongs.
- **It does not build the tooltip component**, and this is the one place the plan narrows the
  ticket — see Task 7 for the reasoning and the alternative. The half of the acceptance criterion
  that can be met today is met today.
- **It draws eight icons, not fourteen.** The spec inventories the set the app will eventually need.
  This plan draws the ones with a consumer in shipped code today — close, minus, plus, arrow-left,
  arrow-right, success, warning, failed — and leaves pin, pin-off, search, sortable, ascending,
  descending and pushed to the ticket that first renders one. The module they go in is created here.

## File structure

| File | Responsibility | This plan |
| --- | --- | --- |
| `web/src/styles.css` | The `@theme` token block and the few rules no utility can express | Rewritten in Task 1, extended in 4 and 5 |
| `web/src/tokens.test.ts` | Guards the contrast floors and the two load-bearing numbers | Created in Task 1 |
| `web/src/vocabulary.test.ts` | Guards what must *not* appear in source: radius literals, retired ramp steps, typed glyphs | Created in Task 3, extended in 4 and 6 |
| `web/src/icons.ts` | Every drawn mark, as an SVG string per name | Created in Task 6 |
| `web/src/icons.test.ts` | Each icon is on the 24 grid and carries the shared attributes | Created in Task 6 |
| — | The tooltip component is deferred to #95, which renders the first control needing one | Task 7 explains |
| `web/fonts/` | Self-hosted faces | Space Grotesk out, two Chivo files in, Task 2 |
| `web/index.html` | Shell, preloads, rail markup | Preloads in Task 2, ramp and radius in 1 and 3 |
| `.claude/e2e/tests/theme.spec.ts` | Proves the palette in a real browser | Expectations updated in Task 1 |
| `web/icons/`, `web/manifest.json` | App icon and its colours, derived from the rail ground | Task 8 |

---

### Task 1: The token layer, the type ramp, and a test that guards both

The whole palette moves at once, because the tokens are consumed by name and a half-moved palette has
no meaning. The type ramp moves with it: `--text-md` is retired onto `--text-base`, and leaving a
caller behind produces a silently dropped class rather than an error, which is exactly the failure
the guard test exists to catch.

**Files:**
- Modify: `web/src/styles.css:20-77` — the whole `@theme` block, plus `:root { color-scheme }`
- Modify: `web/index.html` — every `text-md` occurrence
- Modify: `web/src/components/that-ticket-row.ts`, `that-confirm.ts`, `that-alert.ts`,
  `that-entry-dialog.ts`, `that-duration.ts` — every `text-md` occurrence
- Modify: `.claude/e2e/tests/theme.spec.ts:20-21,156,160-161,170,173`
- Test: `web/src/tokens.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: the token names every later task uses — `--color-surface`, `--color-raised`,
  `--color-ink`, `--color-ink-muted`, `--color-ink-faint`, `--color-edge`, `--color-edge-ring`,
  `--color-rail`, `--color-rail-ink`, `--color-rail-muted`, `--color-rail-active`,
  `--color-primary`, `--color-primary-ink`, `--color-running`, `--color-pending`, `--color-failed`,
  `--color-dirty`, the five `-rail` role variants, `--color-state-ink`,
  `--radius-xs|sm|md|lg|xl`, `--text-xs|sm|base|lg|xl|2xl|hero`, `--font-sans`, `--font-mono`,
  `--shadow-card` and `--breakpoint-3xl`. Task 4 adds `--color-hover` and `--color-hover-rail`;
  Task 5 adds `--color-edge-ring`, `--shadow-popover` and `--shadow-dialog`.
- Produces: `web/src/tokens.test.ts` exports nothing; it reads `styles.css` from disk.

- [ ] **Step 1: Write the failing test**

Create `web/src/tokens.test.ts`. It parses the `@theme` block rather than importing it, because
there is nothing to import — the tokens are CSS.

```ts
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
  for (const name of ["rail-ink", "rail-muted", "primary-rail", "running-rail", "pending-rail", "failed-rail"]) {
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
    assert.ok(ratio >= MARK_FLOOR, `${theme}: ink-faint is ${ratio.toFixed(2)}:1, below the mark floor`);
    assert.ok(ratio < TEXT_FLOOR, `${theme}: ink-faint now clears the text floor — the comment on it is wrong`);
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
  assert.equal(railL, 0.105, "the rail's lightness is decision 2 — see the spec before changing it");
  assert.equal(surfaceL, 0.178, "the dark page's lightness is decision 2 — see the spec before changing it");
});

test("the retired ramp step is gone and the ramp starts at 12px", () => {
  assert.ok(!/--text-md:/.test(css), "--text-md was retired onto --text-base");
  assert.match(css, /--text-xs:\s*12px/);
  assert.match(css, /--text-sm:\s*13px/);
  assert.match(css, /--text-base:\s*14px/);
});

test("the root declares dark before light", () => {
  assert.match(css, /color-scheme:\s*dark light/);
});
```

- [ ] **Step 2: Run the test and watch it fail**

```shell
make test-web
```

Expected: failures on the palette values — the dark surface is `0.165` not `0.178`, the rail is a
`light-dark()` pair rather than one value, `--text-md` is still declared, and `color-scheme` still
reads `light dark`.

- [ ] **Step 3: Replace the `@theme` block**

In `web/src/styles.css`, replace the block from `@theme {` to its closing brace with the following.
The comments that survive from the first edition are kept; the ones that describe a superseded
decision are replaced.

```css
@theme {
  --font-sans: "Chivo", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Chivo Mono", ui-monospace, monospace;

  /* The three smallest steps each gained a pixel: Chivo is the weakest of the
     candidates at small size and this app spends most of its pixels there.
     --text-md is retired rather than renamed — it landed on --text-base when
     base rose to 14, and two names for one value is worse than either. */
  --text-xs: 12px;
  --text-sm: 13px;
  --text-base: 14px;
  --text-lg: 15px;
  --text-xl: 17px;
  --text-2xl: 30px;
  --text-hero: 46px;

  /* The reference brand's own five-step ruler, inherited whole and stood on at
     the bottom end: cards md, buttons and inputs sm, nav rows xs. lg and xl are
     declared and unused here on purpose — the scale is the reference's, and a
     later ticket may re-map which component uses which step. */
  --radius-xs: 2px;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 20px;

  /* ground and ink */
  --color-surface: light-dark(oklch(0.972 0.008 60), oklch(0.178 0.012 40));
  --color-raised: light-dark(oklch(0.995 0.004 70), oklch(0.228 0.014 40));
  --color-ink: light-dark(oklch(0.195 0.009 55), oklch(0.962 0.005 70));
  --color-ink-muted: light-dark(oklch(0.465 0.01 55), oklch(0.725 0.012 55));
  /* Icons and decorative marks only — it clears the 3:1 non-text floor and
     fails the 4.5:1 text floor in both themes. Words use ink or ink-muted. */
  --color-ink-faint: light-dark(oklch(0.62 0.008 60), oklch(0.56 0.012 50));
  --color-edge: light-dark(oklch(0.905 0.007 65), oklch(0.3 0.012 40));

  /* The rail is the instrument, and it is now the only region that does not
     change with the theme: one set of tones, written as plain values so that
     fact is visible rather than inferred from comparing two halves of a pair.
     Its separation from the page is decision 2 of the second edition — value
     alone, 0.105 against 0.178, protected by nothing but a test. */
  --color-rail: oklch(0.105 0.006 60);
  --color-rail-ink: oklch(0.962 0.005 70);
  --color-rail-muted: oklch(0.66 0.01 60);
  --color-rail-active: oklch(0.205 0.008 60);

  /* Identity, never state: wordmark, Push, links, focus rings. */
  --color-primary: light-dark(oklch(0.5 0.21 330), oklch(0.72 0.19 330));
  --color-primary-ink: light-dark(oklch(0.99 0.004 70), oklch(0.16 0.02 330));

  /* State, never identity, and never carried on hue alone. */
  --color-running: light-dark(oklch(0.48 0.15 150), oklch(0.75 0.15 150));
  --color-pending: light-dark(oklch(0.5 0.13 75), oklch(0.8 0.13 85));
  --color-failed: light-dark(oklch(0.49 0.19 25), oklch(0.72 0.17 25));
  /* Pushed, then edited: Jira holds a stale copy. The primary's hue used as a
     state, which the language otherwise forbids — a deliberate extension, and
     the hollow ring it draws is what keeps it from reading as a primary action.
     See 2026-09-02-week-view-design.md, decision 3. */
  --color-dirty: light-dark(oklch(0.5 0.21 330), oklch(0.72 0.19 330));

  /* One rail ground needs one set of role tones, and these are it. They survive
     as single values rather than pairs: retiring them would put the light
     theme's primary on the rail, where it measures 3.03:1 against a 4.5:1 text
     floor and the wordmark is text. */
  --color-primary-rail: oklch(0.72 0.19 330);
  --color-primary-rail-ink: oklch(0.16 0.02 330);
  --color-running-rail: oklch(0.75 0.15 150);
  --color-pending-rail: oklch(0.8 0.13 85);
  --color-failed-rail: oklch(0.72 0.17 25);
  --color-state-ink: light-dark(oklch(0.99 0.004 70), oklch(0.16 0.01 60));

  /* Cards are borderless and sit on this instead. light-dark() takes colours,
     not whole shadows, so it wraps each layer's colour rather than the lot. */
  --shadow-card:
    0 1px 2px light-dark(oklch(0.35 0.04 60 / 0.05), oklch(0 0 0 / 0.35)),
    0 10px 26px -14px light-dark(oklch(0.35 0.04 60 / 0.2), oklch(0 0 0 / 0.6));

  /* The owner's screen is 2560px wide and every Tailwind default stops far
     short of it. Beware: max-w-3xl is the container scale's 48rem and has
     nothing to do with this — capping a column needs an explicit value. */
  --breakpoint-3xl: 120rem;
}
```

- [ ] **Step 4: Turn the ramp migration out into its callers**

`--text-md` no longer exists, so every `text-md` class is now a class Tailwind will not generate.
Replace each with `text-base`, which is the value it used to carry.

```shell
docker compose run --rm --no-deps web sh -c "grep -rl 'text-md' src ../web/index.html 2>/dev/null || true"
```

Change every occurrence in these files: `web/index.html`, `web/src/components/that-ticket-row.ts`,
`web/src/components/that-confirm.ts`, `web/src/components/that-alert.ts`,
`web/src/components/that-entry-dialog.ts`, `web/src/components/that-duration.ts`. There are fourteen
in total, one of which is the `--text-md` declaration itself and is removed by Step 3.

- [ ] **Step 5: Declare dark first**

In `web/src/styles.css`, the `:root` rule below the `@theme` block:

```css
/* An absent data-theme attribute is the auto state, so a failed localStorage
   read lands on following the OS rather than on a guess. The order here decides
   only the no-preference case, and there dark wins; a stored preference beats
   it and so does an OS that expresses one. */
:root {
  color-scheme: dark light;
}
```

- [ ] **Step 6: Run the unit tests and watch them pass**

```shell
make test-web
```

Expected: PASS, including the two decision-2 assertions.

- [ ] **Step 7: Update the browser's own expectations**

`.claude/e2e/tests/theme.spec.ts` asserts the old palette. Five values change, and one test changes
shape because the rail no longer differs between themes.

```ts
const LIGHT_GROUND = "oklch(0.972 0.008 60)";
const DARK_GROUND = "oklch(0.178 0.012 40)";
```

At line 156, the card's dark ground becomes `oklch(0.228 0.014 40)`. At lines 160-161 the Add
button becomes `oklch(0.72 0.19 330)` on `oklch(0.16 0.02 330)`. The rail test becomes one value
asserted twice, and its name should say so:

```ts
test("the rail carries one ground in both themes", async ({ page }) => {
  await gotoWithScheme(page, "/settings", "light");
  await expect(page.locator("aside")).toHaveCSS("background-color", "oklch(0.105 0.006 60)");
  await setTheme(page, "dark");
  await expect(page.locator("aside")).toHaveCSS("background-color", "oklch(0.105 0.006 60)");
});
```

Read the helpers actually used at lines 167-174 before writing this and keep them; the names above
are indicative, the file is the authority.

- [ ] **Step 8: Run the theme suite in a real browser**

```shell
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/theme.spec.ts'
```

Expected: PASS in both Firefox and Chromium.

- [ ] **Step 9: Commit**

```shell
git add web/src/styles.css web/src/tokens.test.ts web/index.html web/src/components .claude/e2e/tests/theme.spec.ts
git commit -m "feat(#94): the second edition's tokens, and a test that guards them"
```

---

### Task 2: Two faces, self-hosted

**Files:**
- Create: `web/fonts/chivo-latin.woff2`, `web/fonts/chivo-mono-latin.woff2`
- Delete: `web/fonts/space-grotesk-latin.woff2`
- Modify: `web/src/styles.css` — the `@font-face` rules
- Modify: `web/index.html` — the preload links
- Modify: `web/src/styles.css` — `.that-key` gains the mono family
- Modify: `web/index.html:57` — the rail total gains `font-mono`
- Test: `web/src/tokens.test.ts` (extend)

**Interfaces:**
- Consumes: `--font-sans` and `--font-mono` from Task 1.
- Produces: nothing new by name. Figures are set in Chivo Mono at five sites and nowhere else.

**Figures means exactly this list**, from the spec: the day total, the per-instance split figures,
the running timer, a row's duration, and a ticket key. A figure inside a sentence stays in Chivo.
**Four of the five exist in shipped code.** The running timer is #8's and its markup is still the
resting placeholder in `index.html`, so there is nothing to set the face on; #8 inherits the rule
rather than this ticket pre-empting it.

- [ ] **Step 1: Write the failing test**

Append to `web/src/tokens.test.ts`:

```ts
test("both faces are declared, self-hosted, and preloaded", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(css, /font-family:\s*"Chivo";/);
  assert.match(css, /font-family:\s*"Chivo Mono";/);
  assert.ok(!/Space Grotesk/.test(css), "Space Grotesk is retired");
  assert.ok(!/fonts\.googleapis|fonts\.gstatic/.test(css), "no font CDN: the app is offline-capable");
  for (const file of ["chivo-latin.woff2", "chivo-mono-latin.woff2"]) {
    assert.ok(html.includes(`/fonts/${file}`), `${file} is preloaded in index.html`);
  }
  assert.ok(!/space-grotesk/.test(html), "the retired preload is gone");
});
```

- [ ] **Step 2: Run it and watch it fail**

```shell
make test-web
```

Expected: FAIL on the first `assert.match` — Chivo is not declared.

- [ ] **Step 3: Fetch the two faces**

Both are variable across the weights the design uses, so this is one file per family. The URLs were
resolved from the Google Fonts CSS API on 2026-09-04 with a current Chrome user agent, which is what
makes it serve `woff2` and a single variable file per family rather than one file per weight.

```shell
curl -s -o web/fonts/chivo-latin.woff2 \
  https://fonts.gstatic.com/s/chivo/v21/va9I4kzIxd1KFrBoQeM.woff2
curl -s -o web/fonts/chivo-mono-latin.woff2 \
  https://fonts.gstatic.com/s/chivomono/v11/mFT0WbgRxKvF_Z5eQMO9gx8D1Q.woff2
rm web/fonts/space-grotesk-latin.woff2
```

Verify both start with the `wOF2` signature and are roughly 33kB and 26kB:

```shell
ls -l web/fonts/
head -c 4 web/fonts/chivo-latin.woff2 | xxd | head -1
```

**If either URL 404s**, Google has revved the family — re-resolve it rather than guessing:

```shell
curl -s -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" \
  "https://fonts.googleapis.com/css2?family=Chivo:wght@400..700&display=swap"
```

- [ ] **Step 4: Declare them**

Replace the single `@font-face` block at the top of `web/src/styles.css`:

```css
/* Served from our own origin, never a font CDN: #12 makes this an offline PWA
   and a font on someone else's host would not survive it. Both faces are
   variable across the weights the design uses, so this is one file per family
   rather than one per weight. */
@font-face {
  font-family: "Chivo";
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url("/fonts/chivo-latin.woff2") format("woff2");
}
@font-face {
  font-family: "Chivo Mono";
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url("/fonts/chivo-mono-latin.woff2") format("woff2");
}
```

- [ ] **Step 5: Preload both**

In `web/index.html`, replace the single preload with two:

```html
<link rel="preload" href="/fonts/chivo-latin.woff2" as="font" type="font/woff2" crossorigin />
<link rel="preload" href="/fonts/chivo-mono-latin.woff2" as="font" type="font/woff2" crossorigin />
```

- [ ] **Step 6: Set the figures in the second register**

Five sites, and no others.

1. `web/index.html`, the rail total at `id="rail-total"`: add `font-mono` to its class list. It
   already carries `that-tnum`, which is tabular figures and a different rule — keep both.
2. `web/src/rail.ts:415`, the per-instance split figure:
   `figure.className = "that-tnum font-mono font-bold"`.
3. `web/src/components/that-ticket-row.ts`, the row's duration figure. Read the file and set it on
   the element carrying the figure, not on the control that wraps it.
4. `web/src/styles.css`, `.that-key`:

```css
.that-key {
  flex: none;
  min-width: var(--that-key-col, 76px);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: 700;
  letter-spacing: 0.03em;
  text-decoration: none;
}
```

Read each file before editing it and set the class on the element that carries the figure itself.
A row, a label or a wrapper picking up the mono face is a bug — the register changes for figures,
not for the furniture around them.

- [ ] **Step 7: Run the tests and the build**

```shell
make test-web
make build-web
```

Expected: PASS, and `web/dist/fonts/` contains exactly the two new files. `build.mjs` copies whatever
is in `web/fonts/`, so no build change is needed — confirm rather than assume.

- [ ] **Step 8: Commit**

```shell
git add web/fonts web/src/styles.css web/index.html web/src/rail.ts web/src/components/that-ticket-row.ts web/src/tokens.test.ts
git commit -m "feat(#94): Chivo for words, Chivo Mono for figures"
```

---

### Task 3: The radius scale, applied

**Files:**
- Modify: `web/index.html` — two `rounded-[9px]`, one `rounded-[11px]`
- Modify: `web/src/components/that-button.ts:48`, `that-card.ts:10`, `that-confirm.ts:19`,
  `that-combobox.ts:57,67`, `that-duration.ts:55`, `that-entry-dialog.ts:69,211,463`,
  `that-ticket-row.ts:109`, `web/src/views/settings.ts:383`, `web/src/views/week.ts:215`
- Test: `web/src/vocabulary.test.ts` (create)

**Interfaces:**
- Consumes: `--radius-xs|sm|md` from Task 1.
- Produces: `web/src/vocabulary.test.ts`, extended in place by Tasks 4, 6 and 7. It holds one helper
  those later tests reuse — `sources(): Array<{ path: string; text: string }>`, reading
  `web/src/**/*.ts` and `web/index.html`. They append to this file rather than importing from it.

**The mapping**, from the spec: cards and the dialog take `md`, buttons and inputs take `sm`, nav
rows take `xs`. `rounded-full` survives on `.that-dot` and the split bar's segments, which are marks
rather than containers.

- [ ] **Step 1: Write the failing test**

Create `web/src/vocabulary.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and watch it fail**

```shell
make test-web
```

Expected: FAIL listing three literals — `rounded-[9px]` twice and `rounded-[11px]` once. The second
test passes already if Task 1 was done properly; it is here to keep that true.

- [ ] **Step 3: Apply the scale**

| Where | Was | Becomes |
| --- | --- | --- |
| `index.html`, the three nav rows | `rounded-[9px]` | `rounded-xs` |
| `index.html`, the Push button | `rounded-[11px]` | `rounded-sm` |
| `that-button.ts:48` | `rounded-[9px]` | `rounded-sm` |
| `that-card.ts:10` | `rounded-2xl` | `rounded-md` |
| `that-confirm.ts:19` | `rounded-2xl` | `rounded-md` |
| `that-entry-dialog.ts:69` | `rounded-2xl` | `rounded-md` |
| `that-combobox.ts:57` (the input) | `rounded-md` | `rounded-sm` |
| `that-combobox.ts:67` (the listbox) | `rounded-md` | `rounded-md` — unchanged in name, 8px now |
| `that-duration.ts:55` (the group) | `rounded-md` | `rounded-sm` |
| `that-entry-dialog.ts:211,463` | `rounded-md` | `rounded-sm` — both are controls |
| `that-ticket-row.ts:109` | `rounded-md` | `rounded-sm` |
| `views/settings.ts:383` | `rounded-md` | `rounded-sm` |
| `views/week.ts:215` (the week nav button) | `rounded-[9px]` | `rounded-sm` |

`rounded-full` at `views/week.ts:333,335` and `that-entry-dialog.ts:131` stays: read each before
changing nothing, and confirm it is a mark or a fully-round control rather than a container that
should have taken a step.

- [ ] **Step 4: Run the tests and watch them pass**

```shell
make test-web && make lint && make tsc
```

Expected: PASS.

- [ ] **Step 5: Commit**

```shell
git add web/src web/index.html
git commit -m "feat(#94): every radius refers to a step by name"
```

---

### Task 4: The hover wash, and one surface reacting at a time

**Files:**
- Modify: `web/src/styles.css` — the `@theme` block gains two tokens; a new rule below it
- Modify: `web/src/components/that-button.ts:5`, `that-duration.ts:102`,
  `that-entry-dialog.ts:130,463`, `that-ticket-row.ts:108`, `web/src/views/week.ts:216`
- Test: `web/src/vocabulary.test.ts` (extend), `web/src/tokens.test.ts` (extend)

**Interfaces:**
- Consumes: `--color-ink` and `--color-rail-ink` from Task 1.
- Produces: `--color-hover` and `--color-hover-rail`, and the `bg-hover` / `bg-hover-rail`
  utilities Tailwind generates from them.

Six sites currently hover to `bg-surface`, which is a ground standing in for a wash. On the light
theme that is nearly the same colour as the card it sits on.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/tokens.test.ts`:

```ts
test("the hover wash is one formula in both themes", () => {
  const hover = token("color-hover");
  assert.equal(hover.light, hover.dark, "one formula, both themes — a pair can drift apart");
  assert.match(hover.dark, /color-mix\(in oklab, var\(--color-ink\) 11%, transparent\)/);
  const rail = token("color-hover-rail");
  assert.match(rail.dark, /color-mix\(in oklab, var\(--color-rail-ink\) 13%, transparent\)/);
});
```

Append to `web/src/vocabulary.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them and watch them fail**

```shell
make test-web
```

Expected: FAIL — `--color-hover` is not declared, and six `hover:bg-surface` sites are listed.

- [ ] **Step 3: Declare the wash**

In the `@theme` block, directly below `--color-edge`:

```css
  /* The wash a surface takes under the pointer. One formula in both themes:
     it derives from ink, so it follows the theme without needing a pair, and a
     pair is what would let the two drift apart. 11% was judged on both grounds
     on 2026-09-04 against 8% and 6%, and won unchanged. */
  --color-hover: color-mix(in oklab, var(--color-ink) 11%, transparent);
  --color-hover-rail: color-mix(in oklab, var(--color-rail-ink) 13%, transparent);
```

- [ ] **Step 4: Point the six sites at it**

Replace `hover:bg-surface` with `hover:bg-hover` at `that-button.ts:5`, `that-duration.ts:102`,
`that-entry-dialog.ts:130`, `that-entry-dialog.ts:463`, `that-ticket-row.ts:108` and
`views/week.ts:216`. A control that sits on the rail takes `hover:bg-hover-rail` instead — check
each site's ground before changing it rather than replacing blind.

- [ ] **Step 5: Do not add the stand-down rule, and record why**

Decision 9 is the rule that a container's hover stands down while one of its own controls is hovered.
**It has nothing to stand down from today.** `that-ticket-row` paints its wash on the duration
control itself, at line 108; the row around it has no hover state at all, so there is no second wash
to stack and `:has()` would guard a collision that cannot happen. Rows gain their own wash in #95,
which is where this rule earns its place.

Add nothing. Note it in the task report so the reviewer knows it was read and decided rather than
missed.

- [ ] **Step 6: Run the tests and watch them pass**

```shell
make test-web && make lint && make tsc
```

- [ ] **Step 7: Commit**

```shell
git add web/src
git commit -m "feat(#94): a hover paints the wash, and one surface reacts at a time"
```

---

### Task 5: Elevation

**Files:**
- Modify: `web/src/styles.css` — `--color-edge-ring`, `--shadow-card`, `--shadow-popover`,
  `--shadow-dialog`
- Modify: `web/src/components/that-combobox.ts:68` — `shadow-lg` becomes `shadow-popover`
- Test: `web/src/tokens.test.ts` (extend)

**Interfaces:**
- Consumes: `--color-edge` from Task 1.
- Produces: `--color-edge-ring`, `--shadow-card`, `--shadow-popover`, `--shadow-dialog`, and the
  `shadow-card` / `shadow-popover` / `shadow-dialog` utilities.

**The rule is per theme**, and it is the first thing in this language that is: on light an edge
defines the surface and a trace of shadow ranks it; on dark the shadows the design was built with are
unchanged. `light-dark()` takes colours rather than whole shadows, so the ring is expressed as a
colour that is transparent on dark — one shadow string, one token per surface.

- [ ] **Step 1: Write the failing test**

Append to `web/src/tokens.test.ts`:

```ts
test("light defines a surface by its edge, dark by depth", () => {
  const ring = token("color-edge-ring");
  assert.equal(ring.dark, "transparent", "dark has no hairline: its shadows already define a card");
  assert.notEqual(ring.light, "transparent", "light needs the hairline — a card is 0.023 off its page");
  for (const name of ["shadow-card", "shadow-popover", "shadow-dialog"]) {
    assert.match(css, new RegExp(`--${name}:`), `--${name} is declared`);
  }
  assert.match(css, /--shadow-card:[^;]*inset 0 0 0 1px var\(--color-edge-ring\)/s);
});
```

- [ ] **Step 2: Run it and watch it fail**

```shell
make test-web
```

Expected: FAIL — `--color-edge-ring` is not declared.

- [ ] **Step 3: Declare the ring and the three surfaces**

Replace the `--shadow-card` declaration in the `@theme` block:

```css
  /* Elevation is the one rule in this language that differs by theme. On light
     the edge defines the surface and the shadow only ranks it; on dark the
     shadows do both, as they always have. The hairline is expressed as a colour
     that is transparent on dark, because light-dark() takes colours and not
     whole shadows — one string per surface, and no second set to keep in step.
     It is an inset ring rather than a border so adding it moves nothing. */
  --color-edge-ring: light-dark(oklch(0.905 0.007 65), transparent);

  --shadow-card:
    inset 0 0 0 1px var(--color-edge-ring),
    0 1px 2px light-dark(oklch(0 0 0 / 0.04), oklch(0 0 0 / 0.35)),
    0 10px 26px -14px light-dark(oklch(0 0 0 / 0), oklch(0 0 0 / 0.6));

  --shadow-popover:
    inset 0 0 0 1px var(--color-edge-ring),
    0 6px 16px -8px light-dark(oklch(0 0 0 / 0.12), oklch(0 0 0 / 0.7));

  /* The dialog carries a real border already, which is the same hairline by
     another mechanism, so it takes no ring of its own. */
  --shadow-dialog: 0 12px 36px -12px light-dark(oklch(0 0 0 / 0.16), oklch(0 0 0 / 0.75));
```

- [ ] **Step 4: Point the popover at its own token**

`that-combobox.ts:68` uses Tailwind's default `shadow-lg`, which is neither theme-aware nor part of
this scale. Replace it with `shadow-popover`.

Then read `that-entry-dialog.ts:69` and `that-confirm.ts:19`: both use `shadow-card` for what is a
dialog. Move them to `shadow-dialog`.

- [ ] **Step 5: Run everything**

```shell
make test-web && make lint && make tsc
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/theme.spec.ts'
```

Expected: PASS. The e2e card assertion at line 157 checks only that the shadow is not `none`, so it
survives the change; confirm rather than assume.

- [ ] **Step 6: Commit**

```shell
git add web/src
git commit -m "feat(#94): depth is dark's cue, an edge is light's"
```

---

### Task 6: Every mark is drawn

**Files:**
- Create: `web/src/icons.ts`, `web/src/icons.test.ts`
- Modify: `web/src/components/that-alert.ts:11-13`
- Modify: `web/src/components/that-entry-dialog.ts:132,188`
- Modify: `web/src/components/that-duration.ts:58-59`
- Modify: `web/src/views/week.ts:204,206`
- Modify: `web/src/vocabulary.test.ts` (extend)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `iconMarkup(name: IconName, size?: number): string`, the readonly tuple `ICON_NAMES`, and
  `type IconName = (typeof ICON_NAMES)[number]` covering `close`, `minus`, `plus`, `arrow-left`,
  `arrow-right`, `success`, `warning`, `failed`. Default size 18; the rail's nav marks are 16 and
  stay inline in `index.html`.

A typed character is rendered by whichever font resolves it, which is not the font the design chose.
Coverage varies, metrics vary, and a face lacking the codepoint falls back to something else or draws
nothing. **Warning and failed currently share `▲` and are told apart by colour alone**, which this
language forbids in its own words — drawing them is the moment to give them different shapes.

- [ ] **Step 1: Write the failing test**

**There is no DOM in the unit suite.** `node --test` runs the frontend tests with no browser, which
is why every existing `*.test.ts` covers a pure module — `duration`, `format`, `week-label`. So the
icons are **strings**, not `SVGSVGElement`s: the module returns markup and the components insert it.
That keeps the set unit-testable at the level that matters, which is the geometry and the shared
attributes. Do not add a DOM library to make a factory testable; the string is the simpler design and
the constraint is pointing at it.

Create `web/src/icons.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { iconMarkup, ICON_NAMES, type IconName } from "./icons.ts";

test("every icon is on the 24 grid, in currentColor, and hidden from the reader", () => {
  for (const name of ICON_NAMES) {
    const svg = iconMarkup(name);
    assert.match(svg, /^<svg /, `${name} is an <svg>`);
    assert.match(svg, /viewBox="0 0 24 24"/, `${name} is on the 24 grid`);
    assert.match(svg, /stroke="currentColor"/, `${name} inherits its colour`);
    assert.match(svg, /stroke-width="1.9"/);
    assert.match(svg, /fill="none"/);
    assert.match(svg, /aria-hidden="true"/, `${name} is decorative: the label is the control's`);
    assert.match(svg, /<(path|circle)/, `${name} draws something`);
  }
});

test("warning and failed do not share a shape", () => {
  const shape = (name: IconName) => iconMarkup(name).replace(/^<svg[^>]*>|<\/svg>$/g, "");
  assert.notEqual(
    shape("warning"),
    shape("failed"),
    "they were told apart by colour alone, which the language forbids",
  );
});

test("a size renders at that size and no other", () => {
  const svg = iconMarkup("close", 16);
  assert.match(svg, /width="16"/);
  assert.match(svg, /height="16"/);
  assert.equal(iconMarkup("close").includes('width="18"'), true, "18 is the default");
});
```

- [ ] **Step 2: Run it and watch it fail**

```shell
make test-web
```

Expected: FAIL — `./icons.ts` does not exist.

- [ ] **Step 3: Draw the set**

Create `web/src/icons.ts`. Every path is on a 24 grid with `1.9` stroke, round caps and joins, so the
marks sit together as one family.

```ts
/**
 * Every mark that carries meaning, drawn rather than typed. A typed character is
 * rendered by whichever font resolves it — coverage and metrics vary, and a face
 * lacking the codepoint draws something else or nothing at all. An icon that
 * changes shape with the font is not a component.
 *
 * Markup rather than elements: the unit suite runs without a DOM, and a string
 * is the shape that stays testable there. Callers insert it with innerHTML,
 * which is safe because nothing here is interpolated from data.
 *
 * Punctuation is not an icon: an em dash meaning "no value" and a middot between
 * two facts are typography and stay characters.
 */
export const ICON_NAMES = [
  "close",
  "minus",
  "plus",
  "arrow-left",
  "arrow-right",
  "success",
  "warning",
  "failed",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

const PATHS: Record<IconName, string> = {
  close: '<path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"/>',
  minus: '<path d="M6 12h12"/>',
  plus: '<path d="M12 6v12M6 12h12"/>',
  "arrow-left": '<path d="M19 12H5M10 7l-5 5 5 5"/>',
  "arrow-right": '<path d="M5 12h14M14 7l5 5-5 5"/>',
  success: '<circle cx="12" cy="12" r="8.5"/><path d="M8.2 12.4l2.6 2.6 5-5.4"/>',
  // A triangle for "not sent yet" and a circle for "sent and refused". The two
  // shared one glyph and differed by colour alone, which this language forbids.
  warning: '<path d="M12 4.6 21 19.4H3L12 4.6Z"/><path d="M12 10.2v3.6M12 16.6h.01"/>',
  failed: '<circle cx="12" cy="12" r="8.5"/><path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6"/>',
};

/**
 * `aria-hidden` is not an oversight: the mark is decorative and the control it
 * sits in carries the accessible name.
 */
export function iconMarkup(name: IconName, size = 18): string {
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="1.9" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`
  );
}
```

- [ ] **Step 4: Replace the typed glyphs**

Four files, seven glyphs. In each case the control keeps the `aria-label` it already has — the mark
is decorative and the label is what a screen reader reads.

| File | Was | Becomes |
| --- | --- | --- |
| `that-alert.ts:11` | `mark: "●"` for success | `iconMarkup("success")` |
| `that-alert.ts:12` | `mark: "▲"` for warning | `iconMarkup("warning")` |
| `that-alert.ts:13` | `mark: "▲"` for error | `iconMarkup("failed")` |
| `that-entry-dialog.ts:132` | `close.textContent = "×"` | `close.innerHTML = iconMarkup("close")` |
| `that-entry-dialog.ts:188` | `cancel.textContent = "×"` | `cancel.innerHTML = iconMarkup("close")` |
| `that-duration.ts:58` | `this.stepButton("−", ...)` | pass `iconMarkup("minus")` |
| `that-duration.ts:59` | `this.stepButton("+", ...)` | pass `iconMarkup("plus")` |
| `views/week.ts:204,206` | `glyph: "←"` / `"→"` | `iconMarkup("arrow-left")` / `iconMarkup("arrow-right")` |

`stepButton` and `weekButton` take a string today and assign it to `textContent`. They keep taking a
string; what changes is that the string is markup, so each assigns to `innerHTML` instead. Update the
docstrings that describe the control as `−`, a field and `+` — those sentences become wrong the
moment this lands.

`views/week.ts:323` has a comment saying a mark is drawn "rather than set as ▲ so its size is the
grid's rather than the font's". That reasoning is now the rule rather than a local exception; check
whether the comment still earns its place.

- [ ] **Step 5: Guard it**

Append to `web/src/vocabulary.test.ts`:

```ts
test("no typed character stands in for a drawn mark", () => {
  const offenders: string[] = [];
  for (const { path, text } of sources()) {
    // Punctuation is deliberately absent from this list: an em dash meaning "no
    // value" and a middot between two facts are typography, not icons.
    for (const match of text.matchAll(/["'`][^"'`]*[●▲×−✓✗←→][^"'`]*["'`]/g)) {
      offenders.push(`${path}: ${match[0]}`);
    }
  }
  assert.deepEqual(offenders, [], `every mark is drawn:\n${offenders.join("\n")}`);
});
```

Run it and expect it to pass. If it flags a string that is genuinely prose rather than a mark, narrow
the pattern rather than deleting the test.

- [ ] **Step 6: Run everything**

```shell
make test-web && make lint && make tsc
```

- [ ] **Step 7: Commit**

```shell
git add web/src
git commit -m "feat(#94): every mark is drawn, and warning stops sharing failed's shape"
```

---

### Task 7: The half of the tooltip rule that can be met today

**Files:**
- Modify: whichever icon-only controls the audit finds lacking a label
- Test: `web/src/vocabulary.test.ts` (extend)

**Interfaces:**
- Consumes: `iconMarkup` from Task 6.
- Produces: nothing new.

**This task deliberately does not build `that-tooltip`, and that narrows the ticket.** The reasoning,
so the owner can overrule it:

- **Nothing in shipped code has a tooltip**, or wants one. The first controls that need one are the
  pin and unpin buttons, and #95 renders them.
- **It could not be tested here.** The unit suite has no DOM, so a component that positions itself
  against a trigger's bounding box in the top layer is unreachable; and the e2e suite drives the real
  app, where an unused component appears on no page. Building it now means building it untested,
  which is the one thing this repo does not do.
- **The rule is already written down** — decision 7 of the spec, with both of its consequences. It
  is not lost by being built later, and #95 will build it against real triggers rather than against
  an imagined one.

What *can* be met today is the second half of the criterion, and it is the half that protects a
reader: **every icon-only control carries an `aria-label` independent of any tooltip.** Task 6 has
just replaced seven typed characters with drawn marks that are `aria-hidden`, which means the
control's label is now the only thing a screen reader has.

- [ ] **Step 1: Write the failing test**

Append to `web/src/vocabulary.test.ts`:

```ts
test("a control whose only content is a drawn mark carries its own label", () => {
  const offenders: string[] = [];
  for (const { path, text } of sources()) {
    // A button that inserts icon markup and nothing else. The label has to come
    // from aria-label, because the mark itself is aria-hidden by construction.
    for (const match of text.matchAll(/iconMarkup\(/g)) {
      const window = text.slice(Math.max(0, match.index - 600), match.index + 600);
      if (!/aria-label|ariaLabel|setAttribute\("aria-label"/.test(window)) {
        offenders.push(`${path}: an iconMarkup() call with no aria-label within 600 characters`);
      }
    }
  }
  assert.deepEqual(offenders, [], `every icon-only control names itself:\n${offenders.join("\n")}`);
});
```

The 600-character window is a heuristic and will need widening if a component separates its label
from its mark. Widen it rather than dropping the case, and if a call site is genuinely a labelled
control whose label sits far away, restructure the call site — a reader of that code has the same
problem the test does.

- [ ] **Step 2: Run it and see where it stands**

```shell
make test-web
```

Expected: a list, or a pass. `that-duration`, `that-entry-dialog` and `views/week.ts` all pass
`aria-label` today — Task 6's table preserves each — so a pass here is a real result rather than a
vacuous one. **If it passes first time, say so in the task report and keep the test**: it is a
regression guard for #95, which is about to add six more icon-only controls.

- [ ] **Step 3: Fix whatever it found**

Add an `aria-label` naming the action, not the mark. "Close", not "Cross". If it found nothing, skip
to the commit.

- [ ] **Step 4: Run everything**

```shell
make test-web && make lint && make tsc
```

- [ ] **Step 5: Commit**

```shell
git add web/src
git commit -m "feat(#94): every icon-only control names itself"
```

---

### Task 8: The rail ground moved, and three files still carry the old one

**Files:**
- Modify: `web/icons/icon.svg`, `web/icons/icon-maskable.svg`, `web/icons/README.md`
- Regenerate: `web/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`
- Modify: `web/manifest.json` — `theme_color`, `background_color`

**Interfaces:**
- Consumes: `--color-rail` and `--color-primary-rail` from Task 1.
- Produces: nothing other code reads.

**This is a consequence the spec does not mention and the ticket did not plan for.** The app icon is
authored in sRGB hex rather than oklch, deliberately, because it is consumed by OS shells and
rasterisers rather than by a CSS engine — so it does not follow a token change. Its ground is
`--color-rail` and its stroke is `--color-primary-rail`, and both moved in Task 1. `manifest.json`
carries the same ground twice more.

Converting through the same matrices the contrast test uses:

| Token | Was | Now |
| --- | --- | --- |
| `--color-rail` (ground) | `oklch(0.215 0.018 55)` → `#201712` | `oklch(0.105 0.006 60)` → compute it |
| `--color-primary-rail` (stroke) | `oklch(0.66 0.19 330)` → `#d05fc8` | `oklch(0.72 0.19 330)` → compute it |

- [ ] **Step 1: Compute the two hexes**

Do not eyeball them. Reuse the conversion already written in `web/src/tokens.test.ts` — the same
OKLab matrices, then the sRGB transfer function this time, because a hex is gamma-encoded and a
luminance is not.

```shell
docker compose run --rm --no-deps web node --input-type=module -e '
const oklchToHex = (L, C, h) => {
  const a = C * Math.cos(h * Math.PI / 180), b = C * Math.sin(h * Math.PI / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return "#" + lin.map((v) => {
    const c = Math.min(1, Math.max(0, v));
    const srgb = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(srgb * 255).toString(16).padStart(2, "0");
  }).join("");
};
console.log("ground", oklchToHex(0.105, 0.006, 60));
console.log("stroke", oklchToHex(0.72, 0.19, 330));
'
```

- [ ] **Step 2: Update the two SVGs and the manifest**

Replace `#201712` with the new ground and `#d05fc8` with the new stroke in `web/icons/icon.svg` and
`web/icons/icon-maskable.svg`, and both colour fields in `web/manifest.json`. Update the conversion
table in `web/icons/README.md` so it records what is true.

- [ ] **Step 3: Regenerate the three PNGs**

**These run on the host.** That is an exception the project owner granted on 2026-08-24 for this
one-off, recorded in `web/icons/README.md`. It is not a precedent, and `CLAUDE.md`'s Docker rule
stands for everything else.

```shell
cd web/icons
convert -background none icon.svg          -resize 192x192 -strip icon-192.png
convert -background none icon.svg          -resize 512x512 -strip icon-512.png
convert -background none icon-maskable.svg -resize 512x512 -strip icon-maskable-512.png
```

If ImageMagick is not installed on this machine, **stop and report it** rather than reaching for a
container or another tool. The README says why: this runs twice in the app's life, and the owner
decided where it runs.

- [ ] **Step 4: Check the result by eye**

```shell
make build-web
```

Then open `web/icons/icon-512.png`. The mark is the clock glyph from the rail; it should sit on a
near-black ground rather than the old warm brown, and the stroke should be the new magenta.

- [ ] **Step 5: Commit**

```shell
git add web/icons web/manifest.json
git commit -m "feat(#94): the app icon follows the rail's new ground"
```

---

## Finishing

- [ ] `make verify` — paste the output into the task report. Never claim green without it.
- [ ] `make test-e2e` — the frontend changed, so this is not optional. Paste the output.
- [ ] **The whole-branch review is not optional.** Every one of ticket 1's seven task reviews passed
  while the branch still served a 404 on a fresh clone, because each diff was individually correct
  and only a cross-task read could see it. Use `superpowers:requesting-code-review` on the full
  branch diff.
- [ ] Then `superpowers:finishing-a-development-branch`: push and open the pull request with
  `Closes #94`. **Do not merge into `main` locally** — that is forbidden outright, and the skill
  offers it as its first option.

## Risks worth stating before starting

1. **The font payload nearly triples.** Space Grotesk is 22kB; Chivo and Chivo Mono are 33kB and
   26kB, so 22kB becomes 59kB and there are two preloads rather than one. The spec says "the same
   font budget as the single face it replaces", which is true of the file *count* per family and not
   of the bytes. Nothing in the 14kB rule is threatened — that governs the initial HTML response —
   but it is a real cost and the owner should hear it rather than discover it.
2. **Nothing enforces the rail's separation but one test.** `--color-surface` at `0.178` and
   `--color-rail` at `0.105` are the whole of decision 2, and the distance between them is
   decorative by tier, so no contrast floor protects it. Task 1's test is the only thing that will
   ever notice. That is why it asserts the two numbers exactly and says so in its failure message.
3. **`--text-md` fails silently, not loudly.** A class Tailwind cannot generate is dropped without a
   word in the console. The vocabulary test is what turns that into a failure.
4. **The icon PNGs need a host tool.** If ImageMagick is missing, Task 8 stops. It is the last task
   for exactly that reason: everything else can land without it.
