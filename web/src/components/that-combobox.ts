import "./that-alert";

import { paintInstanceDot } from "../instance-hue";
import type { InstanceFailure, IssueHit } from "../types";

/**
 * A searchable select. Light DOM, like every that-* component.
 *
 * It debounces and enforces the two-character floor itself, because each pause
 * costs one Jira call per instance: this is the difference between a search and
 * a denial-of-service against the owner's own sites.
 *
 * Focus never leaves the input. The active option is tracked by index and
 * mirrored into aria-activedescendant, which is what makes the pattern work for
 * a screen reader.
 */
export class ThatCombobox extends HTMLElement {
  static readonly debounceMs = 350;
  static readonly minQuery = 2;

  private input: HTMLInputElement | undefined;
  private popup: HTMLElement | undefined;
  private list: HTMLUListElement | undefined;
  private notice: HTMLElement | undefined;
  private footnote: HTMLElement | undefined;
  private hint: HTMLElement | undefined;
  private results: IssueHit[] = [];
  private failures: InstanceFailure[] = [];
  private disabledKeys = new Set<string>();
  private active = 0;
  private searching = false;
  private searched = false;
  private timer: number | undefined;

  connectedCallback(): void {
    this.className = "block";
    if (this.input) return;

    const label = document.createElement("label");
    label.className = "mb-1 block text-sm font-medium text-ink";
    label.textContent = this.getAttribute("label") ?? "";
    label.htmlFor = "that-combobox-input";

    const wrapper = document.createElement("div");
    wrapper.className = "relative";

    this.input = document.createElement("input");
    this.input.id = "that-combobox-input";
    this.input.type = "text";
    this.input.autocomplete = "off";
    this.input.role = "combobox";
    this.input.setAttribute("aria-autocomplete", "list");
    this.input.setAttribute("aria-expanded", "false");
    this.input.setAttribute("aria-controls", "that-combobox-listbox");
    this.input.placeholder = this.getAttribute("placeholder") ?? "";
    this.input.className =
      "w-full rounded-sm border border-edge px-3 py-1.5 text-sm " +
      "focus:border-ink focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";

    // The scrollable, positioned popup. role="listbox" and its id live on the
    // <ul> nested inside it, not on this element: "Searching…", the no-match
    // notice and the failure footnote are not options, and a non-option child
    // of role="listbox" sits outside that role's content model and may go
    // unexposed to a screen reader.
    this.popup = document.createElement("div");
    this.popup.className =
      "absolute inset-x-0 top-10 z-10 max-h-60 overflow-y-auto rounded-md " +
      "border border-edge bg-raised shadow-popover";
    this.popup.hidden = true;

    this.list = document.createElement("ul");
    this.list.id = "that-combobox-listbox";
    this.list.setAttribute("role", "listbox");

    this.notice = document.createElement("div");
    this.notice.hidden = true;

    this.footnote = document.createElement("p");
    this.footnote.className = "border-t border-edge px-3 py-2 text-xs text-ink-muted";
    this.footnote.hidden = true;

    this.popup.append(this.list, this.notice, this.footnote);

    this.hint = document.createElement("p");
    this.hint.className = "mt-1 text-xs text-ink-muted";
    this.hint.textContent = "Searches every instance. Two characters to start.";

    wrapper.append(this.input, this.popup);
    this.append(label, wrapper, this.hint);

    this.input.addEventListener("input", () => {
      this.scheduleSearch();
    });
    this.input.addEventListener("keydown", (event) => {
      this.onKeyDown(event);
    });
  }

  /** A pending debounce timer outlives removal from the DOM unless cleared
   *  here: otherwise it fires on a detached element, dispatches that-search, and
   *  today.ts starts a fan-out the user has no way left to see or abort. */
  disconnectedCallback(): void {
    window.clearTimeout(this.timer);
  }

  focusInput(): void {
    this.input?.focus();
  }

  setDisabledKeys(keys: Set<string>): void {
    this.disabledKeys = keys;
    this.renderOptions();
  }

  setResults(results: IssueHit[], failures: InstanceFailure[]): void {
    this.results = results;
    this.failures = failures;
    this.searching = false;
    this.searched = true;
    this.active = 0;
    this.renderOptions();
  }

  /** Clears the previous results rather than leaving them: a list that lags the
   *  query reads as a wrong answer, not as a stale one. */
  setSearching(): void {
    this.results = [];
    this.failures = [];
    this.searching = true;
    this.searched = false;
    this.active = 0;
    this.renderOptions();
  }

  setBusy(busy: boolean): void {
    if (this.input) this.input.disabled = busy;
    if (busy) this.close();
  }

  get query(): string {
    return this.input?.value.trim() ?? "";
  }

  private scheduleSearch(): void {
    window.clearTimeout(this.timer);
    const query = this.input?.value.trim() ?? "";

    if (query.length < ThatCombobox.minQuery) {
      this.close();
      if (this.hint) this.hint.hidden = false;
      return;
    }
    if (this.hint) this.hint.hidden = true;

    this.timer = window.setTimeout(() => {
      this.setSearching();
      this.dispatchEvent(new CustomEvent<string>("that-search", { detail: query }));
    }, ThatCombobox.debounceMs);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (this.results.length === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      this.active = (this.active + delta + this.results.length) % this.results.length;
      this.renderOptions();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const hit = this.results[this.active];
      if (hit) this.choose(hit);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      this.dispatchEvent(new CustomEvent("that-cancel"));
      return;
    }
    if (event.key === "Tab") {
      // No preventDefault: Tab must still move focus on. Only the popup closes.
      this.close();
    }
  }

  private choose(hit: IssueHit): void {
    if (this.disabledKeys.has(`${hit.instanceId}:${hit.key}`)) return;
    this.dispatchEvent(new CustomEvent<IssueHit>("that-select", { detail: hit }));
  }

  private close(): void {
    window.clearTimeout(this.timer);
    this.results = [];
    this.failures = [];
    this.searching = false;
    this.searched = false;
    if (this.popup) this.popup.hidden = true;
    this.input?.setAttribute("aria-expanded", "false");
    this.input?.removeAttribute("aria-activedescendant");
  }

  private noticeLine(text: string): HTMLElement {
    const line = document.createElement("p");
    line.className = "px-3 py-2 text-sm text-ink-muted";
    line.textContent = text;

    return line;
  }

  private renderOptions(): void {
    const popup = this.popup;
    const list = this.list;
    const notice = this.notice;
    const footnote = this.footnote;
    const input = this.input;
    if (!popup || !list || !notice || !footnote || !input) return;

    list.replaceChildren();
    notice.replaceChildren();
    notice.hidden = true;
    footnote.hidden = true;

    if (this.searching) {
      notice.append(this.noticeLine("Searching…"));
      notice.hidden = false;
      popup.hidden = false;
      input.setAttribute("aria-expanded", "true");
      input.removeAttribute("aria-activedescendant");

      return;
    }

    // Every instance failed: there is nothing to choose from, so this is an
    // error rather than a footnote under results.
    if (this.results.length === 0 && this.failures.length > 0) {
      const alert = document.createElement("that-alert");
      alert.setAttribute("tone", "error");
      alert.setAttribute("message", this.failures[0]?.error.message ?? "The search failed.");
      notice.append(alert);
      notice.hidden = false;
      popup.hidden = false;
      input.setAttribute("aria-expanded", "true");
      input.removeAttribute("aria-activedescendant");

      return;
    }

    if (this.searched && this.results.length === 0) {
      // The query is named back because a mistyped or over-narrow query is
      // usually why the list is empty, not because Jira itself has nothing.
      notice.append(this.noticeLine(`No issues match “${this.query}”.`));
      notice.hidden = false;
      popup.hidden = false;
      input.setAttribute("aria-expanded", "true");
      input.removeAttribute("aria-activedescendant");

      return;
    }

    const items: HTMLLIElement[] = [];
    this.results.forEach((hit, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.id = `that-combobox-option-${index}`;
      option.setAttribute("role", "option");
      // Not part of the tab order: Tab must leave the popup by moving focus
      // out of the input, not by walking into these buttons one at a time.
      option.tabIndex = -1;
      const pinned = this.disabledKeys.has(`${hit.instanceId}:${hit.key}`);
      // aria-disabled rather than the disabled attribute: a disabled button is
      // skipped by a screen reader entirely, and "already pinned" is worth
      // announcing rather than hiding. choose() below is what actually refuses
      // the pin — aria-disabled would not stop a click or an Enter keypress.
      option.setAttribute("aria-disabled", pinned ? "true" : "false");
      option.setAttribute("aria-selected", index === this.active ? "true" : "false");
      option.className =
        "flex w-full items-baseline gap-3 px-3 py-2 text-left " +
        (index === this.active ? "bg-surface " : "") +
        (pinned ? "text-ink-muted" : "");

      // Dot and name both: unlike a pinned row, a search result is scanned
      // across instances the user may not recognise yet, where a hue alone
      // cannot disambiguate — the deliberate exception recorded alongside the
      // dot-alone rule in docs/superpowers/specs/2026-08-20-pinned-issues-design.md.
      const dot = document.createElement("span");
      paintInstanceDot(dot, hit.instancePosition, hit.instanceName);

      const instance = document.createElement("span");
      instance.className = "shrink-0 text-sm text-ink-muted";
      instance.textContent = hit.instanceName;

      const key = document.createElement("span");
      key.className = "shrink-0 font-mono text-sm font-medium";
      key.textContent = hit.key;

      const summary = document.createElement("span");
      summary.className = "flex-1 text-sm";
      summary.textContent = hit.summary;

      const tail = document.createElement("span");
      tail.className = "shrink-0 text-xs text-ink-muted";
      tail.textContent = pinned ? "Pinned" : hit.status;

      option.append(dot, instance, key, summary, tail);
      option.addEventListener("click", () => {
        this.choose(hit);
      });

      const item = document.createElement("li");
      item.append(option);
      items.push(item);
      list.append(item);
    });

    if (this.failures.length > 0) {
      footnote.textContent = `${this.failures.map((f) => f.instanceName).join(", ")} could not be searched.`;
      footnote.hidden = false;
    }

    const open = this.results.length > 0 || this.failures.length > 0;
    popup.hidden = !open;
    input.setAttribute("aria-expanded", open ? "true" : "false");
    if (open && this.results.length > 0) {
      input.setAttribute("aria-activedescendant", `that-combobox-option-${this.active}`);
      // Focus never leaves the input, so the browser will not scroll the
      // active option into view on its own — and with up to searchLimit×N
      // instances of results stacked in a max-h-60 popup, ↓ past the visible
      // rows would otherwise move aria-activedescendant to a row nobody sees.
      items[this.active]?.scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }
}

customElements.define("that-combobox", ThatCombobox);
