import { iconMarkup } from "../icons";

/**
 * The header's first four columns each hold a sort control; c-act carries
 * none, since a header for the action column names nothing to sort by.
 */
const SORTABLE_COLUMNS: Array<{ cls: string; label: string }> = [
  { cls: "c-key", label: "Key" },
  { cls: "c-sum", label: "Summary" },
  { cls: "c-status", label: "Status" },
  { cls: "c-today", label: "Today" },
];

/**
 * The shell both listing views share: a card holding a real table, with the
 * header row every instance card carries so no two of them can disagree
 * about where a column starts — that agreement is `.that-tbl`'s one spacing
 * rule in styles.css, and it only works if every card has the row to
 * disagree from.
 *
 * The card is all this is — no heading. The prototype (line 335) draws an
 * instance's name, dot and count as `.grouph`, a sibling *before* `.tcard`,
 * never inside it; a heading attribute here would have to take the dot's hue,
 * the name and the count separately, which is attribute sprawl for values the
 * view already holds. The view renders that heading itself, above the card.
 * `that-card` stays for the other places that already use its own heading, so
 * this matches its elevation and padding rather than inventing a second card.
 *
 * The table, thead and tbody are built in the constructor rather than
 * connectedCallback, because `body` has to exist the moment the element is
 * created — a caller fills it with rows before ever inserting the element
 * into the document, and connectedCallback would not run until that
 * insertion happens.
 *
 * Sorting is #83's: the controls below render `sortable` at rest and carry
 * no click handler.
 */
export class ThatTable extends HTMLElement {
  readonly body: HTMLTableSectionElement;
  private readonly table: HTMLTableElement;

  constructor() {
    super();

    this.table = document.createElement("table");
    this.table.className = "that-tbl w-full";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    for (const column of SORTABLE_COLUMNS) {
      headerRow.append(this.sortHeaderCell(column.cls, column.label));
    }
    const actionHeader = document.createElement("th");
    actionHeader.className = "c-act";
    headerRow.append(actionHeader);
    thead.append(headerRow);

    this.body = document.createElement("tbody");
    this.table.append(thead, this.body);
  }

  connectedCallback(): void {
    this.className = "bg-raised shadow-card block rounded-md px-5 py-4";
    this.replaceChildren(this.table);
  }

  private sortHeaderCell(cls: string, label: string): HTMLTableCellElement {
    const th = document.createElement("th");
    th.className = cls;

    const button = document.createElement("button");
    button.type = "button";
    // Colour only on hover: a padded hover box would shift the label off its
    // column, which is the whole thing the spacing rule in styles.css exists
    // to prevent.
    button.className =
      "text-ink-muted hover:text-ink flex cursor-pointer items-center gap-1 text-sm font-bold";
    button.setAttribute("aria-label", `Sort by ${label}`);
    button.innerHTML = `${label} ${iconMarkup("sortable", 13)}`;

    th.append(button);

    return th;
  }
}

customElements.define("that-table", ThatTable);
