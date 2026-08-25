import "../components/wd-alert";
import "../components/wd-button";
import "../components/wd-card";
import "../components/wd-combobox";
import "../components/wd-ticket-row";
import { alignKeyColumn } from "../key-column";

import { ApiError, createPin, deletePin, listIssues, listPins, searchIssues } from "../api";
import type { WdCombobox } from "../components/wd-combobox";
import { paintInstanceDot } from "../instance-hue";
import type { InstanceIssues, IssueHit, IssuesResponse, Pin } from "../types";

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
  pins: Pin[];
  lastIssues: IssuesResponse | null;
}

export async function render(root: HTMLElement): Promise<void> {
  const container = document.createElement("div");
  container.className = "space-y-4";

  const pinnedCard = document.createElement("wd-card");
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

  container.append(pinnedCard, header, results);
  root.append(container);

  const regions: Regions = {
    pinnedCard,
    pinnedList,
    pinnedForm,
    header,
    refresh,
    results,
    pins: [],
    lastIssues: null,
  };
  refresh.addEventListener("click", () => {
    void refreshEverything(regions);
  });

  // Independent on purpose: the Pinned card paints from the store alone and
  // must not wait on a fan-out that may be slow or failing.
  void refreshPins(regions);
  await refreshResults(regions);
}

function currentPins(regions: Regions): Pin[] {
  return regions.pins;
}

async function refreshPins(regions: Regions, options?: { refresh?: boolean }): Promise<void> {
  try {
    regions.pins = (await listPins(options)).value;
    renderPinnedList(regions, regions.pins);
    // Gated: replacing pinnedForm's children here would tear down an
    // in-progress search the moment Refresh's shared call reaches this branch
    // — the same class of bug #29 paid to fix in Settings.
    restorePinOpenerUnlessFormOpen(regions);
  } catch (error) {
    regions.pins = [];
    regions.pinnedList.replaceChildren(alertFor("error", messageOf(error)));
    // Same gate as the success branch above: a failing refresh must not wipe
    // an open form either. Unlike the success branch, a closed form stays
    // closed rather than gaining a "Pin an issue" button — with the current
    // pin list unknown, offering to pin is not a promise this can keep.
    if (!formIsOpen(regions)) {
      regions.pinnedForm.replaceChildren();
    }
  }

  // The assigned cards may already be on screen from a fetch that finished
  // first; re-render them from the cached response so the dedupe reflects the
  // pins that just arrived, without asking the server again.
  if (regions.lastIssues) {
    renderResponse(regions, regions.lastIssues);
  }

  // A pin form may already be open (e.g. this refresh followed a successful
  // pin); its combobox must learn about the newly current pins rather than
  // keep offering one that is now a duplicate.
  const combobox = regions.pinnedForm.querySelector("wd-combobox") as WdCombobox | null;
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
}

function pinRow(pin: Pin, onUnpin: (row: HTMLElement) => void): HTMLElement {
  const item = document.createElement("li");
  item.className = "flex items-baseline gap-3";

  // A dot, not a name: a pinned row is one the user already recognises, so its
  // hue alone carries identity — see the restyle decision recorded in
  // docs/superpowers/specs/2026-08-20-pinned-issues-design.md's "The row" section.
  const dot = document.createElement("span");
  paintInstanceDot(dot, pin.instancePosition, pin.instanceName);

  // wd-ticket-row sets its own className in connectedCallback, so a utility
  // applied from outside would be discarded; the wrapper carries flex-1.
  const wrapper = document.createElement("div");
  wrapper.className = "min-w-0 flex-1";
  const row = document.createElement("wd-ticket-row");
  row.setAttribute("key", pin.key);
  row.setAttribute("summary", pin.summary);
  row.setAttribute("status", pin.status);
  row.setAttribute("url", pin.url);
  wrapper.append(row);

  item.append(dot, wrapper);

  // A failed refresh must never blank a row: summary and status above stay
  // exactly as they were cached, and this is the only thing that changes.
  if (pin.error) {
    // text-failed, not a "danger" token: the palette's error colour is named
    // failed (see wd-alert's TONES), and there is no --color-danger* in
    // styles.css. role="status", matching wd-alert, so a screen reader
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
  const control = row.querySelector("wd-button");
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
  return regions.pinnedForm.querySelector("wd-combobox") !== null;
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
  const combobox = document.createElement("wd-combobox") as WdCombobox;
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

  combobox.addEventListener("wd-search", (event) => {
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

  combobox.addEventListener("wd-select", (event) => {
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

  combobox.addEventListener("wd-cancel", () => {
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
    const { value: response } = await listIssues();
    regions.lastIssues = response;
    renderResponse(regions, response);
  } catch (error) {
    regions.header.hidden = false;
    regions.results.replaceChildren(alertFor("error", messageOf(error)));
  }
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
}

function instanceCard(group: InstanceIssues, pins: Pin[]): HTMLElement {
  const card = document.createElement("wd-card");
  // wd-card has no observedAttributes, so the heading must be set before the
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
    const row = document.createElement("wd-ticket-row");
    row.setAttribute("key", issue.key);
    row.setAttribute("summary", issue.summary);
    row.setAttribute("status", issue.status);
    row.setAttribute("url", issue.url);
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
  const element = document.createElement("wd-button");
  // label is the sole source of the inner button's accessible name; without it
  // role-based queries cannot find the button at all.
  element.setAttribute("label", label);
  element.setAttribute("variant", variant);

  return element;
}

function alertFor(tone: string, message: string): HTMLElement {
  const alert = document.createElement("wd-alert");
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
