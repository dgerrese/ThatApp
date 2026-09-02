import "../components/that-alert";
import "../components/that-button";

import { ApiError, getWeek } from "../api";
import { totalFigure } from "../format";
import { paintInstanceDot } from "../instance-hue";
import { pushReportNodes } from "../push-report";
import { onPushReported } from "../push-reported";
import { setRailPeriod } from "../rail";
import { navigate } from "../router";
import type { RegisterTeardown } from "../router";
import type { WeekCell, WeekRollup } from "../types";
import { weekLabel } from "../week-label";

/**
 * Column headings, by position rather than by date. `cells` and `days` are
 * index-aligned and always seven long, so index 0 is Monday by contract — which
 * is what lets the grid be labelled without a Date being constructed.
 */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export async function render(root: HTMLElement, registerTeardown: RegisterTeardown): Promise<void> {
  const container = document.createElement("div");
  container.className = "space-y-4";

  const header = document.createElement("div");
  header.className = "flex flex-wrap items-baseline justify-between gap-3";

  const label = document.createElement("h2");
  label.className = "text-xl font-bold";

  const controls = document.createElement("div");
  controls.className = "flex items-center gap-1";
  header.append(label, controls);

  const grid = document.createElement("div");
  grid.append(loadingLine());

  const report = document.createElement("div");
  // Below the grid, and hidden rather than merely empty: the container's
  // space-y-4 gives every non-last child a bottom margin, so an empty box would
  // reserve 16px under the table for a report that has not happened. Nothing
  // may shift when one does — the grid must not move under a press.
  report.hidden = true;

  container.append(header, grid, report);
  root.append(container);

  // Read off the address, never derived: /week with no start is "this week", and
  // which week that is belongs to THAT_TIMEZONE. Thereafter it is whatever
  // Monday the server answered with, so a re-read fetches the week on screen
  // rather than whatever "this week" has become in the meantime.
  let showing = new URLSearchParams(window.location.search).get("start") ?? undefined;

  const show = async (): Promise<WeekRollup | null> => {
    let rollup: WeekRollup;
    try {
      rollup = await getWeek(showing);
    } catch (error) {
      grid.replaceChildren(alertFor("error", messageOf(error)));

      return null;
    }

    showing = rollup.start;
    label.textContent = weekLabel(rollup.start, rollup.end);
    controls.replaceChildren(...weekControls(rollup));
    grid.replaceChildren(rollup.rows.length === 0 ? emptyWeek() : gridTable(rollup));

    return rollup;
  };

  // Registered before the first read, so a push that lands while it is still in
  // flight is still heard. The rail owns the Push; this only renders what came
  // back, and then re-reads — every marker in the grid comes off the rollup, so
  // nothing settles until the rollup is asked again.
  const stopPushListening = onPushReported((responses) => {
    report.replaceChildren(...pushReportNodes(responses, { nameDays: true }));
    report.hidden = false;
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
    label: `Week · ${weekLabel(rollup.start, rollup.end)}`,
    viewPath: "/week",
    range: { from: rollup.start, to: rollup.end },
    pushHeading: "Push this week's time to Jira?",
  });
}

/**
 * Buttons rather than links, and that is not a styling choice: the router's
 * anchor handler navigates to `new URL(link.href).pathname`, which drops the
 * query — so an <a href="/week?start=…"> would land on this week every time.
 * Each still goes through navigate(), so each week keeps its own history entry.
 */
function weekControls(rollup: WeekRollup): HTMLElement[] {
  return [
    weekButton("Previous week", `/week?start=${rollup.prevStart}`),
    weekButton("This week", "/week"),
    weekButton("Next week", `/week?start=${rollup.nextStart}`),
  ];
}

/** The neighbouring starts come off the response; nothing here adds seven days. */
function weekButton(label: string, path: string): HTMLElement {
  const element = document.createElement("that-button");
  element.setAttribute("label", label);
  element.setAttribute("variant", "secondary");
  element.addEventListener("click", () => {
    void navigate(path);
  });

  return element;
}

function gridTable(rollup: WeekRollup): HTMLElement {
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

    for (const cell of row.cells) {
      tr.append(cellNode(cell));
    }
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
  // footer says which days still hold time Jira has not got.
  for (const day of rollup.days) {
    footRow.append(cellNode(day));
  }
  footRow.append(totalCell(rollup.seconds));

  const foot = document.createElement("tfoot");
  foot.className = "font-bold";
  foot.append(footRow);

  table.append(head, body, foot);

  return table;
}

/**
 * One cell. Three things are load-bearing here and none of them is obvious:
 *
 * `totalFigure`, never `timerFigure` — format.ts reserves the colon for a
 * timer, and a colon somewhere you cannot press play is a bug rather than a
 * formatting preference. Every figure in a rollup is a sum.
 *
 * An em dash for an empty cell, not `0h 00m` — a zero is a measurement, and a
 * cell with no entries has not measured anything.
 *
 * The marker is inline with no reserved width. The column is right-aligned, so
 * the figure ends at the same edge either way and the marker hangs off to the
 * left; a reserved gutter would fix a drift that does not happen.
 */
function cellNode(cell: WeekCell): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = "px-2 py-1.5 text-right";

  if (cell.seconds === 0) {
    td.className += " text-ink-muted";
    td.textContent = "—";

    return td;
  }

  if (cell.pushState === "unpushed" || cell.pushState === "dirty") {
    const mark = document.createElement("span");
    // Filled against hollow, so the two states differ in shape as well as hue.
    mark.className =
      cell.pushState === "unpushed"
        ? "mr-1.5 inline-block size-1.5 rounded-full bg-pending align-[1px]"
        : "mr-1.5 inline-block size-1.5 rounded-full border-[1.5px] border-dirty align-[1px]";
    mark.setAttribute("aria-hidden", "true");
    td.append(mark);

    const state = document.createElement("span");
    state.className = "sr-only";
    // Named for a reader who cannot see the marker. "Dirty" is the code's word,
    // not a person's.
    state.textContent =
      cell.pushState === "unpushed" ? "not pushed to Jira, " : "edited since it was pushed, ";
    td.append(state);
  }

  td.append(document.createTextNode(totalFigure(cell.seconds)));

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
