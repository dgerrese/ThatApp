/**
 * The one announcement that a push finished, and the only place its name is
 * spelled.
 *
 * It is a module of its own so the rail can trigger a push without importing
 * Today, which is what renders the result. The rail lives in the shell, and a
 * static import of Today there would pull the view into the entry bundle and
 * spend the 14kB budget on a view nobody has opened yet — the same reasoning
 * entries-changed.ts documents for the dialog.
 *
 * `that-`, per the same prefixing rule: every custom event this app raises is
 * prefixed, so it cannot collide with a native one in light DOM.
 */
// A type-only import, erased at compile time — nothing of Today reaches the
// shell bundle through this file.
import type { PushResponse } from "./types";

const PUSH_REPORTED = "that-push-reported";

/**
 * Fired on `document`, not bubbled: the rail that triggers a push is a sibling
 * of Today, the view that reports it, not an ancestor of it.
 *
 * The announcement carries the response itself, so the one listener that
 * renders it (Today's report region) does not have to ask the server again
 * for what this call already returned.
 */
export function announcePushReported(response: PushResponse): void {
  document.dispatchEvent(new CustomEvent<PushResponse>(PUSH_REPORTED, { detail: response }));
}

/** Returns the function that stops listening. */
export function onPushReported(handle: (response: PushResponse) => void): () => void {
  const listener = (event: Event): void => {
    handle((event as CustomEvent<PushResponse>).detail);
  };
  document.addEventListener(PUSH_REPORTED, listener);

  return () => {
    document.removeEventListener(PUSH_REPORTED, listener);
  };
}
