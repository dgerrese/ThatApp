# ThatApp — Visual Directions (design canvas, 2026-08-20)

The source of the visual design worked out with the owner on 2026-08-20 and approved board by
board. 25 artboards over five pages, plus the 27 annotations that carry the reasoning.

**This is source material, not a specification.** Issue #44 turns it into a design document under
`../../specs/`. Where the two ever disagree, the spec wins — this directory records what was
decided and why, frozen at the moment it was decided.

## Why it is in the repo

It was published as a Claude artifact and nowhere else:
<https://claude.ai/code/artifact/d1634bc1-ca6c-4b04-a1b9-bd35b3d69b57>

The `.dc.html` sources were written to a session scratchpad that does not persist, and the
`seed-canvas.mjs --extract` recovery path named in the handoff went with it. That left an approved
design whose only copy sat behind an authenticated URL, recoverable only by a tool that no longer
existed. Extracted and committed on 2026-08-20 to end that.

## Layout

| File | What it is |
| --- | --- |
| `annotations.md` | The 27 pinned notes, verbatim, in canvas order, with the artboard index |
| `canvas.json` | Page names, artboard positions and sizes, annotation coordinates |
| `*.dc.html` | One self-contained artboard each — `Main.dc.html` is the canvas entry point |

The five pages are **Directions** (the baseline and three whole-app directions), **Rail options**,
**Manual entry**, **States & mobile** and **Palette split**.

`Hybrid.dc.html` is the direction that was chosen — B's rail, C's character, A's cards — and it
carries the full light and dark token set in `oklch`, which is what #44's `@theme` block is built
from.

Each board is a standalone HTML document with its own inlined `<style>`; the `<script
src="./support.js">` and `<x-dc>`/`<helmet>` wrappers belong to the canvas editor and have no
meaning outside it. They are kept as-is so the directory stays a faithful copy rather than an
interpretation.

## Re-extracting

`../extract_canvas.py` unpacks a saved canvas page. The page needs an authenticated claude.ai
session, so fetch it first and hand the script the saved HTML:

```shell
python3 ../extract_canvas.py <saved-page.html> <output-dir>
```
