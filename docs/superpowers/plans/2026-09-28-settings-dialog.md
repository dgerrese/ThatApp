# Settings as a dialog (#89) Implementation Plan

**Date:** 2026-09-28
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings leaves the nav and becomes a modal dialog opened by a cog beside the wordmark;
inside it the instance list is the subject (dot, `host · email`, icon buttons, health on demand),
adding or editing an instance is an action, and the theme is a three-way segment.

**Architecture:** `web/src/views/settings.ts` moves to `web/src/settings-dialog.ts` and exports
`showSettings()`, which builds a native `<dialog>` appended to `<body>` over whatever view is
mounted. A three-line `web/src/open-settings.ts` lazy-imports it, so its code stays out of the
initial response; the rail's cog (`index.html`, wired in `main.ts`) and Today's "Open Settings" both
call it. The `/settings` route goes. A connection-test verdict lives in a module-level `Map` keyed
by instance id — the page's memory, never the database.

**Tech Stack:** vanilla TypeScript (strict, `noUncheckedIndexedAccess`), light-DOM `that-*`
components, Tailwind CSS v4, `node --test` units, Playwright e2e on Firefox and Chromium.

**Spec:** the refined body of Codeberg issue #89 — its acceptance criteria are the spec. Read it:
`tea api "repos/{owner}/{repo}/issues/89" | python3 -c "import sys,json;print(json.load(sys.stdin)['body'])"`.
The drawing is `docs/superpowers/prototypes/2026-09-03-app-prototype.html` (cited below as
`proto:<line>`). The language is `docs/superpowers/specs/2026-09-03-visual-language-design.md`
(current) over `docs/superpowers/specs/2026-08-20-visual-design-language.md` (still governs the
nav). #11's fallback is decision 10 of `docs/superpowers/specs/2026-09-02-week-view-design.md`.

## Not drawn — needs the owner

The prototype draws exactly two health states — `Connected · 14:22` (proto:464, `.health.ok`) and
`Not tested` (proto:464, `.health.un`) — and every row with a site URL. Nothing below is drawn. **No
task invents it.** Each carries the app's *already shipped* treatment unchanged, so every task can
proceed, and each is one small follow-up once the owner draws it.

1. **A failed verdict.** The ticket names the words, *Token cannot write*, but no tone, mark or
   placement. Worse, the connection test cannot produce it (see *Contradicted* below). Until drawn:
   the health slot is empty and the server's own message stays in the shipped error alert beneath
   the row, exactly as today.
2. **A test in flight.** Until drawn: the shipped `Testing…` warning alert beneath the row, with the
   test button disabled.
3. **A migrated instance with no site URL** has no host for `host · email`. Until drawn: the line
   reads the email alone, and the shipped *no site URL* warning alert stays beneath the row.
4. **The empty list, a failed list read and a failed save** — the shipped text (`No instances yet.
   Add one below.`) and alerts, carried over unchanged.
5. **Today's no-instances "Open Settings"** — the shipped link look, now a `<button>` that opens the
   dialog instead of navigating.

## Contradicted by the code or the drawing — report to the owner

- **"The failing case reads *Token cannot write*" cannot happen.** `POST /api/instances/{id}/test`
  only reads (`#80`'s shipped comment above `tokenNote()` in `settings.ts`: *"the connection test
  only reads, and Jira has no side-effect-free write to probe a token's write scope with"*). A token
  missing `write:jira-work` passes the test. The verdict the test *can* fail with is rejected
  credentials or an unreachable site.
- **Stroke weights.** The ticket calls the cog *"the only icon in the set with its own stroke
  weight"*, but the drawing also draws the health check at `2.2` (proto:464) and the Add button's
  plus at `2` with its own geometry (proto:465, `#p-plus` proto:375). This plan draws both at the
  set's `1.9` through `iconMarkup()` and reuses the app's existing `plus`; the drawing needs
  correcting, or the exception list extending.
- **Host in mono.** The ticket says *"with the host in the mono face"*; the drawing sets the whole
  `host · email` line in mono (`.ihost`, proto:258). This plan builds the drawing.
- **Half-pixel sizes.** `.ihost` and `.health` are 12.5px (proto:258–259), the segment 13.5px
  (proto:268). The ramp has no such steps; they round up to `text-sm` (13) and `text-base` (14), as
  #80's 11.5px `.scope` went to `text-xs`.
- **Row control size.** Decision 6 says 18px in a row control; the drawing draws these at 17px
  (proto:464), as the entry dialog's row actions already are.
- **The drawn verdict drops the account name** the shipped `Connected as Dion.` carries.
- **"The pattern the app already uses twice"** is three dialogs now: `that-confirm`,
  `that-entry-dialog`, `that-stop-dialog`.

## Global Constraints

- **No Go, Node or npm on the host.** Everything runs through `make` or `docker compose`.
  Merge gate: `make verify` and `make test-e2e`. One spec:
  `docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/<file>.spec.ts'`
  (`make test-e2e`'s own recipe first runs `docker compose --profile e2e rm --stop --force app-e2e`;
  do the same if the app under test looks stale).
- **No JavaScript frameworks.** Vanilla TS; Tailwind CSS v4 utilities; theme values only in `@theme`
  in `web/src/styles.css` (this plan adds none).
- **Light DOM only.** No shadow roots. Reusable UI is a `that-*` component; Settings has one call
  site and is a plain module, like `toolbarButton`.
- **The initial HTTP response stays under 14kB** (`14336` bytes). Checked by
  `TestServedIndexHTMLStaysUnderByteBudget` in `make verify`, by `wc -c web/index.html`, and by
  confirming after `make build-web` that `web/dist/app.js` does not contain `Jira instances`.
- **TypeScript strict.** No `any`, `as any` or non-null assertion (`!`), in app code or tests.
- **Few comments** — only a non-obvious why. Prettier is checked by `make lint`; run `make fmt`.
- **No schema change, no migration, no new `THAT_*` variable, no server change.** Nothing under
  `internal/` or `cmd/` changes (`git diff --stat issue-143-keyboard-and-cut-text -- internal cmd`
  is empty at the end).
- **Firefox and Chromium.** The rig runs both. WebKit is a non-goal.
- **Every screen change is compared against the drawing** by the implementer, in writing, in the
  task report: *what was compared (prototype lines) and what was found*. "Looks right" is not a
  comparison. A difference the task forces goes to the owner.
- **Screenshots come in dark and light pairs** for the pull request (Task 6).
- **Icon rule:** every mark goes through `iconMarkup()` at `1.9`, except the cog at `1.7`.
- **Commits:** if signing fails, commit unsigned with `git -c commit.gpgsign=false commit …`.
  **Never push.** End every commit message with the two trailer lines
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_013gDshWEs5sASn44YtYXCzp`.

## Review Focus

1. **Instances change while Settings is over a view.** Today was drawn from the instances as they
   were, and removing one deletes entries the rail still counts. Closing after a save or removal
   must redraw the view beneath and re-read the rail; closing after nothing must not. Test in Task 1.
2. **A second press on the cog before the Settings chunk arrives** must open one dialog, not two.
   Test in Task 1.
3. **A freed id.** SQLite hands a removed instance's id to the next instance created (no
   `AUTOINCREMENT`), so a verdict left in the map would appear on a brand-new instance. Removal must
   forget it. Test in Task 2.
4. **A test still running when Settings closes** must record its verdict, and the verdict must show
   on reopen. Test in Task 2.
5. **Escape while the removal confirm is open** closes the confirm only; Settings stays open. Test
   in Task 2.

---

## File map

| File | Change |
| --- | --- |
| `web/src/views/settings.ts` → `web/src/settings-dialog.ts` | `git mv`; the dialog (Tasks 1–4) |
| `web/src/open-settings.ts` | new: lazy loader (Task 1) |
| `web/index.html` | cog replaces the Settings nav row (Task 1) |
| `web/src/main.ts` | wires the cog (Task 1) |
| `web/src/router.ts` | drops `/settings` (Task 1) |
| `web/src/views/today.ts` | "Open Settings" becomes a button; stale comment (Task 1) |
| `web/src/rail.ts`, `web/src/sw.ts` | comments that name Settings as a view (Task 1) |
| `web/src/components/that-tooltip.ts` | `anchor="right"` (Task 1) |
| `web/src/icons.ts`, `web/src/icons.test.ts` | `plug`, `check` (Task 2) |
| `.claude/e2e/tests/*.spec.ts` | migrated off `/settings` (Task 1), then per task |
| three specs under `docs/superpowers/specs/` | Task 5 |

---

### Task 1: The dialog shell, the cog, and the route gone

**Files:**
- Move: `web/src/views/settings.ts` → `web/src/settings-dialog.ts`
- Create: `web/src/open-settings.ts`
- Modify: `web/index.html:71` (wordmark) and `:168-198` (Settings nav row), `web/src/main.ts`,
  `web/src/router.ts:37`, `web/src/views/today.ts:1176-1197`, `web/src/rail.ts:18,76`,
  `web/src/sw.ts:122`, `web/src/components/that-tooltip.ts` (`reveal()`)
- Test: `.claude/e2e/tests/settings.spec.ts`, and every spec that routes to `/settings`:
  `router.spec.ts:69`, `pwa.spec.ts:202,250-256,264-300,460,553-555,609,785,818`,
  `theme.spec.ts:95-200`, `keyboard-audit.spec.ts:80,117`, `entries.spec.ts:389-411`,
  `timer.spec.ts:657-690`, `week.spec.ts:1668-1700`, `today.spec.ts:135-141,219-235,256-275,340-358`

**Interfaces:**
- Produces: `openSettings(): Promise<void>` in `web/src/open-settings.ts`;
  `showSettings(): void` in `web/src/settings-dialog.ts`; the dialog is
  `getByRole("dialog", { name: "Settings" })`, its panel `[data-settings-panel]`; the cog is
  `button#settings-cog`, accessible name `Settings`; `that-tooltip` accepts `anchor="right"`.
- Produces for Tasks 2–4: `interface Regions { errorSlot; listSlot; formSection; latestListRead;
  changed }`, `SECTION_CLASS`, `SECTION_HEADING_CLASS`, `section(heading)`, `themeControl()`.

**Drawing:** `.wmrow`/`.cog` proto:62–67 and :387; `.tip.right` proto:168; nav proto:400–403 (two
rows); `.scroller`/`.sheet`/`.sheeth`/`.sect`/`.secth` proto:245–253 and :460–462.

- [ ] **Step 1: Write the failing tests.** Replace the helpers block at the top of
  `.claude/e2e/tests/settings.spec.ts` as follows. Change the import to
  `import { expect, test, type Locator, type Page } from "@playwright/test";` and add, after
  `stubInstancesApi`:

```ts
/**
 * Settings is a dialog over a view, so every test opens Today first — stubbed
 * empty, so it never reaches a real Jira — and presses the rail's cog.
 */
async function stubToday(page: Page): Promise<void> {
  await page.route("**/api/issues", (route) =>
    route.fulfill({ status: 200, json: { instances: [] } }),
  );
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
}

async function openSettings(page: Page): Promise<Locator> {
  await stubToday(page);
  await page.goto("/today");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();

  return settings;
}

function listed(id: number, name: string): StubInstance {
  return {
    id,
    name,
    siteUrl: `https://${name.toLowerCase()}.atlassian.net`,
    apiBaseUrl: "https://api.atlassian.com/ex/jira/abc",
    email: "dion@this.nl",
    createdAt: `2026-09-0${String(id)}T09:00:00Z`,
  };
}

async function stubListed(page: Page, instances: StubInstance[]): Promise<void> {
  await page.route("**/api/instances", (route) => route.fulfill({ status: 200, json: instances }));
}

async function panelBox(settings: Locator): Promise<{ top: number; height: number }> {
  const box = await settings.locator("[data-settings-panel]").boundingBox();
  if (!box) throw new Error("the panel did not lay out");

  return { top: box.y, height: box.height };
}

const confirmDialog = (page: Page) => page.getByRole("dialog", { name: /^Remove / });
```

Then migrate the existing tests mechanically — nothing else in them changes in this task:
  - every `await page.goto("/settings");` → `await openSettings(page);`
  - every `page.getByRole("dialog")` → `confirmDialog(page)` (the confirm is now a second dialog;
    an unnamed role query matches both)
  - in "pressing Escape cancels the removal", append
    `await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();` — Review Focus 5
  - in `expectTokenNote`'s callers: `"that-card:not([data-editing-id])"` →
    `"[data-instance-form]:not([data-editing-id])"`, `"that-card[data-editing-id]"` →
    `"[data-instance-form][data-editing-id]"`
  - delete "settings is reachable from the shell nav" (replaced below)

Append:

```ts
test.describe("the dialog", () => {
  test("the cog opens Settings over the view, which stays mounted", async ({ page }) => {
    await stubListed(page, []);
    const settings = await openSettings(page);

    await expect(page).toHaveURL(/\/today$/);
    await expect(page.locator("#view").getByText("No Jira instances yet.")).toHaveCount(1);
    await expect(page.getByRole("navigation").getByRole("link")).toHaveText(["Today", "Week"]);
    await expect(settings.getByRole("heading", { name: "Jira instances" })).toBeVisible();
  });

  test("the cog sits beside the wordmark at the rail's top right, at 1.7 stroke", async ({ page }) => {
    await stubToday(page);
    await page.goto("/today");

    const cog = page.getByRole("button", { name: "Settings", exact: true });
    await expect(cog.locator("svg")).toHaveAttribute("stroke-width", "1.7");
    await expect(cog.locator("svg")).toHaveAttribute("width", "17");

    const cogBox = await cog.boundingBox();
    const navBox = await page.getByRole("link", { name: "Today", exact: true }).boundingBox();
    const markBox = await page.getByRole("heading", { name: "ThatApp" }).boundingBox();
    if (!cogBox || !navBox || !markBox) throw new Error("the rail did not lay out");

    expect(cogBox.width).toBe(34);
    // proto:64 — the hover box ends on the rail's content edge, as the nav rows do.
    expect(Math.abs(cogBox.x + cogBox.width - (navBox.x + navBox.width))).toBeLessThanOrEqual(1);
    expect(
      Math.abs(cogBox.y + cogBox.height / 2 - (markBox.y + markBox.height / 2)),
    ).toBeLessThanOrEqual(1);

    await cog.hover();
    const tip = page.locator('that-tooltip[for="settings-cog"]');
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText("Settings");
    const tipBox = await tip.boundingBox();
    if (!tipBox) throw new Error("the tooltip did not lay out");
    // proto:168, .tip.right — 9px to the right, centred on the cog.
    expect(Math.abs(tipBox.x - (cogBox.x + cogBox.width + 9))).toBeLessThanOrEqual(1);
    expect(
      Math.abs(tipBox.y + tipBox.height / 2 - (cogBox.y + cogBox.height / 2)),
    ).toBeLessThanOrEqual(1);
  });

  test("a panel shorter than the window is centred by its own auto margin", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1600 });
    await stubListed(page, []);
    const settings = await openSettings(page);

    const { top, height } = await panelBox(settings);
    expect(top).toBeGreaterThan(28);
    expect(Math.abs(top - (1600 - height) / 2)).toBeLessThanOrEqual(1);
  });

  test("a panel taller than the window scrolls as one piece, and its top is reachable", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 400 });
    await stubListed(page, [1, 2, 3, 4, 5, 6, 7, 8].map((id) => listed(id, `Site${String(id)}`)));
    const settings = await openSettings(page);
    await expect(settings.getByText("Site8", { exact: true })).toBeAttached();

    const scroll = await settings.evaluate((dialog) => {
      const panel = dialog.querySelector("[data-settings-panel]");
      if (!(panel instanceof HTMLElement)) throw new Error("no panel");
      dialog.scrollTop = 0;
      const top = panel.getBoundingClientRect().top;
      dialog.scrollTop = dialog.scrollHeight;
      const bottom = panel.getBoundingClientRect().bottom;

      return {
        top,
        bottom,
        viewport: window.innerHeight,
        dialogScrolls: dialog.scrollHeight > dialog.clientHeight,
        panelScrolls: panel.scrollHeight > panel.clientHeight,
      };
    });

    expect(scroll.dialogScrolls).toBe(true);
    expect(scroll.panelScrolls).toBe(false);
    expect(Math.abs(scroll.top - 28)).toBeLessThanOrEqual(1);
    expect(Math.abs(scroll.bottom - (scroll.viewport - 28))).toBeLessThanOrEqual(1);
  });

  test("Escape closes Settings", async ({ page }) => {
    await stubListed(page, []);
    const settings = await openSettings(page);

    await page.keyboard.press("Escape");

    await expect(settings).toHaveCount(0);
  });

  test("a second press while Settings loads opens one dialog, not two", async ({ page }) => {
    await stubListed(page, []);
    await stubToday(page);
    await page.goto("/today");

    await page.getByRole("button", { name: "Settings", exact: true }).dblclick();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    // No positive signal exists for "a second one did not arrive late".
    await page.waitForTimeout(300);

    expect(await page.locator("dialog").count()).toBe(1);
  });

  test("closing after a change redraws the view beneath; closing after none does not", async ({
    page,
  }) => {
    await stubInstancesApi(page, { testStatus: 200 });
    const settings = await openSettings(page);

    let issueReads = 0;
    await page.route("**/api/issues", (route) => {
      issueReads += 1;
      return route.fulfill({ status: 200, json: { instances: [] } });
    });

    await settings.getByRole("button", { name: "Close" }).click();
    await expect(settings).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(issueReads).toBe(0);

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await addInstance(page);
    await expect(settings.getByText("Work", { exact: true })).toBeVisible();
    await settings.getByRole("button", { name: "Close" }).click();

    await expect.poll(() => issueReads).toBe(1);
  });
});
```

- [ ] **Step 2: Run to see them fail.**
  Run the settings spec (command in Global Constraints). Expected: FAIL — no button named
  `Settings` (the nav row is a link). Paste the output into the report.

- [ ] **Step 3: The cog.** In `web/index.html`, replace line 71 (the bare `<h1>`) with:

```html
        <div class="flex items-center gap-2">
          <h1 class="text-primary-rail flex-1 text-xs font-bold tracking-[0.16em] uppercase">
            ThatApp
          </h1>
          <!-- #89: Settings is a control, not a destination. The gear is the
               prototype's #p-gear at 1.7 stroke, not the set's 1.9 — at 1.9 its
               teeth close up at this size. The one stroke exception in the set. -->
          <button
            id="settings-cog"
            type="button"
            aria-label="Settings"
            class="text-rail-muted hover:bg-hover-rail hover:text-rail-ink focus-visible:text-rail-ink flex size-[34px] shrink-0 cursor-pointer items-center justify-center rounded-sm"
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path
                d="M9.62 5.10 L10.33 2.55 L13.67 2.55 L14.38 5.10 A 7.30 7.30 0 0 1 15.20 5.44 L17.51 4.14 L19.86 6.49 L18.56 8.80 A 7.30 7.30 0 0 1 18.90 9.62 L21.45 10.33 L21.45 13.67 L18.90 14.38 A 7.30 7.30 0 0 1 18.56 15.20 L19.86 17.51 L17.51 19.86 L15.20 18.56 A 7.30 7.30 0 0 1 14.38 18.90 L13.67 21.45 L10.33 21.45 L9.62 18.90 A 7.30 7.30 0 0 1 8.80 18.56 L6.49 19.86 L4.14 17.51 L5.44 15.20 A 7.30 7.30 0 0 1 5.10 14.38 L2.55 13.67 L2.55 10.33 L5.10 9.62 A 7.30 7.30 0 0 1 5.44 8.80 L4.14 6.49 L6.49 4.14 L8.80 5.44 A 7.30 7.30 0 0 1 9.62 5.10 Z"
              />
              <circle cx="12" cy="12" r="3.3" />
            </svg>
          </button>
          <!-- popover in the markup, so it is hidden before that-tooltip registers. -->
          <that-tooltip for="settings-cog" anchor="right" popover="manual">Settings</that-tooltip>
        </div>
```

  Delete the whole Settings `<a href="/settings">…</a>` (lines 168–198, its comment included). The
  focus wash comes from the existing `.that-rail :focus-visible` rule in `styles.css`.

- [ ] **Step 4: `anchor="right"` in `that-tooltip`.** In `reveal()`, directly after
  `const box = trigger.getBoundingClientRect();`, insert:

```ts
    // The drawing's .tip.right (prototype line 168): beside the trigger and
    // centred on it — the rail's cog, whose top-left corner leaves no room above.
    if (this.getAttribute("anchor") === "right") {
      this.style.top = `${box.top + box.height / 2 - this.offsetHeight / 2}px`;
      this.style.left = `${box.right + 9}px`;
      this.style.right = "auto";
      this.style.bottom = "auto";
      this.style.margin = "0";
      return;
    }
```

- [ ] **Step 5: The loader and the wiring.** Create `web/src/open-settings.ts`:

```ts
/**
 * Settings is a dialog over whatever view is mounted (#89). Its code loads on
 * first use, in a chunk of its own, so the initial response stays inside 14kB.
 */
export async function openSettings(): Promise<void> {
  const { showSettings } = await import("./settings-dialog");
  showSettings();
}
```

  In `web/src/main.ts`, add `import { openSettings } from "./open-settings";` under the two
  existing imports, and after the `const root = …` block:

```ts
document.querySelector("#settings-cog")?.addEventListener("click", () => {
  void openSettings();
});
```

  In `web/src/router.ts`, delete the `"/settings": () => import("./views/settings"),` line.

  In `web/src/views/today.ts`, add `import { openSettings } from "../open-settings";` among the
  imports and replace the `link` in `noInstances()` with:

```ts
  const open = document.createElement("button");
  open.type = "button";
  open.className = "text-primary mt-4 inline-block cursor-pointer font-bold hover:underline";
  open.textContent = "Open Settings";
  open.addEventListener("click", () => {
    void openSettings();
  });

  wrapper.append(paragraph, open);
```

  and delete the stale four-line comment below it (`// alertFor and messageOf are deliberate
  duplicates … Worth its own ticket.`) — both helpers are imported from `../alert` already, and
  the file it names is gone.

  In `web/src/rail.ts`: line 18 `so it has to stay right on Settings, and on #11's Week view,
  without` → `so it has to stay right on #11's Week view, and under the Settings dialog, without`;
  line 76 `today's period — Today itself, and Settings borrowing it — would otherwise` →
  `today's period — Today remounting — would otherwise`. In `web/src/sw.ts:122`,
  `// /today, /settings, / and any unknown path` → `// /today, /week, / and any unknown path`.

- [ ] **Step 6: The dialog.** `git mv web/src/views/settings.ts web/src/settings-dialog.ts`, then
  replace everything from the first line through the end of `emptyNotice()` (old lines 1–151) with:

```ts
import "./components/that-alert";
import "./components/that-button";
import "./components/that-confirm";

import { alertFor, messageOf } from "./alert";
import {
  createInstance,
  deleteInstance,
  listInstances,
  testInstance,
  updateInstance,
} from "./api";
import { confirmDestructive } from "./components/that-confirm";
import { announceEntriesChanged } from "./entries-changed";
import { iconMarkup } from "./icons";
import { navigate } from "./router";
import { setThemePreference, themePreference } from "./theme";
import type { Instance } from "./types";
import type { ThemePreference } from "./theme";

interface Regions {
  errorSlot: HTMLElement;
  listSlot: HTMLElement;
  formSection: HTMLElement;
  // Numbers every list read this dialog starts, so refresh() can tell the
  // answer it is holding from one a later read has already superseded (#56).
  latestListRead: number;
  // Set by a save or a removal: the view beneath was drawn from the instances
  // as they were, and a removal also deleted entries the rail is counting.
  changed: boolean;
}

const HEADING_ID = "that-settings-heading";

/**
 * The top-layer element fills the viewport and is the scroller; the panel is an
 * ordinary child centred by its own auto margins (prototype lines 245–247).
 * Never centre it with align-items or justify-content instead: content centred
 * in a scroll container overflows both edges, and nothing can scroll to what
 * lies above the start edge, so a tall panel silently loses its top. The margin
 * is stated because Preflight's `* { margin: 0 }` beats the UA's own.
 */
const DIALOG_CLASS =
  "text-ink fixed inset-0 m-0 size-full max-h-none max-w-none overflow-y-auto border-0 " +
  "bg-[oklch(0_0_0/0.5)] p-7 backdrop:bg-transparent open:flex open:flex-col";
const PANEL_CLASS =
  "bg-raised border-edge shadow-dialog m-auto w-[620px] max-w-full shrink-0 rounded-md border";
const SECTION_CLASS = "border-edge border-b px-5 py-[15px] last:border-b-0";
const SECTION_HEADING_CLASS =
  "text-ink-muted mb-2.5 text-xs font-bold tracking-[0.16em] uppercase";

export function showSettings(): void {
  // A second press that arrived while the first one's chunk was loading.
  if (document.getElementById(HEADING_ID)) return;

  const regions: Regions = {
    errorSlot: document.createElement("div"),
    listSlot: document.createElement("div"),
    formSection: document.createElement("section"),
    latestListRead: 0,
    changed: false,
  };
  regions.formSection.className = SECTION_CLASS;

  const instances = section("Jira instances");
  instances.append(regions.errorSlot, regions.listSlot);

  const appearance = section("Appearance");
  appearance.append(themeControl());

  const dialog = document.createElement("dialog");
  dialog.className = DIALOG_CLASS;
  dialog.setAttribute("aria-labelledby", HEADING_ID);

  const panel = document.createElement("div");
  panel.dataset["settingsPanel"] = "";
  panel.className = PANEL_CLASS;
  panel.append(header(dialog), instances, regions.formSection, appearance);
  dialog.append(panel);

  dialog.addEventListener("close", () => {
    dialog.remove();
    if (!regions.changed) return;
    void navigate(window.location.pathname + window.location.search);
    announceEntriesChanged();
  });

  document.body.append(dialog);
  dialog.showModal();

  showForm(regions, undefined);
  void refresh(regions);
}

function header(dialog: HTMLDialogElement): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "border-edge flex items-center gap-3 border-b px-5 py-3.5";

  const heading = document.createElement("h2");
  heading.id = HEADING_ID;
  heading.className = "text-xl font-bold tracking-[-0.015em]";
  heading.textContent = "Settings";

  // Chrome, not an action on data: a glyph, per the language's decision 12.
  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.className =
    "text-ink-muted hover:bg-hover hover:text-ink focus-visible:bg-hover focus-visible:text-ink " +
    "ml-auto flex size-[34px] shrink-0 cursor-pointer items-center justify-center rounded-sm";
  close.innerHTML = iconMarkup("close");
  close.addEventListener("click", () => {
    dialog.close();
  });

  bar.append(heading, close);

  return bar;
}

function section(heading: string): HTMLElement {
  const element = document.createElement("section");
  element.className = SECTION_CLASS;

  const title = document.createElement("h3");
  title.className = SECTION_HEADING_CLASS;
  title.textContent = heading;
  element.append(title);

  return element;
}

// regions is captured by every closure this dialog creates (button handlers,
// save()), so a read that resolves after the dialog closed writes into its own
// detached elements, never into a later dialog.
async function refresh(regions: Regions): Promise<void> {
  const thisRead = ++regions.latestListRead;
  let instances: Instance[];
  try {
    instances = await listInstances();
  } catch (error) {
    if (thisRead !== regions.latestListRead) return;
    regions.errorSlot.replaceChildren(alertFor("error", messageOf(error)));

    return;
  }

  if (thisRead !== regions.latestListRead) return;
  regions.errorSlot.replaceChildren();
  reconcileList(regions, instances);
}

function reconcileList(regions: Regions, instances: Instance[]): void {
  const slot = regions.listSlot;
  const notice = slot.querySelector("[data-empty-notice]");
  let list = slot.querySelector("ul");

  if (instances.length === 0) {
    list?.remove();
    if (!notice) {
      slot.append(emptyNotice());
    }

    return;
  }

  notice?.remove();
  if (!list) {
    list = newList();
    slot.append(list);
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
      list.append(instanceRow(regions, instance));
    }
  }

  for (const stale of existing.values()) {
    stale.remove();
  }
}

function showForm(regions: Regions, editing: Instance | undefined): void {
  regions.formSection.replaceChildren(instanceForm(regions, editing));
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

  Then, in the rest of the file:
  - `clearRowStatus`: `regions.listCard` → `regions.listSlot`.
  - `removeInstance`: after `await deleteInstance(instance.id);` add `regions.changed = true;`;
    `regions.formCard` → `regions.formSection`.
  - `refocusAfterRemoval`: `regions.listCard` → `regions.listSlot`, `regions.formCard` →
    `regions.formSection`.
  - `instanceForm`: replace its first five lines (the `that-card` and its `heading` attribute and
    `editingId`) with the block below, and `card.append(form);` with `card.append(heading, form);`.
    In `save()`, add `regions.changed = true;` directly after `const saved = …;`, and change the three
    `regions.formCard` to `regions.formSection`.

```ts
  const card = document.createElement("div");
  card.dataset["instanceForm"] = "";
  if (editing) {
    card.dataset["editingId"] = String(editing.id);
  }

  const heading = document.createElement("h3");
  heading.className = SECTION_HEADING_CLASS;
  heading.textContent = editing ? `Edit ${editing.name}` : "Add an instance";
```

  - Rename `appearanceCard()` to `themeControl()`, delete its first two lines (the `that-card`),
    replace `card.append(fieldset); return card;` with `return fieldset;`, and fix its doc comment
    to say it returns the fieldset.

- [ ] **Step 7: Run the settings spec.** Expected: PASS on both browsers. Then the **mutation
  check**, and paste both results: (a) in `PANEL_CLASS` replace `m-auto` with `mx-auto`, and add
  `justify-center` to `DIALOG_CLASS` — "a panel taller than the window…" must FAIL (its top is
  negative); (b) restore, then remove `m-auto` alone — "a panel shorter than the window…" must FAIL
  (Preflight's margin wins and the panel sits at the top). Restore.

- [ ] **Step 8: Migrate every other spec off `/settings`.**
  - `router.spec.ts:69-70`: `await page.goto("/settings");` +
    the `Add an instance` heading expectation → `await page.goto("/week");` +
    `await expect(page.getByRole("heading", { name: "Week 37 · 7–13 Sep" })).toBeVisible();`.
    Update the stub's doc comment to `/** Every endpoint Today and Week read, answered empty. */`.
  - `pwa.spec.ts`: above `expectShellRendered`, add

```ts
// An address the router has no view for: it renders its placeholder and reads
// nothing, which is all the tests below need of a page.
const NO_VIEW = "/no-view-here";
```

    fix the comment at line 202 to `both today.ts and the router's placeholder append their DOM`;
    replace lines 250–256 (the comment and the Settings click) with

```ts
  // Routed client-side before the server goes away: the address changes but
  // nothing fetches it, so there is no HTTP cache entry for the reload below
  // to be answered from and the worker is the only thing that can serve it.
  await page.evaluate((path) => {
    history.pushState({}, "", path);
    dispatchEvent(new PopStateEvent("popstate"));
  }, NO_VIEW);
  await expect(page).toHaveURL(/\/no-view-here$/);
```

    rename the test at 264 to `"a cold navigation to an address with no view renders the shell while offline"`
    and in its comments read `/settings` as `NO_VIEW`; replace every remaining
    `goto("/settings")` (lines 299, 460, 555, 609, 785, 818) with `goto(NO_VIEW)`; at 553 the
    comment becomes `// An address with no view reads nothing, so nothing here needs a list stubbed.`
  - `theme.spec.ts`: replace `openSettings` with the version below, and in the three tests that
    `page.reload()` then assert a radio, insert
    `await page.getByRole("button", { name: "Settings", exact: true }).click();` right after the
    reload's data-theme/background assertions. Fix the comment above "unreadable storage…" to
    `never imports settings-dialog.ts` / `themeControl() calls themePreference()` /
    `reject showSettings() and leave no dialog`.

```ts
async function openSettings(page: Page): Promise<void> {
  await page.route("**/api/instances", (route) => route.fulfill({ status: 200, json: [] }));
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
  await stubIssues(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
}
```

  - `keyboard-audit.spec.ts`: add the helper below and replace both
    `await page.goto("/settings");` with `await openSettingsOverToday(page);`.

```ts
async function openSettingsOverToday(page: Page): Promise<void> {
  await page.route("**/api/issues", (route) =>
    route.fulfill({ status: 200, json: { instances: [] } }),
  );
  await page.route("**/api/pins**", (route) => route.fulfill({ status: 200, json: [] }));
  await page.goto("/today");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
}
```

  - `entries.spec.ts:389-411`: rename to `"the rail keeps the total while Settings is open over Today"`;
    its doc comment ends `keep showing the right figure without knowing it exists.`; replace the
    last three lines with

```ts
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.locator("#rail-total")).toHaveText("0h 45m");
```

  - `timer.spec.ts:657-690`: doc comment becomes `/** Settings is a dialog over Today, so the rail
    keeps describing today beneath it — running time included. */`; rename to
    `"the rail total includes the running timer's elapsed time while Settings is open"`; replace the
    link click and URL assertion with
    `await page.getByRole("button", { name: "Settings", exact: true }).click();` and
    `await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();`.
  - `week.spec.ts:1668-1700`: delete the `**/api/instances` route line; replace the Settings click
    and URL assertion with

```ts
  // Away to an address with no view: the router tears Week down and mounts
  // only its placeholder, which listens to nothing.
  await page.evaluate(() => {
    history.pushState({}, "", "/no-view-here");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByText("There is nothing at this address.")).toBeVisible();
```

    and end the following comment with `since the placeholder has nothing to fire it through.`
  - `today.spec.ts`: the test at 135 becomes

```ts
test("no configured instances offers Settings instead of a Refresh button", async ({ page }) => {
  await stubIssues(page, []);
  await page.route("**/api/instances", (route) => route.fulfill({ status: 200, json: [] }));
  await page.goto("/today");

  await expect(page.getByText("No Jira instances yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeHidden();

  await page.getByRole("button", { name: "Open Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect(page).toHaveURL(/\/today$/);
});
```

    and in the tests at 219, 256 and 340, every `{ name: "Settings", exact: true }` /
    `{ name: "Settings" }` link and every `/\/settings$/` become `{ name: "Week", exact: true }` and
    `/\/week$/` — Week is the other destination now. In 256's comment, "reconnecting elsewhere"
    stays true.

- [ ] **Step 9: Budget.** `wc -c web/index.html` (must be under 14336; it was 9859); `make build-web`,
  then `grep -c "Jira instances" web/dist/app.js` must print `0` and
  `grep -l "Jira instances" web/dist/chunk-*.js` must print exactly one chunk. Paste all three.

- [ ] **Step 10: Compare against the drawing, then gate.** Open the dev stack (`make up`, port from
  `THAT_PORT` in `.env`) and compare the rail's top row with proto:62–67/387 and the dialog frame
  with proto:245–253/460–462: cog box, colour at rest and hover, tooltip side; scrim, panel width
  620, header padding and heading size, section padding and heading. Write what you compared and
  what you found. Then `make verify` and `make test-e2e`; paste the tails.

- [ ] **Step 11: Commit.**

```bash
git add -A web/index.html web/src .claude/e2e/tests
git commit -m "Settings opens as a dialog from a cog beside the wordmark, and leaves the nav (#89)"
```

---

### Task 2: The instance rows — dot, host line, icon buttons, health on demand

**Files:**
- Modify: `web/src/settings-dialog.ts` (`reconcileList`, `instanceRow`, `patchRow`,
  `clearRowStatus` → `forgetVerdict`, `runConnectionTest`, `removeInstance`, `newList`)
- Modify: `web/src/icons.ts`, `web/src/icons.test.ts`
- Test: `.claude/e2e/tests/settings.spec.ts`, `.claude/e2e/tests/keyboard-audit.spec.ts`

**Interfaces:**
- Consumes: `Regions`, `showForm`, `removeInstance`, `refresh` from Task 1.
- Produces: rows as `li[data-instance-id]` holding `[data-row-dot]`, `[data-row-name]`,
  `[data-row-host]`, `[data-row-health]`, `[data-row-status]`, and buttons
  `[data-row-action="test"|"edit"|"remove"]` named `Test <name>`, `Edit <name>`, `Remove <name>`;
  `forgetVerdict(regions, instanceId)`; icons `plug` and `check`.

**Drawing:** `ul.inst`, `.iid`, `.iname`, `.ihost`, `.health`, `.iacts` proto:254–261; the rows
proto:464; `.iconbtn` proto:141–161 (hover primary, remove the failed tone); `.tip.end` proto:166;
`#p-plug`, `#p-check` proto:371–372.

- [ ] **Step 1: Failing unit test.** Append to `web/src/icons.test.ts`:

```ts
test("plug and check are transcribed from the prototype's #p-plug and #p-check", () => {
  // Pasted verbatim from docs/superpowers/prototypes/2026-09-03-app-prototype.html's <defs>.
  assert.match(
    iconMarkup("plug"),
    /<path d="M9 3\.5v5M15 3\.5v5M6\.5 8\.5h11v3a5\.5 5\.5 0 0 1-5\.5 5\.5A5\.5 5\.5 0 0 1 6\.5 11\.5Z"\/><path d="M12 17v3\.5"\/>/,
  );
  assert.match(iconMarkup("check"), /<path d="M4\.5 12\.6 9\.6 17\.7 19\.5 6\.9"\/>/);
});
```

  `make test-web` — expected FAIL (type error / no such icon). Paste it.

- [ ] **Step 2: The icons.** In `web/src/icons.ts` add `"plug"` and `"check"` to `ICON_NAMES`
  (after `"external"`) and to `PATHS`:

```ts
  // #89's row controls and health mark, transcribed from #p-plug and #p-check.
  // The drawing strokes the check at 2.2; the set's 1.9 holds here, and the
  // difference went to the owner.
  plug: '<path d="M9 3.5v5M15 3.5v5M6.5 8.5h11v3a5.5 5.5 0 0 1-5.5 5.5A5.5 5.5 0 0 1 6.5 11.5Z"/><path d="M12 17v3.5"/>',
  check: '<path d="M4.5 12.6 9.6 17.7 19.5 6.9"/>',
```

  `make test-web` — PASS.

- [ ] **Step 3: Failing e2e tests.** In `settings.spec.ts`, replace
  `"me@example.com · https://example.atlassian.net"` everywhere with
  `"example.atlassian.net · me@example.com"`. Replace the two connection-test tests and the
  in-flight test's last line:

```ts
test("an untested instance reads Not tested, in muted ink with no mark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await stubListed(page, [listed(1, "Ridgeline")]);
  const settings = await openSettings(page);

  const health = settings.getByRole("listitem").filter({ hasText: "Ridgeline" }).locator("[data-row-health]");
  await expect(health).toHaveText("Not tested");
  await expect(health).toHaveCSS("color", "oklch(0.725 0.012 55)");
  await expect(health.locator("svg")).toHaveCount(0);
});

test("a successful connection test states Connected and the time it was taken", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await stubInstancesApi(page, { testStatus: 200 });
  const settings = await openSettings(page);
  await addInstance(page);

  const row = settings.getByRole("listitem").filter({ hasText: "Work" });
  await row.getByRole("button", { name: "Test Work" }).click();

  const health = row.locator("[data-row-health]");
  await expect(health).toHaveText(/^Connected · \d{2}:\d{2}$/);
  await expect(health).toHaveCSS("color", "oklch(0.75 0.15 150)");
  await expect(health.locator("svg")).toHaveAttribute("width", "15");
});

// Success and failure must be distinguishable, which is the whole point of a
// test button that asserts identity rather than a 2xx.
test("a rejected connection test reports the failure", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 401 });
  const settings = await openSettings(page);
  await addInstance(page);

  await settings.getByRole("button", { name: "Test Work" }).click();

  await expect(settings.getByText("Jira did not accept the API token for this request; check the token and its scopes")).toBeVisible();
  await expect(settings.getByText(/Connected ·/)).toBeHidden();
  await expect(settings.getByText("Not tested")).toBeHidden();
});
```

  and in "an in-flight connection test survives another row being saved" the last line becomes
  `await expect(workRow.locator("[data-row-health]")).toHaveText(/^Connected · /, { timeout: 5000 });`.
  In "saving over a failed connection test clears the stale result", append
  `await expect(page.getByText("Not tested")).toBeVisible();`. Append:

```ts
test.describe("instance rows", () => {
  test("each row carries its 8px instance-hue dot and host · email in mono", async ({ page }) => {
    await stubListed(page, [listed(1, "Ridgeline"), listed(2, "Northwind")]);
    const settings = await openSettings(page);

    const first = settings.getByRole("listitem").filter({ hasText: "Ridgeline" });
    const second = settings.getByRole("listitem").filter({ hasText: "Northwind" });
    await expect(first.locator("[data-row-dot]")).toHaveCSS("width", "8px");
    await expect(first.locator("[data-row-dot]")).toHaveCSS("height", "8px");
    await expect(first.getByRole("img", { name: "Ridgeline" })).toBeVisible();
    expect(await first.locator("[data-row-dot]").evaluate((dot) => dot.style.getPropertyValue("--h"))).toBe("265");
    expect(await second.locator("[data-row-dot]").evaluate((dot) => dot.style.getPropertyValue("--h"))).toBe("175");

    const host = first.locator("[data-row-host]");
    await expect(host).toHaveText("ridgeline.atlassian.net · dion@this.nl");
    await expect(host).toHaveCSS("font-family", /Chivo Mono/);
  });

  test("the row controls are icon buttons with their tooltips, primary on hover, remove failed", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await stubListed(page, [listed(1, "Ridgeline")]);
    const settings = await openSettings(page);
    const row = settings.getByRole("listitem").filter({ hasText: "Ridgeline" });

    for (const [name, words, hover] of [
      ["Test Ridgeline", "test connection", "oklch(0.72 0.19 330)"],
      ["Edit Ridgeline", "edit instance", "oklch(0.72 0.19 330)"],
      ["Remove Ridgeline", "remove instance", "oklch(0.72 0.17 25)"],
    ] as const) {
      const control = row.getByRole("button", { name, exact: true });
      await expect(control.locator("svg")).toHaveAttribute("width", "17");
      await control.hover();
      await expect(control).toHaveCSS("color", hover);
      const id = await control.getAttribute("id");
      await expect(page.locator(`that-tooltip[for="${String(id)}"]`)).toHaveText(words);
      await expect(page.locator(`that-tooltip[for="${String(id)}"]`)).toBeVisible();
    }
  });

  test("a verdict survives closing and reopening, and a reload forgets it", async ({ page }) => {
    await stubListed(page, [listed(1, "Ridgeline")]);
    await page.route("**/api/instances/*/test", (route) =>
      route.fulfill({ status: 200, json: { accountId: "a", displayName: "Dion" } }),
    );
    const settings = await openSettings(page);

    await settings.getByRole("button", { name: "Test Ridgeline" }).click();
    await expect(settings.locator("[data-row-health]")).toHaveText(/^Connected · /);

    await settings.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(settings.locator("[data-row-health]")).toHaveText(/^Connected · /);

    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(settings.locator("[data-row-health]")).toHaveText("Not tested");
  });

  test("a test still running when Settings closes shows its verdict on reopen", async ({ page }) => {
    await stubListed(page, [listed(1, "Ridgeline")]);
    let answer: () => void = () => {};
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    let arrive: () => void = () => {};
    const arrived = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    await page.route("**/api/instances/*/test", async (route) => {
      arrive();
      await answered;
      await route.fulfill({ status: 200, json: { accountId: "a", displayName: "Dion" } });
    });
    const settings = await openSettings(page);

    await settings.getByRole("button", { name: "Test Ridgeline" }).click();
    await arrived;
    await settings.getByRole("button", { name: "Close" }).click();
    const tested = page.waitForResponse("**/api/instances/*/test");
    answer();
    await tested;
    // One more round trip, so the app's own promise chain has settled the verdict.
    await page.evaluate(() => fetch("/api/health").then((response) => response.text()));

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(settings.locator("[data-row-health]")).toHaveText(/^Connected · /);
  });

  test("a removed instance's verdict never lands on the next instance given its id", async ({ page }) => {
    await stubInstancesApi(page, { testStatus: 200 });
    const settings = await openSettings(page);
    await addInstance(page);

    await settings.getByRole("button", { name: "Test Work" }).click();
    await expect(settings.locator("[data-row-health]")).toHaveText(/^Connected · /);

    await settings.getByRole("button", { name: "Remove Work" }).click();
    await confirmDialog(page).getByRole("button", { name: "Remove instance" }).click();
    await expect(settings.getByText("No instances yet. Add one below.")).toBeVisible();

    // The stub numbers by list length, so this one is given id 1 again — as SQLite would.
    await addInstance(page);
    await expect(settings.locator("[data-row-health]")).toHaveText("Not tested");
  });
});
```

  In `keyboard-audit.spec.ts`: `{ name: "Remove", exact: true }` → `{ name: "Remove Ridgeline" }`
  (both tests; drop the `.first()`), and `{ name: "Test", exact: true }` →
  `{ name: "Test Northwind", exact: true }`.

  Run the settings spec: expected FAIL (no `Test Work` button, no `[data-row-health]`). Paste it.

- [ ] **Step 4: Implement.** In `settings-dialog.ts` add to the imports
  `import { clockTime } from "./format";`, `import { paintInstanceDot } from "./instance-hue";` and
  `import type { IconName } from "./icons";`. `newList()`'s class becomes `""` (rows are separate
  surfaces now — delete the `className` line). In `reconcileList`, the loop becomes

```ts
  for (const [position, instance] of instances.entries()) {
    const key = String(instance.id);
    const row = existing.get(key);
    if (row) {
      existing.delete(key);
      patchRow(row, instance, position);
      list.append(row);
    } else {
      list.append(instanceRow(regions, instance, position));
    }
  }
```

  Replace `instanceRow`, `patchRow`, `clearRowStatus` and `runConnectionTest` (keep `rowState` and
  its comment) with the block below. **Keep `paintVerdict` directly after `patchRow`**:
  `vocabulary.test.ts` looks 600 characters either side of each `iconMarkup(` call for an
  `aria-label`, and the health mark is decoration beside words, not a control.

```ts
/**
 * What the last connection test said, per instance id, for the life of the
 * page: closing Settings keeps it, a reload forgets it, and nothing stores it —
 * a stored verdict is a claim about credentials that can be revoked outside
 * this app (#89).
 */
type Verdict = { ok: true; at: Date } | { ok: false; at: Date; message: string };
const verdicts = new Map<number, Verdict>();

const HEALTH_CLASS = "inline-flex shrink-0 items-center gap-1.5 text-sm";

/** The prototype's `.iconbtn` in `ul.inst` (lines 141–161): the wash on hover
 *  and focus, and the primary on hover — the failed tone, for remove. */
const ROW_BUTTON_CLASS =
  "text-ink-muted hover:bg-hover focus-visible:bg-hover focus-visible:text-ink -mr-2 flex " +
  "size-[34px] shrink-0 cursor-pointer items-center justify-center rounded-sm " +
  "disabled:cursor-default disabled:opacity-60";

const ROW_ACTIONS = {
  test: { icon: "plug", verb: "Test", words: "test connection", hover: "hover:text-primary" },
  edit: { icon: "edit", verb: "Edit", words: "edit instance", hover: "hover:text-primary" },
  remove: { icon: "trash", verb: "Remove", words: "remove instance", hover: "hover:text-failed" },
} as const satisfies Record<string, { icon: IconName; verb: string; words: string; hover: string }>;

type RowAction = keyof typeof ROW_ACTIONS;

function instanceRow(regions: Regions, instance: Instance, position: number): HTMLElement {
  const row = document.createElement("li");
  row.className = "bg-surface mb-[7px] rounded-sm px-3 py-2.5";
  row.dataset["instanceId"] = String(instance.id);

  const state = { instance };
  rowState.set(row, state);

  const line = document.createElement("div");
  line.className = "flex items-center gap-3";

  // 8px is this row's own drawn size (prototype line 464). .that-dot's 7px is
  // unlayered CSS, which no utility can override; an inline style can.
  const dot = document.createElement("span");
  dot.dataset["rowDot"] = "";
  dot.style.width = "8px";
  dot.style.height = "8px";

  const identity = document.createElement("div");
  identity.className = "flex min-w-0 flex-1 flex-col gap-0.5";
  const name = document.createElement("span");
  name.dataset["rowName"] = "";
  name.className = "text-ink text-lg font-medium";
  const host = document.createElement("span");
  host.dataset["rowHost"] = "";
  host.className = "text-ink-muted font-mono text-sm";
  identity.append(name, host);

  const health = document.createElement("span");
  health.dataset["rowHealth"] = "";

  const actions = document.createElement("div");
  actions.className = "flex shrink-0 gap-1";
  const [test, testTip] = rowButton("test", instance.id);
  const [edit, editTip] = rowButton("edit", instance.id);
  const [remove, removeTip] = rowButton("remove", instance.id);
  actions.append(test, testTip, edit, editTip, remove, removeTip);

  line.append(dot, identity, health, actions);

  const status = document.createElement("div");
  status.className = "mt-2 empty:mt-0";
  status.dataset["rowStatus"] = "";
  row.append(line, status);

  test.addEventListener("click", () => {
    void runConnectionTest(state.instance, test, row);
  });
  edit.addEventListener("click", () => {
    showForm(regions, state.instance);
  });
  remove.addEventListener("click", () => {
    void removeInstance(regions, state.instance, remove, status);
  });

  patchRow(row, instance, position);
  paintVerdict(row, instance.id);

  return row;
}

function rowButton(action: RowAction, instanceId: number): [HTMLButtonElement, HTMLElement] {
  const { icon, verb, words, hover } = ROW_ACTIONS[action];

  const button = document.createElement("button");
  button.type = "button";
  button.id = `that-instance-${action}-${String(instanceId)}`;
  button.dataset["rowAction"] = action;
  // patchRow names the instance, and renames it after an edit.
  button.setAttribute("aria-label", verb);
  button.className = `${ROW_BUTTON_CLASS} ${hover}`;
  button.innerHTML = iconMarkup(icon, 17);

  const tooltip = document.createElement("that-tooltip");
  tooltip.setAttribute("for", button.id);
  tooltip.setAttribute("anchor", "end");
  tooltip.textContent = words;

  return [button, tooltip];
}

function patchRow(row: HTMLElement, instance: Instance, position: number): void {
  const state = rowState.get(row);
  if (state) {
    state.instance = instance;
  }

  const dot = row.querySelector<HTMLElement>("[data-row-dot]");
  if (dot) {
    paintInstanceDot(dot, position, instance.name);
  }
  const name = row.querySelector<HTMLElement>("[data-row-name]");
  if (name) {
    name.textContent = instance.name;
  }
  const host = row.querySelector<HTMLElement>("[data-row-host]");
  if (host) {
    host.textContent = hostLine(instance);
  }
  for (const button of row.querySelectorAll<HTMLElement>("[data-row-action]")) {
    const action = button.dataset["rowAction"];
    if (action === "test" || action === "edit" || action === "remove") {
      button.setAttribute("aria-label", `${ROW_ACTIONS[action].verb} ${instance.name}`);
    }
  }

  // A migrated row that held a gateway URL: REST calls still work, but #5 has no
  // URL to link an issue to until the user supplies one. Re-evaluated on every
  // patch, since editing can add or remove the site URL without a page reload.
  const warning = row.querySelector<HTMLElement>("[data-site-url-warning]");
  if (instance.siteUrl === "") {
    if (!warning) {
      const alert = alertFor(
        "warning",
        "This instance has no site URL, so issue links are unavailable. Edit it to add one.",
      );
      alert.dataset["siteUrlWarning"] = "";
      row.append(alert);
    }
  } else {
    warning?.remove();
  }
}

/**
 * The drawing's two health states. A failed verdict is not drawn yet, so the
 * server's own message stays in the alert beneath the row, as it did before.
 */
function paintVerdict(row: HTMLElement, instanceId: number): void {
  const health = row.querySelector<HTMLElement>("[data-row-health]");
  const status = row.querySelector<HTMLElement>("[data-row-status]");
  if (!health || !status) return;

  const verdict = verdicts.get(instanceId);
  status.replaceChildren();
  if (!verdict) {
    health.className = `${HEALTH_CLASS} text-ink-muted`;
    health.textContent = "Not tested";
  } else if (verdict.ok) {
    health.className = `${HEALTH_CLASS} text-running`;
    health.innerHTML = iconMarkup("check", 15);
    health.append(`Connected · ${clockTime(verdict.at)}`);
  } else {
    health.className = HEALTH_CLASS;
    health.replaceChildren();
    status.append(alertFor("error", verdict.message));
  }
}

/** The drawing's `.ihost`. A migrated instance has no site URL and so no host;
 *  the warning beneath its row says why. */
function hostLine(instance: Instance): string {
  if (instance.siteUrl === "") return instance.email;

  let host: string;
  try {
    host = new URL(instance.siteUrl).host;
  } catch {
    host = instance.siteUrl;
  }

  return `${host} · ${instance.email}`;
}

// A saved token is never echoed back by the API, so a token-only edit is
// invisible to any comparison of the reconciled Instance — patchRow cannot see
// it. Forgetting here, scoped to the one instance just saved, reaches that case
// and never touches a sibling row's own test in flight.
function forgetVerdict(regions: Regions, instanceId: number): void {
  verdicts.delete(instanceId);
  const row = regions.listSlot.querySelector<HTMLElement>(`li[data-instance-id="${instanceId}"]`);
  if (row) {
    paintVerdict(row, instanceId);
  }
}

async function runConnectionTest(
  instance: Instance,
  trigger: HTMLButtonElement,
  row: HTMLElement,
): Promise<void> {
  trigger.disabled = true;
  row.querySelector<HTMLElement>("[data-row-status]")?.replaceChildren(alertFor("warning", "Testing…"));

  try {
    await testInstance(instance.id);
    verdicts.set(instance.id, { ok: true, at: new Date() });
  } catch (error) {
    verdicts.set(instance.id, { ok: false, at: new Date(), message: messageOf(error) });
  } finally {
    trigger.disabled = false;
  }

  paintVerdict(row, instance.id);
}
```

  In `save()`, `clearRowStatus(regions, editing.id)` → `forgetVerdict(regions, editing.id)`. In
  `removeInstance`, change `trigger: HTMLElement` to `trigger: HTMLButtonElement`, both
  `setAttribute/removeAttribute("disabled")` to `trigger.disabled = true/false`, and after
  `regions.changed = true;` add:

```ts
    // SQLite gives a freed id to the next instance created (no AUTOINCREMENT).
    verdicts.delete(instance.id);
```

- [ ] **Step 5: Run.** Settings spec and keyboard-audit spec — PASS on both browsers. `make verify`.

- [ ] **Step 6: Compare against the drawing.** Two instances, one tested: compare each row with
  proto:254–261/464 — surface, radius, padding 10/12, 7px between rows, dot size and hue, name
  15px/500, host line mono and muted, health gap and tone, the check at 15px, button box 34, glyph
  17, hover wash and ink for all three, tooltip words and side. Write what you found, including the
  drawing's 2.2 check stroke and 12.5px sizes (reported, not built).

- [ ] **Step 7: Commit.**
  `git commit -m "Each instance row carries its dot, host line, icon controls and health on demand (#89)"`

---

### Task 3: Adding and editing an instance is an action

**Files:**
- Modify: `web/src/settings-dialog.ts` (`Regions`, `showSettings`, `showForm`, `instanceForm`,
  `field`, `removeInstance`, `refocusAfterRemoval`; new `hideForm`, `addInstanceButton`)
- Test: `.claude/e2e/tests/settings.spec.ts`, `keyboard-audit.spec.ts`, `theme.spec.ts`

**Interfaces:**
- Consumes: `Regions`, `SECTION_HEADING_CLASS`, `forgetVerdict`, `tokenNote()` (unchanged).
- Produces: `Regions.addButton: HTMLButtonElement`; the form section `hidden` at rest;
  `hideForm(regions)`; the form holder `[data-instance-form]`; the submit `Add instance` /
  `Save changes`, and `Cancel` in both modes.

**Drawing:** `.addbtn` proto:262–266 and :465; the form proto:466–480 and its script
proto:735–762; `.ifields`/`.fld`/`.ifacts` proto:331–344; `.tnote` proto:347; `.btn.quiet`
proto:316–317 (that-button's `secondary`).

- [ ] **Step 1: Failing tests.** In `settings.spec.ts`:
  - `addInstance` and `addSecondInstance` open the form first — add as their first line
    `await page.getByRole("button", { name: "Add an instance" }).click();`.
  - "the Add instance button carries … 38px": after `openSettings`, add the same click.
  - "editing an instance to add its site URL…": the same click before the first fill.
  - Every `{ name: "Cancel changes" }` → `{ name: "Cancel" }` (tests at 298, 542, 585).
  - "saving over a failed connection test…": the label becomes
    `page.getByLabel("API token", { exact: true })`.
  - "the add and edit forms say what a token needs…": add the Add click before the first
    `expectTokenNote`.
  - Replace the bodies' closing assertions as follows:
    - "editing can be cancelled": after the Cancel click,
      `await expect(page.getByLabel("Name")).toHaveCount(0);`,
      `await expect(page.getByRole("button", { name: "Add an instance" })).toBeFocused();`, then the
      existing host-line assertion.
    - "typed input survives removing another instance": before `fill("Half-typed")`, add
      `await page.getByRole("button", { name: "Add an instance" }).click();`.
    - "removing the instance you are editing clears the form": the last two lines become
      `await expect(page.getByLabel("Name")).toHaveCount(0);` and
      `await expect(page.getByRole("button", { name: "Add an instance" })).toBeVisible();`.
    - "a failed initial load still renders the Add form" → rename
      `"a failed initial load still offers to add an instance"`, first expectation
      `await expect(page.getByRole("button", { name: "Add an instance" })).toBeVisible();`.
    - "a save finishing after Cancel leaves the new Add form alone": after the Cancel click, add
      `await page.getByRole("button", { name: "Add an instance" }).click();` before the fill.
    - "a save finishing with its own form still shown resets to Add an instance" → rename
      `"a save finishing with its own form still shown closes the form"`, last two lines
      `await expect(page.getByLabel("Name")).toHaveCount(0);`.
  - Append:

```ts
test.describe("the instance form", () => {
  test("is an action: hidden at rest, opened by Add an instance, closed by Cancel", async ({ page }) => {
    await stubListed(page, [listed(1, "Ridgeline")]);
    const settings = await openSettings(page);

    await expect(settings.getByLabel("Name")).toHaveCount(0);
    await settings.getByRole("button", { name: "Add an instance" }).click();
    await expect(settings.getByRole("heading", { name: "Add an instance" })).toBeVisible();
    await expect(settings.getByLabel("Name")).toBeFocused();

    await settings.getByRole("button", { name: "Cancel" }).click();
    await expect(settings.getByLabel("Name")).toHaveCount(0);
    await expect(settings.getByRole("button", { name: "Add an instance" })).toBeFocused();
  });

  test("the token's helper line says what happens to it, by mode", async ({ page }) => {
    await stubListed(page, [listed(1, "Ridgeline")]);
    const settings = await openSettings(page);

    await settings.getByRole("button", { name: "Add an instance" }).click();
    await expect(settings.getByLabel("API token", { exact: true })).toHaveAccessibleDescription(
      "Stored encrypted. It is never shown again.",
    );

    await settings.getByRole("button", { name: "Edit Ridgeline" }).click();
    await expect(settings.getByRole("heading", { name: "Edit Ridgeline" })).toBeVisible();
    await expect(settings.getByLabel("API token", { exact: true })).toHaveAccessibleDescription(
      "Leave blank to keep the stored one",
    );
  });

  test("inputs sit at the bottom of their row, so a helper lifts only its own label", async ({ page }) => {
    await stubListed(page, []);
    const settings = await openSettings(page);
    await settings.getByRole("button", { name: "Add an instance" }).click();

    const bottom = async (label: string) => {
      const box = await settings.getByLabel(label, { exact: true }).boundingBox();
      if (!box) throw new Error(`${label} did not lay out`);
      return box.y + box.height;
    };
    const top = async (text: string) => {
      const box = await settings.locator("label", { hasText: text }).boundingBox();
      if (!box) throw new Error(`${text} label did not lay out`);
      return box.y;
    };

    expect(Math.abs((await bottom("Account email")) - (await bottom("API token")))).toBeLessThanOrEqual(1);
    expect(await top("API token")).toBeLessThan(await top("Account email"));
    expect(Math.abs((await bottom("Name")) - (await bottom("Site URL")))).toBeLessThanOrEqual(1);
  });
});
```

  - `keyboard-audit.spec.ts`, "removing the last instance…": the last three lines become
    `await expect(page.getByRole("button", { name: "Add an instance" })).toBeFocused();`.
  - `theme.spec.ts`, "cards and buttons take the dark palette too": before the `addButton` locator,
    `await page.getByRole("button", { name: "Add an instance" }).click();`.

  Run the settings spec: expected FAIL (no `Add an instance` button). Paste it.

- [ ] **Step 2: Implement.** In `settings-dialog.ts`:
  - `Regions` gains `addButton: HTMLButtonElement;`.
  - In `showSettings`, build the button before `regions` and wire it through a closure (a click
    only ever arrives after `regions` exists):

```ts
  const addButton = addInstanceButton(() => {
    showForm(regions, undefined);
  });
  const regions: Regions = {
    errorSlot: document.createElement("div"),
    listSlot: document.createElement("div"),
    formSection: document.createElement("section"),
    addButton,
    latestListRead: 0,
    changed: false,
  };
  regions.formSection.className = SECTION_CLASS;
  regions.formSection.hidden = true;

  const instances = section("Jira instances");
  instances.append(regions.errorSlot, regions.listSlot, addButton);
```

    and delete the `showForm(regions, undefined);` call before `void refresh(regions);`.
  - Replace `showForm` and add `hideForm` and `addInstanceButton`:

```ts
function showForm(regions: Regions, editing: Instance | undefined): void {
  regions.formSection.replaceChildren(instanceForm(regions, editing));
  regions.formSection.hidden = false;
  // Focusing scrolls the dialog to it, which is what the drawing's script does.
  regions.formSection.querySelector("input")?.focus();
}

function hideForm(regions: Regions): void {
  const hadFocus = regions.formSection.contains(document.activeElement);
  regions.formSection.replaceChildren();
  regions.formSection.hidden = true;
  if (hadFocus) {
    regions.addButton.focus();
  }
}

function addInstanceButton(onPress: () => void): HTMLButtonElement {
  const add = document.createElement("button");
  add.type = "button";
  // Its words are its name; the label repeats them, as toolbarButton's does.
  add.setAttribute("aria-label", "Add an instance");
  // 12px of padding matches the rows' own, so the two hover boxes share a left
  // edge inside the dialog's gutter (prototype lines 262–265).
  add.className =
    "text-primary hover:bg-hover mt-1.5 inline-flex cursor-pointer items-center gap-3 " +
    "rounded-sm px-3 py-2.5 text-base font-bold";
  add.innerHTML = iconMarkup("plus", 17);
  add.append("Add an instance");
  add.addEventListener("click", onPress);

  return add;
}
```

  - `removeInstance`: `showForm(regions, undefined)` → `hideForm(regions)`; its comment's last
    clause reads `…instance is created next (no AUTOINCREMENT on instances.id).`
  - `refocusAfterRemoval`'s body after the guard becomes
    `(regions.listSlot.querySelector<HTMLElement>("button") ?? regions.addButton).focus();` and its
    doc comment's "or the add-instance form once none is left" becomes "or Add an instance once none
    is left".
  - Replace `instanceForm`, `Field` and `field` with:

```ts
function instanceForm(regions: Regions, editing: Instance | undefined): HTMLElement {
  const holder = document.createElement("div");
  holder.dataset["instanceForm"] = "";
  if (editing) {
    holder.dataset["editingId"] = String(editing.id);
  }

  const heading = document.createElement("h3");
  heading.className = SECTION_HEADING_CLASS;
  heading.textContent = editing ? `Edit ${editing.name}` : "Add an instance";

  const form = document.createElement("form");
  form.noValidate = true;

  // align-items: end — every input sits at the bottom of its row, so a longer
  // helper lifts its own label rather than pushing its input out of line.
  const fields = document.createElement("div");
  fields.className = "grid grid-cols-2 items-end gap-3.5";

  const name = field({
    name: "name", label: "Name", type: "text", mono: false,
    value: editing?.name ?? "", placeholder: "Ridgeline",
  });
  const siteUrl = field({
    name: "siteUrl", label: "Site URL", type: "url", mono: true,
    value: editing?.siteUrl ?? "", placeholder: "https://…atlassian.net",
  });
  const email = field({
    name: "email", label: "Account email", type: "email", mono: false,
    value: editing?.email ?? "", placeholder: "you@example.com",
  });
  const token = field({
    name: "token", label: "API token", type: "password", mono: true,
    value: "", placeholder: "••••••••••••",
    help: editing ? "Leave blank to keep the stored one" : "Stored encrypted. It is never shown again.",
  });
  fields.append(name.wrapper, siteUrl.wrapper, email.wrapper, token.wrapper);

  const note = tokenNote();
  note.classList.add("mt-3");

  const status = document.createElement("div");
  status.className = "mt-3 empty:hidden";

  const submit = button(editing ? "Save changes" : "Add instance", "primary");
  const cancel = button("Cancel", "secondary");
  cancel.addEventListener("click", () => {
    hideForm(regions);
  });

  const actions = document.createElement("div");
  actions.className = "mt-4 flex gap-2";
  actions.append(submit, cancel);

  form.append(fields, note, status, actions);
  holder.append(heading, form);

  // that-button renders a real <button type="button">, so it does not submit the
  // form on its own; this click handler is the only path into save().
  submit.addEventListener("click", () => {
    void save();
  });

  async function save(): Promise<void> {
    submit.setAttribute("disabled", "");
    status.replaceChildren();

    const draft = {
      name: name.input.value,
      siteUrl: siteUrl.input.value,
      email: email.input.value,
      ...(token.input.value === "" ? {} : { token: token.input.value }),
    };

    try {
      const saved = editing ? await updateInstance(editing.id, draft) : await createInstance(draft);
      regions.changed = true;
      await refresh(regions);
      if (editing) {
        forgetVerdict(regions, editing.id);
      }
      // The user may have moved on while this save was in flight (#161). An Edit
      // form they opened on this same instance was filled from pre-save values.
      if (regions.formSection.contains(holder)) {
        hideForm(regions);
      } else if (regions.formSection.querySelector(`[data-editing-id="${saved.id}"]`)) {
        showForm(regions, saved);
      }
    } catch (error) {
      if (regions.formSection.contains(holder)) {
        status.replaceChildren(alertFor("error", messageOf(error)));
        submit.removeAttribute("disabled");
      } else {
        const label = editing?.name ?? (draft.name || "the new instance");
        regions.errorSlot.replaceChildren(
          alertFor("error", `Could not save ${label}: ${messageOf(error)}`),
        );
      }
    }
  }

  return holder;
}

interface Field {
  wrapper: HTMLElement;
  input: HTMLInputElement;
}

interface FieldSpec {
  name: string;
  label: string;
  type: string;
  value: string;
  placeholder: string;
  /** The drawing sets URLs and secrets in mono, words in the sans (`.plain`). */
  mono: boolean;
  help?: string;
}

/** The prototype's `.fld` (lines 336–343): label, an optional muted helper, input. */
function field(spec: FieldSpec): Field {
  const id = `that-settings-${spec.name}`;

  const wrapper = document.createElement("div");
  wrapper.className = "flex min-w-0 flex-col gap-[5px]";

  const label = document.createElement("label");
  label.htmlFor = id;
  label.className = "text-ink-muted text-xs font-bold tracking-[0.06em] uppercase";
  label.textContent = spec.label;
  wrapper.append(label);

  const input = document.createElement("input");
  input.id = id;
  input.name = spec.name;
  input.type = spec.type;
  input.value = spec.value;
  input.placeholder = spec.placeholder;
  input.className =
    "bg-surface border-edge text-ink placeholder:text-ink-muted w-full rounded-sm border " +
    "px-3 py-[9px] text-lg placeholder:opacity-80 focus:border-primary focus:outline-none " +
    (spec.mono ? "font-mono" : "font-sans");

  if (spec.help) {
    const help = document.createElement("span");
    help.id = `${id}-help`;
    help.className = "text-ink-muted mb-px text-xs leading-[1.4] opacity-80";
    help.textContent = spec.help;
    input.setAttribute("aria-describedby", help.id);
    wrapper.append(help);
  }

  wrapper.append(input);

  return { wrapper, input };
}
```

- [ ] **Step 3: Run.** Settings, keyboard-audit and theme specs — PASS on both browsers.
  `make verify`.

- [ ] **Step 4: Compare against the drawing.** Add mode and edit mode, beside proto:466–480 (open the
  prototype, press *Add an instance*, then a row's edit): Add button colour, gap, padding and plus;
  field labels, helper, input face per field, input padding and focus border; the two columns and
  their bottom edge; note spacing; button pair and gap. Write it down.

- [ ] **Step 5: Commit.**
  `git commit -m "Adding or editing an instance is an action, with inputs aligned on their bottom edge (#89)"`

---

### Task 4: The theme is a three-way segment

**Files:**
- Modify: `web/src/settings-dialog.ts` (`THEME_OPTIONS`, `themeControl`; `appearance` in
  `showSettings`)
- Test: `.claude/e2e/tests/theme.spec.ts`

**Interfaces:**
- Consumes: `section()`, `themePreference()`, `setThemePreference()` (unchanged; `"auto"` is the
  System state, as the boot script already treats an absent `data-theme`).
- Produces: `role="group"` named `Theme` holding buttons `Dark`, `Light`, `System` with
  `aria-pressed`.

**Drawing:** `.rowline` proto:271–273; `.seg` proto:267–270 and light proto:50; markup proto:481–483.

- [ ] **Step 1: Failing tests.** In `theme.spec.ts`, add after `openSettings`:

```ts
function themeChoice(page: Page, name: "Dark" | "Light" | "System") {
  return page
    .getByRole("dialog", { name: "Settings" })
    .getByRole("group", { name: "Theme" })
    .getByRole("button", { name, exact: true });
}
```

  Then replace every `page.getByRole("radio", { name: X }).check()` with
  `themeChoice(page, X).click()`, every `…toBeChecked()` with
  `await expect(themeChoice(page, X)).toHaveAttribute("aria-pressed", "true")`, and `"Auto"` with
  `"System"` (in names and the two test titles). Append:

```ts
test("the segment reads Dark · Light · System, and an unset preference is System", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openSettings(page);

  await expect(
    page.getByRole("dialog", { name: "Settings" }).getByRole("group", { name: "Theme" }).getByRole("button"),
  ).toHaveText(["Dark", "Light", "System"]);
  await expect(themeChoice(page, "System")).toHaveAttribute("aria-pressed", "true");
  await expect(themeChoice(page, "Dark")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  expect(await bodyBackground(page)).toBe(LIGHT_GROUND);
});
```

  Run the theme spec: expected FAIL (no `Theme` group). Paste it.

- [ ] **Step 2: Implement.** Replace `THEME_OPTIONS` and `themeControl()` with:

```ts
const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  // "auto" is the System state: an absent data-theme follows prefers-color-scheme.
  { value: "auto", label: "System" },
];

/** The prototype's `.seg`, lit by aria-pressed (lines 267–270, and 50 for light). */
const SEGMENT_CLASS =
  "text-ink-muted hover:text-ink cursor-pointer rounded-xs px-[15px] py-[7px] text-base " +
  "aria-pressed:bg-raised aria-pressed:text-ink aria-pressed:font-bold " +
  "aria-pressed:shadow-[inset_0_0_0_1px_var(--color-edge-ring),0_1px_2px_light-dark(oklch(0_0_0/0.05),oklch(0_0_0/0.35))]";

function themeControl(): HTMLElement {
  const row = document.createElement("div");
  row.className = "flex items-center gap-3.5";

  const label = document.createElement("span");
  label.id = "that-settings-theme";
  label.className = "text-ink text-base";
  label.textContent = "Theme";

  const segment = document.createElement("div");
  segment.setAttribute("role", "group");
  segment.setAttribute("aria-labelledby", label.id);
  segment.className = "bg-surface ml-auto inline-flex gap-[3px] rounded-sm p-[3px]";

  const current = themePreference();
  for (const option of THEME_OPTIONS) {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.className = SEGMENT_CLASS;
    choice.textContent = option.label;
    choice.setAttribute("aria-pressed", String(option.value === current));
    choice.addEventListener("click", () => {
      setThemePreference(option.value);
      for (const other of segment.querySelectorAll("button")) {
        other.setAttribute("aria-pressed", String(other === choice));
      }
    });
    segment.append(choice);
  }

  row.append(label, segment);

  return row;
}
```

  `index.html`'s boot script and `web/src/theme.ts` do not change.

- [ ] **Step 3: Run.** Theme spec — PASS on both browsers. `make verify`.

- [ ] **Step 4: Compare against the drawing** in both themes: row label size, segment ground,
  padding 3 and gap 3, button padding 7/15, the on state's ground, weight and shadow (dark:
  `0 1px 2px` at .35; light: hairline plus `.05`), and that Appearance is the last section. Write it
  down.

- [ ] **Step 5: Commit.** `git commit -m "The theme is a three-way segment: Dark, Light, System (#89)"`

---

### Task 5: Documents — two destinations and a control; the cog's stroke; #11's clause gone

**Files:**
- Modify: `docs/superpowers/specs/2026-08-20-visual-design-language.md:230-238` (§ Nav)
- Modify: `docs/superpowers/specs/2026-09-03-visual-language-design.md` (Decision 6 near :356 and
  :385–388; :579; :591)
- Modify: `docs/superpowers/specs/2026-09-02-week-view-design.md:110-115`, `:305`

No code; no test cycle. `make verify` still runs, because `vocabulary.test.ts` reads no docs but the
gate is the gate.

- [ ] **Step 1: The first edition's Nav.** Replace the paragraph beginning *"Three destinations,
  below a divider under Push"* with:

```markdown
Two destinations and a control. The nav carries the two periods, **Today** and **Week**, below a
divider under Push, with no bottom-pinning. #117 restored that divider — `height: 2px`,
`--color-rail-active`, `rounded-xs` (`--radius-xs`, `2px` — a 2px corner on a 2px-tall bar clamps to
a 1px curve, which is why it reads as one), `4px` of margin either side — after it shipped without
one; this line said "no divider" until then. Each is a 38px row, `9px` radius, `2px` apart, with a
16px stroked icon `11px` from its label.

**Settings is a control, not a destination** (#89). A destination is a period, with time in it and a
total the rail can describe; Settings has neither. It is a cog beside the wordmark at the rail's top
right — a 34px box whose hover wash ends on the rail's content edge — and it opens Settings as a
modal dialog over whichever view is mounted, so the rail keeps describing a real period underneath.
```

- [ ] **Step 2: The second edition.**
  - Decision 6: after the paragraph ending *"and 14px inline with text."*, add:

```markdown
**One mark has its own stroke weight: the cog.** It is drawn from computed gear geometry
(`#p-gear`) at **`1.7`**, not `1.9`, at 17px beside the wordmark. It carries far more outline than
any other mark in the same box, and at `1.9` its teeth close up. It is the set's one deliberate
exception, settled in #89's design session of 2026-09-03; any other mark drawn at another weight is
drift, not precedent.
```

  - In *"The set the app needs"*, `external, and the three nav marks, transcribed from the
    prototype's` → `external, plug, check, and the two nav marks and the rail's cog, transcribed from
    the prototype's`.
  - *What the first edition still governs*: `**Nav** — three destinations, 38px rows,` →
    `**Nav** — two destinations and a control (#89), 38px rows,`.
  - *Out of scope*: delete the bullet `**Moving Settings out of the nav** — #89.`

- [ ] **Step 3: #11's decision 10.** Delete item 10 (*"The Settings fallback is deliberately not
  load-bearing…"*, all six lines) from *Decisions taken in brainstorming* — the dead code it
  predicted went in #89's Task 1 (`setRailPeriod(TODAY_PERIOD)` in the old Settings view). Delete
  the *Out of scope* bullet `**Moving Settings.** Intake #89.`

- [ ] **Step 4: Check and commit.** `grep -rn "three destinations\|Settings fallback" docs/superpowers/specs`
  returns nothing. `make verify`. Commit:
  `git commit -m "The language's rail has two destinations and a control, and the cog its stroke (#89)"`

---

### Task 6 (controller): verification, screenshots, the pull request

Not dispatched.

- [ ] Whole-branch review against the ticket's acceptance criteria; tick each on the ticket as it is
  confirmed. Reviewer re-does the drawing comparison of Tasks 1–4 rather than accepting it.
- [ ] `git diff --stat issue-143-keyboard-and-cut-text -- internal cmd` is empty (no schema, no
  server change); `grep -rn "THAT_" .env.example` unchanged.
- [ ] `make verify` and `make test-e2e`, output pasted.
- [ ] Screenshots, each as a `-dark`/`-light` pair, written to `/e2e/test-results/shots/` from a
  throwaway spec (deleted afterwards, never committed), captured at rest (pointer parked, blurred):
  `rail-cog`, `settings-at-rest` (two instances, one `Connected · HH:MM`, one `Not tested`),
  `settings-add-form`, `settings-edit-form`, `settings-over-week`. Attach with
  `.claude/tools/pr-attach.sh <pr> shots/*.png`.
- [ ] Push, and open the pull request **based on `issue-143-keyboard-and-cut-text`** (stacked on
  PR #229), titled `[#89] Settings is a dialog behind a cog, and the page has a shape`, body opening
  `Stacked on #229`, carrying `Closes #89`, the written comparisons, the *Not drawn* and
  *Contradicted* lists above for the owner, and the screenshots.
