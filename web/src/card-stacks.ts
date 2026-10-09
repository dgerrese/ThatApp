export type Stack = "left" | "right";

export interface CardHeight {
  id: number;
  height: number;
}

/**
 * Which of Today's two stacks each instance card goes in (#144). A card with a remembered stack
 * keeps it, however the heights have changed since. Each other card, in the order given (instance
 * position order), goes to the stack that is shorter at that moment, counting every remembered
 * card in full; a tie goes left. `height` is what a card adds to its stack — its own height plus
 * the gap below it.
 */
export function placeInStacks(
  cards: readonly CardHeight[],
  remembered: ReadonlyMap<number, Stack>,
): Map<number, Stack> {
  const placement = new Map<number, Stack>();
  const heights: Record<Stack, number> = { left: 0, right: 0 };

  for (const card of cards) {
    const stack = remembered.get(card.id);
    if (stack === undefined) continue;
    placement.set(card.id, stack);
    heights[stack] += card.height;
  }

  for (const card of cards) {
    if (placement.has(card.id)) continue;
    const stack: Stack = heights.left <= heights.right ? "left" : "right";
    placement.set(card.id, stack);
    heights[stack] += card.height;
  }

  return placement;
}
