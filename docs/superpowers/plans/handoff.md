# ThatApp — handoff

**Date:** 2026-09-01
**Formerly:** `docs/superpowers/plans/2026-08-12-handoff.md`, split on 2026-09-01. Plans and specs
written before that date cite the old path in prose; they were deliberately not rewritten.
**Supersedes:** nothing
**Superseded by:** the design of record, wherever the two disagree —
[`docs/superpowers/specs/2026-08-04-thatapp-design.md`](../specs/2026-08-04-thatapp-design.md)

This is the document a session resumes from — on this machine or another one. It holds *state* and
*decisions already taken*, so neither has to be rediscovered or relitigated. It does not repeat the
design (that is the spec) or the rules (that is `CLAUDE.md` and the `ticket-workflow` skill).

**This file holds current state only.** The day-by-day narrative lives in [`handoff/`](handoff/),
one file per day, named `YYYY-MM-DD.md`. Read a day only to learn how something came to be — nothing
there is load-bearing, because anything a later session must not rediscover is promoted into this
file on the day it happens.

**Keep it current.** Update it when a ticket changes status, when a decision lands that a later
session should not reopen, and when work stops mid-flight. The day's narrative goes to
`handoff/<today>.md`. It is a project-design document, so it needs no ticket.

---
## Where things stand

**Verified on 2026-11-11**, against the Codeberg API rather than against local git — see
*Environment notes* for why the two disagree. This ledger is the authority on status; the narrative
further down is history and says otherwise in places.

> **The forge changed twice.** On 2026-09-01 the project moved from GitHub to Codeberg, keeping its
> numbers. On 2026-11-19 it moved to `github.com/dgerrese/ThatApp` ([#46](https://github.com/dgerrese/ThatApp/issues/46)), and the numbers changed:
> a `#<n>` here is a GitHub number, and `CB#<n>` is a closed Codeberg item, linked to its archive
> file in `docs/archive/codeberg/` where one exists. See *Decisions taken*.

### 2026-11-18 — read this first

Day file: [`handoff/2026-11-18.md`](handoff/2026-11-18.md). **The project is moving back to GitHub.**
[#46](https://github.com/dgerrese/ThatApp/issues/46) holds the whole design and is at `status/todo`; read its body before touching the forge. **Do not
create `github.com/dgerrese/ThatApp` before the owner explicitly approves it.** The order is: CB#348
(update notice) and CB#349 (move notice) — both refined and at `status/todo` after one design session
(mockup `.superpowers/brainstorm/219294-1795019192/content/foot-states-v2.html`) — then one last stable Codeberg release, then [#46](https://github.com/dgerrese/ThatApp/issues/46). Releases milestone reopened for all three.

**The board on 2026-11-18 (API-checked).** 32 at `status/todo` (the 29 below plus CB#348, CB#349, [#46](https://github.com/dgerrese/ThatApp/issues/46)),
11 at `status/needs-refinement` (unchanged), nothing in progress, blocked or at intake. No pull request
is open apart from today's handoff, `handoff-2026-11-18`, which also carries the 2026-11-12 record:
that day's handoff branch was never pushed.

### 2026-11-12 — read this first

Day files: [`handoff/2026-11-12.md`](handoff/2026-11-12.md), [`handoff/2026-11-11.md`](handoff/2026-11-11.md).
The owner merged PR CB#347. (This day's handoff went out only on 2026-11-18, inside that day's pull request.) **[#44](https://github.com/dgerrese/ThatApp/issues/44) is refined
and at `status/todo`** after a design session; Week gains muted targets under its totals.

**The board on 2026-11-12 (API-checked).** Intake is empty. Nothing is in progress.
- **`status/todo` (29):** [#7](https://github.com/dgerrese/ThatApp/issues/7), [#8](https://github.com/dgerrese/ThatApp/issues/8), [#9](https://github.com/dgerrese/ThatApp/issues/9), [#10](https://github.com/dgerrese/ThatApp/issues/10), [#12](https://github.com/dgerrese/ThatApp/issues/12), [#14](https://github.com/dgerrese/ThatApp/issues/14), [#15](https://github.com/dgerrese/ThatApp/issues/15), [#17](https://github.com/dgerrese/ThatApp/issues/17), [#18](https://github.com/dgerrese/ThatApp/issues/18), [#19](https://github.com/dgerrese/ThatApp/issues/19), [#20](https://github.com/dgerrese/ThatApp/issues/20), [#21](https://github.com/dgerrese/ThatApp/issues/21), [#22](https://github.com/dgerrese/ThatApp/issues/22),
  [#23](https://github.com/dgerrese/ThatApp/issues/23), [#24](https://github.com/dgerrese/ThatApp/issues/24), [#25](https://github.com/dgerrese/ThatApp/issues/25), [#26](https://github.com/dgerrese/ThatApp/issues/26), [#27](https://github.com/dgerrese/ThatApp/issues/27), [#28](https://github.com/dgerrese/ThatApp/issues/28), [#29](https://github.com/dgerrese/ThatApp/issues/29), [#30](https://github.com/dgerrese/ThatApp/issues/30), [#31](https://github.com/dgerrese/ThatApp/issues/31), [#32](https://github.com/dgerrese/ThatApp/issues/32), [#33](https://github.com/dgerrese/ThatApp/issues/33), [#34](https://github.com/dgerrese/ThatApp/issues/34), [#36](https://github.com/dgerrese/ThatApp/issues/36), [#37](https://github.com/dgerrese/ThatApp/issues/37), [#43](https://github.com/dgerrese/ThatApp/issues/43), [#44](https://github.com/dgerrese/ThatApp/issues/44). Each body holds
  the owner's decisions; design-session mockups are named in the bodies and live only on this
  machine, in `.superpowers/brainstorm/48100-1793790116/content/`, (for [#15](https://github.com/dgerrese/ThatApp/issues/15) and [#43](https://github.com/dgerrese/ThatApp/issues/43))
  `.superpowers/brainstorm/12804-1793871242/content/`, ([#43](https://github.com/dgerrese/ThatApp/issues/43)'s rail)
  `.superpowers/brainstorm/267750-1794400242/content/` and ([#44](https://github.com/dgerrese/ThatApp/issues/44))
  `.superpowers/brainstorm/42810-1794486471/content/` (git-ignored).
- **`status/needs-refinement` (11):** [#6](https://github.com/dgerrese/ThatApp/issues/6), [#11](https://github.com/dgerrese/ThatApp/issues/11), [#16](https://github.com/dgerrese/ThatApp/issues/16) and [#35](https://github.com/dgerrese/ThatApp/issues/35) still need a design session; [#13](https://github.com/dgerrese/ThatApp/issues/13) is
  **parked** by the owner; [#38](https://github.com/dgerrese/ThatApp/issues/38)–[#42](https://github.com/dgerrese/ThatApp/issues/42) are the Team reporting milestone; **[#45](https://github.com/dgerrese/ThatApp/issues/45)** (presence events
  from the absence feed, split from [#43](https://github.com/dgerrese/ThatApp/issues/43) on 2026-11-11; needs a personal-feed sample holding a
  presence event before planning).
- **[#43](https://github.com/dgerrese/ThatApp/issues/43) can now be planned**, after [#15](https://github.com/dgerrese/ThatApp/issues/15) and [#44](https://github.com/dgerrese/ThatApp/issues/44). Its pending-request marker ("? ") is confirmed
  in the company feed only.
- **"Pending schedule" is the owner's term** ([#44](https://github.com/dgerrese/ThatApp/issues/44)) for a schedule whose start date is still ahead.
- **[#36](https://github.com/dgerrese/ThatApp/issues/36)'s rule changed on 2026-11-05:** an entry's start may be in the future (body updated).

**Stacking that the bodies record:** [#30](https://github.com/dgerrese/ThatApp/issues/30) and [#27](https://github.com/dgerrese/ThatApp/issues/27) build on [#29](https://github.com/dgerrese/ThatApp/issues/29) (`issue_cache`); [#33](https://github.com/dgerrese/ThatApp/issues/33) on [#28](https://github.com/dgerrese/ThatApp/issues/28);
[#34](https://github.com/dgerrese/ThatApp/issues/34) on [#14](https://github.com/dgerrese/ThatApp/issues/14); [#14](https://github.com/dgerrese/ThatApp/issues/14)'s estimate row on [#27](https://github.com/dgerrese/ThatApp/issues/27); [#15](https://github.com/dgerrese/ThatApp/issues/15) on [#36](https://github.com/dgerrese/ThatApp/issues/36); [#43](https://github.com/dgerrese/ThatApp/issues/43) on [#15](https://github.com/dgerrese/ThatApp/issues/15) and [#44](https://github.com/dgerrese/ThatApp/issues/44) (order: [#36](https://github.com/dgerrese/ThatApp/issues/36) → [#15](https://github.com/dgerrese/ThatApp/issues/15) → [#44](https://github.com/dgerrese/ThatApp/issues/44) → [#43](https://github.com/dgerrese/ThatApp/issues/43), or [#44](https://github.com/dgerrese/ThatApp/issues/44) before [#15](https://github.com/dgerrese/ThatApp/issues/15)); [#45](https://github.com/dgerrese/ThatApp/issues/45) on [#43](https://github.com/dgerrese/ThatApp/issues/43) and [#44](https://github.com/dgerrese/ThatApp/issues/44). [#30](https://github.com/dgerrese/ThatApp/issues/30) and [#31](https://github.com/dgerrese/ThatApp/issues/31) edit the same grid.

**Owner's rules set on 2026-11-04 live in the tickets, not in process documents**: each is a design
decision for one ticket. None changes how the project is run.

PR CB#324 ([CB#322](../../archive/codeberg/322.md)) merged on 2026-10-26: the release script
sets `:stable` on a stable release, and the README runs and upgrades from `:stable`. **The Releases
milestone** was closed by the owner and reopened on 2026-11-18 for CB#348, CB#349 and [#46](https://github.com/dgerrese/ThatApp/issues/46).
A new milestone, **Week view**, holds [#30](https://github.com/dgerrese/ThatApp/issues/30) and [#31](https://github.com/dgerrese/ThatApp/issues/31). **Polish** (vague name on purpose, owner 2026-11-04) holds [#35](https://github.com/dgerrese/ThatApp/issues/35), the Rovo joke feature: visual only, reset on reload.
**Owner's rule (on [#18](https://github.com/dgerrese/ThatApp/issues/18)):** every failure says *what* went wrong — no generic "Something went wrong.".

**Milestones are feature sets now**, not `v1` and `v2` (PR CB#323). Both are closed. An autopilot run
needs the owner to name a milestone.

**`v2026.44.1` is the first stable release**, published 2026-10-26 from main `5d79964`. Its image is
`:2026.44.1`, `:latest` and `:stable`.

**Two channels, set by the owner.** `:latest` moves on every release, pre-releases included, on
purpose. `:stable` moves only on a stable release and is the default. **CI publishes every release**
to `ghcr.io/dgerrese/thatapp` (`.github/workflows/release.yml`): a merge to `main` that changes more
than documentation is a pre-release, and **closing a milestone is a stable release**, built again
from `main`, whose notes list the milestone's closed issues. There are no manual release commands
any more, and no question to ask: the owner closing a milestone is the decision.

### 2026-10-21 — superseded

PR CB#320 (CB#316) merged; v1 emptied and closed on 2026-10-26.

### 2026-10-21 — history

**Two autopilot runs on v1.** Day file: [`handoff/2026-10-21.md`](handoff/2026-10-21.md).

**One pull request waits on the owner: PR CB#320 (CB#316).** `mountFixed` and `mountCutText` in
`tooltip.spec.ts` wait for the tooltip upgrade, with one late-chunk test each. The two decisions it
leaves the owner to reverse are in its body. Gates on `ddadf08`: `make verify` OK, `make test-e2e`
1162 passed, 0 failed. **CB#316 is v1's last open ticket**; merging CB#320 empties v1.

**Merged on 2026-10-21:** PR CB#315 ([CB#307](../../archive/codeberg/307.md)), PR CB#317 ([CB#309](../../archive/codeberg/309.md)), PR CB#319 (CB#297, shipped by the first run),
and the handoffs PR CB#314 and PR CB#318. Their tickets lost `status/in-progress` by hand. The owner
approved CB#316 and it was refined in an attended session the same day.

**Labels are clean**, checked across all 183 issues at end of day.

### 2026-10-14 — superseded

Everything the 2026-10-14 block listed as open (PRs CB#314, CB#315, CB#317, the unfinished CB#297 and intake
CB#316) merged or shipped on 2026-10-21. Its narrative is in
[`handoff/2026-10-14.md`](handoff/2026-10-14.md).

### 2026-10-07 — read this first

**Codeberg's hosted CI is stopped for this repository** ([CB#284](../../archive/codeberg/284.md), its run volume). Until it is back,
both `make verify` and `make test-e2e` run on this machine before every pull request, and the
results go into the body. Pull requests that wait together are also tested merged, on a local
scratch branch that is never pushed. The rule is in `ticket-workflow` through PR CB#292
(`[Process]`, merged). [CB#220](../../archive/codeberg/220.md) (a self-hosted runner, v2) is the lasting answer.

**No pull request waited on the owner then** (superseded by *2026-10-21 — read this first*). [CB#253](../../archive/codeberg/253.md) (the MCP server) merged as PR CB#291. `delete_entry`
refused an entry with a Jira worklog, by the owner's decision of 2026-10-07. CB#280 (PR CB#304, merged 2026-10-09) removed
that check, because a delete of a pushed entry now waits for Push.

**Release `v2026.41.1` was built on this machine, not by CI.** (Its recipe is superseded by the one in *2026-11-04 — read this first*, which adds the `stable` channel.) Actions are off for the repository
(`has_actions: false`), so a tag no longer starts `release.yml`. The same script ran locally:
`REGISTRY_USER=DionGerrese REGISTRY_TOKEN=… docker compose run --build --rm --no-deps -e REGISTRY_USER
-e REGISTRY_TOKEN app sh scripts/release-image.sh 2026.41.1 codeberg.org/diongerrese/thatapp`, after
`make build-web`. Then `tea releases create --tag v… --target <sha> --prerelease`. The token needs
only the *package* permission and repository access **All**, because a token limited to specific
repositories cannot hold the package permission. It sat in `~/.config/thatapp-release-token` (mode
600), which the owner may have removed.

**Merged today:** CB#226 (PR CB#286), CB#272 (CB#287), [CB#267](../../archive/codeberg/267.md) (CB#288) and CB#259 (CB#289), and yesterday's handoff
(CB#285). **CB#261 is closed, rescoped:** the stop dialog commits while it still holds focus, so no
rebuild of the rail ever happens with focus in the rail. Its branch `issue-261-rail-focus-survives-rebuild`
holds a helper the owner dropped. Do not revive it.

**v1 at the end of 2026-10-09.** **No pull request waited on the owner then** (superseded by *2026-10-21 — read this first*). Merged today: [CB#281](../../archive/codeberg/281.md) (PR CB#298),
CB#280 (PR CB#304, the deferred delete), [CB#144](../../archive/codeberg/144.md) (PR CB#306, two card stacks), CB#301 (PR CB#308, the connection
test changes only the health slot), CB#305 (PR CB#310, a failed Refresh keeps its alert), the ponytail
rule (PR CB#302, `[Process]`) and the README's docker-hoster section (PR CB#299, `[Docs]`). The decisions
each of those left for the owner to reverse are in its PR body and on its ticket, and in
[`handoff/2026-10-09.md`](handoff/2026-10-09.md).

**v1's three refined tickets were worked on 2026-10-14** — see *2026-10-21 — read this first* above.

**Ponytail is part of how code is written here** (owner, 2026-10-09; `CLAUDE.md` and
`ticket-workflow`): every implementer and reviewer dispatch loads `ponytail:ponytail`, and the
whole-branch review also runs `ponytail:ponytail-review`.

**Decisions the owner may still reverse**, recorded on their tickets:
- CB#226: one retry per click, shared with CB#207. A second 409 after it closes the dialog quietly.
- [CB#267](../../archive/codeberg/267.md): the tooltip-first Escape applies everywhere, including search-result rows and Settings, so
  a focused control there takes one extra Escape.
- CB#273 was declined on 2026-10-06. The visual language still says Push becomes Retry after a
  partial failure, which the app does not do. That sentence is stale and needs its own ticket.

### The second retro ran on 2026-10-12 — do not reopen its rules

[`retros/2026-10-12-retro.md`](../retros/2026-10-12-retro.md). Both proposals approved: eod reads the
remote name from `branch.main.remote` and writes `${snap}` (zsh ate `$snap:r` on 2026-10-06); and a
task is not over until its subagent's background work is stopped, before the next dispatch.

### The first retro ran on 2026-10-05 — do not reopen its rules

[`retros/2026-10-05-retro.md`](../retros/2026-10-05-retro.md). The owner approved all eight
proposals, and each one is now in a skill or `CLAUDE.md`: every session sweeps closed issues for
stale `status/*` labels when it starts; a defect in the ticket's own feature is fixed on the branch
or blocks it; an owner's rule reaches its skill the same day; every new or changed assertion is
proven by mutation; ticket comments are read before refinement or any status move; a running
subagent owns the working tree; a failed create is searched for before a retry; design mocks prefix
their classes. It raised intake **[CB#276](../../archive/codeberg/276.md)** (strip `status/*` on close in CI).

### The state at the end of 2026-09-30 — read this first

**This block supersedes everything below it in this section where the two disagree.** The day is in
[`handoff/2026-09-30.md`](handoff/2026-09-30.md).

**`main` is at `5eee5ee`** (the merge of PR CB#270, CB#107). **Merged on 2026-09-30** by the owner: the
2026-09-29 handoff (PR CB#265), CB#231 (PR CB#260), CB#236 (PR CB#262), CB#234 (PR CB#263), CB#250 (PR CB#264), CB#246
(PR CB#266), CB#205 (PR CB#269), the autopilot in-progress rule (PR CB#271, `[Process]`) and CB#107 (PR CB#270).
**Every one of those tickets kept `status/in-progress` after closing and was stripped by hand** — the
merge still does not remove it.

**PR CB#274 (CB#123, toasts) was open at the end of 2026-09-30; the owner merged it that evening.** It carries two design differences and four
questions for the owner in its body — see *Still open for the owner* below.

**v1 has no `status/todo` ticket and nothing in progress but CB#123.** Autopilot ran twice on
2026-09-30. **A run now takes `status/in-progress` tickets before `status/todo` ones** (PR CB#271): the
owner set that on 2026-09-21, and it reached the skill only today — see the memory
`owner-rule-changes-go-into-the-skill`.

**What is left in v1:**
- **CB#123** — merged as PR CB#274. **CB#207, CB#208 and CB#226 moved to `status/todo` on 2026-10-05.** CB#208 and CB#226 are
  `status/blocked` on CB#123; CB#207 is at `status/needs-refinement`. Their failure placement comes from
  CB#123's design: a failed one-off action is a toast, a dialog's message is a block above the dialog.
- **[CB#267](../../archive/codeberg/267.md)** (`status/needs-refinement`) — tooltips cannot be dismissed with Escape or hovered (WCAG
  1.4.13). It conflicts with CB#107's `pointer-events: none`, which shipped; refining [CB#267](../../archive/codeberg/267.md) decides it.
- **[CB#220](../../archive/codeberg/220.md)** (`status/needs-refinement`) — waits on the owner's choice of CI host.
- **At intake, for the owner:** CB#259, CB#261, CB#272 (`bug`, a search test flaky in Firefox), CB#273 (Push
  never becomes Retry, though the 2026-08-20 design says it does).

**The latest release is `v2026.44.1`** (published 2026-10-26, the first stable release, built locally — see *2026-11-04 — read this first*).

**Codeberg retargets a stacked PR itself** when its base branch is deleted at merge (seen with CB#229's
four children). Check `mergeable` after each merge. A branch whose base merged mid-flight is brought
up to `main` with a signed merge commit, not a rebase, once it is on Codeberg — a rebase would need a
force-push.

**v2 gained [#25](https://github.com/dgerrese/ThatApp/issues/25)** (Today: filter the issue list; `status/needs-refinement`, a design session due).

**Labels are clean**, checked across all 84 tickets on 2026-09-30.

**The status line has a second line** for the ticket in hand (stages, current stage, ETA as
`1h 15m (15:10)`), fed by `.claude/issue-status.sh <issue> <done> <total> "<stage>" ["<title>"]` at
each stage change and `clear` when none is in hand. Local only, in `.git/info/exclude`.

**Decisions the owner took on 2026-09-30 — do not reopen:**
- **CB#107:** the Escape criterion is about a keyboard user (opens with Enter, closes with Escape). The
  mixed dialog cases are whatever each browser does, and no test asserts them.
- **CB#205:** the Settings error slot keeps 10px above the instance list (the section heading's margin).
- **CB#246, the tooltip:** the drawing's text and box (12px / 500, 5px 9px, 2px corners, no shadow), a
  **4px arrow** pointing at the control in every direction, a **ground of `oklch(0.34 0.01 60)`** in
  both themes (the drawing's 0.06 vanished on the rail, 0.26 on the dark card), and the end-anchored
  tooltip **flush** with its button. Buttons keep 12px padding. Recorded in the visual language spec.
- **Design sessions show every difference on screen,** never one carried in from a comment. A
  companion mock must not use the frame's own class names (`card`, `mockup`, `option` and the rest):
  on 2026-09-30 a `.card` mock was clipped by the frame's `overflow: hidden`, and the companion sends
  `X-Frame-Options: DENY`, so a screen cannot iframe another.

**Still open for the owner, from CB#123 (PR CB#274):** whether Settings failures should be blocks now that
Settings is a dialog (built as toasts, per the criteria); whether the drawing's lighter dark surface
should replace `--color-raised`; list keys in Chivo Mono; clamping a block above a very tall dialog; a
cap on the toast stack; a screen-reader check in Firefox of a toast announced inside a dialog.

**Decisions the owner took on 2026-09-25 — do not reopen:**
- **Tooltips on keys and cut text.** A linked Jira key carries "open in Jira" in place of the native
  `title`; an unlinked key carries neither. The row timer control carries "start timer"/"stop timer",
  and the rail's stop button "stop timer". The rail's running key and every ticket summary (Today's rows,
  the search panel) are focusable, and each opens only its own tooltip on its own focus. Other cut texts
  keep the earlier rule until CB#236 is decided.
- **The search panel's summary tooltip opens below the summary**, so it never covers the focused key.
- **Up/Down move between table rows** (CB#227): across Today's tables in document order, within Week's
  grid; data rows only; a missing cell lands on the nearest focusable in the target row.
- **Extra Tab stops are acceptable**; the arrow keys are the answer to the Tab walk, not fewer stops.

**A review build of an open PR runs from a worktree.** *(Checked 2026-10-09: `../ThatApp-review-229` still exists, on `issue-89-settings-dialog`, long merged — a leftover whose removal is the owner's call; the steps are below.)* `../ThatApp-review-229` has its own `.env`
(`THAT_PORT=8082`, `COMPOSE_PROJECT_NAME=thatapp-review`) and a copy of the real database, so `make`
there never collides with the main checkout and Push there would write real worklogs. The owner chose
the database copy. Stop it with `docker compose -p thatapp-review down` in that directory (no `-v`
needed: its database is a bind mount), then `git worktree remove ../ThatApp-review-229`.

**`.claude/e2e/tests` is neither type-checked nor linted** — it has no `tsconfig.json` or eslint config,
so `make tsc` and `make lint` never see it. Only a Playwright run proves a spec compiles. Found 2026-09-25.

**A hidden `that-tooltip` repeats its trigger's text**, so a bare `getByText(summary)` in an e2e spec
matches two elements. Scope such locators to the visible element (`span:text-is(…)`, a row, a role).
A change that adds hidden duplicate text breaks specs across the whole suite: run the full `make
test-e2e` before the whole-branch review, not only the specs a task touched. Found 2026-09-25.

**Codeberg failed on and off through the afternoon of 2026-09-25:** pushes were refused with
"pre-receive hook declined / Internal Server Connection Error", and the API and attachment uploads
returned 504. Retrying later worked every time. A 504 on `POST /issues` can still create the issue.

**Rules the owner set on 2026-09-23 — do not reopen:**
- **A finding of the session's own is filed at `status/intake` at once, never asked about.** Asking
  "do you want a ticket?" is the failure.
- **Every screenshot is a dark and light pair**, and **a prototype is captured inside the design
  companion's frame, never as a bare file** — now in the `ticket-workflow` skill (PR CB#194). Never add
  a doctype to the prototype: the companion then stops wrapping it and renders a drawing nobody
  approved.

**Playwright empties `.claude/e2e/test-results/` at the start of every run.** A screenshot left there
does not survive the next run of any test. Copy captures out to the session scratchpad straight after
the run that makes them. Found on 2026-09-24, when a second capture run deleted the first run's images.

**Closed and merged:** CB#1, CB#2, CB#3, CB#4, CB#5, CB#6, CB#7, CB#9, CB#12, CB#16, CB#29, CB#30, CB#44, CB#51, CB#73, CB#87 —
none carries a `status/*` label any more, by the rule set on 2026-08-20. CB#5 as PR CB#38 on 2026-08-20,
CB#6 and CB#44 on 2026-08-21, CB#7 as PR CB#65 on 2026-08-27, CB#12 as PR CB#68 on 2026-08-28, CB#73 as PR CB#75 and
CB#9 as PR CB#76.
**CB#11 merged as PR CB#90 on 2026-09-02**, closing it, and the handoff pull request **CB#93** merged
after it. The 2026-09-03 handoff merged as **PR CB#96** at 11:22 on 2026-09-04.

**CB#94 merged as PR CB#98 on 2026-09-06**, and **CB#99 as PR CB#100** after it. **CB#95 merged as PR CB#112 on
2026-09-07**, closing it, and the handoff pull requests **CB#103** and **CB#104** merged before it.
**CB#10 merged as PR CB#120 on 2026-09-08**, closing it; its `status/*` label came off at the close and
it keeps `priority/high`. The project-design pull requests **CB#115** and **CB#118** merged before it.
**CB#124 (the priority axis) and CB#125 (the 2026-09-08 handoff) merged on 2026-09-09**, both by the
owner in the web interface after `tea pulls merge` was blocked by this machine's permission layer.
**[CB#117](../../archive/codeberg/117.md) merged as PR CB#128 on 2026-09-09**, closing it, and the handoff pull request **CB#129** merged after it; [CB#117](../../archive/codeberg/117.md)'s `status/*` label had to be stripped by hand at the close, which is now the fourth time a merge has left one behind. CB#94 shipped the second edition's whole token layer, two faces, radius scale, hover
wash, elevation rule and drawn icon set; CB#99 fixed the `color-scheme` value the minifier was
reversing — see the 2026-09-06 day file for both, and for why no test caught the second one.

**CB#105 merged as PR CB#135 on 2026-09-10**, with the handoff pull request **CB#136** before it. **CB#138**
(bugs outrank non-bugs) and **CB#121 as PR CB#140** followed the same day; CB#121's `status/*` label had
to be stripped by hand at the close, the fifth time. The 2026-09-10 handoff merged as **PR CB#141**
on 2026-09-16.

**CB#84 merged as PR CB#146 on 2026-09-16**, after its fix wave, leaving `status/in-progress` behind for
the sixth time; that label was stripped on 2026-09-17. **CB#145** (no `enhancement` label while a
milestone's scope is undetermined) and **CB#147** (a locked 1Password vault never stops a commit, only
a push — now a `CLAUDE.md` rule) merged the same day.

**CB#122 merged as PR CB#148 on 2026-09-17**, with **PR CB#149** after it; its `status/*` label was stripped
by hand at the close, the seventh time. **The first release, `v2026.38.1`, is published** at
`codeberg.org/diongerrese/thatapp` (tag on `2a90db9`, Release run 108, 3m18s), and an anonymous
`docker pull` of it succeeded. All ten criteria on CB#122 are ticked, but **the arm64 image has never
been started**. The owner accepted the release script's architecture checks in place of a run, so do
not reopen that. Releases and packages had to be switched on in the repository's settings
first; see *Environment notes*.

**On 2026-09-18 the owner had the session work the board in priority order on its own**, which
produced twelve ticket pull requests and three `[Process]` ones. Nothing merged that day.

**On 2026-09-21 the owner merged everything, in two waves, and `main` is now at `47961c9`.**

First the seven non-ticket pull requests: **CB#170** (the 2026-09-18 handoff), **CB#165** (stacking),
**CB#166** (PR title prefixes), **CB#169** (`CLAUDE.md` on CI skips, stacked on CB#168), **CB#168** (CB#167, CI
skips docs-only PRs), **CB#172** (work starts on the owner's word) and **CB#171** (the `autopilot`
skill).

Then **all eleven ticket pull requests** — CB#152/#42, CB#153/#35, CB#154/#56, CB#155/#67, CB#156/#71,
CB#157/#79, CB#158/#57, CB#159/#102, CB#160/#116, CB#162/#19, CB#163/#40 — and later **CB#174 (CB#134)**, the
Playwright bump.

**Every single one of those closes left `status/in-progress` behind**, twenty occurrences in one day,
all stripped by hand. This is structural, not carelessness: the merge that closes the issue is the
owner's action and the label strip is the session's, and nothing connects the two. **It belongs in
the next retro.**

**`main` now carries Playwright 1.63.0** (CB#134), so the e2e gate no longer produces a 25% false-red
rate. That matters for **CB#66**, which is `status/blocked` behind exactly that crash — see *Blocked*.

**Seven pull requests merged on 2026-09-22** — CB#180 and CB#181 first, then [CB#175](../../archive/codeberg/175.md) (CB#139), CB#178 ([CB#83](../../archive/codeberg/83.md)),
CB#182, and in the evening **CB#187 (CB#186)** and **CB#179 (CB#8)**. So the screenshot rule,
`.claude/tools/pr-attach.sh`, the "read `THAT_PORT`" rule, the e2e split **and the timer** are all on
`main`, which is at **`09e033e`**.

**The E2E job has no headroom against Codeberg's ten-minute cap. Read this before diagnosing any
red e2e run.** `codeberg-medium` kills a job at ten minutes and records the kill as `cancelled`,
which the commit status then reports as **`failure` with no test output** — because nothing failed.
Measured on 2026-09-22 across every run the forge has ever recorded: **no run above 600 seconds has
ever passed**, the longest success is 9:24 (run 116), and `main` sat at 9:04–9:17 for weeks. Run 207
on CB#8's branch reached **10:26** and was killed. CB#8 adds 16 test blocks, about 6% more work, against
roughly 36 seconds of margin.

**That is CB#186, fixed by PR CB#187: one e2e job per browser.** `playwright.config.ts` already declares
`firefox` and `chromium` as two independent projects, so the split follows a seam that was already
there, and it halves **both** large costs — half the tests per job, and one browser download instead
of two. Sharding with `--shard` was rejected: it halves only the first. `verify.yml` was already
split across two jobs for this same cap, so this is that pattern applied to the rig.

**Measured after the split, and the cap is cleared:**

| Branch | `e2e (chromium)` | `e2e (firefox)` |
|---|---|---|
| CB#187 — `main` plus the split | 4:13 | 5:47 |
| CB#179 — the timer, stacked on it | 5:06 | **7:19** |
| `main` at `09e033e`, both merged | 4:14 | 5:28 |

**Firefox is the slower half**, and the worst job measured is 7:19, which leaves 2:41 of margin
against the cap — against 36 seconds before. **`main` with the timer runs 5:28**, so the spread
between runs is real and the margin is not tight. The split is uneven on purpose: it buys headroom, not balance. **If
headroom is ever short again the next lever is caching the browsers**, not a finer split.

**Knock-on when CB#187 merges: the commit status splits into two contexts**, `E2E / e2e (firefox)` and
`E2E / e2e (chromium)`. Anything matching the old single name needs updating.

**`workers: 4` in `playwright.config.ts` was deliberately left alone.** Its comment ties the number
to `codeberg-medium`'s four vCPUs, which the split does not change.

**Two pull requests were open on 2026-09-22, and one of them was a phantom. Both are resolved: [CB#177](../../archive/codeberg/177.md) merged at 17:19 that day.**

| PR | Ticket | Notes |
|---|---|---|
| [CB#177](../../archive/codeberg/177.md) | CB#39 one home for `alertFor` and `messageOf` | **adds `allowImportingTsExtensions` to `web/tsconfig.json`** — not a weakening; the PR body explains why. **No screenshots, deliberately** — it changes no behaviour |
| CB#179 | CB#8 the timer | merged, and **closed by the owner on 2026-09-22**. See below |

**PR CB#179 read `open` on Codeberg for several hours although its merge was on `main`.** Verified in
git, not inferred:
`09e033e` on `main` is the merge commit, `codeberg/main..codeberg/issue-8-timer` is empty, and
`git diff` between the two is empty. CB#8 is closed. The record and the repository disagree, and the
repository is right.

**The likely cause is the stack.** CB#179 was based on `issue-186-e2e-split`. Merging CB#187 deleted
that branch, Forgejo retargeted CB#179 to `main` automatically, and the record did not survive the
retarget plus the merge. **Worth watching the next time a stacked pull request is merged** — if it
happens again it is a rule, not an accident, and the stacking guidance should warn about it.

**The owner closed CB#179 at 17:07 on 2026-09-22**, so the record and the repository agree again. It
closed as `merged=False`, which is the residue of the same retarget. The branch `issue-8-timer` is
fully merged and droppable on the owner's word.

**CB#185 is built and open as PR CB#210 (2026-09-23)**; what follows is its record. **Worklog rounding is settled and is CB#185**, raised and refined on the owner's word on
2026-09-22. `status/todo`, v1, `enhancement`, 15 acceptance criteria. It **depends on CB#8** and
cannot start before it lands.

**The rule, and do not reopen it.** Stopping a timer opens a confirm dialog. In it the user picks a
rounding direction and may add a description that becomes the Jira worklog's comment. One sentence
covers every case:

> **Up is ceiling to the 15-minute grid. Down is floor to the 15-minute grid. A floor of zero
> discards the entry.**

So a 7-minute run rounded down is thrown away, and "down" is also how a mistimed run is cancelled.
That was the owner's choice on 2026-09-22, against clamping at 15 minutes and against hiding the
control.

**Three paths stop a timer, and only two of them ask.** The user's own stop asks. Starting a second
timer asks, because the user is at the screen. **The midnight close does not and never will** —
nobody is there — so that entry stays honest and off-grid. That is why `store.MinTimerSeconds`
survives: its 60-second floor is *Jira's* constraint, and the midnight path is the only one still
relying on it.

**The rounding happens at timer stop, not at push and not in the API.**
`TestPostEntryAcceptsSecondsThatAreNotAMultipleOf900` must keep passing untouched — off-grid
seconds stay legal, because the midnight close still writes them.

**CB#185 reverses a recorded decision**, which is why it is a ticket rather than a patch and
`enhancement` rather than `bug`. Decision 8 of
`docs/superpowers/specs/2026-08-21-manual-time-entry-design.md` scoped the 15-minute grid to the
manual duration control and named CB#8's timer as the thing that would produce off-grid runs;
decision 3 says the same from the other side. **CB#185 amends both.**

**CB#185 is unblocked: CB#8 merged on 2026-09-22.** It still needs a design session before planning —
the dialog is a new control that nothing draws — not the visual language, not the prototype, not CB#8's design document.

**What CB#185 does not need building:** `time_entries.comment` is in the schema from the first
migration, `store.UpdateEntry` already writes it, and `internal/jira/worklog.go` already sends a
comment as an Atlassian Document Format node and omits the field when blank. `that-confirm.ts`,
`that-entry-dialog.ts` and `that-duration.ts` are the parts the dialog is built from.

**A description on manual time entry is out of scope on CB#185** and has no ticket. The column and
the push already support one; only the form has no field.

*(2026-09-22; the queue has since moved — see the block at the top.)* **The v1 intake queue was empty: all eight were approved on 2026-09-22.** CB#107, CB#109, CB#106, [CB#74](../../archive/codeberg/74.md),
CB#127, CB#108, CB#119 and CB#97 moved to `status/needs-refinement` after the owner walked them one at a
time. Nothing else changed — `priority/low` survived on CB#97, CB#108 and CB#119, since only the `status/*`
scope is exclusive with itself. **v1 refinement now holds thirteen tickets**, and [CB#183](../../archive/codeberg/183.md) leads it as
the only `priority/high` one; below it the defects CB#184, CB#164 and CB#161 come before the rest of the
normal band. **Two of the thirteen need a design session before planning: CB#143 and CB#97.**

**Raised on 2026-09-22 at `status/needs-refinement`, both v1, both asked for by the owner:**
**[CB#183](../../archive/codeberg/183.md)** (`priority/high`) a running timer's figure and the Today sort disagree — the sort reads a
row's logged `seconds`, the figure shows logged plus elapsed; and **CB#184** (`bug`) the prototype's
Pinned table draws an ascending mark on Summary over rows that are not in that order. [CB#183](../../archive/codeberg/183.md) came out
of rebasing CB#8 over [CB#83](../../archive/codeberg/83.md); CB#184 is a defect in [CB#83](../../archive/codeberg/83.md) as merged.

**A running row's key is `--color-ink-muted`, and the visual language no longer contradicts itself.
Settled by the owner on 2026-09-22 — do not reopen.**

The owner read CB#179's screenshots and said the green key was wrong. The first answer, from the
record, was that the green key was specified — and it was, by a clause that contradicted the same
document's role table:

- The role table's prose: "**Running** is the live timer and its stop control, and nothing else."
  A key is neither.
- The row-key rule, four pages later, named "the running tone on a ticket whose timer is going" as
  an example of state a key may carry. **That is the clause CB#8 was built on**, and the 2026-09-18
  session screen drew the key green in all three options on the strength of it.

The owner compared both states in the running app, **chose the role table over the clause**, and
asked for the code to follow the language rather than the language to follow the code. So, on
`issue-8-timer` (commit `7f52e28`, in PR CB#179):

- The key never takes `text-running`. The **Today figure and the stop control still do** — a running
  row says so through the two elements the language actually names.
- The stale clause is **struck** from the row-key rule. The rule itself is untouched.
- Decision 3 of `docs/superpowers/specs/2026-09-18-timer-design.md` records the correction.

**The lesson is not the colour.** A whole-branch review, four task reviews and a design session all
passed a defect that one look at a screenshot caught, because every one of them was reading the
clause rather than the role table. Screenshots on pull requests are eight days old and have now paid
for themselves once.

**CB#127 is in progress without a pull request as of 2026-09-23** — see the block at the top. [CB#83](../../archive/codeberg/83.md) and CB#8, which sat here for days, both
shipped on 2026-09-21 — see the table above. Their design decisions are recorded on the tickets and
in `docs/superpowers/specs/2026-09-18-timer-design.md`, which CB#8 amended: the running stop control
takes primary on hover like every other row control, a state the original session had not covered.

**CB#66 is no longer blocked: it was re-measured and shipped as PR CB#213 on 2026-09-23 — 0 Chromium crashes in 6 full runs on 1.63.0.** The record below is how it got there.
The localhost forwarder made Chromium crash with CB#134 in 3 of 4 full runs, against 0 of 2 on `main`,
so the owner chose to do CB#134 first. **CB#134 shipped on 2026-09-21 and `main` now runs Playwright
1.63.0**, where that segfault does not occur in fifty measured runs.

**So CB#66 should be re-measured rather than assumed blocked.** Rebase it onto current `main` and run
the suite. The ticket is explicit that the two crashes being the same bug is *inference, not
measurement* — the signatures from CB#66's branch were never compared against CB#134's
`SEGV_MAPERR 0x1b0`. Compare fault addresses before concluding either way.
CB#66's branch is pushed with no PR, and it **rebases onto [CB#35](../../archive/codeberg/35.md)** whichever lands first — both touch
`playwright.config.ts`, `.claude/e2e/README.md`, `tooltip.spec.ts` and `e2e.yml`, and [CB#35](../../archive/codeberg/35.md) renames the
upstream alias `that-app` → `that-e2e`.

**CB#134 shipped on 2026-09-21.** It is a **Playwright version bug, measured**:
1.62.1 crashed 5 times in 20 full runs, 1.63.0 zero times in 30, with a ten-run control on 1.62.1
taken after the clean sample to exclude drift. All five crashes were byte-identical —
`SEGV_MAPERR 0x1b0` in the *browser* process inside `browser.newContext`, same stack frames, only the
victim test differing. **The fix is a one-line bump of `@playwright/test` to 1.63.0** plus its
lockfile; the suite passes unchanged (513/11/0), no API migration. Two dead ends not to revisit:
shared memory is already handled twice (`ipc: host` and `--disable-dev-shm-usage`), and "never seen
in CI" is not evidence — CI's `retries: 1` retries a crashed test and goes green. The local worker
count (10 vs CI's 4) was **never tested** and is the next hypothesis only if the bump fails.

**Design sessions held with the owner on 2026-09-18** (browser companion, screens under
`.superpowers/brainstorm/913714-1789732588/content/` on this machine), and their outcomes are
written into each ticket: **CB#8** as above; **[CB#83](../../archive/codeberg/83.md)** ascending arrow = the drawn descending arrow,
mirrored; **[CB#80](../../archive/codeberg/80.md)** a hairline note under the four fields, above the buttons.

*(2026-09-22.)* Of **[CB#80](../../archive/codeberg/80.md), CB#55, [CB#89](../../archive/codeberg/89.md), CB#91 and CB#185**, all but [CB#89](../../archive/codeberg/89.md) have since shipped or are open as PRs. **CB#185 is no longer waiting** —
CB#8 merged on 2026-09-22, so its dependency is satisfied and it can start on the owner's word. CB#134, CB#139, CB#39, [CB#83](../../archive/codeberg/83.md) and CB#8 all shipped on
2026-09-21.

**[CB#80](../../archive/codeberg/80.md) was blocked and is not any more.** Its note needed "a muted info mark" and none existed
anywhere in the project. Settled with the owner on the browser companion, 2026-09-21: the **circled
i, unchanged geometry, drawn at 18px** — `<circle cx="12" cy="12" r="8.5"/><path d="M12 8.6h.01M12
11.4v3.6"/>`, the same circle as `success` and `failed` with `warning`'s interior inverted, at 1.9
stroke and **no weight exception**. 18px rather than 16px because at 16px the dot-to-stem gap is
1.87px against a 1.27px stroke and the two fuse. The full reasoning, including what was rejected, is
on the ticket. The morning's decisions stand: CB#55 answers
malformed ids with 404 everywhere, and CB#91 adds happy-dom as a dev dependency.
**Raised on 2026-09-18 at `status/needs-refinement`:** CB#161 (a late save resets an edit form opened
after it) and CB#164 (a CSS-only edit never rebuilds the worker), both `bug`, v1. **CB#134** is also at
needs-refinement now. **Still waiting on a design session: CB#143 only.** CB#139 and [CB#89](../../archive/codeberg/89.md) turned out not to need one —
their sessions had already happened (2026-09-10 and 2026-09-03) and only non-visual questions
remained. Check a ticket's own design document before booking a session; two of the three were
already drawn.

**What comes next is in the block at the top of this section.**

**CB#139 inherits decision 1 of CB#84's design** and is otherwise untouched.

**[CB#117](../../archive/codeberg/117.md) merged as PR CB#128**, all 48 criteria met, 33 signed commits, both gates green.
Its plan was `docs/superpowers/plans/2026-09-09-prototype-drift.md`, twelve tasks under
subagent-driven development, plus a whole-branch review whose fix wave carried nine findings. Before it, CB#10 (edit after push, widened on 2026-09-07 to carry a
week's fetch) was the last one, and it merged as PR CB#120 on 2026-09-08. Its design was approved that morning, its
twelve-task plan executed, and the whole-branch review caught two Critical defects the task reviews
could not — see the day file. `issue-10-edit-after-push-and-week-fetch` has since been deleted.
CB#95 shipped the second edition across Today and Week over six tasks, four fix rounds and a
whole-branch review; the six tickets its reviews raised are CB#105 to [#10](https://github.com/dgerrese/ThatApp/issues/10).
**CB#61 was closed on 2026-09-03** on the owner's instruction, `wontfix`, folded into CB#95 rather than
rejected. **[CB#89](../../archive/codeberg/89.md) was widened** the same day from "move Settings out of the nav" into the full Settings
redesign, and holds its settled design.
Before it, CB#51 merged as **PR CB#86** and CB#87 as
**PR CB#88** on 2026-09-02, along with `retro-skill` as **PR CB#85**. CB#88 merged into CB#86's branch
rather than into `main`, because CB#86 could not go green on its own — see *Decisions taken*. The merge
style is rebase-merge, so every one of those commits has a new SHA on `main`.
Before them, CB#49 (`codeberg-api-limits`) merged on 2026-09-01, the eod skill followed it as PR CB#81,
and `handoff-2026-09-01` merged as **PR CB#82**. That leaves
**`worktrees-without-the-tax` was deleted on 2026-09-16**, locally and on Codeberg, on the owner's
instruction — see *Decisions taken*. **`issue-121-push-corrected-entries`, `project-design-bugs-first`,
`issue-84-global-search`, `handoff-2026-09-10`, `handoff-2026-09-16`,
`project-design-unsigned-commits` and `type-labels-wait-for-scope` no longer exist, locally or on
Codeberg** (checked 2026-09-23). `issue-122-release-image` and
`project-design-release-image-docs` were deleted on 2026-09-17 on the owner's word.

**The board's own hygiene was re-audited on 2026-09-17 and is clean**: all 47 open issues carry
exactly one `status/*` label, and none of the 50 closed ones carries any. **Merging a pull request
does not strip the status label** — PR CB#90 left `status/in-progress` on the closed CB#11, and PR CB#112
did the same to CB#95 on 2026-09-07, and PR CB#128 to [CB#117](../../archive/codeberg/117.md) on 2026-09-09. PR CB#140 did it to CB#121 on 2026-09-10. Check the label after every
merge; it has now happened five times. **`tea issues list` returns only 30 issues unless `--limit` is given**, and says nothing about
the rest, so an audit without one silently reads a third of the board — the `eod` skill's own snippet
has that bug. The type axis was corrected in the same pass;
the `enhancement` test that decided it is in the `ticket-workflow` skill.

**Every open issue now carries a milestone, as of 2026-09-08.** The owner asked for the whole
unmilestoned backlog to be sorted, and went through all 28 one at a time: **34 open in v1, 8 open in
v2**, none unassigned. v2 now holds only [#6](https://github.com/dgerrese/ThatApp/issues/6), [#7](https://github.com/dgerrese/ThatApp/issues/7), [#8](https://github.com/dgerrese/ThatApp/issues/8), [#9](https://github.com/dgerrese/ThatApp/issues/9), CB#101, [#10](https://github.com/dgerrese/ThatApp/issues/10), [#11](https://github.com/dgerrese/ThatApp/issues/11) and CB#123.
**Both milestone descriptions were rewritten the same day** to match, so they are current: v1 now
reads as everything that has to be right before the app is handed to someone, and v2 as work where
the product is not wrong today. **Unassigned is no longer a state on this board** — a new ticket gets
a milestone when it is created. The sort was not read off the design: the owner
overruled the proposed split on eight tickets, pulling CB#39, [CB#83](../../archive/codeberg/83.md), CB#84, [CB#89](../../archive/codeberg/89.md), CB#91 and CB#97 into v1 and
pushing [#7](https://github.com/dgerrese/ThatApp/issues/7) and CB#101 out to v2.

**The board has a priority axis as of 2026-09-08**: `priority/high` and `priority/low`, scoped and
exclusive like `status/*`. **Normal priority carries no label**, so an unlabelled ticket is normal
rather than untriaged and there is no `priority/normal` to add. Returning a ticket to normal is the
one move needing `--remove-labels`, because there is no third label to displace the current one.
**Priority is the owner's to set** — suggest, never relabel. The axis is documented in `CLAUDE.md`
and in the `ticket-workflow` skill.

**Five tickets were raised on the evening of 2026-09-09, all in v2 or awaiting triage.** Four are the
owner's own ideas and were created at `status/needs-refinement`, because the asking was the approval:
**[#13](https://github.com/dgerrese/ThatApp/issues/13)** a worklog timeline along the bottom of the screen, drawn like a video editor's; **[#14](https://github.com/dgerrese/ThatApp/issues/14)**
ticket details in a modal rather than a trip to Jira; **[#15](https://github.com/dgerrese/ThatApp/issues/15)** calendar integration, so a meeting can
become a worklog without opening the calendar beside the app; **[#16](https://github.com/dgerrese/ThatApp/issues/16)** weekly retro notes feeding the
sprint retro the team holds on the FFSRETRO board. [#16](https://github.com/dgerrese/ThatApp/issues/16)'s size hangs entirely on one open question —
whether the app writes cards to that board itself, exports at sprint end, or ignores it.
**CB#134 is at intake and is the session's own**: chromium dies with a segmentation fault part-way
through `pwa.spec.ts`, taking an unrelated test down with it, and the test it blames differs every
run. Three implementers hit it in one evening; one confirmed it pre-existing against an unmodified
baseline. It is worth a ticket because a crash that lands somewhere new each time teaches everyone to
re-run first and read second, which is how a real regression gets waved through.

**The board was triaged the same day.** `priority/high`: **CB#8, CB#10, [CB#35](../../archive/codeberg/35.md), CB#42, CB#105, [CB#117](../../archive/codeberg/117.md), CB#121**,
and **[CB#83](../../archive/codeberg/83.md)** from 2026-09-18, raised by the owner out of low. `priority/low`: **CB#39, CB#40, CB#55, [CB#89](../../archive/codeberg/89.md),
CB#91, CB#97, CB#108, CB#119**. The other twenty-six are normal.
**[CB#79](../../archive/codeberg/79.md), [CB#80](../../archive/codeberg/80.md) and CB#102 are normal but were named as work to pick up** — the owner promoted them without
raising their priority, so an unlabelled ticket here really does not mean untouched.

**The prototype audit ran on 2026-09-08 and found 57 differences**, checked against all 41 open
issue bodies. **[CB#117](../../archive/codeberg/117.md) carries 48 of them** — the owner chose that it fix the eighteen that sat beside
an issue which would not actually have fixed them — and **Settings' seven are [CB#89](../../archive/codeberg/89.md)'s**, with two
sub-parts appended to [CB#89](../../archive/codeberg/89.md) that its body never named. **[CB#117](../../archive/codeberg/117.md) therefore lands before CB#91 and [CB#83](../../archive/codeberg/83.md)**, both
of which gained a sequencing paragraph. Four findings are the *drawing* being stale rather than the
app, and the prototype itself is corrected: the wordmark's treatment, the hero figure's tracking,
CB#10's fetch control and the day-total push markers. Two disputed points were settled — the rail
becomes fixed beside a scrolling viewport, and the divider below Push is restored, overriding the
first edition's "no divider" line — and two declined: Push does not become Retry, and the entry
dialog's stepper keeps opening at `0:00`. **A lint that fails when a declared design token has no
consumer** was approved as part of [CB#117](../../archive/codeberg/117.md); `--color-primary-rail-ink` and `--color-pending-rail` are
both declared and unused today, which is why the live Push button is not magenta and the unpushed
count is not amber.

**CB#10's fetch control is not the prototype's refresh** — different job, form, glyph and place. Week
still has no refresh, and where it goes now the header also carries a fetch is the one thing in [CB#117](../../archive/codeberg/117.md)
the drawing cannot answer.

**CB#105 allows a backdated add**, settled 2026-09-08: `POST /api/entries` gains an optional `day` and
the server stamps `started_at` at local midnight of that day. The browser still sends no start time
and Week's days come from the server's own rollup, so `day` and `started_at` still cannot contradict
each other. Both specs that state the old rule are corrected in that ticket, and it runs a design
session first, because the dialog has to say which day it is for and that is not drawn.

*(2026-09-22; superseded by the block at the top.)* **CB#8 merged on 2026-09-22, so v1's product work is now the refinement queue, not one ticket.**
Thirteen tickets sit at `status/needs-refinement`; CB#185 is the only one at `status/todo`. The
sentence below was written when CB#8 was the last of the design's thirteen still to build, and [#6](https://github.com/dgerrese/ThatApp/issues/6)
(the phone) remains in v2. CB#10 merged on 2026-09-08 as PR CB#120; its design is
`docs/superpowers/specs/2026-09-07-edit-after-push-and-week-fetch-design.md` and its plan
`docs/superpowers/plans/2026-09-08-edit-after-push-and-week-fetch.md`. **CB#8 got its design and
shipped**; the line that said it had none is retired.

### Two things needing the owner

~~**The superpowers skills are not installed on this machine.**~~ **Wrong as of 2026-09-01**, and
the item is retired. The plugin is installed at
`~/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0/` and its skills load normally;
`~/.claude/skills` being empty is not where a plugin lives, which is what the original check got
wrong. The half of the item about CB#7's whole-branch review is moot — CB#7 merged on 2026-08-27.

- **[#7](https://github.com/dgerrese/ThatApp/issues/7) (`-race`) cannot be done as written.** `go test -race` fails in the app image outright:
  `CGO_ENABLED=0` and no C compiler, so it reports `-race requires cgo`. The image has to change
  first. Separately, **`-race` would not have caught CB#7's lost update**, which is across SQL
  statements rather than shared memory — so [#7](https://github.com/dgerrese/ThatApp/issues/7) should not be treated as covering that class at all.
  Worth a comment on the issue; not yet posted.

- **The Jira API token cannot write worklogs, so no push can succeed.** Found 2026-09-01 by running
  a real push. Reads are fine — the connection test returns the right account and assigned issues
  list — but `POST /rest/api/3/issue/{key}/worklog` comes back `401
  {"code":401,"message":"Unauthorized; scope does not match"}`. The token carries read scope and not
  whatever a worklog write needs. **Only the owner can fix it**: remint the token in Atlassian with
  write scope and re-enter it in Settings. Until then, treat any push failure on this instance as
  this, not as a new bug — and note that CB#8, CB#10 and CB#11 cannot be verified against a real push
  either. The exact scope or token type required was never established, only that a read-capable
  token was refused; [CB#80](../../archive/codeberg/80.md) turns on settling that.
  **This is now a live gate on CB#10, not only on verification.** Its fetch half reads worklogs through
  a JQL search and the per-issue worklog endpoint, and whether the token may do that at all has never
  been established — reads are known to work for issues, not for worklogs. CB#10's design makes proving
  both calls against the real instance the plan's first task, and a refusal there sends the ticket to
  `status/blocked` rather than into a build against a stub that will not match production.

### What gated what — every gate below is discharged

**Nothing here still blocks anything**, as of 2026-09-01: CB#4, CB#5, CB#6, CB#7, CB#29 and CB#44 are all
merged. It is kept because the *reasons* explain why parts of the codebase look the way they do.
The one live item this section used to carry — do not implement CB#19 from its current state — moved
to *Still open*.

- **CB#5–CB#12 are unblocked.** CB#4 put the split URL columns, `internal/atlassian`, `jira.Client.Myself`,
  the JSON error envelope, `api.ts`, the router and the first `that-*` components on `main`, which is
  what every one of them builds on. Branch from `origin/main`.
- **CB#5 needs the site URL for issue links**, which is why the two-URL split had to land first.
- **CB#5 hands CB#6 a layout question and CB#7 a deadline.** Both come from CB#5's design and are recorded
  here so they are found rather than rediscovered. **CB#6:** pinned issues span instances, and the
  card-per-instance layout has no place for them; CB#5 deliberately does not pre-empt the answer beyond
  keeping `that-ticket-row` free of anything instance-specific. **CB#7:** Today re-renders wholesale, and
  that was right for CB#5 because it holds no typed input and no per-row in-flight state — but the
  moment a row carries a duration field the user types into, a wholesale re-render discards input
  mid-typing, which is the exact bug CB#29 paid to fix in Settings. CB#7 must revisit it before shipping
  a typed field, not after.
- **CB#44 gated CB#6 and CB#7 and no longer does.** PR CB#52 merged on 2026-08-21, so the design tokens,
  the `that-*` components, the rail shell and the self-hosted typeface are all on `main`. Branch from
  `origin/main`.
- **CB#29 owned the parked re-render finding below**, and PR CB#34 closes three of the *Carried out of
  CB#4* findings as a consequence: the detached-DOM connection test, the Add form losing typed input on
  a Remove, and a failed initial load rendering no controls.
- **CB#29 gated CB#6 and no longer does.** Until time entry ships the cascade destroys nothing; after
  it, the confirmation is all that stands between a stray click and lost logged time. PR CB#34 landed,
  so CB#6 is clear on this front.

### Carried out of CB#4 — findings deliberately not fixed there

The whole-branch review triaged these as acceptable to ship. **The SDD ledger that held them is
deleted, so this is the only record.** None is a regression; each was inherited from the plan's own
code rather than introduced by an implementer.

- ~~**The Settings view re-renders by `container.replaceChildren()` on every mutation.**~~ **Fixed in
  CB#29 (PR CB#34).** `render()` now builds three persistent regions threaded through a `Regions` object,
  and `refresh()` reconciles the list by `instance.id`. Both consequences are closed and covered:
  typed Add-form input survives a Remove, and an in-flight connection test no longer writes into
  detached DOM. Edit mode gained the Cancel affordance in the same change, which is why patching the
  two symptoms individually was refused.
- ~~**A failed initial load renders no controls at all**~~ **Fixed in CB#29 (PR CB#34)**, and now carries
  the regression test it lacked — it was the only one of the design's three named outcomes without
  one.
- **`internal/server/instances.go` is 360 lines** as of 2026-09-01, grown across Tasks 6–8 and since.
  Three reviewers judged a split unwarranted: it is one cohesive resource, and splitting would
  scatter `decodeInstanceRequest` and `verifyJiraCredentials` away from their only two callers. **The
  trigger this finding named did not fire** — CB#5's issue routes landed in `issues.go` (109 lines),
  not here — so the file grew for other reasons and the judgement still stands. Re-measure before
  citing this number.
- **`NormalizeSiteURL` (`internal/atlassian/tenant.go:38`) does not case-fold the host**, so
  `https://Example.atlassian.net` and `https://example.atlassian.net` persist as different strings for
  the same site. Harmless until something keys on the stored value.
- **`web/src/router.ts` swallows a rejected dynamic `import()`.** A stale chunk hash after a redeploy,
  or being offline, leaves the previous view on screen with no indication. **This gets worse at CB#12**,
  when a service worker starts serving stale chunks.
- **No request body size limit** on `json.NewDecoder(r.Body).Decode(...)`. Bounded risk on a
  localhost-bound single-user server, but these are the repo's first mutating endpoints, so they set
  the precedent.
- **The API has no authentication and no CSRF defence**, so a cross-origin
  `<form enctype="text/plain">` can reach `POST /api/instances`. The design of record excludes app
  auth from v1 and binds to localhost, deferring it to [#6](https://github.com/dgerrese/ThatApp/issues/6) — **not a CB#4 defect**. Rejecting mutating
  requests whose `Content-Type` is not `application/json` would close the form vector for free and is
  worth a line in [#6](https://github.com/dgerrese/ThatApp/issues/6)'s scope.

Repo hygiene, no ticket needed under `CLAUDE.md`: **`web/build.mjs` never cleans `dist/` and there is
no `.dockerignore`.** See *Facts worth not rediscovering*.

### How things got here — narrative, frozen 2026-08-21

**Everything below this line is a record, not a status.** It accumulated between 2026-08-14 and
2026-08-21 and was deliberately not rewritten as tickets moved on, so it still calls CB#5 "in review",
CB#44 and CB#6 `status/todo`, and CB#7 undesigned. The ledger at the top of this section is what is true.
Read this for *why* a thing is the way it is; never for *where* it stands. The rules it produced
that outlive it have been promoted into *Decisions taken* and *Facts worth not rediscovering*.

**Merged:** CB#1 scaffolding (containerised Go + vanilla-TS skeleton, config validation, HTTP server,
build-tagged asset FS, esbuild + Tailwind v4, golangci-lint v2 + ESLint 9, CI) · CB#2 `internal/store`
(design at `docs/superpowers/specs/2026-08-07-store-design.md`) · CB#16 the Playwright rig
(`.claude/e2e/`, `make test-e2e`, `.github/workflows/e2e.yml`) · CB#3 the Jira client, as PR CB#20 on
2026-08-12 — `internal/jira`: `crypto.Sealer` AES-GCM token sealing, client transport with basic
auth and mapped sentinel errors, `SearchAssigned` over `search/jql` with token paging, and worklog
create/update/delete with ADF comments. Its plan is
`docs/superpowers/plans/2026-08-10-jira-client.md`; the checkboxes were never ticked and there is no
SDD ledger for it. · CB#4 the Settings view, as PR CB#28 on 2026-08-14 — merge commit `b0aa3c5`, 26 commits, 35 files,
+6526/−87. All thirteen tasks ran under subagent-driven-development with a fresh implementer and a
task review each, then a whole-branch review on the most capable tier, one fix wave and a scoped
re-review. Its design is `docs/superpowers/specs/2026-08-12-settings-view-design.md` and its plan
`docs/superpowers/plans/2026-08-12-settings-view.md`. **Its SDD ledger was deleted** with the plan's
workspace, as that skill requires — everything from it worth keeping is in this document, chiefly
*Carried out of CB#4* and *Facts worth not rediscovering* below.

**Two tickets raised and approved on 2026-08-14; both were built on 2026-08-17:**

- **CB#30 Theme toggle: light, dark and auto — merged**, as PR CB#32 on 2026-08-17. Refined, planned and
  executed through subagent-driven-development in one session: four tasks, a task review each, a
  whole-branch review on the most capable tier, one fix wave and a scoped re-review. Design
  `docs/superpowers/specs/2026-08-14-theme-toggle-design.md`, plan
  `docs/superpowers/plans/2026-08-17-theme-toggle.md`. `make verify` green and 30/30 e2e on Firefox
  and Chromium. Shell 797 -> 1314 bytes. **Its SDD workspace was deleted on completion**, as that
  skill requires.
- **CB#29 Confirm before removing a Jira instance — merged**, as PR CB#34 on 2026-08-17; the owner
  confirmed the merge on 2026-08-20, which closed it.
  Brainstormed, planned and executed the same day: three tasks, a task review each, a whole-branch
  review on the most capable tier, one fix wave and a scoped re-review, then a by-eye check of the
  dialog in both browsers and both themes. Design
  `docs/superpowers/specs/2026-08-17-confirm-instance-removal-design.md`, plan
  `docs/superpowers/plans/2026-08-17-confirm-instance-removal.md`. `make verify` green and 52/52
  e2e, both re-run after the rebase onto `main`. **Its SDD workspace was deleted on completion** —
  what is worth keeping from it is *Carried out of CB#4* below and the new entries in *Facts worth not
  rediscovering*.

**CB#5 Assigned issues — built and in review**, as PR CB#38 on 2026-08-20. Brainstormed and approved on
2026-08-17; spec `docs/superpowers/specs/2026-08-17-assigned-issues-design.md`, plan
`docs/superpowers/plans/2026-08-17-assigned-issues.md`. Three tasks through
subagent-driven-development on 2026-08-20, a task review each, a whole-branch review on the most
capable tier, one fix wave and a scoped re-review. `make verify` green and 70/70 e2e across Firefox
and Chromium. **Its SDD workspace was deleted on completion**, as that skill requires — what is
worth keeping from it is below.

**The whole-branch review caught what three task reviews could not**, which is the case for keeping
it non-optional. `TestGetIssuesKeepsWorkingInstancesWhenOneFails` gave both fake instances a zero
delay, so a goroutine returning `err` instead of `nil` cancelled its sibling only *after* that
sibling had stored its result: the test stayed green while the branch's central property — one
failing instance must never blank the others — went unguarded, and its own failure message, "a
sibling's failure blanked it", was aspirational. Delaying the healthy instance instead makes the
cancellation observable. Proven by mutation rather than argued. **Any later ticket touching the
fan-out should re-run that mutation check**, because the test's value is entirely in that timing.

**The order was CB#30 → CB#29 → CB#5**, decided by the owner on 2026-08-17. All three are behind us;
**CB#6–CB#12 are the whole remaining product.**

- **CB#30 before CB#5** because only the Settings view existed, so the retrofit was thirty-three utility
  usages across six files; each of CB#5–CB#12 adds a view that would otherwise have been written against
  hardcoded light colours and needed retrofitting afterwards.
- **CB#30 before CB#29** so `that-confirm` was written against the semantic tokens once instead of in stock
  utilities and then again in CB#30's retrofit. It kept CB#30's retrofit table at six files, and CB#29
  still landed well before CB#6, which is its only hard deadline.

**CB#29's scope was widened deliberately**, also on 2026-08-17: it absorbed CB#4's parked
`replaceChildren` re-render finding, replacing the wholesale re-render with keyed row reconciliation
and giving edit mode the Cancel it lacked. Both changes touch the same lines of
`web/src/views/settings.ts`, and the alternative was opening that file twice. The dialog's warning is
**static** — no counts of what removal destroys, so no counts endpoint and no server change in the
ticket; counts are a later intake, worth raising once CB#6 makes them non-zero.

**CB#30's design gained a row on 2026-08-17.** `web/src/router.ts` carries `text-neutral-600` and
`text-blue-700` in its placeholder view and the retrofit table omitted the file, so the spec's final
criterion — no stock colour utility left in `web/src/` — could not have been met as written. Fixed as
`9166c78` on `issue-30-theme-toggle`, along with the count (thirty-three across six files, not
twenty-eight).

The whole-branch review of CB#3 produced three new tickets rather than in-branch fixes: CB#19, CB#21 and
CB#22. **CB#21 and CB#22 were folded into CB#4 on 2026-08-12** and closed as not planned; CB#19 stands
alone.


**CB#6 was moved to `status/todo` on 2026-08-20** at the owner's word. It had been carrying
`status/in-progress` with no `issue-6-*` branch behind it, which the branch-existence rule makes
wrong. **Its design document is still missing**: `docs/superpowers/specs/2026-08-20-pinned-issues-design.md`,
cited by the issue body and the owner's comment, has never existed on any branch. The acceptance
criteria stand on their own; the document behind them would have to be written from the two design
sources below.

**CB#6's design sources are now in the repo** at `docs/superpowers/canvas/2026-08-20-pin-flow/`,
recovered with `extract_canvas.py`. Two records, settling different things: `approved-prototype.dc.html`
is the clickable prototype behind the acceptance criteria and settles the *interaction*;
`pinning-in-hybrid.html` is the same flow rebuilt in the Hybrid language, **approved by the owner on
2026-08-20**, and settles the *look*. The restyle preserves every interaction the prototype had.

**Three decisions belong to the restyle and are not to be reopened**, all argued in that directory's
README: a pinned row names its instance by coloured dot alone (the name goes to assistive tech, so
identity never rests on hue); search results keep the name beside the dot, because results are
scanned across instances you have not seen and a hue cannot disambiguate there; and an already-pinned
result is `aria-disabled` rather than `disabled`, because a disabled button is skipped by screen
readers and "already pinned" is worth announcing.

**CB#44 A visual design language for the app — refined on 2026-08-20**, `status/todo`. Its body now
carries full acceptance criteria. Two things the canvas left open were settled with the owner during
refinement, and neither is to be reopened:

1. **The rail ships in CB#44, in its resting state.** Its regions are built and styled there; CB#7–CB#9
   make them live. The Today card layout is deliberately *not* reworked in CB#44 — CB#6 opens
   `today.ts` next and the two would collide.
2. **Per-instance hues stay and gain a rule.** The Hybrid board ended on "OPEN: whether the
   per-instance hues earn their place", and the canvas only ever drew two instances. They stay,
   because CB#6 identifies a pinned row's instance by coloured dot alone, and they now have a ramp at
   constant lightness and chroma that cycles rather than running out.

**Two findings from the pin restyle change CB#44's work.** Both were hit by building against the
language rather than reasoning about it:

- **`var()` inside an inherited custom property fails silently.**
  `--instance: light-dark(oklch(0.60 0.13 var(--h)), …)` declared on `:root` resolves its `var(--h)`
  where the property is *declared*, not where it is used — so it computes to guaranteed-invalid at
  `:root`, where `--h` does not exist, and every dot renders transparent with no error in the
  console. The hue must go in the `background` declaration on the element itself. CB#44 builds
  per-instance hues and will meet this.
- **Space Grotesk is one variable woff2 covering weights 400–700, 22kB** — Google serves the same
  file for 400, 500 and 700. CB#44's criteria say "weights 400, 500 and 700", which is satisfied by a
  single file rather than the three static ones the wording implies.

Two further refinement decisions, neither changing the design: **Space Grotesk is self-hosted**
(the boards load it from Google Fonts, which CB#12's offline PWA and the Docker deployment both rule
out), and **`light-dark()` stays** — the canvas expresses light and dark as two `data-mode` blocks,
while this app resolves them against `color-scheme`, which is what makes the auto state work without
JavaScript, so canvas values are translated into pairs rather than copied as blocks.

**CB#44 was built on 2026-08-20** on `issue-44-visual-design-language`, in seven tasks: the spec, the
self-hosted typeface, the token layer, the format module, the components, the rail shell and the
gates. `make verify` green and 74/74 e2e on Firefox and Chromium. Plan
`docs/superpowers/plans/2026-08-20-visual-design-language.md`, spec
`docs/superpowers/specs/2026-08-20-visual-design-language.md`.

**Three things measuring found that reading the canvas would not**, all now in the spec:

1. **`--color-ink-faint` is not a text colour.** 3.60:1 on `raised`, and the approved boards use it
   in exactly one place — a 14px icon. It clears the non-text floor and fails the text floor, and
   nothing in the name warns you. Card headings use `ink-muted`.
2. **Contrast has three tiers, not two.** Text 4.5:1, meaningful non-text 3:1, decorative separators
   exempt. Reporting a hairline as failing 3:1 is as wrong as shipping body text at 3.6:1.
3. **A `var()` inside an inherited custom property fails silently** — it resolves at `:root`, where
   `--h` does not exist, so the token computes to guaranteed-invalid and every dot renders
   transparent with nothing in the console. The instance dot is therefore a CSS rule, not a colour
   utility.

**Both engines serialise computed `oklch()` as `oklch()`**, trailing zeros normalised, so
`theme.spec.ts`'s assertions changed shape and not merely value. Verified in Firefox and Chromium
rather than assumed; the two ground colours are constants now so an engine that converts to `rgb()`
is a two-line change.

**CB#51 was raised on 2026-08-20 at the owner's request** — a frontend unit test runner, at
`status/needs-refinement`. There is none in the repo: `web/package.json` carries no test dependency
and the only frontend tests are the Playwright specs. CB#44 lands a **deliberately rudimentary**
`format.test.ts` under `node:test`, scoped out of tsc and eslint rather than adding `@types/node` or
setting `allowImportingTsExtensions`, and **not** wired into `make verify` — choosing that gate is
CB#51's decision. CB#51 should absorb the file.

**One follow-up is open:** `docs/superpowers/canvas/2026-08-20-pin-flow/pinning-in-hybrid.html` uses
`ink-faint` for card headings and hint text, which CB#44 establishes is wrong. It is a docs file, so it
was left for its own change — but CB#6 implements from it.

**CB#44 needed four rounds of fixes after it was built, and every one came from using the app rather
than from a gate.** All are on the branch; none was caught by `verify` or by 74 passing e2e tests.

1. **The nav did not follow the design, and neither did the rail.** Two destinations where the
   boards draw three, no icons, no active state at all, a divider the design does not draw, and it
   was pinned to the bottom where the design puts it directly under Push. The active state was
   missing because **nothing ever set `aria-current`** — the router resolved a path and never marked
   the link. The rail's gap and padding were off, disabled Push was filled where the boards outline
   it, and the resting lines the first-run board spells out in words — "Nothing to split yet", "No
   timer running", "Nothing to push" — had been dropped entirely.
2. **A long summary pushed the status out of the card.** A flex item's floor is its min-content
   width, so the row's inner boxes refused to shrink and the summary's `truncate` never engaged.
   **Every class-based check passed the whole time**: the utility was present and correct and simply
   had no effect. Its regression test therefore asserts geometry, not classes.
3. **Every button showed the default arrow cursor.** Tailwind v4's Preflight deliberately leaves
   `<button>` on it, so the app has to say `cursor-pointer` itself. One fix in `that-button`'s base
   covers every button; the rail's Push is the only raw one.
4. **The key column was a magic number the owner's own data already exceeded.** The design draws
   76px around seven-character examples; `RIDGE-5325` measures 78px, so that instance's whole card
   sat 2px out of line and a card mixing short and long project keys would have gone ragged. 76px is
   now the floor and each list measures its own keys, per list rather than per app — padding a
   short-keyed instance to suit a long-keyed one spends width the summary needs.

**A row key never wears the primary**, settled by the owner on 2026-08-20. It is `ink-muted` whether
it links or not. A permanent magenta sat on exactly the element CB#8 and CB#9 must tint running-green and
failed-red, so state would have competed with decoration. The link declares itself by darkening to
full ink on hover instead, which also stops linked and unlinked keys differing by hue alone.

**A stale bundle can survive a rebuild, and did.** `/app.js` is unhashed and cacheable while
`build.mjs` never cleans `dist/`, so a cached `app.js` keeps resolving to old content-hashed chunks
that were never removed — a fix measured as "not working" was working, and the browser was running
code from before it. **Hard-reload before believing a frontend measurement.** Adjacent to intake CB#40.

**[#9](https://github.com/dgerrese/ThatApp/issues/9) was raised on 2026-08-20**, `status/intake`: the phone layout is designed on
`Mobile.dc.html` / `MobileSheet.dc.html` and specified in CB#44's spec, and **no ticket builds it**.
**[#6](https://github.com/dgerrese/ThatApp/issues/6) is not that ticket** — it is TLS, app-level authentication and getting a CA onto the phone, and
its own body says it delivers no new app features. [#6](https://github.com/dgerrese/ThatApp/issues/6) makes the dashboard reachable from a phone; it
does not make it usable on one. Until [#9](https://github.com/dgerrese/ThatApp/issues/9) is decided, a phone-layout defect has no ticket to be filed
against, and what ships today below `md` is the desktop layout stacked, not the designed layout.

**The pin restyle now contradicts the spec in two places** and CB#6 implements from it:
`docs/superpowers/canvas/2026-08-20-pin-flow/pinning-in-hybrid.html` uses `ink-faint` for headings and
hint text, which fails the 4.5:1 text floor, and magenta issue keys, which are now reserved for state.
It is a docs file, so it was left for its own change rather than folded into CB#44.

**CB#44 must land before CB#6 and CB#7.** That is the CB#30-before-CB#5 argument again: each of CB#6–CB#12 adds a
view that would otherwise be written against the old vocabulary and need retrofitting.

**CB#44 merged on 2026-08-21**, as PR CB#52 — the owner's word, with all three checks green (verify, e2e
74/74 across Firefox and Chromium, and the review workflow). The issue closed `COMPLETED` still
carrying `status/in-progress`, which the new rule forbids, so **the label was removed by hand**: a
merge closes the issue but does not strip its status label, and nothing does it automatically. The
2026-08-20 handoff went out in the same batch as PR CB#54.

**CB#6 is the whole board now.** It is `status/todo` with a design, a plan and no implementation, and
the gate that stood in front of it is gone: CB#44 landed the vocabulary its Pinned card is drawn in,
and CB#5 landed the Today view it hangs off.

**CB#6 merged on 2026-08-21**, as PR CB#60 (merge commit `47ed5c3`) — the owner's word. Built the same day on `issue-6-pinned-issues`, all eleven tasks through
subagent-driven-development: the `status_cache` migration and pins store, `jira.Client.Issue`,
`SearchText`/`escapeJQL`, the `fanOutInstances` extraction, `/api/pins` list-delete-create-refresh,
`/api/issues/search`, the frontend types and Pinned card, `that-combobox` and the pin flow, then unpin
and one Refresh for both lists. Each task had its own review; seven needed a fix round. `make verify`
green and **140 Playwright tests, 70 per browser** across Firefox and Chromium, up from 74. Spec
`docs/superpowers/specs/2026-08-20-pinned-issues-design.md`, plan
`docs/superpowers/plans/2026-08-20-pinned-issues.md`. Its SDD workspace was deleted on completion —
what is worth keeping from it is below.

**The whole-branch review earned its keep again, and this is now three tickets in a row.** It found
two Important defects that eleven task reviews had passed over, both of them cross-task by nature:

1. **`?refresh=1` told a user whose Jira issue was deleted to go check their account email.** There
   are three `client.Issue` call sites on the branch. Two defend against `jira.ErrNotFound`
   deliberately — the POST path branches to `issue_not_found` with a comment saying why, and the
   search discards it as an ordinary answer — and the third handed it to `instanceErrorFor`, which
   maps it to `account_not_found` and "check the site URL and account email". The spec calls that
   mapping "wrong to the point of misleading" *for this exact error*; the reasoning simply was not
   carried to the third site. It survived because the refresh test asserted only that the error was
   non-nil and never read `.Code`, while the POST test one file over asserts the code and the
   negative. **The asymmetry between two tests of the same shape is the tell.**
2. **A search containing `*` was never guarded.** `secur*` reached Jira as `summary ~ "secur**"`, a
   400 that surfaces as "an unexpected error occurred" from ordinary typing. The spec names the case
   in its *Testing* section, and it had been filed during execution as a missing **test** — when the
   behaviour was missing too. A gap filed under the wrong heading is a gap nobody goes looking for.

**Six defects were found in plan-supplied material during CB#6**, every one an assertion aimed at the
wrong observable: a path assertion `net/http` had already decoded; a mutation returning `ctx.Err()`,
which is always nil at that point, so it proved nothing; a "never unpins" test reading a snapshot
taken before the code under test ran; two key-lookup tests that passed against an implementation that
never made the lookup; a test whose title promised ordering it never asserted; and `text-danger-ink`,
a Tailwind token that has never existed in this repo. **Plans are drafted, not verified.** The
working rule that came out of it: write the plan's test, then ask whether it would fail if the code
it guards were wrong — and treat "no" as a defect to fix rather than scope to defend.

**A custom event named `select` collides with the native one, in light DOM.** `that-combobox`
dispatched `select`; the native `<input>` text-selection `select` event bubbles through light DOM to
the same listener, Firefox's `fill()` fires it, and the handler crashed on `undefined.instanceId`.
Shadow DOM would have contained it and shadow DOM is forbidden here so Tailwind can reach component
internals — so **every `that-*` custom event is now prefixed**: `that-search`, `that-select`, `that-cancel`.
That is a rule for the whole family, not a fix for one component.

**`.claude/e2e/` has no `.prettierrc.json`.** `web/.prettierrc.json` sets `printWidth: 100`, but
prettier run from the e2e directory finds no config and reflows at its default 80, which silently
rewrote 68 lines of a spec file during CB#6 and had to be reverted. It will recur every time an agent
formats from there. A config file in `.claude/e2e/` closes it permanently; it is a project-design
change and needs no ticket.

**CB#6's refresh fan-out is per-instance and serial within an instance**, under one shared 15s budget.
The spec says "one goroutine per pin" *and* "clients are resolved per instance"; the implementation
satisfied the second by abandoning the first, which is a defensible reading and is what keeps
`forInstance`'s first-use `api_base_url` repair from running twice concurrently on one row. It means
N pins on one site share one budget serially. Fine at single-user pin counts — recorded so it is a
decision rather than a drift.

**Two design divergences were found by the owner looking at the built UI on 2026-08-21, and neither
gate could have caught either.** This is CB#44's lesson again — four of its fix rounds came from using
the app rather than from `verify` or the e2e suite — and it now has a specific shape worth naming.

1. **The pinned row printed the instance name where the approved restyle says coloured dot alone.**
   Fixed on the branch as `6115291`/`7aca5c8`: the spec was corrected first, `instancePosition` was
   added to the pin and search DTOs, and `paintInstanceDot` — built by CB#44 *for this*, and dead code
   on `main` until now — finally has a caller. Search results keep the name beside the dot, which is
   the restyle's deliberate exception for rows you have not seen before.
2. **An instance's name sits inside its card where the Hybrid board draws it above**, beside its dot
   with the day total opposite. Raised as **CB#61**, `status/needs-refinement`, because it is not CB#6's
   defect: CB#5 built the card, CB#44 deliberately deferred the Today layout rework ("CB#6 opens
   `today.ts` next and the two would collide"), and CB#6's scope never included the assigned card. It
   fell between the three.

**The rule that would have caught both:** every review on this branch compared *code against spec*,
and the spec was where both errors already were — CB#6's design document described the row from the
older prototype, diagram included. **A spec written from approved design sources has to be diffed
against those sources before it becomes the binding authority.** Doing that once, at the start,
costs minutes; both of these cost a rebuilt component after the ticket was declared finished.

**CB#7 is designed and awaiting the owner's review of its spec.** Branch `issue-7-manual-time-entry`,
cut from `origin/main` after CB#60 merged and pushed; `status/in-progress`; one commit, `be4a3f6`,
holding `docs/superpowers/specs/2026-08-21-manual-time-entry-design.md`. **No implementation has
started, and the plan is not written** — the next action is the owner's read of the spec, then
`superpowers:writing-plans`.

**Eight decisions came out of its brainstorm on 2026-08-21, and one of them is a standing rule:**

- **Every destructive action confirms.** Deleting a time entry destroys a record of work, so it goes
  through `that-confirm`. CB#6 argued the opposite for Unpin and was right there for the opposite
  reason — unpinning destroys nothing. This binds CB#10's worklog deletion too, and it is not to be
  re-argued from the Unpin precedent.
- **The dialog is the only manual way to add time**, with the timer (CB#8) the other. M4's dialog
  wins; M1's row-opens-in-place and M2's popover are superseded, and **M3's type-into-the-row fast
  path is dropped at the owner's word**.
- **The duration control is a glued stepper you type into**, always landing on a quarter hour. This
  is the one place the ticket beat the boards: CB#7's "picker-style, not a free-text field" criterion
  stands and the boards' plain `00:00` field gives way. The parse rule is a table in the spec —
  `300` is 3h, `1100` is 11h, and `7` is 0h 15m rather than zero, which looks like a bug until you
  know rounding to nearest gives nothing.
- **`started_at` is never edited** — the start time does not matter in practice — so `PATCH` carries
  `seconds` and `comment` only, and the design of record's line 238 is corrected by this ticket.
- **The rail owns its own data**, re-rendering on an `entries-changed` event, so it stays right on
  Settings and on the week view. CB#44's table assigns it both the 46px total and the per-instance
  split — scope CB#7's issue body does not currently mention. **It no longer fetches *today's*
  entries**: CB#11 made the period the mounted view's, so read that entry with the rail's new contract
  below rather than as written.
- **The API must not enforce the 15-minute grid**, because CB#8's timer will produce 7m13s. A test
  pins that so the tightening fails a gate rather than the next ticket.

**Three of CB#7's acceptance criteria changed meaning** and the issue body still needs editing to
match the spec — deliberately left until the owner approves it.

**The picker was designed in the browser, and the method is worth repeating.** Four interactive
variants were served from the scratchpad on a throwaway local server, in the app's own tokens and
typeface, each showing the integer it would post. The owner picked one, asked for two changes, and
both were live in the next reload. It took three rounds to settle a control that a written
description would have got wrong — and the two divergences found earlier the same day were both
things nobody could see until they were built.

**Five intakes came out of CB#6**, all the owner's to approve or decline: CB#55 (two `{id}` routes answer
differently for a malformed id, and CB#7's `/api/entries/{id}` is the third with no convention
recorded), CB#56 (`settings.spec.ts` flakes under load — seen twice, clean in isolation, not CB#6's
doing), CB#57 (three named gaps in the pins handler tests), CB#58 (`that-combobox` breaks if a second one
ever exists), [CB#59](../../archive/codeberg/59.md) (the pin flow's canvas source contradicts CB#44's spec). [#7](https://github.com/dgerrese/ThatApp/issues/7) gained a comment arguing
its priority is now higher: CB#6 added the second by-index concurrent write site and CB#9's push will be
the third.

### The 2026-09-03 design session — settled, do not reopen

An **opposite identity to a reference brand**, in *manners, not function*. The brand is deliberately
not named in the repository; its shape is recorded in
`docs/superpowers/specs/2026-09-03-visual-language-design.md`, and references to it were removed from
the spec, the commit history and issue CB#94 on the owner's instruction. **The issue was public for
about two hours before that edit**, and Forgejo keeps content history for edited issues.

- **Dark is the default, light is a full peer.** Not dark-only.
- **The rail separates from the page by value alone** — `0.105` against `0.178`. Chosen knowing it is
  the fragile option: it rests on one variable and nothing enforces it. **A change to either value is
  a change to this decision.**
- **The rail carries one set of tones in both themes**, and the `-rail` colour variants survive as
  single values. Retiring them fails the wordmark at 3.03:1.
- **The radius ruler is inherited and stood on at its bottom end** — cards `md` 8, buttons `sm` 4, nav
  `xs` 2.
- **Chivo and Chivo Mono**, one variable file each. Inter was rejected on the brief, and has no
  monospaced companion in any case.
- **Icons are drawn, never typed.** Eight characters across four shipped files are doing an icon's
  job. Punctuation is excluded.
- **Design sessions run on the local superpowers browser companion.** Not a cloud artifact. A canvas
  was published on 2026-09-03, stopped by the owner, and deleted.
- **The design source for CB#95 is a committed prototype**,
  `docs/superpowers/prototypes/2026-09-03-app-prototype.html`. It is the authority where it and the
  spec disagree.
- **Unset means the system.** With nothing stored the app follows `prefers-color-scheme`, so a
  machine set to light opens light. "Dark is the default" means only that the root declares
  `color-scheme: dark light` — which decides the no-preference case alone — and that dark is the
  ground the palette was authored and measured in. A stored preference beats both.
- **The 2026-08-21 decision on the Log hint is reversed**: tables reserve its width. The reveal
  behaviour survives as a modifier for narrow panels.

### The 2026-09-04 light-mode pass — settled, do not reopen

The second edition was authored, measured and judged on dark. This was the first time it was put on
paper-white, and it changed three things in the language and none in the palette.

- **The hover wash stays at 11% of ink, one formula in both themes.** Judged on white against 8% and
  6% beside the dark reference. The arithmetic had already said it was even — `0.081` lift on dark
  against `0.088` darkening on light — and the eye agreed. A per-theme pair was available and refused,
  because one formula cannot drift apart.
- **Depth is dark's cue and an edge is light's.** Light cards, popovers and dialogs carry a hairline
  in the edge tone plus a trace of shadow that ranks them; dark keeps the shadows it was built with.
  A hairline alone lost because the search panel must read as *above* the content it covers.
- **A hover box stays inside the padding of the region that holds it**, and alignment at an edge is
  done by matching that padding rather than by a negative margin. The rail's cog was corrected.
  **One exception is deliberate:** a table row's trailing icon button still overhangs its card, kept
  by the owner on 2026-09-04.
- **The prototype now carries both themes**, switched by a control above the frame. It remains the
  design source for CB#95 and the authority where it and the spec disagree.
- **Judge both themes on the same day.** The pass turned up a defect that dark could not show: the
  dialogs never set an ink colour and inherited the host page's, which on a dark sheet looks exactly
  right. A rule that is correct in one theme is invisible until somebody switches.

**Open, and now a ticket — CB#97, promoted to `status/needs-refinement` on 2026-09-22.** The scrim
behind an open dialog is still half-opaque black in both themes. Darkening a white page by that much
is a question about modality, not about depth. It needs a design session before planning.

## Decisions taken — do not reopen

**The dialog shadow is the shipped token, not the drawing's dark `.sheet`.** Settled by the owner on
2026-09-29, declining CB#245. `--shadow-dialog` is `0 12px 36px -12px` in both themes; the prototype's
dark `0 14px 44px -10px` is not to be matched, and a later audit must not raise it again.

**A dialog opened over another dialog dims the page twice, on purpose.** Settled by the owner on
2026-09-29, on CB#255 (CB#97). Each native dialog paints `--color-scrim` behind itself and the layers
stack: about 84% on dark and 44% on light outside a confirm. The dialog underneath is dimmed too,
which is what puts the eye on the confirm. A transparent backdrop for nested dialogs was the rejected
option: over full-screen Settings it would leave the confirm with no dimming at all.

**No worktrees — branch in place, permanently.** Settled by the owner on 2026-09-16: they do not use
worktrees and do not intend to, so the plan to make them cheap (`worktrees-without-the-tax`, which
would have flipped the standing decision) was dropped and its branch deleted. A side worktree for a
project-design edit while a ticket occupies the checkout is still fine; it is removed as soon as its
branch is pushed.

**A branch cut from another branch merges back into it, not into `main`.** Settled on 2026-09-02 by
the owner, against a session that had opened CB#88 against `main` on the reasoning that a stacked pull
request is fragile when the forge deletes branches after merge. That reasoning missed the point:
CB#88 fixed the rig failure that made CB#86's own checks red, so targeting `main` would have left the
owner merging a red pull request with no route to green. Retargeting is a one-line API call —
`tea api -X PATCH /repos/{owner}/{repo}/pulls/<n> -f base=<branch>` — and it kept the checks, which
attach to the head commit rather than to the base. **When a branch repairs the branch it was cut
from, it merges into it and goes first.**

**`enhancement` means an addition, not merely new work.** The owner's test, given on 2026-09-02:
it is an enhancement when the ticket is *clearly an addition* and either *is not necessary to keep
the app running* or *is not in the initial design*. Two consequences settle most cases — the
13-ticket sequence *is* the initial design, so its own tickets carry no type, and the axis is about
the product, so rig, gate, refactor and documentation tickets stay untyped. **The full test lives in
`.claude/skills/ticket-workflow/SKILL.md`**, which is the authority; it is recorded here only so a
session knows it was settled rather than open. Applied across the board it moved exactly one ticket,
CB#19.

**The forge is GitHub, at `github.com/dgerrese/ThatApp`, public, since 2026-11-19** ([#46](https://github.com/dgerrese/ThatApp/issues/46), whose body
holds every decision). Codeberg became unreliable and stopped this repository's CI (CB#284). What
must not be rediscovered:

- **The repository started empty.** `main` and the release tags were pushed, nothing else, and no
  migration tool was used, for the `refs/pull/*` reason below. The git remote is named `github`.
- **Ticket numbers changed.** Dependabot opened #1–#5 before the move script ran, so the moved open
  tickets are #6–#46, in Codeberg number order; each starts `Moved from Codeberg CB#<n>` and carries
  every comment. Closed items did not move: 28 are archived in `docs/archive/codeberg/`, the rest
  stay on the archived Codeberg repository. Day files and dated plans keep Codeberg's numbers, with a
  note at the top of each folder. GitHub does not autolink `CB#<n>`.
- **Labels are not exclusive on GitHub**, so every status or priority move removes the old label in
  the same command. A declined ticket closes as *not planned*; `wontfix` is not used.
  `.github/workflows/status-label.yml` removes `status/*` labels when an issue closes, which replaced
  the start-of-session sweep.
- **CI runs the `make` targets in Docker**, one workflow, and `Quality gate` is the one required
  check on `main` (the owner's ruleset, 2026-11-19). CI and local cannot drift any more.
- **Screenshots live on the orphan branch `pr-assets`**, under `pr-<n>/`; GitHub has no attachment
  API. Link them as `blob/pr-assets/…?raw=true`: `raw.githubusercontent.com` cached a 404 for a file
  asked for before it was pushed.

**From 2026-09-01 to 2026-11-19 the forge was Codeberg** (`codeberg.org/DionGerrese/ThatApp`, now
archived). Moved on 2026-09-01 from `github.com/dgerrese/work-dashboard`, which stays **private and
archived** — it is not the authority on anything, and nothing should be pushed to it. Full narrative
in `handoff/2026-09-01.md`. The Codeberg-specific points below are history; the first and the
numbering rule still apply:

- **A history rewrite does not clean a GitHub repo that has ever had a pull request.** GitHub's
  `refs/pull/*` refs are read-only, survive a force-push, and held the entire pre-scrub history —
  39 of them, one matching 17,251 times. Only GitHub can remove them. That is why the project moved
  rather than simply going public.
- **Never use Forgejo's migration tool on such a repo.** It does a full mirror *including*
  `refs/pull/*`, which would reimport exactly what the rewrite removed. Push from a scrubbed local
  clone into an empty repository instead.
- **CI does not use Docker, and must not be "fixed" to.** Codeberg's hosted runners give a job no
  Docker daemon and cap it at ten minutes. `.forgejo/workflows/` invokes the toolchains directly.
  This works only because `modernc.org/sqlite` is pure Go and nothing uses `-race` — a cgo
  dependency would break CI, not just slow it. `make verify` remains the local gate, and nothing
  enforces that the two stay equivalent.
- **`wontfix` is load-bearing now.** Forgejo issues are only open or closed; there is no "closed as
  not planned". A declined ticket closed without `wontfix` is indistinguishable from one that
  shipped. Status labels are `status/*`, scoped and `exclusive: true`, so the forge itself enforces
  one status at a time — verified, not assumed: adding a second status drops the first.
- **Issues and pull requests share one number sequence.** Opening a pull request during the issue
  migration consumed a number meant for an issue and shifted everything after it. It was caught by a
  guard and repaired cheaply, but the rule stands: **nothing may create an issue or pull request
  while a numbered migration is running.** The migration is done, so this now matters only if the
  numbers are ever rebuilt again.
- **Three Codeberg limits**, all found the hard way and written into the `ticket-workflow` skill:
  issue creation is rate limited to roughly one per 32 seconds for bulk work; repository create and
  delete need the `write:user` scope the token deliberately lacks, so do those in the web interface;
  and Actions is a repository *unit* that must be enabled, which does not retroactively run anything.

**Merging into `main` locally is forbidden.** Stated by the owner on 2026-08-17 as "absolutely
forbidden" and written into `CLAUDE.md`'s hard constraints and the `ticket-workflow` skill as PR CB#33.
A branch reaches `main` through a pull request the owner merges and no other way — green, approved,
one line or a typo makes no difference. It needed writing down because
`superpowers:finishing-a-development-branch` prints "merge back to main locally" as option 1 of a
fixed menu, and nothing in the repo contradicted it, so that menu got presented. The skill now says
to offer the other two options and explain the missing one.


**Never write current state into a GitHub issue or pull request body.** The owner's rule, given
2026-08-14: no "this ticket is in flight", "awaiting review", "not yet estimated", "PR CB#27 is
stale". State changes constantly and prose does not update itself, so every stateful sentence
becomes a lie somebody has to hunt down. The `status/*` label is already the single source of truth.
**Dependencies and blockers are the exception and should still be written** — "blocked by CB#29",
"must land before CB#6 ships time entry", "supersedes CB#21" — because they describe the work rather
than the moment. Existing bodies were swept on 2026-08-14. **This document is the deliberate
exception**: it exists to hold current state and is meant to be rewritten as state changes. Worth
promoting into `CLAUDE.md` in a future process pull request.

**CB#30's design settled four things.** All in
`docs/superpowers/specs/2026-08-14-theme-toggle-design.md`; recorded here so they are not reopened
from the ticket body alone:

1. **The preference lives in `localStorage`, per browser.** No schema change, no API, and
   `index.html` stays a static embedded asset. The phone in [#6](https://github.com/dgerrese/ThatApp/issues/6) gets its own setting.
2. **Colour is semantic tokens, not Tailwind's `dark:` variant.** Views write `bg-surface text-ink`
   and never mention light or dark, so a view added by a later ticket themes correctly without
   anyone remembering. The `dark:` variant's failure mode — a forgotten `dark:` giving white on
   white — is silent; this has no equivalent.
3. **The control lives in the Settings view**, not the shell header, keeping markup out of the file
   the 14kB budget actually measures.
4. **`light-dark()` carries both palettes and `color-scheme` drives it** — CSS resolves `auto`, not
   JavaScript. This replaced an earlier design where JS resolved `auto` and wrote a resolved value
   into the DOM. It came from the owner asking what happens when `localStorage` throws: any
   hardcoded fallback is wrong for half the users, and letting CSS decide also removed the
   `matchMedia` listener and the duplicated dark token block. **The whole mechanism works with
   JavaScript disabled.** The cost is a dependency on `light-dark()`, which needs Firefox 120+ and
   Chrome 123+ — inside the project's stated support, but a real dependency on it rather than a free
   choice.

**CB#5's design settled four things**, all in
`docs/superpowers/specs/2026-08-17-assigned-issues-design.md`; recorded here so they are not reopened
from the ticket body alone:

1. **Today lives at `/today`, and `/` redirects to it** with `replaceState` rather than `pushState` —
   a pushed redirect leaves `/` in the history stack, so Back lands on it and is sent forward again.
   The owner chose a nameable URL beside `/week` and `/settings` over putting Today on `/` directly,
   accepting that the router gains a redirect concept it did not have.
2. **A card per instance, not one merged list.** This is what keeps `jira.Issue` untouched: a merged
   list sorted newest-first needs an `updated` field the struct does not have. Rejected explicitly, so
   do not reintroduce it as an obvious improvement.
3. **Fetch on render plus a Refresh button, and no cache.** An in-memory cache was rejected for
   adding a second copy of state that can disagree with the server.
4. **The response is grouped and always 200** when the instance list could be read. A
   reachable-but-broken Jira instance is per-instance data, not a request failure.

**CB#5 leaves two costs to later tickets, written into its spec rather than solved.** CB#6's pinned issues
span instances and the card-per-instance layout has nowhere to put them — CB#6 decides that. And **CB#7
must revisit Today's wholesale re-render**: it is deliberate while no row holds user input, and it
becomes exactly the bug CB#29 paid to fix the moment a duration field lands in a row.

**Jira must be reached through the API gateway.** Basic auth with an API token fails against the
site host (`https://<site>.atlassian.net`) with a 401 and succeeds against
`https://api.atlassian.com/ex/jira/{cloudId}`. Whether the cause is a scoped token or an org policy
was never established — only that the gateway works and the site host does not. The cloud id is
readable without auth from `https://<site>/_edge/tenant_info`, so the settings form can still ask
for just the site URL. **It fails silently:** `POST /rest/api/3/search/jql` answers an
unauthenticated caller with `200 {"issues":[]}` rather than a 401, so a search that returns nothing
is indistinguishable from one that worked. A connection test must assert identity via
`GET /rest/api/3/myself` (now part of CB#4).

**CB#4 carries four refinement decisions.** Settled 2026-08-12 when CB#21 and CB#22 were folded in, and
written into the issue body so the plan does not reopen them:

1. `instances` gains **`site_url` and `api_base_url`** — two columns, and `internal/jira` derives
   neither from the other. The gateway's URL shape stays out of the client.
2. **`api_base_url` is nullable and resolved on demand.** A migration cannot make a network call, so
   a row holding a site URL cannot have its cloud id resolved at migration time. The server resolves
   it from `/_edge/tenant_info` on first use and persists it. This is what satisfies the hard
   requirement that a pre-existing instance keep working with no manual repair.
3. **The identity check runs at save time and can fail the save.** An instance must not be storable
   in a state that silently returns nothing. The cost — no adding an instance while Jira is
   unreachable — is accepted.
4. **`internal/jira` needs a `/myself` call**; it has none. The connection test and the save-time
   check share it.

`internal/jira/_smoke/main.go` already does the tenant-info resolution and the `/myself` call. It is
excluded from the build by its leading underscore, so it is a reference, not a substitute. **That
exclusion also means `make verify` passes while it is broken** — CB#4's Task 1 changed the store API
underneath it and had to fix it by hand, checked with `go vet ./internal/jira/_smoke/`. Any later
change to `store` or `jira` must do the same.

**CB#4's brainstorm settled four more things, all in its design document.** Recorded here so they are
not reopened from the ticket body alone:

1. **Both URL columns are nullable.** A gateway URL cannot be inverted back into a site URL offline,
   so a migrated row keeps working for REST calls with its site URL unknown, and Settings flags it.
   The `NOT NULL`-plus-empty-string alternative was rejected: it leaves the schema unable to tell
   "not set" from "set to nothing".
2. **`internal/atlassian` owns the gateway URL template**, and `jira.Client` is untouched — it is
   handed a base URL and uses it verbatim.
3. **Every write that stores an instance re-verifies identity**, including a `PATCH` that changes only
   the display name. The owner chose the unconditional rule over "only when credentials change". A
   `PATCH` with no token verifies with the stored one, so re-verification never forces the credential
   to be re-entered. The accepted cost: an instance cannot be renamed while Jira is unreachable.
4. **The router lands in CB#4**, not CB#5, because `handleAsset` already falls back to the app shell for
   client-side routes — the shell was promising routing that did not exist. Only the components the
   settings form needs are built; `that-ticket-row`, `that-timer` and `that-time-entry` belong to CB#5–CB#8.

**Browser support is Firefox and Chromium.** Firefox is primary. **Safari and WebKit are an
explicit non-goal** — do not raise them as a coverage gap, do not add WebKit to the Playwright
matrix. It also settles [#6](https://github.com/dgerrese/ThatApp/issues/6): the phone is Android, so a locally-trusted certificate only needs
installing into Android's trust store.

**There is no bespoke agent team.** Developer / project-manager / reviewer definitions were written
to `.claude/agents/` and removed on 2026-08-07 without ever running a ticket. Do not propose
rebuilding them. The gaps were structural: nothing reviewed integration across issues, and the
reviewer ran on a weaker model than the developer — which ticket 1's evidence contradicts.

**The status set is five, and a `status/*` label now describes open work only.** Reviewed label by
label with the owner on 2026-08-20 against two questions: does it match the issue's actual state,
and does it say anything GitHub does not already know. What survived is
`intake → needs-refinement → todo → in-progress`, plus `blocked` from anywhere.

**`review`, `done` and `declined` were deleted, and this reverses 2026-08-12 deliberately.** That
date had brought all three across from the owner's other repo for parity, explicitly rejecting the
position that an open pull request *is* review and a closed issue *is* done. On 2026-08-20 the owner
reinstated that position on the evidence: every one of the seven `done` issues was closed with
`COMPLETED` behind a merged PR, both `declined` ones closed `NOT_PLANNED`, and the single `review`
issue had an open PR saying `Closes CB#5`. The labels were describing GitHub back to itself. The
outcome — status for open work, GitHub state for closed — is a cleaner invariant than the one it
replaced, not merely a smaller set.

**`ready` was renamed `todo` for parity, not taste.** It had been the one deliberate divergence from
the other repo's naming; renaming closes it. `refinement` became `needs-refinement` in the same pass,
because the ticket has been promoted out of intake but *not* yet refined — which is what [#6](https://github.com/dgerrese/ThatApp/issues/6) and CB#19
have actually been doing since 2026-08-14.

**Declining an intake is: close as not planned.** On Codeberg, which has no close reason, the
`wontfix` label did this job; on GitHub since 2026-11-19 the close reason does it alone.

**Type is a second, optional axis.** `bug` and `enhancement` were kept from the stock set to record
whether a ticket is a defect or new capability. At most one, and plenty of tickets legitimately have
neither. The other six stock labels — `documentation`, `duplicate`, `good first issue`,
`help wanted`, `invalid`, `question` — were deleted unused, so nobody reaches for a second competing
vocabulary alongside `status/*`.

**One gap is known and written down rather than solved:** a pull request closed *without* merging
leaves its issue with no signal at all. It has happened once, on PR#27. Move the ticket back to
`status/in-progress` by hand.

**`status/in-progress` was restored on 2026-08-20, reversing the decision below.** The owner asked
for it so the board shows what is actually being worked on. The trigger is **cutting the branch** —
not the first line of implementation — so `status/todo` means "untouched" and a ticket with an
`issue-<n>-<slug>` branch reads as in progress even when that branch carries only a design and a
plan. CB#5 was the case that made the gap visible: designed, planned, branch pushed, and
indistinguishable from CB#6–CB#12, which nobody had opened. Colour `#5319E7`, description "Branch cut.
Work is under way." It survived the same day's label review on the ground that GitHub cannot see it:
no pull request exists yet, and this repo links issues to branches through `Closes #<n>` in PR
bodies rather than the Development sidebar. **Whether the owner's other repo mirrors it is still
open** — ask before assuming the two match.

**Three of the five labels deleted on 2026-08-12 stay deleted** — `changes-requested`,
`awaiting-human`, `proposal`. They tracked the removed PM's dispatch lifecycle. The fourth,
`in-progress`, was restored on its own merits above rather than as a reversal of that reasoning: it
is not a dispatch state. The fifth, `in-review`, is not coming back either — the state it named is
now read off the open pull request. `status/intake` (added 2026-08-12) was never one of them: it
exists so a discovery made mid-ticket has somewhere to land that is not the ticket being worked on.

**CB#9 will skip e2e** under the `paths:` filter in `.github/workflows/e2e.yml`, because it changes
handlers the UI depends on without touching frontend files. The owner accepted this knowingly; their
UI needs checking by hand. Do not re-raise it as a hole in the gate.

**This used to say "CB#5 and CB#9", and that was wrong about CB#5.** CB#5 added `web/src/views/today.ts` and
`web/src/components/that-ticket-row.ts`, so the `paths:` gate fires for it and always would have. The
gate needed no change; the note did. Corrected 2026-08-20 — CB#5's own design document had flagged the
correction as part of that ticket, but `CLAUDE.md` puts project-design documents in their own pull
request, so it landed here instead of in PR CB#38.

**The visual design is settled, and its sources are now in the repo** at
`docs/superpowers/canvas/2026-08-20-visual-directions/` — 25 artboards over five pages plus the 27
annotations that carry the reasoning, worked out with the owner on 2026-08-20 and approved board by
board. CB#44 turns it into a spec.

It was published only as an artifact
(<https://claude.ai/code/artifact/d1634bc1-ca6c-4b04-a1b9-bd35b3d69b57>), with the `.dc.html`
sources in a session scratchpad that does not persist — and `seed-canvas.mjs --extract`, the
recovery path this document used to name, had gone the same way, so the sole copy of an approved
design sat behind an authenticated URL with no working tool to read it back. Extracted on
2026-08-20; `docs/superpowers/canvas/extract_canvas.py` is the replacement and it lives in the repo.
**`Hybrid.dc.html` is the chosen direction** and carries the full light and dark `oklch` token set
that CB#44's `@theme` block comes from.

What the boards settle, none of it to be redesigned during CB#44's refinement:

- **Space Grotesk**, tight tracking, tabular figures.
- **Format carries meaning.** A *timer* — one ticket's accumulator — is `HH:MM` (`02:30`). A *total*
  you cannot start or stop is `Nh Nm` (`5h 15m`). A colon somewhere you cannot press play is a bug.
- **A dark left rail is the instrument, not a menu**: it carries the day's total, the split by
  instance, the running timer, the unpushed count and Push. Nav sits below. On the phone it unfolds
  into a header block plus a bottom tab bar.
- **Colour roles are separate from the primary**, decided after the owner rejected one accent doing
  both jobs: primary magenta 330; running green 150; not-pushed amber 85; failed red 25. Per-instance
  hues 265 and 175 are identity only. Each has a lighter `-rail` variant used *only* on the dark
  ground. Every pairing was measured in both themes; the floor is 4.5:1 for text, 3:1 for icons.
- **Manual entry is a native `<dialog>`** — centred on desktop, bottom-anchored on the phone. Chosen
  over a popover *because* `that-confirm` already proves the pattern: `showModal()` supplies the focus
  trap, inert background, top layer, Esc dismissal and focus return. **Backdrop-click dismissal stays
  absent**, matching the decision recorded in `that-confirm.ts`.
- **Preflight's `* { margin: 0 }` beats the UA's `dialog { margin: auto }`**, so a dialog lands
  top-left in Firefox and Chromium unless margin is set explicitly. Already true of `that-confirm`;
  it will be true of the entry dialog too.
- **Three things the owner decided against**, so they are not to be re-proposed: no quick-add path
  outside the dialog; card subtotals and the rail's per-instance split both stay, even though
  Ridgeline reads `4h 27m` in one and `3h 42m` in the other (the difference is a Ridgeline pin living
  in the Pinned card); and pinned rows identify their instance by coloured dot alone.

The six below were produced by CB#44, CB#6 and CB#7 and lived only in the frozen narrative until
2026-09-01. They bind later tickets, so they belong here.

- **Every `that-*` custom event carries the `that-` prefix** — `that-search`, `that-select`, `that-cancel`. A
  component that dispatched a bare `select` collided with the native text-selection `select`, which
  bubbles through light DOM to the same listener; Firefox's `fill()` fires it and the handler
  crashed on `undefined.instanceId`. Shadow DOM would contain it and shadow DOM is forbidden here so
  Tailwind can reach component internals. This is a rule for the whole family, not a fix for one
  component.
- **Every destructive action confirms, through `that-confirm`.** Deleting a time entry destroys a
  record of work. CB#6 argued the opposite for Unpin and was right for the opposite reason — unpinning
  destroys nothing. **This binds CB#10's worklog deletion, and is not to be re-argued from the Unpin
  precedent.**
- **A row key never wears the primary.** It is `ink-muted` whether it links or not, settled by the
  owner on 2026-08-20. A permanent magenta sat on exactly the element CB#8 and CB#9 must tint
  running-green and failed-red, so state would have competed with decoration. The link declares
  itself by darkening to full ink on hover, which also stops linked and unlinked keys differing by
  hue alone.
- **Plans are drafted, not verified.** CB#6 found six defects in plan-supplied test code, every one an
  assertion aimed at the wrong observable. The working rule: write the plan's test, then ask whether
  it would fail if the code it guards were wrong — and treat "no" as a defect to fix rather than
  scope to defend. This is also why plans are drafted in CB#44's light format rather than carrying
  thousands of lines of unverified Go.
- **A spec written from approved design sources is diffed against those sources before it becomes
  binding.** Every review on CB#6's branch compared code against spec, and the spec was where both of
  the owner's divergences already were. Doing the diff once, at the start, costs minutes; both of
  these cost a rebuilt component after the ticket was declared finished. CB#7 did this and it caught
  four gaps.
- **CB#6's refresh fan-out is per-instance and serial within an instance**, under one shared 15s
  budget. The spec says "one goroutine per pin" *and* "clients are resolved per instance"; the
  implementation satisfied the second by abandoning the first, which is what keeps `forInstance`'s
  first-use `api_base_url` repair from running twice concurrently on one row. N pins on one site
  share one budget serially. Fine at single-user pin counts — recorded so it is a decision rather
  than a drift.

### What mutation testing found, and why it is now the habit

Every task this ticket ran was attacked with mutations after it went green, and **the technique
found something every time**. This is worth keeping as practice, not just as a note.

- **Task 1:** 38 mutations, 8 survived. Three tests were vacuous. A `Day` assertion dated *today*,
  so a mutation stamping the day from the clock wrote back the value being checked. An `UpdatedAt`
  check spelled `!x.After(y.Add(-time.Second))`, which passes when the two are **equal** — the
  precise case it existed to catch. And two ordering tests whose **two-entry fixtures could always be
  satisfied by id order in one direction** — with two rows, descending id is chronological whenever
  ascending is not.
- **The test held up as the model was itself broken.** Task 1's fix wave was told to copy
  `TestEntriesForDayReturnsOldestFirst`'s fixture as the standard; it did, found the copy still
  passed the mutation, and traced it back to the original. Both now use three entries inserted
  middle-late-early, which no id ordering reproduces.
- **Task 3:** 36 mutations across writing and review, 5 survived the first pass — three untested
  response fields, an untested id bound, and an asymmetry between twin tables where POST gated the
  accepted 24-hour boundary and PATCH gated only the rejected one. That asymmetry-between-twins
  shape is the same tell CB#6's review named.
- **A frozen clock cannot detect "reads the clock twice"** — it returns the same value both times.
  Proving one instant needs a clock that advances per call.
- **Two of task 3's findings came from reading `pins.go`, not from mutation.** PATCH was committing
  its write before reading the instances, contradicting a rule `handleCreatePin` states in prose;
  and PATCH validated the duration before reading the entry, so a bad duration on a missing id
  reported the duration where POST reports the unknown instance. **Neither ordering was pinned by a
  test, and mutation could not have found either** — only comparing the code against its own
  siblings' documented conventions did.

### Decisions taken during CB#7's Go side, not to be reopened

- **`started_at` is normalised to UTC on write and rendered back through `cfg.Location` in the
  handler.** It is a text column both read paths sort on, so mixed offsets would sort against
  chronology — `01:00+02:00` compares later than `00:30Z` while being ninety minutes earlier. The
  spec's `+02:00` sample row is therefore correct output, not stale: the normalisation is a storage
  concern and stops at the handler. A reviewer called the spec out of date on this; it is not.
- **A column declared `DATE` is parsed into a `time.Time` by modernc's driver regardless of what is
  stored**, so a plain `SELECT day` returns `"2026-08-21T00:00:00Z"`. Every read casts it back to
  text. The same trap sits on `pinned_issues` and `instances` for anyone wanting a bare date out of
  them.
- **The read-modify-write behind a partial `PATCH` is not atomic, deliberately.** Two concurrent
  PATCHes for one id — one sending `seconds`, one sending a comment — can both read before either
  writes, and the second write puts the stale half back, discarding an edit. Reproduced 60/60. It is
  a **logical lost update, not a Go data race**, so `-race` would never see it. Tolerated because one
  browser drives this app. Recorded in `handleUpdateEntry`'s comment. **CB#8 is where it stops being
  hypothetical** — a timer PATCHing `seconds` while the foot form holds an open comment is exactly
  this interleaving — and that ticket decides what to do about it.
- **`UpdateEntry` moves `updated_at` on every call including a no-op**, marking a clean pushed entry
  dirty so CB#9 re-pushes it. Deliberate: the push is idempotent, and one redundant request is cheaper
  than diffing the row.
- **The seconds range is enforced on `PATCH` as well as `POST`.** The spec writes the rule only
  under POST; leaving PATCH open would let a browser set an entry to forty hours through the back
  door.
- **`newServerWithStore` has fifty-three callers across six test files**, so a helper needing the
  store's path duplicates its setup rather than changing that signature. Recorded in the helper's
  own comment, because the next reader will otherwise try the dedup and discover the cost the hard
  way.

### Decisions taken during CB#9, not to be reopened

- **Push state is derived, with one implementation and one construction site.** `pushStateOf` is the
  only deriver; `entryDTOFrom` is the only place an `entryDTO` is built, so no response can omit it.
  Nothing on the browser side recomputes it — `worklogId` and `pushedAt` are not even on the
  TypeScript `Entry`, which is what stops a second implementation appearing.
- **`MarkEntryPushed` names only `worklog_id` and `pushed_at`.** Stamping `updated_at` there would
  race its own `pushed_at` and could mark a freshly pushed entry dirty. A test asserts `updated_at`
  is unchanged, and a plausible "just reuse `UpdateEntry`" refactor would fail it.
- **`dirty` is repaired now, and the rail offers it.** CB#7's edit stamps `updated_at`, so an edited
  pushed entry has been reachable since then. CB#9 reported it honestly and skipped it, and the `PUT`
  was CB#10's — both shipped. **The rail did not follow for free**: its two filters still admitted only
  never-pushed entries, so a day whose only stale entry was a correction offered nothing at all. That
  is CB#121, and it is what makes the repair reachable from the interface it belongs to.
- **The confirmation is one plain sentence.** `that-confirm` sets `body` as an attribute rendered as a
  single `<p>`'s textContent, so the per-site breakdown an early sketch promised is not achievable
  without changing that component.
- **The failure list is a sibling of `that-alert`, never a child.** That component renders by calling
  `this.replaceChildren(mark, message)`, so anything appended inside it is discarded on the next
  attribute change.
- **`that-alert` has exactly three tones** — `success`, `warning`, `error`. An unknown tone falls back
  to `warning` *silently*, so a typo is invisible rather than loud.
- **An unknown push state renders no badge.** `pushBadge` is an allowlist, not an excludelist:
  telling someone their time reached Jira when it did not is the one wrong answer indistinguishable
  from a true one.
- **`push-reported.ts` mirrors `entries-changed.ts`** so the rail can announce a result without
  statically importing the view that renders it, keeping Today out of the cold-start bundle.

## Facts worth not rediscovering

**A test that cannot fail is the failure mode this project keeps meeting.** [CB#117](../../archive/codeberg/117.md)'s whole-branch
review found three defects on 2026-09-09 that had passed their own task reviews, and each existed
*because* its test asserted the wrong thing: a column's alignment asserted on the cell rather than
the label it could not move, a sideways-scroll ban asserted that nobody had scrolled rather than
that scrolling was impossible, and a tooltip's placement asserted only at mid-viewport where its
unclamped case never arises. Ask of a new assertion what it produces against the *old* code — three
of the branch's fix rounds started there.

**Two process rules are the owner's, asked for on 2026-09-09, and live only in this machine's memory
until they reach the `ticket-workflow` skill.** They are due as one project-design pull request:
a ticket's acceptance criteria are ticked as reviews confirm them and unticked on a regression, the
tick following a review rather than an implementer's claim; and a progress update leads with the
ledger — done, running, left — whenever a task actually moves, not in every message.

**`fs.inotify.max_user_instances` is 1024 on this machine as of 2026-09-09**, set permanently in
`/etc/sysctl.d/60-inotify.conf`. Before that it was the default 128, which is fewer than this
machine's containers and watchers need: it broke `make up`'s frontend watcher with `EMFILE: too many
open files` and stopped the brainstorming companion from starting at all. If either fails that way
again, the limit is the first thing to check.

**A toolbar button carries words, an inline control carries a glyph** — Decision 12 of the visual
language, settled 2026-09-09 out of [CB#117](../../archive/codeberg/117.md)'s W5. A toolbar is the group of controls in a view's or a
dialog's header; inline is a control in a row, a cell or a field. Two exemptions: a paired
directional group is one control with the words in its middle button (Week's arrows), and a window
control such as a dialog's close is chrome rather than an action on the view's data. It reaches past
the ticket that raised it — Today's refresh gains a label, which is [CB#117](../../archive/codeberg/117.md)'s T15.

**This repository's git uses a key file, and 1Password is out of the picture — since 2026-09-17.**
The owner made `~/.ssh/id_ed25519` for this machine and registered it on Codeberg. Push, fetch and
signing all work with no agent and with `SSH_AUTH_SOCK` unset, so **do not prefix git commands with
`SSH_AUTH_SOCK=~/.1password/agent.sock`** — the older notes below, and anything saying to name that
socket, describe the arrangement that replaced. Three repository-local settings carry it:
`core.sshCommand` (`ssh -i ~/.ssh/id_ed25519 -o IdentitiesOnly=yes -o IdentityAgent=none`),
`user.signingkey` (`~/.ssh/id_ed25519.pub`) and **`gpg.ssh.program` = `ssh-keygen`**. The third is
the one that is easy to miss: `~/.gitconfig.personal` points signing at
`/opt/1Password/op-ssh-sign`, which knows only vault keys and refuses this one outright. The key is
in `~/.ssh/allowed_signers` (backup at `~/.ssh/allowed_signers.bak`), and Codeberg returns
`verified: true` for it with no separate signing-key registration — proved with a probe commit
pushed to `refs/tmp/` and deleted. `~/.ssh/config` still routes `codeberg.org` to the 1Password
agent for the rest of the machine; `core.sshCommand` is what overrides it here.

**`ssh-add -l` in a Claude session still does not describe the agent anything else uses.** The
session's `SSH_AUTH_SOCK` points at an empty OpenSSH agent. That mattered while git depended on the
1Password agent, and it was misdiagnosed once on 2026-09-09.

**`tea pulls merge` is blocked by auto mode's classifier on this machine.** It is a permission-layer
block, not the workflow's rule: when the owner asks for a merge, the routes are the web interface,
the owner running the command, or a Bash permission rule. Found 2026-09-09 on PR CB#124.

- **`tea issues list --output json` prints only the first label per issue.** A board audit run through
  it reports most tickets as carrying no `status/*` label at all, which is alarming and wrong. Use the
  API — `tea api "repos/{owner}/{repo}/issues?state=open&limit=50"` — whose `labels` array is complete.
  Found on 2026-09-04, on a board that was in fact clean.
- **There is no way to screenshot a page from a session on this machine.** Playwright's MCP browser
  looks for Chrome at `/opt/google/chrome/chrome` and finds nothing, and the Claude-in-Chrome
  extension reports itself not connected. Visual work is judged by the owner or not at all, which is
  the practical argument for the browser companion carrying every option side by side rather than one
  at a time.

All verified empirically rather than recalled.

**Store.**

- `busy_timeout` does **not** protect transactions. `db.Begin()` opens a deferred transaction and
  SQLite returns `SQLITE_BUSY` immediately on the read→write upgrade. `_txlock=immediate` is in the
  DSN for that reason, and it means every transaction takes the write lock up front — so tickets
  6–9 should run long read-only queries *outside* a transaction, not wrap them in one.
- `PRAGMA journal_mode=WAL` needs exclusive access and SQLite runs no busy handler for it, so `Open`
  retries a busy `Ping`.
- `instances.id` is `INTEGER PRIMARY KEY` without `AUTOINCREMENT`, so rowids can be reused. Ordering
  by `created_at, id` rather than `id` is deliberate.

- **A migration must never rebuild a table.** `applyMigration` runs each migration inside a
  transaction; `PRAGMA foreign_keys` is a **no-op inside a transaction**, so foreign keys cannot be
  turned off there; and with them on, `DROP TABLE instances` performs an implicit delete of every row
  before dropping, which fires the `ON DELETE CASCADE` on `pinned_issues`, `time_entries` and
  `timers`. Verified on `modernc.org/sqlite`, not reasoned about — the child row was gone. CB#4's
  migration would have destroyed the user's logged time had it shipped as first designed. Use
  `ALTER TABLE ADD COLUMN` / `DROP COLUMN`, both supported by the driver, including a column-level
  `CHECK`. The cost is that a **table-level** `CHECK` cannot be added at all, so a constraint spanning
  two columns has to be enforced in Go. `TestMigrationPreservesChildRows` is the regression.

**The Playwright rig.** `app` is a real gTLD on the browsers' HSTS preload list, so a single-label
Compose host named `app` gets rewritten from `http://` to `https://` before the request leaves and
every test dies on SSL. Fixed with a `that-app` network alias — an alias, not a rename, because
renaming would ripple through every `make` target, the CI job and `CLAUDE.md`.

**The frontend build.** `web/build.mjs` shipped with `splitting: false` and `outfile`. Under that
configuration esbuild **inlines** a dynamic `import()` into the entry bundle rather than emitting a
chunk — so views would have loaded eagerly while looking lazy, and the 14kB initial-response budget
would have been silently blown. Code splitting needs `format: "esm"` (already set), `splitting: true`
and `outdir` instead of `outfile`; `entryNames: "app"` keeps the entry at `dist/app.js` so
`index.html` needs no change. **Done in CB#4's Task 9, and verified empirically:** `dist/app.js` is 955
bytes and references `import("./chunk-*.js")`, with the settings view's strings in the chunk.

**`make verify` does not run Playwright.** Since CB#51 it is lint + tsc over three TypeScript
projects + `go test ./...` + the frontend `node --test` suite; e2e is still a separate target and
workflow. **A green `verify` can therefore sit on top of a red branch**, and did: CB#4's Task
10 removed the `/api/health` poller and `#status` from `index.html`, which broke the pre-existing
`smoke.spec.ts` assertion, while `verify` stayed green through several commits. Anything touching the
frontend needs both gates before it is called done.

**Adding any `@types/*` package widens every TypeScript project that does not pin `types`.** When
`types` is unspecified, TypeScript auto-includes everything under `node_modules/@types`. CB#51 added
`@types/node` for the test project and it silently reached the browser project and, by inheritance,
`tsconfig.worker.json` — so a component could have used `process.env`, passed all three `tsc`
projects and eslint, and thrown `ReferenceError` in Firefox. `web/tsconfig.json` now carries
`"types": []` for exactly this reason. **Do not remove it, and pin `types` in any project added
later.** Proven both ways: a scratch module using `process` type-checks without the line and fails
with it. Only the whole-branch review caught this — all five task reviews passed over it, because it
is invisible unless you read the dependency addition and the base config together.

**The rail describes the view you are in, not today.** Changed by CB#11, rewriting a contract CB#7 and
CB#9 shipped. A view declares its period on mount with `setRailPeriod`; the rail renders that period's
total, split and unpushed count, and its Push sends every day the period holds, one
`POST /api/push?day=` per day in order. `TODAY_PERIOD` carries no range on purpose — an absent range
is what `listEntries()` already defaults to, so the rail still never computes a date. **A view with
no period of its own falls back to today**, which is what the rail already did, and that clause is
deliberately not load-bearing: intake [CB#89](../../archive/codeberg/89.md) may move Settings out of the nav entirely, at which point
it becomes dead code. `setRailPeriod` carries a reference-equality guard, without which Today
declaring its period on every render re-read the day and broke "one save costs one read of the day".

**`git rev-list --count main..<branch>` is the wrong test for whether a branch's work is safe.** The
forge merges with rebase-merge, so a merged branch's commits keep their old SHAs locally and are
never literally contained in `main` — `issue-51-frontend-unit-tests` and `issue-87-e2e-on-codeberg`
both read as seven and twelve unmerged commits on 2026-09-02, hours after they merged. **Use
`git cherry codeberg/main <branch>`**, which marks a commit `-` when an equivalent change is already
upstream and `+` when it is genuinely absent. The eod skill's survey still uses the `rev-list` count,
so read its output through this.

**`pwa.spec.ts` segfaults on Chromium roughly one run in three.** Three sightings on 2026-09-02, all
on browser launch — `Target page, context or browser has been closed`, or a bare SIGSEGV — never on
an assertion, and always clean on an immediate re-run. It is environmental, and nothing in CB#11
touched the service worker or that spec. Re-run once before investigating; do not chase it.

**Playwright sizes its worker pool from the runner's host, not from the runner.** Its default is
half of `os.cpus()`, and inside a Forgejo Actions job that call reports the host machine's logical
cores rather than the container's cgroup share. On Codeberg that meant sixteen workers on a
`codeberg-medium` box of 4 CPU / 8G, and the end-to-end suite failed on 2026-09-02 with five Firefox
specs timing out and browser contexts being lost. Chromium barely noticed; Firefox is far heavier
per instance, which is what makes the failures look engine-specific rather than environmental.
`playwright.config.ts` now pins `workers: 4` under `CI` (CB#87). **Any tool that sizes itself from the
CPU count is suspect on a hosted runner** — check what it actually chose before believing a
resource-shaped failure is a real one. Counter-intuitively the cap made the suite *faster*: 2.0m
against 3.3m at sixteen workers.

**The 14kB budget is `index.html` alone.** It is 797 bytes. `app.css` and `app.js` are separate
requests the browser only discovers after parsing it, so summing all three and comparing to 14336
overstates the risk badly — this was got wrong mid-session and corrected. There is plenty of headroom.

**`web/build.mjs` never cleans `dist/`, and the repo has no `.dockerignore`.** `Dockerfile:7` is
`COPY web/ ./` followed by `RUN npm run build`, so a developer's dirty local `dist/` is copied into
the build context, survives the rebuild, and its orphaned `chunk-*.js` files are embedded into the
production binary by `//go:embed all:dist`. They are never served — nothing references their hashes —
so there is no correctness impact, just dead bytes and a non-reproducible image. It also means **any
byte measurement taken from an uncleaned `dist/` is suspect.** `rm -rf dist` before measuring.

**`http.DefaultClient` has no timeout** (`Timeout: 0`), and `http.DefaultTransport` bounds only the
dial and the TLS handshake — `ResponseHeaderTimeout` is unset. A host that accepts the connection and
then stalls hangs forever, and `r.Context()` does not cancel on a browser `fetch()` still in flight.
This bit the tenant-info lookup, which is the *first* request the Add-instance flow makes against a
host the user typed in. Now `&http.Client{Timeout: 10 * time.Second}` in `internal/server/clients.go`.
`jira.Client` has always set its own 30s.

**`jira.ErrNotFound` is reachable from the connection test.**
`https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/myself` returns **404** when the token's
account has no access to the Jira product on that cloud id — right site, token from the wrong account.
It now maps to 502 `account_not_found`. **429 still falls to the `default` branch** and renders as a
500, which is CB#19's territory; the branch no longer leaks the raw Go error string, it logs
server-side and returns a fixed message.

**`that-button`'s `label` attribute is the sole source of its inner button's accessible name** — there
is no slot fallback, and the component's own interface docs omit it. A `that-button` built without
`label` renders a nameless button that role-based Playwright queries cannot find. The Settings view
funnels every one through a single `button(label, variant)` helper for this reason.

**`that-card` has no `observedAttributes`**, so its `heading` is not reactive, while `that-button` and
`that-alert` both are. Set a card's heading before insertion; changing it afterwards silently does
nothing.

**Tailwind v4 facts for CB#30, verified against `tailwindcss` v4.3.3 in the project container rather
than assumed.** A throwaway `probe.css` / `probe.html` pair was compiled and the output read.

- **`light-dark()` passes through `@theme` untouched.** `--color-surface: light-dark(#fafafa,
  #0a0a0a)` emits verbatim, and `.bg-surface` emits `background-color: var(--color-surface)`, so the
  value resolves against the element's `color-scheme` at use time.
- **Tailwind generates one utility per `--color-*` token, so token names are call-site names.**
  `--color-border` would give `border-border` and a tone's background `bg-danger-bg`. The spec uses
  `edge` for hairlines and `tint` for a tone's fill instead — `border-edge`, `bg-danger-tint`.
- **Variants compose over custom tokens**, checked explicitly because they are the awkward cases:
  `.divide-edge > :not(:last-child)`, `.hover\:bg-danger-solid-hover:hover` and
  `.focus\:border-ink:focus` all generate.
- Specifying `@source` **adds to** the default scan rather than replacing it, so a probe file also
  picks up `index.html` and `src/`. Do not read that as the probe generating stock utilities.

**Tailwind's preflight beats the UA stylesheet on a native `<dialog>`, and this branch got it wrong
twice before getting it right.** Preflight ships `*, ::after, ::before, ::backdrop { margin: 0 }` in
**author** origin, so it wins over the UA's `dialog { margin: auto }` and a `showModal()` dialog
renders pinned to the **top-left corner**. `m-auto` on the dialog restores centring — verified on
2026-08-17 at 0px offset from centre in both Firefox and Chromium. The mirror-image error is styling
`::backdrop` to "preserve" the scrim: preflight resets only margin, padding, border and box-sizing
there, **not `background-color`**, so the UA scrim survives on its own and any author
`backdrop:bg-*` utility erases it. Both browsers compute `rgba(0, 0, 0, 0.1)` for it. **Nothing in
this repo should style `::backdrop`, and any new native element needs its UA styles checked against
preflight rather than assumed.**

**No assertion in the e2e suite can see where an element is.** Every settings and theme assertion is
`toBeVisible()` or `toContainText()`, and a corner-pinned modal dialog passes both. Position, and
anything else purely visual, needs a screenshot or a measured `getBoundingClientRect()`.

**Two ways to look at the running UI, and one of them fails on modal dialogs.** The Chrome extension's
screenshot (`Page.captureScreenshot` over CDP) **times out after 30s while a modal `<dialog>` is
open** — reproduced twice on 2026-08-17; its `javascript_tool` still works, so geometry and computed
styles can be read while the dialog is up. For an actual image of a modal, add a throwaway
`*.spec.ts` to `.claude/e2e/tests/`, `page.screenshot({ path: "/e2e/…png" })` (the rig mounts
`.claude/e2e`, so the file lands in the repo), run it with `--project=firefox`, then delete both the
spec and the images. `page.emulateMedia({ colorScheme })` covers both themes in one run.

**`Instance` (`web/src/types.ts`) has no `token` field** — the API never echoes a credential back. So
an edit that changes *only* the token produces a reconciled `Instance` byte-identical to the one
before it, and **any "did this row change?" check by field comparison is structurally blind to it.**
CB#29's fix wave hit this: the instruction was to compare fields in `patchRow`, and the implementer
correctly refused, clearing the just-saved row's status by id inside `save()` instead.

**The e2e suite runs against the dev database, and CB#5 makes that dangerous.** `make test-e2e` starts
the same `app` service `make up` does, mounting the same `that-data` volume — so the browser suite talks
to a database holding real Jira instances with real sealed tokens. Nothing exercises it today because
every spec stubs the routes it needs, but **once `/` renders Today, a spec that navigates there
without stubbing `/api/issues` makes the server fan out to a real Jira site**, which breaks
`CLAUDE.md`'s rule that no test ever contacts one. CB#5's plan stubs it in every spec that reaches
Today; **[CB#35](../../archive/codeberg/35.md) is the structural fix** (a throwaway database for the e2e profile). On CI the volume is
always fresh, so the exposure is local-only.

**`golang.org/x/sync` was not in `go.mod`** until CB#5, despite being on `CLAUDE.md`'s approved list.
The container reaches the proxy (checked 2026-08-17; v0.22.0 was current). Sequencing matters:
`go mod tidy` **removes** a module nothing imports yet, so `go get` then `tidy` in one breath deletes
the requirement it just added. Import it first, tidy after.

**The e2e suite stubs the backend.** `settings.spec.ts` intercepts `/api/instances`,
`/api/instances/*` (POST, PATCH, DELETE) and `/api/instances/*/test` with `page.route`, so **no
browser test exercises a real backend response** — the handlers have `httptest` coverage instead. A
wrong URL in `api.ts` would still be caught (it would miss the stub, hit the real server, 404 and fail
the spec). The PATCH stub was added in CB#29 after an implementer found that without it "Save changes"
fell through to the real backend, 502'd on an unreachable stub site URL, and **`save()` never reached
`refresh()` — so the test passed against the unfixed code too.** A route that is not stubbed does not
fail loudly; it fails by making the test vacuous.

**`addInstance()` in `settings.spec.ts` does not await its own round trip.** Interacting immediately
afterwards can land a `fill()` on a form that `save()` is about to reset, discarding the input. The
file's idiom for this is `await expect(page.getByText("<name>", { exact: true })).toBeVisible()`
between the setup and the behaviour under test. It bit two tests written in CB#29 (fixed there) and
**two pre-existing tests still carry the same latent pattern** — "a successful connection test names
the account" and "a rejected connection test reports the failure". Neither has flaked; both are worth
tidying when that file is next open.

**Two `exact: true` locators in `settings.spec.ts` are load-bearing — do not "tidy" them away.**
`getByText` matches substrings, so `getByText("Work")` collides with the shell's
`<h1>ThatApp</h1>`; and `getByRole("link", { name: "Settings" })` collides with the router
placeholder's "Open Settings" link, because `/` has no registered route and the placeholder is on
screen alongside the shell nav. Both are real Playwright strict-mode failures, not stylistic choices.

**CB#4's plan has one step that was deliberately not executed:** Task 13, Step 4, "update the handoff".
It was skipped because an open pull request already modified this file and `CLAUDE.md` requires
process documents to go in their own pull request, splitting any change that touches both. The plan's
unticked box is intentional, not an oversight.

**`web/build.mjs` writes into `dist/` before creating it.** `copyShell()` runs at top level and does
`copyFileSync("index.html", "dist/index.html")`; nothing creates the directory first. It works only
because `web/dist/.gitkeep` is tracked, so a fresh clone has the directory already. Two consequences:
`rm -rf dist && npm run build` — the obvious way to take a trustworthy byte measurement — throws, and
the existing repo-hygiene note below to add `rm -rf dist` *into* `build.mjs` would break the build
unless it also creates the directory. Raised as **CB#40**. Until it lands, measure with
`rm -rf dist && mkdir dist && npm run build`.

**`make verify` has no formatting gate.** Since CB#51 it is eslint + tsc + `go test ./...` + the
frontend unit suite; nothing runs Prettier in check mode. `web/src/views/settings.ts` currently carries formatting drift that `npm run fmt`
would rewrite, and `verify` stays green over it. Anything running `npm run fmt` while working on
another file will see that file appear in its diff — revert it rather than folding an unrelated
reformat into a ticket. Discovered during CB#5; no ticket raised, because whether to add a format check
is a judgement call rather than a defect.

**The e2e baseline, counted rather than assumed.** Before CB#5: `settings.spec.ts` 15, `smoke.spec.ts`
2, `theme.spec.ts` 9 — 26 per browser, 52 total. After CB#5: 35 per browser, 70 total. CB#5's plan
asserted 48 as the expected post-ticket total and would have tripped its own "a test was lost" guard
on a correct outcome, because it was written before CB#29 added 11 settings specs. **A plan that
asserts a test count must derive it from a count taken on the branch it will run on**, not from the
count that was true when it was written.

The nine below came out of CB#44 and CB#6 and lived only in the frozen narrative until 2026-09-01. Each
is a trap that cost time once already.

- **A `var()` inside an inherited custom property resolves where it is *declared*, not where it is
  used, and fails silently.** `--instance: light-dark(oklch(0.60 0.13 var(--h)), …)` on `:root`
  computes to guaranteed-invalid, because `--h` does not exist there — every dot renders transparent
  with **nothing in the console**. The hue must go in the `background` declaration on the element
  itself, so the instance dot is a CSS rule rather than a colour utility.
- **`--color-ink-faint` is not a text colour** — 3.60:1 on `raised`. It clears the non-text floor
  and fails the text floor, and nothing in the name warns you. Card headings use `ink-muted`.
- **Contrast has three tiers, not two:** text 4.5:1, meaningful non-text 3:1, decorative separators
  exempt. Reporting a hairline as failing 3:1 is as wrong as shipping body text at 3.6:1.
- **A flex item's floor is its min-content width, so `truncate` silently does nothing** without
  `min-w-0` on the shrinking box. A long summary pushed the status clean out of the card while
  **every class-based check passed** — the utility was present, correct, and inert. Regression tests
  for truncation therefore assert **geometry, not classes**.
- **Tailwind v4's Preflight leaves `<button>` on the default arrow cursor**, deliberately, so the
  app has to say `cursor-pointer` itself. `that-button`'s base covers every button; the rail's Push is
  the only raw one.
- **A stale bundle can survive a rebuild, and did.** `/app.js` is unhashed and cacheable while
  `build.mjs` never cleans `dist/`, so a cached `app.js` keeps resolving to old content-hashed
  chunks that were never removed — a fix measured as "not working" was working, and the browser was
  running code from before it. **Hard-reload before believing any frontend measurement.** Adjacent
  to intake CB#40.
- **`.claude/e2e/` has no `.prettierrc.json`, and still does not as of 2026-09-01.**
  `web/.prettierrc.json` sets `printWidth: 100`, but prettier run from the e2e directory finds no
  config and reflows at its default 80 — it silently rewrote 68 lines of a spec file during CB#6 and
  had to be reverted. It recurs every time an agent formats from there. A config file in
  `.claude/e2e/` closes it permanently; it is a project-design change and needs no ticket.
- **Both engines serialise computed `oklch()` as `oklch()`**, trailing zeros normalised, so
  `theme.spec.ts`'s assertions changed shape and not merely value. Verified in Firefox and Chromium
  rather than assumed; the two ground colours are constants now, so an engine that converts to
  `rgb()` is a two-line change.
- **The issue-key column floor is 76px and each list measures its own keys.** The design drew 76px
  around seven-character examples, but the owner's own `RIDGE-5325` measures 78px, so that
  instance's card sat 2px out of line. Measuring per list rather than per app avoids padding a
  short-keyed instance to suit a long-keyed one, which spends width the summary needs.

Two more, salvaged from *Still open* on 2026-09-01 when the bullets carrying them were retired:

- **A leading underscore hides a directory from the Go toolchain.** `internal/jira/_smoke/main.go`
  is a read-only smoke command that seeds an instance and runs `SearchAssigned` against a real site,
  reading the sealed token from the DB. The underscore keeps `go build ./...`, `go test ./...` and
  golangci-lint from seeing it, which is what lets it exist without making `make verify` reach the
  network. It shipped in `main` as of PR CB#20, and it is what found CB#21 and CB#22.
- **An untracked file inside a directory another branch tracks is not necessarily an oversight.**
  The app-icon canvas page looked abandoned and was nearly "rescued"; in fact `issue-12-pwa-shell`
  tracked that directory *and* a `.gitignore` whose only line was that filename, because the page is
  a ~2MB generated rendering of artboards that are themselves tracked. Check for a `.gitignore` on
  the branch that owns the directory before calling a file undecided.


**A subagent's test evidence is a claim, not a record.** On 2026-09-09 an implementer's report
presented a run made with its own file stashed as proof that a teardown test caught a leaked
subscription. With the file stashed there was no subscription to leak, so what it had recorded was
the mount-read race the test's own comment warns about. The reviewer caught it and a genuine failing
run was produced. Read a RED the way you would read any other claim: ask what state the run was
actually in, and whether that state could have produced that failure.

**Inherited work is a draft until something has run it.** Two implementer runs were lost mid-flight
the same evening — one to a hung response stream the watchdog killed after ten minutes, one to its
session ending — and both left a full working tree of uncommitted edits that had never been compiled,
linted or run. The work was recoverable both times, and the successor was told to treat it as a draft
to check rather than as correct, which is the only safe reading. Since then every dispatch asks for
small steps with each edit confirmed before the next, so a stall costs a file rather than a session.

**The dev stack's Go server never reloads, and a stale one can be *half*-current.** `compose.yaml`
runs the app as `go run -tags dev ./cmd/server`, which compiles once at container start; the source
is bind-mounted, so files change underneath a process that will not read them again. The web service
watches and rebuilds, the app service does not. On 2026-09-10 that produced a reported product bug
that was nothing of the kind: the server answered the new entries envelope but silently dropped the
new `day` field on create, because the first change was in the tree when it last started and the
second was not — and Go's `encoding/json` ignores unknown fields by default. **Restart the app
container before believing any backend measurement**, the way a hard reload precedes a frontend one.
The cheap discriminator is a request whose validation order differs between the two builds: an
impossible `day` with an unknown instance id answers 400 on current code and 404 on anything before
CB#105. Raised as intake **[#17](https://github.com/dgerrese/ThatApp/issues/17)**.

## Still open

- **Team reporting design is PR CB#341 (`[Docs]`).** The owner filed the milestone-wide design as
  documentation, not under a ticket. [#38](https://github.com/dgerrese/ThatApp/issues/38)–[#42](https://github.com/dgerrese/ThatApp/issues/42) read it from `main` once it merges.

Resolved bullets were retired from this section on 2026-09-01; what they were worth keeping for is
in *Facts worth not rediscovering* and in the day logs under `handoff/`. What is below is open.

**The one thing between here and a usable app:**

- **Re-add the Ridgeline instance before trusting CB#9 with a real day.** CB#9 is merged, but the push
  has never run against real Jira — every test and every by-eye check used an `httptest` server, a
  browser stub or a throwaway mock. The mechanism is proven; the round trip to a real site is not.
  CB#73 moved the database to a `./data` bind mount on 2026-08-31, so it survives `make down` and only
  has to be added once. **Basic auth fails silently on the site host: the instance must point at the
  API gateway.**
- **Then a real week of use.** CB#11 — the weekly rollup, the deadline the app exists to serve —
  merged as PR CB#90, so what remains of the route to a usable app is the week of use above → CB#10
  (corrections after a push, and now a week's fetch) → CB#8 (the timer). CB#8 is not a prerequisite for CB#9 despite the spec's ordering — manual entry already
  produces the entries a push sends.

**Left over from the forge move, 2026-09-01:**

- **Local `main` lags the forge and only the owner may move it.** Verified 2026-10-06: it is at
  `4a9115d` while remote `main` is at `b644db0`, 168 commits ahead. Branch from `codeberg/main`, never
  from local `main`. **Verify the gap against the API before repeating a number here**, because a
  blocked fetch leaves the local `codeberg/*` refs frozen and makes local `git` quietly wrong.
- ~~**`retro-skill` and `worktrees-without-the-tax` are pushed but have no pull request.**~~
  **`retro-skill` merged as PR CB#85 on 2026-09-02.** Rebasing it onto `main` first needed the
  `CLAUDE.md` hunk re-placed against the handoff split and the eod paragraph, and its commands
  ported from `gh` to `tea` — the pre-move debt the original bullet warned about, and it was an
  hour's work rather than a rewrite. `worktrees-without-the-tax` never got one: the owner dropped
  the plan on 2026-09-16 and the branch was deleted.
- **`upload-artifact` on hosted runners is still unfired, but no longer unverified in the same
  way.** The 2026-09-02 failure finally ran the step, and `actions/upload-artifact@v4` refused
  outright: it aborts on any non-github.com API with *not currently supported on GHES*, so the
  traces from the run that needed them most were never stored. CB#87 swapped it for
  `forgejo/upload-artifact@v4`, whose reference the runner does resolve. Whether Codeberg has the
  artifact API enabled at all is still open, because the step is `if: failure()` and every run
  since has passed. **Do not read a green end-to-end run as evidence this works.**
- **`make fmt`, `make lint` and the e2e rig were not re-run after the rename beyond the two gates.**
  `make verify` and `make test-e2e` both passed, which is the merge gate; `make fmt` in particular
  was not, and [CB#74](../../archive/codeberg/74.md) already records that it rewrites committed files.

**Waiting on the owner:**

- **The intake queue is thirteen**, verified 2026-10-06 against the API: [#10](https://github.com/dgerrese/ThatApp/issues/10), [#12](https://github.com/dgerrese/ThatApp/issues/12), [#17](https://github.com/dgerrese/ThatApp/issues/17), CB#173, [#18](https://github.com/dgerrese/ThatApp/issues/18),
  [#20](https://github.com/dgerrese/ThatApp/issues/20), [#21](https://github.com/dgerrese/ThatApp/issues/21), [#22](https://github.com/dgerrese/ThatApp/issues/22), CB#206, [#23](https://github.com/dgerrese/ThatApp/issues/23), [#24](https://github.com/dgerrese/ThatApp/issues/24), [CB#276](../../archive/codeberg/276.md) and [CB#281](../../archive/codeberg/281.md). The owner has triaged the whole queue before,
  ticket by ticket.
  Approving and declining remain the owner's moves alone.
- **Whether the owner's other repo mirrors this label set** is still unanswered, and the gap widened
  on 2026-08-20: this repo now has five statuses plus `bug`/`enhancement`/`wontfix`, having deleted
  `review`, `done` and `declined` and renamed two more. Ask before assuming the two still match.
- **Nine local branches are contained in Codeberg's `main` and droppable** whenever the owner says
  so, re-verified on 2026-09-09 with `git cherry` — each reports zero patches not upstream:
  `handoff-2026-09-02`, `handoff-2026-09-08`, `handoff-pr-prefix`, `issue-11-week-view`,
  `issue-51-frontend-unit-tests`, `issue-87-e2e-on-codeberg`, `issue-94-visual-language`,
  `issue-95-today-and-week` and `project-design-priority-axis`. The last three joined when PRs CB#120,
  CB#124 and CB#125 merged; they need a force delete for the reason below.
  **`git branch --merged` under-reports this, and will keep doing so.** Rebase-merge rewrites the
  SHAs, so a branch whose content is on `main` is not an ancestor of it, and on 2026-09-07 eight of
  the twenty-three were invisible to that command while `git cherry` found every one of them upstream
  by patch. `git cherry codeberg/main <branch>` is the one to use; every commit prefixed `-` is
  already upstream.

**Decided but not built:**

- **Repo hygiene, no ticket needed:** a `.dockerignore` excluding `web/dist` and `web/node_modules`,
  and `rm -rf dist` in `web/build.mjs`. Together they make the image reproducible and future byte
  measurements trustworthy. Not started.
- **`.claude/e2e/` still has no `.prettierrc.json`** — see *Facts worth not rediscovering*. Also a
  project-design change needing no ticket, and it recurs every time an agent formats from that
  directory.

**Known defects and gaps, none blocking:**

- **Two things CB#9 left undone on purpose**, both in PR CB#76's body: an edit landing during an
  in-flight push can be lost (`pushMu` serialises pushes against each other, not against
  `PATCH /api/entries/{id}`; the window is seconds, and the guarded-update fix reaches into CB#10),
  and the new `store_failed` branch of the failure report has no test.
- **[CB#74](../../archive/codeberg/74.md) is worth reading before the next frontend ticket.** `make fmt` rewrites seven
  already-committed files, because prettier is pinned as `^3.0.0` — a caret range now resolving to
  3.9.6 — and **no gate checks formatting**: `lint` is `eslint src` only, and `fmt` is write-only,
  never `--check`. The tree drifted from its own formatter with nothing to notice. It ambushed CB#9's
  fix wave, which had to format `today.ts` and revert the rest by hand.
- **The pin restyle still contradicts CB#44's spec** — raised as intake [CB#59](../../archive/codeberg/59.md). CB#6 did *not* inherit
  either mistake: its plan was written in the corrected vocabulary, so nothing shipped wrong. The
  file remains a design source a later ticket would read as authoritative.
- **Enter does not submit the Settings form, and that is deliberate for now.** The form has four
  implicit-submission-blocking fields and no submit button — `that-button` renders
  `<button type="button">` — so per the HTML implicit-submission rules Enter does nothing. CB#4's fix
  wave removed the dead `submit` listener and corrected `that-button`'s docstring rather than wiring
  it up: the honest fix gives `that-button` a `type` attribute and swaps the click handler for a
  submit handler, and doing both in one fix wave with a single re-review risks a double-submit.
  Worth a follow-up.
- ~~**A flake worth watching:** `pwa.spec.ts:322`.~~ **It recurred on 2026-09-06** — twice in one
  session, at `pwa.spec.ts:280`, this time with a visible cause: the Chromium headless shell
  segfaults while launching a browser context. Passes alone, passes on a clean full run. **Raised as
  CB#101** at intake, so it is the owner's to approve rather than a line to keep watching. Do not fix
  it by skipping or retrying the test — it is one of the few that proves the app works offline.

**Before planning the next ticket:**

- **[CB#117](../../archive/codeberg/117.md) is next, and the owner chose that order.** [CB#117](../../archive/codeberg/117.md), CB#105 and CB#8 are all at `status/todo`.
  [CB#117](../../archive/codeberg/117.md) and CB#8 collide — [CB#117](../../archive/codeberg/117.md) rewrites the rail and Today's rows including the action column CB#8 adds
  a play button to — so [CB#117](../../archive/codeberg/117.md) goes first and CB#8 rebases onto it.
- **CB#8 was brainstormed on 2026-09-08 and its design is settled but unwritten.** The day ended
  before the spec was written. **Every decision is in `handoff/2026-09-08.md` and none of it needs
  reopening** — the play button in the row's action column, the Today cell becoming the live count,
  the single dialog that confirms a handover and takes the comment, Escape cancelling the stop, the
  rail's line as a stop control visible on Week too, the stranded-timer ask, and the fourth endpoint
  discard needs. The next move on CB#8 is writing that up as a design document, then a plan. **Its
  acceptance criteria name three endpoints and must be corrected to four.**
- **CB#8's markup is already reserved.** `web/index.html` carries `#rail-timer` with
  `<!-- CB#8 makes this the running timer. -->`, exactly as it carried `#rail-push` for CB#9 — which the
  CB#9 plan missed and paid for late. **Open `web/index.html` before planning CB#8.**
- **[CB#35](../../archive/codeberg/35.md) is `status/needs-refinement`**, not intake as this section long claimed. Raised while
  planning CB#5. Refining it is available work; it has the owner's approval already.
- **CB#19 must not be implemented from its current state.** Its facts changed under it on
  2026-08-14 — see *Facts worth not rediscovering* — and it still has no acceptance criteria, by
  design. Its three open questions are the owner's to answer in a brainstorming round.
- **Spec §"Decisions deferred"** — unchanged; nothing there blocks the ready tickets.

**The `eod` skill's snapshot command is broken under zsh.** `:r` is a zsh parameter modifier, so the
unbraced `"$snap:refs/eod/..."` loses it and pushes to `...c6cdefs/eod/...`, which git rejects as a
refspec matching nothing. **`"${snap}:refs/..."` is the form that works.** Found 2026-09-08; the
skill still carries the unbraced version.

**This branch:** `issue-105-day-scoped-dialog`, carrying CB#105's design document and plan on top of
[CB#117](../../archive/codeberg/117.md)'s 33 commits. The 2026-09-09 handoff went out separately on `handoff-2026-09-09`, as it should.
`issue-117-prototype-drift` merged as PR CB#128 on 2026-09-09, and CB#105 followed it as PR CB#135. `handoff-2026-09-08` merged as PR CB#125 on 2026-09-09 and can be deleted on the owner's
word, along with `project-design-priority-axis` from PR CB#124. **`issue-10-edit-after-push-and-week-fetch` merged
as PR CB#120 on 2026-09-08** and is deleted on both the forge and this machine. The 2026-09-08 handoff
edits were being written on that branch, so they were carried across to this one before it went.
**A second branch went
out on 2026-09-08:** `project-design-priority-axis`, carrying the `CLAUDE.md` and `ticket-workflow`
changes that document the priority axis. The owner chose that it get its own branch and pull request
rather than ride on the handoff, so a handoff pull request still carries only the day's record.

**Commit signing is restored and the CB#95 range was never re-signed.** `commit.gpgsign` is `true`
again and commits sign cleanly, but the five unsigned `CB#95` commits merged to `main` as PR CB#112 on
2026-09-07 before anyone re-signed them. **That is now permanent** — re-signing would rewrite `main`,
which is forbidden outright. Do not go looking for the range to fix; the instruction that used to
live here is dead. Every merge commit on `main` is unsigned too, because the forge does not sign its
own merges.

**`1Password: failed to fill whole buffer` means the agent is locked**, not that anything is corrupt.
The socket still exists and `ssh-add -l` reports no identities. Unlocking 1Password is the whole fix.
Seen on 2026-09-08, mid-commit.

## Environment notes

- **The CLI is `gh`**, at `~/.local/bin/gh`, logged in as `dgerrese`. Every label and status move
  goes through it. Its token carries `gist`, `read:org`, `repo` and `workflow` — **not**
  `delete_repo`, and not `read:packages`, so it cannot see the `ghcr.io` package; check an image with
  an anonymous `docker manifest inspect ghcr.io/dgerrese/thatapp:<tag>` instead. CI publishes images
  with its own `GITHUB_TOKEN`, so no personal token needs package rights.
- **`tea` is still installed** (`/usr/local/bin/tea`, v0.15.1, a manual install that gets no security
  updates) only to read the archived Codeberg repository. Nothing in the workflow reaches for it.
- **The owner runs the release image on this machine**, since 2026-09-17: container `thatapp`,
  `--restart unless-stopped`, bound to `127.0.0.1:8080`, data in the named volume `thatapp-data`.
  **It collides with the dev stack**, which `.env` publishes on `THAT_PORT=8080`, so `make up` and
  `make test-e2e` cannot bind while it runs. Moving the dev stack to 8081 was offered and not
  answered. The two databases are now separate: the dev one is the bind mount at `./data`, and
  entries made in one never appear in the other.
- **Migrating a database into the release takes the WAL and the key.** `thatapp.db` alone is
  almost empty — the data is in `thatapp.db-wal` — and a `THAT_SECRET_KEY` that differs from the
  source's makes every stored Jira token undecryptable without any visible error.
- **Releases come from CI**, never by hand: see *Where things stand*. `gh run list --workflow
  Release` shows them. The first GitHub stable release, `v2026.47.3`, was published on 2026-11-19
  when the owner closed the Releases milestone.
- **The Claude GitHub App is not installed** on the new repository. Claude runs locally through the
  superpowers skills, which is how the work was always actually done.
- **Commits here are signed, and git will tell you they are not.** Every commit in this repository
  carries a `gpgsig` SSH signature, but `gpg.ssh.allowedSignersFile` is unset, so git cannot verify
  its own work: `git log --show-signature` prints *No signature*, `%G?` reports `N` for all 284
  commits, and an `allowedSignersFile needs to be configured` error is emitted on the side. **That
  is a verification gap, not a signing failure** — confirm with `git cat-file commit HEAD | head`,
  which shows the `gpgsig` header plainly. Do not conclude from `--show-signature` that signing is
  broken, and do not "fix" signing on that evidence.
- **When SSH is down, local git does not merely fail — it answers with stale data.** `git fetch`
  failing leaves every `github/*` remote-tracking ref frozen at its last successful fetch, so
  `git branch -vv`, `git log` and any ahead/behind count describe the forge as it was, with no
  warning that they are out of date. On 2026-09-02 that read a merged branch as unpushed and its
  pull request as missing. **`gh` is unaffected**, because it carries a token rather than the SSH
  key, so check real state there before believing local git: `gh api repos/{owner}/{repo}/branches`
  lists what actually exists on the forge, and `gh pr list --state open` lists what is actually
  waiting.
  **A remote branch that has disappeared usually means its pull request merged**, not that the push
  never happened — check the commit against `main` before concluding work was lost.
- Local `main` may sit well behind the forge; branch from the remote, not from it. **As of
  2026-09-02 it is at `41b60b1`, one merge behind the forge's `0c1dcfc`** — no longer the badly
  stale pre-rename tip it was on 2026-09-01. Advancing it is the owner's call, since `CLAUDE.md`
  forbids a session moving `main`.
- **SSH authentication was down on 2026-08-17** and no git traffic reached GitHub all session:
  `sign_and_send_pubkey: signing failed … communication with agent failed`, and `ssh-add -l` reports
  *The agent has no identities* — the agent is running but empty, or its socket is stale from an
  earlier login. `ssh-add ~/.ssh/id_ed25519` is the fix; the owner has to run it. **Do not switch the
  remote to HTTPS to work around it.** `gh` was unaffected throughout — it carries its own token —
  so issue bodies and labels could still be edited while fetch and push could not. The cost was
  branches cut from a stale local `main`: both CB#30's and CB#29's were rebased onto `origin/main` before
  their pull requests went up, which is the fix, and `--force-with-lease` is how a rebased branch
  gets pushed over its pre-rebase remote copy. **It recurred on 2026-08-24**, same signature,
  mid-session — and this time there is a workaround that does not touch the remote:
  `git -c credential.helper='!gh auth git-credential' push https://github.com/dgerrese/work-dashboard.git <branch>`
  pushed on `gh`'s token with the agent dead, as a one-off, leaving the SSH remote configured.
  **That exact command is dead now** — it names the archived GitHub repository, and the 2026-09-01
  rename rewrote the URL to a Codeberg one, which made the sentence look current while being
  nonsense: `gh`'s token has no authority on Codeberg. The URL above is restored to what was
  actually run. **The Codeberg equivalent is `tea login add --git-credentials`**, which registers
  `tea` as a git credential helper so HTTPS pushes authenticate on its token; it has not been tried
  here. `ssh-add` — or starting 1Password — remains the real fix and the owner's to run.
- **The 2026-08-28 recurrence had a different cause, and `ssh-add` is not its fix.** Keys come from
  the **1Password SSH agent**, not from a file, and the app was simply not running: no 1Password
  process, and `~/.1password/agent.sock` left over from 2026-08-27 answering *Connection refused*.
  The empty `ssh-add -l` is a symptom — `SSH_AUTH_SOCK` pointed at a stock agent that never had the
  keys. **Check `pgrep 1password` and probe the socket before reaching for `ssh-add`**, which cannot
  help when the key lives in a vault. This also breaks **commit signing**, not just transport:
  `commit.gpgsign=true` with `gpg.format=ssh` and `gpg.ssh.program=/opt/1Password/op-ssh-sign`, so
  `git commit` fails with *1Password: Could not connect to socket* and the `gh`-token push
  workaround above does not help — there is no commit to push. Starting and unlocking the app fixes
  signing, fetch and push together, and it is the owner's to do. **Confirmed on 2026-08-31:** the
  owner started the app, `ssh-add -l` against `~/.1password/agent.sock` listed the keys, and fetch,
  signing and push all worked with no other change. **It recurred identically on 2026-09-01** — no
  process, the socket stale from the previous morning — making it three sessions running, so treat
  the probe as the **first act of a session**, before reading any state a stale `main` would make
  wrong. It was started again later on 2026-09-01: signing and push both worked for the handoff
  commits that afternoon, so the pattern is "broken at the start of every session, fixed by the
  owner once asked" rather than anything intermittent.
- **A clone on this machine may still point at GitHub, and the two histories are unrelated.** Found
  on 2026-09-02: the working copy at `/home/dion/Projects/work-dashboard` still had `origin` on
  `git@github.com:dgerrese/work-dashboard.git`, so every `gh` and `git fetch` had been failing or
  answering from stale refs. Repointing it revealed the important part — **the Codeberg repository
  was re-imported, not mirrored.** `git merge-base main origin/main` returns nothing: local root
  `ab6624d` against remote root `f3849e1`, 139 commits against 324, sharing none. **A stale clone
  cannot be rebased or fast-forwarded onto the new remote; it can only be replaced**, with
  `git checkout -B main origin/main`. Anything that reads "behind by N commits" here is meaningless.
- **Codeberg's SSH host keys were not in `known_hosts`**, so git over SSH failed with
  `Host key verification failed` and an `ssh_askpass` error that hides the real cause. All three
  fingerprints from `ssh-keyscan codeberg.org` were checked against the published list at
  `docs.codeberg.org/security/ssh-fingerprint/` and matched exactly before being added
  (ED25519 `SHA256:mIlxA9k46MmM6qdJOdMnAQpzGxF4WIVVL+fj+wZbw0g`). Verify rather than
  `StrictHostKeyChecking=accept-new`; the check costs one command.
- **The remote here is named `origin`, not `codeberg`.** The `eod` skill's survey and push commands
  are written against a remote called `codeberg`, so they silently find nothing on this machine —
  `git rev-list --count codeberg/main..$b` fails outright. Either rename the remote or generalise
  the skill; until then, translate the commands. Recorded 2026-09-02 after running the skill.
- **A `.env` carried across the rename will be silently wrong.** Config is validated at boot, so a
  file still holding `WD_SECRET_KEY`, `WD_TIMEZONE` and `WD_PORT` stops the server rather than
  half-working. `sed -i 's/^WD_/THAT_/' .env` is the fix, and **the values must be preserved** —
  `SECRET_KEY` is what decrypts the sealed Jira tokens already in the database, so a freshly
  generated key orphans them with no error.
- **`docker compose ps` fails bare, by design.** `required variable THAT_UID is missing` is not a
  broken checkout: `make` fills `THAT_UID`/`THAT_GID` from `id -u`/`id -g`, and `.env.example`
  states there is deliberately no default because guessing wrong dies later with EACCES. Drive
  Compose through `make`, or set the two variables in `.env` as that file describes.
