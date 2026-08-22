import { listEntries } from "./api";
import { onEntriesChanged } from "./entries-changed";
import { totalFigure } from "./format";
import { instanceHue } from "./instance-hue";
import type { Entry } from "./types";

/**
 * The rail's two live regions: the day's total, and the split of it across
 * instances.
 *
 * It lives in the shell rather than in Today, and that is the whole point. The
 * rail is the instrument — the same figure in the same place whatever view you
 * are on — so it has to stay right on Settings, and on #11's Week view, without
 * either of them knowing it exists.
 *
 * It never computes a date. It sums rows the server already stamped with a day
 * resolved in WD_TIMEZONE, which is the only way the total agrees with the
 * end-of-day push when no browser is open to ask.
 */
export function startRail(): void {
  const total = document.querySelector<HTMLElement>("#rail-total");
  const split = document.querySelector<HTMLElement>("#rail-split");
  if (!total || !split) return;

  const redraw = (): void => {
    void refresh(total, split);
  };

  // No unsubscribe: the shell outlives every view, so this listener is meant to
  // last as long as the page does.
  onEntriesChanged(redraw);
  redraw();
}

/**
 * A failure leaves both regions exactly as they were. The rail is glanced at
 * rather than read, and a total that silently drops to zero because a request
 * failed is the one wrong answer indistinguishable from a true one.
 */
async function refresh(total: HTMLElement, split: HTMLElement): Promise<void> {
  let entries: Entry[];
  try {
    entries = await listEntries();
  } catch {
    return;
  }

  total.textContent = totalFigure(entries.reduce((sum, entry) => sum + entry.seconds, 0));
  drawSplit(split, sliceByInstance(entries));
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
