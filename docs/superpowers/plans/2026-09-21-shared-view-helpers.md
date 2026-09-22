# One home for alertFor and messageOf (#39) Implementation Plan

**Date:** 2026-09-21
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** `alertFor` and `messageOf` each exist once, and every former copy imports them.

**Architecture:** A new `web/src/alert.ts` exports both, sitting beside the other small shared
modules — `push-report.ts`, `page-heading.ts`, `card-surface.ts`, `key-column.ts`,
`toolbar-button.ts`. The four copies are deleted in favour of an import. **No behaviour changes.**

**Tech Stack:** TypeScript, `node --test` for the unit tests, Playwright for the existing coverage.

**Spec:** Codeberg issue #39 — `tea api "repos/{owner}/{repo}/issues/39"`.

## What was confirmed before planning

The copies are genuinely identical, so there is nothing to reconcile:

- **`alertFor`** — four copies in `push-report.ts`, `views/settings.ts`, `views/today.ts`,
  `views/week.ts`. All four hash to `7c8af962cc6af05c2ca1cd21c9485105`.
- **`messageOf`** — three copies in `views/settings.ts`, `views/today.ts`, `views/week.ts`. All
  three hash to `0e972658ec66eba68e5026afc0fdda4e`.

**The initial-response budget is not at risk, and here is why, so it can be checked rather than
assumed.** `main.ts` statically imports only `./rail` and `./router`, and `rail.ts` does not reach
`push-report.ts`. Every consumer of the new module is therefore lazily loaded, so `alert.ts` belongs
to a lazy chunk. `messageOf` needs `ApiError` from `api.ts`, which `rail.ts` already imports, so that
edge adds nothing new to the static graph.

## Global Constraints

- No Go, Node or npm on the host; everything runs through `make` or `docker compose`.
- The owner's dev stack (`app`, `web`) is theirs: never `make down`, never stop or recreate it.
- **Never touch the working tree while a suite run is in flight** — `app-e2e` mounts `.:/src`.
- TypeScript is `strict` with `noUncheckedIndexedAccess`. No `any`, no `as any`, no non-null
  assertion.
- Comments are few and explain a non-obvious why. Do not narrate the extraction.
- Commit unsigned with `git -c commit.gpgsign=false commit …` if signing fails; **never push**.

---

### Task 1: One module, four deletions

**Files:**
- Create: `web/src/alert.ts`, `web/src/alert.test.ts`
- Modify: `web/src/push-report.ts`, `web/src/views/settings.ts`, `web/src/views/today.ts`,
  `web/src/views/week.ts`

- [ ] **Step 1: RED — the module does not exist**

Write `web/src/alert.test.ts` first, covering `messageOf` as the ticket asks: an `ApiError` (its
message is returned), a plain `Error` (the fallback `"Something went wrong."` — the current code
does **not** read `.message` off a plain Error, and this test must lock in what the code does today,
not what it might ideally do), and a non-`Error` value such as a string or `undefined`.

`alertFor` returns DOM and stays covered by the end-to-end suite, exactly as it is now. Do not add a
DOM harness for it.

Run and watch it fail on the missing import:

```shell
docker compose run --rm --no-deps web npm test
```

Paste the failing output into your report.

- [ ] **Step 2: Create the module**

`web/src/alert.ts` exports both functions, moved verbatim. Keep `messageOf`'s existing docstring
(*"The server's message when there is one; ApiError carries it already."*) — it explains a non-obvious
why and is worth keeping.

**One deliberate improvement while the code is in hand.** `alertFor`'s first parameter is currently
`tone: string`, and `that-alert` accepts exactly three tones — `success`, `warning`, `error` — with a
silent fallback to `warning` for anything else. All fourteen call sites pass a string literal.
Narrow the parameter to a union of those three so a typo becomes a compile error instead of a silent
warning-coloured alert. This is a type change only; no behaviour changes and no call site should need
editing. **If narrowing turns out to require editing a call site, stop and report it** — that would
mean a caller passes something the union does not cover, which is a finding rather than something to
paper over.

- [ ] **Step 3: GREEN, and delete the copies**

Re-run the unit tests. Then delete all four `alertFor` copies and all three `messageOf` copies,
importing from `./alert` (or `../alert` from `views/`) instead. Check the count:

```shell
git grep -n "^function alertFor\|^function messageOf" -- web/src
```

**Exactly one hit each**, both in `alert.ts`. That command and its output go in your report — the
ticket asks for it by name.

- [ ] **Step 4: Prove the budget is untouched**

Build and confirm the new module did not land in the entry:

```shell
make build-web
```

Then show that `alert.ts` is not in `app.js`'s static graph. The esbuild metafile or a grep of the
built entry both work; say which you used and what you saw. If `alert.ts` *has* landed in the entry
bundle, stop and report it — something now imports it eagerly and that is a finding, not a thing to
adjust around.

- [ ] **Step 5: Gates**

```shell
make verify
make test-e2e
```

Both green, pasted into your report. `make test-e2e` takes about a minute.

## Verification

- `git grep -n "^function alertFor\|^function messageOf" -- web/src` returns exactly one hit each.
- `messageOf` has unit tests for an `ApiError`, a plain `Error` and a non-`Error` value.
- `alert.ts` is not in `app.js`'s static import graph; the initial-response budget is unchanged.
- No behaviour changes anywhere — the only intentional difference is `alertFor`'s narrowed parameter
  type.
- `make verify` and `make test-e2e` green.

## Out of scope

`button` in `settings.ts`, which has only one copy, and any other single-copy helper. The ticket says
so explicitly.
