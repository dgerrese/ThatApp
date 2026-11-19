# The app icon — CB#12's design source (2026-08-24)

Four directions for the PWA's icon, drawn in the app's own tokens, and the one chosen.

| File | What it holds |
| --- | --- |
| `Main.dc.html` | **B · Clockface — chosen.** The Today nav glyph from `web/index.html`, scaled into a 512 box. |
| `Monogram.dc.html` | A · Monogram — passed over. |
| `Split.dc.html` | C · Split — passed over. |
| `Ring.dc.html` | D · Ring — passed over. |
| `canvas.json` | The layout: the chosen mark on one page, the three passed over on a second, each with the reason it lost. |

The unchosen three are kept on purpose. CB#6 showed what it costs when an approved design exists only
as a memory of a decision — see `../2026-08-20-pin-flow/README.md`.

Published as <https://claude.ai/code/artifact/61290e4b-98b4-4dfc-ac00-9703240b338a>.

The seeded page that carries the canvas editor is **not committed** — it is ~2MB of generated
payload and is rebuilt from the files above with the `design` skill's `seed-canvas.mjs`. The
artboards are the source; the published page is a rendering of them.

Every value in the artboards is transcribed from `web/src/styles.css`, not chosen here: ground
`oklch(0.215 0.018 55)`, stroke `oklch(0.66 0.19 330)`, instance hues 265/175/295. The rules that
govern them are `../../specs/2026-08-20-visual-design-language.md`, and what the icon becomes is
settled in `../../specs/2026-08-24-pwa-shell-design.md`.
