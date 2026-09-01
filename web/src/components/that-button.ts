const VARIANTS: Record<string, string> = {
  primary: "bg-primary text-primary-ink hover:opacity-90",
  // A ghost, not an outlined box: the design keeps quiet actions quiet and
  // spends its one loud colour on Push.
  secondary: "text-ink-muted hover:bg-surface hover:text-ink",
  danger: "bg-failed text-state-ink hover:opacity-90",
};

/**
 * Wraps a real <button> rather than making the host focusable itself, so that
 * keyboard activation and the disabled state come from the platform instead of
 * being reimplemented. The inner button is deliberately type="button": this
 * component does not participate in form submission.
 */
export class ThatButton extends HTMLElement {
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
    // cursor-pointer is not redundant. A native <button> resolves to the
    // default arrow, and Tailwind v4's Preflight deliberately leaves it that
    // way, so without this every button in the app looks unclickable. The
    // disabled variant outranks it on specificity, so a dead button still says
    // so.
    const base =
      "inline-flex cursor-pointer items-center rounded-[9px] px-3 py-1.5 text-base font-bold " +
      "disabled:cursor-not-allowed disabled:opacity-50";
    button.className = `${base} ${VARIANTS[variant] ?? VARIANTS["secondary"] ?? ""}`;
    button.disabled = this.hasAttribute("disabled");
    button.textContent = this.getAttribute("label") ?? "";
  }
}

customElements.define("that-button", ThatButton);
