/**
 * One issue: its key, its summary and its status. Light DOM, so #7 and #8 can
 * append a timer and a duration field to it without a slot.
 *
 * The key is set in the body face rather than a monospace one. Space Grotesk
 * carries tabular figures, so keys still align in a column, and a second family
 * loaded for four characters a row costs bytes the 14kB budget would notice.
 *
 * That column is a fixed width rather than the key's own: it is what makes the
 * summaries start at the same x down the whole card, which is the alignment the
 * design draws.
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
      this.body.className = "flex min-w-0 flex-1 items-baseline justify-between gap-3";
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
    // min-w-0 and flex-1 are load-bearing: a flex item's floor is its
    // min-content width, so without them this box refuses to shrink, the
    // summary's truncate never engages, and a long title pushes the status
    // clean past the card's edge on a narrow viewport.
    identity.className = "flex min-w-0 flex-1 items-baseline gap-3";
    identity.append(this.keyLabel(url), this.summarySpan());

    const status = document.createElement("span");
    status.className = "text-ink-muted shrink-0 text-sm";
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
      span.className = "wd-key wd-tnum text-ink-muted";
      span.textContent = key;

      return span;
    }

    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    // Without noopener the opened page gets a window.opener handle back here.
    link.rel = "noopener";
    link.className = "wd-key wd-tnum text-primary hover:underline";
    link.textContent = key;

    return link;
  }

  private summarySpan(): HTMLElement {
    const summary = document.createElement("span");
    summary.className = "min-w-0 flex-1 truncate text-lg";
    summary.textContent = this.getAttribute("summary") ?? "";

    return summary;
  }
}

customElements.define("wd-ticket-row", WdTicketRow);
