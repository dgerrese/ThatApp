import type { IconName } from "./icons";
import { iconMarkup } from "./icons";

/**
 * The shape a header control acts on the whole view with — Decision 12 of
 * the visual language: a toolbar button carries words, where an inline
 * control (a row, a cell, a field) carries a glyph alone. Both Today's
 * refresh and Week's fetch and refresh build on this; there is one shape
 * rather than each view drawing its own.
 *
 * The label is the accessible name already, so the belt-and-braces
 * `aria-label` below repeats it rather than adds to it — the same reasoning
 * sortHeaderCell in that-table.ts gives beside its own iconMarkup call. A
 * labelled toolbar button carries no tooltip: its words are the tooltip an
 * icon-only control needed.
 *
 * A plain function and not a `that-*` component: it renders a bare button
 * with no state of its own, and CLAUDE.md reserves `that-*` for reusable UI
 * that carries some.
 */
export function toolbarButton(options: { icon: IconName; label: string }): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className =
    "inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-sm px-3 " +
    "text-base font-bold text-ink-muted hover:bg-hover hover:text-ink " +
    "disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent";
  button.setAttribute("aria-label", options.label);

  const mark = document.createElement("span");
  mark.innerHTML = iconMarkup(options.icon, 17);
  const text = document.createElement("span");
  text.textContent = options.label;

  button.append(mark, text);

  return button;
}
