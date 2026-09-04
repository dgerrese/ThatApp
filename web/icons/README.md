# The app icon

The mark is the clock glyph from `web/index.html` — the one marking Today in the rail — scaled into
a 512 box: radius 8.5 → 181, stroke 1.9 → 40.5. It is not new artwork, so the installed icon and the
nav item stay the same object. It was chosen on 2026-08-24; the canvas and the three directions
passed over are in `docs/superpowers/canvas/2026-08-24-app-icon/`.

## Why these files are sRGB hex, not oklch

Everything else in this app is authored in oklch and `web/src/styles.css` stays that way. An icon is
consumed by OS shells, installers and rasterisers rather than by a CSS engine, so it is authored in
the form none of them can misread:

| Token | oklch | sRGB |
| --- | --- | --- |
| `--color-rail` (ground) | `oklch(0.105 0.006 60)` | `#050403` |
| `--color-primary-rail` (stroke) | `oklch(0.72 0.19 330)` | `#e472dc` |

Converted through the standard OKLab matrices. `#050403` is also `manifest.json`'s `theme_color` and
`background_color`.

## Regenerating the PNGs

**This is a one-off.** The PNGs are committed, and they only need regenerating if the mark itself
changes — a design-language event, not a development one. There is deliberately no `make` target and
no build step: infrastructure that runs once every couple of years is broken by the time it is
needed.

```shell
convert -background none icon.svg          -resize 192x192 -strip icon-192.png
convert -background none icon.svg          -resize 512x512 -strip icon-512.png
convert -background none icon-maskable.svg -resize 512x512 -strip icon-maskable-512.png
```

**These run on the host, which is an exception the project owner granted on 2026-08-24** for this
one-off, not a precedent. `CLAUDE.md`'s rule stands: everything else runs in Docker. Do not read
these three lines as licence to reach for host tooling elsewhere, and do not "fix" them into a
container step — that was considered and rejected as over-building for a command run twice in the
app's life.

Rendered by ImageMagick 6.9.12's internal renderer; `rsvg-convert` is not installed and is not
needed. `icon-maskable.svg` has its geometry pre-scaled to 72% rather than wrapped in a `transform`,
because that renderer's transform handling is the part not to trust.

`icon.svg` is also the browser tab icon, so it ships as well as generates.
