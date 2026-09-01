# Theme toggle implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-08-17
**Supersedes:** nothing
**Superseded by:** nothing

**Goal:** Give the app a light/dark/auto theme, selected in Settings, applied before first paint and
expressed as semantic colour tokens that every later view inherits for free.

**Architecture:** Twenty `--color-*` tokens in Tailwind v4's `@theme`, each carrying both palettes in
one `light-dark()` declaration and resolved by the `color-scheme` property. `:root` is
`color-scheme: light dark` — the auto state — and a `data-theme` attribute on `<html>` narrows it to
one. An inline `<head>` script sets that attribute from `localStorage` before the module bundle
loads; it only ever *overrides*, so auto, unreadable storage and disabled JavaScript all land on
following the OS. Views write `bg-surface text-ink` and never mention light or dark.

**Tech Stack:** Vanilla TypeScript (strict, `noUncheckedIndexedAccess`), Tailwind CSS v4.3.3 (CSS
first — there is no `tailwind.config.js`), native WebComponents in light DOM, Playwright for tests,
everything in Docker.

**Spec:** `docs/superpowers/specs/2026-08-14-theme-toggle-design.md` — read it before starting. It
holds the full token table, the rejected alternative design and why, and the empirical Tailwind v4
facts these tasks depend on.

**Issue:** [#30](https://codeberg.org/DionGerrese/ThatApp/issues/30). Branch:
`issue-30-theme-toggle`, already cut from `main` and holding the design commits.

## Global Constraints

- **Everything runs in Docker.** There is no Go, Node or npm on the host. Never run them bare.
- **No JavaScript frameworks.** Vanilla JS/TS only.
- **Tailwind v4, CSS-first.** Theme values live in `@theme` in `web/src/styles.css`. There is no
  config file to edit.
- **`web/index.html` carries the app shell and inlined critical CSS only**, and the initial HTTP
  response must stay under 14kB. It is 797 bytes before this work and must be measured after.
- **Reusable UI is a `that-*` WebComponent in light DOM, never shadow DOM.** The theme control is
  *not* one of these — see Task 3.
- **Browsers are Firefox (primary) and Chromium.** Safari and WebKit are an explicit non-goal: do
  not add WebKit to the Playwright matrix, and do not raise it as missing coverage.
- **TypeScript is `strict` with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`.** Do not
  weaken `tsconfig.json`, and do not reach for `any`, `as any` or a non-null assertion. Type-only
  imports must use `import type`.
- **`light-dark()` needs Firefox 120+ and Chrome 123+.** Inside the support policy, but it is a real
  dependency on it.
- **Comments are rare and explain *why*.** Do not narrate what the next line does.
- **ESLint runs `js.configs.recommended`, which includes `no-empty`.** An empty `catch {}` fails
  lint; a `catch` block containing a comment passes. Every swallowed error here needs its "why"
  comment anyway.
- **Assertions in tests read computed styles and attributes, never class names.** A test asserting
  class names would pass against a stylesheet that never loaded.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `web/src/styles.css` | The token vocabulary and the three `color-scheme` rules. | 1 |
| `web/index.html` | Shell markup on tokens, and the inline first-paint script. | 1, 2, 4 |
| `web/src/theme.ts` | **New.** Reads and writes the preference; owns no rendering and no state of its own — the DOM attribute and `localStorage` are the state. | 3 |
| `web/src/views/settings.ts` | Gains the Appearance card; its own colours move to tokens. | 3, 4 |
| `web/src/components/that-card.ts`, `that-button.ts`, `that-alert.ts` | Colours move to tokens. | 4 |
| `web/src/router.ts` | The placeholder view's colours move to tokens. | 4 |
| `.claude/e2e/tests/theme.spec.ts` | **New.** The whole test surface for this feature. | 1, 2, 3, 4 |

`.github/workflows/e2e.yml` needs **no** change: its `paths:` filter already names `web/**` and
`.claude/e2e/**`.

## How to run things

Every command runs through Docker. The e2e rig starts the app stack itself.

```shell
make verify                    # lint + tsc + Go tests. Must be green before the PR.
make test-e2e                  # the whole Playwright suite, Firefox and Chromium
make build-web                 # build the frontend into web/dist
```

To run one spec file during the loop, rather than the whole suite:

```shell
docker compose --profile e2e run --build --rm playwright \
  sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/theme.spec.ts'
```

The `web` service builds once and then watches, and Tailwind's watcher rescans the `@source` globs,
so a class added to a `.ts` file or to `index.html` regenerates `app.css` without a manual build.

---

### Task 1: Tokens, and the auto state end to end

Adds the token vocabulary and puts the shell's body on it, which makes the OS-following path real
and testable. No preference, no control yet.

**Files:**
- Modify: `web/src/styles.css` (whole file — it is 8 lines)
- Modify: `web/index.html:10` (the `<body>` class)
- Test: `.claude/e2e/tests/theme.spec.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: the token names every later task uses — `surface`, `raised`, `ink`, `ink-muted`, `edge`,
  `accent`, `accent-ink`, `link`, and the `danger-*` / `success-*` / `warning-*` tone families. As
  Tailwind utilities these are `bg-surface`, `text-ink`, `border-edge`, `divide-edge`,
  `bg-danger-tint`, and so on — one utility family per token.

- [ ] **Step 1: Write the failing test**

Create `.claude/e2e/tests/theme.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";

/**
 * Computed colours rather than class names: a spec asserting classes would pass
 * against a stylesheet that never loaded.
 */
function bodyBackground(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

// "/" has no registered route, so the router renders its placeholder and the
// page needs no API stub. Themeing is a property of the shell, not of a view.
test("follows a light OS when nothing is stored", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");

  expect(await bodyBackground(page)).toBe("rgb(250, 250, 250)");
});

test("follows a dark OS when nothing is stored", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");

  expect(await bodyBackground(page)).toBe("rgb(10, 10, 10)");
});
```

- [ ] **Step 2: Run the spec and watch the dark one fail**

```shell
docker compose --profile e2e run --build --rm playwright \
  sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/theme.spec.ts'
```

Expected: **"follows a dark OS" FAILS** on both projects with
`Expected: "rgb(10, 10, 10)" Received: "rgb(250, 250, 250)"`.

**"follows a light OS" passes already, and that is not a mistake.** Today's body is `bg-neutral-50`,
which is `#fafafa` — the same value the light palette keeps. The dark test is the RED gate for this
task; the light one is a regression guard that the palette did not shift underfoot. Paste both
results into the task report.

- [ ] **Step 3: Add the tokens and the color-scheme rules**

Replace the whole of `web/src/styles.css`:

```css
@import "tailwindcss";
@source "../index.html";
@source "./**/*.ts";

@theme {
  --font-sans: ui-sans-serif, system-ui, sans-serif;

  /* chrome */
  --color-surface: light-dark(#fafafa, #0a0a0a);
  --color-raised: light-dark(#ffffff, #171717);
  --color-ink: light-dark(#171717, #f5f5f5);
  --color-ink-muted: light-dark(#525252, #a3a3a3);
  --color-edge: light-dark(#e5e5e5, #262626);

  /* interactive */
  --color-accent: light-dark(#171717, #f5f5f5);
  --color-accent-ink: light-dark(#ffffff, #0a0a0a);
  --color-link: light-dark(#1d4ed8, #60a5fa);

  /* tones */
  --color-danger-tint: light-dark(#fef2f2, #450a0a);
  --color-danger-edge: light-dark(#fca5a5, #7f1d1d);
  --color-danger-ink: light-dark(#7f1d1d, #fecaca);
  --color-danger-solid: light-dark(#dc2626, #dc2626);
  --color-danger-solid-hover: light-dark(#b91c1c, #ef4444);
  --color-danger-solid-ink: light-dark(#ffffff, #ffffff);
  --color-success-tint: light-dark(#f0fdf4, #052e16);
  --color-success-edge: light-dark(#86efac, #166534);
  --color-success-ink: light-dark(#14532d, #bbf7d0);
  --color-warning-tint: light-dark(#fffbeb, #451a03);
  --color-warning-edge: light-dark(#fcd34d, #92400e);
  --color-warning-ink: light-dark(#78350f, #fde68a);
}

/* An absent data-theme attribute is the auto state, so a failed localStorage
   read lands on following the OS rather than on a guess. */
:root {
  color-scheme: light dark;
}
[data-theme="light"] {
  color-scheme: light;
}
[data-theme="dark"] {
  color-scheme: dark;
}
```

`--color-danger-solid` and `--color-danger-solid-ink` are deliberately identical in both palettes: a
destructive action should not soften in dark mode, and its label sits on red rather than on the
page, so it must not invert.

- [ ] **Step 4: Put the shell body on the tokens**

In `web/index.html`, line 10:

```html
  <body class="bg-surface text-ink">
```

- [ ] **Step 5: Run the spec and watch both pass**

```shell
docker compose --profile e2e run --build --rm playwright \
  sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/theme.spec.ts'
```

Expected: 4 passed (2 tests × firefox + chromium).

- [ ] **Step 6: Type-check and lint**

```shell
make verify
```

Expected: `verify: OK`.

- [ ] **Step 7: Commit**

```shell
git add web/src/styles.css web/index.html .claude/e2e/tests/theme.spec.ts
git commit -m "feat(web): colour tokens carrying both palettes via light-dark()"
```

---

### Task 2: First paint

The inline script that applies a stored preference before anything renders. Still no control — the
test seeds `localStorage` directly, which is also how the no-flash guarantee gets proven
independently of the UI that writes it.

**Files:**
- Modify: `web/index.html` (add a `<script>` to `<head>`)
- Test: `.claude/e2e/tests/theme.spec.ts` (append)

**Interfaces:**
- Consumes: the tokens and `color-scheme` rules from Task 1.
- Produces: the storage contract every later task shares — key `"theme"`, values `"light"`,
  `"dark"`, or absent for auto; and the attribute contract `<html data-theme="light|dark">`, absent
  for auto.

- [ ] **Step 1: Write the failing tests**

Append to `.claude/e2e/tests/theme.spec.ts`:

```ts
test("a stored preference is applied before the bundle loads", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await bodyBackground(page)).toBe("rgb(10, 10, 10)");
});

// The failure the whole design is shaped around: storage that throws must
// degrade to following the OS, not to a hardcoded guess.
test("unreadable storage still themes from the OS", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("storage disabled");
    };
  });
  await page.goto("/");

  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  expect(await bodyBackground(page)).toBe("rgb(10, 10, 10)");
});
```

- [ ] **Step 2: Run the spec and watch the first new test fail**

```shell
docker compose --profile e2e run --build --rm playwright \
  sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/theme.spec.ts'
```

Expected: **"a stored preference is applied before the bundle loads" FAILS** — the `html` element has
no `data-theme` attribute, so the locator assertion times out. "unreadable storage still themes from
the OS" passes already: nothing sets the attribute yet, which is exactly the state that test
protects. Paste both into the report.

- [ ] **Step 3: Add the inline script**

In `web/index.html`, inside `<head>`, immediately after the `<script type="module">` line:

```html
    <script>
      // Duplicates two lines of src/theme.ts on purpose: this must run before
      // the module graph loads, so it cannot import them. It only ever
      // overrides — an absent attribute is the auto state, so doing nothing
      // when storage throws is the correct behaviour, not a swallowed bug.
      try {
        var stored = localStorage.getItem("theme");
        if (stored === "light" || stored === "dark") {
          document.documentElement.dataset.theme = stored;
        }
      } catch {}
    </script>
```

- [ ] **Step 4: Run the spec and watch all four pass**

```shell
docker compose --profile e2e run --build --rm playwright \
  sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/theme.spec.ts'
```

Expected: 8 passed (4 tests × 2 projects).

- [ ] **Step 5: Measure the shell against the 14kB budget**

```shell
wc -c web/index.html
```

Expected: roughly 1,150 bytes, up from 797. Record the exact number in the task report — the pull
request has to quote it.

- [ ] **Step 6: Verify and commit**

```shell
make verify
git add web/index.html .claude/e2e/tests/theme.spec.ts
git commit -m "feat(web): apply a stored theme before first paint"
```

---

### Task 3: The preference module and the Appearance control

**Files:**
- Create: `web/src/theme.ts`
- Modify: `web/src/views/settings.ts` (the `render` function at lines 8-14, plus a new helper)
- Test: `.claude/e2e/tests/theme.spec.ts` (append)

**Interfaces:**
- Consumes: the storage and attribute contract from Task 2.
- Produces:
  ```ts
  export type ThemePreference = "light" | "dark" | "auto";
  export function themePreference(): ThemePreference;
  export function setThemePreference(preference: ThemePreference): void;
  ```

- [ ] **Step 1: Write the failing tests**

Append to `.claude/e2e/tests/theme.spec.ts`. Note the stub: the Settings view fetches
`/api/instances` on load, and no test anywhere may depend on server state.

```ts
async function openSettings(page: Page): Promise<void> {
  await page.route("**/api/instances", (route) => route.fulfill({ status: 200, json: [] }));
  await page.goto("/settings");
}

test("choosing Dark themes the page and survives a reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openSettings(page);

  await page.getByRole("radio", { name: "Dark" }).check();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await bodyBackground(page)).toBe("rgb(10, 10, 10)");

  await page.reload();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await bodyBackground(page)).toBe("rgb(10, 10, 10)");
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
});

test("choosing Auto after Dark follows the OS again", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openSettings(page);

  await page.getByRole("radio", { name: "Dark" }).check();
  await page.getByRole("radio", { name: "Auto" }).check();

  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  expect(await bodyBackground(page)).toBe("rgb(250, 250, 250)");

  await page.reload();

  await expect(page.getByRole("radio", { name: "Auto" })).toBeChecked();
});
```

- [ ] **Step 2: Run the spec and watch both new tests fail**

```shell
docker compose --profile e2e run --build --rm playwright \
  sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/theme.spec.ts'
```

Expected: both FAIL with a strict-mode/timeout error resolving `getByRole("radio", { name: "Dark" })`
— there is no such control yet.

- [ ] **Step 3: Write `web/src/theme.ts`**

```ts
export type ThemePreference = "light" | "dark" | "auto";

const STORAGE_KEY = "theme";

/**
 * "auto" for a value that is absent, unrecognised or unreadable. Storage that
 * throws must not become a hardcoded light or dark: an absent data-theme
 * attribute already means "follow the OS".
 */
export function themePreference(): ThemePreference {
  let stored: string | null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    return "auto";
  }

  return stored === "light" || stored === "dark" ? stored : "auto";
}

export function setThemePreference(preference: ThemePreference): void {
  if (preference === "auto") {
    delete document.documentElement.dataset["theme"];
  } else {
    document.documentElement.dataset["theme"] = preference;
  }

  try {
    if (preference === "auto") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, preference);
    }
  } catch {
    // The DOM already reflects the choice; all that is lost is persistence.
  }
}
```

- [ ] **Step 4: Add the Appearance card to the Settings view**

In `web/src/views/settings.ts`, add to the imports at the top (`verbatimModuleSyntax` requires the
type import to be separate):

```ts
import { setThemePreference, themePreference } from "../theme";
import type { ThemePreference } from "../theme";
```

Replace `render` (lines 8-14):

```ts
export async function render(root: HTMLElement): Promise<void> {
  const container = document.createElement("div");
  container.className = "space-y-6";

  // that-card overwrites its own className on connect, so the spacing lives on a
  // wrapper. Appearance sits outside `container` because refresh() replaces
  // that element's children on every mutation.
  const appearance = document.createElement("div");
  appearance.className = "mt-6";
  appearance.append(appearanceCard());

  root.append(container, appearance);

  await refresh(container);
}
```

Add these two, next to the other local helpers at the bottom of the file (after `button`):

```ts
const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "auto", label: "Auto" },
];

/**
 * Plain markup rather than a that-* component: this has exactly one call site,
 * and the settings form already builds its controls from local helpers. Native
 * radios also inherit color-scheme themeing without any extra work.
 */
function appearanceCard(): HTMLElement {
  const card = document.createElement("that-card");
  card.setAttribute("heading", "Appearance");

  const fieldset = document.createElement("fieldset");
  const legend = document.createElement("legend");
  legend.className = "mb-2 text-sm font-medium";
  legend.textContent = "Theme";
  fieldset.append(legend);

  const current = themePreference();
  for (const option of THEME_OPTIONS) {
    const wrapper = document.createElement("label");
    wrapper.className = "mr-4 inline-flex items-center gap-2 text-sm";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "theme";
    radio.value = option.value;
    radio.checked = option.value === current;
    radio.addEventListener("change", () => {
      setThemePreference(option.value);
    });

    const caption = document.createElement("span");
    caption.textContent = option.label;

    wrapper.append(radio, caption);
    fieldset.append(wrapper);
  }

  card.append(fieldset);

  return card;
}
```

The `<label>` wrapping each input is what gives the radio its accessible name, which is what
`getByRole("radio", { name: "Dark" })` resolves.

- [ ] **Step 5: Run the spec and watch all six pass**

```shell
docker compose --profile e2e run --build --rm playwright \
  sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/theme.spec.ts'
```

Expected: 12 passed (6 tests × 2 projects).

- [ ] **Step 6: Verify and commit**

```shell
make verify
git add web/src/theme.ts web/src/views/settings.ts .claude/e2e/tests/theme.spec.ts
git commit -m "feat(web): theme preference module and the Appearance control"
```

---

### Task 4: The retrofit

Every remaining stock colour utility becomes a token. Without this the tokens exist and almost
nothing uses them — a dark page with white cards on it.

**Files:**
- Modify: `web/index.html` (the header link, line 18)
- Modify: `web/src/components/that-card.ts:7`
- Modify: `web/src/components/that-button.ts:1-5`
- Modify: `web/src/components/that-alert.ts:1-5`
- Modify: `web/src/router.ts:69`, `web/src/router.ts:75`
- Modify: `web/src/views/settings.ts` (lines 36, 44, 66, 210, 218-219)
- Test: `.claude/e2e/tests/theme.spec.ts` (append)

**Interfaces:**
- Consumes: every token from Task 1.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Append to `.claude/e2e/tests/theme.spec.ts`. A card is the right probe: it is the one surface that is
*lighter* than the page in light mode and *darker* in dark mode, so a card that stayed `bg-white`
would still be visibly wrong after the body was themed.

```ts
test("cards and buttons take the dark palette too", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openSettings(page);

  const card = page.locator("that-card").first();
  await expect(card).toHaveCSS("background-color", "rgb(23, 23, 23)");
  await expect(card).toHaveCSS("border-color", "rgb(38, 38, 38)");

  const addButton = page.getByRole("button", { name: "Add instance" });
  await expect(addButton).toHaveCSS("background-color", "rgb(245, 245, 245)");
  await expect(addButton).toHaveCSS("color", "rgb(10, 10, 10)");
});
```

- [ ] **Step 2: Run the spec and watch it fail**

```shell
docker compose --profile e2e run --build --rm playwright \
  sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/theme.spec.ts'
```

Expected: FAILS with the card's background still `rgb(255, 255, 255)` — `bg-white`, unthemed.

- [ ] **Step 3: Retrofit the components**

`web/src/components/that-card.ts`, line 7:

```ts
    this.className = "block rounded-lg border border-edge bg-raised p-4 shadow-sm";
```

`web/src/components/that-button.ts`, lines 1-5:

```ts
const VARIANTS: Record<string, string> = {
  primary: "bg-accent text-accent-ink hover:opacity-90",
  secondary: "bg-raised text-ink border border-edge hover:bg-surface",
  danger: "bg-danger-solid text-danger-solid-ink hover:bg-danger-solid-hover",
};
```

`web/src/components/that-alert.ts`, lines 1-5:

```ts
const TONES: Record<string, string> = {
  success: "border-success-edge bg-success-tint text-success-ink",
  error: "border-danger-edge bg-danger-tint text-danger-ink",
  warning: "border-warning-edge bg-warning-tint text-warning-ink",
};
```

- [ ] **Step 4: Retrofit the shell, the router and the settings view**

`web/index.html`, line 18:

```html
            class="text-sm font-medium text-ink-muted underline hover:text-ink"
```

`web/src/router.ts`, lines 69 and 75:

```ts
  paragraph.className = "text-ink-muted";
```

```ts
  link.className = "mt-4 inline-block font-medium text-link underline";
```

`web/src/views/settings.ts` — five class strings:

- line 36 (the empty-list paragraph): `"text-sm text-neutral-600"` → `"text-sm text-ink-muted"`
- line 44 (the list): `"divide-y divide-neutral-200"` → `"divide-y divide-edge"`
- line 66 (a row's detail line): `"text-sm text-neutral-600"` → `"text-sm text-ink-muted"`
- line 210 (a field caption): `"mb-1 block text-sm font-medium text-neutral-700"` →
  `"mb-1 block text-sm font-medium text-ink"`
- lines 218-219 (an input):

```ts
  input.className =
    "w-full rounded-md border border-edge px-3 py-1.5 text-sm " +
    "focus:border-ink focus:outline-none";
```

- [ ] **Step 5: Prove no stock colour utility is left**

```shell
grep -rnE '\b(bg|text|border|divide|ring|from|to)-(white|black|neutral-[0-9]+|red-[0-9]+|green-[0-9]+|amber-[0-9]+|blue-[0-9]+)\b' web/src web/index.html
```

Expected: **no output**, exit status 1. This is an acceptance criterion on the issue, so paste the
command and its empty result into the task report.

- [ ] **Step 6: Run the whole e2e suite, not just this spec**

```shell
make test-e2e
```

Expected: every spec passes on Firefox and Chromium — `theme.spec.ts`, `settings.spec.ts` and
`smoke.spec.ts`. The retrofit changes class strings that `settings.spec.ts` renders through, so this
is the run that proves nothing regressed.

**Do not "tidy" the two `exact: true` locators in `settings.spec.ts` if you find yourself editing
that file.** `getByText("Work")` collides with the shell's `<h1>ThatApp</h1>`, and
`getByRole("link", { name: "Settings" })` with the router placeholder's "Open Settings" link. Both
are real strict-mode failures, not style.

- [ ] **Step 7: Verify and commit**

```shell
make verify
git add web/index.html web/src/components web/src/router.ts web/src/views/settings.ts \
  .claude/e2e/tests/theme.spec.ts
git commit -m "refactor(web): move every colour utility onto the theme tokens"
```

---

## Self-review against the spec

Checked after writing, spec section by section.

- **Decisions taken in brainstorming** (localStorage per browser, semantic tokens over `dark:`,
  control in Settings, `light-dark()` driven by `color-scheme`) — Tasks 1-3. No `dark:` variant
  appears anywhere in this plan.
- **The token vocabulary** — Task 1, all twenty verbatim.
- **First paint** — Task 2, including the byte measurement the 14kB budget requires.
- **`web/src/theme.ts`** — Task 3, both exported functions with the spec's signatures and the
  "auto for unreadable" rule.
- **The control** — Task 3: `that-card`, `<fieldset>`, legend, three native radios, local helpers, no
  new component.
- **The retrofit** — Task 4, all six files from the spec's table, closed by the grep.
- **Testing** — the spec's five scenarios map to Tasks 1 (1, 2), 2 (3 as the stored-preference case,
  5), 3 (choosing Dark, choosing Auto), plus one added in Task 4 for the retrofit itself. Firefox and
  Chromium come from the existing project matrix; no WebKit.
- **Out of scope** — nothing in this plan touches the manifest, adds a third theme, or persists
  anything server-side.

**Open item deliberately left to the executor:** whether `hover:opacity-90` on the primary button
reads well in dark mode. It replaces a hardcoded `hover:bg-neutral-700`, and the spec's table names
no hover token for `accent`. If it looks wrong when checked by hand, raise it as a finding rather
than inventing a token — that is a design change and the owner's call.
