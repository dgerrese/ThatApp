# Toasts and dialog blocks (CB#123) — design

**Date:** 2026-09-25
**Supersedes:** the "banner with the count" in the *Partial push failure* state of
`2026-08-20-visual-design-language.md` — the per-row marks, the rail line and Push becoming Retry stand
**Superseded by:** nothing

Today every outcome is announced by `that-alert`, rendered inline into whichever region owns it, and it
stays until the next paint replaces it. CB#123 asked for toasts. The ticket's own warning was that some of
those alerts are records the user must act on — the push report's failed and not-recorded entries, the
fetch report's kept entries — and a toast that fades takes them with it. This document records what the
owner settled on the browser companion on 2026-09-25 (screens under
`.superpowers/brainstorm/770361-1790339513/content/` on the owner's machine), and what it applies to.

## Decisions (owner, 2026-09-25)

1. **Push and fetch reports become toasts, every line of them, lists included.** A mixed report is not
   split between a toast and the page: each report line is its own toast, carrying its own list.
2. **A failed one-off action becomes a toast.** A pin or unpin that failed, a fetch or refresh request
   that threw, a Settings save that fails after its form has closed, a timer start that failed (CB#207), and a Settings connection test that failed (CB#301).
3. **Everything else stays where it is.** State messages — the stale banner, "could not be read" standing
   where a list would be, an instance with no site URL — describe something that stays true, and stay
   inline. So does Settings' *Test connection* verdict, in its row's health slot, and the instance form's
   own error: that form is a card on the page, not a dialog. *Amended by CB#301 on 2026-10-09:* the failed
   test's message left the row for an error toast (decision 2), because the alert beneath the row moved
   every row below it. The verdict — `Not tested`, `Testing…`, `Connected · HH:MM`, `Not connected · HH:MM`
   — stays inline.
4. **A success fades; a warning or an error stays until it is closed.** A success toast leaves after about
   4 seconds, and the countdown pauses while the pointer or focus is on it. Warnings and errors never time
   out, and they survive moving between views. There is no history: the only way a toast leaves early is
   the user closing it.
5. **Every toast can be closed.** A success carries a countdown line *and* a close button; a warning or
   error carries a close button and no line. What a toast shows says how it leaves.
6. **The stack sits bottom-right of the content area, newest at the bottom.** New toasts land at the edge
   and older ones move up. Toasts stack because failures persist: one-at-a-time would have a new toast
   discard an unread failure.
7. **A message belonging to a dialog is a toast-style block above the dialog.** Same width as the
   dialog, 8px above its top edge; the dialog does not change height and nothing inside it moves. Several
   blocks stack upward. This covers **every** message a dialog shows — a failed save, delete or stop, and
   validation such as "Enter a duration first." — so a dialog has one way to speak.
8. **A dialog block leaves when it is closed, when the user tries again, or when the dialog closes.** A
   retry that fails again shows a fresh block. A block never outlives its dialog.
9. **The tone rule does not change.** The tone colours the mark; the words stay in ordinary ink; the mark
   carries its `aria-label` ("Done", "Warning", "Failed"), exactly as `that-alert` does now.
10. **The wording of every message is unchanged.** Those were settled with the owner ticket by ticket;
    moving them into a new container does not reopen them. CB#301 is the one exception: the failed connection test's message gained the save-failure toast's prefix, as `Could not connect to <name>: <message>`, because a toast outside the row must name the instance.

**Not settled here, deliberately:** the phone layout. The owner will decide it later; until then the stack
keeps its desktop placement at every width.

## Anatomy

A toast takes the elevation the prototype already gives a popover (`.results` in
`2026-09-03-app-prototype.html`), so no new surface token is introduced:

| Part | Value |
|---|---|
| Surface | `--color-raised`, radius `--r-md` (8px) |
| Shadow, dark | `0 2px 6px rgba(0,0,0,.45), 0 18px 40px -16px rgba(0,0,0,.7)` |
| Shadow, light | `inset 0 0 0 1px var(--edge), 0 6px 16px -8px rgba(0,0,0,.12)` |
| Width | 320px |
| Padding | 11px 12px 11px 14px |
| Content | `that-alert`'s row: 18px mark, 10px gap, message at 14px/20px, list below at 13px in muted ink with keys in Chivo Mono |
| Close | the `close` icon at 16px in muted ink, at the row's right end, a real `<button>` labelled "Dismiss" |
| Countdown (success only) | a 2px line under the row, 9px below it, edge-tone track with a muted-ink fill that shrinks over the toast's life |
| Stack | 16px from the content area's right and bottom edges, 8px between toasts |

A dialog block is the same anatomy, sized to the dialog's width instead of 320px, and stacked upward from
8px above the dialog's top edge.

## How it is built

- **One host, in the top layer.** The stack's host is created once by the app shell and shown with
  `popover="manual"`. A dialog opened with `showModal()` is in the top layer and makes the rest of the page
  inert; a toast outside the top layer would sit under the backdrop, unreachable. A modal dialog leaves everything
  outside it inert, top layer or not, so on add the host moves into the topmost open `dialog:modal`. It moves
  back to the body when that dialog fires `close` (caught in the capture phase, since `close` does not
  bubble) and when the dialog leaves the DOM without closing (a microtask in `disconnectedCallback`). A move
  hides a popover, so the host is re-shown when it holds toasts.
- **One live region.** The host carries `role="status"` (polite) from the moment the shell renders, and
  toasts are written into it. A live region inserted at the moment of the message is announced
  unreliably. Failures stay polite, as `that-alert` decided: they report the outcome of something the user
  just did. A dialog's blocks are written into a polite live region owned by that dialog.
- **One component each.** A `that-toast` WebComponent (light DOM, per the hard constraint) renders one
  toast, building the same row from `toneMark()`, shared with `that-alert`; it does not wrap a `that-alert`,
  which is itself `role="status"` and would nest live regions. And a small module exposes `toast(tone, message,
  items?)` for callers. Dialog blocks reuse `that-toast` in a `that-dialog-blocks` host inside the `<dialog>`,
  `position: fixed`, placed from the dialog's bounding rect and re-placed by a `ResizeObserver` and on window
  resize. It sits inside the dialog because a modal leaves everything outside it inert; it is empty and
  zero-size while it holds no block, so its live region stays in the accessibility tree.
  `alertFor()` stays for the inline cases in decision 3.
- **Hover and focus pause the countdown**; it resumes from where it paused.
  A host move (into or out of a dialog) restarts a success toast's countdown.

Updated on 2026-09-30 by CB#123's build: the mechanisms above replace the first version's, which could not work; the outcomes in the Decisions are unchanged.

## Where each alert goes

Verified against `main` at `432dbd7`. The ticket's original list of eight places is out of date:
`that-combobox.ts` no longer exists and `that-ticket-row.ts` no longer renders `that-alert`.

| Place on main | What | Goes to |
|---|---|---|
| `push-report.ts` via `today.ts` and `week.ts` | pushed; could not be pushed (with list); days that did not answer (with list); pushed but not recorded (with list) | toasts, one per line |
| `fetch-report.ts` via `week.ts` | added / updated; kept local entries (with list); an instance could not be read | toasts, one per line |
| `week.ts` fetch and refresh `catch` | the request threw | toast |
| `week.ts` pin failure | pin failed | toast |
| `today.ts` `undoOptimisticMark` | pin or unpin failed | toast — which also retires the uneven lifetime CB#218 described |
| `settings.ts` remove failure; save failure after the form closed | action failed | toast |
| `that-timer.ts` / `rail.ts` swallowed start failure | nothing shown today | toast (CB#207) |
| `that-entry-dialog.ts` | validation, save or delete failed | dialog block |
| `that-stop-dialog.ts` | nothing shown today | dialog block (CB#208) |
| `today.ts`, `week.ts` "could not be read" in place of content | state | stays inline |
| `today.ts` stale banner | state | stays inline |
| `settings.ts` no site URL; list could not be read | state | stays inline |
| `settings.ts` *Test connection* | verdict in its row's health slot | stays inline |
| `settings.ts` *Test connection* failure | the failure's message (CB#301) | toast |
| `settings.ts` instance form error | form on the page | stays inline |
| `rail.ts` `showPushError` | the drawn rail line | stays |

CB#207 and CB#208 were put back to needs-refinement on 2026-09-25 to take their message placement from this
document rather than ship with today's.

## Out of scope

- The phone layout of the stack.
- The stale banner, which describes a state and whose behaviour CB#71 settled.
- The wording of any message.
- A history of dismissed toasts.
