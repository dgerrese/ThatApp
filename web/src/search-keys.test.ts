import test from "node:test";
import assert from "node:assert/strict";

import { nextSearchFocus } from "./search-keys.ts";

void test("arrow and Escape movement across result rows", async (t) => {
  const rows = [3, 2, 3]; // key+Log+pin, a no-URL row (Log+pin), key+Log+pin
  const cases: {
    name: string;
    from: { row: number; column: number } | "input";
    key: string;
    want: ReturnType<typeof nextSearchFocus>;
  }[] = [
    {
      name: "down from the input lands on the first control",
      from: "input",
      key: "ArrowDown",
      want: { row: 0, column: 0 },
    },
    { name: "up in the input is not handled", from: "input", key: "ArrowUp", want: null },
    { name: "escape in the input is not handled here", from: "input", key: "Escape", want: null },
    {
      name: "down keeps the column",
      from: { row: 0, column: 1 },
      key: "ArrowDown",
      want: { row: 1, column: 1 },
    },
    {
      name: "down clamps to a shorter row",
      from: { row: 0, column: 2 },
      key: "ArrowDown",
      want: { row: 1, column: 1 },
    },
    {
      name: "up from the first row returns to the input",
      from: { row: 0, column: 2 },
      key: "ArrowUp",
      want: "input",
    },
    {
      name: "down from the last row stays",
      from: { row: 2, column: 1 },
      key: "ArrowDown",
      want: { row: 2, column: 1 },
    },
    {
      name: "right moves along the row",
      from: { row: 0, column: 0 },
      key: "ArrowRight",
      want: { row: 0, column: 1 },
    },
    {
      name: "right at the end stays",
      from: { row: 0, column: 2 },
      key: "ArrowRight",
      want: { row: 0, column: 2 },
    },
    {
      name: "left at the start stays",
      from: { row: 1, column: 0 },
      key: "ArrowLeft",
      want: { row: 1, column: 0 },
    },
    {
      name: "escape in a row returns to the input",
      from: { row: 1, column: 1 },
      key: "Escape",
      want: "input",
    },
    { name: "tab is not handled", from: { row: 1, column: 1 }, key: "Tab", want: null },
  ];
  for (const c of cases) {
    await t.test(c.name, () => {
      assert.deepEqual(nextSearchFocus(rows, c.from, c.key), c.want);
    });
  }
});

void test("rows with no controls are skipped", () => {
  assert.deepEqual(nextSearchFocus([0, 2], "input", "ArrowDown"), { row: 1, column: 0 });
  assert.deepEqual(nextSearchFocus([2, 0, 2], { row: 0, column: 1 }, "ArrowDown"), {
    row: 2,
    column: 1,
  });
  assert.deepEqual(nextSearchFocus([0, 0], "input", "ArrowDown"), null);
});
