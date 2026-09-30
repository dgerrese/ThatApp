/** A focusable element's place in its row: which cell, and which focusable inside that cell. */
export interface CellSlot {
  cell: number;
  index: number;
}

/** `a[href]` (never a bare `<a>`, which cannot be tabbed to), an enabled button, or an explicit
 *  tab stop — the three shapes a row's own controls take (that-ticket-row.ts). */
const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), [tabindex="0"]';

/**
 * Where focus goes in a target row, given the source slot and the target row's focusables as
 * slots (in DOM order). Returns an index into `target`, or null when `target` is empty.
 * One nearest-slot search covers exact match, clamp-to-last and nearest-cell alike.
 */
export function rowStepTarget(source: CellSlot, target: CellSlot[]): number | null {
  if (target.length === 0) return null;

  const cells = new Set(target.map((slot) => slot.cell));
  let nearestCell = -Infinity;
  for (const cell of cells) {
    const distance = Math.abs(cell - source.cell);
    const bestDistance = Math.abs(nearestCell - source.cell);
    if (distance < bestDistance || (distance === bestDistance && cell < nearestCell)) {
      nearestCell = cell;
    }
  }

  const inCell = target
    .map((slot, index) => ({ slot, index }))
    .filter((entry) => entry.slot.cell === nearestCell);

  if (nearestCell !== source.cell) {
    return inCell.reduce((first, entry) => (entry.slot.index < first.slot.index ? entry : first))
      .index;
  }

  // Nearest index is the exact match if present, else the last one: clamping for free.
  return inCell.reduce((nearest, entry) =>
    Math.abs(entry.slot.index - source.index) < Math.abs(nearest.slot.index - source.index)
      ? entry
      : nearest,
  ).index;
}

function isVisible(element: HTMLElement): boolean {
  return element.getClientRects().length > 0;
}

/** A row's cells: its direct `td`/`th` children — which is also what a `that-ticket-row` (a
 *  custom element acting as a row, its `td`s appended straight into itself) exposes here with no
 *  special case. */
function cellsOf(row: Element): Element[] {
  return Array.from(row.children).filter(
    (child) => child.tagName === "TD" || child.tagName === "TH",
  );
}

/** Every focusable in `row`, as slots paired with the element each one names — DOM order within
 *  a cell is what gives `index` its meaning, and cell order is what gives `cell` its meaning. */
function slotsOf(row: Element): { slot: CellSlot; element: HTMLElement }[] {
  const entries: { slot: CellSlot; element: HTMLElement }[] = [];
  cellsOf(row).forEach((cell, cellIndex) => {
    const focusables = Array.from(cell.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      isVisible,
    );
    focusables.forEach((element, index) => {
      entries.push({ slot: { cell: cellIndex, index }, element });
    });
  });

  return entries;
}

/**
 * Wires Up/Down on `root` for rows matching `rowSelector` (in document order). Returns the
 * function that removes the listener.
 *
 * Reads the DOM fresh on every keypress rather than caching rows or slots — a re-sort, a pin's
 * repaint or a timer tick must not leave this working from a stale layout (Review Focus 2).
 */
export function enableRowArrowKeys(root: HTMLElement, rowSelector: string): () => void {
  const handleKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;

    const row = active.closest(rowSelector);
    if (!row || !root.contains(row)) return;

    const sourceEntry = slotsOf(row).find((entry) => entry.element === active);
    if (!sourceEntry) return;

    // Rows with no focusable are excluded, not merely skipped past: Today's Down-from-last-row
    // must reach the next table's first row directly, and a header (never matched by
    // rowSelector) or an empty "No issues assigned." section carries none to land on anyway.
    const rows = Array.from(root.querySelectorAll(rowSelector)).filter(
      (candidate) => slotsOf(candidate).length > 0,
    );
    const rowIndex = rows.indexOf(row);
    if (rowIndex === -1) return;

    event.preventDefault();

    const targetRow = rows[rowIndex + (event.key === "ArrowDown" ? 1 : -1)];
    if (!targetRow) return;

    const targetSlots = slotsOf(targetRow);
    const targetIndex = rowStepTarget(
      sourceEntry.slot,
      targetSlots.map((entry) => entry.slot),
    );
    if (targetIndex === null) return;

    const targetEntry = targetSlots[targetIndex];
    targetEntry?.element.focus();
  };

  root.addEventListener("keydown", handleKeydown);

  return () => {
    root.removeEventListener("keydown", handleKeydown);
  };
}
