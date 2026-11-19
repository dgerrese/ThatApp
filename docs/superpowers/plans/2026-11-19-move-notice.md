# Move notice Implementation Plan

**Date:** 2026-11-19
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The last image published to Codeberg shows a fixed "ThatApp moved to GitHub" block at the top of the rail foot.

**Architecture:** Static markup only. The block goes into `#rail-version` in `web/index.html`, before the `[data-version]` box that #348's `paintVersion` appends, so a repaint never touches it. No script, no API.

**Tech Stack:** HTML, Tailwind v4 utilities against the existing rail tokens, Playwright.

**Spec:** issue #349's body and the approved mockup `.superpowers/brainstorm/219294-1795019192/content/foot-states-v2.html`, **fourth rail** (local, git-ignored). Builds on #348 (branch `issue-348-update-notice`, PR #352).

## Global Constraints

- Copy, exactly: `ThatApp moved to GitHub` / `Change your image to` / `ghcr.io/dgerrese/thatapp:stable` / `How to switch`.
- Styling: block background `--color-rail-active`, `rounded-sm` (4px), 10px padding, 5px between lines, `-mx-2.5` so its edges meet the foot's padding as drawn, 4px below it before #348's lines; heading 13px bold `pending-rail`; `Change your image to` 12.5px `rail-ink`; image name Chivo Mono (`font-mono`) 11px `rail-ink`, with a `<wbr>` after `ghcr.io/dgerrese/` and no other break point (`break-normal`, never `break-all`); `How to switch` 12.5px bold `primary-rail` with `iconMarkup("external", 13)`'s SVG inlined, a link that opens a new tab, `rel="noopener"`, and an `sr-only` " (opens in a new tab)" exactly as #348's update link does.
- Link target: `https://github.com/dgerrese/ThatApp#moving-from-codeberg`. #350's README must carry a heading `Moving from Codeberg` (that anchor) — recorded on #350.
- The rail scrolls from `md:` up (`md:overflow-y-auto` on the `<aside>`), so "nothing cut off" means every part of the foot is inside the rail's scrollable box and reachable, at the smallest height tested.
- No JS framework, light DOM, initial HTTP response under 14kB.

## Review Focus

1. A repaint by `paintVersion` (update appears, then disappears) leaves the block in place and above the version lines.
2. A short window (1280×480) with the block, a failure line and the version: every part reachable by scrolling the rail, none clipped horizontally.
3. The image name never breaks inside `thatapp:stable`, at the rail's fixed 216px width.
4. The block shows on Today and on Week.
5. `/api/version` failing entirely: the block still shows (it is static).

Each is tested in Task 1.

---

### Task 1: The block, its tests, and the drawing check

**Files:**
- Modify: `web/index.html` (inside `#rail-version`)
- Modify: `.claude/e2e/tests/rail-version.spec.ts` (the existing #348 spec; add a `describe` for the move block)
- Modify: `web/src/rail-version.test.ts` (one repaint test)

**Interfaces:**
- Consumes: `#rail-version` and `paintVersion(foot, status)` from #348 (`web/src/rail-version.ts`), which appends its own `[data-version]` box after any existing children.
- Produces: `<div data-moved>` as the first child of `#rail-version`.

- [ ] **Step 1: Write the failing tests**
  - Unit: a foot containing a `[data-moved]` child, painted with "update available" then with "up to date", still has `[data-moved]` as its first child and its `textContent` unchanged.
  - e2e: on `/today` and on `/week`, `[data-moved]` reads the four copy strings; the link's `href` is the target above, `target="_blank"`; at 1280×480 with `/api/version` answering `{"version":"2026.47.1","latest":null,"error":"GitHub did not answer."}`, scroll the rail to the bottom and assert every element in `#rail-version` lies inside the `<aside>`'s box (left, right and bottom); the image name's text node renders on exactly two lines with the second line `thatapp:stable` (measure with a `Range` over the text, `getClientRects()`); with `/api/version` answering 500, `[data-moved]` is still visible.
- [ ] **Step 2: RED** — `docker compose run --rm --no-deps web node --test src/rail-version.test.ts` and `make test-e2e`; failing on assertions.
- [ ] **Step 3: Implement** the markup with the Global Constraints' styling.
- [ ] **Step 4: GREEN + mutation** — move the block after the version box; replace `<wbr>` with nothing and use `break-all`; drop `target`. Each red, restored.
- [ ] **Step 5: Drawing check** — screenshots of the block with a failure line, dark and light, compared with rail four of the mockup (text, order, colour roles, sizes, spacing, the break after the slash). Report what was compared and what differed.
- [ ] **Step 6: Gates** — `make verify` and `make test-e2e`, both green.
- [ ] **Step 7: Commit** — `feat(#349): the rail foot tells users the app moved to GitHub`

### After the task (controller)

- The release notes for the last Codeberg release (criterion 5) are written when that release is published, not in this branch.
- The pull request is stacked on #352: base `issue-348-update-notice`, body opening `Stacked on #352`.
