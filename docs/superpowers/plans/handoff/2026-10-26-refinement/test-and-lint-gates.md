# Test and lint gates: refinement drafts (2026-10-26)

## #202 make tsc and make lint do not check the e2e specs

**Still valid?** Yes. `Makefile` `tsc` runs three web projects only (`tsc`, `tsconfig.worker.json`, `tsconfig.test.json`); `lint-web` runs `npm run lint` in `web/`, whose eslint is `eslint src` (`web/package.json`), config `files: ["src/**/*.ts"]` (`web/eslint.config.js`). `.claude/e2e` has no `tsconfig.json` and no eslint config at all (only `package.json`, `playwright.config.ts`, `forward.mjs`, `tests/` with 28 specs). `verify.yml` mirrors the Makefile and has no e2e step. Playwright transpiles specs without type-checking, so type errors never surface.

**Problem.** 28 Playwright specs and the rig config are never type-checked or linted by the merge gate. A type error or lint mistake shows only if the suite runs that path. The e2e rig is its own npm project with its own `node_modules` volume (`playwright-node-modules`), and the `web` container cannot see it.

**Approach (recommended).** Type-check only: add `.claude/e2e/tsconfig.json` (strict, `noUncheckedIndexedAccess`, `noEmit`, `types: []` plus `@playwright/test`, include `tests/**/*.ts`, `playwright.config.ts`). Add `$(COMPOSE) --profile e2e run --rm --no-deps playwright npx tsc --noEmit` to `make tsc`; needs `typescript` as a devDependency in `.claude/e2e/package.json`. Add the same step to the `web` job in `verify.yml` (`npm ci` in `.claude/e2e`, `npx tsc --noEmit`). Expect the first run to surface existing errors that must be fixed in the same PR.
Alternative: also lint the specs (eslint plus typescript-eslint in the e2e project, or widen `web/eslint.config.js` to `../.claude/e2e/tests`). Costs a second set of eslint deps or a cross-project config; do as a follow-up unless the owner wants it now.

**Acceptance criteria**
- [ ] `.claude/e2e/tsconfig.json` exists with `strict` and `noUncheckedIndexedAccess`, not weakened.
- [ ] `make tsc` type-checks the e2e specs and config, and fails on a deliberately introduced type error in a spec (shown once, then reverted).
- [ ] `verify.yml` runs the same check; `make tsc` and the workflow stay equivalent (comment in both says so).
- [ ] Existing type errors in specs are fixed, with no `any`, `as any` or non-null assertions.
- [ ] `.forgejo/workflows/e2e.yml` `paths:` still names every file the rig depends on (new tsconfig is under `.claude/e2e/**`, already covered; confirm).
- [ ] `make verify` and `make test-e2e` output pasted.

**Out of scope.** Linting the specs (unless the owner picks it), changing what the specs test, the web audit (#203).

**Questions for the owner**
1. Type-check only, or lint too? Recommend type-check now, lint as a separate ticket only if a lint-class mistake actually shows up; the ticket's own evidence is about both, but the type gate is the cheap half.

**Design session needed?** No.
**Type label.** None is right (gate gap, not a defect in shipped behaviour). Arguably `enhancement`; leave unlabelled.
**Size.** S-M: one tsconfig, one dep, two gate edits; the unknown is how many latent type errors the 28 specs hold.
**Dependencies.** None. Touches the same `Makefile`/`verify.yml` as #203 if that adds an audit step; trivial merge conflict only.

## #203 npm audit in web/ is clean

**Still valid?** Yes. Probed `npm audit` in `web/` today: 4 high, matching the ticket (brace-expansion, happy-dom, js-yaml, source-map-js). brace-expansion has three advisories across four copies (`node_modules/brace-expansion` plus nested under `@eslint/config-array`, `@eslint/eslintrc`, `eslint`). `npm audit --omit=dev` clean per ticket. `.claude/e2e` not re-probed today (reported clean 2026-09-29).

**Problem.** Four high-severity findings, all dev dependencies, none in the release image. `make verify` does not run or fail on audit, so findings accumulate until someone looks.

**Fix per finding (from `npm audit` and `npm outdated` today)**
- js-yaml, source-map-js, brace-expansion: `npm audit fix` resolves them without `--force`. These are lockfile-only (transitive) updates, no `package.json` change, no major bump.
- happy-dom: installed 20.14.5, wanted 20.14.6, latest 21.0.4. The audit range is 17.0.0 to 21.0.3, so the fix is **21.0.4, a major bump**; `^20.14.5` must become `^21.0.4`. Blast radius is small: only `web/src/week-grid.test.ts` imports happy-dom (`new Window()`, `document`, `HTMLAnchorElement`). Check that file still passes.
- eslint 10 is NOT needed. The eslint-side findings are transitive and fixed by lockfile updates inside the current 9.x. Do not take eslint 10 or typescript 7 here.

**Approach (recommended).** One PR: `npm audit fix` plus bump happy-dom to `^21.0.4`; run `make verify`; `npm ci` must still work. Drift guard: add `npm audit` to the `web` job in `verify.yml` as a separate step, and as a `make audit` target not wired into `verify`? Recommend: do NOT fail the merge gate on audit (a new advisory would block unrelated PRs and the project is dev-deps-only). Instead add a scheduled CI job, or just a `make audit` target.
Alternative: `npm audit --audit-level=high` in the gate for dev deps. Trade-off: a new upstream advisory breaks every PR until fixed.

**Acceptance criteria**
- [ ] `npm audit` in `web/` reports `found 0 vulnerabilities` (output pasted).
- [ ] `npm audit --omit=dev` still clean.
- [ ] `happy-dom` constraint is `^21.0.4` or later and `week-grid.test.ts` passes unchanged (or with a stated minimal change).
- [ ] No `eslint`, `typescript`, `@eslint/js` major bump.
- [ ] `make verify` green; `npm ci` from the new lockfile works in `make install-web` and in CI.
- [ ] `.claude/e2e` audited, result recorded in the PR (fix if it is not clean).
- [ ] Decision on drift guard recorded and implemented (see question).

**Out of scope.** eslint 10, typescript 7, tailwind prettier plugin 0.8, esbuild 0.28 and other "latest" bumps; Go dependency audit.

**Questions for the owner**
1. Drift guard: nothing, a `make audit` target, or a failing CI step? Recommend a `make audit` target (`npm audit` in `web/` and `.claude/e2e`) and a non-blocking mention in the handoff checks; not part of `verify`.

**Design session needed?** No.
**Type label.** None (maintenance); current label state is right.
**Size.** S: lockfile update plus one version bump, one test file at risk.
**Dependencies.** None. Best done before or alongside #206 (same happy-dom file).

## #206 A node test asserting on a happy-dom element exhausts memory

**Still valid?** Yes, as a latent hazard. Only `web/src/week-grid.test.ts` uses happy-dom today (confirmed by grep); its assertions already compare primitives (`grid.querySelector("table") === null` with `assert.equal(..., true, msg)`, `.textContent`, `getAttribute`; lines 84-147). No convention is written down: `CLAUDE.md` has no testing section; the only related guidance is the comment above `test-web` in `Makefile` and the header of `week-grid.test.ts`.

**Problem.** `assert.equal(element, null)` on a happy-dom node makes node's assert serialise the element on failure and exhaust memory (26 GB seen). The existing tests avoid it by habit, not by rule.

**Approach (recommended, per owner's suggested scope).** One convention line: in a node test, compare a value read from the element (`=== null`, `.textContent`, `getAttribute`), never the element itself. Put it where the next author reads it: the `test-web` comment in `Makefile` already explains happy-dom tests, and `CLAUDE.md` Conventions gets one line under TypeScript. Alternative: an eslint rule (`no-restricted-syntax` on `assert.*` with an element arg) is not statically decidable from syntax alone, so it would false-positive or miss; not worth it with one test file.

**Acceptance criteria**
- [ ] A one-line convention exists in `CLAUDE.md` (Conventions, TypeScript) stating the rule and why (memory exhaustion).
- [ ] The `Makefile` `test-web` comment points to it or repeats it in one clause.
- [ ] No tests added or changed.

**Out of scope.** A lint rule, migrating other tests, changing happy-dom.

**Questions for the owner**
none. (Note: `CLAUDE.md` changes are `[Process]` and need no issue under the Workflow rules; the ticket can still carry it, but the PR title should be `[Process]` if it touches only `CLAUDE.md`. Owner may prefer to close the ticket and do it as a `[Process]` PR.)

**Design session needed?** No.
**Type label.** None.
**Size.** S: one or two lines of docs.
**Dependencies.** None.

## #211 The e2e rig's explanations still describe that-app and the that-* host rule

**Still valid?** Yes, all four points, plus one more spot. Checked:
- `docker-compose.yml:44-48`: comment says `that-app` exists "for the rig to target ... instead"; the rig targets `that-e2e` (`playwright.config.ts:14`, compose `THAT_BASE_URL: "http://that-e2e:8080"` at line 152). Is `that-app` used by anything now? Not verified beyond the comment; if unused the alias itself could go, but that is a behaviour change beyond the ticket.
- `playwright.config.ts:3-11`: "behaves identically here and in CI" and the HSTS/gTLD paragraph; browsers now load `localhost` (lines 16-24, `forward.mjs`), and CI sets `THAT_BASE_URL=http://localhost:8080` and does not use Compose.
- `.claude/e2e/README.md:57-68`: "every host name this rig touches is `that-*`" and the gTLD explanation. Still true as a reason the *upstream* alias avoids a bare `app`, but the browsers never see it.
- `.forgejo/workflows/e2e.yml:5` says the rig reaches the app at `http://that-e2e:8080` locally; accurate for the upstream, worth a glance.

**Problem.** Comments and README say the browsers hit `that-*` names and that local and CI behave identically. Since #66 the browsers load `localhost` through `forward.mjs`, and CI skips Compose. A reader following these explanations is misled about which name matters and why.

**Approach (recommended).** Edit comments and README text only: state that `that-e2e` is the upstream the forwarder dials (inside Compose), browsers load `localhost` (secure context), `that-app` explanation reduced to history or removed if the alias is unused, and replace "identically here and in CI" with what actually differs (Compose vs native, forwarder vs direct `localhost`). No behaviour change. Alternative: delete the gTLD paragraphs entirely; trade-off, loses the "why not bare `app`" rationale that still justifies `that-e2e` as a name.

**Acceptance criteria**
- [ ] `docker-compose.yml` comment on the `app` alias no longer says the rig targets it.
- [ ] `playwright.config.ts` header no longer claims identical behaviour in CI and no longer implies browsers hit the `that-*` host.
- [ ] README no longer says every host name is `that-*`; it distinguishes upstream name from browser origin.
- [ ] Diff touches comments and Markdown only; `make test-e2e` still green (pasted), since `.claude/e2e/**` is in its path gate.
- [ ] If the `that-app` alias is found unused, the PR says so; removal is a separate decision (see question).

**Out of scope.** Changing the rig, removing aliases (unless owner says), restructuring README.

**Questions for the owner**
1. If `that-app` is unused, remove the alias too? Recommend no: keep this ticket comment-only, file removal at intake if confirmed unused.

**Design session needed?** No.
**Type label.** None (priority/low correct).
**Size.** S: three files, prose only.
**Dependencies.** None. Touches `playwright.config.ts`, so do not run in parallel with #202 (same area); order as listed handles it.

## #212 tooltip.spec.ts anchor="end" case is flaky on Chromium

**Still valid?** Unknown until the check runs; the likely cause is already fixed. Evidence: failures logged 2026-09-23 to 2026-10-09 (e.g. 3 of 40 on `main` d667ef3 on 2026-10-08). `git log` on `tooltip.spec.ts` shows #309 (2026-10-14: mount only after Today's first render, name the router scroll reset) and #316 (2026-10-21: `mountFixed` and `mountCutText` wait for the upgrade). No failure has been reported since those merged. The anchor="end" tests are at `tooltip.spec.ts:878` (right edge within a pixel) and the text-change test near line 834; line numbers in the ticket are stale. I did not run the check (read-only brief, no e2e).

**Problem.** `boundingBox()` returned null or hover did not open the tooltip, on Chromium, roughly 1 in 13 runs, at a rate unchanged by unrelated branches. Two later fixes changed how the tests mount and wait. Whether they cured it is unmeasured.

**Approach (recommended, per owner's approval).** Run the `anchor="end"` tests (both) about 40 times on `main` in Chromium (and Firefox): `npx playwright test tooltip.spec.ts -g 'anchor="end"' --repeat-each 20` twice, or `--repeat-each 40`. All green: close as fixed by #309 and #316 with the run output in a comment. Any failure: keep open, record the failing line and error, and point at #313 for the product side. Alternative: raise to 100 repeats; at the old 7 percent rate, 40 clean runs leave about a 5 percent chance of a missed flake, 100 leave under 0.1 percent. Cheap enough to prefer.

**Acceptance criteria**
- [ ] Both `anchor="end"` tests run at least 40 times each on `main` in Chromium; pass/fail counts and the commit SHA recorded in a ticket comment.
- [ ] All green: ticket closed as fixed by #309 and #316.
- [ ] Any failure: ticket stays open with the new failure signature; fix is then a normal bug with a regression test.

**Out of scope.** Fixing tooltip product behaviour (#313); changing the specs unless the check fails.

**Questions for the owner**
1. 40 or 100 repeats before closing? Recommend 100 (statistically 40 is thin against a 7 percent flake); the cost is minutes.

**Design session needed?** No.
**Type label.** `bug` is right while open; if closed as fixed it does not matter. If it fails again and the cause is test-side only, it is still a bug in the suite.
**Size.** S: one run, no code unless it fails.
**Dependencies.** #313 (product side) only if the check fails; #309 and #316 merged.

## #47 The /api/* surface has no reference documentation

**Still valid?** Yes, and larger than written. There is no `docs/api.md` (`docs/` holds only `superpowers/`). The ticket's counts are stale: `internal/server/server.go:54-76` now registers 22 API routes (not 7 built of 20), plus `/mcp` (line 79) with its own JSON-RPC error codes (`mcp.go`), and a catch-all 404 (`handleAPINotFound`). Distinct string codes passed to `writeError` or embedded now number roughly 24, not 13: the ticket's list plus `invalid_request`, `permission_denied`, `rate_limited`, `instance_not_found`, `instance_missing`, `issue_not_found`, `pin_exists`, `entry_pending_delete`, `entry_not_pending_delete`, `timer_changed`, `start_not_monday`, `delete_unrecorded` (my grep also hits MCP tool names such as `create_entry`; those are not codes). `instanceErrorFor` (`internal/server/instances.go:323`) now has more than five branches (tenant_unreadable, credentials_rejected, permission_denied, rate_limited, not-found ...). The partial-failure 200-with-embedded-error shape (`instanceIssuesDTO.Error`, `issues.go`) is real; it likely also applies to push (#9) and week fetch, which I did not trace; the author of the doc must check `handlePushDay` and `handleFetchWeek`.

**Problem.** There is no living API reference: no request/response shapes, no error-code registry, and the two error shapes (top-level `{code, message}` with HTTP status versus per-instance error embedded in a 200) are written down nowhere. The frontend branches on `code` (`web/src/api.ts`, comment at the top), so it is a contract with no registry. The design doc's route list is dated and incomplete.

**Approach (recommended).** Hand-written `docs/api.md` (as agreed 2026-08-20): one section per endpoint (method, path, request body, success body, error codes it can return), an error-code table (code, status, meaning, who fixes it), and a short section on the two error shapes. Shapes can reference `web/src/types.ts` and the Go DTOs instead of copying every field. Drift guard: a Go test that parses the doc and asserts every route registered in `server.go` and every code reachable from `instanceErrorFor` appears. That needs routes registered from a table the test can read (small refactor of `server.go:54-76`), or the test greps the doc for each pattern from a list that lives next to the registration. Alternative: document only, no guard; cheapest, but rots, the same failure the ticket exists to prevent.

**Acceptance criteria**
- [ ] `docs/api.md` documents every route registered in `server.go`, with method, path, request body, response body and error codes.
- [ ] An error-code table lists every code the API can return, with HTTP status and meaning; one table, with a column marking per-instance (embedded) use.
- [ ] Both error shapes are explained, with the `GET /api/issues` partial-failure example and any other endpoint that uses it (checked in code, not assumed).
- [ ] `/mcp` is either documented or explicitly pointed at its own doc / marked out of scope in the file.
- [ ] A test fails when a registered route, or a code produced by `instanceErrorFor`, is missing from the doc (verified by mutation: remove a row, see red).
- [ ] The mechanism for the guard is the least invasive that works; no new dependency (CLAUDE.md Go conventions).
- [ ] `CLAUDE.md` Layout or the spec points to `docs/api.md`; a docs-only part of this still needs `make verify` because the test is Go.

**Out of scope.** OpenAPI generation, annotations on handlers, documenting the Jira-side API, documenting future routes.

**Questions for the owner**
1. Enforce drift with a test, or document only? Recommend the test (routes from a table plus codes from `instanceErrorFor`); without it this doc will be stale within two tickets. Codes written inline elsewhere in handlers cannot be fully caught by this test; accept that, or add a `const` per code later.
2. Include `/mcp`? Recommend one short paragraph in `docs/api.md` linking to wherever MCP is specified (not tracing it here), with its JSON-RPC codes out of the REST code table.
3. Milestone fit: this ticket sits in "Test and lint gates" but is documentation plus a drift test. Keep it there? Recommend yes, because the drift test is the gate.

**Design session needed?** No (no UI).
**Type label.** None, arguably `enhancement`; leave unlabelled.
**Size.** M: the doc is a day of careful reading of 22 handlers; the route-table refactor and test add more. The ticket body must be updated first: its counts (7 built, 13 codes) are stale.
**Dependencies.** None blocking. The ticket says the doc grows with tickets 6-11; those have shipped, so no more waiting.
