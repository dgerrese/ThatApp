const VARIANTS: Record<string, string> = {
  primary: "bg-neutral-900 text-white hover:bg-neutral-700",
  secondary: "bg-white text-neutral-900 border border-neutral-300 hover:bg-neutral-50",
  danger: "bg-red-700 text-white hover:bg-red-600",
};

/**
 * Wraps a real <button> rather than making the host focusable itself, so that
 * keyboard activation and the disabled state come from the platform instead of
 * being reimplemented. The inner button is deliberately type="button": this
 * component does not participate in form submission.
 */
export class WdButton extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["variant", "disabled", "label"];
  }

  private button: HTMLButtonElement | undefined;

  connectedCallback(): void {
    if (!this.button) {
      this.button = document.createElement("button");
      this.button.type = "button";
      this.append(this.button);
    }
    this.applyAttributes();
  }

  attributeChangedCallback(): void {
    if (this.button) {
      this.applyAttributes();
    }
  }

  private applyAttributes(): void {
    const button = this.button;
    if (!button) return;

    const variant = this.getAttribute("variant") ?? "secondary";
    const base =
      "inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium " +
      "disabled:cursor-not-allowed disabled:opacity-50";
    button.className = `${base} ${VARIANTS[variant] ?? VARIANTS["secondary"] ?? ""}`;
    button.disabled = this.hasAttribute("disabled");
    button.textContent = this.getAttribute("label") ?? "";
  }
}

customElements.define("wd-button", WdButton);
