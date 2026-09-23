import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compareRows,
  nextSortState,
  parseSortState,
  serializeSortState,
  type SortColumn,
  type SortableRow,
  type SortState,
} from "./table-sort.ts";

/** Builds rows in arrival order: `order` is each row's index in the list. */
function rows(partials: Partial<SortableRow>[]): SortableRow[] {
  return partials.map((partial, order) => ({
    key: partial.key ?? "",
    summary: partial.summary ?? "",
    status: partial.status ?? "",
    seconds: partial.seconds ?? 0,
    elapsed: partial.elapsed ?? 0,
    order,
  }));
}

test("the cycle for each column", async (t) => {
  const ascendingFirst: SortColumn[] = ["key", "summary", "status"];

  for (const column of ascendingFirst) {
    await t.test(`${column}: null -> ascending -> descending -> null`, () => {
      const first = nextSortState(null, column);
      assert.deepEqual(first, { column, direction: "ascending" });

      const second = nextSortState(first, column);
      assert.deepEqual(second, { column, direction: "descending" });

      const third = nextSortState(second, column);
      assert.equal(third, null);
    });
  }

  await t.test("today: null -> descending -> ascending -> null", () => {
    const first = nextSortState(null, "today");
    assert.deepEqual(first, { column: "today", direction: "descending" });

    const second = nextSortState(first, "today");
    assert.deepEqual(second, { column: "today", direction: "ascending" });

    const third = nextSortState(second, "today");
    assert.equal(third, null);
  });

  await t.test("clicking another column mid-cycle starts that column's natural direction", () => {
    const midCycle: SortState = { column: "key", direction: "descending" };

    assert.deepEqual(nextSortState(midCycle, "summary"), {
      column: "summary",
      direction: "ascending",
    });
    assert.deepEqual(nextSortState(midCycle, "today"), {
      column: "today",
      direction: "descending",
    });
  });
});

test("key sorts by project then issue number, case-insensitively", () => {
  const data = rows([
    { key: "RIDGE-10" },
    { key: "ridge-9" },
    { key: "NW-2" },
    { key: "RIDGE-9" },
  ]);
  const state: SortState = { column: "key", direction: "ascending" };

  const sorted = [...data].sort((a, b) => compareRows(a, b, state));

  assert.deepEqual(
    sorted.map((row) => row.key),
    ["NW-2", "ridge-9", "RIDGE-9", "RIDGE-10"],
  );
});

test("a key without a number sorts by its text", () => {
  const data = rows([{ key: "TASKS" }, { key: "APPLE" }, { key: "RIDGE-9" }]);
  const state: SortState = { column: "key", direction: "ascending" };

  const sorted = [...data].sort((a, b) => compareRows(a, b, state));

  assert.deepEqual(
    sorted.map((row) => row.key),
    ["APPLE", "RIDGE-9", "TASKS"],
  );
});

test("an empty or blank tail is not a number, so the key falls back to text", () => {
  // Arrival order is reversed relative to the wanted text order, so a bug that
  // treats "" or "  " as the number 0 (Number("") and Number("  ") are both 0)
  // would tie on {project, number} and fall back to *this* arrival order — the
  // opposite of the text comparison the brief requires.
  const data = rows([{ key: "Z-0" }, { key: "Z-" }]);
  const state: SortState = { column: "key", direction: "ascending" };

  const sorted = [...data].sort((a, b) => compareRows(a, b, state));

  assert.deepEqual(
    sorted.map((row) => row.key),
    ["Z-", "Z-0"],
  );
});

test("a blank tail (not just empty) also falls back to text", () => {
  // Arrival order again runs opposite the wanted text order (see the test above).
  const data = rows([{ key: "Z-0" }, { key: "Z-  " }]);
  const state: SortState = { column: "key", direction: "ascending" };

  const sorted = [...data].sort((a, b) => compareRows(a, b, state));

  assert.deepEqual(
    sorted.map((row) => row.key),
    ["Z-  ", "Z-0"],
  );
});

test("a project name carrying its own dash still splits on the last one", () => {
  const data = rows([{ key: "A-B-100" }, { key: "A-B-12" }]);
  const state: SortState = { column: "key", direction: "ascending" };

  const sorted = [...data].sort((a, b) => compareRows(a, b, state));

  assert.deepEqual(
    sorted.map((row) => row.key),
    ["A-B-12", "A-B-100"],
  );
});

test("summary sorts case-insensitively", () => {
  const data = rows([{ summary: "banana" }, { summary: "Apple" }, { summary: "cherry" }]);
  const state: SortState = { column: "summary", direction: "ascending" };

  const sorted = [...data].sort((a, b) => compareRows(a, b, state));

  assert.deepEqual(
    sorted.map((row) => row.summary),
    ["Apple", "banana", "cherry"],
  );
});

test("status sorts case-insensitively", () => {
  const data = rows([{ status: "To Do" }, { status: "blocked" }, { status: "In Review" }]);
  const state: SortState = { column: "status", direction: "ascending" };

  const sorted = [...data].sort((a, b) => compareRows(a, b, state));

  assert.deepEqual(
    sorted.map((row) => row.status),
    ["blocked", "In Review", "To Do"],
  );
});

test("today descending puts the most seconds first", () => {
  const data = rows([{ seconds: 900 }, { seconds: 3600 }, { seconds: 1800 }]);
  const state: SortState = { column: "today", direction: "descending" };

  const sorted = [...data].sort((a, b) => compareRows(a, b, state));

  assert.deepEqual(
    sorted.map((row) => row.seconds),
    [3600, 1800, 900],
  );
});

test("today ascending puts the least seconds first", () => {
  const data = rows([{ seconds: 900 }, { seconds: 3600 }, { seconds: 1800 }]);
  const state: SortState = { column: "today", direction: "ascending" };

  const sorted = [...data].sort((a, b) => compareRows(a, b, state));

  assert.deepEqual(
    sorted.map((row) => row.seconds),
    [900, 1800, 3600],
  );
});

test("today compares the shown figure: a running row's elapsed time counts", () => {
  // RUNNING has logged less (0:59 against 1:00) but shows more (1:01) with two
  // minutes on its timer, so it must lead a descending sort.
  const data = rows([
    { key: "STOPPED", seconds: 3600 },
    { key: "RUNNING", seconds: 3540, elapsed: 120 },
  ]);
  const state: SortState = { column: "today", direction: "descending" };

  const sorted = [...data].sort((a, b) => compareRows(a, b, state));

  assert.deepEqual(
    sorted.map((row) => row.key),
    ["RUNNING", "STOPPED"],
  );
});

test("ties keep arrival order ascending and descending", () => {
  const data = rows([{ status: "todo" }, { status: "todo" }, { status: "todo" }]);

  const ascending = [...data].sort((a, b) =>
    compareRows(a, b, { column: "status", direction: "ascending" }),
  );
  const descending = [...data].sort((a, b) =>
    compareRows(a, b, { column: "status", direction: "descending" }),
  );

  assert.deepEqual(
    ascending.map((row) => row.order),
    [0, 1, 2],
  );
  assert.deepEqual(
    descending.map((row) => row.order),
    [0, 1, 2],
  );
});

test("null restores arrival order", () => {
  const data = rows([{ key: "C-1" }, { key: "A-1" }, { key: "B-1" }]);
  const sortedByKey = [...data].sort((a, b) =>
    compareRows(a, b, { column: "key", direction: "ascending" }),
  );
  assert.deepEqual(
    sortedByKey.map((row) => row.key),
    ["A-1", "B-1", "C-1"],
  );

  const restored = [...sortedByKey].sort((a, b) => compareRows(a, b, null));
  assert.deepEqual(
    restored.map((row) => row.key),
    ["C-1", "A-1", "B-1"],
  );
});

test("parseSortState round-trips serializeSortState", () => {
  const states: (SortState | null)[] = [
    null,
    { column: "key", direction: "ascending" },
    { column: "today", direction: "descending" },
  ];

  for (const state of states) {
    const stored = serializeSortState(state);
    assert.deepEqual(parseSortState(stored), state);
  }
});

test("parseSortState refuses anything that isn't exactly a known column and direction", () => {
  const cases: [string, string | null][] = [
    ["null", null],
    ["empty string", ""],
    ["truncated JSON", "{"],
    ["missing direction", JSON.stringify({ column: "key" })],
    ["unknown column", JSON.stringify({ column: "x", direction: "ascending" })],
    ["wrong direction", JSON.stringify({ column: "key", direction: "up" })],
    ["a bare JSON array", "[]"],
    ["a bare JSON string", '"key"'],
  ];

  for (const [name, stored] of cases) {
    assert.equal(parseSortState(stored), null, name);
  }
});
