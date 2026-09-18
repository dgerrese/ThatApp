export type SortColumn = "key" | "summary" | "status" | "today";
export type SortDirection = "ascending" | "descending";
export interface SortState {
  column: SortColumn;
  direction: SortDirection;
}
export interface SortableRow {
  key: string;
  summary: string;
  status: string;
  seconds: number;
  order: number;
}

const COLUMNS: readonly SortColumn[] = ["key", "summary", "status", "today"];
const DIRECTIONS: readonly SortDirection[] = ["ascending", "descending"];

const NATURAL_DIRECTION: Record<SortColumn, SortDirection> = {
  key: "ascending",
  summary: "ascending",
  status: "ascending",
  today: "descending",
};

function reversed(direction: SortDirection): SortDirection {
  return direction === "ascending" ? "descending" : "ascending";
}

export function nextSortState(current: SortState | null, clicked: SortColumn): SortState | null {
  if (current === null || current.column !== clicked) {
    return { column: clicked, direction: NATURAL_DIRECTION[clicked] };
  }
  if (current.direction === NATURAL_DIRECTION[clicked]) {
    return { column: clicked, direction: reversed(current.direction) };
  }
  return null;
}

/** A key's project and issue number, split on the last `-`; null when that tail isn't digits-only. */
function parseKey(key: string): { project: string; number: number } | null {
  const dash = key.lastIndexOf("-");
  if (dash === -1) return null;
  const tail = key.slice(dash + 1);
  if (!/^\d+$/.test(tail)) return null;
  return { project: key.slice(0, dash), number: Number(tail) };
}

function compareKey(a: string, b: string): number {
  const parsedA = parseKey(a);
  const parsedB = parseKey(b);
  if (parsedA === null || parsedB === null) {
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  }
  const projectCompare = parsedA.project.localeCompare(parsedB.project, undefined, {
    sensitivity: "base",
  });
  return projectCompare !== 0 ? projectCompare : parsedA.number - parsedB.number;
}

function compareColumn(a: SortableRow, b: SortableRow, column: SortColumn): number {
  switch (column) {
    case "key":
      return compareKey(a.key, b.key);
    case "summary":
      return a.summary.localeCompare(b.summary, undefined, { sensitivity: "base" });
    case "status":
      return a.status.localeCompare(b.status, undefined, { sensitivity: "base" });
    case "today":
      return a.seconds - b.seconds;
  }
}

export function compareRows(a: SortableRow, b: SortableRow, state: SortState | null): number {
  if (state === null) return a.order - b.order;

  const compared = compareColumn(a, b, state.column);
  const signed = state.direction === "descending" ? -compared : compared;
  return signed !== 0 ? signed : a.order - b.order;
}

function isSortColumn(value: unknown): value is SortColumn {
  return typeof value === "string" && (COLUMNS as readonly string[]).includes(value);
}

function isSortDirection(value: unknown): value is SortDirection {
  return typeof value === "string" && (DIRECTIONS as readonly string[]).includes(value);
}

export function parseSortState(stored: string | null): SortState | null {
  if (stored === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const column = (parsed as { column?: unknown }).column;
  const direction = (parsed as { direction?: unknown }).direction;
  if (!isSortColumn(column) || !isSortDirection(direction)) return null;

  return { column, direction };
}

export function serializeSortState(state: SortState | null): string | null {
  return state === null ? null : JSON.stringify(state);
}
