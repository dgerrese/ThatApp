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
 * The announcement carries the responses themselves — one per day the period
 * held — so the one listener that renders them (Today's report region) does
 * not have to ask the server again for what these calls already returned.
 *
 * `unanswered` rides alongside them because a day whose request threw produces
 * no response at all: it is in neither the pushed nor the failed count, and a
 * report that only counted responses would call a half-finished push a success.
 */
interface PushReported {
  responses: PushResponse[];
  unanswered: string[];
}

export function announcePushReported(responses: PushResponse[], unanswered: string[]): void {
  document.dispatchEvent(
    new CustomEvent<PushReported>(PUSH_REPORTED, { detail: { responses, unanswered } }),
  );
}

/** Returns the function that stops listening. */
export function onPushReported(
  handle: (responses: PushResponse[], unanswered: string[]) => void,
): () => void {
  const listener = (event: Event): void => {
    const { responses, unanswered } = (event as CustomEvent<PushReported>).detail;
    handle(responses, unanswered);
  };
  document.addEventListener(PUSH_REPORTED, listener);

  return () => {
    document.removeEventListener(PUSH_REPORTED, listener);
  };
}
