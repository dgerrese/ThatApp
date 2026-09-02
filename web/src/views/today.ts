import "../components/that-alert";
import "../components/that-button";
import "../components/that-card";
import "../components/that-combobox";
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
import { LOG_TIME } from "../components/that-ticket-row";
import { onEntriesChanged } from "../entries-changed";
import { clockTime } from "../format";
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
  pinnedCard: HTMLElement;
  pinnedList: HTMLElement;
  pinnedForm: HTMLElement;
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

export async function render(root: HTMLElement, registerTeardown: RegisterTeardown): Promise<void> {
  setRailPeriod(TODAY_PERIOD);

  const container = document.createElement("div");
  container.className = "space-y-4";

  const stale = document.createElement("div");
  // Hidden while empty, not merely childless: the container's space-y-4 gives
  // every non-last child a bottom margin, so an empty box here would open the
  // view with 16px of dead space above the Pinned card. A display:none box
  // contributes none.
  stale.hidden = true;

  const pushReport = document.createElement("div");
  // Same reasoning as stale above: empty but present would still claim a
  // space-y-4 margin.
  pushReport.hidden = true;

  const pinnedCard = document.createElement("that-card");
  pinnedCard.setAttribute("heading", "Pinned");

  const pinnedList = document.createElement("div");
  pinnedList.append(loadingLine());

  const pinnedForm = document.createElement("div");
  pinnedForm.className = "mt-3";

  pinnedCard.append(pinnedList, pinnedForm);

  const header = document.createElement("div");
  header.className = "flex items-baseline justify-between";

  const heading = document.createElement("h2");
  heading.className = "text-lg font-medium";
  heading.textContent = "Assigned issues";

  const refresh = button("Refresh", "secondary");
  header.append(heading, refresh);

  // Hidden until the first response: there is nothing to refresh yet, and with
  // no instances configured it stays hidden for good.
  header.hidden = true;

  const results = document.createElement("div");
  results.className = "space-y-4";
  results.append(loadingLine());

  container.append(stale, pinnedCard, header, pushReport, results);
  root.append(container);

  const regions: Regions = {
    pinnedCard,
    pinnedList,
    pinnedForm,
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
    regions.pinnedList.replaceChildren(empty);

    return;
  }

  const list = document.createElement("ul");
  list.className = "divide-y divide-edge";
  list.append(...pins.map((pin) => pinRow(pin, (row) => unpin(regions, pin, row))));
  regions.pinnedList.replaceChildren(list);

  alignKeyColumn(list);
  // Rows are built without a total and given one here, from what was last read.
  // Rendering is not the only thing that reaches this list — a pin, an unpin
  // and a Refresh all rebuild it — and every one of them would otherwise put
  // 0:00 back on a ticket with time against it.
  paintTotals(regions);
}

function pinRow(pin: Pin, onUnpin: (row: HTMLElement) => void): HTMLElement {
  const item = document.createElement("li");
  item.className = "flex items-baseline gap-3";

  // A dot, not a name: a pinned row is one the user already recognises, so its
  // hue alone carries identity — see the restyle decision recorded in
  // docs/superpowers/specs/2026-08-20-pinned-issues-design.md's "The row" section.
  const dot = document.createElement("span");
  paintInstanceDot(dot, pin.instancePosition, pin.instanceName);

  // that-ticket-row sets its own className in connectedCallback, so a utility
  // applied from outside would be discarded; the wrapper carries flex-1.
  const wrapper = document.createElement("div");
  wrapper.className = "min-w-0 flex-1";
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
  wrapper.append(row);

  item.append(dot, wrapper);

  // A failed refresh must never blank a row: summary and status above stay
  // exactly as they were cached, and this is the only thing that changes.
  if (pin.error) {
    // text-failed, not a "danger" token: the palette's error colour is named
    // failed (see that-alert's TONES), and there is no --color-danger* in
    // styles.css. role="status", matching that-alert, so a screen reader
    // announces the failure the same way it does the assigned card's.
    const failure = document.createElement("span");
    failure.setAttribute("role", "status");
    failure.className = "shrink-0 text-xs text-failed";
    failure.textContent = pin.error.message;
    item.append(failure);
  }

  const control = button("Unpin", "secondary");
  control.addEventListener("click", () => {
    onUnpin(item);
  });
  item.append(control);

  return item;
}

/**
 * Unpinning destroys nothing worth confirming: time_entries rows are keyed by
 * (instance_id, issue_key) with no foreign key to pinned_issues, unlike #29's
 * instance removal whose cascade does. So there is no confirmation dialog —
 * only a disabled control while the request is in flight.
 */
function unpin(regions: Regions, pin: Pin, row: HTMLElement): void {
  const control = row.querySelector("that-button");
  control?.setAttribute("disabled", "");

  void deletePin(pin.id)
    .then(async () => {
      await refreshPins(regions);
    })
    .catch((error: unknown) => {
      control?.removeAttribute("disabled");
      regions.pinnedList.prepend(alertFor("error", messageOf(error)));
    });
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
    // instance — so a Pinned card would be a control with nothing to do.
    regions.pinnedCard.remove();
    regions.header.hidden = true;
    regions.results.replaceChildren(noInstances());

    return;
  }

  if (!regions.pinnedCard.isConnected) {
    regions.header.before(regions.pinnedCard);
  }

  regions.header.hidden = false;
  regions.results.replaceChildren(
    ...response.instances.map((group) => instanceCard(group, regions.pins)),
  );

  // After insertion, not before: a list outside the document has no layout, so
  // every key in it would measure zero.
  for (const list of regions.results.querySelectorAll<HTMLElement>("ul")) {
    alignKeyColumn(list);
  }

  paintTotals(regions);
}

function instanceCard(group: InstanceIssues, pins: Pin[]): HTMLElement {
  const card = document.createElement("that-card");
  // that-card has no observedAttributes, so the heading must be set before the
  // element is inserted; changing it afterwards silently does nothing.
  card.setAttribute("heading", group.name);

  if (group.error) {
    card.append(alertFor("error", group.error.message));

    return card;
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
    card.append(empty);

    return card;
  }

  const list = document.createElement("ul");
  list.className = "divide-y divide-edge";
  for (const issue of visible) {
    const item = document.createElement("li");
    const row = document.createElement("that-ticket-row");
    row.setAttribute("key", issue.key);
    row.setAttribute("summary", issue.summary);
    row.setAttribute("status", issue.status);
    row.setAttribute("url", issue.url);
    row.setAttribute("instance-id", String(group.id));
    row.setAttribute("instance-name", group.name);
    item.append(row);
    list.append(item);
  }
  card.append(list);

  return card;
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
