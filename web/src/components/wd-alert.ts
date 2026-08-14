const TONES: Record<string, string> = {
  success: "border-green-300 bg-green-50 text-green-900",
  error: "border-red-300 bg-red-50 text-red-900",
  warning: "border-amber-300 bg-amber-50 text-amber-900",
};

/**
 * A status message. role="status" rather than "alert": these report the outcome
 * of something the user just did, so they should not interrupt a screen reader
 * mid-sentence.
 */
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
    const tone = this.getAttribute("tone") ?? "warning";
    this.className = `block rounded-md border px-3 py-2 text-sm ${TONES[tone] ?? TONES["warning"] ?? ""}`;
    this.textContent = this.getAttribute("message") ?? "";
  }
}

customElements.define("wd-alert", WdAlert);
