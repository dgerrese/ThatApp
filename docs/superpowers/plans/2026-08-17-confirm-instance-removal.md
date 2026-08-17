# Confirm before removing a Jira instance — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-08-17
**Supersedes:** nothing
**Superseded by:** nothing

**Goal:** Make removing a Jira instance ask first, and stop the Settings view wiping itself on every
mutation — the two are the same lines of code.

**Architecture:** A `wd-confirm` WebComponent wrapping a native `<dialog>`, with a promise helper
`confirmDestructive()` over it, so a call site reads as one statement instead of a pair of event
handlers. Then the view stops calling `container.replaceChildren()`: `render()` builds three
persistent regions, `refresh()` reconciles the instance list against the DOM by `instance.id`, and
`showForm()` swaps the form card's contents in place so Edit and Cancel are the same path.

**Tech Stack:** Vanilla TypeScript (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`),
Tailwind CSS v4 with the semantic tokens #30 established, native WebComponents in light DOM,
Playwright for tests, everything in Docker.

**Spec:** `docs/superpowers/specs/2026-08-17-confirm-instance-removal-design.md` — read it before
starting. It holds the rejected alternatives (`window.confirm()`, an inline two-step button, a
region split without diffing, an observable store) and why each lost.

**Issue:** [#29](https://github.com/dgerrese/work-dashboard/issues/29). Branch:
`issue-29-confirm-removal`, already cut and holding the design commit.

## Global Constraints

- **Everything runs in Docker.** There is no Go, Node or npm on the host. Never run them bare.
- **No JavaScript frameworks.** Vanilla TS only, `strict` with `noUncheckedIndexedAccess` and
  `verbatimModuleSyntax`. Do not weaken `tsconfig.json`; no `any`, no `as any`, no non-null
  assertions. Type-only imports use `import type` on their own line.
- **Reusable UI is a `wd-*` WebComponent in light DOM, never shadow DOM** — shadow roots stop
  Tailwind utilities reaching component internals.
- **No stock Tailwind colour utility may appear in `web/src/`.** #30 established this and a grep
  enforces it. Use the semantic tokens: `bg-raised`, `border-edge`, `text-ink`, `text-ink-muted`,
  `bg-danger-solid`, `text-danger-solid-ink`, `hover:bg-danger-solid-hover`.
- **There is no scrim or overlay token.** Lean on `<dialog>`'s default `::backdrop`. Reaching for
  `bg-black/50` would break the constraint above.
- **Browser support is Firefox (primary) and Chromium.** Safari and WebKit are an explicit non-goal:
  do not add WebKit to the Playwright matrix, and do not raise it as missing coverage.
- **Tests assert computed styles, attributes and requests — never class names.**
- **ESLint runs `js.configs.recommended`**, which includes `no-empty`: a `catch` block needs a
  comment to pass.
- **`wd-button`'s `label` attribute is the sole source of its inner button's accessible name.** One
  built without it renders a nameless button that role-based Playwright queries cannot find.
- **`wd-card` overwrites its own `className` in `connectedCallback`**, so spacing must live on a
  wrapper element.
- **Comments are rare and explain *why*.**

## File structure

| File | Responsibility | Task |
|---|---|---|
| `web/src/components/wd-confirm.ts` | **New.** The `<dialog>` wrapper and the `confirmDestructive()` promise helper. | 1 |
| `web/src/views/settings.ts` | Remove asks first (1); persistent regions and Cancel (2); keyed row reconciliation (3). | 1, 2, 3 |
| `.claude/e2e/tests/settings.spec.ts` | The whole test surface for this ticket. | 1, 2, 3 |

No server change: `DELETE /api/instances/{id}` is unchanged, so there are no Go tests in this plan.

## How to run things

```shell
make verify                    # lint + tsc + Go tests
make test-e2e                  # the whole Playwright suite, Firefox and Chromium
```

To run one spec during the loop:

```shell
docker compose --profile e2e run --build --rm playwright \
  sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/settings.spec.ts'
```

**Evidence discipline:** `CLAUDE.md` says never claim work is done without pasting the output. Run
each gate with a tee — `make verify 2>&1 | tee <workspace>/task-N-verify.log` — and paste the log's
real contents. Do not summarise a run into bullets.

---

### Task 1: `wd-confirm`, and Remove asks first

**Files:**
- Create: `web/src/components/wd-confirm.ts`
- Modify: `web/src/views/settings.ts` (the import block; `removeInstance`)
- Test: `.claude/e2e/tests/settings.spec.ts`

**Interfaces:**
- Consumes: `wd-button` (attributes `label`, `variant`), the #30 colour tokens.
- Produces:
  ```ts
  export function confirmDestructive(options: {
    heading: string;
    body: string;
    confirmLabel: string;
  }): Promise<boolean>;
  ```
  Resolves `true` on confirm, `false` on Cancel or Esc. Tasks 2 and 3 do not change it.

- [ ] **Step 1: Extend the API stub so a DELETE can be observed**

`.claude/e2e/tests/settings.spec.ts` currently stubs `**/api/instances` and
`**/api/instances/*/test`, and `stubInstancesApi` returns nothing. Add a DELETE route and return a
handle, so a test can assert that no request was made — a dialog that closes and deletes anyway is
the bug worth fearing, and only the request proves it did not happen.

Change the signature and the end of `stubInstancesApi`:

```ts
interface InstancesStub {
  deleteCount: () => number;
}

async function stubInstancesApi(
  page: Page,
  options: { testStatus: number },
): Promise<InstancesStub> {
```

Then, after the existing `page.route("**/api/instances/*/test", ...)` block, add:

```ts
  let deletes = 0;

  // A single path segment, so this never catches /api/instances/{id}/test.
  await page.route("**/api/instances/*", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.fallback();
      return;
    }

    const id = Number(new URL(route.request().url()).pathname.split("/").pop());
    const index = instances.findIndex((instance) => instance.id === id);
    if (index >= 0) {
      instances.splice(index, 1);
    }
    deletes += 1;
    await route.fulfill({ status: 204, body: "" });
  });

  return { deleteCount: () => deletes };
}
```

Existing call sites ignore the return value and keep working unchanged.

- [ ] **Step 2: Write the failing tests**

Append to `.claude/e2e/tests/settings.spec.ts`:

```ts
test("removing an instance asks first, and cancelling changes nothing", async ({ page }) => {
  const stub = await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");
  await addInstance(page);

  await page.getByRole("button", { name: "Remove" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Work");
  await expect(dialog).toContainText("cannot be undone");

  await dialog.getByRole("button", { name: "Cancel" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText("me@example.com · https://example.atlassian.net")).toBeVisible();
  expect(stub.deleteCount()).toBe(0);
});

test("confirming the dialog removes the instance", async ({ page }) => {
  const stub = await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");
  await addInstance(page);

  await page.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove instance" }).click();

  await expect(page.getByText("No instances yet. Add one below.")).toBeVisible();
  expect(stub.deleteCount()).toBe(1);
});

// Esc is the platform's own dismissal path, so a regression here would be silent.
test("pressing Escape cancels the removal", async ({ page }) => {
  const stub = await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");
  await addInstance(page);

  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText("me@example.com · https://example.atlassian.net")).toBeVisible();
  expect(stub.deleteCount()).toBe(0);
});
```

- [ ] **Step 3: Run them and watch them fail**

```shell
docker compose --profile e2e run --build --rm playwright \
  sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/settings.spec.ts'
```

Expected: the three new tests FAIL on both projects. The first and third fail waiting for a dialog
that never opens; the second fails because Remove deletes immediately, so there is no dialog to
click through. Paste the output.

- [ ] **Step 4: Write the component**

Create `web/src/components/wd-confirm.ts`:

```ts
import "./wd-button";

/**
 * Wraps a native <dialog> rather than building a modal from a div: showModal()
 * supplies the focus trap, the inert background, the top layer, Esc dismissal
 * and returning focus to whatever opened it. None of that is reimplemented.
 *
 * Backdrop-click dismissal is deliberately absent — <dialog> does not do it,
 * Esc already provides the safe exit, and adding it means hit-testing by hand.
 */
export class WdConfirm extends HTMLElement {
  connectedCallback(): void {
    if (this.querySelector("dialog")) return;

    const dialog = document.createElement("dialog");
    dialog.className = "max-w-sm rounded-lg border border-edge bg-raised p-4 text-ink shadow-sm";

    const heading = document.createElement("h2");
    heading.id = "wd-confirm-heading";
    heading.className = "mb-2 text-lg font-medium";
    heading.textContent = this.getAttribute("heading") ?? "";

    const body = document.createElement("p");
    body.id = "wd-confirm-body";
    body.className = "mb-4 text-sm text-ink-muted";
    body.textContent = this.getAttribute("body") ?? "";

    const actions = document.createElement("div");
    actions.className = "flex justify-end gap-2";
    const cancel = dialogButton("Cancel", "secondary");
    const confirm = dialogButton(this.getAttribute("confirm-label") ?? "Confirm", "danger");
    actions.append(cancel, confirm);

    dialog.setAttribute("aria-labelledby", heading.id);
    dialog.setAttribute("aria-describedby", body.id);
    dialog.append(heading, body, actions);
    this.append(dialog);

    cancel.addEventListener("click", () => {
      dialog.close("cancel");
    });
    confirm.addEventListener("click", () => {
      dialog.close("confirm");
    });

    dialog.showModal();
  }
}

function dialogButton(label: string, variant: string): HTMLElement {
  const element = document.createElement("wd-button");
  element.setAttribute("label", label);
  element.setAttribute("variant", variant);

  return element;
}

customElements.define("wd-confirm", WdConfirm);

/**
 * Resolves true only on the confirming button; Cancel, Esc and any other close
 * resolve false, so a mis-read never destroys anything.
 */
export function confirmDestructive(options: {
  heading: string;
  body: string;
  confirmLabel: string;
}): Promise<boolean> {
  const element = document.createElement("wd-confirm");
  element.setAttribute("heading", options.heading);
  element.setAttribute("body", options.body);
  element.setAttribute("confirm-label", options.confirmLabel);
  document.body.append(element);

  const dialog = element.querySelector("dialog");
  if (!dialog) {
    element.remove();

    return Promise.resolve(false);
  }

  // <dialog>'s close event does not bubble, so this listens on the dialog itself.
  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => {
        const confirmed = dialog.returnValue === "confirm";
        element.remove();
        resolve(confirmed);
      },
      { once: true },
    );
  });
}
```

**Nothing styles `::backdrop`, deliberately.** `showModal()` gets a translucent scrim from the UA
stylesheet, and author CSS beats UA-origin styles regardless of specificity — so writing any
`backdrop:` utility, including `backdrop:bg-transparent`, *erases* that dimming rather than
preserving it. Leaving it to the browser means writing nothing. There is no scrim token, and
inventing a colour here would break #30's no-stock-utility rule.

*(Corrected 2026-08-17 after Task 1's review: this plan originally mandated
`backdrop:bg-transparent` with a rationale that was factually backwards.)*

- [ ] **Step 5: Ask before deleting**

In `web/src/views/settings.ts`, add to the component imports at the top:

```ts
import "../components/wd-confirm";
```

and to the value imports:

```ts
import { confirmDestructive } from "../components/wd-confirm";
```

Then replace `removeInstance` (currently at lines 136-151) with:

```ts
async function removeInstance(
  container: HTMLElement,
  instance: Instance,
  trigger: HTMLElement,
  status: HTMLElement,
): Promise<void> {
  const confirmed = await confirmDestructive({
    heading: `Remove ${instance.name}?`,
    body: "Its pinned issues and any time logged against it are deleted too. This cannot be undone.",
    confirmLabel: "Remove instance",
  });
  if (!confirmed) return;

  trigger.setAttribute("disabled", "");

  try {
    await deleteInstance(instance.id);
    await refresh(container);
  } catch (error) {
    status.replaceChildren(alertFor("error", messageOf(error)));
    trigger.removeAttribute("disabled");
  }
}
```

The wording never enumerates the cascade, so it stays true as #6–#11 add tables to it.

- [ ] **Step 6: Run the spec and watch it pass**

```shell
docker compose --profile e2e run --build --rm playwright \
  sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/settings.spec.ts'
```

Expected: all settings tests pass on both projects — the four that existed plus your three.

- [ ] **Step 7: Verify and commit**

```shell
make verify 2>&1 | tee .superpowers/sdd/2026-08-17-confirm-instance-removal/task-1-verify.log
git add web/src/components/wd-confirm.ts web/src/views/settings.ts .claude/e2e/tests/settings.spec.ts
git commit -m "feat(web): confirm before removing a Jira instance"
```

---

### Task 2: Persistent regions, and Cancel in edit mode

Stops the view rebuilding everything on every mutation. This is what makes a typed-but-unsaved Add
form survive a removal, and what gives edit mode the Cancel it has never had.

**Files:**
- Modify: `web/src/views/settings.ts` (`render`, `refresh`, `instanceRow`'s edit handler,
  `instanceForm`)
- Test: `.claude/e2e/tests/settings.spec.ts`

**Interfaces:**
- Consumes: `confirmDestructive` from Task 1, unchanged.
- Produces: `showForm(instance | undefined): void` — swaps the form card's contents in place. Task 3
  calls nothing new.

- [ ] **Step 1: Write the failing tests**

```ts
test("typed input survives removing another instance", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");
  await addInstance(page);

  await page.getByLabel("Name").fill("Half-typed");

  await page.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove instance" }).click();

  await expect(page.getByText("No instances yet. Add one below.")).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Half-typed");
});

test("editing can be cancelled", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");
  await addInstance(page);

  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByLabel("Name")).toHaveValue("Work");

  await page.getByRole("button", { name: "Cancel changes" }).click();

  await expect(page.getByRole("button", { name: "Add instance" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("");
  await expect(page.getByText("me@example.com · https://example.atlassian.net")).toBeVisible();
});
```

The Cancel button is labelled **"Cancel changes"**, not "Cancel", so it never collides with the
confirm dialog's Cancel in a role query.

- [ ] **Step 2: Run them and watch them fail**

Expected: the first fails because the Add form is rebuilt by `refresh()` and the typed value is
gone; the second fails because no "Cancel changes" button exists — and note that today's edit mode
also destroys the instance list, so the last assertion could not pass either. Paste the output.

- [ ] **Step 3: Split the view into persistent regions**

Replace `render` and `refresh` (lines 10-38) with:

```ts
let listCard: HTMLElement;
let formCard: HTMLElement;
let errorSlot: HTMLElement;

export async function render(root: HTMLElement): Promise<void> {
  errorSlot = document.createElement("div");

  listCard = document.createElement("div");
  formCard = document.createElement("div");
  formCard.className = "mt-6";

  // wd-card overwrites its own className on connect, so the spacing lives on a
  // wrapper. Appearance sits outside the regions refresh() touches.
  const appearance = document.createElement("div");
  appearance.className = "mt-6";
  appearance.append(appearanceCard());

  root.append(errorSlot, listCard, formCard, appearance);

  showForm(undefined);
  await refresh();
}

async function refresh(): Promise<void> {
  let instances: Instance[];
  try {
    instances = await listInstances();
  } catch (error) {
    errorSlot.replaceChildren(alertFor("error", messageOf(error)));

    return;
  }

  errorSlot.replaceChildren();
  listCard.replaceChildren(instanceList(instances));
}

function showForm(editing: Instance | undefined): void {
  formCard.replaceChildren(instanceForm(editing));
}
```

Module-level `let` bindings rather than threading three elements through every function: this view
is a singleton — `render()` is called once per navigation and the router replaces `#view` wholesale
— and passing them down would touch every signature for nothing.

The error slot is separate from the list card, which is what lets a failed initial load show the
error *and* the Add form instead of an empty page.

- [ ] **Step 4: Drop the `container` parameter**

`container` no longer exists. Update these signatures and their bodies to match:

```ts
function instanceList(instances: Instance[]): HTMLElement
function instanceRow(instance: Instance): HTMLElement
function instanceForm(editing: Instance | undefined): HTMLElement
async function removeInstance(
  instance: Instance,
  trigger: HTMLElement,
  status: HTMLElement,
): Promise<void>
```

Inside them: `instanceList` calls `instanceRow(instance)`; `removeInstance` calls `await refresh()`;
`instanceForm`'s `save()` calls `await refresh()` and then `showForm(undefined)` so a successful
edit returns to the Add form.

The edit handler in `instanceRow` becomes:

```ts
  edit.addEventListener("click", () => {
    showForm(instance);
  });
```

- [ ] **Step 5: Add the Cancel affordance**

In `instanceForm`, after the `submit` button is created:

```ts
  const actions = document.createElement("div");
  actions.className = "flex gap-2";
  actions.append(submit);

  if (editing) {
    const cancel = button("Cancel changes", "secondary");
    cancel.addEventListener("click", () => {
      showForm(undefined);
    });
    actions.append(cancel);
  }
```

and append `actions` where `submit` was appended:

```ts
  form.append(name.wrapper, siteUrl.wrapper, email.wrapper, token.wrapper, status, actions);
```

- [ ] **Step 6: Run the spec, then the whole suite**

```shell
docker compose --profile e2e run --build --rm playwright \
  sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/settings.spec.ts'
make test-e2e 2>&1 | tee .superpowers/sdd/2026-08-17-confirm-instance-removal/task-2-e2e.log
```

Expected: all settings tests pass, and the theme and smoke specs still pass — `render()` changed
shape, and the theme spec drives this same view.

- [ ] **Step 7: Verify and commit**

```shell
make verify 2>&1 | tee .superpowers/sdd/2026-08-17-confirm-instance-removal/task-2-verify.log
git add web/src/views/settings.ts .claude/e2e/tests/settings.spec.ts
git commit -m "refactor(web): persistent regions in Settings, and Cancel in edit mode"
```

---

### Task 3: Keyed row reconciliation

The last of the three parked findings. With the list card still rebuilt wholesale, a connection test
running on one row loses its result the moment another row is saved — the result renders into a node
that is no longer in the document.

**Files:**
- Modify: `web/src/views/settings.ts` (`refresh`, `instanceList`, `instanceRow`)
- Test: `.claude/e2e/tests/settings.spec.ts`

**Interfaces:**
- Consumes: everything from Task 2.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

```ts
// The row's node must survive a sibling's save, or the awaited result renders
// into detached DOM and the user never sees it.
test("an in-flight connection test survives another row being saved", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");
  await addInstance(page);

  await page.route("**/api/instances/*/test", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({ status: 200, json: { accountId: "5b10a2", displayName: "Dion" } });
  });

  await page.getByRole("button", { name: "Test" }).click();
  await expect(page.getByText("Testing…")).toBeVisible();

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("Connected as Dion.")).toBeVisible({ timeout: 5000 });
});
```

- [ ] **Step 2: Run it and watch it fail**

Expected: FAIL — "Connected as Dion." never appears, because the save rebuilds the list card and the
row holding the pending result is discarded. Paste the output.

- [ ] **Step 3: Reconcile instead of rebuilding**

Replace `refresh`'s success path and `instanceList` with:

```ts
async function refresh(): Promise<void> {
  let instances: Instance[];
  try {
    instances = await listInstances();
  } catch (error) {
    errorSlot.replaceChildren(alertFor("error", messageOf(error)));

    return;
  }

  errorSlot.replaceChildren();
  reconcileList(instances);
}

function reconcileList(instances: Instance[]): void {
  const card = listCard.querySelector<HTMLElement>("wd-card") ?? emptyListCard();

  // Never replaceChildren() on the card itself: wd-card injects its heading once,
  // in connectedCallback, so wiping its children deletes the heading with no way
  // to get it back.
  const notice = card.querySelector("[data-empty-notice]");
  let list = card.querySelector("ul");

  if (instances.length === 0) {
    list?.remove();
    if (!notice) {
      card.append(emptyNotice());
    }

    return;
  }

  notice?.remove();
  if (!list) {
    list = newList();
    card.append(list);
  }

  const existing = new Map<string, HTMLElement>();
  for (const row of list.querySelectorAll<HTMLElement>("li[data-instance-id]")) {
    const key = row.dataset["instanceId"];
    if (key !== undefined) {
      existing.set(key, row);
    }
  }

  // Appending a node that is already a child moves it, so this also enforces
  // the server's ordering without a separate pass.
  for (const instance of instances) {
    const key = String(instance.id);
    const row = existing.get(key);
    if (row) {
      existing.delete(key);
      patchRow(row, instance);
      list.append(row);
    } else {
      list.append(instanceRow(instance));
    }
  }

  for (const stale of existing.values()) {
    stale.remove();
  }
}
```

with these three helpers, next to the other local helpers:

```ts
function emptyListCard(): HTMLElement {
  const card = document.createElement("wd-card");
  card.setAttribute("heading", "Jira instances");
  listCard.replaceChildren(card);

  return card;
}

function newList(): HTMLUListElement {
  const list = document.createElement("ul");
  list.className = "divide-y divide-edge";

  return list;
}

function emptyNotice(): HTMLElement {
  const empty = document.createElement("p");
  empty.dataset["emptyNotice"] = "";
  empty.className = "text-sm text-ink-muted";
  empty.textContent = "No instances yet. Add one below.";

  return empty;
}
```

`instanceList` is now unused — delete it rather than leaving it to rot.

- [ ] **Step 4: Patch a surviving row in place**

Split the text-setting parts of `instanceRow` out so both paths share them. `instanceRow` keeps
building the structure and wiring the handlers, and ends by calling `patchRow(row, instance)` for the
text. Add:

```ts
function patchRow(row: HTMLElement, instance: Instance): void {
  const name = row.querySelector<HTMLElement>("[data-row-name]");
  const detail = row.querySelector<HTMLElement>("[data-row-detail]");
  if (name) {
    name.textContent = instance.name;
  }
  if (detail) {
    detail.textContent = `${instance.email} · ${instance.siteUrl || "no site URL"}`;
  }
}
```

which means the two paragraphs in `instanceRow` need the hooks `patchRow` looks for:

```ts
  const name = document.createElement("p");
  name.dataset["rowName"] = "";
  name.className = "font-medium";

  const detail = document.createElement("p");
  detail.dataset["rowDetail"] = "";
  detail.className = "text-sm text-ink-muted";
```

Leave the no-site-URL warning where it is: it is appended once when the row is built, and an
instance that gains a site URL is re-rendered through the edit path anyway.

- [ ] **Step 5: Run the spec, then the whole suite**

```shell
docker compose --profile e2e run --build --rm playwright \
  sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/settings.spec.ts'
make test-e2e 2>&1 | tee .superpowers/sdd/2026-08-17-confirm-instance-removal/task-3-e2e.log
```

Expected: everything green on Firefox and Chromium.

- [ ] **Step 6: Verify and commit**

```shell
make verify 2>&1 | tee .superpowers/sdd/2026-08-17-confirm-instance-removal/task-3-verify.log
git add web/src/views/settings.ts .claude/e2e/tests/settings.spec.ts
git commit -m "refactor(web): reconcile instance rows by id instead of rebuilding"
```

---

## Self-review against the spec

- **`wd-confirm`** — Task 1: light DOM, native `<dialog>`, `showModal()`, the promise helper with the
  spec's exact signature, `aria-labelledby`/`aria-describedby`, `label` on every `wd-button`, no
  backdrop-click dismissal, `::backdrop` left to the browser.
- **The static wording** — Task 1, Step 5, naming the instance and never enumerating the cascade. No
  counts, no counts endpoint, no server change anywhere in this plan.
- **The removal flow** — Task 1: cancel leaves the button enabled and fires no request; confirm
  disables, deletes, refreshes.
- **Persistent regions and `showForm`** — Task 2, including the error slot that lets a failed initial
  load still render the Add form.
- **Keyed reconciliation** — Task 3, keyed on `instance.id` via the `data-instance-id` the markup
  already carries, with ordering taken from the server.
- **The three parked findings** — typed input (Task 2, test 1), the in-flight test result (Task 3,
  test 1), the failed initial load (Task 2, structural; covered indirectly — see below).
- **Testing** — the spec's seven scenarios map to Task 1 (dialog appears and names the instance,
  cancel fires no DELETE, confirm fires it, Esc cancels), Task 2 (typed input survives, Cancel in
  edit mode) and Task 3 (in-flight test survives).

**One gap I am flagging rather than hiding:** the spec lists the failed-initial-load fix as an
outcome, and this plan makes it structural but writes no test for it — stubbing a failing
`GET /api/instances` and asserting the Add form still renders would be a fourth test in Task 2. It is
worth adding if the implementer finds it cheap; if not, it should be raised in the whole-branch
review rather than silently dropped.

**Deviation from the spec worth noting:** the spec says the Cancel affordance is "the missing Cancel
in edit mode" without naming it. This plan labels it **"Cancel changes"** so that role-based queries
cannot confuse it with the confirm dialog's "Cancel" — a testability constraint the spec did not
anticipate.
