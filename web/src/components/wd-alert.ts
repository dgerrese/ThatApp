/**
 * A status message. The approved design does not put these in a tinted box: the
 * tone colours a mark, the words stay in ordinary ink, and the mark is what
 * carries the meaning when colour cannot — a red-green deficiency, a monochrome
 * screen, or a tone the reader has not learnt yet.
 *
 * role="status" rather than "alert": these report the outcome of something the
 * user just did, so they should not interrupt a screen reader mid-sentence.
 */
const TONES: Record<string, { colour: string; mark: string; label: string }> = {
  success: { colour: "text-running", mark: "●", label: "Done" },
  warning: { colour: "text-pending", mark: "▲", label: "Warning" },
  error: { colour: "text-failed", mark: "▲", label: "Failed" },
};

export class WdAlert extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["tone", "message"];
  }

  connectedCallback(): void {
    this.setAttribute("role", "status");
    this.render();
  }

  attributeChangedCallback(): void {
    this.render();
  }

  private render(): void {
    const tone = TONES[this.getAttribute("tone") ?? "warning"] ?? TONES["warning"];
    if (!tone) return;

    this.className = "text-md text-ink flex items-start gap-3";

    const mark = document.createElement("span");
    mark.className = `shrink-0 text-sm leading-6 font-bold ${tone.colour}`;
    mark.textContent = tone.mark;
    // The glyph is decorative; the word it stands for is not, and a screen
    // reader would otherwise announce "black up-pointing triangle".
    mark.setAttribute("role", "img");
    mark.setAttribute("aria-label", tone.label);

    const message = document.createElement("span");
    message.textContent = this.getAttribute("message") ?? "";

    this.replaceChildren(mark, message);
  }
}

customElements.define("wd-alert", WdAlert);
