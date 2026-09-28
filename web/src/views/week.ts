import "../components/that-alert";
import "../components/that-issue-search";

import { alertFor, messageOf } from "../alert";
import { createPin, fetchWeek, getWeek } from "../api";
import { openEntryDialog } from "../components/that-entry-dialog";
import type { IssueSearchConfig, ThatIssueSearch } from "../components/that-issue-search";
import { announceEntriesChanged, onEntriesChanged } from "../entries-changed";
import { fetchReportNodes } from "../fetch-report";
import { iconMarkup } from "../icons";
import { pageHeading } from "../page-heading";
import { pushReportNodes } from "../push-report";
import { onPushReported } from "../push-reported";
import { setRailPeriod } from "../rail";
import { navigate } from "../router";
import type { RegisterTeardown } from "../router";
import { enableRowArrowKeys } from "../table-keys";
import { toolbarButton } from "../toolbar-button";
import type { IssueHit, WeekRollup, WeekRow } from "../types";
import { failuresIn, noFailures, weekGrid } from "../week-grid";
import type { Failures } from "../week-grid";
import { weekLabel } from "../week-label";

/** A stable string for a `Failures` value, independent of `Set` iteration
 *  order — what lets `show` tell two reads' failure sets apart by value
 *  rather than by which read produced them. */
function failuresKey(value: Failures): string {
  return `${[...value.cells].sort().join(",")}|${[...value.days].sort().join(",")}`;
}

/** Identifies a row the way the server's own sort and this view's merge both
 *  do: by instance and issue key, the pair `rollup.rows` is keyed on. */
function ticketKey(instanceId: number, issueKey: string): string {
  return `${String(instanceId)}:${issueKey}`;
}

/** What a search result needs to draw an empty row — everything `syntheticRow`
 *  turns into a `WeekRow`, and nothing a real one also carries: no summary or
 *  status, the same restraint Week's own rows already keep. */
interface AddedRow {
  instanceId: number;
  instanceName: string;
  instancePosition: number;
  issueKey: string;
  url: string;
}

/** A row with nothing logged, built the same way an ordinary one with an
 *  empty day would render: seven empty cells, an em dash total via
 *  `ticketCell`/`totalCell`'s own zero handling, no `pushState` to mark. */
function syntheticRow(added: AddedRow): WeekRow {
  return {
    instanceId: added.instanceId,
    instanceName: added.instanceName,
    instancePosition: added.instancePosition,
    issueKey: added.issueKey,
    url: added.url,
    cells: Array.from({ length: 7 }, () => ({ seconds: 0, pushState: null })),
    seconds: 0,
  };
}

/** Instance position then issue key, matching sort.Slice in
 *  internal/server/week.go byte for byte — a synthetic row takes the same
 *  place a real one would if it were logged. */
function compareRows(a: WeekRow, b: WeekRow): number {
  if (a.instancePosition !== b.instancePosition) return a.instancePosition - b.instancePosition;

  return a.issueKey < b.issueKey ? -1 : a.issueKey > b.issueKey ? 1 : 0;
}

/**
 * The rollup's own rows, plus a synthetic one for every ticket added by
 * search that the rollup does not already carry for real. Pure — `added` is
 * only read. Decision 3's second, simpler pass: an add lasts until the view
 * is left, full stop, so nothing here ever drops a key. A ticket the rollup
 * already carries is skipped rather than duplicated; once its last entry is
 * deleted, the very next read finds it missing from `rows` again and this
 * puts the (still-tracked) empty row straight back, with no promotion or
 * pruning to have gotten wrong in between.
 */
function mergeRows(rows: WeekRow[], added: Map<string, AddedRow>): WeekRow[] {
  const known = new Set(rows.map((row) => ticketKey(row.instanceId, row.issueKey)));
  const extra = [...added.values()].filter(
    (ticket) => !known.has(ticketKey(ticket.instanceId, ticket.issueKey)),
  );
  if (extra.length === 0) return rows;

  return [...rows, ...extra.map(syntheticRow)].sort(compareRows);
}

/**
 * What Week configures the search panel with — decision 3's own controls.
 * Its result rows carry no duration control: logging happens in the day
 * cells a chosen result joins, never here, so the first control is the
 * add-to-week mark rather than Today's Log. `onAdd` and `onPinFailure` are
 * render()'s own closures; this function only shapes the words and the two
 * controls, the same split issueSearchConfig keeps in today.ts.
 */
function weekSearchConfig(
  onAdd: (hit: IssueHit) => void,
  onPinFailure: (error: unknown) => void,
): IssueSearchConfig {
  return {
    placeholder: "Add a ticket to this week",
    footer:
      "Searching all instances. Choosing a result adds it to this week; click a day to log time.",
    controls: [
      {
        kind: "icon",
        icon: () => "add-to-week",
        tooltip: () => "add to this week",
        label: (hit) => `Add ${hit.key} to this week`,
        onPress: onAdd,
      },
      {
        kind: "icon",
        // Week draws no pin mark of its own — decision 1: a pinned row and a
        // searched one are indistinguishable here, unlike Today's own pin
        // control, which answers `pin-off` for a hit already pinned.
        icon: () => "pin",
        tooltip: () => "pin ticket",
        label: (hit) => `Pin ${hit.key}`,
        onPress: (hit) => {
          // A pin adds its row at once (decision 2) — the same `addedTickets`
          // path the add-to-week control uses, not a second one, and not a
          // read to wait on. An unpin later takes nothing away: `onAdd` only
          // ever inserts into the map, and nothing here ever removes from it.
          onAdd(hit);
          void createPin(hit.instanceId, hit.key).catch(onPinFailure);
        },
      },
    ],
  };
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

  // `addTicketToWeek` and `reportPinFailure` are declared further down but
  // usable here already — function declarations hoist to the top of the
  // call they are in, unlike the `const`s and `let`s around them. Placed
  // between the spacer and the week-nav group, matching the prototype's own
  // `.sp`, `.field`, `.ctlgroup` order for this header.
  const search = document.createElement("that-issue-search") as ThatIssueSearch;
  search.config = weekSearchConfig(addTicketToWeek, reportPinFailure);

  header.append(rule, refreshControl, fetchControl, spacer, search, controls);

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

  // One listener for the grid's whole lifetime: paintWeek only ever replaces
  // grid's children (a re-render, a week change's remount), never grid
  // itself, so this needs wiring once rather than after every repaint.
  registerTeardown(enableRowArrowKeys(grid, "tbody tr"));

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

  // What the grid last actually painted, so a read that comes back
  // byte-identical to it — rail.ts's own trailing re-read after a push that
  // changed nothing this view didn't already know, most often — repaints
  // nothing rather than replacing the grid with a copy of itself. Two
  // `show()` calls this close together are otherwise a real, if harmless,
  // source of flicker: nulled by every navigation, since a fresh mount has
  // painted nothing yet to compare against.
  let painted: { rollup: string; failures: string } | null = null;

  // Decision 3, second and settled pass: an add lasts until the view is
  // left, full stop. The key stays here for the life of this mount — nothing
  // ever drops one, and mergeRows puts the row back the moment the rollup no
  // longer carries it for real, which is what covers "log an hour, notice
  // it was the wrong day, delete the entry" without the row evaporating.
  // Not stored, not pinned, not sent anywhere. A fresh mount — including
  // this view's own teardown-and-remount on every navigation, confirmed in
  // router.ts, moving between weeks included — starts a new, empty map,
  // which is the whole of "dies with the view".
  const addedTickets = new Map<string, AddedRow>();

  // What paintWeek last built from, kept so the add-to-week control can
  // repaint immediately without a read of its own — choosing a result logs
  // nothing and calls no endpoint, so there is nothing for it to await.
  let lastRollup: WeekRollup | null = null;
  let lastMarked: Failures = noFailures();

  /** `rollup.rows` merged with whatever search has added — see `mergeRows`.
   *  Both a genuine read and the add-to-week control need this same object,
   *  once to compare against `painted` and once to hand `paintWeek`, so it
   *  is built here rather than each repeating its own merge-and-stringify. */
  function paintingFor(rollup: WeekRollup): WeekRollup {
    return { ...rollup, rows: mergeRows(rollup.rows, addedTickets) };
  }

  /** Paints an already-merged rollup — see `paintingFor`. Used by a genuine
   *  read below and directly by the add-to-week control, which has no read
   *  of its own to trigger one from. */
  function paintWeek(painting: WeekRollup, marked: Failures): void {
    label.textContent = periodLabel(painting);
    controls.replaceChildren(...weekControls(painting));
    grid.replaceChildren(
      weekGrid(painting, marked, (ticket) => {
        openEntryDialog(root, ticket);
      }),
    );
  }

  /** The add-to-week control's own onPress: holds the key, then repaints
   *  from the last real rollup. A key already tracked is left alone —
   *  `mergeRows` is what keeps the grid honest regardless. */
  function addTicketToWeek(hit: IssueHit): void {
    const key = ticketKey(hit.instanceId, hit.key);
    if (!addedTickets.has(key)) {
      addedTickets.set(key, {
        instanceId: hit.instanceId,
        instanceName: hit.instanceName,
        instancePosition: hit.instancePosition,
        issueKey: hit.key,
        url: hit.url,
      });
    }
    if (!lastRollup) return;

    const painting = paintingFor(lastRollup);
    paintWeek(painting, lastMarked);
    painted = { rollup: JSON.stringify(painting), failures: failuresKey(lastMarked) };
  }

  /** Week draws no pin mark of its own (decision 1: a pinned row and a
   *  searched one are indistinguishable), so there is no optimistic mark to
   *  undo here the way Today's pin control has — only a failure worth
   *  saying, in the same spot a push or fetch failure already reports to. */
  function reportPinFailure(error: unknown): void {
    report.replaceChildren(alertFor("error", messageOf(error)));
    report.hidden = false;
  }

  // `preserveFailures` is false for every user-initiated read (the mount, a
  // Refresh or Fetch press, a week navigation's remount) and true for the two
  // reads Week triggers on its own behalf — the push report's own re-read and
  // the entries-changed re-read below — so a push's failure marks survive
  // whichever of those two paints last, rather than the first one's paint
  // erasing them for the second. Only a read the user actually asked for
  // consumes them.
  const show = async (options: { preserveFailures?: boolean } = {}): Promise<WeekRollup | null> => {
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
      // The grid no longer shows what `painted` describes, so the next read —
      // a plain retry naming the same week is the ordinary case — must not
      // compare against it: an identical signature would otherwise skip the
      // repaint that recovers from the alert.
      painted = null;
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

    // A read the user asked for consumes the marks immediately — `marked`
    // itself withholds them, not only the state left for the next read —
    // so one Refresh press is enough. Reading `failures` first and clearing
    // it after would still paint the stale marks once, on this very read.
    const marked = options.preserveFailures ? failures : noFailures();
    if (!options.preserveFailures) failures = noFailures();

    showing = rollup.start;
    lastRollup = rollup;
    lastMarked = marked;

    const painting = paintingFor(rollup);
    const signature = { rollup: JSON.stringify(painting), failures: failuresKey(marked) };
    if (
      painted === null ||
      painted.rollup !== signature.rollup ||
      painted.failures !== signature.failures
    ) {
      painted = signature;
      paintWeek(painting, marked);
    }
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
  // when a user-initiated read is asked for again (see `show`'s own comment).
  const stopPushListening = onPushReported((responses, unanswered) => {
    report.replaceChildren(...pushReportNodes(responses, unanswered, { nameDays: true }));
    report.hidden = false;
    failures = failuresIn(responses);
    void show({ preserveFailures: true });
  });

  // The entries dialog announces a mutation with no payload whenever it is
  // scoped to a day other than today's (see afterMutation in
  // that-entry-dialog.ts), which is every day Week's own cells open it for —
  // so the payload carries nothing this grid could paint from and the only
  // honest response is to re-read the week whole, the same as a push report.
  // `preserveFailures` for the same reason it matters there: rail.ts fires
  // this same announcement right after reporting a push, and that trailing
  // read must still show the marks the push report just set rather than
  // wiping them — including when that trailing announcement never arrives at
  // all (rail.ts swallows a failed re-read there), in which case this handler
  // simply runs on the next real entries change instead, still holding them.
  const stopEntriesListening = onEntriesChanged(() => {
    void show({ preserveFailures: true });
  });

  // The rail's period is global state that outlives this view, so a mount the
  // user has already navigated away from must not still hand it one. Everything
  // else this view paints is its own detached DOM, which nobody sees.
  let mounted = true;
  registerTeardown(() => {
    mounted = false;
    stopPushListening();
    stopEntriesListening();
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
    pushHeading: "Push this week's time?",
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

function loadingLine(): HTMLElement {
  const line = document.createElement("p");
  line.className = "text-sm text-ink-muted";
  line.textContent = "Loading…";

  return line;
}
