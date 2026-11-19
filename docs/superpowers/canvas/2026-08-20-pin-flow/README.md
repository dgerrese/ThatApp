# The pin flow — CB#6's design sources (2026-08-20)

Two records of the same feature, both approved on 2026-08-20, kept because they settle different
things. Where they disagree about how something *looks*, the restyle wins; where they disagree about
how something *behaves*, they do not — the restyle preserves the prototype's interaction exactly.

| File | What it settles |
| --- | --- |
| `approved-prototype.dc.html` | **The interaction.** The clickable prototype the owner reviewed when they replaced the instance-dropdown form with a search select spanning every instance. |
| `pinning-in-hybrid.html` | **The visual language.** The same flow rebuilt in the Hybrid direction, approved 2026-08-20. Self-contained — open it in a browser. |
| `canvas.json` | The prototype's canvas layout. |

Neither is a specification. CB#6's acceptance criteria are on the issue, and the design document its
body cites has never been written — see *What is still missing* below.

## Why they are in the repo

Both were published only as Claude artifacts, with their sources in a session scratchpad that does
not persist:

- prototype — <https://claude.ai/code/artifact/8a115ad1-da54-46c2-9c9a-ff4d41d16c94>
- restyle — <https://claude.ai/code/artifact/f5372ba4-e4d8-494e-bc4a-b365bdcdae1c>

Extracted with `../extract_canvas.py`, the same way the visual-directions canvas was, and for the
same reason: an approved design whose only copy sits behind an authenticated URL is one broken link
from being redesigned from memory.

## What the restyle decided

Carried over from the design language without change: Space Grotesk, the magenta 330 primary on
keys and actions, the dark rail, and per-instance hues as identity only.

Three decisions are the restyle's own, and CB#6 should implement them rather than the prototype's
older versions:

- **A pinned row names its instance by coloured dot alone**, replacing the instance name the
  prototype printed on every row. That returns the width to the summary. The dot carries the
  instance name to assistive tech, so identity never rests on hue alone.
- **Search results keep the name beside the dot.** A deliberate divergence from the dot-alone rule:
  results are scanned across instances you have not seen before, where a hue cannot disambiguate.
  Dot-alone earns its keep on rows you already recognise.
- **An already-pinned result is `aria-disabled`, not `disabled`.** "Already pinned" is worth
  announcing, and a `disabled` button is skipped by screen readers entirely.

The partial-failure line also moves from muted grey to the failed tone — the language reserves red
for exactly this, and grey undersold an unreachable instance.

## One trap worth carrying into CB#44

`--instance: light-dark(oklch(0.60 0.13 var(--h)), …)` declared on `:root` **fails silently**. A
`var()` inside an inherited custom property resolves where that property is *declared*, not where it
is used, so it computes to guaranteed-invalid at `:root` — where `--h` does not exist — and every dot
renders transparent with no error anywhere. The hue has to go in the `background` declaration on the
element itself. CB#44 builds per-instance hues and will meet this.

`pinning-in-hybrid.html` embeds Space Grotesk as a data URI because the artifact CSP blocks font
CDNs. It is **one variable woff2 covering weights 400–700, 22kB** — not the three static files
CB#44's criteria assume.

## What is still missing

`docs/superpowers/specs/2026-08-20-pinned-issues-design.md`, which CB#6's body and the owner's comment
both cite, has never existed on any branch. CB#6's acceptance criteria stand on their own, but the
design document behind them does not exist and would have to be written from these two files.
