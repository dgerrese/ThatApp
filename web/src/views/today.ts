import "../components/that-alert";
import "../components/that-button";
import "../components/that-card";
import "../components/that-issue-search";
import "../components/that-table";
import "../components/that-ticket-row";
import "../components/that-timer";
import { alignKeyColumn } from "../key-column";

import { alertFor, messageOf } from "../alert";
import { createPin, deletePin, listEntries, listIssues, listPins, searchIssues } from "../api";
import type { EntryTicket } from "../components/that-entry-dialog";
import { openEntryDialog } from "../components/that-entry-dialog";
import type { IssueSearchConfig, ThatIssueSearch } from "../components/that-issue-search";
import type { ThatTable } from "../components/that-table";
import { LOG_TIME, PIN, UNPIN } from "../components/that-ticket-row";
import { onEntriesChanged } from "../entries-changed";
import { clockTime, totalFigure } from "../format";
import { paintInstanceDot } from "../instance-hue";
import { pageHeading } from "../page-heading";
import { pushReportNodes } from "../push-report";
import { onPushReported } from "../push-reported";
import { setRailPeriod, TODAY_PERIOD } from "../rail";
import type { RegisterTeardown } from "../router";
import { onTimerDiscarded } from "../timer-state";
import { toolbarButton } from "../toolbar-button";
import type { Entry, InstanceIssues, IssueHit, IssuesResponse, Pin } from "../types";

/**
 * What an off-list row needs beyond what `Entry` already carries. Resolved
 * either from the search hit that created the entry (no request) or from
 * `GET /api/issues/search?q=<key>` on a cold load — see the design's
 * "Where the off-list row's summary comes from" subsection under decision 2.
 * `null` is a settled answer too: the lookup ran and found nothing, which
 * must not read as "still loading" forever after.
 */
interface OffListInfo {
  summary: string;
  status: string;
  url: string;
}

/**
 * The regions that outlive a fetch, plus the two caches (pins, the last issues
 * response) needed to re-render them without a new request. All of it is
 * threaded through this object rather than held at module scope: router.ts
 * reuses one persistent mount point and has no navigation cancellation, so
 * module state would let a stale fetch write into a live view.
 */
interface Regions {
  /** The two-column region holding pinnedSection permanently in its left
   *  half — see decision 2 of the 2026-09-10 design. offListSection is
   *  appended into it only while it has rows. */
  layoutGrid: HTMLElement;
  pinnedSection: HTMLElement;
  pinnedList: HTMLElement;
  /** So refreshPins can repaint an open panel's already-rendered rows after a
   *  pin or unpin lands, with no new search — see ThatIssueSearch.repaint. */
  search: ThatIssueSearch;
  /** "Logged today, not on your list" — entries against an issue that is
   *  neither assigned nor pinned, so it has no row anywhere else. */
  offListSection: HTMLElement;
  assignedSection: HTMLElement;
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
  /** Today's entries as last read, kept (not just folded into totals) because
   *  renderOffListSection needs to know which issues they belong to, not only
   *  how long. */
  entries: Entry[];
  /** Settled per distinct off-list issue — present (object or null) once
   *  resolved, absent while unknown. Populated two ways: directly from a
   *  search hit at the moment it is logged (no request), or from
   *  fetchOffListInfo on a cold load. Never cleared: an issue that leaves the
   *  section (pinned, or its entries gone) and comes back within the same
   *  session should not pay for the lookup twice. */
  offListInfo: Map<string, OffListInfo | null>;
  /** Ids currently being looked up, so renderOffListSection's repeated calls
   *  (one per pins/entries/assigned refresh) fire the request once per issue
   *  rather than once per call. */
  offListPending: Set<string>;
  /** Aborts every in-flight offListInfo lookup on teardown, so a slow
   *  response cannot repaint a view the router has already left. */
  offListSignal: AbortSignal;
  pinsCachedAt: Date | null;
  issuesCachedAt: Date | null;
  /** True once the assigned read (refreshResults) has settled at least once,
   *  success or failure. The three mount reads (entries, pins, assigned) are
   *  concurrent and entries is local and fast, so before this the assigned
   *  keys renderOffListSection would judge against are not yet known — not
   *  "none", unknown. Gates renderOffListSection so it neither renders nor
   *  fetches on that guess. Never reset once true: refreshEverything's later
   *  passes always have an assigned answer to compare against, even a stale
   *  one. */
  assignedSettled: boolean;
  /** Today's logged seconds per row, keyed by instance and issue. */
  totals: Map<string, number>;
  /** Bumped per totals refresh, so a slow read cannot overwrite a newer one. */
  totalsEpoch: number;
}

/** Named so each section can point its own label at its heading, and so the
 *  two ids cannot drift apart from the elements that carry them. */
const PINNED_HEADING_ID = "today-pinned";
const ASSIGNED_HEADING_ID = "today-assigned";
const OFFLIST_HEADING_ID = "today-offlist";

/** A search hit read as the ticket the entry dialog and a pin both need. No
 *  `day`, which is what leaves the server's own "day absent means today"
 *  default in charge — a search result has no day of its own to name, the
 *  same reason a plain row's ticket never carries one either. */
function ticketFromHit(hit: IssueHit): EntryTicket {
  return {
    instanceId: hit.instanceId,
    instanceName: hit.instanceName,
    issueKey: hit.key,
    summary: hit.summary,
    status: hit.status,
  };
}

/** True when a search hit names the same (instance, key) pair as one of
 *  `keys` — `pinnedKeysOf`'s own format, so a hit and a pin agree on what
 *  counts as "the same issue" without either side reaching into the other's
 *  shape. */
function hitIsPinned(hit: IssueHit, keys: Set<string>): boolean {
  return keys.has(totalKey(hit.instanceId, hit.key));
}

/**
 * What Today configures the search panel with. Its two controls dispatch the
 * same LOG_TIME, PIN and UNPIN events a ticket row's own controls do,
 * straight at `container` — the listeners registered on it in render() do not
 * care which of the three raised them, so logging or pinning from a result
 * reuses that wiring rather than repeating it.
 *
 * `offListInfo` is the same Map `regions` ends up holding — passed in here
 * rather than waiting for `regions` to exist, because `search.config` has to
 * be set before the element connects (see render()). The duration control
 * writes straight into it: "the summary travels with the selection" from the
 * design's 2026-09-10 addendum to decision 2, so a row built from this entry
 * never has to ask for what a click already told it.
 *
 * `pinnedKeys` is read afresh on every call, not captured once, for the same
 * reason: it is `regions.pins` under a different shape, and `regions` itself
 * does not exist yet when this function first runs (see render()) — a plain
 * value captured here would be permanently empty. Reading it live is also
 * what settles the review finding of 2026-09-10: a result already pinned now
 * renders the filled pin mark exactly as a row in the list does, and pressing
 * it unpins, rather than sending a request the server can only refuse.
 */
function issueSearchConfig(
  container: HTMLElement,
  offListInfo: Map<string, OffListInfo | null>,
  pinnedKeys: () => Set<string>,
): IssueSearchConfig {
  return {
    placeholder: "Search all instances",
    footer: "Searching all instances by key and summary. Not limited to issues assigned to you.",
    controls: [
      // #84's own body: "a result row carries the same duration control as a
      // real row" — this is that control, not a stand-in for one.
      {
        kind: "duration",
        label: (hit) => `Log time against ${hit.key}`,
        onPress: (hit) => {
          offListInfo.set(totalKey(hit.instanceId, hit.key), {
            summary: hit.summary,
            status: hit.status,
            url: hit.url,
          });
          container.dispatchEvent(
            new CustomEvent<EntryTicket>(LOG_TIME, { detail: ticketFromHit(hit) }),
          );
        },
      },
      {
        kind: "icon",
        icon: (hit) => (hitIsPinned(hit, pinnedKeys()) ? "pin-off" : "pin"),
        tooltip: (hit) => (hitIsPinned(hit, pinnedKeys()) ? "unpin ticket" : "pin ticket"),
        label: (hit) => (hitIsPinned(hit, pinnedKeys()) ? `Unpin ${hit.key}` : `Pin ${hit.key}`),
        onPress: (hit) => {
          const eventName = hitIsPinned(hit, pinnedKeys()) ? UNPIN : PIN;
          container.dispatchEvent(
            new CustomEvent<EntryTicket>(eventName, { detail: ticketFromHit(hit) }),
          );
        },
      },
    ],
  };
}

export async function render(root: HTMLElement, registerTeardown: RegisterTeardown): Promise<void> {
  setRailPeriod(TODAY_PERIOD);

  // Assigned below, once its own dependencies exist — but issueSearchConfig
  // needs a way to read its pins after that point, since the search's config
  // is built (and must be, for the element to upgrade correctly) before
  // regions does. The closure below reads this binding, not a value copied
  // out of it, so it sees whatever regions.pins holds by the time a press
  // actually happens rather than the empty array that exists right now.
  let regions: Regions;

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
  // it — the prototype's two .pageh blocks, lines 329 and 331.
  const pinnedList = document.createElement("div");
  pinnedList.append(cardHolding(loadingLine()));

  const pinnedSection = document.createElement("section");
  pinnedSection.setAttribute("aria-labelledby", PINNED_HEADING_ID);
  pinnedSection.append(pageHeading("Pinned", PINNED_HEADING_ID).box, pinnedList);

  const offListSection = document.createElement("section");
  offListSection.setAttribute("aria-labelledby", OFFLIST_HEADING_ID);

  // The prototype's .instgrid, transcribed: one column, then `1fr 1fr` once
  // the content column itself (not the window) clears 80rem. Pinned is
  // appended now and stays for good — it owns the left half permanently, per
  // decision 2 of the design, so nothing here may resize it. offListSection
  // joins only when it has rows: an empty grid cell draws nothing, which is
  // what leaves the right half truly blank rather than an empty card
  // "announcing nothing happened".
  const layoutGrid = document.createElement("div");
  layoutGrid.className = "grid grid-cols-1 gap-4 @min-[80rem]:grid-cols-2";
  layoutGrid.append(pinnedSection);

  const header = pageHeading("Assigned issues", ASSIGNED_HEADING_ID).box;
  // A header control acting on the whole view, so it carries the toolbar
  // shape rather than appendIconButton's icon-and-tooltip one — Decision 12
  // of the visual language.
  const refresh = toolbarButton({ icon: "refresh", label: "Refresh" });
  header.append(refresh);

  // The heading itself is drawn from the first frame — both .pageh blocks,
  // the prototype's lines 329 and 331. Only the refresh control waits: there
  // is nothing to refresh yet, and with no instances configured it stays
  // hidden for good.
  refresh.hidden = true;

  // ml-auto on the wrapper, not the component: the prototype's own spacer
  // (its bare `<span class="sp">`) is Today's layout to own, not something
  // that-issue-search should assume every host wants — Week mounts the same
  // component with its own placement.
  const searchWrap = document.createElement("span");
  searchWrap.className = "ml-auto";
  const search = document.createElement("that-issue-search") as ThatIssueSearch;
  // Declared here rather than read off regions: that-issue-search upgrades
  // (and reads config) the moment it connects below, which is before regions
  // exists. The same Map becomes regions.offListInfo further down — sharing
  // the reference is what lets a search-logged row skip the lookup.
  const offListInfo = new Map<string, OffListInfo | null>();
  search.config = issueSearchConfig(container, offListInfo, () => pinnedKeysOf(regions));
  searchWrap.append(search);
  header.append(searchWrap);

  // One controller for every off-list lookup this view starts, aborted on
  // teardown so a response arriving after a navigation away cannot repaint a
  // view the router has already left.
  const offListAbort = new AbortController();
  registerTeardown(() => {
    offListAbort.abort();
  });

  const results = document.createElement("div");
  // One card across, two from the point the content column can hold two
  // without taking it out of the summary. Never three: see the design's
  // layout decision 2. The breakpoint is a container query against the region
  // in index.html, not the window, so the rail costs the grid nothing.
  results.className = "grid grid-cols-1 gap-4 @min-[80rem]:grid-cols-2";
  results.append(cardHolding(loadingLine()));

  const assignedSection = document.createElement("section");
  assignedSection.setAttribute("aria-labelledby", ASSIGNED_HEADING_ID);
  assignedSection.append(header, pushReport, results);

  container.append(stale, layoutGrid, assignedSection);
  root.append(container);

  regions = {
    layoutGrid,
    pinnedSection,
    pinnedList,
    search,
    offListSection,
    assignedSection,
    refresh,
    results,
    stale,
    pushReport,
    pins: [],
    lastIssues: null,
    entries: [],
    offListInfo,
    offListPending: new Set(),
    offListSignal: offListAbort.signal,
    pinsCachedAt: null,
    issuesCachedAt: null,
    assignedSettled: false,
    totals: new Map(),
    totalsEpoch: 0,
  };
  refresh.addEventListener("click", () => {
    void refreshEverything(regions);
  });

  // "online" fires when the *network* comes back. A server that restarts while
  // the network never dropped fires nothing, so coming back to the app — the
  // tab turning visible, the window regaining focus — re-checks too (#71).
  // Only while stale: every refresh fans out to Jira, and an ordinary tab
  // switch must not cost that. navigator.onLine is not trustworthy either (a
  // captive portal reports "online"); in every case the fetch, not the event,
  // decides whether the stale banner clears.
  const handleOnline = (): void => {
    void refreshEverything(regions);
  };
  // Refresh stays disabled for exactly as long as refreshEverything runs, so
  // focus and visibilitychange arriving together start one refresh, not two.
  const handleReturn = (): void => {
    if (regions.stale.hidden || document.visibilityState !== "visible") return;
    if (regions.refresh.hasAttribute("disabled")) return;
    void refreshEverything(regions);
  };
  window.addEventListener("online", handleOnline);
  document.addEventListener("visibilitychange", handleReturn);
  window.addEventListener("focus", handleReturn);
  // Registered now, not after the fan-out below resolves: the router can
  // only unwire a listener it already knows about, and a navigation away
  // while refreshResults is still in flight must find this here.
  registerTeardown(() => {
    window.removeEventListener("online", handleOnline);
    document.removeEventListener("visibilitychange", handleReturn);
    window.removeEventListener("focus", handleReturn);
  });

  // Caught here rather than in the row, which knows its ticket but not where a
  // dialog should live. The host is the view root: Today re-renders its lists
  // wholesale, so a dialog nested in a row would be destroyed mid-edit.
  container.addEventListener(LOG_TIME, (event) => {
    const request = (event as CustomEvent<EntryTicket>).detail;
    openEntryDialog(root, {
      ...request,
      instancePosition: instancePositionOf(regions, request.instanceId),
    });
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

  // Decision 5 of the timer design: a stop or a switch under a minute leaves
  // no entry, and says so once, in the same place a push report lands —
  // there is no second alert surface to invent for it.
  const stopTimerListening = onTimerDiscarded(() => {
    showPushReport(regions, alertFor("warning", "Under a minute — nothing logged."));
  });
  registerTeardown(stopTimerListening);

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
 * throw away an open search panel's results and the assigned cards
 * mid-scroll to change one number on each row.
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
      ({ entries } = await listEntries());
    } catch {
      return;
    }
    if (mine !== regions.totalsEpoch) return;
  }

  regions.entries = entries;
  regions.totals = new Map();
  for (const entry of entries) {
    const id = totalKey(entry.instanceId, entry.issueKey);
    regions.totals.set(id, (regions.totals.get(id) ?? 0) + entry.seconds);
  }

  paintTotals(regions);
  renderOffListSection(regions);
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

  paintInstanceTallies(regions);
}

/**
 * What each instance's card holds, and what has gone against it today, beside
 * its name. The issue count is still the rows the card shows: the pin dedupe
 * has already moved the rest into Pinned above, and a count claiming rows it
 * is not showing would be wrong, not merely inconsistent. The time is not
 * summed from those rows any more — it comes from `regions.totals`, added up
 * over every entry whose instanceId matches this section's, the same set the
 * rail's split slices. That is what lets "3 issues · 6h 45m" carry more time
 * than its three visible rows add up to: a pinned ticket's time still counts,
 * because it is still the instance's day, even once its row moves elsewhere.
 *
 * Called from paintTotals because the totals it reads are what paintTotals
 * has just written.
 */
function paintInstanceTallies(regions: Regions): void {
  for (const tally of document.querySelectorAll<HTMLElement>("[data-instance-tally]")) {
    const section = tally.closest("section");
    if (!section) continue;

    const instanceId = instanceIdOf(section);
    if (instanceId === null) continue;

    const rows = section.querySelectorAll("that-ticket-row");

    let seconds = 0;
    for (const [key, value] of regions.totals) {
      if (instanceIdOfTotalKey(key) === instanceId) seconds += value;
    }

    // A middot between two facts is typography, not an icon — the one place
    // the language says a typed character stays a typed character.
    tally.textContent = `${String(rows.length)} ${rows.length === 1 ? "issue" : "issues"} · ${totalFigure(seconds)}`;
  }
}

/** The instance a section's heading names, read from the id `instanceSection`
 *  built it with (`today-instance-<id>`) rather than tracked a second way. */
function instanceIdOf(section: Element): number | null {
  const match = /^today-instance-(\d+)$/.exec(section.getAttribute("aria-labelledby") ?? "");

  return match ? Number(match[1]) : null;
}

function instanceIdOfTotalKey(key: string): number {
  return Number(key.slice(0, key.indexOf(":")));
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
  } catch (error) {
    regions.pins = [];
    regions.pinsCachedAt = null;
    regions.pinnedList.replaceChildren(alertFor("error", messageOf(error)));
  }

  renderCombinedStale(regions);

  // The assigned cards may already be on screen from a fetch that finished
  // first; re-render them from the cached response so the dedupe reflects the
  // pins that just arrived, without asking the server again.
  if (regions.lastIssues) {
    renderResponse(regions, regions.lastIssues);
  } else {
    // renderResponse would otherwise be the thing that repaints this, but
    // there is no cached response yet to call it with — a newly-pinned issue
    // still has to leave the off-list section the moment the pin lands.
    renderOffListSection(regions);
  }

  // Every path through this function just changed what regions.pins answers
  // — a successful pin, an unpin, a plain Refresh discovering a change made
  // elsewhere, or even a failed read resetting it to none. The search panel's
  // own icon control reads pins live (issueSearchConfig's pinnedKeys getter),
  // but nothing re-invokes it until something rebuilds the row it is drawn
  // in. This is that rebuild — the design's "legible before the press" needs
  // it from every path here, not only the two that dispatch PIN/UNPIN, and
  // ThatIssueSearch.repaint is a no-op unless a result is actually on screen.
  regions.search.repaint();
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
  table.setAttribute("sort-id", "pinned");
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

/** One issue an entry names that has no row anywhere else on Today — see
 *  offListIssues. */
interface OffListIssue {
  instanceId: number;
  instanceName: string;
  instancePosition: number;
  issueKey: string;
}

/**
 * The day's entries whose issue is neither assigned nor pinned — the set
 * decision 2 of the design puts in the right half, beside Pinned. Computed
 * fresh from regions.entries each call rather than cached, because any of
 * three independent reads (entries, the assigned response, pins) can be what
 * moves an issue in or out of it.
 *
 * `Entry` itself carries no summary, status or url — the entries table logs
 * time against an issue, not a cache of it — so those three come from
 * regions.offListInfo instead; see renderOffListSection and fetchOffListInfo.
 */
function offListIssues(regions: Regions): OffListIssue[] {
  const assignedKeys = new Set<string>();
  for (const group of regions.lastIssues?.instances ?? []) {
    for (const issue of group.issues) {
      assignedKeys.add(totalKey(group.id, issue.key));
    }
  }
  const pinnedKeys = pinnedKeysOf(regions);

  const seen = new Map<string, OffListIssue>();
  for (const entry of regions.entries) {
    const id = totalKey(entry.instanceId, entry.issueKey);
    if (assignedKeys.has(id) || pinnedKeys.has(id) || seen.has(id)) continue;

    seen.set(id, {
      instanceId: entry.instanceId,
      instanceName: entry.instanceName,
      instancePosition: entry.instancePosition,
      issueKey: entry.issueKey,
    });
  }

  return [...seen.values()].sort(
    (a, b) => a.instancePosition - b.instancePosition || a.issueKey.localeCompare(b.issueKey),
  );
}

/**
 * Redraws "Logged today, not on your list" from regions.entries/lastIssues/
 * pins, and attaches or detaches it from layoutGrid to match — the mechanism
 * behind decision 2's "nothing at all" empty state. Always appended after
 * pinnedSection, which is layoutGrid's one permanent child, so the section
 * lands in the grid's second (right-hand) cell whenever it shows anything.
 *
 * Kicks off one lookup per issue this call finds neither resolved nor already
 * in flight, before building a single row — separated into its own pass so
 * that two issues newly appearing in the same call both get marked pending
 * before either's request actually starts, rather than racing each other
 * through renderOffListSection's own later, unrelated calls.
 *
 * Does nothing until regions.assignedSettled — see that field's comment. An
 * early call (from refreshPins or refreshTotals, both concurrent with the
 * assigned fan-out at mount) would judge every entry against an empty
 * assignedKeys, mislabelling real assigned work "not on your list" and
 * costing it a summary lookup, for however long the fan-out takes.
 */
function renderOffListSection(regions: Regions): void {
  if (!regions.assignedSettled) {
    regions.offListSection.remove();

    return;
  }

  const issues = offListIssues(regions);

  if (issues.length === 0) {
    regions.offListSection.remove();

    return;
  }

  for (const issue of issues) {
    const id = totalKey(issue.instanceId, issue.issueKey);
    if (regions.offListInfo.has(id) || regions.offListPending.has(id)) continue;

    regions.offListPending.add(id);
    void fetchOffListInfo(regions, issue, id);
  }

  const table = document.createElement("that-table") as ThatTable;
  table.setAttribute("sort-id", "off-list");
  for (const issue of issues) {
    const id = totalKey(issue.instanceId, issue.issueKey);
    table.body.append(
      offListRow(issue, regions.offListInfo.get(id), regions.offListPending.has(id)),
    );
  }
  regions.offListSection.replaceChildren(
    pageHeading("Logged today, not on your list", OFFLIST_HEADING_ID).box,
    table,
  );

  if (!regions.offListSection.isConnected) {
    regions.layoutGrid.append(regions.offListSection);
  }

  // Same reasoning as renderPinnedList's own trailing call: the rows above
  // are built with no seconds of their own, and this is what fills them in
  // from what is already known.
  paintTotals(regions);
}

/**
 * The one request an off-list row can cost — see the design's "Where the
 * off-list row's summary comes from" subsection. `q=<key>` is a key-shaped
 * query, which the server already resolves as an exact lookup rather than a
 * text search (internal/server/issue_search.go), so this asks for exactly
 * the one issue rather than searching for it.
 *
 * A miss (the instance gone, the issue deleted, whatever `.find` cannot
 * match) settles as `null` rather than being left unresolved — the point is
 * to stop asking, not to keep retrying an issue that will never answer.
 */
async function fetchOffListInfo(regions: Regions, issue: OffListIssue, id: string): Promise<void> {
  let resolved: OffListInfo | null;
  try {
    const { results } = await searchIssues(issue.issueKey, regions.offListSignal);
    const hit = results.find(
      (candidate) => candidate.instanceId === issue.instanceId && candidate.key === issue.issueKey,
    );
    resolved = hit ? { summary: hit.summary, status: hit.status, url: hit.url } : null;
  } catch (error) {
    // Teardown, not a failure to report — the view this would repaint is
    // already gone, and regions.offListPending is about to go with it.
    if (error instanceof DOMException && error.name === "AbortError") return;
    resolved = null;
  }

  regions.offListInfo.set(id, resolved);
  regions.offListPending.delete(id);
  renderOffListSection(regions);
}

/**
 * `info` filled in once resolved; `pending` true while the lookup that will
 * fill it is still in flight. A pending row still names its key and still
 * carries its controls — only Summary says "Loading…", so it never reads as
 * an issue that simply has no summary (a settled, resolved-to-nothing row
 * looks exactly like that instead, which is the correct terminal state).
 */
function offListRow(
  issue: OffListIssue,
  info: OffListInfo | null | undefined,
  pending: boolean,
): HTMLElement {
  const row = document.createElement("that-ticket-row");
  row.setAttribute("key", issue.issueKey);
  row.setAttribute("instance-id", String(issue.instanceId));
  row.setAttribute("instance-name", issue.instanceName);
  // Cross-instance, like Pinned: this section can hold issues from any
  // instance, so its key cell carries the same dot Pinned's does — see
  // that-ticket-row's keyContent.
  row.setAttribute("instance-position", String(issue.instancePosition));

  if (info) {
    row.setAttribute("summary", info.summary);
    row.setAttribute("status", info.status);
    row.setAttribute("url", info.url);
  } else if (pending) {
    row.setAttribute("summary", "Loading…");
  }

  return row;
}

/**
 * Where an instance sits in created_at order, which is what the entries
 * dialog's dot keys its hue off. A row cannot answer this: the position is a
 * property of the list the cards were drawn from, and the row knows only its
 * own instance's id and name. The assigned response is that list — the same
 * index instanceSection paints its card heading from — and a pinned ticket
 * whose instance has no assigned issues left still carries one on its pin.
 *
 * undefined rather than a guess when neither knows: the dialog draws no dot at
 * all for that, which is honest, where a fallback of 0 would paint the first
 * instance's colour on some other instance's ticket.
 */
function instancePositionOf(regions: Regions, instanceId: number): number | undefined {
  const index = regions.lastIssues?.instances.findIndex((group) => group.id === instanceId) ?? -1;
  if (index >= 0) return index;

  return regions.pins.find((pin) => pin.instanceId === instanceId)?.instancePosition;
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
    (candidate) => candidate.instanceId === ticket.instanceId && candidate.key === ticket.issueKey,
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
  } else {
    // Same reasoning as refreshPins' own branch: renderResponse would
    // otherwise be what redraws this, but a pin control can be pressed
    // before the assigned response has ever arrived.
    renderOffListSection(regions);
  }
  regions.pinnedList.prepend(alertFor("error", messageOf(error)));
}

/** The pinned (instanceId, key) pairs, keyed the same way offListIssues'
 *  dedupe reads them — so a pinned issue's entries stop counting as off-list
 *  the moment the pin lands. */
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
    regions.assignedSettled = true;
    renderResponse(regions, response);
  } catch (error) {
    regions.assignedSettled = true;
    regions.refresh.hidden = false;
    regions.issuesCachedAt = null;
    regions.results.replaceChildren(alertFor("error", messageOf(error)));
    // renderResponse is what would otherwise unblock this — see its own
    // trailing call — but a failed read never reaches it. The off-list
    // section still has to judge — against pinned keys alone when nothing
    // has arrived yet, otherwise against the last response, since this
    // failure does not clear regions.lastIssues — per the ruling: logged
    // work must never stay hidden behind a fetch that never comes back.
    renderOffListSection(regions);
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
    // instance — so the whole left/right layout would be two controls with
    // nothing to do. Removing layoutGrid takes offListSection with it, since
    // it is layoutGrid's child whenever it is showing anything at all.
    regions.layoutGrid.remove();
    regions.refresh.hidden = true;
    regions.results.replaceChildren(cardHolding(noInstances()));

    return;
  }

  if (!regions.layoutGrid.isConnected) {
    regions.assignedSection.before(regions.layoutGrid);
  }

  regions.refresh.hidden = false;
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
  renderOffListSection(regions);
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
  tally.className = "ml-auto font-normal tracking-normal normal-case opacity-75";
  heading.append(tally);

  const table = document.createElement("that-table") as ThatTable;
  table.setAttribute("sort-id", `instance-${String(group.id)}`);
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

// alertFor and messageOf are deliberate duplicates of the same two helpers in
// views/settings.ts. Extracting them into a shared module is the right end
// state, but it means editing settings.ts, which is outside this ticket's
// scope. Worth its own ticket.

/** The raised surface a message sits on where a table would otherwise be. */
function cardHolding(node: Node): HTMLElement {
  const card = document.createElement("that-card");
  card.append(node);

  return card;
}
