import "../components/that-alert";
import "../components/that-button";
import "../components/that-card";
import "../components/that-combobox";
import "../components/that-table";
import "../components/that-ticket-row";
import { alignKeyColumn } from "../key-column";

import {
  ApiError,
  createPin,
  deletePin,
  listEntries,
  listIssues,
  listPins,
  searchIssues,
} from "../api";
import type { ThatCombobox } from "../components/that-combobox";
import type { EntryTicket } from "../components/that-entry-dialog";
import { openEntryDialog } from "../components/that-entry-dialog";
import type { ThatTable } from "../components/that-table";
import { LOG_TIME, PIN, UNPIN } from "../components/that-ticket-row";
import { onEntriesChanged } from "../entries-changed";
import { clockTime, totalFigure } from "../format";
import type { IconName } from "../icons";
import { iconMarkup } from "../icons";
import { paintInstanceDot } from "../instance-hue";
import { pushReportNodes } from "../push-report";
import { onPushReported } from "../push-reported";
import { setRailPeriod, TODAY_PERIOD } from "../rail";
import type { RegisterTeardown } from "../router";
import type { Entry, InstanceIssues, IssueHit, IssuesResponse, Pin } from "../types";

/**
 * The regions that outlive a fetch, plus the two caches (pins, the last issues
 * response) needed to re-render them without a new request. All of it is
 * threaded through this object rather than held at module scope: router.ts
 * reuses one persistent mount point and has no navigation cancellation, so
 * module state would let a stale fetch write into a live view.
 */
interface Regions {
  pinnedSection: HTMLElement;
  pinnedList: HTMLElement;
  pinnedForm: HTMLElement;
  assignedSection: HTMLElement;
  header: HTMLElement;
  refresh: HTMLElement;
  results: HTMLElement;
  /** One banner above both lists, per the design spec's singular "the
   *  warning" — not one per list. See renderCombinedStale. */
  stale: HTMLElement;
  /** The result of the last push attempt: a success alert, a failure alert, or
   *  a failure alert plus the list of entries that did not make it. */
  pushReport: HTMLElement;
  pins: Pin[];
  lastIssues: IssuesResponse | null;
  pinsCachedAt: Date | null;
  issuesCachedAt: Date | null;
  /** Today's logged seconds per row, keyed by instance and issue. */
  totals: Map<string, number>;
  /** Bumped per totals refresh, so a slow read cannot overwrite a newer one. */
  totalsEpoch: number;
}

/** Named so each section can point its own label at its heading, and so the
 *  two ids cannot drift apart from the elements that carry them. */
const PINNED_HEADING_ID = "today-pinned";
const ASSIGNED_HEADING_ID = "today-assigned";

/** One id per icon button mounted, so each tooltip's `for` resolves its own. */
let iconButtonSequence = 0;

export async function render(root: HTMLElement, registerTeardown: RegisterTeardown): Promise<void> {
  setRailPeriod(TODAY_PERIOD);

  const container = document.createElement("div");
  container.className = "space-y-5";

  const stale = document.createElement("div");
  // Hidden while empty, not merely childless: the container's space-y-5 gives
  // every non-last child a bottom margin, so an empty box here would open the
  // view with 20px of dead space above the Pinned section. A display:none box
  // contributes none.
  stale.hidden = true;

  const pushReport = document.createElement("div");
  // Same reasoning as stale above: empty but present would still claim a
  // margin, this time the one holding it off the cards below.
  pushReport.className = "mb-2.5";
  pushReport.hidden = true;

  // Pinned and Assigned issues are two sections of one list, so Pinned is a
  // page heading level with the other rather than a card with a label inside
  // it — the prototype's two .pageh blocks, lines 318 and 320.
  const pinnedList = document.createElement("div");
  pinnedList.append(loadingLine());

  const pinnedForm = document.createElement("div");
  pinnedForm.className = "mt-3";

  const pinnedSection = document.createElement("section");
  pinnedSection.setAttribute("aria-labelledby", PINNED_HEADING_ID);
  pinnedSection.append(pageHeading("Pinned", PINNED_HEADING_ID), pinnedList, pinnedForm);

  const header = pageHeading("Assigned issues", ASSIGNED_HEADING_ID);
  const refresh = appendIconButton(header, "Refresh", "refresh", "refresh");

  // Hidden until the first response: there is nothing to refresh yet, and with
  // no instances configured it stays hidden for good.
  header.hidden = true;

  const results = document.createElement("div");
  // One card across, two from the point the content column can hold two
  // without taking it out of the summary. Never three: see the design's
  // layout decision 2. The breakpoint is a container query against the region
  // in index.html, not the window, so the rail costs the grid nothing.
  results.className = "grid grid-cols-1 gap-4 @min-[80rem]:grid-cols-2";
  results.append(loadingLine());

  const assignedSection = document.createElement("section");
  assignedSection.setAttribute("aria-labelledby", ASSIGNED_HEADING_ID);
  assignedSection.append(header, pushReport, results);

  container.append(stale, pinnedSection, assignedSection);
  root.append(container);

  const regions: Regions = {
    pinnedSection,
    pinnedList,
    pinnedForm,
    assignedSection,
    header,
    refresh,
    results,
    stale,
    pushReport,
    pins: [],
    lastIssues: null,
    pinsCachedAt: null,
    issuesCachedAt: null,
    totals: new Map(),
    totalsEpoch: 0,
  };
  refresh.addEventListener("click", () => {
    void refreshEverything(regions);
  });

  // navigator.onLine is not trustworthy (a captive portal reports "online"),
  // but the "online" event firing is still the right moment to try again —
  // the fetch itself, not the event, decides whether the stale banner clears.
  const handleOnline = (): void => {
    void refreshEverything(regions);
  };
  window.addEventListener("online", handleOnline);
  // Registered now, not after the fan-out below resolves: the router can
  // only unwire a listener it already knows about, and a navigation away
  // while refreshResults is still in flight must find this here.
  registerTeardown(() => {
    window.removeEventListener("online", handleOnline);
  });

  // Caught here rather than in the row, which knows its ticket but not where a
  // dialog should live. The host is the view root: Today re-renders its lists
  // wholesale, so a dialog nested in a row would be destroyed mid-edit.
  container.addEventListener(LOG_TIME, (event) => {
    const request = (event as CustomEvent<EntryTicket>).detail;
    openEntryDialog(root, request);
  });

  // Every row carries its own pin control now, in both sections, and the row
  // has already flipped its own mark by the time this runs — it knows its
  // ticket, and this knows where a pin is kept. A request that fails puts the
  // mark back rather than leaving the row claiming something the server never
  // agreed to.
  container.addEventListener(PIN, (event) => {
    void pinTicket(regions, (event as CustomEvent<EntryTicket>).detail);
  });
  container.addEventListener(UNPIN, (event) => {
    void unpinTicket(regions, (event as CustomEvent<EntryTicket>).detail);
  });

  // The listener is on document, which outlives this view. It used to retire
  // itself on the first wake-up that found the view detached, because the
  // router had no unsubscribe hook; this ticket added one, and it runs before
  // the next view mounts — so the detached wake-up cannot happen at all.
  const stopListening = onEntriesChanged((entries) => {
    void refreshTotals(regions, entries);
  });
  registerTeardown(stopListening);

  // The rail triggers the push; this only renders what it hears. Same
  // outlives-the-view reasoning as the subscription above, and the same
  // teardown so a navigation away cannot leave it painting a detached view.
  const stopPushListening = onPushReported((responses, unanswered) => {
    showPushReport(regions, ...pushReportNodes(responses, unanswered));
  });
  registerTeardown(stopPushListening);

  // Independent on purpose: the Pinned card paints from the store alone and
  // must not wait on a fan-out that may be slow or failing.
  void refreshPins(regions);
  void refreshTotals(regions);
  await refreshResults(regions);
}

/**
 * Repaints every row's duration cell from today's logged time — the list the
 * announcement carried when it carried one, a read of its own otherwise (the
 * mount, and the fallback for an announcer whose own read failed).
 *
 * The rows are found in the DOM rather than re-rendered: a re-render would
 * throw away the pin form mid-search and the assigned cards mid-scroll to
 * change one number on each row.
 *
 * A failure leaves the last known totals on screen. A row that cannot be told
 * what was logged should keep saying what it last knew rather than claim zero,
 * which is the one wrong answer that looks like a real one.
 */
async function refreshTotals(regions: Regions, fresh?: Entry[]): Promise<void> {
  const mine = ++regions.totalsEpoch;

  let entries = fresh;
  if (!entries) {
    try {
      entries = await listEntries();
    } catch {
      return;
    }
    if (mine !== regions.totalsEpoch) return;
  }

  regions.totals = new Map();
  for (const entry of entries) {
    const id = totalKey(entry.instanceId, entry.issueKey);
    regions.totals.set(id, (regions.totals.get(id) ?? 0) + entry.seconds);
  }

  paintTotals(regions);
}

function totalKey(instanceId: number, issueKey: string): string {
  return `${instanceId}:${issueKey}`;
}

/** Writes the totals onto whatever rows are on screen right now. */
function paintTotals(regions: Regions): void {
  for (const row of document.querySelectorAll("that-ticket-row")) {
    const instanceId = Number(row.getAttribute("instance-id") ?? "0");
    const issueKey = row.getAttribute("key") ?? "";
    row.setAttribute("seconds", String(regions.totals.get(totalKey(instanceId, issueKey)) ?? 0));
  }

  paintInstanceTallies();
}

/**
 * What each instance's card holds and what has gone against it today, beside
 * its name. Summed from the rows on screen rather than from the totals map:
 * the card shows the issues that survived the pin dedupe, and a figure counting
 * the ones it is not showing would not add up to what the reader can see.
 *
 * Called from paintTotals because the seconds it reads are what paintTotals
 * has just written.
 */
function paintInstanceTallies(): void {
  for (const tally of document.querySelectorAll<HTMLElement>("[data-instance-tally]")) {
    const section = tally.closest("section");
    if (!section) continue;

    const rows = section.querySelectorAll("that-ticket-row");
    let seconds = 0;
    for (const row of rows) {
      seconds += Number(row.getAttribute("seconds") ?? "0");
    }

    // A middot between two facts is typography, not an icon — the one place
    // the language says a typed character stays a typed character.
    tally.textContent = `${String(rows.length)} ${rows.length === 1 ? "issue" : "issues"} · ${totalFigure(seconds)}`;
  }
}

function currentPins(regions: Regions): Pin[] {
  return regions.pins;
}

async function refreshPins(regions: Regions, options?: { refresh?: boolean }): Promise<void> {
  try {
    const { value: pins, cachedAt } = await listPins(options);
    regions.pins = pins;
    regions.pinsCachedAt = cachedAt;
    renderPinnedList(regions, regions.pins);
    // Gated: replacing pinnedForm's children here would tear down an
    // in-progress search the moment Refresh's shared call reaches this branch
    // — the same class of bug #29 paid to fix in Settings.
    restorePinOpenerUnlessFormOpen(regions);
  } catch (error) {
    regions.pins = [];
    regions.pinsCachedAt = null;
    regions.pinnedList.replaceChildren(alertFor("error", messageOf(error)));
    // Same gate as the success branch above: a failing refresh must not wipe
    // an open form either. Unlike the success branch, a closed form stays
    // closed rather than gaining a "Pin an issue" button — with the current
    // pin list unknown, offering to pin is not a promise this can keep.
    if (!formIsOpen(regions)) {
      regions.pinnedForm.replaceChildren();
    }
  }

  renderCombinedStale(regions);

  // The assigned cards may already be on screen from a fetch that finished
  // first; re-render them from the cached response so the dedupe reflects the
  // pins that just arrived, without asking the server again.
  if (regions.lastIssues) {
    renderResponse(regions, regions.lastIssues);
  }

  // A pin form may already be open (e.g. this refresh followed a successful
  // pin); its combobox must learn about the newly current pins rather than
  // keep offering one that is now a duplicate.
  const combobox = regions.pinnedForm.querySelector("that-combobox") as ThatCombobox | null;
  combobox?.setDisabledKeys(pinnedKeysOf(regions));
}

function renderPinnedList(regions: Regions, pins: Pin[]): void {
  if (pins.length === 0) {
    const empty = document.createElement("p");
    empty.className = "text-sm text-ink-muted";
    empty.textContent = "Nothing pinned.";
    regions.pinnedList.replaceChildren(cardHolding(empty));

    return;
  }

  const table = document.createElement("that-table") as ThatTable;
  for (const pin of pins) {
    table.body.append(pinnedRow(pin));
  }
  regions.pinnedList.replaceChildren(table);

  // No alignKeyColumn here. Pinned is a cross-instance table whose key cell
  // carries a dot the per-instance cells do not, and the design has it
  // deliberately not aligned to them — so it neither takes the shared column
  // nor widens it. It keeps the 76px floor and its own content's width.
  //
  // Rows are built without a total and given one here, from what was last read.
  // Rendering is not the only thing that reaches this list — a pin, an unpin
  // and a Refresh all rebuild it — and every one of them would otherwise put
  // 0:00 back on a ticket with time against it.
  paintTotals(regions);
}

function pinnedRow(pin: Pin): HTMLElement {
  const row = document.createElement("that-ticket-row");
  row.setAttribute("key", pin.key);
  row.setAttribute("summary", pin.summary);
  row.setAttribute("status", pin.status);
  row.setAttribute("url", pin.url);
  // The duration cell needs both: the id to log against, the name to head the
  // dialog. A pinned row draws a dot instead of a name, so the name is carried
  // here rather than read back off the row.
  row.setAttribute("instance-id", String(pin.instanceId));
  row.setAttribute("instance-name", pin.instanceName);
  // A dot, not a name: a pinned row is one the user already recognises, so its
  // hue alone carries identity — see the restyle decision recorded in
  // docs/superpowers/specs/2026-08-20-pinned-issues-design.md's "The row"
  // section. It sits inside the key cell, which is where Pinned differs from a
  // per-instance card: this table is cross-instance and its heading cannot say
  // which Jira a row came from.
  row.setAttribute("instance-position", String(pin.instancePosition));
  // What makes the row's own control read as unpin rather than pin, and the
  // whole reason the mark can be trusted: it is set from what the server
  // answered, never from what the control was last clicked to.
  row.setAttribute("pinned", "");

  // A failed refresh must never blank a row: summary and status above stay
  // exactly as they were cached, and this is the only thing that changes.
  if (pin.error) {
    row.setAttribute("error", pin.error.message);
  }

  return row;
}

/** Pins the ticket a row's own control just marked as pinned. */
async function pinTicket(regions: Regions, ticket: EntryTicket): Promise<void> {
  try {
    await createPin(ticket.instanceId, ticket.issueKey);
  } catch (error) {
    undoOptimisticMark(regions, error);

    return;
  }

  await refreshPins(regions);
}

/**
 * Unpinning destroys nothing worth confirming: time_entries rows are keyed by
 * (instance_id, issue_key) with no foreign key to pinned_issues, unlike #29's
 * instance removal whose cascade does. So there is no confirmation dialog —
 * the row marks itself the moment it is pressed, and this puts the mark back
 * if the request does not land.
 */
async function unpinTicket(regions: Regions, ticket: EntryTicket): Promise<void> {
  const pin = currentPins(regions).find(
    (candidate) =>
      candidate.instanceId === ticket.instanceId && candidate.key === ticket.issueKey,
  );
  // The row is showing a pin this view has no id for, which means the pins it
  // is drawn from have already moved on. Re-rendering from them is both the
  // repair and the whole of it.
  if (!pin) {
    renderPinnedList(regions, regions.pins);

    return;
  }

  try {
    await deletePin(pin.id);
  } catch (error) {
    undoOptimisticMark(regions, error);

    return;
  }

  await refreshPins(regions);
}

/**
 * Redraws both lists from what the server last said, so a row whose pin
 * control flipped optimistically stops claiming a change that never happened,
 * and names the failure above them. The alert is prepended after the redraw
 * because the redraw is what would otherwise wipe it.
 */
function undoOptimisticMark(regions: Regions, error: unknown): void {
  renderPinnedList(regions, regions.pins);
  if (regions.lastIssues) {
    renderResponse(regions, regions.lastIssues);
  }
  regions.pinnedList.prepend(alertFor("error", messageOf(error)));
}

/** True while the pin form (its combobox) is on screen — the condition both
 *  refreshPins branches must not disturb mid-typing. */
function formIsOpen(regions: Regions): boolean {
  return regions.pinnedForm.querySelector("that-combobox") !== null;
}

/** Called after every listPins(), including the shared Refresh's, so it must
 *  not disturb a form the user is still typing into. A deliberate close
 *  (Cancel, Escape, a completed pin) goes through renderPinOpener directly
 *  instead of this gate. */
function restorePinOpenerUnlessFormOpen(regions: Regions): void {
  if (formIsOpen(regions)) return;

  renderPinOpener(regions);
}

function renderPinOpener(regions: Regions): void {
  const open = button("Pin an issue", "secondary");
  open.addEventListener("click", () => {
    showPinForm(regions);
  });
  regions.pinnedForm.className = "mt-3 border-t border-edge pt-3";
  regions.pinnedForm.replaceChildren(open);
}

function showPinForm(regions: Regions): void {
  const combobox = document.createElement("that-combobox") as ThatCombobox;
  combobox.setAttribute("label", "Find an issue");
  combobox.setAttribute("placeholder", "Search by key or title");

  const alertSlot = document.createElement("div");
  const actions = document.createElement("div");
  actions.className = "flex gap-2";
  const cancel = button("Cancel", "secondary");
  actions.append(cancel);

  regions.pinnedForm.className = "mt-3 space-y-3 border-t border-edge pt-3";
  regions.pinnedForm.replaceChildren(combobox, alertSlot, actions);

  // Set after insertion: connectedCallback builds the input, so there is nothing
  // to focus before it runs.
  combobox.focusInput();
  combobox.setDisabledKeys(pinnedKeysOf(regions));

  // One controller per form, replaced on each keystroke pause. Without this a
  // slow first search can land after a fast second one and paint over it.
  let inFlight: AbortController | undefined;

  combobox.addEventListener("that-search", (event) => {
    const query = (event as CustomEvent<string>).detail;
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;

    void searchIssues(query, controller.signal)
      .then((response) => {
        combobox.setResults(response.results, response.errors);
      })
      .catch((error: unknown) => {
        // An abort is this code's own doing, not a failure to report.
        if (error instanceof DOMException && error.name === "AbortError") return;
        combobox.setResults([], []);
        alertSlot.replaceChildren(alertFor("error", messageOf(error)));
      });
  });

  combobox.addEventListener("that-select", (event) => {
    const hit = (event as CustomEvent<IssueHit>).detail;
    inFlight?.abort();
    alertSlot.replaceChildren();
    combobox.setBusy(true);

    void createPin(hit.instanceId, hit.key)
      .then(async () => {
        renderPinOpener(regions);
        await refreshPins(regions);
      })
      .catch((error: unknown) => {
        combobox.setBusy(false);
        alertSlot.replaceChildren(alertFor("error", messageOf(error)));
      });
  });

  combobox.addEventListener("that-cancel", () => {
    inFlight?.abort();
    renderPinOpener(regions);
  });

  cancel.addEventListener("click", () => {
    inFlight?.abort();
    renderPinOpener(regions);
  });
}

/** The keys the combobox must refuse, so a duplicate is visible rather than a
 *  rejection the user only meets after choosing. */
function pinnedKeysOf(regions: Regions): Set<string> {
  return new Set(currentPins(regions).map((pin) => `${pin.instanceId}:${pin.key}`));
}

/** Disabling and re-enabling regions.refresh is refreshEverything's job, not
 *  this function's: the initial mount calls this alone, while the button is
 *  still hidden, and the shared Refresh must stay disabled until the pins
 *  call settles too. */
async function refreshResults(regions: Regions): Promise<void> {
  try {
    // The cards already on screen stay put while this is in flight: a list that
    // blinks out and back is indistinguishable from one that broke.
    const { value: response, cachedAt } = await listIssues();
    regions.lastIssues = response;
    regions.issuesCachedAt = cachedAt;
    renderResponse(regions, response);
  } catch (error) {
    regions.header.hidden = false;
    regions.issuesCachedAt = null;
    regions.results.replaceChildren(alertFor("error", messageOf(error)));
  }

  renderCombinedStale(regions);
}

/**
 * The one warning both lists share (Ruling 11: the design spec's acceptance
 * line names a single "the warning" above both, not one per list — and the
 * two would fail together in practice anyway, since they hit the same
 * server). Visible when either list is stale, naming the older of the two
 * moments — never a shorter outage than the data on screen has actually
 * been sitting for.
 *
 * `cachedAt` is set exactly when the worker served that response from cache
 * (task 6's `Cached<T>`) — that is the whole freshness signal, not
 * `navigator.onLine`. Both fields settling to `null` (a live fetch for each)
 * is what lets this clear itself with no manual reload.
 */
function renderCombinedStale(regions: Regions): void {
  const moments = [regions.pinsCachedAt, regions.issuesCachedAt].filter(
    (moment): moment is Date => moment !== null,
  );

  if (moments.length === 0) {
    regions.stale.replaceChildren();
    regions.stale.hidden = true;
    return;
  }

  const oldest = moments.reduce((older, moment) =>
    moment.getTime() < older.getTime() ? moment : older,
  );
  regions.stale.replaceChildren(
    alertFor(
      "warning",
      `Showing what was here at ${clockTime(oldest)} — no connection to the server.`,
    ),
  );
  regions.stale.hidden = false;
}

async function refreshEverything(regions: Regions): Promise<void> {
  regions.refresh.setAttribute("disabled", "");
  try {
    // Settled rather than all: a failing pins refresh must not stop the assigned
    // cards updating, and each already renders its own failure.
    await Promise.allSettled([refreshResults(regions), refreshPins(regions, { refresh: true })]);
  } finally {
    regions.refresh.removeAttribute("disabled");
  }
}

/** Replaces pushReport's content and reveals it — the one place both steps
 *  happen, since every push outcome (a read failure, "already pushed", a
 *  push failure, a push result) needs both. */
function showPushReport(regions: Regions, ...nodes: Node[]): void {
  regions.pushReport.replaceChildren(...nodes);
  regions.pushReport.hidden = false;
}

function renderResponse(regions: Regions, response: IssuesResponse): void {
  if (response.instances.length === 0) {
    // No instances means no pins either — the cascade took them with the last
    // instance — so a Pinned section would be a control with nothing to do.
    regions.pinnedSection.remove();
    regions.header.hidden = true;
    regions.results.replaceChildren(noInstances());

    return;
  }

  if (!regions.pinnedSection.isConnected) {
    regions.assignedSection.before(regions.pinnedSection);
  }

  regions.header.hidden = false;
  regions.results.replaceChildren(
    // The index is the instance's position in created_at order, which is what
    // the hue ramp is keyed off: the store lists instances in that order and
    // the fan-out preserves it. /api/issues carries no position of its own,
    // unlike a pin or a search hit.
    ...response.instances.map((group, position) => instanceSection(group, position, regions.pins)),
  );

  // The results grid, not the whole view: one shared key column across the
  // instance cards, which is what makes them agree with each other, and the
  // property lands on the one element that holds all of them and nothing else.
  // After insertion, not before — an element outside the document has no
  // layout, so every key in it would measure zero.
  alignKeyColumn(regions.results);

  paintTotals(regions);
}

/**
 * One instance: its name and hue above, its issues in a card below. The
 * heading is a sibling of the card rather than something inside it — the
 * prototype's .grouph, line 335 — which is what lets the card be nothing but
 * the table every other card has to line up with.
 */
function instanceSection(group: InstanceIssues, position: number, pins: Pin[]): HTMLElement {
  const section = document.createElement("section");
  const headingId = `today-instance-${String(group.id)}`;
  section.setAttribute("aria-labelledby", headingId);

  const heading = instanceHeading(group.name, position, headingId);
  section.append(heading);

  if (group.error) {
    section.append(cardHolding(alertFor("error", group.error.message)));

    return section;
  }

  const pinnedKeys = new Set(pins.map((pin) => `${pin.instanceId}:${pin.key}`));
  const visible = group.issues.filter((issue) => !pinnedKeys.has(`${group.id}:${issue.key}`));

  if (visible.length === 0) {
    const empty = document.createElement("p");
    empty.className = "text-sm text-ink-muted";
    // These are two different truths: an instance with nothing assigned, and
    // one whose only assigned issues are all pinned above and so filtered out
    // of this list. Saying "assigned" for the latter would be false, not terse.
    empty.textContent =
      group.issues.length === 0 ? "No issues assigned." : "All assigned issues are pinned above.";
    section.append(cardHolding(empty));

    return section;
  }

  // Filled by paintTotals, which is the only thing that knows what was logged
  // today. Added only where there are rows to count: "0 issues" beside a card
  // that already says why it is empty is a second answer to a settled question.
  const tally = document.createElement("span");
  tally.dataset["instanceTally"] = "";
  tally.className = "ml-auto font-normal tracking-normal normal-case";
  heading.append(tally);

  const table = document.createElement("that-table") as ThatTable;
  for (const issue of visible) {
    const row = document.createElement("that-ticket-row");
    row.setAttribute("key", issue.key);
    row.setAttribute("summary", issue.summary);
    row.setAttribute("status", issue.status);
    row.setAttribute("url", issue.url);
    row.setAttribute("instance-id", String(group.id));
    row.setAttribute("instance-name", group.name);
    table.body.append(row);
  }
  section.append(table);

  return section;
}

/** The instance's dot and name over its card — the prototype's .grouph. */
function instanceHeading(name: string, position: number, headingId: string): HTMLElement {
  const head = document.createElement("div");
  head.className =
    "text-ink-muted mx-0.5 mb-1.5 flex items-center gap-[9px] text-xs font-bold " +
    "tracking-[0.16em] uppercase";

  const dot = document.createElement("span");
  paintInstanceDot(dot, position, name);

  // The heading names the instance and nothing else: the dot beside it repeats
  // that name for a reader who cannot see the hue, and a tally that changes
  // through the day has no business in the name of a section.
  const title = document.createElement("h3");
  title.id = headingId;
  title.textContent = name;

  head.append(dot, title);

  return head;
}

function loadingLine(): HTMLElement {
  const line = document.createElement("p");
  line.className = "text-sm text-ink-muted";
  line.textContent = "Loading…";

  return line;
}

function noInstances(): HTMLElement {
  const wrapper = document.createElement("div");

  const paragraph = document.createElement("p");
  paragraph.className = "text-ink-muted";
  paragraph.textContent = "No Jira instances yet. Add one to see your assigned issues.";

  const link = document.createElement("a");
  link.href = "/settings";
  link.dataset["route"] = "";
  link.className = "text-primary mt-4 inline-block font-bold hover:underline";
  link.textContent = "Open Settings";

  wrapper.append(paragraph, link);

  return wrapper;
}

// button, alertFor and messageOf are deliberate duplicates of the same three
// helpers in views/settings.ts. Extracting them into a shared module is the
// right end state, but it means editing settings.ts, which is outside this
// ticket's scope. Worth its own ticket.

/**
 * A section's heading and the controls that belong beside it — the prototype's
 * .pageh, line 318. Pinned and Assigned issues wear the same one: they are two
 * sections of one list, not a card and a list.
 */
function pageHeading(text: string, headingId: string): HTMLElement {
  const box = document.createElement("div");
  box.className = "mb-2.5 flex items-center gap-2";

  const heading = document.createElement("h2");
  heading.id = headingId;
  heading.className = "text-lg font-medium";
  heading.textContent = text;
  box.append(heading);

  return box;
}

/**
 * A control that is only a drawn mark, and the tooltip saying in words what
 * the mark means. The label is the button's own — a tooltip reaches neither a
 * keyboard nor a screen reader, so it is never the accessible name.
 */
function appendIconButton(host: HTMLElement, label: string, icon: IconName, tip: string): HTMLElement {
  const control = document.createElement("button");
  control.type = "button";
  control.id = `today-icon-${String(++iconButtonSequence)}`;
  control.setAttribute("aria-label", label);
  control.className =
    "hover:bg-hover focus-visible:bg-hover text-ink-muted hover:text-ink " +
    "focus-visible:text-ink flex h-[34px] w-[34px] shrink-0 cursor-pointer items-center " +
    "justify-center rounded-sm disabled:cursor-not-allowed disabled:opacity-50";
  control.innerHTML = iconMarkup(icon, 17);

  const tooltip = document.createElement("that-tooltip");
  tooltip.setAttribute("for", control.id);
  tooltip.textContent = tip;

  host.append(control, tooltip);

  return control;
}

/** The raised surface a message sits on where a table would otherwise be. */
function cardHolding(node: Node): HTMLElement {
  const card = document.createElement("that-card");
  card.append(node);

  return card;
}

function button(label: string, variant: string): HTMLElement {
  const element = document.createElement("that-button");
  // label is the sole source of the inner button's accessible name; without it
  // role-based queries cannot find the button at all.
  element.setAttribute("label", label);
  element.setAttribute("variant", variant);

  return element;
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
