import { ApiError, searchIssues } from "../api";
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

export interface IssueSearchControl {
  /** Icon name, or the word a text control shows. */
  icon: IconName;
  /** The accessible name. A tooltip is never the accessible name. */
  label: string;
  /** Called with the hit the row is for. */
  onPress: (hit: IssueHit) => void | Promise<void>;
}

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
 * translates its own. A row's controls are not in that list: what a control
 * looks like beyond its icon and label is this component's own business, not
 * the prototype's `.durbtn`/`.iconbtn` markup, because the host decides how
 * many there are and what they do.
 */
export class ThatIssueSearch extends HTMLElement {
  /** Assigned before the element is appended — connectedCallback builds from
   *  it, the same contract that-entry-dialog's `ticket` uses. */
  config: IssueSearchConfig | undefined;

  private input: HTMLInputElement | undefined;
  private panel: HTMLElement | undefined;
  private timer: number | undefined;
  private inFlight: AbortController | undefined;
  /** The query the panel's current contents answer, for the empty state's
   *  "no issues match “this”" line — read back off the input at render time
   *  would be wrong the moment a keystroke lands mid-fetch. */
  private query = "";

  connectedCallback(): void {
    if (this.input || !this.config) return;

    this.build(this.config);
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

  /** One controller per read, replaced on every debounce firing — the same
   *  supersede-the-previous-read shape the pin form's own search wires up in
   *  today.ts, owned here instead of by a host that would otherwise have to
   *  reimplement it twice. */
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
    if (this.panel) this.panel.hidden = false;
  }

  private close(): void {
    window.clearTimeout(this.timer);
    this.inFlight?.abort();
    if (!this.panel) return;
    this.panel.hidden = true;
    this.panel.replaceChildren();
  }

  private showSearching(config: IssueSearchConfig): void {
    if (!this.panel) return;
    this.panel.replaceChildren(this.notice("Searching…"), this.footerLine(config.footer));
    this.open();
  }

  private showFailure(config: IssueSearchConfig, error: unknown): void {
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
    row.append(...config.controls.map((control) => this.controlButton(control, hit)));

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

  private controlButton(control: IssueSearchControl, hit: IssueHit): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", control.label);
    button.className =
      "flex size-[34px] shrink-0 cursor-pointer items-center justify-center rounded-sm " +
      "text-ink-muted hover:bg-hover hover:text-ink focus-visible:bg-hover focus-visible:text-ink";
    button.innerHTML = iconMarkup(control.icon);
    button.addEventListener("click", () => {
      void control.onPress(hit);
    });

    return button;
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
