import test from "node:test";
import assert from "node:assert/strict";

import { rowStepTarget, type CellSlot } from "./table-keys.ts";

// Column numbers as Today's own row shape: 0 key, 1 summary, 2 status, 3 today, 4 actions.
const KEY = 0;
const SUMMARY = 1;
const TODAY = 3;
const ACTIONS = 4;

void test("rowStepTarget", async (t) => {
  const cases: {
    name: string;
    source: CellSlot;
    target: CellSlot[];
    want: number | null;
  }[] = [
    {
      name: "an exact cell and index match wins",
      source: { cell: SUMMARY, index: 0 },
      target: [
        { cell: KEY, index: 0 },
        { cell: SUMMARY, index: 0 },
        { cell: TODAY, index: 0 },
      ],
      want: 1,
    },
    {
      name: "the same cell exists but with fewer focusables: clamps to its last one",
      source: { cell: ACTIONS, index: 1 },
      target: [
        { cell: SUMMARY, index: 0 },
        { cell: ACTIONS, index: 0 },
      ],
      want: 1,
    },
    {
      name: "a missing cell lands on the nearest cell's first focusable",
      source: { cell: TODAY, index: 0 },
      target: [
        { cell: SUMMARY, index: 0 },
        { cell: ACTIONS, index: 0 },
        { cell: ACTIONS, index: 1 },
      ],
      want: 1,
    },
    {
      name: "a tie in distance goes to the lower cell",
      source: { cell: SUMMARY, index: 0 },
      target: [
        { cell: KEY, index: 0 },
        { cell: TODAY, index: 0 },
      ],
      want: 0,
    },
    {
      name: "an empty target returns null",
      source: { cell: SUMMARY, index: 0 },
      target: [],
      want: null,
    },
  ];

  for (const c of cases) {
    await t.test(c.name, () => {
      assert.equal(rowStepTarget(c.source, c.target), c.want);
    });
  }
});

void test("Review Focus 1: rows of different shape", async (t) => {
  // A row with no URL renders no key link, so its cell 0 is absent from `target`.
  const rowWithNoKeyLink: CellSlot[] = [
    { cell: SUMMARY, index: 0 },
    { cell: TODAY, index: 0 },
    { cell: ACTIONS, index: 0 },
    { cell: ACTIONS, index: 1 },
  ];

  await t.test("Down from a key onto a row with no URL lands on that row's summary", () => {
    const target = rowStepTarget({ cell: KEY, index: 0 }, rowWithNoKeyLink);
    assert.equal(target, 0);
    assert.deepEqual(rowWithNoKeyLink[target as number], { cell: SUMMARY, index: 0 });
  });

  await t.test("Down again from there onto a linked row lands on its summary, not its key", () => {
    const linkedRow: CellSlot[] = [
      { cell: KEY, index: 0 },
      { cell: SUMMARY, index: 0 },
      { cell: TODAY, index: 0 },
    ];

    const target = rowStepTarget({ cell: SUMMARY, index: 0 }, linkedRow);
    assert.equal(target, 1);
    assert.deepEqual(linkedRow[target as number], { cell: SUMMARY, index: 0 });
  });
});

void test("Review Focus 3: the actions cell's two focusables (timer, pin)", () => {
  const nextRowActions: CellSlot[] = [
    { cell: SUMMARY, index: 0 },
    { cell: ACTIONS, index: 0 }, // timer
    { cell: ACTIONS, index: 1 }, // pin
  ];

  const target = rowStepTarget({ cell: ACTIONS, index: 1 }, nextRowActions);
  assert.equal(target, 2);
  assert.deepEqual(nextRowActions[target as number], { cell: ACTIONS, index: 1 });
});
