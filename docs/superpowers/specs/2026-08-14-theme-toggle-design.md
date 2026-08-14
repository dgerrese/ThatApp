# Theme toggle — design

**Date:** 2026-08-14
**Supersedes:** nothing
**Superseded by:** nothing

The design for [#30](https://github.com/dgerrese/work-dashboard/issues/30). The app has no theming:
`@theme` in `web/src/styles.css` holds one token (`--font-sans`) and every view uses hardcoded light
utilities. This introduces a colour vocabulary, a dark palette, and a three-state control that
selects between them.

It is taken out of ticket order deliberately. Only the Settings view exists today, so the retrofit
is twenty-eight utility usages. Each of #5–#12 adds a view that would otherwise be written against
hardcoded light colours and need retrofitting afterwards.

## Decisions taken in brainstorming

1. **The preference lives in `localStorage`, per browser.** No schema change, no API, no server work,
   and `index.html` stays a static embedded asset. The phone in #13 gets its own independent setting,
   which is acceptable and arguably correct.
2. **Colour is expressed as semantic tokens**, not as Tailwind's `dark:` variant paired onto every
   utility. Views write `bg-surface text-ink` and never mention light or dark, so a view added by a
   later ticket is theme-correct without anyone remembering to make it so. The `dark:` variant's
   failure mode — a forgotten `dark:` producing white-on-white — is silent; this approach has no
   equivalent.
3. **The control lives in the Settings view**, not the shell header. It is a setting, the page
   exists, and it keeps markup out of `index.html`, which is the file the 14kB initial-response
   budget actually measures. `auto` handles the daily light/dark cycle, so manual switching is rare
   enough that two clicks costs nothing.
4. **`light-dark()` carries both palettes, and `color-scheme` drives it.** This replaced an earlier
   design in which JavaScript resolved `auto` and wrote a resolved `light`/`dark` value into the DOM.
   See *Why `light-dark()`* below — the change came from asking what happens when `localStorage`
   fails, and it removed three moving parts rather than adding one.

## Why `light-dark()`

The obvious shape for a three-state toggle is: store the preference, have JavaScript resolve `auto`
against `matchMedia`, and write the resolved theme onto `<html>` so CSS sees only `light` or `dark`.
That design has three costs, and all three disappear here.

- **It needs a fallback when `localStorage` throws** (disabled storage, private browsing). Any
  hardcoded fallback is wrong for half the users: falling back to light forces light on someone whose
  OS is dark.
- **It needs a `matchMedia` listener**, so that flipping the OS theme while the preference is `auto`
  re-resolves live rather than only on the next reload.
- **It does not degrade.** With JavaScript disabled or the inline script erroring, no attribute is
  written and the page renders in whatever the default palette happens to be.

Driving `light-dark()` from `color-scheme` removes all three. CSS resolves `auto` natively, so there
is nothing to listen to; an absent attribute *is* the auto state, so a failed `localStorage` read
lands on OS-following rather than on a guess; and the whole mechanism works with no JavaScript at
all. The inline script is reduced to an override that may simply fail to happen.

It also themes native form controls and scrollbars, which matters here: the settings form is built
from native `<input>` elements that would otherwise stay light against a dark page.

**Verified empirically** against `tailwindcss` v4.3.3 in the project's own container, rather than
assumed: `light-dark()` passes through `@theme` untouched and utilities resolve through it.

```css
--color-surface: light-dark(#fafafa, #0a0a0a);
.bg-surface { background-color: var(--color-surface); }
```

**This depends on `light-dark()`**, which needs Firefox 120+ and Chrome 123+. That is inside the
project's stated support — Firefox primary, Chromium covered, Safari an explicit non-goal — but it is
a real dependency on that decision rather than a free choice.

## The token vocabulary

Nineteen tokens, derived from the twenty-eight colour utilities the app uses today rather than
invented. Each names both palettes in one declaration, so there is no second block to keep in sync.

Names are chosen for how they read at the call site, since that is where they are typed. Tailwind
generates a utility per token, so `--color-border` would produce `border-border` and a tone's
background would produce `bg-danger-bg`. Hence `edge` for hairlines and `tint` for a tone's fill:
`border-edge`, `bg-danger-tint`, `text-danger-ink`.

```css
@theme {
  --font-sans: ui-sans-serif, system-ui, sans-serif;

  /* chrome */
  --color-surface:    light-dark(#fafafa, #0a0a0a);  /* page background   */
  --color-raised:     light-dark(#ffffff, #171717);  /* cards             */
  --color-ink:        light-dark(#171717, #f5f5f5);  /* body text         */
  --color-ink-muted:  light-dark(#525252, #a3a3a3);  /* secondary text    */
  --color-edge:       light-dark(#e5e5e5, #262626);  /* hairlines, inputs */

  /* interactive */
  --color-accent:     light-dark(#171717, #f5f5f5);  /* primary button bg */
  --color-accent-ink: light-dark(#ffffff, #0a0a0a);  /* its label         */
  --color-link:       light-dark(#1d4ed8, #60a5fa);

  /* tones */
  --color-danger-tint:         light-dark(#fef2f2, #450a0a);
  --color-danger-edge:         light-dark(#fca5a5, #7f1d1d);
  --color-danger-ink:          light-dark(#7f1d1d, #fecaca);
  --color-danger-solid:        light-dark(#dc2626, #dc2626);
  --color-danger-solid-hover:  light-dark(#b91c1c, #ef4444);
  --color-success-tint:        light-dark(#f0fdf4, #052e16);
  --color-success-edge:        light-dark(#86efac, #166534);
  --color-success-ink:         light-dark(#14532d, #bbf7d0);
  --color-warning-tint:        light-dark(#fffbeb, #451a03);
  --color-warning-edge:        light-dark(#fcd34d, #92400e);
  --color-warning-ink:         light-dark(#78350f, #fde68a);
}

:root                { color-scheme: light dark; }  /* auto — follows the OS */
[data-theme="light"] { color-scheme: light; }
[data-theme="dark"]  { color-scheme: dark; }
```

`--color-danger-solid` is deliberately the same in both palettes: a destructive action should not
soften in dark mode. Only its hover state lightens, because the light-mode hover darkens and that
reads as *less* prominent against a dark surface.

## First paint

Inline in `<head>`, so it runs before the first paint and there is no flash:

```html
<script>
  try {
    var p = localStorage.getItem("theme");
    if (p === "light" || p === "dark") document.documentElement.dataset.theme = p;
  } catch {}
</script>
```

The script only ever *overrides*. It resolves nothing. Three paths lead to no attribute being set —
the preference is `auto`, `localStorage` threw, or JavaScript is disabled — and all three are
correct, because `color-scheme: light dark` then follows the OS. The empty `catch` is deliberate:
doing nothing is the right behaviour, and a comment in the source says so.

This grows `index.html` by roughly 150 bytes, from 797 to around 950. The 14kB budget measures this
file, and it remains far inside it.

**The snippet duplicates two lines that `theme.ts` also owns.** It cannot import, because it must run
before the module graph loads. The duplication is accepted and commented rather than worked around.

## `web/src/theme.ts`

```ts
export type ThemePreference = "light" | "dark" | "auto";

export function themePreference(): ThemePreference;
export function setThemePreference(preference: ThemePreference): void;
```

`themePreference` reads `localStorage`, returning `"auto"` for an absent, unrecognised or unreadable
value. `setThemePreference` writes it and sets `data-theme`, removing the attribute for `"auto"`.
Both wrap storage access, so a broken `localStorage` degrades to "the choice does not persist" rather
than to a thrown error.

The module owns no rendering and holds no state of its own; the DOM attribute and `localStorage` are
the state.

## The control

A `wd-card` headed **Appearance** in the Settings view, containing a `<fieldset>` with a legend and
three radios: Light, Dark, Auto.

Plain markup and local helper functions, **not a `wd-*` component**. The existing `wd-card`,
`wd-button` and `wd-alert` are reusable primitives; a theme picker has exactly one call site, and the
settings form already builds its controls from local helpers (`field`, `button`, `alertFor`). A
component here would be consistency with the letter of the rule against its purpose.

Radios rather than a select or a cycling button: all three states stay visible, changing is one
click, and it is the correct control for a small mutually-exclusive set. They are native inputs, so
`color-scheme` themes them without extra work, and Playwright drives them by role.

## The retrofit

In scope. Without it the tokens exist and nothing uses them.

| File | Change |
|---|---|
| `web/index.html` | body → `bg-surface text-ink`; header link → `text-ink-muted hover:text-ink` |
| `web/src/components/wd-card.ts` | `bg-white border-neutral-200` → `bg-raised border-edge` |
| `web/src/components/wd-button.ts` | primary → `bg-accent text-accent-ink`; secondary → `border-edge text-ink`; danger → `bg-danger-solid hover:bg-danger-solid-hover` |
| `web/src/components/wd-alert.ts` | each tone → `bg-{tone}-tint border-{tone}-edge text-{tone}-ink` |
| `web/src/views/settings.ts` | inputs → `border-edge focus:border-ink`; link → `text-link`; `divide-neutral-200` → `divide-edge` |

No stock colour utility should remain in `web/src/` or `web/index.html` afterwards.

## Testing

`.claude/e2e/tests/theme.spec.ts`, on Firefox and Chromium. Playwright emulates the OS preference, so
`auto` is directly testable rather than assumed.

1. **No stored preference, OS light** — the body computes a light background.
2. **No stored preference, OS dark** via `emulateMedia({ colorScheme: "dark" })` — the body computes a
   dark background. This covers `auto` and the no-attribute path together.
3. **Choosing Dark** sets `<html data-theme="dark">`, darkens the background, and **survives a
   reload**.
4. **Choosing Auto after Dark** removes the attribute and follows the emulated OS again.
5. **`localStorage` made to throw**, via `addInitScript` replacing `getItem` — the app still themes
   from the OS and the page renders. This is the failure that shaped the design, so it is tested
   rather than asserted in a comment.

Assertions read computed `background-color` and the `data-theme` attribute — real behaviour, not
class names. A test that asserted class names would pass against a stylesheet that never loaded.

Everything runs through Docker: `make verify` for lint and types, `make test-e2e` for the above.

## Out of scope

- **#12's manifest `theme_color` and `background_color`.** They belong to the PWA shell ticket. #12
  must read these tokens rather than invent its own values, or the manifest and the palette will
  disagree on Android — a dependency recorded on both tickets.
- **Per-view dark adjustments** beyond swapping utilities for tokens. If a view needs a bespoke dark
  treatment, that is a finding for its own ticket.
- **User-defined palettes**, a third theme, or a per-instance accent colour. Nothing has asked for
  them.
- **Server-side persistence.** Rejected in brainstorming; revisit only if #13 shows that a
  per-device setting is genuinely wrong.
