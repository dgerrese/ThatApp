import { CARD_SURFACE_CLASSES } from "../card-surface";
import { iconMarkup } from "../icons";
import {
  compareRows,
  nextSortState,
  parseSortState,
  serializeSortState,
  type SortColumn,
  type SortState,
  type SortableRow,
} from "../table-sort";

// Not yet in TypeScript's lib.dom.d.ts. Declared optional, since not every
// engine has it (see supportsMoveBefore below) — a required signature here
// would claim every ParentNode carries it, which is exactly the assumption
// that broke on Firefox ESR. Declared to the one signature this file calls —
// see reorder()'s own comment for why moveBefore is used at all.
declare global {
  interface ParentNode {
    moveBefore?(node: Node, child: Node | null): void;
  }
}

/**
 * The header's first four columns each hold a sort control; c-act carries
 * none, since a header for the action column names nothing to sort by.
 */
const SORTABLE_COLUMNS: Array<{ cls: string; column: SortColumn }> = [
  { cls: "c-key", column: "key" },
  { cls: "c-sum", column: "summary" },
  { cls: "c-status", column: "status" },
  { cls: "c-today", column: "today" },
];

const LABEL_OF: Record<SortColumn, string> = {
  key: "Key",
  summary: "Summary",
  status: "Status",
  today: "Today",
};

// Colour only on hover/active: a padded hover box would shift the label off
// its column, which is the whole thing the spacing rule in styles.css exists
// to prevent. inline-flex, not flex: the header cell is width: 1% and
// text-align: right (styles.css), which only moves an inline-level box — a
// block-level flex box ignores that and fills the column, which is what left
// the Today header flush left over a column of flush-right figures.
const HEADER_BUTTON_BASE =
  "inline-flex cursor-pointer items-center gap-1 text-xs font-bold tracking-[0.06em] uppercase";

const OBSERVED_ROW_ATTRIBUTES = ["key", "summary", "status", "seconds"];

const STORAGE_PREFIX = "thatapp.sort.";

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
 * Sorting (#83) is owned entirely here: a header click cycles this table's
 * own `SortState` (table-sort.ts) and repaints itself; Today (or Week) never
 * touches it beyond the optional `sort-id` attribute this reads at connect
 * time to persist under `thatapp.sort.<sort-id>`. Without one the table still
 * sorts, just not across a reload.
 */
export class ThatTable extends HTMLElement {
  readonly body: HTMLTableSectionElement;
  private readonly table: HTMLTableElement;
  private readonly headers = new Map<SortColumn, HTMLTableCellElement>();
  // Arrival order per row, assigned the first time sortBody sees it — this is
  // what "Jira's order" (state === null) sorts by, and what every other
  // state ties back to.
  private readonly rowOrder = new WeakMap<Element, number>();
  private nextOrder = 0;
  private sortState: SortState | null = null;
  private observer: MutationObserver | undefined;
  // Firefox's current ESR (140) predates moveBefore (Firefox 144, Chrome 133),
  // and the owner's channel is not guaranteed to be past it — see reorder()'s
  // own comment for what the fallback costs. Checked once, not per call: the
  // answer cannot change over the table's lifetime.
  private readonly supportsMoveBefore = typeof Element.prototype.moveBefore === "function";

  constructor() {
    super();

    this.table = document.createElement("table");
    this.table.className = "that-tbl w-full";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    for (const column of SORTABLE_COLUMNS) {
      const th = this.sortHeaderCell(column.cls, column.column);
      this.headers.set(column.column, th);
      headerRow.append(th);
    }
    const actionHeader = document.createElement("th");
    actionHeader.className = "c-act";
    headerRow.append(actionHeader);
    thead.append(headerRow);

    this.body = document.createElement("tbody");
    this.table.append(thead, this.body);
  }

  connectedCallback(): void {
    // overflow-x-auto: five columns do not fit a phone, and the table is
    // allowed to be wider than the card there. Without it the *page* scrolls
    // sideways instead, which is the one thing no view may do. Decision 7 put
    // tooltips in the top layer for exactly this: a scrolling ancestor here
    // cannot clip one.
    this.className = `${CARD_SURFACE_CLASSES} overflow-x-auto`;
    this.replaceChildren(this.table);

    this.sortState = this.readStoredState();
    this.applyState();

    this.observer = new MutationObserver((records) => {
      if (records.some((record) => this.isOwnRowChange(record))) {
        this.sortBody();
      }
    });
    this.observe();
  }

  disconnectedCallback(): void {
    this.observer?.disconnect();
    this.observer = undefined;
  }

  private observe(): void {
    this.observer?.observe(this.body, {
      childList: true,
      attributes: true,
      subtree: true,
      attributeFilter: OBSERVED_ROW_ATTRIBUTES,
    });
  }

  /**
   * `subtree: true` is what lets a row's own attribute change reach this
   * observer without Today wiring anything per row — but it also reaches
   * every change *inside* a row: `that-ticket-row`'s own re-renders, and
   * soon #8's per-second timer ticking the Today cell's text. None of those
   * are a row arriving, leaving or changing what it sorts by, so a mutation
   * only counts here when it is a row being added or removed directly under
   * `body` (`childList` with `target === body`), or one of the four
   * sort-relevant attributes changing directly on a row (`attributes` with
   * `target.parentElement === body`) — never a change on some element a row
   * merely contains.
   */
  private isOwnRowChange(record: MutationRecord): boolean {
    if (record.type === "childList") return record.target === this.body;
    if (record.type === "attributes") return record.target.parentElement === this.body;

    return false;
  }

  /** Paints every header for the current state, then re-sorts and persists —
   *  the header click's own path. A mutation-driven re-sort calls sortBody
   *  directly instead: the state itself has not changed, so repainting the
   *  headers or persisting again would be redundant work on every keystroke
   *  a row's own re-render causes. */
  private applyState(): void {
    this.paintHeaders();
    this.sortBody();
    this.persistState();
  }

  private paintHeaders(): void {
    const state = this.sortState;
    for (const [column, th] of this.headers) {
      const button = th.querySelector("button");
      if (!button) continue;

      const direction = state !== null && state.column === column ? state.direction : null;
      th.setAttribute("aria-sort", direction ?? "none");

      button.className =
        direction === null
          ? `text-ink-muted hover:text-ink ${HEADER_BUTTON_BASE}`
          : `text-ink ${HEADER_BUTTON_BASE}`;
      button.innerHTML = `${LABEL_OF[column]} ${iconMarkup(direction ?? "sortable", 13)}`;
      if (direction === null) {
        button.querySelector("svg")?.classList.add("opacity-45");
      }
    }
  }

  private sortHeaderCell(cls: string, column: SortColumn): HTMLTableCellElement {
    const th = document.createElement("th");
    th.className = cls;

    const label = LABEL_OF[column];
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", `Sort by ${label}`);
    button.addEventListener("click", () => {
      this.sortState = nextSortState(this.sortState, column);
      this.applyState();
    });

    th.append(button);

    return th;
  }

  /**
   * Assigns arrival order to any row seen for the first time, then sorts a
   * copy of the body and reorders it only if the order actually changed. The
   * observer is disconnected around that reorder and reconnected after, so
   * the table's own moves are not mistaken for a row arriving or changing.
   */
  private sortBody(): void {
    const rows = Array.from(this.body.children);
    for (const row of rows) {
      if (!this.rowOrder.has(row)) {
        this.rowOrder.set(row, this.nextOrder++);
      }
    }

    const sorted = [...rows].sort((a, b) =>
      compareRows(this.sortableRow(a), this.sortableRow(b), this.sortState),
    );

    if (sorted.some((row, index) => row !== rows[index])) {
      this.observer?.disconnect();
      // finally, not just a trailing call: reorder() can throw (a storage or
      // DOM surprise this table has not anticipated), and an observer left
      // disconnected after that would make the table stop re-sorting for the
      // rest of its life while its header keeps claiming a sort that never
      // happened.
      try {
        this.reorder(sorted);
      } finally {
        this.observe();
      }
    }
  }

  /**
   * Moves each row to its sorted position with `moveBefore` where the engine
   * has it, `insertBefore` otherwise. `append`/`insertBefore` on a node
   * already in the tree removes and reinserts it, which for a custom element
   * fires disconnectedCallback and then connectedCallback — and
   * that-ticket-row's connectedCallback calls render() unconditionally,
   * rebuilding every cell and dropping whatever the user had focused.
   * `moveBefore` moves the node in place instead, so long as the element
   * opts in with a `connectedMoveCallback` — that-ticket-row's own is a
   * no-op, which is what keeps this safe where it's available. Verified
   * directly in Firefox and Chromium: both support moveBefore and both skip
   * the disconnect/reconnect once that callback is present. Where it isn't
   * available (Firefox ESR before 144), the fallback accepts the rebuild and
   * the focus loss it carries — a sort that works but occasionally drops
   * focus is still better than one that silently stops working.
   */
  private reorder(sorted: Element[]): void {
    for (const [index, row] of sorted.entries()) {
      const current = this.body.children[index];
      if (current === row) continue;

      if (this.supportsMoveBefore) {
        // Narrowed at the call site, not just by the boolean above: the
        // declaration is optional now, so TypeScript still sees `undefined`
        // as a possibility here without this.
        this.body.moveBefore?.(row, current ?? null);
      } else {
        this.body.insertBefore(row, current ?? null);
      }
    }
  }

  private sortableRow(row: Element): SortableRow {
    const seconds = Number(row.getAttribute("seconds") ?? "0");

    return {
      key: row.getAttribute("key") ?? "",
      summary: row.getAttribute("summary") ?? "",
      status: row.getAttribute("status") ?? "",
      seconds: Number.isFinite(seconds) ? seconds : 0,
      order: this.rowOrder.get(row) ?? 0,
    };
  }

  private readStoredState(): SortState | null {
    const sortId = this.getAttribute("sort-id");
    if (sortId === null) return null;

    try {
      return parseSortState(localStorage.getItem(STORAGE_PREFIX + sortId));
    } catch {
      return null;
    }
  }

  private persistState(): void {
    const sortId = this.getAttribute("sort-id");
    if (sortId === null) return;

    try {
      const serialized = serializeSortState(this.sortState);
      if (serialized === null) {
        localStorage.removeItem(STORAGE_PREFIX + sortId);
      } else {
        localStorage.setItem(STORAGE_PREFIX + sortId, serialized);
      }
    } catch {
      // Blocked or throwing storage must not stop in-page sorting.
    }
  }
}

customElements.define("that-table", ThatTable);
