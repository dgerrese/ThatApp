import { listEntries, pushDay } from "./api";
import { announceEntriesChanged, onEntriesChanged } from "./entries-changed";
import { elapsedFigure, totalFigure } from "./format";
import { iconMarkup } from "./icons";
import { instanceHue } from "./instance-hue";
import { announcePushReported } from "./push-reported";
import { navigate } from "./router";
import { currentTimer, elapsedSeconds, onTimerChanged, readTimer, stopTimer } from "./timer-state";
import type { Entry, PushResponse, RunningTimer } from "./types";

/**
 * The rail's live regions: the day's total, the split of it across instances,
 * and the unpushed count with the control that pushes it.
 *
 * It lives in the shell rather than in Today, and that is the whole point. The
 * rail is the instrument — the same figure in the same place whatever view you
 * are on — so it has to stay right on Settings, and on #11's Week view, without
 * either of them knowing it exists. Push belongs here for the same reason: it
 * sits beside the day total it sends, reachable from every view rather than
 * only from Today.
 *
 * It never computes a date. It sums rows the server already stamped with a day
 * resolved in THAT_TIMEZONE, which is the only way the total agrees with the
 * end-of-day push when no browser is open to ask.
 */
// The first retry after a failed boot read, doubling up to the cap. Short to
// start with because the likely cause — the container still coming up — clears
// in seconds.
const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

/**
 * What the rail is describing. A view declares this on mount; the rail owns
 * nothing about which period is current.
 *
 * `range` is absent for today rather than computed here, because the rail must
 * not derive a date — the end-of-day push and the weekly rollup have to agree on
 * where a day ends with no browser open, and the server is the one that decides.
 * An absent range is exactly what `listEntries()` already defaults to.
 */
export interface RailPeriod {
  label: string;
  viewPath: string;
  range?: { from: string; to: string };
  pushHeading: string;
  pushLabel: string;
}

export const TODAY_PERIOD: RailPeriod = {
  label: "Today",
  viewPath: "/today",
  pushHeading: "Push today's time?",
  pushLabel: "Push worklogs",
};

// Everything that is not pushed is pending: never sent, or sent and edited
// since. The server's push sweeps both (internal/server/push.go), and the two
// filters below drifted from it because each was written by hand — #121.
const isPending = (entry: Entry): boolean => entry.pushState !== "pushed";

let currentPeriod: RailPeriod = TODAY_PERIOD;
let applyPeriod: ((period: RailPeriod) => void) | undefined;

/**
 * Called by a view as it mounts. Before startRail has run there is nothing to
 * paint, so the period is merely recorded and the boot read picks it up.
 *
 * A no-op when the period is already current: startRail in fact always runs
 * before any view mounts (see main.ts), so every mount of a view that shares
 * today's period — Today itself, and Settings borrowing it — would otherwise
 * fire a live re-read of a period the rail is already showing. Reference
 * equality is enough because every period a view hands in is a shared
 * constant (TODAY_PERIOD) or freshly built for a genuine change.
 */
export function setRailPeriod(period: RailPeriod): void {
  if (period === currentPeriod) return;
  currentPeriod = period;
  applyPeriod?.(period);
}

export function startRail(): void {
  const total = document.querySelector<HTMLElement>("#rail-total");
  const split = document.querySelector<HTMLElement>("#rail-split");
  const unpushed = document.querySelector<HTMLElement>("#rail-unpushed");
  const push = document.querySelector<HTMLButtonElement>("#rail-push");
  const period = document.querySelector<HTMLElement>("#rail-period");
  const timer = document.querySelector<HTMLElement>("#rail-timer");
  if (!total || !split || !unpushed || !push || !period || !timer) return;

  // Supersession, the same job searchIssues' AbortController does: a slow read
  // must not land after a newer one — or after an announcement that carried
  // the day directly — and paint stale totals back.
  let epoch = 0;
  let painted = false;
  let retryTimer: number | undefined;
  let retryDelay = FIRST_RETRY_MS;

  // What paint() last found unpushed, and whether a push is in flight right
  // now. The button's disabled state is a function of both — never written
  // directly — so a push in progress cannot be raced by an unrelated repaint.
  let pending: Entry[] = [];
  let pushing = false;

  const syncPushButton = (): void => {
    push.disabled = pushing || pending.length === 0;
  };

  // The three states are mutually exclusive, so one helper sets exactly one of
  // them rather than each writer removing its own idea of what might be on the
  // element — two callers each clearing a partial list is how a failure's
  // text-failed-rail once ended up layered on top of a stale text-pending-rail
  // instead of replacing it.
  const UNPUSHED_STATE_CLASSES = [
    "text-rail-muted",
    "text-pending-rail",
    "text-failed-rail",
  ] as const;
  const setUnpushedState = (state: (typeof UNPUSHED_STATE_CLASSES)[number]): void => {
    unpushed.classList.remove(...UNPUSHED_STATE_CLASSES);
    unpushed.classList.add(state);
  };

  /**
   * Owns #rail-unpushed's resting text and colour. A failure inside
   * handlePush writes its own message directly to the element instead — see
   * showPushError — so this must never run between that write and the repaint
   * that is meant to supersede it.
   */
  const paintUnpushed = (): void => {
    setUnpushedState(pending.length === 0 ? "text-rail-muted" : "text-pending-rail");
    unpushed.textContent =
      pending.length === 0
        ? "Nothing to push"
        : `${String(pending.length)} ${pending.length === 1 ? "entry" : "entries"} to push`;
  };

  const showPushError = (message: string): void => {
    setUnpushedState("text-failed-rail");
    unpushed.textContent = message;
  };

  const paint = (entries: Entry[]): void => {
    period.textContent = currentPeriod.label;
    push.textContent = currentPeriod.pushLabel;
    painted = true;
    retryDelay = FIRST_RETRY_MS;
    total.textContent = totalFigure(entries.reduce((sum, entry) => sum + entry.seconds, 0));
    drawSplit(split, sliceByInstance(entries));
    pending = entries.filter(isPending);
    paintUnpushed();
    syncPushButton();
  };

  /**
   * Once something real has been painted, a failure leaves both regions
   * exactly as they were: the rail is glanced at rather than read, and a total
   * that silently drops to zero because a request failed is the one wrong
   * answer indistinguishable from a true one. Before the first paint that
   * policy inverts — the regions hold index.html's hardcoded 0h 00m, a
   * placeholder rather than a truth worth preserving — so a failed boot read
   * retries until a real figure is up.
   *
   * A period change puts the rail back into that pre-paint state on purpose
   * (see applyPeriod). Keeping the old figures is only defensible while they
   * belong to the period the label claims, and after a period change they
   * belong to the one before it.
   */
  const refresh = async (): Promise<void> => {
    const mine = ++epoch;
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }

    let entries: Entry[];
    try {
      ({ entries } = await listEntries(currentPeriod.range));
    } catch {
      if (!painted && mine === epoch) {
        retryTimer = window.setTimeout(() => {
          retryTimer = undefined;
          void refresh();
        }, retryDelay);
        retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
      }

      return;
    }
    if (mine !== epoch) return;

    paint(entries);
  };

  // No unsubscribe: the shell outlives every view, so this listener is meant to
  // last as long as the page does.
  onEntriesChanged((entries) => {
    // The announcement carries today's entries. It answers the rail's question
    // only while today is what the rail is showing; for any other period the
    // right response is to re-read that period.
    if (entries && currentPeriod === TODAY_PERIOD) {
      epoch += 1;
      paint(entries);

      return;
    }
    void refresh();
  });
  void refresh();

  // A period change is a new read, and it moves the epoch so a read still in
  // flight for the previous period cannot land afterwards and paint it back.
  // Dropping `painted` re-arms the pre-paint retry for exactly the case it was
  // written for: until this period has painted once, what is on screen is the
  // previous period's, so a failed read must keep trying rather than strand the
  // rail on figures the view beside it contradicts. paint() sets it back.
  applyPeriod = () => {
    epoch += 1;
    painted = false;
    void refresh();
  };

  // Which ticket (as "instanceId:issueKey") the rail's timer region last
  // rebuilt for, or null while resting — and the elapsed span from that
  // build. A tick fires the same onTimerChanged event a start, a stop or a
  // switch does, and the common case by far is a tick: rebuilding the whole
  // line every second would also drop keyboard focus off the stop button the
  // moment someone tabs to it, the same failure that-ticket-row's own
  // paintSeconds/paintDuration avoid for the same reason. So only a genuine
  // change in what is running rebuilds; a tick on the same ticket just
  // updates the one span that moved.
  let renderedTimerKey: string | null = null;
  let elapsedEl: HTMLElement | undefined;
  let timerRetryTimer: number | undefined;
  let timerRetryDelay = FIRST_RETRY_MS;

  /**
   * readTimer()'s own retry, the same shape refresh()'s pre-paint retry
   * above uses: doubling backoff, reset on success. Without it a boot read
   * that fails once — the likely cause being the same "container still
   * coming up" refresh() already guards against — leaves the rail
   * permanently claiming nothing is running while a timer actually is, with
   * nothing to ever correct it; unlike refresh()'s entries, nothing else
   * re-reads the timer on a schedule.
   */
  const refreshTimer = async (): Promise<void> => {
    if (timerRetryTimer !== undefined) {
      clearTimeout(timerRetryTimer);
      timerRetryTimer = undefined;
    }

    try {
      await readTimer();
      timerRetryDelay = FIRST_RETRY_MS;
    } catch {
      timerRetryTimer = window.setTimeout(() => {
        timerRetryTimer = undefined;
        void refreshTimer();
      }, timerRetryDelay);
      timerRetryDelay = Math.min(timerRetryDelay * 2, MAX_RETRY_MS);
    }
  };

  const handleStopTimer = (): void => {
    void stopTimer().catch(() => {
      // Swallowed for the same reason that-timer.ts's own catch is: the
      // region paints from currentTimer() alone, a failed call changed
      // nothing, and the button that was just pressed is still right there
      // to press again. Left uncaught, this would surface as an unhandled
      // promise rejection instead of a quiet, retryable no-op.
    });
  };

  /**
   * The running line, or the resting "No timer running" — decision 4 of the
   * timer design. Reachable from every view, unlike the row's own control,
   * which #8 draws only on Today.
   */
  const paintTimer = (): void => {
    const running = currentTimer();
    const key = running ? `${String(running.instanceId)}:${running.issueKey}` : null;

    if (key === renderedTimerKey && elapsedEl) {
      elapsedEl.textContent = elapsedFigure(elapsedSeconds());

      return;
    }
    renderedTimerKey = key;

    if (!running) {
      elapsedEl = undefined;
      timer.replaceChildren(...restingTimerLine());

      return;
    }

    const built = runningTimerLine(running, handleStopTimer);
    elapsedEl = built.elapsed;
    timer.replaceChildren(...built.nodes);
  };

  // No unsubscribe, for the same reason onEntriesChanged's above has none:
  // the shell outlives every view. readTimer() (via refreshTimer(), for its
  // retry) is the one boot read timer-state.ts itself never makes on its
  // own — see its own comment for why that is the rail's job.
  onTimerChanged(paintTimer);
  paintTimer();
  void refreshTimer();

  /**
   * Confirms, pushes, then hands the result to whoever is listening for it —
   * Today, if it is mounted, per push-reported.ts.
   *
   * The button is disabled for the whole call, confirmation included, for the
   * same reason #9's original Today implementation disabled its own: a second
   * click while one push is already in flight (or its confirmation still
   * open) is the realistic way to fire two concurrent POST /api/push
   * requests, and a duplicate Jira worklog is exactly the harm this ticket
   * exists to avoid. See the mutex in internal/server/push.go for the other
   * half.
   *
   * A failure at either await — the pre-push read or the push itself — has
   * nowhere else to go: the rail has no alert surface of its own, so it is
   * written directly into #rail-unpushed via showPushError, in the
   * failed-rail colour reserved for exactly this in the theme. Today's report
   * region stays reserved for a completed PushResponse, which a rejected call
   * never produces.
   */
  const handlePush = async (): Promise<void> => {
    if (pending.length === 0) return;

    pushing = true;
    syncPushButton();
    try {
      let entries: Entry[];
      try {
        // Scoped to the period, not just today: `due` below drives which days
        // get pushed, so a check that only ever saw today would silently push
        // nothing beyond it on any period wider than a day.
        ({ entries } = await listEntries(currentPeriod.range));
      } catch {
        showPushError("Could not check what's pending — press Push worklogs to retry.");
        return;
      }

      const due = entries.filter(isPending);
      if (due.length === 0) {
        // Nothing schedules a repaint on this path — refresh() runs at boot, on
        // the pre-paint retry timer and on an entries announcement, none of
        // which fires here — so without this the rail keeps offering "N entries
        // to push" on a button that does nothing, indefinitely.
        pending = due;
        paintUnpushed();
        syncPushButton();

        return;
      }

      // One request per day, in order. `day` comes off the entries the server
      // stamped, so the rail still derives no date of its own. Sequential rather
      // than concurrent: the merged report has to be attributable and stably
      // ordered, and a bad week should not fan a week of requests at Jira at once.
      const days = [...new Set(due.map((entry) => entry.day))].sort();

      const { confirmDestructive } = await import("./components/that-confirm");
      const seconds = due.reduce((sum, entry) => sum + entry.seconds, 0);
      const label = `${String(due.length)} ${due.length === 1 ? "entry" : "entries"}`;
      const sites = new Set(due.map((entry) => entry.instanceId)).size;
      const across = days.length === 1 ? "" : ` across ${String(days.length)} days`;
      const confirmed = await confirmDestructive({
        heading: currentPeriod.pushHeading,
        body:
          `${label} totalling ${totalFigure(seconds)}${across} will be sent to ` +
          `${String(sites)} ${sites === 1 ? "site" : "sites"}.`,
        confirmLabel: "Push",
      });
      if (!confirmed) return;

      // Before pushing, not after: the per-entry report needs Today on screen
      // to land on, and the push itself is what the confirmation just agreed to.
      // Awaited, because mounting Today goes through a dynamic import() and its
      // onPushReported subscription only exists on the far side of it — an
      // announcement fired during that gap is heard by nobody, and a partial
      // failure answers 200, so nothing else would report it either.
      if (window.location.pathname !== currentPeriod.viewPath) {
        await navigate(currentPeriod.viewPath);
      }

      // Each day is its own request against state the server tracks
      // independently, so one day failing says nothing about the next — unlike
      // a single confirmation covering days that turn out not to share a fate,
      // stopping early would cost every later day its chance for no reason tied
      // to it. Continue rather than break, and report whatever came back;
      // a day that never answered keeps worklog_id null, so the next read
      // still shows it as unpushed and Push can simply be pressed again.
      const responses: PushResponse[] = [];
      const unanswered: string[] = [];
      for (const day of days) {
        try {
          responses.push(await pushDay(day));
        } catch {
          // Kept rather than swallowed: a day that threw contributes no result
          // to either count, so a report told only about the responses would
          // find no failures and call a half-finished push a success.
          unanswered.push(day);
        }
      }
      if (responses.length === 0) {
        showPushError("Push failed — press Push worklogs to retry.");
        return;
      }

      announcePushReported(responses, unanswered);

      try {
        const { entries } = await listEntries(currentPeriod.range);
        announceEntriesChanged(entries);
      } catch {
        // The push itself already succeeded and is reported above; a failed
        // re-read here only means the rail's own total is stale until the
        // next one, not that the push failed.
      }
    } finally {
      pushing = false;
      syncPushButton();
    }
  };

  push.addEventListener("click", () => {
    void handlePush();
  });
}

/** One instance's share of the day. */
interface Slice {
  name: string;
  position: number;
  seconds: number;
}

/**
 * Ordered by instance position — the created_at order the hue ramp is keyed off
 * — so the bar's segments and the figures below it stay in the same order as
 * each other and as the dots everywhere else in the app.
 */
function sliceByInstance(entries: Entry[]): Slice[] {
  const slices = new Map<number, Slice>();

  for (const entry of entries) {
    const slice = slices.get(entry.instanceId);
    if (slice) {
      slice.seconds += entry.seconds;
      continue;
    }
    slices.set(entry.instanceId, {
      name: entry.instanceName,
      position: entry.instancePosition,
      seconds: entry.seconds,
    });
  }

  return [...slices.values()].sort((a, b) => a.position - b.position);
}

function drawSplit(split: HTMLElement, slices: Slice[]): void {
  // Nothing logged means no bar at all rather than a bar of zero width, and the
  // line that says so stays until there is something to divide.
  if (slices.length === 0) {
    split.replaceChildren(restingLine());

    return;
  }

  split.replaceChildren(bar(slices), figures(slices));
}

function restingLine(): HTMLElement {
  const line = document.createElement("span");
  line.className = "text-rail-muted text-base";
  line.textContent = "Nothing to split yet";

  return line;
}

/**
 * Hidden from assistive technology on purpose: every figure it encodes is
 * written out immediately below it, and announcing the proportions twice tells
 * a screen reader reader nothing the second time.
 */
function bar(slices: Slice[]): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "that-split-bar flex h-1.5 gap-[3px] mt-1";
  wrapper.setAttribute("aria-hidden", "true");

  for (const slice of slices) {
    const segment = document.createElement("span");
    // flex-grow proportional to the seconds themselves, so the bar divides the
    // day exactly as the figures do without a percentage being computed here.
    segment.style.flex = String(slice.seconds);
    segment.style.setProperty("--h", String(instanceHue(slice.position)));
    wrapper.append(segment);
  }

  return wrapper;
}

function figures(slices: Slice[]): HTMLElement {
  const list = document.createElement("div");
  list.className = "flex flex-col gap-2";

  for (const slice of slices) {
    const row = document.createElement("div");
    row.className = "flex items-center gap-[9px] text-base";

    const dot = document.createElement("span");
    dot.className = "that-dot";
    dot.style.setProperty("--h", String(instanceHue(slice.position)));
    // No role="img" or label here, unlike paintInstanceDot: the name this dot
    // would announce is the very next element, and repeating it would have a
    // screen reader say every instance twice.
    dot.setAttribute("aria-hidden", "true");

    const name = document.createElement("span");
    name.className = "text-rail-muted min-w-0 flex-1 truncate";
    name.textContent = slice.name;

    const figure = document.createElement("span");
    figure.className = "that-tnum text-rail-ink font-mono font-bold";
    figure.textContent = totalFigure(slice.seconds);

    row.append(dot, name, figure);
    list.append(row);
  }

  return list;
}

/** #rail-timer's resting state — index.html's own hardcoded markup, rebuilt
 *  here so paintTimer has one shape to return to. */
function restingTimerLine(): Node[] {
  const dot = document.createElement("span");
  dot.className = "bg-rail-active size-[7px] shrink-0 rounded-full";

  const label = document.createElement("span");
  label.className = "text-rail-muted text-base";
  label.textContent = "No timer running";

  return [dot, label];
}

/** dot · KEY · elapsed · stop — decision 4 of the timer design, reachable
 *  from every view so a timer can be stopped without returning to Today. */
function runningTimerLine(
  running: RunningTimer,
  onStop: () => void,
): { nodes: Node[]; elapsed: HTMLElement } {
  const dot = document.createElement("span");
  dot.className = "bg-running-rail size-[7px] shrink-0 rounded-full";

  const key = document.createElement("span");
  key.className = "text-rail-ink text-base min-w-0 flex-1 truncate";
  key.textContent = running.issueKey;

  const elapsed = document.createElement("span");
  elapsed.className = "that-tnum text-running-rail shrink-0 font-mono text-base";
  elapsed.textContent = elapsedFigure(elapsedSeconds());

  const stop = document.createElement("button");
  stop.type = "button";
  stop.className =
    "text-running-rail hover:bg-hover-rail flex h-[26px] w-[26px] shrink-0 cursor-pointer " +
    "items-center justify-center rounded-sm";
  stop.innerHTML = iconMarkup("stop", 16);
  stop.setAttribute("aria-label", "stop timer");
  stop.addEventListener("click", onStop);

  return { nodes: [dot, key, elapsed, stop], elapsed };
}
