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
const ENTRIES_CHANGED = "wd-entries-changed";

/**
 * Fired on `document` rather than bubbled from whatever changed: the rail is a
 * sibling of the view, not an ancestor of it, so there is no shared element
 * below `document` for the event to travel through.
 */
export function announceEntriesChanged(): void {
  document.dispatchEvent(new CustomEvent(ENTRIES_CHANGED));
}

/** Returns the function that stops listening. */
export function onEntriesChanged(handle: () => void): () => void {
  document.addEventListener(ENTRIES_CHANGED, handle);

  return () => {
    document.removeEventListener(ENTRIES_CHANGED, handle);
  };
}
