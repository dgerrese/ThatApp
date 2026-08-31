import { listEntries, pushDay } from "./api";
import { announceEntriesChanged, onEntriesChanged } from "./entries-changed";
import { totalFigure } from "./format";
import { instanceHue } from "./instance-hue";
import { announcePushReported } from "./push-reported";
import { navigate } from "./router";
import type { Entry, PushResponse } from "./types";

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
 * resolved in WD_TIMEZONE, which is the only way the total agrees with the
 * end-of-day push when no browser is open to ask.
 */
// The first retry after a failed boot read, doubling up to the cap. Short to
// start with because the likely cause — the container still coming up — clears
// in seconds.
const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

export function startRail(): void {
  const total = document.querySelector<HTMLElement>("#rail-total");
  const split = document.querySelector<HTMLElement>("#rail-split");
  const unpushed = document.querySelector<HTMLElement>("#rail-unpushed");
  const push = document.querySelector<HTMLButtonElement>("#rail-push");
  if (!total || !split || !unpushed || !push) return;

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

  /**
   * Owns #rail-unpushed's resting text and colour. A failure inside
   * handlePush writes its own message directly to the element instead — see
   * showPushError — so this must never run between that write and the repaint
   * that is meant to supersede it.
   */
  const paintUnpushed = (): void => {
    unpushed.classList.remove("text-failed-rail");
    unpushed.classList.add("text-rail-muted");
    unpushed.textContent =
      pending.length === 0
        ? "Nothing to push"
        : `${String(pending.length)} ${pending.length === 1 ? "entry" : "entries"} to push`;
  };

  const showPushError = (message: string): void => {
    unpushed.classList.remove("text-rail-muted");
    unpushed.classList.add("text-failed-rail");
    unpushed.textContent = message;
  };

  const paint = (entries: Entry[]): void => {
    painted = true;
    retryDelay = FIRST_RETRY_MS;
    total.textContent = totalFigure(entries.reduce((sum, entry) => sum + entry.seconds, 0));
    drawSplit(split, sliceByInstance(entries));
    pending = entries.filter((entry) => entry.pushState === "unpushed");
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
   */
  const refresh = async (): Promise<void> => {
    const mine = ++epoch;
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }

    let entries: Entry[];
    try {
      entries = await listEntries();
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
    if (entries) {
      // The announcement carried the day, so there is nothing to fetch — and
      // the epoch moves so any read still in flight cannot overwrite this.
      epoch += 1;
      paint(entries);

      return;
    }
    void refresh();
  });
  void refresh();

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
        entries = await listEntries();
      } catch {
        showPushError("Could not check what's pending — press Push to Jira to retry.");
        return;
      }

      const due = entries.filter((entry) => entry.pushState === "unpushed");
      if (due.length === 0) return;

      const { confirmDestructive } = await import("./components/wd-confirm");
      const seconds = due.reduce((sum, entry) => sum + entry.seconds, 0);
      const label = `${String(due.length)} ${due.length === 1 ? "entry" : "entries"}`;
      const sites = new Set(due.map((entry) => entry.instanceId)).size;
      const confirmed = await confirmDestructive({
        heading: "Push today's time to Jira?",
        body:
          `${label} totalling ${totalFigure(seconds)} will be created as worklogs on ` +
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
      if (window.location.pathname !== "/today") {
        await navigate("/today");
      }

      let response: PushResponse;
      try {
        response = await pushDay();
      } catch {
        showPushError("Push failed — press Push to Jira to retry.");
        return;
      }

      announcePushReported(response);

      try {
        announceEntriesChanged(await listEntries());
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
  wrapper.className = "wd-split-bar flex h-[7px] gap-[3px]";
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
  list.className = "flex flex-col gap-[7px]";

  for (const slice of slices) {
    const row = document.createElement("div");
    row.className = "flex items-center gap-[9px] text-base";

    const dot = document.createElement("span");
    dot.className = "wd-dot";
    dot.style.setProperty("--h", String(instanceHue(slice.position)));
    // No role="img" or label here, unlike paintInstanceDot: the name this dot
    // would announce is the very next element, and repeating it would have a
    // screen reader say every instance twice.
    dot.setAttribute("aria-hidden", "true");

    const name = document.createElement("span");
    name.className = "min-w-0 flex-1 truncate";
    name.textContent = slice.name;

    const figure = document.createElement("span");
    figure.className = "wd-tnum font-bold";
    figure.textContent = totalFigure(slice.seconds);

    row.append(dot, name, figure);
    list.append(row);
  }

  return list;
}
