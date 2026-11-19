import type { Entry } from "./types.ts";

/**
 * Every state a push mark speaks for: an entry's own, plus `failed`, which
 * comes off a push response rather than the entry. Because PUSH_MARKS is
 * checked against this union, a state added to `Entry["pushState"]` fails to
 * compile until it has a mark.
 */
export type MarkedPushState = Entry["pushState"] | "failed";

export interface PushMark {
  /** What a reader who cannot see the mark hears, and what the popover says. */
  words: string;
  /** The colour. Every shape draws in `currentColor`, so it is named once. */
  tone: string;
  /** A drawn silhouette: disc, ring, triangle, slashed ring — one each, so no
   *  two states are told apart by hue alone. */
  shape?: string;
  /** SVG drawn inside the shape's box, for the one mark a border cannot draw. */
  markup?: string;
  /** Or a real icon, for the one state only a roomy consumer draws. */
  icon?: "success";
}

/** CB#280's slashed ring: dirty's ring with a slash stopping at its inner edge,
 *  like a "no entry" sign, as the design session of 2026-10-08 drew it. */
const SLASHED_RING =
  '<svg class="block" width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">' +
  '<circle cx="4.5" cy="4.5" r="3.75" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
  '<path d="M2.15 6.85 6.85 2.15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
  "</svg>";

/**
 * The words are the same in every place a mark shows, because a state that is
 * "not pushed" in one view and something else in another is two states to a
 * reader. Disc and ring are 7px, as the prototype draws them; the triangle is
 * 9×8 — grown from 6×5, which read as a smudge rather than a triangle — drawn
 * out of borders so its size is the layout's rather than the font's.
 */
export const PUSH_MARKS = {
  unpushed: {
    words: "not pushed",
    tone: "text-pending",
    shape: "size-[7px] rounded-full bg-current",
  },
  dirty: {
    words: "edited since it was pushed",
    tone: "text-dirty",
    shape: "size-[7px] rounded-full border-[1.5px] border-current",
  },
  failed: {
    words: "push failed",
    tone: "text-failed",
    shape: "size-0 border-x-[4.5px] border-b-[8px] border-x-transparent border-b-current",
  },
  deleted: {
    words: "deleted at next push",
    // Dirty's hue: Jira holds this time, and what Jira holds is now wrong.
    tone: "text-dirty",
    shape: "size-[9px]",
    markup: SLASHED_RING,
  },
  pushed: {
    words: "pushed",
    tone: "text-running",
    icon: "success" as const,
  },
} satisfies Record<MarkedPushState, PushMark>;

/**
 * pushState crosses the network and is only typed at compile time, so a state
 * this build does not know (a cached shell against a newer server) has to
 * resolve to something. "Not pushed" is the safe direction: telling someone
 * their time reached Jira when it did not is the one wrong answer that is
 * indistinguishable from a true one.
 */
export function knownPushState<S extends MarkedPushState>(state: S): S | "unpushed" {
  return Object.hasOwn(PUSH_MARKS, state) ? state : "unpushed";
}

/** Whether an entry counts in a total. A pending delete does not: every total
 *  says what Jira will hold once the push has run (CB#280). */
export function countsInTotals(entry: Pick<Entry, "pushState">): boolean {
  return entry.pushState !== "deleted";
}
