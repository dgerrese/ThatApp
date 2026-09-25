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
  /** A drawn silhouette: disc, ring, triangle — one each, so no two states
   *  are told apart by hue alone. */
  shape?: string;
  /** Or a real icon, for the one state only a roomy consumer draws. */
  icon?: "success";
}

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
