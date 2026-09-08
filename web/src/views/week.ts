import "../components/that-alert";

import { ApiError, fetchWeek, getWeek } from "../api";
import { openEntryDialog } from "../components/that-entry-dialog";
import { fetchReportNodes } from "../fetch-report";
import { totalFigure } from "../format";
import { iconMarkup } from "../icons";
import { paintInstanceDot } from "../instance-hue";
import { pushReportNodes } from "../push-report";
import { onPushReported } from "../push-reported";
import { setRailPeriod } from "../rail";
import { navigate } from "../router";
import type { RegisterTeardown } from "../router";
import type { PushResponse, WeekCell, WeekDay, WeekRollup, WeekRow } from "../types";
import { weekLabel } from "../week-label";

/**
 * Column headings, by position rather than by date. `cells` and `days` are
 * index-aligned and always seven long, so index 0 is Monday by contract — which
 * is what lets the grid be labelled without a Date being constructed.
 */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/**
 * The entries a push left behind, keyed to the cells they belong to. A failed
 * result names its row by instance and issue key, and its column by the day of
 * the response that carried it — `/api/week` cannot say this, because a re-read
 * reports those entries as unpushed again, which is what they are.
 */
interface Failures {
  cells: Set<string>;
  days: Set<string>;
}

/** A fresh value every time. A module-level empty constant would be one set of
 *  Sets shared by every mount, and one edit that mutated them would poison it. */
function noFailures(): Failures {
  return { cells: new Set(), days: new Set() };
}

export async function render(root: HTMLElement, registerTeardown: RegisterTeardown): Promise<void> {
  const container = document.createElement("div");
  container.className = "space-y-4";

  const header = document.createElement("div");
  header.className = "flex flex-wrap items-baseline justify-between gap-3";

  const label = document.createElement("h2");
  label.className = "text-xl font-bold";

  // The label, a rule, and the fetch. Its own flex box rather than three more
  // children of the header: the header aligns on baselines, and a group's
  // baseline is its first item's, so the heading still sits on the same line as
  // the week controls opposite it.
  const identity = document.createElement("div");
  identity.className = "flex items-center gap-3";

  const rule = document.createElement("span");
  rule.className = "bg-edge h-5 w-px";
  rule.setAttribute("aria-hidden", "true");

  const fetchControl = fetchButton();

  // Attached the moment the control exists rather than after the first read.
  // render appends this header synchronously and the router awaits it, so the
  // button is painted and focusable from the first frame; a listener added
  // after the read would swallow every press until then, and for the whole
  // mount if that read failed. What keeps a press from arriving too early is
  // the control's own disabled state, which the first successful read lifts.
  let fetching = false;
  fetchControl.addEventListener("click", () => {
    void (async () => {
      // Disabled for the whole round trip: a second press would run the same
      // week again over half-applied results.
      fetching = true;
      fetchControl.disabled = true;
      try {
        // The week on screen, not the one the mount opened with: show() keeps
        // this in step with whatever the server answered.
        const outcome = await fetchWeek(showing);
        report.replaceChildren(...fetchReportNodes(outcome));
        report.hidden = false;
        // The grid is read again rather than patched: every total, every mark
        // and every row the fetch may have added comes from the rollup, and
        // patching would be a second implementation of it.
        await show();
      } catch (error) {
        report.replaceChildren(alertFor("error", messageOf(error)));
        report.hidden = false;
      } finally {
        fetching = false;
        fetchControl.disabled = false;
      }
    })();
  });

  identity.append(label, rule, fetchControl);

  const controls = document.createElement("div");
  controls.className = "flex items-center gap-1";
  header.append(identity, controls);

  const grid = document.createElement("div");
  grid.append(loadingLine());

  const report = document.createElement("div");
  // Below the grid, which is the part that matters: a press must move nothing
  // above it. Hidden purely because there is no report yet — unlike Today's,
  // this one is the container's last child, so it claims no space-y margin
  // either way and hiding it reclaims nothing.
  report.hidden = true;

  container.append(header, grid, report);
  root.append(container);

  // Read off the address, never derived: /week with no start is "this week", and
  // which week that is belongs to THAT_TIMEZONE. Thereafter it is whatever
  // Monday the server answered with, so a re-read fetches the week on screen
  // rather than whatever "this week" has become in the meantime.
  let showing = new URLSearchParams(window.location.search).get("start") ?? undefined;

  // Supersession, the same job rail.ts's epoch does for the same reason: the
  // mount's read and the one a push fires can be in flight together, and the
  // older resolving second would paint the week as it was before the push.
  let epoch = 0;

  // Consumed by the one paint that reports the push producing it. The design
  // gives this marker no life beyond that: it does not come from the rollup, so
  // the read after the reporting one paints the truth again — and navigating
  // away drops it with the rest of this mount's state.
  let failures: Failures = noFailures();

  const show = async (): Promise<WeekRollup | null> => {
    const mine = ++epoch;

    let rollup: WeekRollup;
    try {
      rollup = await getWeek(showing);
    } catch (error) {
      if (mine !== epoch) return null;
      // A first read that fails leaves nothing to navigate by — and
      // /week?start=<not a Monday> is a reachable address the server rejects on
      // purpose — so offer the one destination that needs no response to name.
      // A later failure keeps whatever week is already on screen.
      if (controls.childElementCount === 0) {
        label.textContent = "Week";
        controls.append(weekButton({ label: "This week", path: "/week" }));
      }
      grid.replaceChildren(alertFor("error", messageOf(error)));

      return null;
    }
    // Superseded reads must not paint — that is the guard's whole point — but the
    // rollup still goes back to the caller. A push completing during the mount's
    // first read would otherwise leave setRailPeriod unrun and the rail
    // describing the view you came from beside a week grid, which is the exact
    // trap the period-follows-the-view decision exists to close. Both reads
    // asked for the same `start`, so the range handed over is the same either
    // way; and returning before the consume below keeps the failure set intact
    // for the paint that does happen.
    if (mine !== epoch) return rollup;

    const marked = failures;
    failures = noFailures();

    showing = rollup.start;
    label.textContent = periodLabel(rollup);
    controls.replaceChildren(...weekControls(rollup));
    grid.replaceChildren(rollup.rows.length === 0 ? emptyWeek() : gridTable(rollup, marked, root));
    // There is a week on screen to fetch now. Guarded on `fetching` because
    // the fetch itself ends by calling show(), and re-enabling there would
    // hand the button back a moment before the round trip it belongs to ends.
    fetchControl.disabled = fetching;

    return rollup;
  };

  // Registered before the first read, so a push that lands while it is still in
  // flight is still heard. The rail owns the Push; this only renders what came
  // back, and then re-reads — every marker the rollup knows about settles only
  // when the rollup is asked again.
  const stopPushListening = onPushReported((responses, unanswered) => {
    report.replaceChildren(...pushReportNodes(responses, unanswered, { nameDays: true }));
    report.hidden = false;
    failures = failuresIn(responses);
    void show();
  });

  // The rail's period is global state that outlives this view, so a mount the
  // user has already navigated away from must not still hand it one. Everything
  // else this view paints is its own detached DOM, which nobody sees.
  let mounted = true;
  registerTeardown(() => {
    mounted = false;
    stopPushListening();
  });

  const rollup = await show();
  // A week that could not be read has no range to hand over, so the rail keeps
  // describing wherever it came from rather than claiming a period this view
  // does not actually have on screen.
  if (!rollup || !mounted) return;

  // A fresh object every mount, which setRailPeriod's reference-equality guard
  // can never skip. Deliberate: moving between weeks remounts the view, and
  // each mount is genuinely a different period for the rail to read. The one
  // re-read inside a mount — the post-push show() above — does not come through
  // here, so it costs nothing extra.
  setRailPeriod({
    label: periodLabel(rollup),
    viewPath: "/week",
    range: { from: rollup.start, to: rollup.end },
    pushHeading: "Push this week's time to Jira?",
  });
}

/**
 * `Week 36 · 31 Aug – 6 Sep` — composed once and used for both the heading and
 * the rail's period label, which decision 6 requires read as the same string.
 * `weekNumber` comes off the rollup already computed; nothing here does
 * calendar arithmetic.
 */
function periodLabel(rollup: WeekRollup): string {
  return `Week ${String(rollup.weekNumber)} · ${weekLabel(rollup.start, rollup.end)}`;
}

/** Where a failed result lands: the row it names, and the column its response carried. */
function cellKey(instanceId: number, issueKey: string, day: string): string {
  return `${String(instanceId)}:${issueKey}:${day}`;
}

function failuresIn(responses: PushResponse[]): Failures {
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
 * Arrows either side of "This week", as the design drew them.
 *
 * Plain buttons rather than that-button: CLAUDE.md reserves `that-*` for
 * reusable UI, and these are one-off controls in one view — which is what lets
 * the arrows carry an aria-label while that-button's accessible name is
 * whatever it renders. Buttons rather than links for a separate reason: the
 * router's anchor handler navigates to `new URL(link.href).pathname` and would
 * drop the query, landing every press on this week.
 */
function weekControls(rollup: WeekRollup): HTMLElement[] {
  return [
    weekButton({
      mark: iconMarkup("arrow-left"),
      label: "Previous week",
      path: `/week?start=${rollup.prevStart}`,
    }),
    weekButton({ label: "This week", path: "/week" }),
    weekButton({
      mark: iconMarkup("arrow-right"),
      label: "Next week",
      path: `/week?start=${rollup.nextStart}`,
    }),
  ];
}

/**
 * The neighbouring starts come off the response; nothing here adds seven days.
 *
 * `h-9` is fixed rather than left to padding: the icon buttons either side of
 * "This week" hold an 18px mark with nothing else to give it a text line's
 * height, so padding alone left them shorter than the text button and the
 * three did not sit on a line.
 */
function weekButton(control: { mark?: string; label: string; path: string }): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className =
    "inline-flex h-9 cursor-pointer items-center justify-center rounded-sm px-3 text-base " +
    "font-bold text-ink-muted hover:bg-hover hover:text-ink";

  if (control.mark === undefined) {
    button.textContent = control.label;
  } else {
    // The mark is decorative (icons.ts sets aria-hidden); the name it stands
    // for is not, and a screen reader would otherwise read the button empty.
    button.setAttribute("aria-label", control.label);
    button.title = control.label;
    const mark = document.createElement("span");
    mark.innerHTML = control.mark;
    button.append(mark);
  }

  button.addEventListener("click", () => {
    void navigate(control.path);
  });

  return button;
}

/**
 * Pulls the week's worklogs in.
 *
 * Labelled rather than an icon alone, and outside the week controls opposite it:
 * those three are navigation and share one height as one group, where this
 * writes entries to the database. The rule before it is what says so.
 *
 * A plain button for the same reason weekButton is one — CLAUDE.md reserves
 * `that-*` for reusable UI, and this is one control in one view.
 */
function fetchButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  // Enabled by the read that gives it a week to fetch. Until then there is
  // nothing for a press to do, and a control that looks pressable and answers
  // nothing is worse than one that says it is not ready.
  button.disabled = true;
  button.className =
    "inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-sm px-3 " +
    "text-base font-bold text-ink-muted hover:bg-hover hover:text-ink " +
    "disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent";
  // The label text already names the button; the explicit aria-label matches
  // it rather than adding information, the same belt-and-braces
  // sortHeaderCell in that-table.ts uses beside its own iconMarkup call.
  button.setAttribute("aria-label", "Fetch worklogs");

  const mark = document.createElement("span");
  mark.innerHTML = iconMarkup("fetch", 17);
  const text = document.createElement("span");
  text.textContent = "Fetch worklogs";

  button.append(mark, text);

  return button;
}

function gridTable(rollup: WeekRollup, failures: Failures, root: HTMLElement): HTMLElement {
  const table = document.createElement("table");
  // that-tnum on the table, so every figure under it is tabular — figures that
  // sit above one another have to align or the column reads as noise.
  table.className = "that-tnum w-full text-base";

  const caption = document.createElement("caption");
  caption.className = "sr-only";
  caption.textContent = `Time logged, ${weekLabel(rollup.start, rollup.end)}`;
  table.append(caption);

  const headRow = document.createElement("tr");
  headRow.className = "border-edge text-ink-muted border-b text-sm";
  headRow.append(headCell("Ticket", "text-left"));
  rollup.days.forEach((day, index) => {
    headRow.append(headCell(dayHeading(day.day, index), "text-right"));
  });
  headRow.append(headCell("Total", "text-right"));

  const head = document.createElement("thead");
  head.append(headRow);

  const body = document.createElement("tbody");
  body.className = "divide-edge divide-y";
  for (const row of rollup.rows) {
    const tr = document.createElement("tr");

    const ticket = document.createElement("th");
    ticket.scope = "row";
    ticket.className = "px-2 py-1.5 text-left font-normal";

    const holder = document.createElement("span");
    holder.className = "flex items-center gap-2";
    const dot = document.createElement("span");
    // paintInstanceDot labels the dot with the instance name, so the row says
    // which Jira it came from without the hue having to carry it alone.
    paintInstanceDot(dot, row.instancePosition, row.instanceName);
    const key = document.createElement("span");
    key.className = "font-bold";
    key.textContent = row.issueKey;
    holder.append(dot, key);
    ticket.append(holder);
    tr.append(ticket);

    row.cells.forEach((cell, index) => {
      const day = rollup.days[index]?.day ?? "";
      const failed = failures.cells.has(cellKey(row.instanceId, row.issueKey, day));
      tr.append(ticketCell(row, index, day, cell, failed, root));
    });
    tr.append(totalCell(row.seconds));
    body.append(tr);
  }

  const footRow = document.createElement("tr");
  footRow.className = "border-edge border-t";
  const footHead = document.createElement("th");
  footHead.scope = "row";
  footHead.className = "px-2 py-1.5 text-left";
  footHead.textContent = "Total";
  footRow.append(footHead);
  // A day's own worst-wins state, the same rule the cells above follow, so the
  // footer says which days still hold time Jira has not got. It is still a
  // sum — of every row's cell for that day — so it stays inert like the row
  // and week totals rather than becoming a control.
  for (const day of rollup.days) {
    footRow.append(dayTotal(day, failures.days.has(day.day)));
  }
  footRow.append(totalCell(rollup.seconds));

  const foot = document.createElement("tfoot");
  foot.className = "font-bold";
  foot.append(footRow);

  table.append(head, body, foot);

  return table;
}

const MARKER_BASE = "mr-1.5 inline-block align-[1px]";

/**
 * How each state marks a cell: one silhouette each, so no pair of them is told
 * apart by hue. The visual language is explicit that amber and red "never rest
 * on colour alone", and a grid has no room for the triangle-and-words an alert
 * carries — so the shape has to do it here.
 *
 * Disc for unpushed, ring for dirty, triangle for failed. The triangle is the
 * shape this document already associates with failure, drawn out of borders
 * so its size is the grid's rather than the font's.
 *
 * Both colours are the palette's own — red 25 and amber 85 — rather than a
 * second name for a state it already has.
 *
 * The words are not decoration either. They are what a reader who cannot see
 * the marker hears, and — through the marker's title — what a reader who can
 * see it has instead of a legend the grid does not have room for.
 */
const MARKERS: Record<string, { className: string; words: string }> = {
  unpushed: { className: "size-1.5 rounded-full bg-pending", words: "not pushed to Jira" },
  dirty: {
    className: "size-1.5 rounded-full border-[1.5px] border-dirty",
    words: "edited since it was pushed",
  },
  failed: {
    // 9×8 — grown from 6×5, which read as a smudge rather than a triangle.
    className: "size-0 border-x-[4.5px] border-b-[8px] border-x-transparent border-b-failed",
    words: "did not reach Jira",
  },
};

type PushState = WeekCell["pushState"];

/** The marker a state draws, or undefined for `pushed` — the ordinary state a
 *  grid this dense has no business decorating. `failed` outranks whatever the
 *  rollup said, because it is newer than the rollup: it comes off the push
 *  that just happened, and a re-read reports those entries as unpushed again
 *  — true, but not the thing the reader needs in the seconds after Push. */
function markerFor(pushState: PushState, failed: boolean): { className: string; words: string } | undefined {
  return MARKERS[failed ? "failed" : (pushState ?? "pushed")];
}

/** Every state's own words, `pushed` included: it draws no marker, but a
 *  cell's popover still has to name it. */
function pushWords(pushState: PushState, failed: boolean): string {
  return markerFor(pushState, failed)?.words ?? "pushed to Jira";
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
  root: HTMLElement,
): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = "px-2 py-1.5 text-right";

  const id = `that-week-cell-${String(++weekCellSequence)}`;
  const empty = cell.seconds === 0;
  const words = pushWords(cell.pushState, failed);
  const figure = empty ? "—" : totalFigure(cell.seconds);
  const dayLabel = dayHeading(day, dayIndex);

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.id = id;
  trigger.setAttribute("aria-haspopup", "dialog");
  // The padding is given back as negative margin on every side, so the figure
  // lands exactly where the td's own padding already puts it and the hover
  // wash reaches no further than that — hugging the figure rather than
  // spanning the column, which stays the td's job alone.
  trigger.className =
    "hover:bg-hover -mx-1.5 -my-0.5 inline-flex cursor-pointer items-baseline rounded-sm " +
    "px-1.5 py-0.5";
  // Independent of the popover below, which reaches neither a keyboard nor a
  // screen reader on its own.
  trigger.setAttribute(
    "aria-label",
    empty
      ? `${row.issueKey}, ${dayLabel}, no time logged, click to add`
      : `${row.issueKey}, ${dayLabel}, ${figure}, ${words}, click to edit`,
  );
  trigger.addEventListener("click", () => {
    openEntryDialog(root, {
      instanceId: row.instanceId,
      instanceName: row.instanceName,
      instancePosition: row.instancePosition,
      issueKey: row.issueKey,
      summary: "",
      status: "",
    });
  });

  if (empty) {
    trigger.classList.add("text-ink-muted");
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
  }
  trigger.append(document.createTextNode(figure));

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
 *  never a control: it is a sum, and there is nothing on it to edit. */
function dayTotal(day: WeekDay, failed: boolean): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = "px-2 py-1.5 text-right";

  if (day.seconds === 0) {
    td.className += " text-ink-muted";
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

/** A row or week total: a sum of cells, so a sum's shape, and never a marker —
 *  the states it spans are already marked on the cells it adds up. */
function totalCell(seconds: number): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = "px-2 py-1.5 text-right font-bold";
  td.textContent = totalFigure(seconds);

  return td;
}

function headCell(text: string, align: string): HTMLTableCellElement {
  const th = document.createElement("th");
  th.scope = "col";
  th.className = `px-2 pb-1.5 font-normal ${align}`;
  th.textContent = text;

  return th;
}

/**
 * `Mon 7`. The weekday comes from the column's position, the number from the
 * day string the server sent — sliced rather than parsed, because
 * `new Date("2026-09-07")` is UTC midnight read back in the browser's zone, and
 * one timezone west that is the 6th.
 */
function dayHeading(day: string, index: number): string {
  return `${WEEKDAYS[index] ?? ""} ${String(Number(day.slice(8, 10)))}`;
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

function loadingLine(): HTMLElement {
  const line = document.createElement("p");
  line.className = "text-sm text-ink-muted";
  line.textContent = "Loading…";

  return line;
}

function alertFor(tone: string, message: string): HTMLElement {
  const alert = document.createElement("that-alert");
  alert.setAttribute("tone", tone);
  alert.setAttribute("message", message);

  return alert;
}

/** The server's message when there is one; ApiError carries it already. */
function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  return "Something went wrong.";
}
