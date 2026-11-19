# Confirm before removing a Jira instance — design

**Date:** 2026-08-17
**Supersedes:** nothing
**Superseded by:** nothing

The design for [CB#29](https://codeberg.org/DionGerrese/ThatApp/issues/29). Removing a Jira instance
takes one click and no confirmation, and `DELETE /api/instances/{id}` cascades to `pinned_issues`,
`time_entries` and `timers`. That is harmless only while `time_entries` is empty. Once CB#6 ships time
entry it destroys logged time — the asset `CLAUDE.md`'s *Where correctness lives* exists to protect —
with no undo anywhere in the system.

The ticket is scoped wider than the dialog. `web/src/views/settings.ts` re-renders by
`container.replaceChildren()` on every mutation, and the confirm flow lands on exactly those lines,
so the three findings parked by CB#4's whole-branch review are fixed here rather than in a later ticket
that would open the same file a second time.

## Decisions taken in brainstorming

1. **A native `<dialog>` wrapped as a `that-confirm` WebComponent.** Chosen by the owner before
   refinement: light DOM, Tailwind-styled, focus-trapped and Esc-dismissible, driveable by role in
   Playwright. Explicitly **not** `window.confirm()` — unstyleable in a styled PWA, blocks the event
   loop, and needs dialog handling in the e2e rig — and **not** an inline two-step button.
2. **The warning is static.** No counts of what will be destroyed, so no counts endpoint, no loading
   state inside the dialog, and no server change in this ticket at all. Counts are a later intake,
   worth raising once CB#6 has made them non-zero; today they would read "0 time entries" and teach the
   user the dialog is not worth reading.
3. **Keyed row reconciliation replaces the wholesale re-render.** The alternatives were a region
   split with no diffing (simpler, but a list rebuild still discards a sibling row's in-flight
   result) and an observable instances store (the shape a framework would give you, and the repo has
   ruled frameworks out).
4. **CB#30 lands first.** `that-confirm` is written against the semantic colour tokens from
   `docs/superpowers/specs/2026-08-14-theme-toggle-design.md` rather than stock light utilities, so
   the component's colours are written once and CB#30's retrofit table stays at six files.

## `that-confirm`

A light-DOM component wrapping native `<dialog>`, and a promise helper over it — the same shape as
the `button()` and `alertFor()` helpers the Settings view already builds its controls from.

```ts
export function confirmDestructive(options: {
  heading: string;
  body: string;
  confirmLabel: string;
}): Promise<boolean>;
```

It creates a `<that-confirm>`, appends it to `document.body`, calls `showModal()`, resolves `true` on
confirm and `false` on Cancel or Esc, and removes the element before resolving. The promise is what
lets the call site read as a single statement rather than as a pair of event handlers.

**Everything a modal has to get right comes from the platform.** `showModal()` gives the focus trap,
the inert background and the top layer; Esc fires `cancel`; and the dialog returns focus to the
Remove button that opened it. None of that is reimplemented, which is the whole argument for the
native element over a div.

The component renders an `<h2>`, a `<p>`, and two `that-button`s — Cancel as `secondary`, the
confirming action as `danger`. The dialog is `aria-labelledby` the heading and `aria-describedby` the
body. **Every `that-button` is given a `label` attribute**, which is the sole source of its inner
button's accessible name; one built without it renders a nameless button that role-based Playwright
queries cannot find.

**Backdrop-click dismissal is deliberately absent.** Native `<dialog>` does not do it, Esc already
provides the safe exit, and implementing it means hit-testing the backdrop by hand.

The Remove call site:

> **Remove Acme Jira?**
> Its pinned issues and any time logged against it are deleted too. This cannot be undone.
> `[Cancel]` `[Remove instance]`

The wording names the instance and stays true as CB#6–CB#11 add rows to the cascade, because it never
enumerates them.

## What `settings.ts` becomes

`render()` builds three regions and they persist for the life of the view: the list card, the form
card, and an error slot above them. Nothing replaces the container again.

**`refresh()`** fetches, then reconciles the list against the DOM by `instance.id` — the
`<li data-instance-id>` nodes already carry the key:

- a row whose instance is still present is **reused**, with its name, detail line and no-site-URL
  warning patched in place;
- an instance with no row gets one;
- a row with no instance is removed;
- rows are appended in the server's order, so ordering stays server-authoritative rather than
  becoming a property of DOM history.

**`showForm(instance | undefined)`** swaps the form card's contents in place. Edit and Cancel are the
same path called with and without an argument, which is why Cancel costs almost nothing here and was
missing before.

**Remove** becomes: click → `confirmDestructive(...)` → on `false` nothing happens and the button
stays enabled → on `true` disable the trigger, `DELETE`, `refresh()`.

### What the restructure fixes

Each of these was triaged as acceptable to ship by CB#4's whole-branch review and recorded in the
handoff. None is a regression; all three fall out of not wiping the container.

- **A connection test in flight on one row, while another row is saved, wrote its result into
  detached DOM** and was silently invisible. The row's node now survives the mutation.
- **A successful Remove discarded anything typed into the Add form**, because the form was rebuilt.
  The form card is now built once.
- **A failed initial load rendered no controls at all**, not even "Add an instance". The error slot
  and the form card are independent, so the form renders regardless.

### File size

`settings.ts` is 249 lines and this adds roughly 80. If it clears ~320, the form card moves to its
own module — the split CB#4's review already identified as the right one when the file next grows. The
reconciliation itself stays in the view: it is one list with one key, and hiding it behind a generic
helper would cost more to read than it saves.

## Testing

The repo has no TypeScript unit-test runner — `make verify` is lint, `tsc` and the Go suite — so
Playwright is the entire frontend test surface. There is no server change in this ticket, so no Go
test changes either.

`.claude/e2e/tests/settings.spec.ts`, against the `page.route` stubs it already installs:

1. **Remove opens the dialog**, and it names the instance being removed.
2. **Cancel leaves the row in the list and fires no `DELETE`** — asserted on the request, not only on
   the DOM, since a dialog that closes and deletes anyway is exactly the bug worth fearing.
3. **Confirm fires the `DELETE`** and the row disappears.
4. **Esc behaves as Cancel** — the platform path, so a regression here would be silent.
5. **Typed Add-form input survives a confirmed Remove.**
6. **A delayed connection test on one row still renders its result** after another row is saved.
7. **Cancel in edit mode returns an empty Add form.**

Tests 5 and 6 are the regression tests for the parked findings; both fail against today's
`replaceChildren` and are the reason the restructure is in this ticket.

`updateInstance` and `deleteInstance` have **no e2e coverage at all** today, which is precisely where
these findings live. This closes that.

Both `exact: true` locators already in `settings.spec.ts` are load-bearing — `getByText("Work")`
collides with the shell's `<h1>ThatApp</h1>`, and `getByRole("link", { name: "Settings" })`
with the router placeholder's "Open Settings" link. Do not tidy them away while adding to the file.

Everything runs through Docker: `make verify` and `make test-e2e`.

## Dependencies

- **CB#30 lands first**, so `that-confirm` is written with semantic tokens (`bg-raised`, `text-ink`,
  `bg-danger-solid`) rather than stock utilities.
- **CB#29 must land before CB#6.** Until time entry ships, the cascade destroys nothing; after it, this
  is the only thing standing between one stray click and lost logged time.

## Out of scope

- **Counts of what removal destroys.** A later intake, once CB#6 makes them meaningful.
- **Undo, soft delete or an export before removal.** The confirmation is the guard; reversibility is
  a different and much larger design.
- **Generalising `confirmDestructive` for CB#9's push failures or CB#11's week view** before those
  tickets exist. The helper is shaped so they can reuse it; nothing is added for them here.
- **The Enter-to-submit follow-up** and giving `that-button` a `type` attribute. Recorded separately in
  the handoff; doing it here would put a second unrelated change through the same fix wave.
