import { iconMarkup, type IconName } from "../icons";

/**
 * A status message. The approved design does not put these in a tinted box: the
 * tone colours a mark, the words stay in ordinary ink, and the mark is what
 * carries the meaning when colour cannot — a red-green deficiency, a monochrome
 * screen, or a tone the reader has not learnt yet.
 *
 * role="status" rather than "alert": these report the outcome of something the
 * user just did, so they should not interrupt a screen reader mid-sentence.
 */
const TONES: Record<string, { colour: string; icon: IconName; label: string }> = {
  success: { colour: "text-running", icon: "success", label: "Done" },
  warning: { colour: "text-pending", icon: "warning", label: "Warning" },
  error: { colour: "text-failed", icon: "failed", label: "Failed" },
};

export class ThatAlert extends HTMLElement {
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

    this.className = "text-base text-ink flex items-start gap-3";

    const mark = document.createElement("span");
    mark.className = `shrink-0 leading-6 ${tone.colour}`;
    mark.innerHTML = iconMarkup(tone.icon);
    // The mark is decorative on its own account (icons.ts sets aria-hidden);
    // the word it stands for is not, so the wrapper carries it instead.
    mark.setAttribute("role", "img");
    mark.setAttribute("aria-label", tone.label);

    const message = document.createElement("span");
    message.textContent = this.getAttribute("message") ?? "";

    this.replaceChildren(mark, message);
  }
}

customElements.define("that-alert", ThatAlert);
