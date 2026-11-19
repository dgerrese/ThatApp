# Update notice Implementation Plan

**Date:** 2026-11-19
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The rail foot shows the running version, a link when a newer stable release exists on GitHub, and a quiet line when the check fails.

**Architecture:** A new Go package `internal/update` asks GitHub's latest-release endpoint at start and once a day, and keeps the outcome in memory. `GET /api/version` returns the running version plus that outcome. A new frontend module paints the rail foot from that response; the browser never contacts GitHub.

**Tech Stack:** Go stdlib (`net/http`, `httptest`), vanilla TypeScript, Tailwind v4, Playwright.

**Spec:** issue #348's body (the design of record for this ticket) and the approved mockup
`.superpowers/brainstorm/219294-1795019192/content/foot-states-v2.html`, rails one to three. That
mockup is local and git-ignored; its values are copied below.

## Global Constraints

- Only **stable** releases count. Use `GET https://api.github.com/repos/dgerrese/ThatApp/releases/latest`; it already excludes drafts and pre-releases.
- The check is always on, with no setting and no new `THAT_*` variable.
- The server checks **at start and once every 24 hours**. The browser never contacts GitHub.
- A failed check says what failed; never a generic message (owner's rule on #176).
- A `dev` build shows `ThatApp dev` and makes **no** request.
- Versions compare as three integers `YYYY.WW.N`; a leading `v` on a tag is stripped. Never compare as strings.
- No test contacts GitHub; tests stand in for it with `httptest.Server`.
- Go stdlib only. No JS framework. Light DOM. The initial HTTP response stays under 14kB.
- Rail foot copy, exactly: `ThatApp <version>`; `<newest> available`; `Update check failed:` followed by a reason.
- Rail foot styling (rail tones are the same in both themes): version line Chivo Mono 12px `--rail-muted`; update line 13px bold, primary colour, with the external-link mark (the prototype's `#p-ext` path), linking to the release page in a new tab; failure line 12.5px, label in the failure colour, reason in `--rail-muted`. The block sits at the bottom of the rail below the nav, 10px inline padding, 6px between lines, newest line on top.

## Review Focus

1. GitHub answers 200 with a body that is not JSON, or JSON with no `tag_name` → a failure line naming that, not a crash and not "available".
2. GitHub answers 403 (rate limit) or 404 (no release yet, which is the expected state right after the move) → `GitHub answered 403.` / `GitHub answered 404.`
3. GitHub hangs → the request times out within 10 seconds and says `GitHub did not answer.`; the server never blocks a request on the check.
4. The newest release is older than or equal to the running version (a pinned newer build, or the release itself) → version line only.
5. `/api/version` fails in the browser (server unreachable) → the foot keeps showing what it last showed, or nothing on first load; it never throws.

Each line has its test in the owning task below.

---

### Task 1: `internal/update` — version parsing and the checker

**Files:**
- Create: `internal/update/update.go`
- Test: `internal/update/update_test.go`

**Interfaces:**
- Produces:
  - `type Version [3]int`
  - `func ParseVersion(s string) (Version, error)` — accepts `2026.47.1` and `v2026.47.1`; anything else is an error.
  - `func (v Version) Less(w Version) bool`
  - `type Status struct { Latest *Release; Err string }` with `type Release struct { Version string \`json:"version"\`; URL string \`json:"url"\` }`. `Latest` is set only when GitHub's newest stable release is newer than the running version. `Err` is empty unless the last check failed.
  - `func NewChecker(current, url string, client *http.Client) *Checker`
  - `func (c *Checker) Check(ctx context.Context)` — one check; replaces the stored Status whole.
  - `func (c *Checker) Status() Status` — safe for concurrent use.
  - `func (c *Checker) Run(ctx context.Context, every time.Duration)` — checks now, then every `every`, until ctx ends.
  - `const LatestReleaseURL = "https://api.github.com/repos/dgerrese/ThatApp/releases/latest"`

- [ ] **Step 1: Write the failing tests** — table-driven, one `httptest.Server` per case, running version `2026.47.1`:

| Case | GitHub answers | Expected `Status` |
|---|---|---|
| newer | 200 `{"tag_name":"v2026.49.1","html_url":"https://github.com/dgerrese/ThatApp/releases/tag/v2026.49.1"}` | `Latest{Version:"2026.49.1", URL:<html_url>}`, `Err:""` |
| same | 200 tag `v2026.47.1` | `Latest:nil`, `Err:""` |
| older | 200 tag `v2026.46.3` | `Latest:nil`, `Err:""` |
| newer by week, lower N | 200 tag `v2026.48.1` vs running `2026.47.9` | `Latest` set (proves integer, not string, compare) |
| string-compare trap | 200 tag `v2026.10.1` vs running `2026.9.1` | `Latest` set |
| 404 | 404 | `Err:"GitHub answered 404."` |
| 403 | 403 | `Err:"GitHub answered 403."` |
| not JSON | 200 `<html>` | `Err:"GitHub's answer could not be read."` |
| no tag | 200 `{}` | `Err:"GitHub's newest release \"\" is not a version."` |
| bad tag | 200 tag `nightly` | `Err:"GitHub's newest release \"nightly\" is not a version."` |
| hang | handler sleeps past the client timeout (test client `Timeout: 50ms`) | `Err:"GitHub did not answer."` |
| recovery | first check 404, second check 200 newer | after second: `Err:""`, `Latest` set |

Plus `TestParseVersion` (valid with and without `v`; `2026.47`, `2026.47.1.2`, `2026.x.1`, empty → error) and `TestRunChecksImmediately` (Run with `every` = 1 hour; the server records its first request within 1 second; cancel the context and Run returns).

- [ ] **Step 2: Run to verify RED**

Run: `docker compose run --rm --no-deps app go test ./internal/update/ -v`
Expected: FAIL on the assertions (write a stub that compiles first so RED is an assertion, not a build error).

- [ ] **Step 3: Implement** in `internal/update/update.go`. The request sets `Accept: application/vnd.github+json` and a generic `User-Agent: ThatApp` (no personal data). Status lives behind a `sync.Mutex`.

- [ ] **Step 4: Run to verify GREEN**, then **mutate** each guarded rule by hand (swap the compare to string order; drop the `v` strip; drop the status-code check; drop the timeout mapping), run, show red, restore.

- [ ] **Step 5: Commit** — `feat(#348): internal/update checks GitHub's newest stable release`

### Task 2: `GET /api/version` and the wiring in `main`

**Files:**
- Modify: `internal/server/server.go` (route + field), `cmd/server/main.go` (start the checker)
- Create: `internal/server/version.go`
- Test: `internal/server/version_test.go`

**Interfaces:**
- Consumes: `update.Checker.Status()`, `update.Status`, `update.Release` from Task 1.
- Produces: `GET /api/version` →
  `{"version":"2026.47.1","latest":{"version":"2026.49.1","url":"…"} | null,"error":"" | "<reason>"}`.
  `Server` gains an exported field `Updates interface{ Status() update.Status }`; nil means no check runs (a `dev` build, and every existing test).

- [ ] **Step 1: Write the failing tests** — `TestVersionEndpoint`, table-driven over: nil `Updates` → `{"version":"dev","latest":null,"error":""}`; a fake with `Latest` set → `latest` object; a fake with `Err` → `error` string. The version comes from `cfg.Version`.

- [ ] **Step 2: RED** — `docker compose run --rm --no-deps app go test ./internal/server/ -run TestVersionEndpoint -v`, failing on the assertion.

- [ ] **Step 3: Implement** the handler; in `main`, when `version != "dev"`: `c := update.NewChecker(version, update.LatestReleaseURL, &http.Client{Timeout: 10 * time.Second}); srv.Updates = c; go c.Run(context.Background(), 24*time.Hour)`.

- [ ] **Step 4: GREEN + mutation** (return the wrong field; drop the nil guard).

- [ ] **Step 5: Commit** — `feat(#348): GET /api/version reports the running version and the update check`

### Task 3: The rail foot

**Files:**
- Modify: `web/index.html` (the foot region, after `</nav>` inside the rail `<aside>`), `web/src/api.ts` (`getVersion`), `web/src/types.ts` (`VersionStatus`), `web/src/main.ts` (start it)
- Create: `web/src/rail-version.ts`, `web/src/rail-version.test.ts`, `.claude/e2e/tests/rail-version.spec.ts`

**Interfaces:**
- Consumes: `GET /api/version` from Task 2.
- Produces: `type VersionStatus = { version: string; latest: { version: string; url: string } | null; error: string }`; `getVersion(): Promise<VersionStatus>`; `paintVersion(foot: HTMLElement, status: VersionStatus): void`; `startRailVersion(): void` (fetches at start and every hour; a failed fetch leaves the foot as it is).
- The foot element is `<div id="rail-version">`, pushed to the bottom of the rail (`mt-auto`). #349 adds its block inside this element, above these lines.

- [ ] **Step 1: Write the failing unit tests** (happy-dom, asserting on `.textContent`, `getAttribute` and `=== null`, never on elements) — `paintVersion` for: up to date (only `ThatApp 2026.47.1`); update (`2026.49.1 available` line above the version, `href` = the url, `target="_blank"`, `rel="noopener"`); failed (`Update check failed:` + ` GitHub did not answer.`, label in its own element); both `latest` and `error` empty strings/null; repainting from "update" to "up to date" removes the update line.

- [ ] **Step 2: RED** — `docker compose run --rm --no-deps web node --test src/rail-version.test.ts`

- [ ] **Step 3: Implement** `paintVersion` and `startRailVersion`; add the markup with the Global Constraints' styling (Tailwind utilities against the existing rail tokens; the external-link icon from `web/src/icons.ts` if it is there, otherwise add `p-ext`'s path to it).

- [ ] **Step 4: GREEN + mutation** (swap line order; drop the `target`; skip clearing on repaint).

- [ ] **Step 5: e2e** — `rail-version.spec.ts` stubs `**/api/version` per test (and the lists the shell reads, as `toast.spec.ts` does) and asserts for each state: the visible text, the link's `href`, and that **nothing in `#rail-version` lies outside the rail** at a 1280×600 viewport (bounding boxes inside the `<aside>`'s). Plus: a 500 from `/api/version` leaves the foot empty and the page throws no error. Run: `make test-e2e`.

- [ ] **Step 6: Drawing check** — screenshot the three states, dark and light, and compare with rails one to three of `foot-states-v2.html` (text, order, colour roles, sizes, spacing). Report what was compared and what differed.

- [ ] **Step 7: Commit** — `feat(#348): the rail foot shows the version and the update check`

### Task 4: Gates

- [ ] `make verify` green; `make test-e2e` green; paste both into the pull request (CI is off on Codeberg).
- [ ] Whole-branch review, including `ponytail:ponytail-review`.
- [ ] Screenshots pairs attached with `.claude/tools/pr-attach.sh`.
