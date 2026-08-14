/**
 * A titled container. Light DOM: children stay in the document, so Tailwind
 * utilities on them keep working and the card adds only its own wrapper classes.
 */
export class WdCard extends HTMLElement {
  connectedCallback(): void {
    this.className = "block rounded-lg border border-neutral-200 bg-white p-4 shadow-sm";

    const heading = this.getAttribute("heading");
    if (heading && !this.querySelector("[data-card-heading]")) {
      const title = document.createElement("h2");
      title.dataset["cardHeading"] = "";
      title.className = "mb-3 text-lg font-medium";
      title.textContent = heading;
      this.prepend(title);
    }
  }
}

customElements.define("wd-card", WdCard);
