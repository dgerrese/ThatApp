import "../components/that-alert";

import { ApiError, getWeek } from "../api";
import { totalFigure } from "../format";
import { paintInstanceDot } from "../instance-hue";
import { pushReportNodes } from "../push-report";
import { onPushReported } from "../push-reported";
import { setRailPeriod } from "../rail";
import { navigate } from "../router";
import type { RegisterTeardown } from "../router";
import type { PushResponse, WeekCell, WeekRollup } from "../types";
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

const NOTHING_FAILED: Failures = { cells: new Set(), days: new Set() };

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
  let failures: Failures = NOTHING_FAILED;

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
    if (mine !== epoch) return null;

    const marked = failures;
    failures = NOTHING_FAILED;

    showing = rollup.start;
    label.textContent = weekLabel(rollup.start, rollup.end);
    controls.replaceChildren(...weekControls(rollup));
    grid.replaceChildren(rollup.rows.length === 0 ? emptyWeek() : gridTable(rollup, marked));

    return rollup;
  };

  // Registered before the first read, so a push that lands while it is still in
  // flight is still heard. The rail owns the Push; this only renders what came
  // back, and then re-reads — every marker the rollup knows about settles only
  // when the rollup is asked again.
  const stopPushListening = onPushReported((responses) => {
    report.replaceChildren(...pushReportNodes(responses, { nameDays: true }));
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
    label: `Week · ${weekLabel(rollup.start, rollup.end)}`,
    viewPath: "/week",
    range: { from: rollup.start, to: rollup.end },
    pushHeading: "Push this week's time to Jira?",
  });
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
    weekButton({ glyph: "←", label: "Previous week", path: `/week?start=${rollup.prevStart}` }),
    weekButton({ label: "This week", path: "/week" }),
    weekButton({ glyph: "→", label: "Next week", path: `/week?start=${rollup.nextStart}` }),
  ];
}

/** The neighbouring starts come off the response; nothing here adds seven days. */
function weekButton(control: { glyph?: string; label: string; path: string }): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className =
    "inline-flex cursor-pointer items-center rounded-[9px] px-3 py-1.5 text-base font-bold " +
    "text-ink-muted hover:bg-surface hover:text-ink";

  if (control.glyph === undefined) {
    button.textContent = control.label;
  } else {
    // The glyph is decorative; the name it stands for is not, and a screen
    // reader would otherwise announce "leftwards arrow".
    button.setAttribute("aria-label", control.label);
    button.title = control.label;
    const glyph = document.createElement("span");
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = control.glyph;
    button.append(glyph);
  }

  button.addEventListener("click", () => {
    void navigate(control.path);
  });

  return button;
}

function gridTable(rollup: WeekRollup, failures: Failures): HTMLElement {
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
      tr.append(cellNode(cell, failures.cells.has(cellKey(row.instanceId, row.issueKey, day))));
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
  // footer says which days still hold time Jira has not got.
  for (const day of rollup.days) {
    footRow.append(cellNode(day, failures.days.has(day.day)));
  }
  footRow.append(totalCell(rollup.seconds));

  const foot = document.createElement("tfoot");
  foot.className = "font-bold";
  foot.append(footRow);

  table.append(head, body, foot);

  return table;
}

/**
 * How each state marks a cell. Filled against hollow, so unpushed and dirty
 * differ in shape as well as hue; failed reuses the palette's own red 25 rather
 * than naming a second colour for a state the design language already has.
 *
 * The words are not decoration. They are what a reader who cannot see the
 * marker hears, and — through the marker's title — what a reader who can see it
 * has instead of a legend the grid does not have room for.
 */
const MARKERS: Record<string, { className: string; words: string }> = {
  unpushed: { className: "bg-pending", words: "not pushed to Jira" },
  dirty: { className: "border-[1.5px] border-dirty", words: "edited since it was pushed" },
  failed: { className: "bg-failed", words: "did not reach Jira" },
};

/**
 * One cell. Four things are load-bearing here and none of them is obvious:
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
 *
 * `failed` outranks whatever the rollup said, because it is newer than the
 * rollup: it comes off the push that just happened, and a re-read reports those
 * entries as unpushed again — true, but not the thing the reader needs to know
 * in the seconds after pressing Push.
 */
function cellNode(cell: WeekCell, failed: boolean): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = "px-2 py-1.5 text-right";

  if (cell.seconds === 0) {
    td.className += " text-ink-muted";
    td.textContent = "—";

    return td;
  }

  const marker = MARKERS[failed ? "failed" : (cell.pushState ?? "pushed")];
  if (marker) {
    const mark = document.createElement("span");
    mark.className = `mr-1.5 inline-block size-1.5 rounded-full align-[1px] ${marker.className}`;
    mark.setAttribute("aria-hidden", "true");
    mark.title = marker.words;
    td.append(mark);

    const words = document.createElement("span");
    words.className = "sr-only";
    // Named for a reader who cannot see the marker. "Dirty" is the code's word,
    // not a person's.
    words.textContent = `${marker.words}, `;
    td.append(words);
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
