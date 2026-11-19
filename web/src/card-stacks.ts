export type Stack = "left" | "right";

export interface CardHeight {
  id: number;
  height: number;
}

/**
 * Which of Today's two stacks each instance card goes in (CB#144). A card with a remembered stack
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

/** True while the results grid draws two columns. The 80rem container query in its class decides;
 *  this reads the verdict rather than restating the number. */
export function showsTwoStacks(grid: HTMLElement): boolean {
  return getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length === 2;
}

/**
 * Makes `elements` the first children of `stack`, in order, moving each one that is elsewhere.
 * `moveBefore` moves a card without the disconnect a plain insert fires, so no row rebuilds and a
 * focused control keeps focus — that-table's reorder() has the same reasoning, and the same
 * fallback for an engine without it.
 */
export function moveIntoStack(stack: HTMLElement, elements: readonly HTMLElement[]): void {
  // Typed here, not through the ParentNode augmentation in that-table.ts: the unit-test
  // project compiles this file without that one.
  const mover: Pick<HTMLElement, "insertBefore"> & {
    moveBefore?(node: Node, child: Node | null): void;
  } = stack;

  elements.forEach((element, index) => {
    const current = stack.children[index] ?? null;
    if (current === element) return;

    if (mover.moveBefore) {
      mover.moveBefore(element, current);
    } else {
      stack.insertBefore(element, current);
    }
  });
}
