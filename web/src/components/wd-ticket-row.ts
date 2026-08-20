/**
 * One issue: its key, its summary and its status. Light DOM, so #7 and #8 can
 * append a timer and a duration field to it without a slot.
 *
 * Its own content lives in a wrapper the component owns and re-renders, rather
 * than in the host's children — the same shape wd-button uses — so that anything
 * a later ticket appends survives an attribute change.
 */
export class WdTicketRow extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["key", "summary", "status", "url"];
  }

  private body: HTMLElement | undefined;

  connectedCallback(): void {
    this.className = "flex items-baseline gap-3 py-3";

    if (!this.body) {
      this.body = document.createElement("div");
      this.body.className = "flex flex-1 items-baseline justify-between gap-3";
      this.append(this.body);
    }
    this.render();
  }

  attributeChangedCallback(): void {
    if (this.body) {
      this.render();
    }
  }

  private render(): void {
    const body = this.body;
    if (!body) return;

    const url = this.getAttribute("url") ?? "";

    const identity = document.createElement("div");
    identity.className = "flex items-baseline gap-3";
    identity.append(this.keyLabel(url), this.summarySpan());

    const status = document.createElement("span");
    status.className = "shrink-0 text-xs text-ink-muted";
    status.textContent = this.getAttribute("status") ?? "";

    body.replaceChildren(identity, status);
  }

  /**
   * An anchor only when there is somewhere to go. An instance migrated from a
   * gateway URL has no site, and an anchor with an empty href navigates to the
   * current page instead of doing nothing.
   */
  private keyLabel(url: string): HTMLElement {
    const key = this.getAttribute("key") ?? "";

    if (url === "") {
      const span = document.createElement("span");
      span.className = "font-mono text-sm font-medium text-ink-muted";
      span.textContent = key;

      return span;
    }

    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    // Without noopener the opened page gets a window.opener handle back here.
    link.rel = "noopener";
    link.className = "font-mono text-sm font-medium text-link underline";
    link.textContent = key;

    return link;
  }

  private summarySpan(): HTMLElement {
    const summary = document.createElement("span");
    summary.className = "text-sm";
    summary.textContent = this.getAttribute("summary") ?? "";

    return summary;
  }
}

customElements.define("wd-ticket-row", WdTicketRow);
