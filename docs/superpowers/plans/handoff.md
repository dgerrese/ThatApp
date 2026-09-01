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

**Verified on 2026-09-01.** This ledger is the authority on status; the narrative further down is
history and says otherwise in places.

> **The forge changed on 2026-09-01.** Issue and pull-request numbers below were verified against
> GitHub and then carried to Codeberg deliberately unchanged — see *Decisions taken*. Everything
> before that date happened on GitHub; the numbers still resolve.

**Closed and merged:** #1, #2, #3, #4, #5, #6, #7, #9, #12, #16, #29, #30, #44, #73 — none carries a
`status/*` label any more, by the rule set on 2026-08-20. #5 as PR #38 on 2026-08-20, #6 and #44 on
2026-08-21, #7 as PR #65 on 2026-08-27, #12 as PR #68 on 2026-08-28, #73 as PR #75 and #9 as PR #76.
**In progress: nothing** — no `issue-*` branch is cut. The two open pull requests carry no ticket
between them: **#78** (`retro-skill`) and this handoff branch when it goes out. **To do:** #8, #10,
#11 and #51. **Needs refinement:** #13 (LAN/HTTPS phone access — deferred, and needs the owner's explicit
go-ahead even to refine), #19, #35, #39, #40, #47, #61 and #80. **Intake, fourteen, every one the owner's
to approve or decline:** #41, #42, #43, #53, #55, #56, #57, #58, #59, #66, #67, #71, #74, #79. **Closed as
not planned:** #21, #22 — folded into #4, not rejected; both labelled `wontfix`.

**#8, #10 and #11 are the whole remaining product**, and none of them has a design yet.

### Two things needing the owner

~~**The superpowers skills are not installed on this machine.**~~ **Wrong as of 2026-09-01**, and
the item is retired. The plugin is installed at
`~/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0/` and its skills load normally;
`~/.claude/skills` being empty is not where a plugin lives, which is what the original check got
wrong. The half of the item about #7's whole-branch review is moot — #7 merged on 2026-08-27.

- **#43 (`-race`) cannot be done as written.** `go test -race` fails in the app image outright:
  `CGO_ENABLED=0` and no C compiler, so it reports `-race requires cgo`. The image has to change
  first. Separately, **`-race` would not have caught #7's lost update**, which is across SQL
  statements rather than shared memory — so #43 should not be treated as covering that class at all.
  Worth a comment on the issue; not yet posted.

- **The Jira API token cannot write worklogs, so no push can succeed.** Found 2026-09-01 by running
  a real push. Reads are fine — the connection test returns the right account and assigned issues
  list — but `POST /rest/api/3/issue/{key}/worklog` comes back `401
  {"code":401,"message":"Unauthorized; scope does not match"}`. The token carries read scope and not
  whatever a worklog write needs. **Only the owner can fix it**: remint the token in Atlassian with
  write scope and re-enter it in Settings. Until then, treat any push failure on this instance as
  this, not as a new bug — and note that #8, #10 and #11 cannot be verified against a real push
  either. The exact scope or token type required was never established, only that a read-capable
  token was refused; #80 turns on settling that.

### What gated what — every gate below is discharged

**Nothing here still blocks anything**, as of 2026-09-01: #4, #5, #6, #7, #29 and #44 are all
merged. It is kept because the *reasons* explain why parts of the codebase look the way they do.
The one live item this section used to carry — do not implement #19 from its current state — moved
to *Still open*.

- **#5–#12 are unblocked.** #4 put the split URL columns, `internal/atlassian`, `jira.Client.Myself`,
  the JSON error envelope, `api.ts`, the router and the first `that-*` components on `main`, which is
  what every one of them builds on. Branch from `origin/main`.
- **#5 needs the site URL for issue links**, which is why the two-URL split had to land first.
- **#5 hands #6 a layout question and #7 a deadline.** Both come from #5's design and are recorded
  here so they are found rather than rediscovered. **#6:** pinned issues span instances, and the
  card-per-instance layout has no place for them; #5 deliberately does not pre-empt the answer beyond
  keeping `that-ticket-row` free of anything instance-specific. **#7:** Today re-renders wholesale, and
  that was right for #5 because it holds no typed input and no per-row in-flight state — but the
  moment a row carries a duration field the user types into, a wholesale re-render discards input
  mid-typing, which is the exact bug #29 paid to fix in Settings. #7 must revisit it before shipping
  a typed field, not after.
- **#44 gated #6 and #7 and no longer does.** PR #52 merged on 2026-08-21, so the design tokens,
  the `that-*` components, the rail shell and the self-hosted typeface are all on `main`. Branch from
  `origin/main`.
- **#29 owned the parked re-render finding below**, and PR #34 closes three of the *Carried out of
  #4* findings as a consequence: the detached-DOM connection test, the Add form losing typed input on
  a Remove, and a failed initial load rendering no controls.
- **#29 gated #6 and no longer does.** Until time entry ships the cascade destroys nothing; after
  it, the confirmation is all that stands between a stray click and lost logged time. PR #34 landed,
  so #6 is clear on this front.

### Carried out of #4 — findings deliberately not fixed there

The whole-branch review triaged these as acceptable to ship. **The SDD ledger that held them is
deleted, so this is the only record.** None is a regression; each was inherited from the plan's own
code rather than introduced by an implementer.

- ~~**The Settings view re-renders by `container.replaceChildren()` on every mutation.**~~ **Fixed in
  #29 (PR #34).** `render()` now builds three persistent regions threaded through a `Regions` object,
  and `refresh()` reconciles the list by `instance.id`. Both consequences are closed and covered:
  typed Add-form input survives a Remove, and an in-flight connection test no longer writes into
  detached DOM. Edit mode gained the Cancel affordance in the same change, which is why patching the
  two symptoms individually was refused.
- ~~**A failed initial load renders no controls at all**~~ **Fixed in #29 (PR #34)**, and now carries
  the regression test it lacked — it was the only one of the design's three named outcomes without
  one.
- **`internal/server/instances.go` is 360 lines** as of 2026-09-01, grown across Tasks 6–8 and since.
  Three reviewers judged a split unwarranted: it is one cohesive resource, and splitting would
  scatter `decodeInstanceRequest` and `verifyJiraCredentials` away from their only two callers. **The
  trigger this finding named did not fire** — #5's issue routes landed in `issues.go` (109 lines),
  not here — so the file grew for other reasons and the judgement still stands. Re-measure before
  citing this number.
- **`NormalizeSiteURL` (`internal/atlassian/tenant.go:38`) does not case-fold the host**, so
  `https://Example.atlassian.net` and `https://example.atlassian.net` persist as different strings for
  the same site. Harmless until something keys on the stored value.
- **`web/src/router.ts` swallows a rejected dynamic `import()`.** A stale chunk hash after a redeploy,
  or being offline, leaves the previous view on screen with no indication. **This gets worse at #12**,
  when a service worker starts serving stale chunks.
- **No request body size limit** on `json.NewDecoder(r.Body).Decode(...)`. Bounded risk on a
  localhost-bound single-user server, but these are the repo's first mutating endpoints, so they set
  the precedent.
- **The API has no authentication and no CSRF defence**, so a cross-origin
  `<form enctype="text/plain">` can reach `POST /api/instances`. The design of record excludes app
  auth from v1 and binds to localhost, deferring it to #13 — **not a #4 defect**. Rejecting mutating
  requests whose `Content-Type` is not `application/json` would close the form vector for free and is
  worth a line in #13's scope.

Repo hygiene, no ticket needed under `CLAUDE.md`: **`web/build.mjs` never cleans `dist/` and there is
no `.dockerignore`.** See *Facts worth not rediscovering*.

### How things got here — narrative, frozen 2026-08-21

**Everything below this line is a record, not a status.** It accumulated between 2026-08-14 and
2026-08-21 and was deliberately not rewritten as tickets moved on, so it still calls #5 "in review",
#44 and #6 `status/todo`, and #7 undesigned. The ledger at the top of this section is what is true.
Read this for *why* a thing is the way it is; never for *where* it stands. The rules it produced
that outlive it have been promoted into *Decisions taken* and *Facts worth not rediscovering*.

**Merged:** #1 scaffolding (containerised Go + vanilla-TS skeleton, config validation, HTTP server,
build-tagged asset FS, esbuild + Tailwind v4, golangci-lint v2 + ESLint 9, CI) · #2 `internal/store`
(design at `docs/superpowers/specs/2026-08-07-store-design.md`) · #16 the Playwright rig
(`.claude/e2e/`, `make test-e2e`, `.github/workflows/e2e.yml`) · #3 the Jira client, as PR #20 on
2026-08-12 — `internal/jira`: `crypto.Sealer` AES-GCM token sealing, client transport with basic
auth and mapped sentinel errors, `SearchAssigned` over `search/jql` with token paging, and worklog
create/update/delete with ADF comments. Its plan is
`docs/superpowers/plans/2026-08-10-jira-client.md`; the checkboxes were never ticked and there is no
SDD ledger for it. · #4 the Settings view, as PR #28 on 2026-08-14 — merge commit `b0aa3c5`, 26 commits, 35 files,
+6526/−87. All thirteen tasks ran under subagent-driven-development with a fresh implementer and a
task review each, then a whole-branch review on the most capable tier, one fix wave and a scoped
re-review. Its design is `docs/superpowers/specs/2026-08-12-settings-view-design.md` and its plan
`docs/superpowers/plans/2026-08-12-settings-view.md`. **Its SDD ledger was deleted** with the plan's
workspace, as that skill requires — everything from it worth keeping is in this document, chiefly
*Carried out of #4* and *Facts worth not rediscovering* below.

**Two tickets raised and approved on 2026-08-14; both were built on 2026-08-17:**

- **#30 Theme toggle: light, dark and auto — merged**, as PR #32 on 2026-08-17. Refined, planned and
  executed through subagent-driven-development in one session: four tasks, a task review each, a
  whole-branch review on the most capable tier, one fix wave and a scoped re-review. Design
  `docs/superpowers/specs/2026-08-14-theme-toggle-design.md`, plan
  `docs/superpowers/plans/2026-08-17-theme-toggle.md`. `make verify` green and 30/30 e2e on Firefox
  and Chromium. Shell 797 -> 1314 bytes. **Its SDD workspace was deleted on completion**, as that
  skill requires.
- **#29 Confirm before removing a Jira instance — merged**, as PR #34 on 2026-08-17; the owner
  confirmed the merge on 2026-08-20, which closed it.
  Brainstormed, planned and executed the same day: three tasks, a task review each, a whole-branch
  review on the most capable tier, one fix wave and a scoped re-review, then a by-eye check of the
  dialog in both browsers and both themes. Design
  `docs/superpowers/specs/2026-08-17-confirm-instance-removal-design.md`, plan
  `docs/superpowers/plans/2026-08-17-confirm-instance-removal.md`. `make verify` green and 52/52
  e2e, both re-run after the rebase onto `main`. **Its SDD workspace was deleted on completion** —
  what is worth keeping from it is *Carried out of #4* below and the new entries in *Facts worth not
  rediscovering*.

**#5 Assigned issues — built and in review**, as PR #38 on 2026-08-20. Brainstormed and approved on
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

**The order was #30 → #29 → #5**, decided by the owner on 2026-08-17. All three are behind us;
**#6–#12 are the whole remaining product.**

- **#30 before #5** because only the Settings view existed, so the retrofit was thirty-three utility
  usages across six files; each of #5–#12 adds a view that would otherwise have been written against
  hardcoded light colours and needed retrofitting afterwards.
- **#30 before #29** so `that-confirm` was written against the semantic tokens once instead of in stock
  utilities and then again in #30's retrofit. It kept #30's retrofit table at six files, and #29
  still landed well before #6, which is its only hard deadline.

**#29's scope was widened deliberately**, also on 2026-08-17: it absorbed #4's parked
`replaceChildren` re-render finding, replacing the wholesale re-render with keyed row reconciliation
and giving edit mode the Cancel it lacked. Both changes touch the same lines of
`web/src/views/settings.ts`, and the alternative was opening that file twice. The dialog's warning is
**static** — no counts of what removal destroys, so no counts endpoint and no server change in the
ticket; counts are a later intake, worth raising once #6 makes them non-zero.

**#30's design gained a row on 2026-08-17.** `web/src/router.ts` carries `text-neutral-600` and
`text-blue-700` in its placeholder view and the retrofit table omitted the file, so the spec's final
criterion — no stock colour utility left in `web/src/` — could not have been met as written. Fixed as
`9166c78` on `issue-30-theme-toggle`, along with the count (thirty-three across six files, not
twenty-eight).

The whole-branch review of #3 produced three new tickets rather than in-branch fixes: #19, #21 and
#22. **#21 and #22 were folded into #4 on 2026-08-12** and closed as not planned; #19 stands
alone.


**#6 was moved to `status/todo` on 2026-08-20** at the owner's word. It had been carrying
`status/in-progress` with no `issue-6-*` branch behind it, which the branch-existence rule makes
wrong. **Its design document is still missing**: `docs/superpowers/specs/2026-08-20-pinned-issues-design.md`,
cited by the issue body and the owner's comment, has never existed on any branch. The acceptance
criteria stand on their own; the document behind them would have to be written from the two design
sources below.

**#6's design sources are now in the repo** at `docs/superpowers/canvas/2026-08-20-pin-flow/`,
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

**#44 A visual design language for the app — refined on 2026-08-20**, `status/todo`. Its body now
carries full acceptance criteria. Two things the canvas left open were settled with the owner during
refinement, and neither is to be reopened:

1. **The rail ships in #44, in its resting state.** Its regions are built and styled there; #7–#9
   make them live. The Today card layout is deliberately *not* reworked in #44 — #6 opens
   `today.ts` next and the two would collide.
2. **Per-instance hues stay and gain a rule.** The Hybrid board ended on "OPEN: whether the
   per-instance hues earn their place", and the canvas only ever drew two instances. They stay,
   because #6 identifies a pinned row's instance by coloured dot alone, and they now have a ramp at
   constant lightness and chroma that cycles rather than running out.

**Two findings from the pin restyle change #44's work.** Both were hit by building against the
language rather than reasoning about it:

- **`var()` inside an inherited custom property fails silently.**
  `--instance: light-dark(oklch(0.60 0.13 var(--h)), …)` declared on `:root` resolves its `var(--h)`
  where the property is *declared*, not where it is used — so it computes to guaranteed-invalid at
  `:root`, where `--h` does not exist, and every dot renders transparent with no error in the
  console. The hue must go in the `background` declaration on the element itself. #44 builds
  per-instance hues and will meet this.
- **Space Grotesk is one variable woff2 covering weights 400–700, 22kB** — Google serves the same
  file for 400, 500 and 700. #44's criteria say "weights 400, 500 and 700", which is satisfied by a
  single file rather than the three static ones the wording implies.

Two further refinement decisions, neither changing the design: **Space Grotesk is self-hosted**
(the boards load it from Google Fonts, which #12's offline PWA and the Docker deployment both rule
out), and **`light-dark()` stays** — the canvas expresses light and dark as two `data-mode` blocks,
while this app resolves them against `color-scheme`, which is what makes the auto state work without
JavaScript, so canvas values are translated into pairs rather than copied as blocks.

**#44 was built on 2026-08-20** on `issue-44-visual-design-language`, in seven tasks: the spec, the
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

**#51 was raised on 2026-08-20 at the owner's request** — a frontend unit test runner, at
`status/needs-refinement`. There is none in the repo: `web/package.json` carries no test dependency
and the only frontend tests are the Playwright specs. #44 lands a **deliberately rudimentary**
`format.test.ts` under `node:test`, scoped out of tsc and eslint rather than adding `@types/node` or
setting `allowImportingTsExtensions`, and **not** wired into `make verify` — choosing that gate is
#51's decision. #51 should absorb the file.

**One follow-up is open:** `docs/superpowers/canvas/2026-08-20-pin-flow/pinning-in-hybrid.html` uses
`ink-faint` for card headings and hint text, which #44 establishes is wrong. It is a docs file, so it
was left for its own change — but #6 implements from it.

**#44 needed four rounds of fixes after it was built, and every one came from using the app rather
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
it links or not. A permanent magenta sat on exactly the element #8 and #9 must tint running-green and
failed-red, so state would have competed with decoration. The link declares itself by darkening to
full ink on hover instead, which also stops linked and unlinked keys differing by hue alone.

**A stale bundle can survive a rebuild, and did.** `/app.js` is unhashed and cacheable while
`build.mjs` never cleans `dist/`, so a cached `app.js` keeps resolving to old content-hashed chunks
that were never removed — a fix measured as "not working" was working, and the browser was running
code from before it. **Hard-reload before believing a frontend measurement.** Adjacent to intake #40.

**#53 was raised on 2026-08-20**, `status/intake`: the phone layout is designed on
`Mobile.dc.html` / `MobileSheet.dc.html` and specified in #44's spec, and **no ticket builds it**.
**#13 is not that ticket** — it is TLS, app-level authentication and getting a CA onto the phone, and
its own body says it delivers no new app features. #13 makes the dashboard reachable from a phone; it
does not make it usable on one. Until #53 is decided, a phone-layout defect has no ticket to be filed
against, and what ships today below `md` is the desktop layout stacked, not the designed layout.

**The pin restyle now contradicts the spec in two places** and #6 implements from it:
`docs/superpowers/canvas/2026-08-20-pin-flow/pinning-in-hybrid.html` uses `ink-faint` for headings and
hint text, which fails the 4.5:1 text floor, and magenta issue keys, which are now reserved for state.
It is a docs file, so it was left for its own change rather than folded into #44.

**#44 must land before #6 and #7.** That is the #30-before-#5 argument again: each of #6–#12 adds a
view that would otherwise be written against the old vocabulary and need retrofitting.

**#44 merged on 2026-08-21**, as PR #52 — the owner's word, with all three checks green (verify, e2e
74/74 across Firefox and Chromium, and the review workflow). The issue closed `COMPLETED` still
carrying `status/in-progress`, which the new rule forbids, so **the label was removed by hand**: a
merge closes the issue but does not strip its status label, and nothing does it automatically. The
2026-08-20 handoff went out in the same batch as PR #54.

**#6 is the whole board now.** It is `status/todo` with a design, a plan and no implementation, and
the gate that stood in front of it is gone: #44 landed the vocabulary its Pinned card is drawn in,
and #5 landed the Today view it hangs off.

**#6 merged on 2026-08-21**, as PR #60 (merge commit `47ed5c3`) — the owner's word. Built the same day on `issue-6-pinned-issues`, all eleven tasks through
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

**Six defects were found in plan-supplied material during #6**, every one an assertion aimed at the
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
rewrote 68 lines of a spec file during #6 and had to be reverted. It will recur every time an agent
formats from there. A config file in `.claude/e2e/` closes it permanently; it is a project-design
change and needs no ticket.

**#6's refresh fan-out is per-instance and serial within an instance**, under one shared 15s budget.
The spec says "one goroutine per pin" *and* "clients are resolved per instance"; the implementation
satisfied the second by abandoning the first, which is a defensible reading and is what keeps
`forInstance`'s first-use `api_base_url` repair from running twice concurrently on one row. It means
N pins on one site share one budget serially. Fine at single-user pin counts — recorded so it is a
decision rather than a drift.

**Two design divergences were found by the owner looking at the built UI on 2026-08-21, and neither
gate could have caught either.** This is #44's lesson again — four of its fix rounds came from using
the app rather than from `verify` or the e2e suite — and it now has a specific shape worth naming.

1. **The pinned row printed the instance name where the approved restyle says coloured dot alone.**
   Fixed on the branch as `6115291`/`7aca5c8`: the spec was corrected first, `instancePosition` was
   added to the pin and search DTOs, and `paintInstanceDot` — built by #44 *for this*, and dead code
   on `main` until now — finally has a caller. Search results keep the name beside the dot, which is
   the restyle's deliberate exception for rows you have not seen before.
2. **An instance's name sits inside its card where the Hybrid board draws it above**, beside its dot
   with the day total opposite. Raised as **#61**, `status/needs-refinement`, because it is not #6's
   defect: #5 built the card, #44 deliberately deferred the Today layout rework ("#6 opens
   `today.ts` next and the two would collide"), and #6's scope never included the assigned card. It
   fell between the three.

**The rule that would have caught both:** every review on this branch compared *code against spec*,
and the spec was where both errors already were — #6's design document described the row from the
older prototype, diagram included. **A spec written from approved design sources has to be diffed
against those sources before it becomes the binding authority.** Doing that once, at the start,
costs minutes; both of these cost a rebuilt component after the ticket was declared finished.

**#7 is designed and awaiting the owner's review of its spec.** Branch `issue-7-manual-time-entry`,
cut from `origin/main` after #60 merged and pushed; `status/in-progress`; one commit, `be4a3f6`,
holding `docs/superpowers/specs/2026-08-21-manual-time-entry-design.md`. **No implementation has
started, and the plan is not written** — the next action is the owner's read of the spec, then
`superpowers:writing-plans`.

**Eight decisions came out of its brainstorm on 2026-08-21, and one of them is a standing rule:**

- **Every destructive action confirms.** Deleting a time entry destroys a record of work, so it goes
  through `that-confirm`. #6 argued the opposite for Unpin and was right there for the opposite
  reason — unpinning destroys nothing. This binds #10's worklog deletion too, and it is not to be
  re-argued from the Unpin precedent.
- **The dialog is the only manual way to add time**, with the timer (#8) the other. M4's dialog
  wins; M1's row-opens-in-place and M2's popover are superseded, and **M3's type-into-the-row fast
  path is dropped at the owner's word**.
- **The duration control is a glued stepper you type into**, always landing on a quarter hour. This
  is the one place the ticket beat the boards: #7's "picker-style, not a free-text field" criterion
  stands and the boards' plain `00:00` field gives way. The parse rule is a table in the spec —
  `300` is 3h, `1100` is 11h, and `7` is 0h 15m rather than zero, which looks like a bug until you
  know rounding to nearest gives nothing.
- **`started_at` is never edited** — the start time does not matter in practice — so `PATCH` carries
  `seconds` and `comment` only, and the design of record's line 238 is corrected by this ticket.
- **The rail owns its own data**, fetching today's entries and re-rendering on an `entries-changed`
  event, so it stays right on Settings and on #11's week view. #44's table assigns it both the 46px
  total and the per-instance split — scope #7's issue body does not currently mention.
- **The API must not enforce the 15-minute grid**, because #8's timer will produce 7m13s. A test
  pins that so the tightening fails a gate rather than the next ticket.

**Three of #7's acceptance criteria changed meaning** and the issue body still needs editing to
match the spec — deliberately left until the owner approves it.

**The picker was designed in the browser, and the method is worth repeating.** Four interactive
variants were served from the scratchpad on a throwaway local server, in the app's own tokens and
typeface, each showing the integer it would post. The owner picked one, asked for two changes, and
both were live in the next reload. It took three rounds to settle a control that a written
description would have got wrong — and the two divergences found earlier the same day were both
things nobody could see until they were built.

**Five intakes came out of #6**, all the owner's to approve or decline: #55 (two `{id}` routes answer
differently for a malformed id, and #7's `/api/entries/{id}` is the third with no convention
recorded), #56 (`settings.spec.ts` flakes under load — seen twice, clean in isolation, not #6's
doing), #57 (three named gaps in the pins handler tests), #58 (`that-combobox` breaks if a second one
ever exists), #59 (the pin flow's canvas source contradicts #44's spec). #43 gained a comment arguing
its priority is now higher: #6 added the second by-index concurrent write site and #9's push will be
the third.

## Decisions taken — do not reopen

**The forge is Codeberg, and the project is called ThatApp.** Moved on 2026-09-01 from
`github.com/dgerrese/work-dashboard` to `codeberg.org/DionGerrese/ThatApp`. The GitHub repository is
kept **private and archived** — it is not the authority on anything, and nothing should be pushed to
it. Full narrative in `handoff/2026-09-01.md`; four things must not be rediscovered:

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
forbidden" and written into `CLAUDE.md`'s hard constraints and the `ticket-workflow` skill as PR #33.
A branch reaches `main` through a pull request the owner merges and no other way — green, approved,
one line or a typo makes no difference. It needed writing down because
`superpowers:finishing-a-development-branch` prints "merge back to main locally" as option 1 of a
fixed menu, and nothing in the repo contradicted it, so that menu got presented. The skill now says
to offer the other two options and explain the missing one.


**Never write current state into a GitHub issue or pull request body.** The owner's rule, given
2026-08-14: no "this ticket is in flight", "awaiting review", "not yet estimated", "PR #27 is
stale". State changes constantly and prose does not update itself, so every stateful sentence
becomes a lie somebody has to hunt down. The `status/*` label is already the single source of truth.
**Dependencies and blockers are the exception and should still be written** — "blocked by #29",
"must land before #6 ships time entry", "supersedes #21" — because they describe the work rather
than the moment. Existing bodies were swept on 2026-08-14. **This document is the deliberate
exception**: it exists to hold current state and is meant to be rewritten as state changes. Worth
promoting into `CLAUDE.md` in a future process pull request.

**#30's design settled four things.** All in
`docs/superpowers/specs/2026-08-14-theme-toggle-design.md`; recorded here so they are not reopened
from the ticket body alone:

1. **The preference lives in `localStorage`, per browser.** No schema change, no API, and
   `index.html` stays a static embedded asset. The phone in #13 gets its own setting.
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

**#5's design settled four things**, all in
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

**#5 leaves two costs to later tickets, written into its spec rather than solved.** #6's pinned issues
span instances and the card-per-instance layout has nowhere to put them — #6 decides that. And **#7
must revisit Today's wholesale re-render**: it is deliberate while no row holds user input, and it
becomes exactly the bug #29 paid to fix the moment a duration field lands in a row.

**Jira must be reached through the API gateway.** Basic auth with an API token fails against the
site host (`https://<site>.atlassian.net`) with a 401 and succeeds against
`https://api.atlassian.com/ex/jira/{cloudId}`. Whether the cause is a scoped token or an org policy
was never established — only that the gateway works and the site host does not. The cloud id is
readable without auth from `https://<site>/_edge/tenant_info`, so the settings form can still ask
for just the site URL. **It fails silently:** `POST /rest/api/3/search/jql` answers an
unauthenticated caller with `200 {"issues":[]}` rather than a 401, so a search that returns nothing
is indistinguishable from one that worked. A connection test must assert identity via
`GET /rest/api/3/myself` (now part of #4).

**#4 carries four refinement decisions.** Settled 2026-08-12 when #21 and #22 were folded in, and
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
exclusion also means `make verify` passes while it is broken** — #4's Task 1 changed the store API
underneath it and had to fix it by hand, checked with `go vet ./internal/jira/_smoke/`. Any later
change to `store` or `jira` must do the same.

**#4's brainstorm settled four more things, all in its design document.** Recorded here so they are
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
4. **The router lands in #4**, not #5, because `handleAsset` already falls back to the app shell for
   client-side routes — the shell was promising routing that did not exist. Only the components the
   settings form needs are built; `that-ticket-row`, `that-timer` and `that-time-entry` belong to #5–#8.

**Browser support is Firefox and Chromium.** Firefox is primary. **Safari and WebKit are an
explicit non-goal** — do not raise them as a coverage gap, do not add WebKit to the Playwright
matrix. It also settles #13: the phone is Android, so a locally-trusted certificate only needs
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
issue had an open PR saying `Closes #5`. The labels were describing GitHub back to itself. The
outcome — status for open work, GitHub state for closed — is a cleaner invariant than the one it
replaced, not merely a smaller set.

**`ready` was renamed `todo` for parity, not taste.** It had been the one deliberate divergence from
the other repo's naming; renaming closes it. `refinement` became `needs-refinement` in the same pass,
because the ticket has been promoted out of intake but *not* yet refined — which is what #13 and #19
have actually been doing since 2026-08-14.

**Declining an intake is now: close as `NOT_PLANNED`, label `wontfix`.** The stock label was kept
for exactly this and its description rewritten to say so.

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
plan. #5 was the case that made the gap visible: designed, planned, branch pushed, and
indistinguishable from #6–#12, which nobody had opened. Colour `#5319E7`, description "Branch cut.
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

**#9 will skip e2e** under the `paths:` filter in `.github/workflows/e2e.yml`, because it changes
handlers the UI depends on without touching frontend files. The owner accepted this knowingly; their
UI needs checking by hand. Do not re-raise it as a hole in the gate.

**This used to say "#5 and #9", and that was wrong about #5.** #5 added `web/src/views/today.ts` and
`web/src/components/that-ticket-row.ts`, so the `paths:` gate fires for it and always would have. The
gate needed no change; the note did. Corrected 2026-08-20 — #5's own design document had flagged the
correction as part of that ticket, but `CLAUDE.md` puts project-design documents in their own pull
request, so it landed here instead of in PR #38.

**The visual design is settled, and its sources are now in the repo** at
`docs/superpowers/canvas/2026-08-20-visual-directions/` — 25 artboards over five pages plus the 27
annotations that carry the reasoning, worked out with the owner on 2026-08-20 and approved board by
board. #44 turns it into a spec.

It was published only as an artifact
(<https://claude.ai/code/artifact/d1634bc1-ca6c-4b04-a1b9-bd35b3d69b57>), with the `.dc.html`
sources in a session scratchpad that does not persist — and `seed-canvas.mjs --extract`, the
recovery path this document used to name, had gone the same way, so the sole copy of an approved
design sat behind an authenticated URL with no working tool to read it back. Extracted on
2026-08-20; `docs/superpowers/canvas/extract_canvas.py` is the replacement and it lives in the repo.
**`Hybrid.dc.html` is the chosen direction** and carries the full light and dark `oklch` token set
that #44's `@theme` block comes from.

What the boards settle, none of it to be redesigned during #44's refinement:

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

The six below were produced by #44, #6 and #7 and lived only in the frozen narrative until
2026-09-01. They bind later tickets, so they belong here.

- **Every `that-*` custom event carries the `that-` prefix** — `that-search`, `that-select`, `that-cancel`. A
  component that dispatched a bare `select` collided with the native text-selection `select`, which
  bubbles through light DOM to the same listener; Firefox's `fill()` fires it and the handler
  crashed on `undefined.instanceId`. Shadow DOM would contain it and shadow DOM is forbidden here so
  Tailwind can reach component internals. This is a rule for the whole family, not a fix for one
  component.
- **Every destructive action confirms, through `that-confirm`.** Deleting a time entry destroys a
  record of work. #6 argued the opposite for Unpin and was right for the opposite reason — unpinning
  destroys nothing. **This binds #10's worklog deletion, and is not to be re-argued from the Unpin
  precedent.**
- **A row key never wears the primary.** It is `ink-muted` whether it links or not, settled by the
  owner on 2026-08-20. A permanent magenta sat on exactly the element #8 and #9 must tint
  running-green and failed-red, so state would have competed with decoration. The link declares
  itself by darkening to full ink on hover, which also stops linked and unlinked keys differing by
  hue alone.
- **Plans are drafted, not verified.** #6 found six defects in plan-supplied test code, every one an
  assertion aimed at the wrong observable. The working rule: write the plan's test, then ask whether
  it would fail if the code it guards were wrong — and treat "no" as a defect to fix rather than
  scope to defend. This is also why plans are drafted in #44's light format rather than carrying
  thousands of lines of unverified Go.
- **A spec written from approved design sources is diffed against those sources before it becomes
  binding.** Every review on #6's branch compared code against spec, and the spec was where both of
  the owner's divergences already were. Doing the diff once, at the start, costs minutes; both of
  these cost a rebuilt component after the ticket was declared finished. #7 did this and it caught
  four gaps.
- **#6's refresh fan-out is per-instance and serial within an instance**, under one shared 15s
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
  shape is the same tell #6's review named.
- **A frozen clock cannot detect "reads the clock twice"** — it returns the same value both times.
  Proving one instant needs a clock that advances per call.
- **Two of task 3's findings came from reading `pins.go`, not from mutation.** PATCH was committing
  its write before reading the instances, contradicting a rule `handleCreatePin` states in prose;
  and PATCH validated the duration before reading the entry, so a bad duration on a missing id
  reported the duration where POST reports the unknown instance. **Neither ordering was pinned by a
  test, and mutation could not have found either** — only comparing the code against its own
  siblings' documented conventions did.

### Decisions taken during #7's Go side, not to be reopened

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
  browser drives this app. Recorded in `handleUpdateEntry`'s comment. **#8 is where it stops being
  hypothetical** — a timer PATCHing `seconds` while the foot form holds an open comment is exactly
  this interleaving — and that ticket decides what to do about it.
- **`UpdateEntry` moves `updated_at` on every call including a no-op**, marking a clean pushed entry
  dirty so #9 re-pushes it. Deliberate: the push is idempotent, and one redundant request is cheaper
  than diffing the row.
- **The seconds range is enforced on `PATCH` as well as `POST`.** The spec writes the rule only
  under POST; leaving PATCH open would let a browser set an entry to forty hours through the back
  door.
- **`newServerWithStore` has fifty-three callers across six test files**, so a helper needing the
  store's path duplicates its setup rather than changing that signature. Recorded in the helper's
  own comment, because the next reader will otherwise try the dedup and discover the cost the hard
  way.

### Decisions taken during #9, not to be reopened

- **Push state is derived, with one implementation and one construction site.** `pushStateOf` is the
  only deriver; `entryDTOFrom` is the only place an `entryDTO` is built, so no response can omit it.
  Nothing on the browser side recomputes it — `worklogId` and `pushedAt` are not even on the
  TypeScript `Entry`, which is what stops a second implementation appearing.
- **`MarkEntryPushed` names only `worklog_id` and `pushed_at`.** Stamping `updated_at` there would
  race its own `pushed_at` and could mark a freshly pushed entry dirty. A test asserts `updated_at`
  is unchanged, and a plausible "just reuse `UpdateEntry`" refactor would fail it.
- **`dirty` is reported, not repaired.** #7's edit stamps `updated_at`, so an edited pushed entry is
  reachable today. #9 reports it honestly and skips it; the `PUT` is #10's.
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
  `timers`. Verified on `modernc.org/sqlite`, not reasoned about — the child row was gone. #4's
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
`index.html` needs no change. **Done in #4's Task 9, and verified empirically:** `dist/app.js` is 955
bytes and references `import("./chunk-*.js")`, with the settings view's strings in the chunk.

**`make verify` does not run Playwright.** It is lint + tsc + `go test ./...`; e2e is a separate
target and workflow. **A green `verify` can therefore sit on top of a red branch**, and did: #4's Task
10 removed the `/api/health` poller and `#status` from `index.html`, which broke the pre-existing
`smoke.spec.ts` assertion, while `verify` stayed green through several commits. Anything touching the
frontend needs both gates before it is called done.

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
500, which is #19's territory; the branch no longer leaks the raw Go error string, it logs
server-side and returns a fixed message.

**`that-button`'s `label` attribute is the sole source of its inner button's accessible name** — there
is no slot fallback, and the component's own interface docs omit it. A `that-button` built without
`label` renders a nameless button that role-based Playwright queries cannot find. The Settings view
funnels every one through a single `button(label, variant)` helper for this reason.

**`that-card` has no `observedAttributes`**, so its `heading` is not reactive, while `that-button` and
`that-alert` both are. Set a card's heading before insertion; changing it afterwards silently does
nothing.

**Tailwind v4 facts for #30, verified against `tailwindcss` v4.3.3 in the project container rather
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
#29's fix wave hit this: the instruction was to compare fields in `patchRow`, and the implementer
correctly refused, clearing the just-saved row's status by id inside `save()` instead.

**The e2e suite runs against the dev database, and #5 makes that dangerous.** `make test-e2e` starts
the same `app` service `make up` does, mounting the same `that-data` volume — so the browser suite talks
to a database holding real Jira instances with real sealed tokens. Nothing exercises it today because
every spec stubs the routes it needs, but **once `/` renders Today, a spec that navigates there
without stubbing `/api/issues` makes the server fan out to a real Jira site**, which breaks
`CLAUDE.md`'s rule that no test ever contacts one. #5's plan stubs it in every spec that reaches
Today; **#35 is the structural fix** (a throwaway database for the e2e profile). On CI the volume is
always fresh, so the exposure is local-only.

**`golang.org/x/sync` was not in `go.mod`** until #5, despite being on `CLAUDE.md`'s approved list.
The container reaches the proxy (checked 2026-08-17; v0.22.0 was current). Sequencing matters:
`go mod tidy` **removes** a module nothing imports yet, so `go get` then `tidy` in one breath deletes
the requirement it just added. Import it first, tidy after.

**The e2e suite stubs the backend.** `settings.spec.ts` intercepts `/api/instances`,
`/api/instances/*` (POST, PATCH, DELETE) and `/api/instances/*/test` with `page.route`, so **no
browser test exercises a real backend response** — the handlers have `httptest` coverage instead. A
wrong URL in `api.ts` would still be caught (it would miss the stub, hit the real server, 404 and fail
the spec). The PATCH stub was added in #29 after an implementer found that without it "Save changes"
fell through to the real backend, 502'd on an unreachable stub site URL, and **`save()` never reached
`refresh()` — so the test passed against the unfixed code too.** A route that is not stubbed does not
fail loudly; it fails by making the test vacuous.

**`addInstance()` in `settings.spec.ts` does not await its own round trip.** Interacting immediately
afterwards can land a `fill()` on a form that `save()` is about to reset, discarding the input. The
file's idiom for this is `await expect(page.getByText("<name>", { exact: true })).toBeVisible()`
between the setup and the behaviour under test. It bit two tests written in #29 (fixed there) and
**two pre-existing tests still carry the same latent pattern** — "a successful connection test names
the account" and "a rejected connection test reports the failure". Neither has flaked; both are worth
tidying when that file is next open.

**Two `exact: true` locators in `settings.spec.ts` are load-bearing — do not "tidy" them away.**
`getByText` matches substrings, so `getByText("Work")` collides with the shell's
`<h1>ThatApp</h1>`; and `getByRole("link", { name: "Settings" })` collides with the router
placeholder's "Open Settings" link, because `/` has no registered route and the placeholder is on
screen alongside the shell nav. Both are real Playwright strict-mode failures, not stylistic choices.

**#4's plan has one step that was deliberately not executed:** Task 13, Step 4, "update the handoff".
It was skipped because an open pull request already modified this file and `CLAUDE.md` requires
process documents to go in their own pull request, splitting any change that touches both. The plan's
unticked box is intentional, not an oversight.

**`web/build.mjs` writes into `dist/` before creating it.** `copyShell()` runs at top level and does
`copyFileSync("index.html", "dist/index.html")`; nothing creates the directory first. It works only
because `web/dist/.gitkeep` is tracked, so a fresh clone has the directory already. Two consequences:
`rm -rf dist && npm run build` — the obvious way to take a trustworthy byte measurement — throws, and
the existing repo-hygiene note below to add `rm -rf dist` *into* `build.mjs` would break the build
unless it also creates the directory. Raised as **#40**. Until it lands, measure with
`rm -rf dist && mkdir dist && npm run build`.

**`make verify` has no formatting gate.** It is eslint + tsc + `go test ./...`; nothing runs Prettier
in check mode. `web/src/views/settings.ts` currently carries formatting drift that `npm run fmt`
would rewrite, and `verify` stays green over it. Anything running `npm run fmt` while working on
another file will see that file appear in its diff — revert it rather than folding an unrelated
reformat into a ticket. Discovered during #5; no ticket raised, because whether to add a format check
is a judgement call rather than a defect.

**The e2e baseline, counted rather than assumed.** Before #5: `settings.spec.ts` 15, `smoke.spec.ts`
2, `theme.spec.ts` 9 — 26 per browser, 52 total. After #5: 35 per browser, 70 total. #5's plan
asserted 48 as the expected post-ticket total and would have tripped its own "a test was lost" guard
on a correct outcome, because it was written before #29 added 11 settings specs. **A plan that
asserts a test count must derive it from a count taken on the branch it will run on**, not from the
count that was true when it was written.

The nine below came out of #44 and #6 and lived only in the frozen narrative until 2026-09-01. Each
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
  to intake #40.
- **`.claude/e2e/` has no `.prettierrc.json`, and still does not as of 2026-09-01.**
  `web/.prettierrc.json` sets `printWidth: 100`, but prettier run from the e2e directory finds no
  config and reflows at its default 80 — it silently rewrote 68 lines of a spec file during #6 and
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
  network. It shipped in `main` as of PR #20, and it is what found #21 and #22.
- **An untracked file inside a directory another branch tracks is not necessarily an oversight.**
  The app-icon canvas page looked abandoned and was nearly "rescued"; in fact `issue-12-pwa-shell`
  tracked that directory *and* a `.gitignore` whose only line was that filename, because the page is
  a ~2MB generated rendering of artboards that are themselves tracked. Check for a `.gitignore` on
  the branch that owns the directory before calling a file undecided.

## Still open

Resolved bullets were retired from this section on 2026-09-01; what they were worth keeping for is
in *Facts worth not rediscovering* and in the day logs under `handoff/`. What is below is open.

**The one thing between here and a usable app:**

- **Re-add the Ridgeline instance before trusting #9 with a real day.** #9 is merged, but the push
  has never run against real Jira — every test and every by-eye check used an `httptest` server, a
  browser stub or a throwaway mock. The mechanism is proven; the round trip to a real site is not.
  #73 moved the database to a `./data` bind mount on 2026-08-31, so it survives `make down` and only
  has to be added once. **Basic auth fails silently on the site host: the instance must point at the
  API gateway.**
- **Then a real week of use, then #11.** The route to a usable app: the week of use above → #11 (the
  weekly rollup, the deadline the app exists to serve) → #10 (corrections after a push) → #8 (the
  timer). #8 is not a prerequisite for #9 despite the spec's ordering — manual entry already
  produces the entries a push sends.

**Waiting on the owner:**

- **The intake queue is thirteen and is the longest it has been:** #41, #42, #43, #53, #55, #56,
  #57, #58, #59, #66, #67, #71, #74. Approving or declining them is the owner's move alone, and
  **nothing has come off the queue since it was opened.**
- **Whether the owner's other repo mirrors this label set** is still unanswered, and the gap widened
  on 2026-08-20: this repo now has five statuses plus `bug`/`enhancement`/`wontfix`, having deleted
  `review`, `done` and `declined` and renamed two more. Ask before assuming the two still match.
- **Seven local branches are merged into `origin/main` and droppable** whenever the owner says so:
  `handoff-2026-08-17`, `handoff-2026-08-20`, `handoff-2026-08-27`, `handoff-2026-08-31`,
  `handoff-post-4`, `issue-12-pwa-shell`, `issue-9-end-of-day-push`. `worktrees-without-the-tax` is
  kept deliberately (see below); `retro-skill` is PR #78, open.

**Decided but not built:**

- **Worktrees without the Docker tax** —
  `docs/superpowers/plans/2026-08-10-worktrees-without-the-tax.md`, on its own branch. It makes
  worktrees cheap by pinning shared Compose volumes with a fixed `name:`; verified that `name:`
  produces an unprefixed volume while a sibling without it stays project-scoped. **The owner has
  chosen that one worktree per ticket becomes the default once this lands**, which flips the
  standing "branch in place" decision in `CLAUDE.md` and the `ticket-workflow` skill. Not
  implemented, and it has no issue.
- **Repo hygiene, no ticket needed:** a `.dockerignore` excluding `web/dist` and `web/node_modules`,
  and `rm -rf dist` in `web/build.mjs`. Together they make the image reproducible and future byte
  measurements trustworthy. Not started.
- **`.claude/e2e/` still has no `.prettierrc.json`** — see *Facts worth not rediscovering*. Also a
  project-design change needing no ticket, and it recurs every time an agent formats from that
  directory.

**Known defects and gaps, none blocking:**

- **Two things #9 left undone on purpose**, both in PR #76's body: an edit landing during an
  in-flight push can be lost (`pushMu` serialises pushes against each other, not against
  `PATCH /api/entries/{id}`; the window is seconds, and the guarded-update fix reaches into #10),
  and the new `store_failed` branch of the failure report has no test.
- **#74 is worth reading before the next frontend ticket.** `make fmt` rewrites seven
  already-committed files, because prettier is pinned as `^3.0.0` — a caret range now resolving to
  3.9.6 — and **no gate checks formatting**: `lint` is `eslint src` only, and `fmt` is write-only,
  never `--check`. The tree drifted from its own formatter with nothing to notice. It ambushed #9's
  fix wave, which had to format `today.ts` and revert the rest by hand.
- **The pin restyle still contradicts #44's spec** — raised as intake #59. #6 did *not* inherit
  either mistake: its plan was written in the corrected vocabulary, so nothing shipped wrong. The
  file remains a design source a later ticket would read as authoritative.
- **Enter does not submit the Settings form, and that is deliberate for now.** The form has four
  implicit-submission-blocking fields and no submit button — `that-button` renders
  `<button type="button">` — so per the HTML implicit-submission rules Enter does nothing. #4's fix
  wave removed the dead `submit` listener and corrected `that-button`'s docstring rather than wiring
  it up: the honest fix gives `that-button` a `type` attribute and swaps the click handler for a
  submit handler, and doing both in one fix wave with a single re-review risks a double-submit.
  Worth a follow-up.
- **A flake worth watching:** `pwa.spec.ts:322` (service-worker offline navigation) failed once
  during a full e2e run on 2026-08-31, then passed in isolation and on a full re-run. It touches
  nothing #9 changed. **If it recurs, it is real.**

**Before planning the next ticket:**

- **#51 is `status/todo`, refined and unblocked**, and its branch has not been cut. It is the only
  ready ticket with a settled design; #8, #10 and #11 still have none.
- **#8's markup is already reserved.** `web/index.html` carries `#rail-timer` with
  `<!-- #8 makes this the running timer. -->`, exactly as it carried `#rail-push` for #9 — which the
  #9 plan missed and paid for late. **Open `web/index.html` before planning #8.**
- **#35 is `status/needs-refinement`**, not intake as this section long claimed. Raised while
  planning #5. Refining it is available work; it has the owner's approval already.
- **#19 must not be implemented from its current state.** Its facts changed under it on
  2026-08-14 — see *Facts worth not rediscovering* — and it still has no acceptance criteria, by
  design. Its three open questions are the owner's to answer in a brainstorming round.
- **Spec §"Decisions deferred"** — unchanged; nothing there blocks the ready tickets.

**This branch:** `handoff-2026-09-01` carries three unpushed commits and goes out as one pull
request at the end-of-day signal. PR #78 (`retro-skill`) is open and waiting on the owner.

## Environment notes

- **`gh` may not exist on a new machine**, and every label move in the ticket workflow goes through
  it. On the current machine it lives at `~/.local/bin/gh`, installed from the GitHub release
  tarball because there is no passwordless sudo and Ubuntu's apt candidate is far behind. Refinement
  can be drafted offline and pushed with `gh issue edit <n> --body-file` once auth is available.
- **The Claude GitHub App is installed on this repo.** That lets Claude be mentioned in issues and
  pull requests; it does **not** give a CLI session API access. They are separate mechanisms.
- Local `main` may sit well behind `origin/main`; branch from `origin/main`, not from it. **It is
  level with `origin/main` at `d5fa002` as of 2026-09-01**, but it goes stale again the moment the
  owner merges anything, so the habit stands rather than the SHA.
- **SSH authentication was down on 2026-08-17** and no git traffic reached GitHub all session:
  `sign_and_send_pubkey: signing failed … communication with agent failed`, and `ssh-add -l` reports
  *The agent has no identities* — the agent is running but empty, or its socket is stale from an
  earlier login. `ssh-add ~/.ssh/id_ed25519` is the fix; the owner has to run it. **Do not switch the
  remote to HTTPS to work around it.** `gh` was unaffected throughout — it carries its own token —
  so issue bodies and labels could still be edited while fetch and push could not. The cost was
  branches cut from a stale local `main`: both #30's and #29's were rebased onto `origin/main` before
  their pull requests went up, which is the fix, and `--force-with-lease` is how a rebased branch
  gets pushed over its pre-rebase remote copy. **It recurred on 2026-08-24**, same signature,
  mid-session — and this time there is a workaround that does not touch the remote:
  `git -c credential.helper='!gh auth git-credential' push https://codeberg.org/DionGerrese/ThatApp.git <branch>`
  pushes on `gh`'s token with the agent dead, as a one-off, leaving the SSH remote configured. Use
  it the moment an SSH push fails rather than leaving a branch stranded; `ssh-add` remains the real
  fix and the owner's to run.
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
