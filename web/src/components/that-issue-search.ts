import { ApiError, searchIssues } from "../api";
import { fieldFigure } from "../duration";
import type { IconName } from "../icons";
import { iconMarkup } from "../icons";
import { paintInstanceDot } from "../instance-hue";
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
   *  control draws — see `active`. Every control that carries no such state
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
  /** True when the mark should carry the row's own active paint — the
   *  `text-primary` that-ticket-row's paintPinned gives a pinned row's own
   *  control. Omitted by every control with no such state. */
  active?: (hit: IssueHit) => boolean;
}

export interface IssueSearchDurationControl {
  kind: "duration";
  /** The row's own accessible name, read against the hit it belongs to. */
  label: (hit: IssueHit) => string;
  /** Called with the hit the row is for. */
  onPress: (hit: IssueHit) => void | Promise<void>;
}

/** One id per icon control mounted, so its tooltip's `for` can resolve it on
 *  a page holding many rows — the same reasoning that-ticket-row's own
 *  pinTriggerSequence gives. */
let iconControlSequence = 0;

/** One id per panel mounted, so its input's `aria-controls` names it
 *  uniquely even if more than one that-issue-search is ever on screen at
 *  once. */
let issueSearchSequence = 0;

/** Matches that-combobox's own values: this is the second control in the app
 *  reading against the same Jira APIs, and a pause any shorter costs one
 *  request per instance per keystroke. */
const DEBOUNCE_MS = 350;
const MIN_QUERY = 2;

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
 * its key and summary, the footer — are transcribed from the prototype's
 * `.field`, `.results`, `.rgroup`, `.rrow`, `.rk`, `.rs` and `.rfoot`
 * (docs/superpowers/prototypes/2026-09-03-app-prototype.html, lines 334-342),
 * translated into this app's Tailwind vocabulary the way `that-ticket-row`
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

  connectedCallback(): void {
    if (this.input || !this.config) return;

    this.build(this.config);
  }

  private get panelId(): string {
    return `that-issue-search-panel-${String(this.sequence)}`;
  }

  /** A pending debounce timer or an in-flight read must not outlive removal
   *  from the DOM — the same reasoning that-combobox's disconnectedCallback
   *  gives for the timer half of this. */
  disconnectedCallback(): void {
    window.clearTimeout(this.timer);
    this.inFlight?.abort();
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
    // everyone else, matching what that-combobox is more explicit about.
    input.setAttribute("aria-label", config.placeholder);
    // aria-expanded plus aria-controls, mirroring that-combobox's own pair —
    // not the rest of its combobox/listbox pattern, which does not map onto
    // a row of press-to-act buttons the way an option list does. This is the
    // minimum a screen reader needs to know typing opened something.
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", this.panelId);
    input.className =
      "min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-muted focus:outline-none";
    input.addEventListener("input", () => {
      this.scheduleSearch(config);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      this.close();
    });
    this.input = input;

    const panel = document.createElement("div");
    panel.id = this.panelId;
    // The drawing's `.results`: positioned against the field it spans exactly
    // (inset-x-0 against this element's own padding box), raised above the
    // page the way every other popover in the app is — border-edge and
    // shadow-popover, the same recipe that-combobox's own popup uses.
    panel.className =
      "border-edge bg-raised shadow-popover absolute inset-x-0 top-[calc(100%+5px)] z-10 " +
      "rounded-md border p-1.5";
    panel.hidden = true;
    this.panel = panel;

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
  }

  private close(): void {
    window.clearTimeout(this.timer);
    this.inFlight?.abort();
    this.input?.setAttribute("aria-expanded", "false");
    this.showingResults = false;
    if (!this.panel) return;
    this.panel.hidden = true;
    this.panel.replaceChildren();
  }

  private showSearching(config: IssueSearchConfig): void {
    this.showingResults = false;
    if (!this.panel) return;
    this.panel.replaceChildren(this.notice("Searching…"), this.footerLine(config.footer));
    this.open();
  }

  private showFailure(config: IssueSearchConfig, error: unknown): void {
    this.showingResults = false;
    if (!this.panel) return;
    const message = error instanceof ApiError ? error.message : "Something went wrong.";
    this.panel.replaceChildren(this.failureNotice(message), this.footerLine(config.footer));
    this.open();
  }

  /**
   * Grouped rows when there is something to show; the empty state when there
   * is nothing and nothing failed; the failure line when something did — kept
   * apart so a reader can never mistake "found nothing" for "asked and
   * failed", the pairing task 3's brief calls out by name.
   */
  private showResults(config: IssueSearchConfig, results: IssueHit[], errors: InstanceFailure[]): void {
    this.lastResults = results;
    this.lastErrors = errors;
    this.showingResults = true;
    if (!this.panel) return;

    const nodes: HTMLElement[] = [];
    if (results.length > 0) {
      nodes.push(...this.groupedRows(config, results));
    } else if (errors.length === 0) {
      nodes.push(this.notice(`No issues match “${this.query}”.`));
    }
    if (errors.length > 0) {
      nodes.push(this.instanceFailureLine(errors));
    }
    nodes.push(this.footerLine(config.footer));

    this.panel.replaceChildren(...nodes);
    this.open();
  }

  /**
   * Redraws the panel's current rows from the results it already has — no
   * new search. A pin or unpin changes what `pinnedKeys` (read live by
   * Today's icon control — see issueSearchConfig) answers for a hit already
   * on screen, but nothing re-invokes the per-hit `icon`/`tooltip`/`label`/
   * `active` functions until something rebuilds the row, and a fresh search
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
   * ignores it for the span of the synchronous `replaceChildren` below.
   */
  repaint(): void {
    if (!this.showingResults || !this.config || this.lastResults === undefined) return;

    this.suppressBlurClose = true;
    this.showResults(this.config, this.lastResults, this.lastErrors ?? []);
    this.suppressBlurClose = false;
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

  /** The drawing's `.rrow`: the key (`.rk`), the summary (`.rs`), then the
   *  host's own controls, left to right. */
  private resultRow(config: IssueSearchConfig, hit: IssueHit): HTMLElement {
    const row = document.createElement("div");
    row.className = "hover:bg-hover flex items-center gap-2.5 rounded-sm px-[9px] py-1.5";

    row.append(this.keyLabel(hit), this.summaryLabel(hit));
    for (const control of config.controls) {
      if (control.kind === "duration") {
        row.append(this.durationControl(control, hit));
      } else {
        row.append(...this.iconControl(control, hit));
      }
    }

    return row;
  }

  /** Linked when there is somewhere to go, like that-ticket-row's own key —
   *  an instance migrated from a gateway URL carries no site to link to. */
  private keyLabel(hit: IssueHit): HTMLElement {
    if (hit.url === "") {
      const span = document.createElement("span");
      span.className = "that-key that-tnum shrink-0 text-ink-muted";
      span.title = `Open ${hit.key} in Jira`;
      span.textContent = hit.key;

      return span;
    }

    const link = document.createElement("a");
    link.href = hit.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.title = `Open ${hit.key} in Jira`;
    link.className = "that-key that-tnum shrink-0 text-ink-muted";
    link.textContent = hit.key;

    return link;
  }

  private summaryLabel(hit: IssueHit): HTMLElement {
    const summary = document.createElement("span");
    summary.className = "min-w-0 flex-1 truncate text-base";
    summary.textContent = hit.summary;

    return summary;
  }

  /** An icon control — pin, and later Week's own return-into-week mark —
   *  carrying a `that-tooltip` the same way every other icon control in the
   *  app does: Today's search pin sits beside the assigned list's own pin
   *  and must not read as a different kind of control. Returns both nodes,
   *  the same shape that-entry-dialog's own rowAction helper returns for the
   *  identical button-plus-tooltip pairing. */
  private iconControl(control: IssueSearchIconControl, hit: IssueHit): HTMLElement[] {
    const id = `that-issue-search-control-${String(++iconControlSequence)}`;

    const button = document.createElement("button");
    button.type = "button";
    button.id = id;
    button.setAttribute("aria-label", control.label(hit));
    button.className =
      "flex size-[34px] shrink-0 cursor-pointer items-center justify-center rounded-sm " +
      "text-ink-muted hover:bg-hover hover:text-ink focus-visible:bg-hover focus-visible:text-ink";
    // Same technique as that-ticket-row's own paintPinned: toggled on top of
    // the muted class above rather than chosen between two class strings,
    // which is what already works there for the identical pin/pin-off pair.
    button.classList.toggle("text-primary", control.active?.(hit) ?? false);
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
  private durationControl(control: IssueSearchDurationControl, hit: IssueHit): HTMLElement {
    const trigger = document.createElement("button");
    trigger.type = "button";
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
