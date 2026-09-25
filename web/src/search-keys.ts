/** Where focus goes for one arrow or Escape press inside the results. `rows` is each row's count of
 *  focusable elements, in order. `null` means the key is not the panel's to handle. */
export type SearchFocus = { row: number; column: number } | "input" | null;

export function nextSearchFocus(
  rows: number[],
  from: { row: number; column: number } | "input",
  key: string,
): SearchFocus {
  if (from === "input") {
    if (key !== "ArrowDown") return null;
    const row = rows.findIndex((count) => count > 0);

    return row === -1 ? null : { row, column: 0 };
  }

  const { row, column } = from;
  if (key === "Escape") return "input";
  if (key === "ArrowLeft") return { row, column: Math.max(column - 1, 0) };
  if (key === "ArrowRight") {
    const count = rows[row] ?? 0;

    return { row, column: Math.min(column + 1, count - 1) };
  }
  if (key !== "ArrowDown" && key !== "ArrowUp") return null;

  const step = key === "ArrowDown" ? 1 : -1;
  for (let r = row + step; r >= 0 && r < rows.length; r += step) {
    const count = rows[r] ?? 0;
    if (count > 0) return { row: r, column: Math.min(column, count - 1) };
  }

  return key === "ArrowUp" ? "input" : { row, column };
}
