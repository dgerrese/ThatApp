# Settings explains what an API token needs (#80) Implementation Plan

**Date:** 2026-09-23
**Supersedes:** nothing
**Superseded by:** nothing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Add and Edit instance forms carry a hairline note under the four fields, above the
buttons, saying which token works, warning that without `write:jira-work` pushes fail, and linking to
Atlassian's token page — with two new drawn marks, `info` and `external`.

**Spec:** Codeberg issue #80's body is the design of record for this ticket (read it with
`tea api "repos/{owner}/{repo}/issues/80"`). The drawing is option B of the 2026-09-18 session mockup
(`.superpowers/brainstorm/913714-1789732588/content/token-guidance.html`, `.tnote`, `.scope`, `.lnk`),
with the two marks replaced by the geometry the 2026-09-21 and 2026-09-23 sessions settled. Task 2
draws it into the prototype, which is then the drawing the build is compared against.

**Architecture:** Two entries in `web/src/icons.ts`; one local helper, `tokenNote()`, in
`web/src/views/settings.ts`, appended by `instanceForm()` for both the add and the edit form; the
prototype and Decision 6 of the visual language updated to match. No server change.

**Tech stack:** vanilla TypeScript (strict, `noUncheckedIndexedAccess`), Tailwind v4, `node --test`
units, Playwright on Firefox and Chromium. Everything runs through `make` / `docker compose`.

## Global constraints

- Mark geometry, verbatim:
  - `info`: `<circle cx="12" cy="12" r="8.5"/><path d="M12 8.6h.01M12 11.4v3.6"/>`
  - `external`: `<path d="M14 5h5v5M19 5l-8 8M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>`
  - Both at the set's 1.9 stroke, round caps and joins, `currentColor`, 24 grid, `aria-hidden`.
- `info` renders at **18px** in muted ink (never a verdict tone); `external` at **14px**, after the
  link text, in the link's primary colour. The link's accessible name stays "Create a token".
- Copy, verbatim: "Use an unscoped API token, or a scoped one with `read:jira-user` `read:jira-work`
  `write:jira-work`. Without `write:jira-work` your issues still list, but pushes fail. **Create a
  token**" — scopes in mono, link in primary and bold.
- Link: `https://id.atlassian.com/manage-profile/security/api-tokens`, `target="_blank"`,
  `rel="noopener"`. The typed ↗ appears nowhere.
- The note sits under the four fields and above the buttons (and above the save-error slot's
  position between them is fine: fields, note, status, actions).
- Issue keys stay bare — no mark on them.
- The prototype never gains a doctype.
- 14kB initial-response budget: Settings is lazily imported; `index.html` is not touched.

---

### Task 1: The `info` and `external` marks, recorded in Decision 6

**Files:**
- Modify: `web/src/icons.ts`
- Modify: `web/src/icons.test.ts`
- Modify: `web/src/vocabulary.test.ts` (the typed-glyph guard learns ↗)
- Modify: `docs/superpowers/specs/2026-09-03-visual-language-design.md` (Decision 6)

- [ ] **Step 1: Write the failing tests.** Append to `web/src/icons.test.ts`:

```ts
test("info and external are transcribed from the #80 design sessions", () => {
  // Pasted verbatim from issue #80: the info mark settled 2026-09-21, the
  // external mark 2026-09-23.
  assert.ok(ICON_NAMES.includes("info"), "info is in the set");
  assert.ok(ICON_NAMES.includes("external"), "external is in the set");
  assert.match(
    iconMarkup("info"),
    /<circle cx="12" cy="12" r="8\.5"\/><path d="M12 8\.6h\.01M12 11\.4v3\.6"\/>/,
  );
  assert.match(
    iconMarkup("external"),
    /<path d="M14 5h5v5M19 5l-8 8M18 14v4\.5A1\.5 1\.5 0 0 1 16\.5 20h-11A1\.5 1\.5 0 0 1 4 18\.5v-11A1\.5 1\.5 0 0 1 5\.5 6H10"\/>/,
  );
});

test("info is not warning turned upside down by colour alone", () => {
  const shape = (name: IconName) => iconMarkup(name).replace(/^<svg[^>]*>|<\/svg>$/g, "");
  assert.notEqual(shape("info"), shape("warning"));
  assert.notEqual(shape("info"), shape("failed"));
});
```

The existing "every icon is on the 24 grid…" loop covers both new names once they are in
`ICON_NAMES`. The `ICON_NAMES.includes("info")` calls will not type-check until the names exist —
that is the RED.

In `web/src/vocabulary.test.ts`, add `↗` to the character class of the "no typed character stands in
for a drawn mark" regex, so it reads `[●▲×−✓✗←→↗]`.

- [ ] **Step 2: Run to see it fail.**

```shell
docker compose run --rm --no-deps web node --test src/icons.test.ts
```

Expected: FAIL — `info` and `external` are not in the set (the assertion or the type strip reports
it). Paste the failing output into the report.

- [ ] **Step 3: Implement.** In `web/src/icons.ts`, add `"info"` and `"external"` to the end of
`ICON_NAMES`, and to `PATHS`:

```ts
  // #80's token note. Settled on the companion 2026-09-21: success and failed's
  // own circle, with warning's dot-and-stem inverted. Drawn at 18px, never 16 —
  // at 16 the dot and the stem fuse, and thinning the stroke does not help.
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8.6h.01M12 11.4v3.6"/>',
  // Settled 2026-09-23 for a link that leaves the app, at 14px inline with its
  // text. Issue keys are outbound too and stay bare, by the owner's choice.
  external:
    '<path d="M14 5h5v5M19 5l-8 8M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
```

- [ ] **Step 4: Run to see it pass.** Same command; all pass.

- [ ] **Step 5: Record them in Decision 6.** In
`docs/superpowers/specs/2026-09-03-visual-language-design.md`, Decision 6:
  - The rule's sentence "rendered at 16px in the rail's nav and 18px in a row control." becomes
    "rendered at 16px in the rail's nav, 18px in a row control and in a form's note, and 14px inline
    with text."
  - "The set the app needs: pin, pin-off, search, sortable, ascending, descending, pushed, warning,
    failed, success, and the three nav marks" becomes "…failed, success, info, external, and the
    three nav marks", and add after that paragraph:

    > `info` and `external` came from #80's design sessions. `info` is drawn at 18px even in a
    > form's note, because at 16px its dot and stem fuse; `external` is 14px because at 16px it
    > stands taller than the 13px text it follows. The issue keys are outbound links too and carry no
    > `external` mark — their tooltip already says where they go.

- [ ] **Step 6: Verify and commit.**

```shell
make test-web && make tsc && make lint
git add web/src/icons.ts web/src/icons.test.ts web/src/vocabulary.test.ts docs/superpowers/specs/2026-09-03-visual-language-design.md
git commit -m "feat(web): draw the info and external marks (#80)"
```

---

### Task 2: The prototype draws the note

**Files:**
- Modify: `docs/superpowers/prototypes/2026-09-03-app-prototype.html`

The prototype is a fragment wrapped by the design companion. **Never add a doctype.**

- [ ] **Step 1: Add the two symbols** to the `<defs>` block, after `p-minus` or wherever the list
ends:

```html
  <g id="p-info"><circle cx="12" cy="12" r="8.5"/><path d="M12 8.6h.01M12 11.4v3.6"/></g>
  <g id="p-ext"><path d="M14 5h5v5M19 5l-8 8M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/></g>
```

- [ ] **Step 2: Add the styles** after the `.ifacts` rule, transcribed from the session mockup's
option B:

```css
  /* #80: the token note, option B of the 2026-09-18 session. A hairline in the
     edge tone, neither a card nor an alert. */
  .tnote { display: flex; gap: 10px; align-items: flex-start; font-size: 13px; line-height: 1.55; color: var(--ink-muted); border: 1px solid var(--edge); border-radius: var(--r-sm); padding: 10px 12px; margin-top: 12px; }
  .tnote svg { flex: none; margin-top: 1px; }
  .scope { font-family: 'Chivo Mono', monospace; font-size: 11.5px; color: var(--ink); background: var(--hover); border-radius: var(--r-sm); padding: 1px 5px; white-space: nowrap; }
  .lnk { color: var(--pri); font-weight: 700; display: inline-flex; align-items: center; gap: 3px; }
```

(The mockup's `margin-top: 2px` on the mark was for a 16px mark on a ~20px line; at 18px, 1px
keeps it centred on the first line.)

- [ ] **Step 3: Add the note** inside `#instform`, between the closing `</div>` of `.ifields` and
`<div class="ifacts">`:

```html
      <div class="tnote"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#p-info"/></svg>
        <span>Use an unscoped API token, or a scoped one with <span class="scope">read:jira-user</span> <span class="scope">read:jira-work</span> <span class="scope">write:jira-work</span>. Without <span class="scope">write:jira-work</span> your issues still list, but pushes fail. <a class="lnk" href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener">Create a token<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#p-ext"/></svg></a></span></div>
```

`#instform` serves both Add and Edit, so both show the note.

- [ ] **Step 4: Verify.** `head -c 20 docs/superpowers/prototypes/2026-09-03-app-prototype.html`
must not start with `<!doctype`. `grep -c '↗' …` must print 0. Render it inside the companion frame
(substitute it for `<!-- CONTENT -->` in the superpowers brainstorming skill's
`scripts/frame-template.html`) and look at the Settings form in both themes (`#lm-toggle`).

- [ ] **Step 5: Commit.**

```shell
git add docs/superpowers/prototypes/2026-09-03-app-prototype.html
git commit -m "docs(prototype): draw the token note in the instance form (#80)"
```

---

### Task 3: The instance forms show the note

**Files:**
- Modify: `web/src/views/settings.ts`
- Modify: `.claude/e2e/tests/settings.spec.ts`

**Required reading:** the prototype's `#instform` and `.tnote`/`.scope`/`.lnk` (after Task 2), and
Decision 6 of `docs/superpowers/specs/2026-09-03-visual-language-design.md`. The report says what was
compared and what was found.

Translation into this app's vocabulary, following the precedent that the prototype's sub-12px sizes
land on the ramp (`.rfoot`'s 11.5px became `text-xs` in `that-issue-search.ts`, per Decision 5):
13px → `text-sm`; line-height 1.55 → `leading-[1.55]`; gap 10px → `gap-2.5`; padding 10/12 →
`py-2.5 px-3`; the chip's 11.5px → `text-xs`, padding 1/5 → `py-px px-[5px]`, radius → `rounded-sm`,
`--hover` → `bg-hover`; the link's gap 3px → `gap-[3px]`. The note's 12px top margin comes from the
form's existing `space-y-3`.

- [ ] **Step 1: Write the failing e2e test.** Append to `.claude/e2e/tests/settings.spec.ts`:

```ts
const TOKEN_PAGE = "https://id.atlassian.com/manage-profile/security/api-tokens";

async function expectTokenNote(page: Page, form: string): Promise<void> {
  const note = page.locator(`${form} [data-token-note]`);
  await expect(note).toBeVisible();
  for (const scope of ["read:jira-user", "read:jira-work", "write:jira-work"]) {
    await expect(note).toContainText(scope);
  }
  await expect(note).toContainText("Without write:jira-work your issues still list, but pushes fail.");
  await expect(note).not.toContainText("↗");

  // Exact name: the external mark is aria-hidden, so it adds nothing to it.
  const link = note.getByRole("link", { name: "Create a token", exact: true });
  await expect(link).toHaveAttribute("href", TOKEN_PAGE);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener");
  await expect(link.locator("svg")).toHaveAttribute("width", "14");
  // The info mark is the note's first svg in document order.
  await expect(note.locator("svg").first()).toHaveAttribute("width", "18");
}

test("the add and edit forms say what a token needs before it can push", async ({ page }) => {
  await stubInstancesApi(page, { testStatus: 200 });
  await page.goto("/settings");

  await expectTokenNote(page, "that-card:not([data-editing-id])");

  await addInstance(page);
  await page.getByRole("button", { name: "Edit" }).click();

  await expectTokenNote(page, "that-card[data-editing-id]");
});
```

(`that-card:not([data-editing-id])` alone would also match the list and Appearance cards, but only
the form card contains a `[data-token-note]`, so the locator still resolves to one element.)

- [ ] **Step 2: Run it to see it fail.**

```shell
docker compose --profile e2e run --build --rm playwright sh -c 'npm ci --no-audit --no-fund && npx playwright test tests/settings.spec.ts -g "what a token needs"'
```

(or `make test-e2e`, which brings the stack up itself; if running the single spec needs the stack,
use `make up` first and `make down` after — leave the dev stack as it was found.) Expected: FAIL on
both browsers, `[data-token-note]` not found. Paste it.

- [ ] **Step 3: Implement.** In `web/src/views/settings.ts`, import the marks:

```ts
import { iconMarkup } from "../icons";
```

In `instanceForm()`, change

```ts
  form.append(name.wrapper, siteUrl.wrapper, email.wrapper, token.wrapper, status, actions);
```

to

```ts
  form.append(name.wrapper, siteUrl.wrapper, email.wrapper, token.wrapper, tokenNote(), status, actions);
```

and add, after `instanceForm()`:

```ts
const TOKEN_PAGE = "https://id.atlassian.com/manage-profile/security/api-tokens";

/**
 * The prototype's `.tnote`. Guidance rather than a check: the connection test
 * only reads, and Jira has no side-effect-free write to probe a token's write
 * scope with, so a token missing write:jira-work passes it and fails every
 * push (#80). The link carries the current truth if Atlassian renames things.
 */
function tokenNote(): HTMLElement {
  const note = document.createElement("div");
  note.dataset["tokenNote"] = "";
  note.className =
    "flex items-start gap-2.5 rounded-sm border border-edge px-3 py-2.5 " +
    "text-sm leading-[1.55] text-ink-muted";

  // Neither mark takes an aria-label: both are decorative, the note's text
  // says everything, and the link's accessible name stays "Create a token".
  const mark = document.createElement("span");
  mark.className = "mt-px shrink-0";
  mark.innerHTML = iconMarkup("info", 18);

  const link = document.createElement("a");
  link.href = TOKEN_PAGE;
  link.target = "_blank";
  // Without noopener the opened page gets a window.opener handle back here.
  link.rel = "noopener";
  link.className = "inline-flex items-center gap-[3px] font-bold text-primary";
  link.textContent = "Create a token";
  link.insertAdjacentHTML("beforeend", iconMarkup("external", 14));

  const text = document.createElement("span");
  text.append(
    "Use an unscoped API token, or a scoped one with ",
    scope("read:jira-user"),
    " ",
    scope("read:jira-work"),
    " ",
    scope("write:jira-work"),
    ". Without ",
    scope("write:jira-work"),
    " your issues still list, but pushes fail. ",
    link,
  );

  note.append(mark, text);

  return note;
}

function scope(name: string): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "whitespace-nowrap rounded-sm bg-hover px-[5px] py-px font-mono text-xs text-ink";
  chip.textContent = name;

  return chip;
}
```

- [ ] **Step 4: Run to see it pass**, same command as step 2, both browsers green. Also run
`make test-web`: `vocabulary.test.ts`'s "a control whose only content is a drawn mark carries its own
label" guard looks for `aria-label` within 600 characters of every `iconMarkup(` call. The comment
above `const mark` is placed to sit inside that window for both calls; if the guard still fires, move
that comment closer rather than adding a redundant aria-label.

- [ ] **Step 5: Compare against the drawing.** Open Settings in the dev stack (port `THAT_PORT` in
`.env`) and the prototype in the companion frame, in both themes, and compare: placement (under the
four fields, above the buttons, on Add and on Edit), the hairline box in the edge tone, the radius,
the padding, the info mark's size and colour, the scopes' face and chip, the link's colour, weight
and mark. Report each item compared and what was found; a difference the ticket forces is named, not
absorbed.

- [ ] **Step 6: Verify and commit.**

```shell
make verify
git add web/src/views/settings.ts .claude/e2e/tests/settings.spec.ts
git commit -m "feat(web): the instance forms say what a token needs (#80)"
```

---

## After the tasks

Whole-branch review (`superpowers:requesting-code-review`), then `make verify` and `make test-e2e`,
then the screenshot pairs the ticket-workflow skill requires: the Add and Edit forms in dark and
light, and the prototype's note in the companion frame in dark and light.
