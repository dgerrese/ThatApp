# A late save leaves the form the user moved on to alone (#161) Implementation Plan

**Date:** 2026-09-23
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Settings, a save that finishes after the user replaced its form (Edit on another row,
Cancel) no longer resets the form now on screen, reports a failure where it can be seen, and never
leaves an Edit form for the just-saved instance holding pre-save values.

**Architecture:** One check in `save()` inside `instanceForm()` in `web/src/views/settings.ts`: is
this save's own card still the form on screen (`regions.formCard.contains(card)`)? Yes → behave as
today. No → on success leave the form alone, except rebuild it with the saved instance when it edits
that same instance; on failure write the error, naming the instance, into `regions.errorSlot`.
`removeInstance()` is untouched.

**Tech Stack:** Vanilla TypeScript (strict), Playwright e2e in `.claude/e2e/tests/settings.spec.ts`.

**Spec:** Codeberg issue #161 body (refined 2026-09-23) — the "Settled at refinement" section and
the acceptance criteria.

## Global Constraints

- Docker only: never run go/node/npm on the host. Use `make` or `docker compose`.
- TypeScript strict with `noUncheckedIndexedAccess`; no `any`, `as any`, or non-null assertions.
- Few comments; only a non-obvious why.
- Every new e2e test holds the save's response open with a route, so timing is deterministic.
- No change to `removeInstance()`; no disabling of other rows' controls during a save.

Run just this spec (the Makefile's `test-e2e` runs the whole suite; the `rm` lines mirror it):

```shell
docker compose --profile e2e rm --stop --force app-e2e
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/settings.spec.ts'
docker compose --profile e2e rm --stop --force app-e2e
```

---

### Task 1: A finishing save resets only its own form

Covers criteria 1, 2, 3 (and their share of 6).

**Files:**
- Modify: `web/src/views/settings.ts` — `save()` inside `instanceForm()`
- Test: `.claude/e2e/tests/settings.spec.ts` — a `holdNextRequest` helper beside `addSecondInstance`, three tests appended at the end

**Interfaces:**
- Produces (test helper, used again by Task 2):

```ts
interface HeldAnswer {
  status: number;
  json: unknown;
}

interface HeldRequest {
  arrived: Promise<void>;
  // No answer lets the stub registered earlier answer as usual.
  release: (answer?: HeldAnswer) => void;
}

async function holdNextRequest(page: Page, url: string, method: string): Promise<HeldRequest>
```

- [ ] **Step 1: Add the helper after `addSecondInstance`**

```ts
interface HeldAnswer {
  status: number;
  json: unknown;
}

interface HeldRequest {
  arrived: Promise<void>;
  release: (answer?: HeldAnswer) => void;
}

/**
 * Holds the next `method` request to `url` open until release() — registered
 * after stubInstancesApi, so it runs first. Released with no answer, the stub
 * answers it as usual.
 */
async function holdNextRequest(page: Page, url: string, method: string): Promise<HeldRequest> {
  let arrive: () => void = () => {};
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  let release: (answer?: HeldAnswer) => void = () => {};
  const released = new Promise<HeldAnswer | undefined>((resolve) => {
    release = resolve;
  });
  let held = false;

  await page.route(url, async (route) => {
    if (route.request().method() !== method || held) {
      await route.fallback();
      return;
    }
    held = true;
    arrive();
    const answer = await released;
    if (answer) {
      await route.fulfill(answer);
    } else {
      await route.fallback();
    }
  });

  return { arrived, release };
}
```

- [ ] **Step 2: Append the three tests**

```ts
// #161: save() must not reset a form the user has since replaced.
test("a save finishing after Edit on another row leaves that edit form alone", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");
  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();
  await addSecondInstance(page);

  const held = await holdNextRequest(page, "**/api/instances/*", "PATCH");
  await page.getByRole("listitem").filter({ hasText: "Work" }).getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("Work Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await held.arrived;

  await page.getByRole("listitem").filter({ hasText: "Personal" }).getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("Personal typed");

  held.release();
  await expect(page.getByText("Work Renamed", { exact: true })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Edit Personal" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Personal typed");
});

test("a save finishing after Cancel leaves the new Add form alone", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");
  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();

  const held = await holdNextRequest(page, "**/api/instances/*", "PATCH");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("Work Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await held.arrived;

  await page.getByRole("button", { name: "Cancel changes" }).click();
  await page.getByLabel("Name").fill("Half-typed");

  held.release();
  await expect(page.getByText("Work Renamed", { exact: true })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Add an instance" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Half-typed");
});

test("a save finishing with its own form still shown resets to Add an instance", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");
  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();

  const held = await holdNextRequest(page, "**/api/instances/*", "PATCH");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("Work Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await held.arrived;

  held.release();
  await expect(page.getByText("Work Renamed", { exact: true })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Add an instance" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("");
});
```

- [ ] **Step 3: Run the spec, confirm RED**

Expected: the Edit-another-row and Cancel tests FAIL (heading is "Add an instance" / Name is "").
The own-form test passes already — it guards today's behaviour, per criterion 3.

- [ ] **Step 4: Implement in `save()`**

Replace the success tail of the `try` block:

```ts
      await refresh(regions);
      if (editing) {
        clearRowStatus(regions, editing.id);
      }
      // The user may have moved on while this save was in flight (#161).
      if (regions.formCard.contains(card)) {
        showForm(regions, undefined);
      }
```

- [ ] **Step 5: Run the spec, confirm GREEN** (all settings tests pass)

- [ ] **Step 6: Commit**

```bash
git add web/src/views/settings.ts .claude/e2e/tests/settings.spec.ts
git commit -m "fix(web): a late save resets only its own settings form (#161)"
```

---

### Task 2: A late failure is reported, and a late save refreshes an Edit form for its instance

Covers criteria 4 and 5 (and their share of 6).

**Files:**
- Modify: `web/src/views/settings.ts` — `save()` inside `instanceForm()`
- Test: `.claude/e2e/tests/settings.spec.ts` — three tests appended at the end

**Interfaces:**
- Consumes: `holdNextRequest(page, url, method)` and `HeldAnswer` from Task 1.

- [ ] **Step 1: Append the three tests**

```ts
const saveFailure = { status: 500, json: { code: "store_failed", message: "could not save the instance" } };

test("a save failing after its form was replaced reports in the page error slot", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");
  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();

  const held = await holdNextRequest(page, "**/api/instances/*", "PATCH");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("Work Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await held.arrived;

  await page.getByRole("button", { name: "Cancel changes" }).click();
  held.release(saveFailure);

  await expect(page.getByText("Could not save Work: could not save the instance")).toBeVisible();
  await expect(page.locator("form").getByText("could not save the instance")).toHaveCount(0);
});

test("a save failing with its form still shown reports in the form", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");
  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();

  const held = await holdNextRequest(page, "**/api/instances/*", "PATCH");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("Work Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await held.arrived;

  held.release(saveFailure);

  await expect(page.locator("form").getByText("could not save the instance", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Edit Work" })).toBeVisible();
});

test("an Edit form opened on the instance being saved shows the saved values", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");
  await addInstance(page);
  await expect(page.getByText("Work", { exact: true })).toBeVisible();

  const held = await holdNextRequest(page, "**/api/instances/*", "PATCH");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("Work Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await held.arrived;

  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByLabel("Name")).toHaveValue("Work");

  held.release();

  await expect(page.getByRole("heading", { name: "Edit Work Renamed" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Work Renamed");
});
```

- [ ] **Step 2: Run the spec, confirm RED**

Expected: the replaced-form failure test and the same-instance Edit test FAIL. The in-form failure
test passes already — it guards today's behaviour, per criterion 4's second half.

- [ ] **Step 3: Implement in `save()`**

Keep the saved instance, rebuild a same-instance Edit form, and route a late failure:

```ts
    try {
      const saved = editing ? await updateInstance(editing.id, draft) : await createInstance(draft);
      await refresh(regions);
      if (editing) {
        clearRowStatus(regions, editing.id);
      }
      // The user may have moved on while this save was in flight (#161). An Edit
      // form they opened on this same instance was filled from pre-save values.
      if (regions.formCard.contains(card)) {
        showForm(regions, undefined);
      } else if (regions.formCard.querySelector(`[data-editing-id="${saved.id}"]`)) {
        showForm(regions, saved);
      }
    } catch (error) {
      if (regions.formCard.contains(card)) {
        status.replaceChildren(alertFor("error", messageOf(error)));
        submit.removeAttribute("disabled");
      } else {
        const label = editing?.name ?? (draft.name || "the new instance");
        regions.errorSlot.replaceChildren(alertFor("error", `Could not save ${label}: ${messageOf(error)}`));
      }
    }
```

- [ ] **Step 4: Run the spec, confirm GREEN**, then `make verify` (lint, tsc, tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/views/settings.ts .claude/e2e/tests/settings.spec.ts
git commit -m "fix(web): a late save's failure and saved values reach the form on screen (#161)"
```
