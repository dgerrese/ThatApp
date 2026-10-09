import test from "node:test";
import assert from "node:assert/strict";

import { placeInStacks, type CardHeight, type Stack } from "./card-stacks.ts";

/** Cards with ids 1… in instance order, of the given heights. */
function cards(...heights: number[]): CardHeight[] {
  return heights.map((height, index) => ({ id: index + 1, height }));
}

void test("placeInStacks", async (t) => {
  const cases: {
    name: string;
    cards: CardHeight[];
    remembered: [number, Stack][];
    want: Stack[];
  }[] = [
    {
      name: "the reported case: an empty card after a tall and a short one joins the short one",
      cards: cards(400, 150, 60),
      remembered: [],
      want: ["left", "right", "right"],
    },
    {
      name: "a tie goes left, for the first card and for a later one",
      cards: cards(100, 100, 50),
      remembered: [],
      want: ["left", "right", "left"],
    },
    {
      name: "cards are placed in instance order, not tallest first",
      cards: cards(50, 300, 100),
      remembered: [],
      want: ["left", "right", "left"],
    },
    {
      name: "a remembered stack is kept, even where the other stack is now the shorter",
      cards: cards(50, 300, 40),
      remembered: [
        [1, "right"],
        [2, "left"],
        [3, "left"],
      ],
      want: ["right", "left", "left"],
    },
    {
      name: "a new card goes to the stack that is shorter with every remembered card counted",
      cards: cards(100, 50, 300),
      remembered: [
        [1, "left"],
        [3, "right"],
      ],
      want: ["left", "left", "right"],
    },
    {
      name: "a new last card joins the shorter stack",
      cards: cards(400, 150, 60, 80),
      remembered: [
        [1, "left"],
        [2, "right"],
        [3, "right"],
      ],
      want: ["left", "right", "right", "right"],
    },
    {
      name: "a remembered instance that is gone is forgotten",
      cards: cards(100),
      remembered: [[9, "right"]],
      want: ["left"],
    },
    {
      name: "nothing to place places nothing",
      cards: [],
      remembered: [],
      want: [],
    },
  ];

  for (const c of cases) {
    await t.test(c.name, () => {
      const got = placeInStacks(c.cards, new Map(c.remembered));

      assert.deepEqual(
        c.cards.map((card) => got.get(card.id)),
        c.want,
      );
      assert.equal(got.size, c.cards.length, "the placement holds a card that is not on screen");
    });
  }
});
