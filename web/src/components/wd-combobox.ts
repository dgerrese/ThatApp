import "./wd-alert";

import type { InstanceFailure, IssueHit } from "../types";

/**
 * A searchable select. Light DOM, like every wd-* component.
 *
 * It debounces and enforces the two-character floor itself, because each pause
 * costs one Jira call per instance: this is the difference between a search and
 * a denial-of-service against the owner's own sites.
 *
 * Focus never leaves the input. The active option is tracked by index and
 * mirrored into aria-activedescendant, which is what makes the pattern work for
 * a screen reader.
 */
export class WdCombobox extends HTMLElement {
  static readonly debounceMs = 350;
  static readonly minQuery = 2;

  private input: HTMLInputElement | undefined;
  private listbox: HTMLElement | undefined;
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
    label.htmlFor = "wd-combobox-input";

    const wrapper = document.createElement("div");
    wrapper.className = "relative";

    this.input = document.createElement("input");
    this.input.id = "wd-combobox-input";
    this.input.type = "text";
    this.input.autocomplete = "off";
    this.input.role = "combobox";
    this.input.setAttribute("aria-autocomplete", "list");
    this.input.setAttribute("aria-expanded", "false");
    this.input.setAttribute("aria-controls", "wd-combobox-listbox");
    this.input.placeholder = this.getAttribute("placeholder") ?? "";
    this.input.className =
      "w-full rounded-md border border-edge px-3 py-1.5 text-sm " +
      "focus:border-ink focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";

    this.listbox = document.createElement("div");
    this.listbox.id = "wd-combobox-listbox";
    this.listbox.setAttribute("role", "listbox");
    this.listbox.className =
      "absolute inset-x-0 top-10 z-10 max-h-60 overflow-y-auto rounded-md " +
      "border border-edge bg-raised shadow-lg";
    this.listbox.hidden = true;

    this.hint = document.createElement("p");
    this.hint.className = "mt-1 text-xs text-ink-muted";
    this.hint.textContent = "Searches every instance. Two characters to start.";

    wrapper.append(this.input, this.listbox);
    this.append(label, wrapper, this.hint);

    this.input.addEventListener("input", () => {
      this.scheduleSearch();
    });
    this.input.addEventListener("keydown", (event) => {
      this.onKeyDown(event);
    });
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

    if (query.length < WdCombobox.minQuery) {
      this.close();
      if (this.hint) this.hint.hidden = false;
      return;
    }
    if (this.hint) this.hint.hidden = true;

    this.timer = window.setTimeout(() => {
      this.setSearching();
      this.dispatchEvent(new CustomEvent<string>("search", { detail: query }));
    }, WdCombobox.debounceMs);
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
      this.dispatchEvent(new CustomEvent("cancel"));
    }
  }

  private choose(hit: IssueHit): void {
    if (this.disabledKeys.has(`${hit.instanceId}:${hit.key}`)) return;
    this.dispatchEvent(new CustomEvent<IssueHit>("select", { detail: hit }));
  }

  private close(): void {
    this.results = [];
    this.failures = [];
    this.searching = false;
    this.searched = false;
    if (this.listbox) this.listbox.hidden = true;
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
    const listbox = this.listbox;
    const input = this.input;
    if (!listbox || !input) return;

    listbox.replaceChildren();

    if (this.searching) {
      listbox.append(this.noticeLine("Searching…"));
      listbox.hidden = false;
      input.setAttribute("aria-expanded", "true");
      input.removeAttribute("aria-activedescendant");

      return;
    }

    // Every instance failed: there is nothing to choose from, so this is an
    // error rather than a footnote under results.
    if (this.results.length === 0 && this.failures.length > 0) {
      const alert = document.createElement("wd-alert");
      alert.setAttribute("tone", "error");
      alert.setAttribute("message", this.failures[0]?.error.message ?? "The search failed.");
      listbox.append(alert);
      listbox.hidden = false;
      input.setAttribute("aria-expanded", "true");
      input.removeAttribute("aria-activedescendant");

      return;
    }

    if (this.searched && this.results.length === 0) {
      // The query is named back because a mistyped or over-narrow query is
      // usually why the list is empty, not because Jira itself has nothing.
      listbox.append(this.noticeLine(`No issues match “${this.query}”.`));
      listbox.hidden = false;
      input.setAttribute("aria-expanded", "true");
      input.removeAttribute("aria-activedescendant");

      return;
    }

    this.results.forEach((hit, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.id = `wd-combobox-option-${index}`;
      option.setAttribute("role", "option");
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

      option.append(instance, key, summary, tail);
      option.addEventListener("click", () => {
        this.choose(hit);
      });
      listbox.append(option);
    });

    if (this.failures.length > 0) {
      const failed = document.createElement("p");
      failed.className = "border-t border-edge px-3 py-2 text-xs text-ink-muted";
      failed.textContent = `${this.failures.map((f) => f.instanceName).join(", ")} could not be searched.`;
      listbox.append(failed);
    }

    const open = this.results.length > 0 || this.failures.length > 0;
    listbox.hidden = !open;
    input.setAttribute("aria-expanded", open ? "true" : "false");
    if (open && this.results.length > 0) {
      input.setAttribute("aria-activedescendant", `wd-combobox-option-${this.active}`);
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }
}

customElements.define("wd-combobox", WdCombobox);
