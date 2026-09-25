import { ApiError, searchIssues } from "../api";
import { cutTextTooltip } from "../cut-text-tooltip";
import { fieldFigure } from "../duration";
import type { IconName } from "../icons";
import { iconMarkup } from "../icons";
import { paintInstanceDot } from "../instance-hue";
import { nextSearchFocus } from "../search-keys";
import type { InstanceFailure, IssueHit } from "../types";

/**
 * What a host configures the panel with. Two of the three fields are
 * functions, which is why this is a property rather than the app's usual
 * attributes — Week mounts the same component with a different placeholder,
 * footer and control set, and neither survives being stringified onto the DOM.
 */
export interface IssueSearchConfig {
  /** The field's placeholder — and, absent a visible label, its accessible
   *  name too: the drawing gives this field an icon, not a `<label>`. */
  placeholder: string;
  /** The sentence under the results. Stated in words so an empty panel is not
   *  mistaken for a filter that found nothing. */
  footer: string;
  /** The controls one result row carries, left to right. */
  controls: IssueSearchControl[];
}

/**
 * One result row's control, in the one shape or the other — a discriminated
 * union rather than an all-optional object, which under this project's strict
 * settings would admit states the app never means: an icon with no `icon`, or
 * one carrying both an `icon` and whatever a duration variant might have
 * added. Neither "icon button" nor "duration control" is specific to a view:
 * #84's own body settles that a result row carries the same duration control
 * a real row does, and Week's later return-into-week mark is an icon control
 * like pin, so the union covers both hosts without either leaking into this
 * component.
 *
 * `label` takes the hit rather than being a fixed string: a control that
 * reads identically on every row tells a screen reader nothing a sighted
 * reader cannot already see from position alone, where that-ticket-row names
 * its own ticket and (for a duration control) its own figure.
 */
export type IssueSearchControl = IssueSearchIconControl | IssueSearchDurationControl;

export interface IssueSearchIconControl {
  kind: "icon";
  /** The mark this control draws for a given hit. A function, like `label`
   *  below, rather than a fixed icon: Today's pin control answers `pin-off`
   *  for a hit already pinned, the same pair that-ticket-row's own pin
   *  control draws — the mark alone carries that distinction, at rest, for
   *  both controls (2026-09-10). Every control that carries no such state
   *  (Week's add-to-week and pin controls included — decision 1 of the
   *  2026-09-10 design keeps Week's pin unmarked) just answers the same icon
   *  for every hit. */
  icon: (hit: IssueHit) => IconName;
  /** The word a hover or focus reveals beside the mark. Never the accessible
   *  name — `label` below is that — matching every other icon control's own
   *  `that-tooltip` in the app. A function for the same reason `icon` is. */
  tooltip: (hit: IssueHit) => string;
  /** The row's own accessible name, read against the hit it belongs to. */
  label: (hit: IssueHit) => string;
  /** Called with the hit the row is for. */
  onPress: (hit: IssueHit) => void | Promise<void>;
}

export interface IssueSearchDurationControl {
  kind: "duration";
  /** The row's own accessible name, read against the hit it belongs to. */
  label: (hit: IssueHit) => string;
  /** Called with the hit the row is for. */
  onPress: (hit: IssueHit) => void | Promise<void>;
}

/** A hit's identity across a rebuild — an id sequence or a Jira key alone
 *  cannot stand in for it, since a key repeats across instances and an id
 *  is reassigned every repaint. What `data-hit-key` carries, and what
 *  `repaint`'s own focus restore looks a row up by afterward. */
function hitKey(hit: IssueHit): string {
  return `${String(hit.instanceId)}:${hit.key}`;
}

/** One id per icon control mounted, so its tooltip's `for` can resolve it on
 *  a page holding many rows — the same reasoning that-ticket-row's own
 *  pinTriggerSequence gives. */
let iconControlSequence = 0;

/** One id per row's key link and summary, so the summary's own cut-text
 *  tooltip (#143) can `for`/`focus-for` resolve them on a page holding many
 *  rows — the same reasoning iconControlSequence gives, and the same shape
 *  that-ticket-row's own summaryTriggerSequence uses for the identical
 *  pairing. */
let resultTextSequence = 0;

/** One id per panel mounted, so its input's `aria-controls` names it
 *  uniquely even if more than one that-issue-search is ever on screen at
 *  once. */
let issueSearchSequence = 0;

/** Matches the values the deleted that-combobox used (#84 removed it —
 *  docs/superpowers/specs/2026-08-20-pinned-issues-design.md records what it
 *  did): this is the second control in the app reading against the same
 *  Jira APIs, and a pause any shorter costs one request per instance per
 *  keystroke. */
const DEBOUNCE_MS = 350;
const MIN_QUERY = 2;

/** The app's standard 16px gutter — Tailwind's default spacing-4 step, and
 *  task 10's own controller ruling for this value by name. Not drawn from
 *  index.html's content column: that wrapper's `gap-4` sits between
 *  siblings, and `#view` is its only child, so it draws nothing there —
 *  the column's own inset is `py-6`/`px-7` instead, a different value.
 *  Kept between the panel's bottom and the window's edge so opening it
 *  never forces the page to scroll to reach its end. */
const WINDOW_GUTTER_PX = 16;

/** The cap's own floor. Review round 1's finding: `Math.max(available, 0)`
 *  let a field hard against the window's bottom collapse the panel to
 *  (near) 0px — and since the panel carries no `overflow` of its own, the
 *  `shrink-0` footer would then paint outside the panel's rounded box
 *  instead of inside it, however unlikely that field position is in
 *  practice. Enough for the footer's own natural height (~30px) plus room
 *  for at least a sliver of a row above it, so the panel never gets thinner
 *  than something recognisably itself. */
const MIN_PANEL_HEIGHT_PX = 120;

/**
 * A lookup across every configured Jira instance, not a filter over anything
 * already on screen. It is why #84 exists: the alternative to pinning an
 * issue just to log an hour against it once.
 *
 * Light DOM, `that-` prefixed, no shadow root — Tailwind utilities on the
 * rows below have to reach the same way they do on every other component.
 *
 * It knows nothing about either view. `IssueSearchConfig.controls` is what
 * lets Today's row carry Log and pin while Week's later carries the
 * return-into-week mark and pin instead — the row draws whatever it is given
 * and calls back with the hit alone.
 *
 * The shapes below — the field, the results panel, the group heading, a row,
 * its key and summary, the footer — are transcribed from
 * docs/superpowers/prototypes/2026-09-03-app-prototype.html's `.field`,
 * `.results`, `.rgroup`, `.rrow`, `.rk`, `.rs` and `.rfoot`, translated into
 * this app's Tailwind vocabulary the way `that-ticket-row`
 * translates its own — including its own `.durbtn`/`.iconbtn` pair now that
 * `IssueSearchControl` can express both: which controls a row carries, and
 * how many, is still the host's choice, but what an icon control and a
 * duration control each look like is this component's business, the same way
 * that-ticket-row owns its own duration cell and pin control's shapes.
 */
export class ThatIssueSearch extends HTMLElement {
  /** Assigned before the element is appended — connectedCallback builds from
   *  it, the same contract that-entry-dialog's `ticket` uses. */
  config: IssueSearchConfig | undefined;

  private readonly sequence = ++issueSearchSequence;
  private input: HTMLInputElement | undefined;
  private panel: HTMLElement | undefined;
  /** The panel's two permanent children — built once in `build`, never
   *  replaced, only ever repopulated via `replaceChildren` on themselves.
   *  Whole-branch review's own blocker: `showResults` used to build a fresh
   *  rows container on every call, so `repaint()` (routed through it on
   *  every pin, unpin and background Refresh — today.ts's refreshPins calls
   *  it unconditionally) handed the reader a div whose `scrollTop` was
   *  always 0, throwing a scrolled reader back to the top of a 25-hit list
   *  for acting on row twenty. Keeping the same element and only ever
   *  rewriting its contents is what lets `scrollTop` survive a repaint. */
  private rowsAreaEl: HTMLElement | undefined;
  private fixedBottomEl: HTMLElement | undefined;
  private timer: number | undefined;
  private inFlight: AbortController | undefined;
  /** The query the panel's current contents answer, for the empty state's
   *  "no issues match “this”" line — read back off the input at render time
   *  would be wrong the moment a keystroke lands mid-fetch. */
  private query = "";
  /** The last response showResults actually rendered, kept so `repaint` can
   *  redraw the same rows with no new request — see `repaint` itself. */
  private lastResults: IssueHit[] | undefined;
  private lastErrors: InstanceFailure[] | undefined;
  /** True only while the panel is showing a rendered response (not
   *  "Searching…", not a failure, not closed) — what `repaint` gates on, so
   *  it never overwrites a state its own stored results do not describe. */
  private showingResults = false;
  /** True for the span of `repaint`'s own `replaceChildren` call — see the
   *  focusout listener in `build` and the comment on `repaint` itself. */
  private suppressBlurClose = false;

  /** The field's distance from the window's bottom moves with the scrolling
   *  region it sits in (task 10). Registered and removed in
   *  connectedCallback/disconnectedCallback, not build — build only ever
   *  runs once per element, but connectedCallback can run again on a node
   *  detached and reattached, and that reconnection would otherwise never
   *  get its listener back. */
  private readonly onResize = (): void => {
    this.applyMaxHeight();
  };

  /** The review round's own finding: a resize is not the only way the
   *  field's distance to the window's bottom changes — scrolling the region
   *  the field sits in does too, and the panel's own top tracks the field in
   *  real time (it is drawn under it) while a max-height computed once at
   *  open would not. Scroll events do not bubble, so this listens in the
   *  capture phase on window, which still sees one dispatched on any
   *  scrollable descendant — this component has no reason to know which
   *  element that is. Added when the panel opens and removed when it closes,
   *  not held for the component's whole life: `applyMaxHeight` is already a
   *  no-op while hidden, but there is no reason to keep the app scrolling
   *  the window at all when nothing is open to react to it.
   *
   *  Whole-branch review: scrolling rowsAreaEl itself — reading a 25-hit
   *  list — fires this too, and the panel's own top cannot have moved from
   *  that. The early-out below skips `applyMaxHeight`'s read/write pair for
   *  any scroll whose target is the panel or inside it, which is the one
   *  scroll this listener exists to react to being ruled out. */
  private readonly onScroll = (event: Event): void => {
    if (event.target instanceof Node && this.panel?.contains(event.target)) return;
    this.applyMaxHeight();
  };

  connectedCallback(): void {
    window.addEventListener("resize", this.onResize);
    // Review round 1 fixed this for onResize by moving its registration
    // here; onScroll's own only-while-open registration (open()) was missed
    // — a node detached and reattached while its panel was still open (per
    // its own now-stale `hidden` state) would never get the listener back,
    // exactly the stale-cap bug that round existed to kill.
    if (this.panel && !this.panel.hidden) {
      window.addEventListener("scroll", this.onScroll, true);
    }
    if (this.input || !this.config) return;

    this.build(this.config);
  }

  private get panelId(): string {
    return `that-issue-search-panel-${String(this.sequence)}`;
  }

  /** A pending debounce timer or an in-flight read must not outlive removal
   *  from the DOM — a timer would otherwise fire (or a response resolve)
   *  against an element no longer connected to anything. */
  disconnectedCallback(): void {
    window.clearTimeout(this.timer);
    this.inFlight?.abort();
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("scroll", this.onScroll, true);
  }

  private build(config: IssueSearchConfig): void {
    // relative: the panel below is positioned against this box, per the
    // drawing's `.field { position: relative }`. w-[300px]: the drawn width,
    // stated as the ticket requires rather than left to content.
    this.className =
      "relative flex w-[300px] items-center gap-2 rounded-sm border border-edge bg-raised " +
      "px-[11px] py-2 text-ink-muted focus-within:border-primary";

    const glass = document.createElement("span");
    glass.className = "shrink-0";
    glass.innerHTML = iconMarkup("search", 16);

    const input = document.createElement("input");
    input.type = "text";
    input.autocomplete = "off";
    input.placeholder = config.placeholder;
    // No visible <label> in the drawing — the icon carries that weight for a
    // sighted user, so the placeholder doubles as the accessible name for
    // everyone else too.
    input.setAttribute("aria-label", config.placeholder);
    // aria-expanded plus aria-controls — not a full combobox/listbox pattern,
    // which does not map onto a row of press-to-act buttons the way an
    // option list does. This is the minimum a screen reader needs to know
    // typing opened something.
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", this.panelId);
    input.className =
      "min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-muted focus:outline-none";
    input.addEventListener("input", () => {
      this.scheduleSearch(config);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();

        return;
      }
      if (event.key === "ArrowDown" && this.panel && !this.panel.hidden) {
        this.moveFocus("input", event);
      }
    });
    this.input = input;

    const panel = document.createElement("div");
    panel.id = this.panelId;
    // The drawing's `.results`: positioned against the field it spans exactly
    // (inset-x-0 against this element's own padding box), raised above the
    // page the way every other popover in the app is — border-edge and
    // shadow-popover, the recipe every popover in the app uses.
    // flex flex-col: task 10's own layout — a rows area that scrolls and a
    // footer that does not, split by applyMaxHeight's inline max-height
    // rather than height, so a short result list still sizes to its content.
    panel.className =
      "border-edge bg-raised shadow-popover absolute inset-x-0 top-[calc(100%+5px)] z-10 " +
      "flex flex-col rounded-md border p-1.5";
    panel.hidden = true;
    this.panel = panel;

    // Built once and kept for the panel's whole life — see the field comment
    // on rowsAreaEl for why a rebuilt-per-repaint pair was the blocker.
    const rowsAreaEl = document.createElement("div");
    rowsAreaEl.className = "min-h-0 overflow-y-auto";
    // #143, point 3: arrow-key movement across result rows. The focused
    // element's own row and column are read fresh on every press rather than
    // tracked as state, so a repaint mid-navigation (a pin landing) never
    // leaves this stale.
    rowsAreaEl.addEventListener("keydown", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !this.rowsAreaEl) return;
      const row = target.closest<HTMLElement>("[data-hit-key]");
      if (!row) return;
      const rowEls = [...this.rowsAreaEl.querySelectorAll<HTMLElement>("[data-hit-key]")];
      const rowIndex = rowEls.indexOf(row);
      const controls = [...row.querySelectorAll<HTMLElement>("[data-control-index]")];
      const column = controls.indexOf(target);
      if (rowIndex === -1 || column === -1) return;
      this.moveFocus({ row: rowIndex, column }, event);
    });
    const fixedBottomEl = document.createElement("div");
    fixedBottomEl.className = "shrink-0";
    panel.append(rowsAreaEl, fixedBottomEl);
    this.rowsAreaEl = rowsAreaEl;
    this.fixedBottomEl = fixedBottomEl;

    this.append(glass, input, panel);

    // Closing on blur is scoped to the component as a whole, not the input:
    // a click on a result's own control moves focus into this element's
    // subtree, and relatedTarget still names something this contains.
    this.addEventListener("focusout", (event) => {
      if (this.suppressBlurClose) return;
      const next = (event as FocusEvent).relatedTarget as Node | null;
      if (next && this.contains(next)) return;
      this.close();
    });
  }

  private scheduleSearch(config: IssueSearchConfig): void {
    window.clearTimeout(this.timer);
    const query = this.input?.value.trim() ?? "";

    if (query.length < MIN_QUERY) {
      this.inFlight?.abort();
      this.close();

      return;
    }

    this.timer = window.setTimeout(() => {
      this.runSearch(config, query);
    }, DEBOUNCE_MS);
  }

  /** One controller per read, replaced on every debounce firing — the
   *  supersede-the-previous-read shape owned here instead of by each host,
   *  which would otherwise have to reimplement it once per view. */
  private runSearch(config: IssueSearchConfig, query: string): void {
    this.query = query;
    this.inFlight?.abort();
    const controller = new AbortController();
    this.inFlight = controller;

    this.showSearching(config);
    // A fresh query is the one time scrollTop resets — repaint() (pin,
    // unpin, a background Refresh) must never touch it, which is why this
    // sits here rather than inside showResults itself, the method the two
    // paths share.
    if (this.rowsAreaEl) this.rowsAreaEl.scrollTop = 0;

    void searchIssues(query, controller.signal)
      .then((response) => {
        this.showResults(config, response.results, response.errors);
      })
      .catch((error: unknown) => {
        // A caller-initiated abort is this element superseding its own
        // in-flight read, not a failure to report.
        if (error instanceof DOMException && error.name === "AbortError") return;
        this.showFailure(config, error);
      });
  }

  private open(): void {
    if (!this.panel) return;
    this.panel.hidden = false;
    this.input?.setAttribute("aria-expanded", "true");
    window.addEventListener("scroll", this.onScroll, true);
    this.applyMaxHeight();
  }

  /**
   * Caps the panel at the window's bottom edge, minus the standard gutter —
   * task 10's own rule, since the field sits in a view header inside a
   * scrolling region and its distance to the window's bottom moves with it.
   * Measured off the panel's own rendered top (only valid once `open` has
   * unhidden it), not the field's, so this needs no separate copy of the
   * drawn `top-[calc(100%+5px)]` gap. A max-height, not a height: content
   * shorter than the cap still sizes to itself, which is what keeps the
   * panel from reserving empty space it does not need.
   */
  private applyMaxHeight(): void {
    if (!this.panel || this.panel.hidden) return;
    const top = this.panel.getBoundingClientRect().top;
    const available = window.innerHeight - WINDOW_GUTTER_PX - top;
    this.panel.style.maxHeight = `${String(Math.max(available, MIN_PANEL_HEIGHT_PX))}px`;
  }

  private close(): void {
    window.clearTimeout(this.timer);
    this.inFlight?.abort();
    this.input?.setAttribute("aria-expanded", "false");
    this.showingResults = false;
    window.removeEventListener("scroll", this.onScroll, true);
    if (!this.panel) return;
    this.panel.hidden = true;
    // Emptied in place, not replaced — rowsAreaEl and fixedBottomEl are
    // panel's own permanent children (see the field comment on rowsAreaEl).
    this.rowsAreaEl?.replaceChildren();
    this.fixedBottomEl?.replaceChildren();
  }

  private showSearching(config: IssueSearchConfig): void {
    this.showingResults = false;
    if (!this.panel || !this.rowsAreaEl || !this.fixedBottomEl) return;
    this.rowsAreaEl.replaceChildren(this.notice("Searching…"));
    this.fixedBottomEl.replaceChildren(this.footerLine(config.footer));
    this.open();
  }

  private showFailure(config: IssueSearchConfig, error: unknown): void {
    this.showingResults = false;
    if (!this.panel || !this.rowsAreaEl || !this.fixedBottomEl) return;
    const message = error instanceof ApiError ? error.message : "Something went wrong.";
    this.rowsAreaEl.replaceChildren(this.failureNotice(message));
    this.fixedBottomEl.replaceChildren(this.footerLine(config.footer));
    this.open();
  }

  /**
   * Grouped rows when there is something to show; the empty state when there
   * is nothing and nothing failed; the failure line when something did — kept
   * apart so a reader can never mistake "found nothing" for "asked and
   * failed", the pairing task 3's brief calls out by name.
   *
   * Rewrites rowsAreaEl and fixedBottomEl's own contents rather than
   * replacing the elements themselves (task 10's rows-scroll/footer-fixed
   * split, now also what lets `scrollTop` and focus survive a repaint — see
   * the field comment on rowsAreaEl).
   */
  private showResults(
    config: IssueSearchConfig,
    results: IssueHit[],
    errors: InstanceFailure[],
  ): void {
    this.lastResults = results;
    this.lastErrors = errors;
    this.showingResults = true;
    if (!this.panel || !this.rowsAreaEl || !this.fixedBottomEl) return;

    const rowNodes: HTMLElement[] = [];
    if (results.length > 0) {
      rowNodes.push(...this.groupedRows(config, results));
    } else if (errors.length === 0) {
      rowNodes.push(this.notice(`No issues match “${this.query}”.`));
    }

    const bottomNodes: HTMLElement[] = [];
    if (errors.length > 0) {
      bottomNodes.push(this.instanceFailureLine(errors));
    }
    bottomNodes.push(this.footerLine(config.footer));

    this.rowsAreaEl.replaceChildren(...rowNodes);
    this.fixedBottomEl.replaceChildren(...bottomNodes);
    this.open();
  }

  /**
   * Redraws the panel's current rows from the results it already has — no
   * new search. A pin or unpin changes what `pinnedKeys` (read live by
   * Today's icon control — see issueSearchConfig) answers for a hit already
   * on screen, but nothing re-invokes the per-hit `icon`/`tooltip`/`label`
   * functions until something rebuilds the row, and a fresh search
   * would be a round trip to Jira to reflect a purely local state change.
   * This is that rebuild, using the exact response `showResults` last
   * rendered — a no-op while the panel is closed, mid-search, or showing a
   * failure, since there is nothing on screen a repaint would change, and
   * the next search reads live state regardless.
   *
   * Rebuilding removes and recreates every row, which can remove whichever
   * control currently has focus — exactly the one just pressed, mid pin or
   * unpin. Removing a focused element fires a focusout the listener in
   * `build` would otherwise read as focus leaving the component altogether,
   * closing the panel right after this repaints it — the state it just made
   * legible gone again a moment later. `suppressBlurClose` is this call's
   * own DOM change, not the user's focus actually leaving, so that listener
   * ignores it for the span of the synchronous `replaceChildren` calls
   * inside `showResults`. Whole-branch review's own blocker: focus still
   * has to land back *somewhere* once that removal happens, or it falls to
   * `<body>` — `captureFocus`/`restoreFocus` are the two halves of that.
   */
  repaint(): void {
    if (!this.showingResults || !this.config || this.lastResults === undefined) return;

    const toRestore = this.captureFocus();
    this.suppressBlurClose = true;
    try {
      this.showResults(this.config, this.lastResults, this.lastErrors ?? []);
      this.restoreFocus(toRestore);
    } finally {
      this.suppressBlurClose = false;
    }
  }

  /** What a control loses when `repaint` rebuilds it out from under it: not
   *  the element (gone either way), but which hit and which of that hit's
   *  controls it was — a row-then-index pair `restoreFocus` can still find
   *  afterward, since `data-hit-key` and `data-control-index` survive the
   *  rebuild even though the elements carrying them do not. */
  private captureFocus(): { hitKey: string; controlIndex: string } | undefined {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !this.panel?.contains(active)) return undefined;

    const row = active.closest<HTMLElement>("[data-hit-key]");
    const controlIndex = active.dataset.controlIndex;
    if (row?.dataset.hitKey === undefined || controlIndex === undefined) return undefined;

    return { hitKey: row.dataset.hitKey, controlIndex };
  }

  private restoreFocus(target: { hitKey: string; controlIndex: string } | undefined): void {
    if (!target || !this.rowsAreaEl) return;

    // CSS.escape: neither value can carry a quote or backslash today (a
    // Jira key, a numeric instance id, or the "key" sentinel), but building
    // an attribute selector from either without it is what would let one
    // that someday can break out of the quotes.
    const hitSelector = `[data-hit-key="${CSS.escape(target.hitKey)}"]`;
    const controlSelector = `[data-control-index="${CSS.escape(target.controlIndex)}"]`;
    const row = this.rowsAreaEl.querySelector<HTMLElement>(hitSelector);
    const control = row?.querySelector<HTMLElement>(controlSelector);
    control?.focus();
  }

  /** Resolves one arrow or Escape press to where focus should land next
   *  (`nextSearchFocus`, #143 point 3) and moves it there. `null` leaves the
   *  key for the browser's own handling (Tab, and anything typed while a
   *  control has focus), which is also why `preventDefault` only runs once an
   *  answer is known. */
  private moveFocus(from: { row: number; column: number } | "input", event: KeyboardEvent): void {
    if (!this.rowsAreaEl) return;
    const rowEls = [...this.rowsAreaEl.querySelectorAll<HTMLElement>("[data-hit-key]")];
    const rows = rowEls.map((row) => row.querySelectorAll("[data-control-index]").length);
    const answer = nextSearchFocus(rows, from, event.key);
    if (answer === null) return;

    event.preventDefault();
    if (answer === "input") {
      this.input?.focus();

      return;
    }
    const controls = rowEls[answer.row]?.querySelectorAll<HTMLElement>("[data-control-index]");
    controls?.[answer.column]?.focus();
  }

  /** Grouped by instance in first-seen order, since the search endpoint fans
   *  out per instance and this only has to survive that assumption breaking,
   *  not rely on it. */
  private groupedRows(config: IssueSearchConfig, results: IssueHit[]): HTMLElement[] {
    const groups = new Map<number, { name: string; position: number; hits: IssueHit[] }>();
    for (const result of results) {
      const group = groups.get(result.instanceId);
      if (group) {
        group.hits.push(result);
      } else {
        groups.set(result.instanceId, {
          name: result.instanceName,
          position: result.instancePosition,
          hits: [result],
        });
      }
    }

    const nodes: HTMLElement[] = [];
    for (const group of groups.values()) {
      nodes.push(this.groupHeading(group.name, group.position));
      nodes.push(...group.hits.map((hit) => this.resultRow(config, hit)));
    }

    return nodes;
  }

  /** The drawing's `.rgroup`: the instance dot and name a reader scans a row
   *  under, matching the same recipe instanceHeading in today.ts already
   *  uses for the same pairing. */
  private groupHeading(name: string, position: number): HTMLElement {
    const heading = document.createElement("div");
    heading.className =
      "flex items-center gap-[7px] px-[9px] pt-[7px] pb-1 text-xs font-bold tracking-[0.16em] " +
      "uppercase text-ink-muted";

    const dot = document.createElement("span");
    paintInstanceDot(dot, position, name);

    const label = document.createElement("span");
    label.textContent = name;

    heading.append(dot, label);

    return heading;
  }

  /** The drawing's `.rrow`: a text column holding the key (`.rk`) above the
   *  summary (`.rs`), then the host's own controls, left to right (#143,
   *  2026-09-23 refinement — the key and summary used to sit side by side).
   *  `data-hit-key` is what `repaint`'s own focus restore uses to find this
   *  row again after a rebuild — see the field comment on rowsAreaEl. */
  private resultRow(config: IssueSearchConfig, hit: IssueHit): HTMLElement {
    const row = document.createElement("div");
    row.className = "hover:bg-hover flex items-center gap-2.5 rounded-sm px-[9px] py-1.5";
    row.dataset.hitKey = hitKey(hit);

    const textId = ++resultTextSequence;
    const text = document.createElement("div");
    text.className = "flex min-w-0 flex-1 flex-col";
    const key = this.keyLabel(hit, textId);
    const summary = this.summaryLabel(hit, textId);
    text.append(key, summary, this.summaryTooltip(hit, summary, key));
    const keyTooltip = this.keyTooltip(key);
    if (keyTooltip) text.append(keyTooltip);
    row.append(text);

    config.controls.forEach((control, index) => {
      if (control.kind === "duration") {
        row.append(this.durationControl(control, hit, index));
      } else {
        row.append(...this.iconControl(control, hit, index));
      }
    });

    return row;
  }

  /** Linked when there is somewhere to go, like that-ticket-row's own key —
   *  an instance migrated from a gateway URL carries no site to link to.
   *  The link's own `data-control-index="key"` — a sentinel distinct from
   *  the numeric indices `resultRow` gives `config.controls` — is what lets
   *  it join the same capture/restore `captureFocus`/`restoreFocus` give
   *  every other focusable thing in a row: re-review of the blocker fix
   *  found the key link was the one focusable element a row carries that
   *  is not one of `config.controls`, so it fell through captureFocus
   *  unrecognised and dropped focus to `<body>` on a repaint same as
   *  before the fix — a plain `<span>` (no url) is never focusable, so it
   *  needs no such attribute. */
  private keyLabel(hit: IssueHit, textId: number): HTMLElement {
    if (hit.url === "") {
      // No title either (owner, 2026-09-25): a key with no site to open gets
      // no tooltip at all, not even the native one it used to carry.
      const span = document.createElement("span");
      span.className = "that-key that-tnum self-start text-ink-muted";
      span.textContent = hit.key;

      return span;
    }

    const link = document.createElement("a");
    link.id = `that-search-key-${String(textId)}`;
    link.href = hit.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.className = "that-key that-tnum self-start text-ink-muted";
    link.textContent = hit.key;
    link.dataset.controlIndex = "key";

    return link;
  }

  /** The key link's own that-tooltip (#143), replacing the native title it
   *  used to carry — the same contract that-ticket-row's own keyTooltip
   *  gives. Omitted for a plain-span key (no site to open). */
  private keyTooltip(key: HTMLElement): HTMLElement | null {
    if (!(key instanceof HTMLAnchorElement)) return null;

    const tooltip = document.createElement("that-tooltip");
    tooltip.setAttribute("for", key.id);
    tooltip.textContent = "open in Jira";

    return tooltip;
  }

  private summaryLabel(hit: IssueHit, textId: number): HTMLElement {
    const summary = document.createElement("span");
    summary.id = `that-search-summary-${String(textId)}`;
    summary.className = "truncate text-base";
    summary.textContent = hit.summary;

    return summary;
  }

  /**
   * The summary's own cut-text tooltip (#143): `for` gives back the
   * summary's hover, `focus-for` follows the key link so a keyboard user
   * reaches it too — the same contract that-ticket-row's own summaryTooltip
   * gives, and its first consumer outside that component. `focus-for` is
   * omitted when the key carries no link (no site to open), the same
   * condition that-ticket-row's `linked` flag guards. `below`: task 7's own
   * fix — the row stacks the key directly above the summary, so the
   * tooltip's default above-opening would cover the key link the
   * `focus-for` pairing just moved focus to.
   */
  private summaryTooltip(hit: IssueHit, summary: HTMLElement, key: HTMLElement): HTMLElement {
    return cutTextTooltip(summary.id, hit.summary, key.id, true);
  }

  /** An icon control — pin, and later Week's own return-into-week mark —
   *  carrying a `that-tooltip` the same way every other icon control in the
   *  app does: Today's search pin sits beside the assigned list's own pin
   *  and must not read as a different kind of control. Returns both nodes,
   *  the same shape that-entry-dialog's own rowAction helper returns for the
   *  identical button-plus-tooltip pairing. */
  private iconControl(
    control: IssueSearchIconControl,
    hit: IssueHit,
    index: number,
  ): HTMLElement[] {
    const id = `that-issue-search-control-${String(++iconControlSequence)}`;

    const button = document.createElement("button");
    button.type = "button";
    button.id = id;
    button.dataset.controlIndex = String(index);
    button.setAttribute("aria-label", control.label(hit));
    // Same rule as that-ticket-row's own paintPinned (2026-09-10): the
    // primary colour is a hover/focus-visible state, not a rest one — an
    // `active` control (pinned) is told apart by its mark, `pin` against
    // `pin-off`, not by colour at rest.
    button.className =
      "flex size-[34px] shrink-0 cursor-pointer items-center justify-center rounded-sm " +
      "text-ink-muted hover:bg-hover hover:text-primary focus-visible:bg-hover focus-visible:text-primary";
    button.innerHTML = iconMarkup(control.icon(hit));
    button.addEventListener("click", () => {
      void control.onPress(hit);
    });

    const tooltip = document.createElement("that-tooltip");
    tooltip.setAttribute("for", id);
    tooltip.setAttribute("anchor", "end");
    tooltip.textContent = control.tooltip(hit);

    return [button, tooltip];
  }

  /**
   * The drawn duration control: the "Log" hint over a figure — but the
   * prototype draws two bargains for this hint, not one. Plain `.durbtn`
   * reserves the hint's width always and only fades its opacity, which is
   * right in a table (that-ticket-row's own durationCell), where a width
   * collapse would shift the column beside it on every hover. `.durbtn.reveal`
   * claims no width until wanted, which is right in a narrow panel, where
   * reserving it comes out of the summary — and every result row in the
   * drawing (docs/superpowers/prototypes/2026-09-03-app-prototype.html,
   * lines 130-135) uses `reveal`. This is that variant: `max-w-0`/`mr-0` at
   * rest, both released on hover or focus alongside the opacity fade, not
   * ticket-row's reserve-the-width recipe.
   */
  private durationControl(
    control: IssueSearchDurationControl,
    hit: IssueHit,
    index: number,
  ): HTMLElement {
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.dataset.controlIndex = String(index);
    trigger.setAttribute("aria-label", control.label(hit));
    trigger.className =
      "group hover:bg-hover -my-[9px] -mr-[13px] inline-flex shrink-0 cursor-pointer " +
      "items-baseline rounded-sm px-[13px] py-[9px]";

    const hint = document.createElement("span");
    hint.className =
      "text-primary mr-0 max-w-0 shrink-0 overflow-hidden text-sm font-bold tracking-[0.06em] " +
      "uppercase whitespace-nowrap opacity-0 transition-all duration-150 " +
      "group-hover:mr-2.5 group-hover:max-w-[3rem] group-hover:opacity-100 " +
      "group-focus-visible:mr-2.5 group-focus-visible:max-w-[3rem] group-focus-visible:opacity-100";
    hint.textContent = "Log";
    hint.setAttribute("aria-hidden", "true");

    const figure = document.createElement("span");
    figure.className = "that-tnum font-mono text-base";
    figure.textContent = fieldFigure(0);

    trigger.append(hint, figure);
    trigger.addEventListener("click", () => {
      void control.onPress(hit);
    });

    return trigger;
  }

  private notice(text: string): HTMLElement {
    const line = document.createElement("p");
    line.className = "px-[9px] py-2 text-sm text-ink-muted";
    line.textContent = text;

    return line;
  }

  /** role="status": what a total read failure is, distinct from a per-instance
   *  one below, which names the instance instead of the reason. */
  private failureNotice(message: string): HTMLElement {
    const line = document.createElement("p");
    line.setAttribute("role", "status");
    line.className = "px-[9px] py-2 text-sm text-failed";
    line.textContent = message;

    return line;
  }

  /** The line naming every instance in `errors` — task 3's own requirement
   *  that a failed instance is said, not silently dropped from the count of
   *  results a reader sees. */
  private instanceFailureLine(errors: InstanceFailure[]): HTMLElement {
    const line = document.createElement("p");
    line.setAttribute("role", "status");
    line.className = "px-[9px] py-1 text-xs text-failed";
    line.textContent = `${errors.map((error) => error.instanceName).join(", ")} could not be searched.`;

    return line;
  }

  /** The drawing's `.rfoot`: always present once the panel is open, in every
   *  state, which is the whole reason it is worded as a sentence rather than
   *  left for an empty panel to explain itself. */
  private footerLine(text: string): HTMLElement {
    const line = document.createElement("p");
    line.className = "border-edge mt-1 border-t px-[9px] pt-[7px] pb-1 text-xs text-ink-muted";
    line.textContent = text;

    return line;
  }
}

customElements.define("that-issue-search", ThatIssueSearch);
