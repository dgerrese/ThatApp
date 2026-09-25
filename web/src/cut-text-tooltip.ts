/**
 * The `that-tooltip` construction every cut-text site shares: `wrap` and
 * `when-cut` are always set together (see that-tooltip.ts's own contract),
 * and `focus-for` is set only when there is something to focus — an empty
 * or absent id means the row has nothing focusable to follow.
 */
export function cutTextTooltip(forId: string, text: string, focusForId?: string): HTMLElement {
  const tooltip = document.createElement("that-tooltip");
  tooltip.setAttribute("for", forId);
  if (focusForId) tooltip.setAttribute("focus-for", focusForId);
  tooltip.setAttribute("wrap", "");
  tooltip.setAttribute("when-cut", "");
  tooltip.textContent = text;

  return tooltip;
}
