# The PWA shell — #12 design

**Date:** 2026-08-24
**Supersedes:** nothing
**Superseded by:** nothing

This settles ticket 12: the app becomes installable, survives a lost connection, and keeps showing
the Jira lists it last saw. It does not make the app reachable from a phone — that needs HTTPS and
is ticket 13.

The design of record (`2026-08-04-thatapp-design.md`) names the ticket in one line and lists
`manifest.json` in the served tree. Everything below is new.

## What ships

| Piece | Where |
| --- | --- |
| The mark, as SVG source and three PNGs | `web/icons/` |
| The web app manifest | `web/manifest.json` |
| The service worker | `web/src/sw.ts`, built to `dist/sw.js` |
| Registration | `web/src/main.ts` — not an inline script |
| Staleness plumbing | `web/src/api.ts`, `web/src/views/today.ts` |
| A manifest content type | `internal/server/server.go` |

## The mark

The icon is the clock glyph already in `web/index.html`, the one marking Today in the rail, scaled
into a 512 box: radius 8.5 → 181, stroke 1.9 → 40.5, hands 12 → 4.5. Nothing about it is new
artwork, which is the point — the installed icon and the nav item are the same object, so the home
screen teaches the rail and the rail teaches the home screen.

It was chosen on 2026-08-24 from four directions drawn in the app's own tokens. The canvas is
`docs/superpowers/canvas/2026-08-24-app-icon/`, and the three passed-over directions are kept on its
second page with the reason each lost. They are not to be re-argued from memory.

Ground `oklch(0.215 0.018 55)` — `--color-rail`'s light value, the one surface in this app that
does not invert. Stroke `oklch(0.66 0.19 330)` — `--color-primary-rail`. Corner radius 112/512, so
the icon carries its own rounding at every size.

**The SVGs are the source and the PNGs are committed beside them.** Android needs raster icons, and
generating them is a **one-off** — the mark changes only when the nav glyph changes, which is a
design-language event rather than a development one. So there is no `make` target, no build step and
no new dependency: three `convert` commands, recorded in `web/icons/README.md`, run when the mark
changes and at no other time. Infrastructure that runs twice in an app's life is broken by the time
it is needed.

They run on the host, using its ImageMagick. **That is an exception the owner granted on 2026-08-24
for this one-off, not a precedent** — `CLAUDE.md`'s "everything runs in Docker" stands for
everything else, and the three commands carry that caveat where they are written down so a later
reader does not treat them as licence or as a violation to correct.

| File | Size | Purpose |
| --- | --- | --- |
| `icon.svg` | — | Source. Also the browser tab icon, so it ships as well as generates. |
| `icon-maskable.svg` | — | Source for the maskable variant, geometry pre-scaled to 72%. |
| `icon-192.png` | 192 | The installability floor. |
| `icon-512.png` | 512 | Splash and store surfaces. |
| `icon-maskable-512.png` | 512 | `purpose: "maskable"` — full-bleed ground. |

The maskable variant is a separate file rather than a second `purpose` on the same one: a mark that
fills its box is wrong under a circle mask, and one sized for a circle mask floats when shown
unmasked. Its geometry is pre-scaled rather than wrapped in a `transform` because the host has no
`rsvg-convert`, so ImageMagick renders through its own renderer, and transforms are the part of it
not to trust.

**The icon files are authored in sRGB hex, not oklch** — `#201712` ground, `#d05fc8` stroke. An icon
is read by OS shells, installers and rasterisers rather than by a CSS engine, so it is written in
the form none of them can misread. `styles.css` stays oklch.

`build.mjs` copies `web/icons/` into `dist/icons/` the way it already copies `web/fonts/`, for the
same reason recorded in its comment — esbuild and Tailwind only emit what they are given.

## The manifest

`web/manifest.json`, copied into `dist/` by `build.mjs`:

| Field | Value | Why |
| --- | --- | --- |
| `name` | ThatApp | |
| `short_name` | Dashboard | Home-screen labels truncate near 12 characters. |
| `start_url` | `/today` | The instrument, not the settings page. |
| `scope` | `/` | |
| `display` | `standalone` | |
| `theme_color` | `#201712` | The rail ground. |
| `background_color` | `#201712` | Matching, so the splash does not flash a light panel before a dark rail. |
| `icons` | the three PNGs | With `sizes`, `type`, and `purpose` on the maskable one. |

**The colours are hex for the same reason the icon is.** `#201712` is `oklch(0.215 0.018 55)` through
the standard OKLab matrices, and the committed icons are rendered from that same hex, so the manifest
colour and the artwork cannot drift apart.

**`handleAsset` gains one special case:** `manifest.json` is served as `application/manifest+json`.
Go's `ServeFileFS` types it from the extension and would say `application/json`, which browsers
accept but which is not what the file is. Three lines, and a test that would fail if someone
generalises the handler and drops it.

## The service worker

### How it is built

A second esbuild entry, `web/src/sw.ts` → `dist/sw.js`, built as a **classic script**: `format: "iife"`,
no splitting, no imports at runtime. Module service workers are not something to rely on with
Firefox as the primary target, and a classic bundle costs nothing here — the worker is small and
has no reason to share code with the app.

Served from the root, so its scope is `/` without a `Service-Worker-Allowed` header.

### What it precaches

The build generates the precache list, because chunk filenames carry content hashes and a
hand-written list would rot silently the first time a view is added. `build.mjs` reads esbuild's
metafile after the build, and stamps two things into `sw.js`: the list of emitted files, and a
build id derived from their contents. The build id names the cache.

**The install step verifies what it receives.** `handleAsset` falls back to `index.html` for any
path it cannot find, so a request for a chunk that is missing returns HTML with a 200. Precaching
that would poison the cache with an HTML file under a `.js` name, and the failure would surface
later as a syntax error in a view that used to work. So install checks each response's
`Content-Type` against what the extension asked for — `.js` must answer as JavaScript, `.css` as
CSS — and **fails the install** rather than caching a lie. A
failed install leaves the previous worker in place, which is the correct outcome: the app keeps
working and the next deployment tries again.

### The request classes

| Request | Strategy | Why |
| --- | --- | --- |
| Hashed chunks, fonts, icons | Cache-first | A content-addressed name cannot change meaning. |
| `index.html`, `app.css`, `app.js`, navigations | Network-first, cache fallback | These three change in place, so the network is the only source that is always right. |
| `GET /api/issues`, `GET /api/pins` | Network-first, cache fallback, marked stale | Read-only Jira data. Already stale when it arrives. |
| Everything else under `/api/` | **Network only, never cached** | Entries, pushes, instances, connection tests. |

Four rows, three ideas: content-addressed things are cached forever, things that change in place
are asked for first, and the app's own truth is never cached at all.

The last row is the rule the whole design hangs on. `/api/entries` and #9's push are the app's own
truth, computed from SQLite on this machine; a cached copy of them would be a lie about the owner's
own work, and the derived push state — which `CLAUDE.md` names as one of the two places most bugs
will come from — must never be rendered from anything but a live read.

Network-first for the shell also removes what would otherwise be an environment switch. `make up`
and `make test-e2e` both run `go run -tags dev`, reading assets from disk, so a rule keyed to
"embedded assets" would have disabled the worker under the suite meant to prove it works. There is
no such rule: the worker registers everywhere, and a dev rebuild always wins while the server is up.

### Updating

There are two caches, `that-shell-<build id>` and `that-data-<build id>`. `install` precaches into the
first and calls `skipWaiting()`. `activate` deletes **every** cache whose name does not carry the
current build id — old shells and old data alike — then `clients.claim()`.

**The data cache goes with them, deliberately.** Cached JSON belongs to the build that produced it:
#7 is about to add totals to `IssuesResponse`, and a shell from the new build rendering a body from
the old one is a bug with no error message. A deployment therefore starts with no last-known data
rather than with data whose shape predates the code reading it.

## Staleness, and how it reaches a view

**The worker stamps the response; the app never infers.** When the worker serves `/api/issues` or
`/api/pins` from cache because the network attempt failed, it returns the cached body with one added
header, `X-THAT-Cached-At`, carrying an ISO-8601 UTC timestamp.

`navigator.onLine` is not the signal. It reports "online" for a captive portal and for a container
that is simply stopped, and the question a view actually needs answered is not "is there a network"
but "did this body come off the wire".

`api.ts` grows an internal `requestWithMeta` returning `{value, cachedAt}`. **`request<T>` keeps its
exact signature**, so `listInstances`, `createInstance`, `updateInstance`, `deleteInstance`,
`testInstance`, `createPin`, `deletePin` and `searchIssues` are untouched. Only `listIssues` and
`listPins` change shape, and only their call sites in `today.ts` move.

The view renders a `that-alert` with `tone="warning"` above the affected list:

> Showing what was here at 14:32 — no connection to the server.

Recovery is the `online` event re-running the refresh the view already has. A successful fetch
overwrites the cache entry, the header stops arriving, and the alert clears itself.

**The write path needs no change at all.** `request` already turns a failed fetch into
`ApiError(0, "network_error", "Could not reach the dashboard server.")`, and every view already
renders that through `messageOf`. Offline writes fail with correct words today.

## The design language, widened

`2026-08-20-visual-design-language.md` line 93 reads "amber says *not yet sent*". The owner widened
that on 2026-08-24: **amber is warning, and "not yet sent" is one instance of it.** Stale data is
another. Line 93 and the "All pushed" paragraph at line 288 are updated to match, so the document
and the code agree — `that-alert` already announces that tone to a screen reader as "Warning", so the
narrow reading only ever lived in the prose.

## The 14 kB budget

`index.html` is 5,724 bytes today. This ticket adds two `<link>` elements — the manifest and the tab
icon — and nothing else: **registration lives in `main.ts`, not in an inline script**, so it costs
the shell zero bytes and rides a bundle the browser is already fetching.

The budget is asserted, not eyeballed: a Go test serves `/` through the real handler and fails if
the body exceeds 14,336 bytes. It measures what the server sends, which is the number that matters,
and it will keep measuring it as later tickets grow the rail.

## Testing

**Go** — the server's side of the contract:

- `manifest.json` is served as `application/manifest+json`.
- `sw.js` is served as JavaScript and is not the `index.html` fallback wearing a `.js` name.
- `/` stays under 14,336 bytes.
- Each committed PNG decodes with `image/png` to exactly the dimensions `manifest.json` declares for
  it. Cheap, stdlib-only, and it catches the real install-breaker — a manifest claiming 512 over a
  192 file. It does **not** catch an edited SVG whose PNGs were never regenerated; nothing short of
  rasterising on every build would, and that is the build step deliberately not taken.

**Playwright** — the worker's behaviour, which only a browser can show:

- Load, go offline, reload: the shell renders.
- Load with issues, go offline, reload: the lists render from cache with the warning and a
  timestamp.
- Back online: the warning clears without a manual reload.
- Offline, attempt a write: it fails with the network message, and nothing is queued.
- A second load after a rebuild picks up the new `app.js` rather than the cached one.

The e2e `paths:` gate in `.github/workflows/e2e.yml` already covers every file this adds — they are
all under `web/**` or in the `Makefile`.

## Deliberately out of scope

- **A write queue.** Offline writes fail and are retried by the owner. Queueing them is its own
  subsystem, and #9's push already owns "this did not make it".
- **Caching anything under `/api/entries`.** See the third request class.
- **Background sync and push notifications.** Neither has a use here.
- **HTTPS and the phone.** Ticket 13.

## The issue's criteria, corrected

#12's body currently says `/api/*` responses are "**never** cached: the shell goes offline, the data
does not", and gives a reason — that caching entries would raise a write-sync question this app has
no answer for. The owner chose last-known data on 2026-08-24, so that criterion is rewritten to say
what this design does: **Jira-derived reads are cached and shown marked stale; everything else under
`/api/` is never cached.** The original reasoning survives intact, narrowed to where it is true —
entries and pushes, not read-only Jira lists.
