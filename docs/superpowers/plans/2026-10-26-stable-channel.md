# A stable update channel — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-10-26
**Supersedes:** nothing
**Superseded by:** nothing

**Goal:** `scripts/release-image.sh` moves `:stable` on a stable release and only then, and the
README tells a colleague to run and upgrade from `:stable`.

**Architecture:** An optional third argument, the literal `stable`, marks a release as stable. The
script already checks what it pushed (`:latest` carries both architectures); it gains two more such
checks — `:stable` equals `:VERSION` on a stable release, and `:stable` did not move on a
pre-release. Those in-script checks are the tests: `make image` runs the stable path against the
throwaway registry, and every real release runs them against Codeberg.

**Tech Stack:** POSIX `sh`, `crane` v0.22.1, Make + Compose, Forgejo Actions YAML, Markdown.

**Spec:** issue [#322](https://codeberg.org/DionGerrese/ThatApp/issues/322) — its body holds the
approach, the acceptance criteria and what is out of scope. Read it first. #173 was merged into it.

## Global Constraints

- No Go, Node or npm on the host. Everything runs through `make` or `docker compose`.
- Registry path: `codeberg.org/diongerrese/thatapp`. The dry-run registry is `localhost:5000/thatapp`.
- Channels (owner, 2026-10-26): `:latest` moves on **every** release, pre-releases included — this is
  intended. `:stable` moves **only** on a stable release, and it is the default update channel.
- No third argument means a pre-release. The only accepted third argument is exactly `stable`.
- The tag-push publish in `.forgejo/workflows/release.yml` passes no third argument.
- Instructions publish the port as `127.0.0.1:8080:8080`, never bare `8080:8080`.
- Comments: few, and only for a non-obvious why.

## Review Focus

- A third argument of `Stable`, `--stable` or `pre` — expected: usage error, exit 2, before any build.
- Four or more arguments — expected: usage error, exit 2.
- A pre-release published while `:stable` already exists on the registry — expected: `:stable` keeps
  its digest. Codeberg is that case on every real pre-release; the dry run never is.
- A stable release whose `:stable` push fails — expected: the script exits non-zero and does not
  print its success line.
- The README's "stay on one release" sentence — expected: it still names a version tag, not a channel.

---

### Task 1: The script takes a `stable` argument

**Files:**
- Modify: `scripts/release-image.sh` (header comment, usage, argument check, tagging, final checks)
- Modify: `Makefile:43-44` (the `image` target)
- Modify: `.forgejo/workflows/release.yml` (the `Dry run` and `Publish` steps)

**Interfaces:**
- Produces: `release-image.sh VERSION REPO [stable]`. Exit 2 on a usage error. Last line on success:
  - pre-release: `release-image: pushed REPO:VERSION and REPO:latest`
  - stable: `release-image: pushed REPO:VERSION, REPO:latest and REPO:stable`

- [ ] **Step 1: Write the failing checks.** In `release-image.sh`, after the existing `:latest`
  architecture loop, add the checks and nothing else yet:
  - read the third argument into `channel` (empty when absent);
  - before the index is pushed, record `stable_before` = `crane digest "$repo:stable"`, or empty if
    the tag does not exist;
  - after the existing loop: when `channel` is `stable`, fail with
    `release-image: stable does not point at VERSION` unless `crane digest "$repo:stable"` equals
    `crane digest "$repo:$version"`; otherwise fail with `release-image: a pre-release moved stable`
    unless the digest (or empty) equals `stable_before`.
  - Change the `image` target in `Makefile` to pass `stable` as the third argument, and its `##` help
    text to `Dry-run the release image build and push, stable path`.

- [ ] **Step 2: Run it and see RED.**
  Run: `make image`
  Expected: exit non-zero with `release-image: stable does not point at 0000.01.1` (the tag is never
  set yet). Quote the line in the report. A build error is not RED.

- [ ] **Step 3: Implement.**
  - Usage string: `usage: release-image.sh YYYY.WW.N REPO [stable]`.
  - Right after `version` and `repo` are read, and before the version check: more than three
    arguments, or a third argument that is not exactly `stable`, prints the usage to stderr and
    exits 2.
  - After `crane tag "$repo:$version" latest`: when `channel` is `stable`, `crane tag "$repo:$version" stable`.
  - The success line follows the Interfaces block above.
  - The header comment says the index goes to `REPO:VERSION` and `REPO:latest`, and also to
    `REPO:stable` when the third argument is `stable`.

- [ ] **Step 4: Run it and see GREEN.**
  Run: `make image`
  Expected: exit 0, last line `release-image: pushed localhost:5000/thatapp:0000.01.1, localhost:5000/thatapp:latest and localhost:5000/thatapp:stable`.

- [ ] **Step 5: Prove the usage check by hand.** Quote each exit code in the report.
  Run each, expecting `usage: release-image.sh YYYY.WW.N REPO [stable]` and exit 2, with no `go build`
  output before it:
  ```shell
  docker compose run --rm --no-deps app sh scripts/release-image.sh 0000.01.1 localhost:5000/thatapp Stable; echo exit=$?
  docker compose run --rm --no-deps app sh scripts/release-image.sh 0000.01.1 localhost:5000/thatapp stable extra; echo exit=$?
  ```

- [ ] **Step 6: Mutation.** One at a time, break the code, run, see the named failure, restore:
  1. Delete the `crane tag … stable` line → `make image` fails with `stable does not point at`.
  2. Make the `stable` tag unconditional, then run the pre-release path with no third argument:
     `docker compose run --rm --no-deps app sh scripts/release-image.sh 0000.01.1 localhost:5000/thatapp`
     → fails with `a pre-release moved stable`.
  3. Accept any third argument → the `Stable` command from Step 5 no longer exits 2.
  Quote each failing line. Restore and re-run `make image` green.

- [ ] **Step 7: The workflow.** In `.forgejo/workflows/release.yml`, the `Dry run` step passes
  `stable` as the third argument. The `Publish` step stays without one, with this comment above it:
  `# A tag push cannot read the release's pre-release flag, so CI publishes pre-releases only; a stable release runs on this machine.`

- [ ] **Step 8: Commit.**
  ```shell
  git add scripts/release-image.sh Makefile .forgejo/workflows/release.yml
  git commit -m "feat(release): a stable release also moves :stable (#322)"
  ```

### Task 2: The README and the design of record name the channels

**Files:**
- Modify: `README.md` (the three `docker run` commands, *3. Upgrade*)
- Modify: `docs/superpowers/specs/2026-08-04-thatapp-design.md` (*Container layout*)

**Interfaces:**
- Consumes: the two channels from Task 1. No code.

- [ ] **Step 1: README.** Every `codeberg.org/diongerrese/thatapp:latest` becomes `:stable` — the
  three `docker run` commands and the upgrade's `docker pull`. In *3. Upgrade*, after the sentence
  that explains the `YYYY.WW.N` names, add exactly:

  > Two tags follow new releases. `stable` moves only on a release marked stable, and it is the one
  > to run. `latest` moves on every release, pre-releases included, so it gets changes before they
  > are called stable.

  Change "To move to the newest:" to "To move to the newest stable release:". The sentence about
  staying on one release keeps its version-tag example; change only "instead of `latest`" to
  "instead of `stable`".

- [ ] **Step 2: Design of record.** Append to the *Container layout* paragraph:
  `The index is tagged with its version and \`latest\` on every release, and also \`stable\` when the release is stable (#322).`

- [ ] **Step 3: Verify.**
  Run: `grep -n 'thatapp:latest' README.md`
  Expected: no output. Then `grep -n 'stable' README.md` shows the four commands and the new
  paragraph.

- [ ] **Step 4: Commit.**
  ```shell
  git add README.md docs/superpowers/specs/2026-08-04-thatapp-design.md
  git commit -m "docs: colleagues run and upgrade from :stable (#322)"
  ```

### After the tasks

Whole-branch review, including `ponytail:ponytail-review` over the branch diff. Then `make verify`,
`make test-e2e` and `make image` on the head, pasted into the pull request.
