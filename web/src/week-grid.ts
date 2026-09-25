import { CARD_SURFACE_CLASSES } from "./card-surface.ts";
import type { EntryTicket } from "./components/that-entry-dialog.ts";
import { totalFigure } from "./format.ts";
import { paintInstanceDot } from "./instance-hue.ts";
import { PUSH_MARKS, knownPushState } from "./push-marks.ts";
import type { PushResponse, WeekCell, WeekDay, WeekRollup, WeekRow } from "./types.ts";
import { dayHeading, weekLabel } from "./week-label.ts";

/**
 * Week's grid for one rollup: the table in its card, or the empty-week message
 * when there is no row to draw. Pure but for the DOM it returns — it reads no
 * view state, and a cell's press is handed to `openEntry` rather than acted on.
 */
export function weekGrid(
  rollup: WeekRollup,
  failures: Failures,
  openEntry: (ticket: EntryTicket) => void,
): HTMLElement {
  return rollup.rows.length === 0 ? emptyWeek() : gridCard(gridTable(rollup, failures, openEntry));
}

/**
 * The entries a push left behind, keyed to the cells they belong to. A failed
 * result names its row by instance and issue key, and its column by the day of
 * the response that carried it — `/api/week` cannot say this, because a re-read
 * reports those entries as unpushed again, which is what they are.
 */
export interface Failures {
  cells: Set<string>;
  days: Set<string>;
}

/** A fresh value every time. A module-level empty constant would be one set of
 *  Sets shared by every mount, and one edit that mutated them would poison it. */
export function noFailures(): Failures {
  return { cells: new Set(), days: new Set() };
}

/** Where a failed result lands: the row it names, and the column its response carried. */
function cellKey(instanceId: number, issueKey: string, day: string): string {
  return `${String(instanceId)}:${issueKey}:${day}`;
}

export function failuresIn(responses: PushResponse[]): Failures {
  const cells = new Set<string>();
  const days = new Set<string>();

  for (const response of responses) {
    for (const result of response.results) {
      if (result.status !== "failed") continue;
      cells.add(cellKey(result.instanceId, result.issueKey, response.day));
      days.add(response.day);
    }
  }

  return { cells, days };
}

/**
 * Shared by every `.tk` cell — the Ticket header, a row's own key cell, and
 * the footer's "Total" label — because the drawing gives all three the same
 * treatment regardless of which section they sit in: content-width, nowrap,
 * a 10px right padding standing in for the generic column gap, and a
 * font-weight of 400 that outranks the header row's own bold and the
 * footer's own bold alike (`.grid th.tk`'s two classes beat `.grid thead th`
 * and `.grid tfoot th`'s one class plus one type, the same specificity edge
 * the prototype's cascade relies on).
 */
const TK_CLASSES = "w-[1%] pr-[10px] text-left font-normal whitespace-nowrap align-middle";

/** One id per row's key link, so its that-tooltip's `for` can resolve it on a
 *  page holding many rows — the same reasoning weekCellSequence below gives
 *  its own triggers (#143). */
let weekKeyLinkSequence = 0;

/**
 * A row's key, linked to the issue in Jira — the drawing's `.kk`, Chivo Mono
 * at 13px/700 via `.that-key`, ink-muted at rest and brightening to ink on
 * hover through `a.that-key:hover` in styles.css. Mirrors that-ticket-row.ts's
 * keyLabel: an anchor with an empty href would navigate to the current page
 * instead of doing nothing, so an instance migrated from a gateway URL — which
 * carries no site to link to — draws plain text instead.
 */
function keyLink(issueKey: string, url: string): HTMLElement {
  if (url === "") {
    const span = document.createElement("span");
    span.className = "that-key text-ink-muted";
    span.title = `Open ${issueKey} in Jira`;
    span.textContent = issueKey;

    return span;
  }

  const link = document.createElement("a");
  link.id = `that-week-key-${String(++weekKeyLinkSequence)}`;
  link.href = url;
  link.target = "_blank";
  // Without noopener the opened page gets a window.opener handle back here.
  link.rel = "noopener";
  link.className = "that-key text-ink-muted";
  link.textContent = issueKey;

  return link;
}

/** The key link's own that-tooltip (#143), replacing the native title it used
 *  to carry — the same contract that-ticket-row's own keyTooltip gives. */
function keyTooltip(forId: string): HTMLElement {
  const tooltip = document.createElement("that-tooltip");
  tooltip.setAttribute("for", forId);
  tooltip.textContent = "open in Jira";

  return tooltip;
}

function gridTable(
  rollup: WeekRollup,
  failures: Failures,
  openEntry: (ticket: EntryTicket) => void,
): HTMLTableElement {
  const table = document.createElement("table");
  // that-tnum on the table, so every figure under it is tabular — figures that
  // sit above one another have to align or the column reads as noise.
  table.className = "that-tnum w-full text-base";

  const caption = document.createElement("caption");
  caption.className = "sr-only";
  caption.textContent = `Time logged, ${weekLabel(rollup.start, rollup.end)}`;
  table.append(caption);

  const headRow = document.createElement("tr");
  // Type carried here rather than per th: font-size, weight, tracking and
  // transform all inherit, and only the block padding below needs a cell of
  // its own to land on.
  headRow.className = "text-ink-muted text-xs font-bold tracking-[0.06em] uppercase";
  headRow.append(tkHeadCell("Ticket"));
  rollup.days.forEach((day, index) => {
    headRow.append(headCell(dayHeading(day.day, index)));
  });
  headRow.append(headCell("Total"));

  const head = document.createElement("thead");
  head.append(headRow);

  const body = document.createElement("tbody");
  body.className = "divide-edge divide-y";
  for (const row of rollup.rows) {
    const tr = document.createElement("tr");

    const ticket = document.createElement("th");
    ticket.scope = "row";
    ticket.className = `${TK_CLASSES} h-[46px]`;

    const holder = document.createElement("span");
    holder.className = "flex items-center gap-2";
    const dot = document.createElement("span");
    // paintInstanceDot labels the dot with the instance name, so the row says
    // which Jira it came from without the hue having to carry it alone.
    paintInstanceDot(dot, row.instancePosition, row.instanceName);
    const key = keyLink(row.issueKey, row.url);
    holder.append(dot, key);
    ticket.append(holder);
    if (row.url !== "") ticket.append(keyTooltip(key.id));
    tr.append(ticket);

    row.cells.forEach((cell, index) => {
      const day = rollup.days[index]?.day ?? "";
      const failed = failures.cells.has(cellKey(row.instanceId, row.issueKey, day));
      tr.append(ticketCell(row, index, day, cell, failed, openEntry));
    });
    tr.append(totalCell(row.seconds, false));
    body.append(tr);
  }

  const footRow = document.createElement("tr");
  footRow.className = "border-edge border-t";
  const footHead = document.createElement("th");
  footHead.scope = "row";
  footHead.className = `${TK_CLASSES} py-3`;
  footHead.textContent = "Total";
  footRow.append(footHead);
  // A day's own worst-wins state, the same rule the cells above follow, so the
  // footer says which days still hold time Jira has not got. It is still a
  // sum — of every row's cell for that day — so it stays inert like the row
  // and week totals rather than becoming a control.
  rollup.days.forEach((day, index) => {
    footRow.append(dayTotal(day, failures.days.has(day.day), index === 0));
  });
  footRow.append(totalCell(rollup.seconds, true));

  const foot = document.createElement("tfoot");
  foot.className = "font-bold";
  foot.append(footRow);

  table.append(head, body, foot);

  return table;
}

/**
 * The card the grid sits in — the drawing's `.tcard` around `.grid`.
 * CARD_SURFACE_CLASSES rather than that-card, which would add a heading slot
 * the grid has no use for. overflow-x-auto so the table can be wider than
 * the card without the page itself scrolling sideways — the same bargain
 * that-table already makes for the phone.
 */
function gridCard(table: HTMLTableElement): HTMLElement {
  const card = document.createElement("div");
  card.className = `${CARD_SURFACE_CLASSES} overflow-x-auto`;
  card.append(table);

  return card;
}

const MARKER_BASE = "mr-1.5 inline-block align-[1px]";

type PushState = WeekCell["pushState"];

/**
 * The mark a cell or day draws, or undefined for `pushed` — the ordinary
 * state a grid this dense has no business decorating. `failed` outranks
 * whatever the rollup said, because it is newer than the rollup: it comes
 * off the push that just happened, and a re-read reports those entries as
 * unpushed again — true, but not the thing the reader needs in the seconds
 * after Push.
 *
 * The visual language is explicit that amber and red never rest on colour
 * alone, and a grid has no room for the triangle-and-words an alert carries
 * — so the shape has to do it here. The words are not decoration either:
 * they are what a reader who cannot see the marker hears, and — through the
 * marker's title — what a reader who can see it has instead of a legend the
 * grid does not have room for.
 */
function markerFor(
  pushState: PushState,
  failed: boolean,
): { className: string; words: string } | undefined {
  const state = knownPushState(failed ? "failed" : (pushState ?? "pushed"));
  if (state === "pushed") return undefined;
  const mark = PUSH_MARKS[state];

  return { className: `${mark.tone} ${mark.shape}`, words: mark.words };
}

/** Every state's own words, `pushed` included: it draws no marker, but a
 *  cell's popover still has to name it. */
function pushWords(pushState: PushState, failed: boolean): string {
  return PUSH_MARKS[knownPushState(failed ? "failed" : (pushState ?? "pushed"))].words;
}

let weekCellSequence = 0;

/**
 * One ticket's time on one day — always a control, empty cells included: a
 * figure opens the entries dialog onto what is already logged, empty opens
 * the same dialog with nothing in it yet. Every trigger gets an id unique
 * across the page, the same problem that-ticket-row's pinTriggerSequence
 * solves for a row of pin controls — a week is the densest grid this app
 * draws.
 *
 * The dialog is shared with Today and asks for a summary and a status; Week's
 * own rows carry neither — "Week rows stay keys only" was a deliberate call
 * against a summary column — so both go in blank. Carrying them here would
 * mean extending that shared dialog, which is outside this ticket's file list.
 *
 * `totalFigure`, never `timerFigure`: format.ts reserves the colon for a
 * timer, and every figure in a rollup is a sum. An em dash for an empty cell,
 * not `0h 00m` — a zero is a measurement, and a cell with no entries has not
 * measured anything. It stays a character on purpose: punctuation is not an
 * icon.
 */
function ticketCell(
  row: WeekRow,
  dayIndex: number,
  day: string,
  cell: WeekCell,
  failed: boolean,
  openEntry: (ticket: EntryTicket) => void,
): HTMLTableCellElement {
  const td = document.createElement("td");
  // `.grid td + td { padding-left: 10px }` in the drawing never reaches
  // Monday: the Ticket cell before it is a `<th>`, not a `<td>`, so that
  // sibling rule does not match and Monday's own gap is carried by th.tk's
  // padding-right alone (prototype lines 167, 170). Utility classes have no
  // sibling combinator, so the index stands in for it here.
  td.className = `h-[46px] text-right align-middle ${dayIndex === 0 ? "" : "pl-[10px]"}`;

  const id = `that-week-cell-${String(++weekCellSequence)}`;
  const empty = cell.seconds === 0;
  const words = pushWords(cell.pushState, failed);
  const figure = empty ? "—" : totalFigure(cell.seconds);
  const dayLabel = dayHeading(day, dayIndex);

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.id = id;
  trigger.setAttribute("aria-haspopup", "dialog");
  // The padding is given back as negative margin on every side — the
  // drawing's .cell, 9px block and 13px inline — so the figure lands exactly
  // where the td's own padding would put it and the hover wash hugs the
  // figure rather than spanning the column, which stays the td's job alone.
  trigger.className =
    "hover:bg-hover focus-visible:bg-hover -mx-[13px] -my-[9px] inline-flex cursor-pointer " +
    "items-baseline rounded-sm px-[13px] py-[9px]";
  // Independent of the popover below, which reaches neither a keyboard nor a
  // screen reader on its own.
  trigger.setAttribute(
    "aria-label",
    empty
      ? `${row.issueKey}, ${dayLabel}, no time logged, click to add`
      : `${row.issueKey}, ${dayLabel}, ${figure}, ${words}, click to edit`,
  );
  trigger.addEventListener("click", () => {
    openEntry({
      instanceId: row.instanceId,
      instanceName: row.instanceName,
      instancePosition: row.instancePosition,
      issueKey: row.issueKey,
      summary: "",
      status: "",
      // Set on every cell, today's column included: the dialog compares this
      // against the day the server resolves as today, so a cell for today
      // still behaves correctly on its own — a presence-only check here would
      // single today's column out and defeat that comparison. `|| undefined`
      // rather than the bare string: `day` is `""` only when `/api/week`
      // broke its seven-day contract, and an empty string would still be
      // `!== undefined` — scoping the dialog to a day that does not exist —
      // where `undefined` degrades to the safe, existing "today" behaviour.
      day: day || undefined,
    });
  });

  if (empty) {
    // No .fig wrapping here — the drawing's own empty cell is a bare em dash,
    // unlike the footer's, which keeps .fig even when it has nothing to show.
    trigger.classList.add("text-ink-muted");
    trigger.append(document.createTextNode(figure));
  } else {
    // Inline with no reserved width: the column is right-aligned, so the
    // figure ends at the same edge whether or not a marker precedes it, and a
    // reserved gutter would fix a drift that never happens.
    const marker = markerFor(cell.pushState, failed);
    if (marker) {
      const mark = document.createElement("span");
      mark.className = `${MARKER_BASE} ${marker.className}`;
      mark.setAttribute("aria-hidden", "true");
      trigger.append(mark);
    }
    // .fig: the drawing's mono face for a real figure.
    const fig = document.createElement("span");
    fig.className = "font-mono";
    fig.textContent = figure;
    trigger.append(fig);
  }

  const tooltip = document.createElement("that-tooltip");
  tooltip.setAttribute("for", id);
  tooltip.setAttribute("anchor", "end");
  tooltip.textContent = empty
    ? "No time logged · click to add"
    : `${figure} · ${words} · click to edit`;

  td.append(trigger, tooltip);

  return td;
}

/** A day's own total across every ticket, worst-wins marked like a cell but
 *  never a control: it is a sum, and there is nothing on it to edit. Wears
 *  .fig (mono) even at zero — unlike a day cell's own em dash, the footer's
 *  keeps the class regardless, per the drawing's tfoot markup. */
function dayTotal(day: WeekDay, failed: boolean, isFirst = false): HTMLTableCellElement {
  const td = document.createElement("td");
  // Same reasoning as ticketCell's td: the footer's Ticket cell is also a
  // `<th>`, so Monday's own `.grid td + td` gap never fires for it either.
  td.className = `py-3 text-right align-middle font-mono ${isFirst ? "" : "pl-[10px]"}`;

  if (day.seconds === 0) {
    td.classList.add("text-ink-muted");
    td.textContent = "—";

    return td;
  }

  const marker = markerFor(day.pushState, failed);
  if (marker) {
    const mark = document.createElement("span");
    mark.className = `${MARKER_BASE} ${marker.className}`;
    mark.setAttribute("aria-hidden", "true");
    mark.title = marker.words;
    td.append(mark);

    const words = document.createElement("span");
    words.className = "sr-only";
    // Named for a reader who cannot see the marker. "Dirty" is the code's
    // word, not a person's. There is no control here to carry an aria-label,
    // which is what still makes this span load-bearing rather than decorative.
    words.textContent = `${marker.words}, `;
    td.append(words);
  }

  td.append(document.createTextNode(totalFigure(day.seconds)));

  return td;
}

/**
 * A row or week total: a sum of cells, so a sum's shape, and never a marker —
 * the states it spans are already marked on the cells it adds up. `foot`
 * distinguishes the week total in tfoot from a row's own total in tbody, and
 * the two differ in more than block padding and row height: the prototype's
 * tfoot markup carries `fig` on every cell and `tot` on none of them, so only
 * a row's own total wears `.tot`'s 18px — the week total takes the same
 * generic 10px `dayTotal` beside it does.
 *
 * Zero renders as an em dash, muted like `ticketCell`'s and `dayTotal`'s own
 * empty state — decision 1's own words, "an em dash in its row total, not
 * `0h 00m`". Every row summing to zero used to imply the row did not exist at
 * all, which is exactly what decision 1 replaces: a transient row search adds
 * reaches this before anything is logged into it.
 */
function totalCell(seconds: number, foot: boolean): HTMLTableCellElement {
  const td = document.createElement("td");
  const gap = foot ? "pl-[10px] py-3" : "pl-[18px] h-[46px]";
  const empty = seconds === 0;
  td.className = `${gap} text-right align-middle font-mono font-bold ${empty ? "text-ink-muted" : ""}`;
  td.textContent = empty ? "—" : totalFigure(seconds);

  return td;
}

/** The Ticket column's header — see TK_CLASSES. border-b lands on the cell
 *  itself rather than the row: a `<tr>`'s own border does not show up on a
 *  `<th>`'s computed style even under border-collapse, so the hairline has
 *  to be each header cell's own. */
function tkHeadCell(text: string): HTMLTableCellElement {
  const th = document.createElement("th");
  th.scope = "col";
  th.className = `${TK_CLASSES} border-edge border-b pb-[9px]`;
  th.textContent = text;

  return th;
}

/** Every other header cell — a day or the week Total, right-aligned and
 *  wearing the header row's own weight, tracking and 9px bottom padding. */
function headCell(text: string): HTMLTableCellElement {
  const th = document.createElement("th");
  th.scope = "col";
  th.className = "border-edge border-b pl-[10px] pb-[9px] text-right align-middle";
  th.textContent = text;

  return th;
}

/** A week off is not an error, and the navigation above stays put so the week
 *  either side is still one press away. */
function emptyWeek(): HTMLElement {
  const wrapper = document.createElement("div");

  const paragraph = document.createElement("p");
  paragraph.className = "text-ink-muted";
  paragraph.textContent = "Nothing logged this week.";

  const link = document.createElement("a");
  link.href = "/today";
  link.dataset["route"] = "";
  link.className = "text-primary mt-4 inline-block font-bold hover:underline";
  link.textContent = "Go to Today";

  wrapper.append(paragraph, link);

  return wrapper;
}
