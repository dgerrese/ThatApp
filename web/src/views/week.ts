import "../components/that-alert";

import { ApiError, fetchWeek, getWeek } from "../api";
import { CARD_SURFACE_CLASSES } from "../card-surface";
import { openEntryDialog } from "../components/that-entry-dialog";
import { announceEntriesChanged } from "../entries-changed";
import { fetchReportNodes } from "../fetch-report";
import { totalFigure } from "../format";
import { iconMarkup } from "../icons";
import { paintInstanceDot } from "../instance-hue";
import { pageHeading } from "../page-heading";
import { pushReportNodes } from "../push-report";
import { onPushReported } from "../push-reported";
import { setRailPeriod } from "../rail";
import { navigate } from "../router";
import type { RegisterTeardown } from "../router";
import { toolbarButton } from "../toolbar-button";
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

  // The pageHeading shape Today's sections wear — #117's W7 — rather than
  // week.ts's own text-xl font-bold, which was the drift. mb-2.5 is kept: the
  // container's own space-y-4 gives every non-last child a bottom margin
  // through `:where()`, which carries zero specificity, so header's own real
  // `.mb-2.5` class already wins over it and the drawn 10px stands — stripping
  // it was based on a fear the two stack, which they never do. Today's own
  // heading gets the identical 10px from the same class, just with no
  // space-y-4 rule beside it to out-specify.
  const { box: header, heading: label } = pageHeading("");

  const rule = document.createElement("span");
  rule.className = "bg-edge h-5 w-px";
  rule.setAttribute("aria-hidden", "true");

  const refreshControl = refreshButton();
  const fetchControl = fetchButton();

  // Attached the moment the controls exist rather than after the first read.
  // render appends this header synchronously and the router awaits it, so
  // both buttons are painted and focusable from the first frame; a listener
  // added after the read would swallow every press until then, and for the
  // whole mount if that read failed. What keeps a press from arriving too
  // early is each control's own disabled state, which the first successful
  // read lifts.
  //
  // One flag shared by both: a refresh landing mid-fetch would paint a
  // half-applied week, and a fetch launched mid-refresh is the same risk the
  // other way round, so either press disables both controls for its whole
  // round trip.
  let busy = false;
  fetchControl.addEventListener("click", () => {
    void (async () => {
      busy = true;
      fetchControl.disabled = true;
      refreshControl.disabled = true;
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
        // No entries to carry — the response is counts and names, not rows —
        // so the rail re-reads the period itself. Skipped when nothing moved:
        // a clean run, or entries the fetch declined to overwrite, change
        // nothing worth repainting for.
        if (outcome.created + outcome.updated > 0) announceEntriesChanged();
      } catch (error) {
        report.replaceChildren(alertFor("error", messageOf(error)));
        report.hidden = false;
      } finally {
        busy = false;
        fetchControl.disabled = false;
        refreshControl.disabled = false;
      }
    })();
  });

  // The same read the mount and every push already use — nothing written,
  // no Jira endpoint called. show() itself repaints the grid and the week
  // controls; this only has to bracket the round trip the way the fetch
  // handler above does.
  refreshControl.addEventListener("click", () => {
    void (async () => {
      busy = true;
      fetchControl.disabled = true;
      refreshControl.disabled = true;
      try {
        // A read that fails here is already visible: show()'s own catch
        // replaces the grid with an alert, the same path a direct navigation
        // to a bad week or a post-push re-read already goes through — refresh
        // is not a new way to reach it. This catch is what fetchControl's
        // wider try/catch already gives its own re-read for free, made
        // explicit here since this handler's whole operation is that one
        // call: anything show() itself throws, rather than merely reports
        // through getWeek's own caught rejection, still reaches the user
        // instead of becoming a silent, unhandled rejection.
        await show();
      } catch (error) {
        report.replaceChildren(alertFor("error", messageOf(error)));
        report.hidden = false;
      } finally {
        busy = false;
        fetchControl.disabled = false;
        refreshControl.disabled = false;
      }
    })();
  });

  const controls = document.createElement("div");
  controls.className = "flex items-center gap-1";

  // Pushes controls to the far end of the header — the prototype's own `.sp`,
  // a bare flex-1 spacer beside the label, the rule and the two buttons.
  const spacer = document.createElement("span");
  spacer.className = "flex-1";
  spacer.setAttribute("aria-hidden", "true");

  header.append(rule, refreshControl, fetchControl, spacer, controls);

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
        controls.append(...weekButton({ label: "This week", path: "/week" }));
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
    grid.replaceChildren(
      rollup.rows.length === 0 ? emptyWeek() : gridCard(gridTable(rollup, marked, root)),
    );
    // There is a week on screen to read again now. Guarded on `busy` because
    // both the fetch and the refresh end by calling show() themselves, and
    // re-enabling here would hand a control back a moment before the round
    // trip it belongs to ends.
    fetchControl.disabled = busy;
    refreshControl.disabled = busy;

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
    pushLabel: "Push this week",
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
    ...weekButton({
      mark: iconMarkup("arrow-left"),
      label: "Previous week",
      tip: "previous week",
      path: `/week?start=${rollup.prevStart}`,
    }),
    ...weekButton({ label: "This week", path: "/week" }),
    ...weekButton({
      mark: iconMarkup("arrow-right"),
      label: "Next week",
      tip: "next week",
      path: `/week?start=${rollup.nextStart}`,
    }),
  ];
}

let weekButtonSequence = 0;

/**
 * The neighbouring starts come off the response; nothing here adds seven days.
 *
 * `h-9` is fixed rather than left to padding: the icon buttons either side of
 * "This week" hold an 18px mark with nothing else to give it a text line's
 * height, so padding alone left them shorter than the text button and the
 * three did not sit on a line. An icon button is additionally `w-9 p-0` —
 * the drawing's `.wctl.icon`, square at the shared height — where the text
 * button keeps its horizontal padding instead.
 *
 * Returns an array rather than one element: an icon button's popover is a
 * sibling in the DOM, the same shape appendPinControl in that-ticket-row.ts
 * gives its own trigger-and-tooltip pair, and weekControls spreads every call
 * flat into the header.
 */
function weekButton(control: {
  mark?: string;
  label: string;
  tip?: string;
  path: string;
}): HTMLElement[] {
  const button = document.createElement("button");
  button.type = "button";
  button.className =
    "inline-flex h-9 cursor-pointer items-center justify-center rounded-sm text-base " +
    `font-bold text-ink-muted hover:bg-hover hover:text-ink ${control.mark === undefined ? "px-3" : "w-9 p-0"}`;

  button.addEventListener("click", () => {
    void navigate(control.path);
  });

  if (control.mark === undefined) {
    button.textContent = control.label;

    return [button];
  }

  // The mark is decorative (icons.ts sets aria-hidden); the name it stands
  // for is not, and a screen reader would otherwise read the button empty.
  button.setAttribute("aria-label", control.label);
  const id = `that-week-control-${String(++weekButtonSequence)}`;
  button.id = id;
  const mark = document.createElement("span");
  mark.innerHTML = control.mark;
  button.append(mark);

  // that-tooltip, not a native title (W13): the tooltip is never the
  // accessible name, so the aria-label above stays exactly where it is.
  const tooltip = document.createElement("that-tooltip");
  tooltip.setAttribute("for", id);
  tooltip.textContent = control.tip ?? control.label;

  return [button, tooltip];
}

/**
 * Pulls the week's worklogs in.
 *
 * Outside the week controls opposite it: those three are navigation and
 * share one height as one group, where this writes entries to the database.
 * The rule before it is what says so. Built on toolbarButton, which is what
 * fixes this control's rendered form — see the visual language's Decision
 * 12; this function must not change what it draws.
 */
function fetchButton(): HTMLButtonElement {
  const button = toolbarButton({ icon: "fetch", label: "Fetch worklogs" });
  // Enabled by the read that gives it a week to fetch. Until then there is
  // nothing for a press to do, and a control that looks pressable and answers
  // nothing is worse than one that says it is not ready.
  button.disabled = true;

  return button;
}

/**
 * Re-reads the week from this app's own database — the same call show()
 * already makes on mount, on a push and on a navigation between weeks. It
 * calls no Jira endpoint and writes nothing, which is what tells it apart
 * from fetchButton beside it.
 */
function refreshButton(): HTMLButtonElement {
  const button = toolbarButton({ icon: "refresh", label: "Refresh" });
  // Enabled by the same first read that lets fetchButton go — see the `busy`
  // guard shared by both in render().
  button.disabled = true;

  return button;
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
  link.href = url;
  link.target = "_blank";
  // Without noopener the opened page gets a window.opener handle back here.
  link.rel = "noopener";
  link.className = "that-key text-ink-muted";
  link.title = `Open ${issueKey} in Jira`;
  link.textContent = issueKey;

  return link;
}

function gridTable(rollup: WeekRollup, failures: Failures, root: HTMLElement): HTMLTableElement {
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
    holder.append(dot, keyLink(row.issueKey, row.url));
    ticket.append(holder);
    tr.append(ticket);

    row.cells.forEach((cell, index) => {
      const day = rollup.days[index]?.day ?? "";
      const failed = failures.cells.has(cellKey(row.instanceId, row.issueKey, day));
      tr.append(ticketCell(row, index, day, cell, failed, root));
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
function markerFor(
  pushState: PushState,
  failed: boolean,
): { className: string; words: string } | undefined {
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
 */
function totalCell(seconds: number, foot: boolean): HTMLTableCellElement {
  const td = document.createElement("td");
  const gap = foot ? "pl-[10px] py-3" : "pl-[18px] h-[46px]";
  td.className = `${gap} text-right align-middle font-mono font-bold`;
  td.textContent = totalFigure(seconds);

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
