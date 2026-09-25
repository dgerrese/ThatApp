/**
 * The `that-tooltip` construction every cut-text site shares: `wrap` and
 * `when-cut` are always set together (see that-tooltip.ts's own contract),
 * and `focus-for` is set only when there is something to focus — an empty
 * or absent id means the row has nothing focusable to follow. `below` is
 * opt-in, for the one row shape (the search panel's key-over-summary stack,
 * #143 task 7) where the tooltip's own default of opening above would cover
 * something focus just moved to.
 */
export function cutTextTooltip(
  forId: string,
  text: string,
  focusForId?: string,
  below?: boolean,
): HTMLElement {
  const tooltip = document.createElement("that-tooltip");
  tooltip.setAttribute("for", forId);
  if (focusForId) tooltip.setAttribute("focus-for", focusForId);
  tooltip.setAttribute("wrap", "");
  tooltip.setAttribute("when-cut", "");
  if (below) tooltip.setAttribute("below", "");
  tooltip.textContent = text;

  return tooltip;
}
