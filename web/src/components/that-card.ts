/**
 * A titled container. Light DOM: children stay in the document, so Tailwind
 * utilities on them keep working and the card adds only its own wrapper classes.
 *
 * Borderless, on a soft shadow — each section reads as a distinct object without
 * a rule drawn around it.
 */
export class ThatCard extends HTMLElement {
  connectedCallback(): void {
    this.className = "bg-raised shadow-card block rounded-2xl px-5 py-4";

    const heading = this.getAttribute("heading");
    if (heading && !this.querySelector("[data-card-heading]")) {
      const title = document.createElement("h2");
      title.dataset["cardHeading"] = "";
      // ink-muted, not ink-faint: this is read as words, and ink-faint clears
      // only the non-text contrast floor.
      title.className = "text-ink-muted mb-1 text-xs font-bold tracking-[0.16em] uppercase";
      title.textContent = heading;
      this.prepend(title);
    }
  }
}

customElements.define("that-card", ThatCard);
