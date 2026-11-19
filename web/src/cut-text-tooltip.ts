/**
 * The `that-tooltip` construction every cut-text site shares: `wrap` and
 * `when-cut` are always set together (see that-tooltip.ts's own contract).
 * The text it names is always its own Tab stop (CB#236), so the tooltip opens on
 * that text's hover and focus and never on a neighbour's. `below` is opt-in,
 * for the one row shape (the search panel's key-over-summary stack, CB#143
 * task 7) where the tooltip's own default of opening above would cover
 * something focus just moved to.
 */
export function cutTextTooltip(forId: string, text: string, below?: boolean): HTMLElement {
  const tooltip = document.createElement("that-tooltip");
  tooltip.setAttribute("for", forId);
  tooltip.setAttribute("wrap", "");
  tooltip.setAttribute("when-cut", "");
  if (below) tooltip.setAttribute("below", "");
  tooltip.textContent = text;

  return tooltip;
}
