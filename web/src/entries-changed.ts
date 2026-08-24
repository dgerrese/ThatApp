/**
 * The one announcement that logged time has moved, and the only place its name
 * is spelled.
 *
 * It is a module of its own so the rail can listen without importing the dialog
 * that fires it. The rail lives in the shell, and an import there would pull the
 * dialog into the entry bundle and spend the 14kB budget on a component nobody
 * has opened yet.
 *
 * `wd-`, not the bare `entries-changed` the design writes: every custom event
 * this app raises is prefixed, a rule #6 arrived at after `select` collided
 * with the native text-selection event in light DOM. Nothing native is called
 * `entries-changed`, so this is not that bug — but a second convention would be
 * worse than the inconsistency it fixes. #8 and #9 fire the same event.
 */
// A type-only import, erased at compile time — nothing of the dialog reaches
// the shell bundle through this file.
import type { Entry } from "./types";

const ENTRIES_CHANGED = "wd-entries-changed";

/**
 * Fired on `document` rather than bubbled from whatever changed: the rail is a
 * sibling of the view, not an ancestor of it, so there is no shared element
 * below `document` for the event to travel through.
 *
 * The announcement carries the day's entries when the announcer has just read
 * them, so every listener repaints from the one response the mutation already
 * paid for — one request, one error policy, and totals that agree because
 * they are one list. An announcement without them tells listeners to read the
 * day themselves.
 */
export function announceEntriesChanged(entries?: Entry[]): void {
  document.dispatchEvent(new CustomEvent<Entry[] | undefined>(ENTRIES_CHANGED, { detail: entries }));
}

/** Returns the function that stops listening. */
export function onEntriesChanged(handle: (entries?: Entry[]) => void): () => void {
  const listener = (event: Event): void => {
    handle((event as CustomEvent<Entry[] | undefined>).detail);
  };
  document.addEventListener(ENTRIES_CHANGED, listener);

  return () => {
    document.removeEventListener(ENTRIES_CHANGED, listener);
  };
}
