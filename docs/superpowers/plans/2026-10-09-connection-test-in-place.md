# The connection test changes only the health slot — Implementation Plan

**Date:** 2026-10-09
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Testing an instance's connection in Settings never moves the UI: the test writes only the row's health slot, which gains `Testing…` and `Not connected · HH:MM`; a failure's message becomes an error toast `Could not connect to <name>: <message>`; the status slot below the row is removed (#301).

**Architecture:** All product code is in `web/src/settings-dialog.ts`. `paintVerdict` becomes the one painter of the health slot's four states and of the Test button's `disabled`, reading the two module-level maps it already has (`pendingTests` → Testing, `verdicts` → Connected / Not connected / Not tested). `runConnectionTest` paints through a new `paintLiveVerdict(instanceId)` that finds the row in the live document, and raises the toast only for an answer that was not discarded. `forgetVerdict` repaints through the same helper, so a reopened dialog's row is the one it reaches. The `[data-row-status]` element goes. Docs follow in the last task.

**Tech Stack:** TypeScript (vanilla, light-DOM), Tailwind v4 utilities (`text-ink-muted`, `text-running`, `text-failed` — all existing tokens), the existing `toast()` module and `that-toast`, Playwright (Firefox and Chromium).

**Spec:** Codeberg #301 — its body is the design of record, settled with the owner on 2026-10-09 (the "Not connected" wording, option A with the time, on the local browser companion: `.superpowers/brainstorm/200120-1791541072/content/health-states.html`). Documents it amends: `docs/superpowers/specs/2026-09-25-toasts-design.md` (decision 3, the placement table), `docs/superpowers/prototypes/2026-09-03-app-prototype.html` (Settings rows), `docs/superpowers/specs/2026-08-20-visual-design-language.md` (Settings).

## Global Constraints

- All tooling through `make` or `docker compose`; never Go, Node or npm on the host. Nothing here needs the dev stack; if you open it anyway, read `THAT_PORT` from `.env` — never assume it.
- The four health states, verbatim from the ticket:

  | State | Text | Tone | Mark |
  |---|---|---|---|
  | Not tested | `Not tested` | muted (`text-ink-muted`) | none |
  | Testing | `Testing…` (U+2026) | muted (`text-ink-muted`) | none |
  | Connected | `Connected · HH:MM` | running (`text-running`) | `check`, 15px |
  | Not connected | `Not connected · HH:MM` | failed (`text-failed`) | `failed`, 15px |

- Toast text, verbatim: `Could not connect to <name>: <message>`, tone `error` (stays until closed). A passing test raises **no** toast.
- The Test button is disabled while its test runs.
- Colour never carries a state alone — "Not connected" wears the `failed` icon.
- Frontend: vanilla TS, `strict` + `noUncheckedIndexedAccess`; no `any`, no `as any`, no `!`. Light DOM. Few comments: a non-obvious why only.
- Firefox and Chromium only; the Playwright command below runs both projects. Never add WebKit.
- **TDD, per task.** RED fails on an **assertion**, for the reason the test names — never a compile error, never a locator timeout. Quote the RED line in the task report. A test marked *guard* passes before its task's change and is proven entirely by mutation. **Every assertion a task adds is proven by mutation**: break the guarded code by hand, run that one test (`-g`), show that assertion red, restore, show it green. The plan uses `expect.soft` where an earlier line would otherwise fire first, so each mutation's line is reachable. The report lists each mutation and its red line.
- "No row moves" is asserted by measuring bounding boxes, in both browsers.
- Commands:

  ```shell
  # One e2e spec — the rig's own disposable app-e2e; always clean up around it
  docker compose --profile e2e rm --stop --force app-e2e
  docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test settings.spec.ts --reporter=line'
  docker compose --profile e2e rm --stop --force app-e2e
  # Prettier on web/src only (never on .claude/e2e — it has no config)
  docker compose run --rm --no-deps web npx prettier --write src/settings-dialog.ts
  # Type check, lint, the full gate
  make tsc
  make lint
  make verify
  make test-e2e
  ```

  Add `-g "<title fragment>"` after `settings.spec.ts` to run one test (every RED and every mutation run).
- Commits: if `git commit` fails on signing, retry the same commit with `git -c commit.gpgsign=false commit …` and note the last signed commit in the report. **Never push.** Never merge into `main`.
- Branch: `issue-301-connection-test-in-place`, already checked out. Do not switch, stash or reset.
- `docs/superpowers/plans/handoff.md` is not touched. Screenshots are the controller's step after this plan.

## Rulings made before execution

The ticket and the screen are silent on these. The controller's, reversible by the owner.

1. **A row built while its test runs reads `Testing…` with Test disabled** — Settings closed and reopened mid-test. The ticket says the slot reads `Testing…` "while a test runs"; the existing test `a test answered after Settings was reopened lands on the reopened row` asserted `Not tested` there and is updated.
2. **`paintVerdict` owns the Test button's `disabled`**, from `pendingTests`. One source of truth for the slot and the button; the old `finally { trigger.disabled = false }` goes.
3. **A failure answered after Settings closed still raises its toast** — the toast is now the only place the message lives. An answer discarded by a save or a removal raises none. Reopening Settings never raises it again.
4. **Saving does not dismiss an open failure toast.** It is an error toast, which stays until closed (toast design decision 4). The verdict returns to `Not tested`. The existing `saving over a failed connection test clears the stale result` asserted the message hidden after a save and is updated.
5. **The toast names the instance as it was when the test started.** A rename is a save, and a save discards the answer, so the two cannot differ for a toast that is raised.
6. **`Verdict` drops its `message`.** Nothing reads it once the alert is gone.
7. **The prototype needs four rows to draw four states.** It holds two (Ridgeline, Northwind). The two added rows are named **Lakeside** (`Testing…`) and **Harbour** (`Not connected · 14:23`), dotted with the ramp's next hues, 295 and 205 (`web/src/instance-hue.ts`), at the lightness and chroma the prototype gives 265 and 175. No drawing names them.
8. **The visual language has no paragraph on the health slot** to amend; Task 3 adds one under *Settings is a control*.

## Review Focus

1. **Settings closed and reopened mid-test, then a save of that instance lands**: the reopened row must go from `Testing…` to `Not tested` with Test enabled — never stick on `Testing…`, whose answer the save discards. Task 2's `a save landing after Settings was reopened mid-test leaves the row Not tested`.
2. **A failure answered after a save** must leave no verdict and raise no toast. Same Task 2 test.
3. **Reopening Settings after a failure** must show `Not connected · HH:MM` again and raise no second toast. Task 2's `a failed verdict survives closing and reopening, without a second toast`.
4. **A failure answered while Settings is closed** must still raise its toast over the view beneath. Task 2's `a failure answered after Settings closed still raises its toast`.
5. **A failure on an instance with no site URL** must leave its warning in place. Task 2's `a failing test leaves the no-site-URL warning in place`.

---

### Task 1: The health slot's four states, the failure toast, and no status slot

**Files:**
- Modify: `web/src/settings-dialog.ts` (`instanceRow`, `Verdict`, the `pendingTests` comment, `paintVerdict`, `runConnectionTest`; new `paintLiveVerdict`)
- Test: `.claude/e2e/tests/settings.spec.ts`

**Interfaces:**
- Consumes: `toast(tone: Tone, message: string, items?: string[]): void` (`web/src/toast.ts`); `iconMarkup(name: IconName, size?: number): string` with `"check"` and `"failed"` (`web/src/icons.ts`); `clockTime(Date): string` (`web/src/format.ts`); spec helpers `stubInstancesApi`, `openSettings`, `addInstance`, `stubListed`, `listed`, `holdNextRequest` (all in `settings.spec.ts`).
- Produces:
  - `type Verdict = { ok: boolean; at: Date }`
  - `function paintVerdict(row: HTMLElement, instanceId: number): void` — paints the four states and sets the row's Test button `disabled` to `pendingTests.has(instanceId)`.
  - `function paintLiveVerdict(instanceId: number): void` — `paintVerdict` on the row in the live document, if there is one.
  - `async function runConnectionTest(instance: Instance): Promise<void>` (the `trigger` and `row` parameters go).
  - Spec helper `rowBoxes(settings: Locator): Promise<number[]>`.

- [ ] **Step 1: Write the Testing test.** In `settings.spec.ts`, insert directly after the test `a successful connection test states Connected and the time it was taken`:

```ts
test("while a test runs, the health slot reads Testing… in muted ink with no mark, and Test is disabled", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await stubInstancesApi(page, { testStatus: 200 });
  const settings = await openSettings(page);
  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();
  const row = settings.getByRole("listitem").filter({ hasText: "Work" });
  const testButton = row.getByRole("button", { name: "Test Work" });

  const held = await holdNextRequest(page, "**/api/instances/*/test", "POST");
  await testButton.click();
  await held.arrived;

  const health = row.locator("[data-row-health]");
  await expect.soft(health).toHaveText("Testing…");
  await expect.soft(health).toHaveCSS("color", "oklch(0.725 0.012 55)");
  await expect.soft(health.locator("svg")).toHaveCount(0);
  await expect.soft(testButton).toBeDisabled();
  await expect.soft(row.locator("that-alert")).toHaveCount(0);

  held.release();
  await expect(health).toHaveText(/^Connected · /);
  await expect(testButton).toBeEnabled();
});
```

- [ ] **Step 2: Rewrite the failure test.** Replace the whole of `a rejected connection test reports the failure` (keep its two-line comment above it) with:

```ts
test("a rejected connection test reports the failure", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await stubInstancesApi(page, { testStatus: 401 });
  const settings = await openSettings(page);
  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();
  const row = settings.getByRole("listitem").filter({ hasText: "Work" });

  await row.getByRole("button", { name: "Test Work" }).click();

  const health = row.locator("[data-row-health]");
  await expect(health).toHaveText(/^Not connected · \d{2}:\d{2}$/);
  await expect.soft(health).toHaveCSS("color", "oklch(0.72 0.17 25)");
  await expect.soft(health.locator("svg")).toHaveAttribute("width", "15");
  await expect.soft(health.locator("svg path")).toHaveAttribute("d", "M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6");

  // #301: the verdict is inline, the failure's message is an error toast.
  const toasts = page.locator("that-toasts that-toast");
  await expect.soft(toasts.first()).toContainText(
    "Could not connect to Work: Jira did not accept the API token for this request; check the token and its scopes",
  );
  await expect.soft(toasts.first()).toHaveAttribute("tone", "error");
  await expect.soft(toasts.first().locator("[data-countdown]")).toHaveCount(0);
  // One more round trip, so a second toast would have landed by now.
  await page.evaluate(() => fetch("/api/health").then((response) => response.text()));
  await expect.soft(toasts).toHaveCount(1);
  await expect.soft(settings.locator("[data-row-status]")).toHaveCount(0);
  await expect.soft(settings.locator("li[data-instance-id] that-alert")).toHaveCount(0);
});
```

- [ ] **Step 3: A pass raises no toast.** At the end of `a successful connection test states Connected and the time it was taken`, after its `svg` width assertion, add:

```ts
  // One more round trip, so a toast the answer raised would have landed by now.
  await page.evaluate(() => fetch("/api/health").then((response) => response.text()));
  await expect(page.locator("that-toasts that-toast")).toHaveCount(0);
```

- [ ] **Step 4: Write the no-move test.** Insert directly after the rewritten failure test:

```ts
async function rowBoxes(settings: Locator): Promise<number[]> {
  const boxes: number[] = [];
  for (const name of ["Ridgeline", "Northwind"]) {
    const box = await settings.getByRole("listitem").filter({ hasText: name }).boundingBox();
    if (!box) throw new Error(`${name}'s row did not lay out`);
    boxes.push(box.y, box.height);
  }

  return boxes;
}

for (const [outcome, answer] of [
  ["passes", { status: 200, json: { accountId: "a", displayName: "Dion" } }],
  ["fails", { status: 401, json: { code: "credentials_rejected", message: "Jira did not accept the API token" } }],
] as const) {
  test(`a test that ${outcome} moves neither its row nor the row below it`, async ({ page }) => {
    await stubListed(page, [listed(1, "Ridgeline"), listed(2, "Northwind")]);
    const held = await holdNextRequest(page, "**/api/instances/*/test", "POST");
    const settings = await openSettings(page);
    const row = settings.getByRole("listitem").filter({ hasText: "Ridgeline" });
    const testButton = row.getByRole("button", { name: "Test Ridgeline" });
    await expect(row.locator("[data-row-health]")).toHaveText("Not tested");
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const before = await rowBoxes(settings);

    await testButton.click();
    await held.arrived;
    expect.soft(await rowBoxes(settings), "while the test runs").toEqual(before);

    held.release(answer);
    await expect(testButton).toBeEnabled();
    expect.soft(await rowBoxes(settings), "after the answer").toEqual(before);
  });
}
```

- [ ] **Step 5: Update the two tests the change contradicts.**

  In `saving over a failed connection test clears the stale result`, replace the comment above it with:

```ts
// A token edit must not leave a verdict about the old token behind (#301: the
// failure toast stays — it closes only when closed).
```

  and replace its body from the Test click to the end with:

```ts
  await page.getByRole("button", { name: "Test" }).click();
  const health = page.locator("[data-row-health]");
  await expect(health).toHaveText(/^Not connected · /);

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("API token", { exact: true }).fill("corrected-secret");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(health).toHaveText("Not tested");
});
```

  In `a test answered after Settings was reopened lands on the reopened row`, replace

```ts
    await expect(settings.locator("[data-row-health]")).toHaveText("Not tested");
```

  with

```ts
    await expect(settings.locator("[data-row-health]")).toHaveText("Testing…");
    await expect(settings.getByRole("button", { name: "Test Ridgeline" })).toBeDisabled();
```

- [ ] **Step 6: Run them; see RED.** Run `settings.spec.ts` with `-g "Testing…|rejected connection|successful connection|moves neither|saving over a failed|reopened row"`. Expected, in both browsers:
  - `while a test runs…`: `toHaveText("Testing…")` red, received `Not tested`; `that-alert` count red, received `1`.
  - `a rejected connection test…`: `toHaveText(/^Not connected · …/)` red, received `""`.
  - `a successful connection test…`: **passes** (the no-toast line is a guard; proven in Step 9).
  - `a test that passes/fails moves neither…`: `"while the test runs"` red (Ridgeline's height and Northwind's `y` grew); for `fails`, `"after the answer"` red too.
  - `saving over a failed…`: `toHaveText(/^Not connected · /)` red.
  - `a test answered after Settings was reopened…`: `toHaveText("Testing…")` red, received `Not tested`.

- [ ] **Step 7: Implement.** In `web/src/settings-dialog.ts`:

  In `instanceRow`, replace

```ts
  line.append(dot, identity, health, actions);

  const status = document.createElement("div");
  status.className = "mt-2 empty:mt-0";
  status.dataset["rowStatus"] = "";
  row.append(line, status);

  test.addEventListener("click", () => {
    void runConnectionTest(state.instance, test, row);
  });
```

  with

```ts
  line.append(dot, identity, health, actions);
  row.append(line);

  test.addEventListener("click", () => {
    void runConnectionTest(state.instance);
  });
```

  Replace the `Verdict` type and the `pendingTests` comment:

```ts
type Verdict = { ok: boolean; at: Date };
const verdicts = new Map<number, Verdict>();
// The test each instance is waiting on, which is what paints Testing…. Forgetting
// a verdict drops its entry, so an answer arriving after a save or a removal is
// discarded rather than written back — onto a changed token, or onto whichever
// instance is given the freed id.
const pendingTests = new Map<number, symbol>();
```

  Replace `paintVerdict` (and its doc comment) with:

```ts
/** The health slot's four states (#301). The test writes nothing else, so the
 *  row never changes height. */
function paintVerdict(row: HTMLElement, instanceId: number): void {
  const health = row.querySelector<HTMLElement>("[data-row-health]");
  const test = row.querySelector<HTMLButtonElement>('[data-row-action="test"]');
  if (!health || !test) return;

  const testing = pendingTests.has(instanceId);
  const verdict = verdicts.get(instanceId);
  test.disabled = testing;
  if (testing || !verdict) {
    health.className = `${HEALTH_CLASS} text-ink-muted`;
    health.textContent = testing ? "Testing…" : "Not tested";

    return;
  }

  health.className = `${HEALTH_CLASS} ${verdict.ok ? "text-running" : "text-failed"}`;
  // No aria-label: the mark is decoration beside the words that name the state.
  health.innerHTML = iconMarkup(verdict.ok ? "check" : "failed", 15);
  health.append(`${verdict.ok ? "Connected" : "Not connected"} · ${clockTime(verdict.at)}`);
}

// Settings may have been closed and reopened since the row was built, which
// built a new one; a closed dialog has none.
function paintLiveVerdict(instanceId: number): void {
  const live = document.querySelector<HTMLElement>(`li[data-instance-id="${instanceId}"]`);
  if (live) {
    paintVerdict(live, instanceId);
  }
}
```

  Replace `runConnectionTest` with:

```ts
async function runConnectionTest(instance: Instance): Promise<void> {
  const pending = Symbol();
  pendingTests.set(instance.id, pending);
  paintLiveVerdict(instance.id);

  let failure: string | undefined;
  try {
    await testInstance(instance.id);
  } catch (error) {
    failure = messageOf(error);
  }

  if (pendingTests.get(instance.id) !== pending) return;
  pendingTests.delete(instance.id);
  verdicts.set(instance.id, { ok: failure === undefined, at: new Date() });
  paintLiveVerdict(instance.id);
  if (failure !== undefined) {
    toast("error", `Could not connect to ${instance.name}: ${failure}`);
  }
}
```

  Run prettier on `src/settings-dialog.ts`, then `make tsc`.

- [ ] **Step 8: Run them; see GREEN.** The Step 6 command; all pass in both browsers. Then run the whole `settings.spec.ts`; all pass (the existing `an in-flight connection test survives another row being saved` reads `Testing…` from the health slot now).

- [ ] **Step 9: Prove every added assertion by mutation.** One at a time: apply, run that test with `-g`, see the named line red, restore, see green.

  | # | Mutation in `settings-dialog.ts` | Test | Red line |
  |---|---|---|---|
  | 1 | `testing ? "Testing…"` → `testing ? "Not tested"` | while a test runs | `toHaveText("Testing…")` |
  | 2 | testing branch class `` `${HEALTH_CLASS} text-ink-muted` `` → `` `${HEALTH_CLASS} ${testing ? "text-running" : "text-ink-muted"}` `` | while a test runs | `toHaveCSS("color", "oklch(0.725 0.012 55)")` |
  | 3 | in the testing branch, after `textContent`, add `health.insertAdjacentHTML("afterbegin", iconMarkup("check", 15));` | while a test runs | `health.locator("svg")` count 0 |
  | 4 | `test.disabled = testing` → `test.disabled = false` | while a test runs | `toBeDisabled()` |
  | 5 | in `runConnectionTest`, after the first `paintLiveVerdict`, add `document.querySelector(\`li[data-instance-id="${instance.id}"]\`)?.append(alertFor("warning", "Testing…"));` | while a test runs | `that-alert` count 0 |
  | 6 | `test.disabled = testing` → `test.disabled = true` | while a test runs | final `toBeEnabled()` |
  | 7 | `"Not connected"` → `"Failed"` | rejected | `toHaveText(/^Not connected · …/)` |
  | 8 | `"text-failed"` → `"text-ink-muted"` | rejected | `toHaveCSS("color", "oklch(0.72 0.17 25)")` |
  | 9 | `iconMarkup(…, 15)` → `iconMarkup(…, 17)` | rejected | `svg` width 15 |
  | 10 | `"failed"` → `"warning"` in the icon choice | rejected | `svg path` `d` |
  | 11 | toast text → `` `${failure}` `` | rejected | `toContainText("Could not connect to Work: …")` |
  | 12 | `toast("error", …)` → `toast("warning", …)` | rejected | `toHaveAttribute("tone", "error")` |
  | 13 | `toast("error", …)` → `toast("success", …)` | rejected | `[data-countdown]` count 0 (tone line red too; soft) |
  | 14 | call the `toast(...)` line twice | rejected | `toasts` count 1 |
  | 15 | restore the `status` div in `instanceRow` (`row.append(line, status)` with `data-row-status`) | rejected | `[data-row-status]` count 0 |
  | 16 | after the toast, add `document.querySelector(\`li[data-instance-id="${instance.id}"]\`)?.append(alertFor("error", failure));` | rejected | `li[data-instance-id] that-alert` count 0 |
  | 17 | move the `toast(...)` out of its `if`, as `toast("error", "x");` | successful | `that-toast` count 0 |
  | 18 | mutation 5 | moves neither (passes) | `"while the test runs"` |
  | 19 | mutation 16 | moves neither (fails) | `"after the answer"` |
  | 20 | after the final `paintLiveVerdict`, add `if (failure === undefined) document.querySelector(\`li[data-instance-id="${instance.id}"]\`)?.append(alertFor("success", "ok"));` | moves neither (passes) | `"after the answer"` |
  | 21 | in `save()`, delete `forgetVerdict(regions, editing.id);` | saving over a failed | `toHaveText("Not tested")` |
  | 22 | in `paintVerdict`, `const testing = pendingTests.has(instanceId)` → `const testing = false` | reopened row | `toHaveText("Testing…")` |

- [ ] **Step 10: Lint and commit.**

```bash
make lint
git add web/src/settings-dialog.ts .claude/e2e/tests/settings.spec.ts
git commit -m "feat(#301): the connection test changes only the health slot

Testing… and Not connected · HH:MM join the slot's states; a failure's
message is an error toast naming the instance; the status slot below
the row is gone, so a test never moves a row."
```

---

### Task 2: Save, reopen, close and the site-URL warning around a test

**Files:**
- Modify: `web/src/settings-dialog.ts` (`forgetVerdict` and its two callers)
- Test: `.claude/e2e/tests/settings.spec.ts` (inside `test.describe("instance rows", …)`)

**Interfaces:**
- Consumes: `paintLiveVerdict(instanceId: number): void`, `paintVerdict`, `pendingTests`, `verdicts` (Task 1); spec helpers `stubInstancesApi`, `openSettings`, `addInstance`, `stubListed`, `listed`, `holdNextRequest`.
- Produces: `function forgetVerdict(instanceId: number): void` (the `regions` parameter goes).

- [ ] **Step 1: Write the tests.** Append inside `test.describe("instance rows", …)`, after its last test:

```ts
  test("a save landing after Settings was reopened mid-test leaves the row Not tested", async ({ page }) => {
    await stubInstancesApi(page, { testStatus: 200 });
    const settings = await openSettings(page);
    await addInstance(page);
    await expect(page.getByText("Work", { exact: true })).toBeVisible();

    const heldTest = await holdNextRequest(page, "**/api/instances/*/test", "POST");
    await settings.getByRole("button", { name: "Test Work" }).click();
    await heldTest.arrived;

    const heldSave = await holdNextRequest(page, "**/api/instances/*", "PATCH");
    await settings.getByRole("button", { name: "Edit Work" }).click();
    await page.getByLabel("API token", { exact: true }).fill("corrected-secret");
    await page.getByRole("button", { name: "Save changes" }).click();
    await heldSave.arrived;

    await settings.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const health = settings.locator("[data-row-health]");
    await expect(health).toHaveText("Testing…");

    heldSave.release();
    await expect(settings.getByRole("button", { name: "Edit Work" })).toBeEnabled();
    await expect.soft(health).toHaveText("Not tested");
    await expect.soft(settings.getByRole("button", { name: "Test Work" })).toBeEnabled();

    // The answer to the test the save made stale: a failure, discarded.
    const tested = page.waitForResponse("**/api/instances/*/test");
    heldTest.release({
      status: 401,
      json: { code: "credentials_rejected", message: "Jira did not accept the API token" },
    });
    await tested;
    // One more round trip, so the app's own promise chain has settled the late answer.
    await page.evaluate(() => fetch("/api/health").then((response) => response.text()));
    await expect.soft(health).toHaveText("Not tested");
    await expect.soft(page.locator("that-toasts that-toast")).toHaveCount(0);
  });

  test("a failed verdict survives closing and reopening, without a second toast", async ({ page }) => {
    await stubListed(page, [listed(1, "Ridgeline")]);
    await page.route("**/api/instances/*/test", (route) =>
      route.fulfill({ status: 401, json: { code: "credentials_rejected", message: "Jira did not accept the API token" } }),
    );
    const settings = await openSettings(page);

    await settings.getByRole("button", { name: "Test Ridgeline" }).click();
    await expect(settings.locator("[data-row-health]")).toHaveText(/^Not connected · /);
    await expect(page.locator("that-toasts that-toast")).toHaveCount(1);

    await settings.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect.soft(settings.locator("[data-row-health]")).toHaveText(/^Not connected · /);
    // One more round trip, so a toast the reopen raised would have landed by now.
    await page.evaluate(() => fetch("/api/health").then((response) => response.text()));
    await expect.soft(page.locator("that-toasts that-toast")).toHaveCount(1);
  });

  test("a failure answered after Settings closed still raises its toast", async ({ page }) => {
    await stubListed(page, [listed(1, "Ridgeline")]);
    const held = await holdNextRequest(page, "**/api/instances/*/test", "POST");
    const settings = await openSettings(page);

    await settings.getByRole("button", { name: "Test Ridgeline" }).click();
    await held.arrived;
    await settings.getByRole("button", { name: "Close" }).click();
    await expect(settings).toBeHidden();

    held.release({ status: 401, json: { code: "credentials_rejected", message: "Jira did not accept the API token" } });
    await expect(page.locator("that-toasts that-toast[tone='error']")).toContainText(
      "Could not connect to Ridgeline: Jira did not accept the API token",
    );
  });

  test("a failing test leaves the no-site-URL warning in place", async ({ page }) => {
    await stubListed(page, [{ ...listed(1, "Ridgeline"), siteUrl: "" }]);
    await page.route("**/api/instances/*/test", (route) =>
      route.fulfill({ status: 401, json: { code: "credentials_rejected", message: "Jira did not accept the API token" } }),
    );
    const settings = await openSettings(page);
    const warning = settings.getByText("This instance has no site URL");
    await expect(warning).toBeVisible();

    await settings.getByRole("button", { name: "Test Ridgeline" }).click();
    await expect(settings.locator("[data-row-health]")).toHaveText(/^Not connected · /);
    await expect(warning).toBeVisible();
  });
```

- [ ] **Step 2: Run them; see RED.** Run `settings.spec.ts` with `-g "reopened mid-test|survives closing and reopening, without|answered after Settings closed still|no-site-URL warning in place"`. Expected, in both browsers:
  - `a save landing after Settings was reopened mid-test…`: `toHaveText("Not tested")` (the first, soft) red, received `Testing…`; `Test Work` `toBeEnabled()` red. `forgetVerdict` repainted the closed dialog's detached row, not the reopened one.
  - The other three: **pass** — guards, proven in Step 5.

- [ ] **Step 3: Implement.** In `web/src/settings-dialog.ts`, replace `forgetVerdict` (keep its comment) with:

```ts
function forgetVerdict(instanceId: number): void {
  verdicts.delete(instanceId);
  pendingTests.delete(instanceId);
  paintLiveVerdict(instanceId);
}
```

  In `removeInstance`, `forgetVerdict(regions, instance.id);` → `forgetVerdict(instance.id);`. In `save()`, `forgetVerdict(regions, editing.id);` → `forgetVerdict(editing.id);`. Run prettier on `src/settings-dialog.ts`, then `make tsc`.

- [ ] **Step 4: Run them; see GREEN.** The Step 2 command; all pass. Then the whole `settings.spec.ts`; all pass, including the existing `editing an instance to add its site URL clears the missing-URL warning`, `a verdict survives closing and reopening, and a reload forgets it`, and both "answered after its instance was removed" tests.

- [ ] **Step 5: Prove every added assertion by mutation.**

  | # | Mutation in `settings-dialog.ts` | Test | Red line |
  |---|---|---|---|
  | 1 | restore `forgetVerdict`'s old body (query `regions.listSlot`; pass `regions` back in) | reopened mid-test | first `toHaveText("Not tested")` |
  | 2 | in `forgetVerdict`, after `paintLiveVerdict`, add `document.querySelector<HTMLButtonElement>(\`li[data-instance-id="${instanceId}"] [data-row-action="test"]\`)?.setAttribute("disabled", "");` | reopened mid-test | `Test Work` `toBeEnabled()` |
  | 3 | delete `if (pendingTests.get(instance.id) !== pending) return;` | reopened mid-test | second `toHaveText("Not tested")` (toast line red too; soft) |
  | 4 | move the `toast(...)` block above the `pendingTests` check | reopened mid-test | `that-toast` count 0 |
  | 5 | in `showSettings`'s `close` listener, add `verdicts.clear();` | survives closing | `toHaveText(/^Not connected · /)` after reopen |
  | 6 | at the end of `instanceRow`, add `if (verdicts.get(instance.id)?.ok === false) toast("error", "again");` | survives closing | `that-toast` count 1 |
  | 7 | in `runConnectionTest`, wrap the toast as `if (failure !== undefined && document.querySelector(\`li[data-instance-id="${instance.id}"]\`))` | answered after Settings closed | `toContainText("Could not connect to Ridgeline: …")` |
  | 8 | in `paintVerdict`'s verdict branch, add `if (!verdict.ok) row.querySelector("[data-site-url-warning]")?.remove();` | no-site-URL warning | final `toBeVisible()` |

- [ ] **Step 6: Lint and commit.**

```bash
make lint
git add web/src/settings-dialog.ts .claude/e2e/tests/settings.spec.ts
git commit -m "fix(#301): forgetting a verdict repaints the row Settings shows now

A save landing after Settings was reopened mid-test repainted the
closed dialog's row, leaving the open one on Testing… for good."
```

---

### Task 3: The toast design, the visual language and the prototype

**Files:**
- Modify: `docs/superpowers/specs/2026-09-25-toasts-design.md` (decisions 2, 3 and 10; the placement table)
- Modify: `docs/superpowers/specs/2026-08-20-visual-design-language.md` (*Nav*, after the *Settings is a control* paragraph)
- Modify: `docs/superpowers/prototypes/2026-09-03-app-prototype.html` (hue tokens, `.health.bad`, `#p-failed`, two rows). It is a fragment rendered in the companion frame: **never add a doctype or `<html>`/`<head>`/`<body>`**.

**Interfaces:**
- Consumes: the states and wording in Global Constraints.
- Produces: nothing code reads.

- [ ] **Step 1: The toast design.** In `2026-09-25-toasts-design.md`:

  Decision 2 — replace `and a timer start that failed (#207).` with `a timer start that failed (#207), and a Settings connection test that failed (#301).`

  Decision 3 — replace

```markdown
   inline. So does Settings' *Test connection* result, in its row, and the instance form's own error: that
   form is a card on the page, not a dialog.
```

  with

```markdown
   inline. So does Settings' *Test connection* verdict, in its row's health slot, and the instance form's
   own error: that form is a card on the page, not a dialog. *Amended by #301 on 2026-10-09:* the failed
   test's message left the row for an error toast (decision 2), because the alert beneath the row moved
   every row below it. The verdict — `Not tested`, `Testing…`, `Connected · HH:MM`, `Not connected · HH:MM`
   — stays inline.
```

  Decision 10 — append to its text: ` #301 is the one exception: the failed connection test's message gained the save-failure toast's prefix, as `Could not connect to <name>: <message>`, because a toast outside the row must name the instance.`

  The table — replace the row

```markdown
| `settings.ts` *Test connection* | result in its row | stays inline |
```

  with

```markdown
| `settings.ts` *Test connection* | verdict in its row's health slot | stays inline |
| `settings.ts` *Test connection* failure | the failure's message (#301) | toast |
```

- [ ] **Step 2: The visual language.** In `2026-08-20-visual-design-language.md`, after the paragraph that ends `so the rail keeps describing a real period underneath.`, insert (a blank line before and after):

```markdown
**An instance row's health slot has four states** (#301, 2026-10-09). Testing a connection writes this
slot and nothing else, so the row never changes height and no row below it moves.

| State | Text | Tone | Mark |
| --- | --- | --- | --- |
| Not tested | `Not tested` | `--color-ink-muted` | none |
| Testing | `Testing…` | `--color-ink-muted` | none |
| Connected | `Connected · 14:22` | `--color-running` | the check, 15px |
| Not connected | `Not connected · 14:23` | `--color-failed` | the `failed` circle with a cross, 15px |

Not connected wears a mark because no state rests on colour alone, and the time of the test, as
Connected does, so a failure that predates a token change reads as old. Its message is an error toast,
`Could not connect to <name>: <message>`, that stays until it is closed; a pass raises none. The test
button is disabled while its test runs.
```

- [ ] **Step 3: The prototype.** In `2026-09-03-app-prototype.html`:

  In the `.pt.dark` block, replace `--h265: oklch(0.72 0.12 265); --h175: oklch(0.72 0.12 175);` with `--h265: oklch(0.72 0.12 265); --h175: oklch(0.72 0.12 175); --h295: oklch(0.72 0.12 295); --h205: oklch(0.72 0.12 205);`. In the `.pt.light` block, replace `--h265: oklch(0.60 0.13 265); --h175: oklch(0.60 0.13 175);` with `--h265: oklch(0.60 0.13 265); --h175: oklch(0.60 0.13 175); --h295: oklch(0.60 0.13 295); --h205: oklch(0.60 0.13 205);`.

  Replace `.health.ok { color: var(--run); } .health.un { color: var(--ink-muted); }` with `.health.ok { color: var(--run); } .health.un { color: var(--ink-muted); } .health.bad { color: var(--fail); }`.

  After the line `<g id="p-check"><path d="M4.5 12.6 9.6 17.7 19.5 6.9"/></g>`, add:

```html
  <g id="p-failed"><circle cx="12" cy="12" r="8.5"/><path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6"/></g>
```

  On the `<ul class="inst">` line, insert immediately before its `</ul>` (after Northwind's `</li>`) these two rows, Testing then Not connected; the Testing row's plug is disabled at the app's `opacity-60`:

```html
<li><i class="dot" style="background:var(--h295);width:8px;height:8px"></i><span class="iid"><span class="iname">Lakeside</span><span class="ihost">lakeside.atlassian.net &middot; dion@this.nl</span></span><span class="health un">Testing&hellip;</span><span class="iacts"><button class="iconbtn" disabled style="opacity:.6"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><use href="#p-plug"/></svg><span class="tip end">test connection</span></button><button class="iconbtn"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><use href="#p-edit"/></svg><span class="tip end">edit instance</span></button><button class="iconbtn danger"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><use href="#p-trash"/></svg><span class="tip end">remove instance</span></button></span></li><li><i class="dot" style="background:var(--h205);width:8px;height:8px"></i><span class="iid"><span class="iname">Harbour</span><span class="ihost">harbour.atlassian.net &middot; dion@this.nl</span></span><span class="health bad"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><use href="#p-failed"/></svg>Not connected &middot; 14:23</span><span class="iacts"><button class="iconbtn"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><use href="#p-plug"/></svg><span class="tip end">test connection</span></button><button class="iconbtn"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><use href="#p-edit"/></svg><span class="tip end">edit instance</span></button><button class="iconbtn danger"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><use href="#p-trash"/></svg><span class="tip end">remove instance</span></button></span></li>
```

- [ ] **Step 4: Check the prototype.** `head -1 docs/superpowers/prototypes/2026-09-03-app-prototype.html` is still the fonts `<link>` (no doctype), and `grep -o 'class="health [a-z]*"' docs/superpowers/prototypes/2026-09-03-app-prototype.html | sort | uniq -c` reads `bad` 1, `ok` 1, `un` 2. The controller renders it in the companion frame when taking screenshots.

- [ ] **Step 5: Commit.**

```bash
git add docs/superpowers/specs/2026-09-25-toasts-design.md docs/superpowers/specs/2026-08-20-visual-design-language.md docs/superpowers/prototypes/2026-09-03-app-prototype.html
git commit -m "docs(#301): the health slot's four states and the failure toast

The toast design's decision 3 keeps the verdict inline and moves the
failure's message to a toast; the visual language and the prototype's
Settings rows draw all four states."
```

---

### Task 4: The gate

- [ ] **Step 1:** `make verify` — paste the tail of its output.
- [ ] **Step 2:** `make test-e2e` — paste the summary line (both browsers).
- [ ] **Step 3:** Compare against the drawing (`.superpowers/brainstorm/200120-1791541072/content/health-states.html`, option A): each state's words, tone and mark; Testing's disabled plug; the toast's words. Report what was compared and what differs. Known and owner-settled: the app strokes the check at the set's 1.9, the drawing at 2.2 (`web/src/icons.ts`).

## Acceptance criteria → tasks

| Criterion (#301) | Where |
|---|---|
| Testing… muted, no mark, Test disabled | Task 1 `while a test runs…` |
| Pass shows Connected · HH:MM, running, check | existing `a successful connection test…` (unchanged lines) |
| Fail shows Not connected · HH:MM, failed, `failed` icon | Task 1 `a rejected connection test…` |
| One error toast `Could not connect to <name>: <message>`, stays until closed | Task 1 `a rejected…` (text, `tone="error"`, no countdown, count 1) |
| Pass raises no toast | Task 1 Step 3 |
| Start, pass, fail move no row — measured, Firefox and Chromium | Task 1 `a test that passes/fails moves neither…` |
| Status slot gone, nothing writes an alert there | Task 1 `a rejected…` (`[data-row-status]` 0, row `that-alert` 0) |
| No-site-URL warning shows and clears as before | existing `editing an instance to add its site URL…`; Task 2 `a failing test leaves the no-site-URL warning…` |
| Save clears to Not tested, incl. Not connected; late answer after save/removal discarded | Task 1 `saving over a failed…`; Task 2 `a save landing after…`; existing removal tests |
| Verdict survives close/reopen; reload forgets | existing `a verdict survives…`; Task 2 `a failed verdict survives…` |
| Old no-toast test rewritten, not deleted | Task 1 Step 2 |
| Toast design, prototype, visual language updated | Task 3 |
| Light and dark screenshots of the four states | controller, after this plan |
