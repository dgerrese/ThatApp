import "./that-toast";
import type { ThatToast } from "./that-toast";

/**
 * The toast stack (#123): one host, in the markup from first render so the
 * live region exists before any message does, and a manual popover so it can
 * sit in the top layer. A dialog opened with showModal() makes everything
 * outside its own subtree inert — a popover shown afterwards is drawn above the
 * backdrop but still cannot be clicked — so while one is open the host moves
 * inside it, and moves back to the body when that dialog closes.
 * Hidden while empty.
 */
export class ThatToasts extends HTMLElement {
  constructor() {
    super();
    this.addEventListener("toast-dismissed", () => {
      queueMicrotask(() => {
        if (this.childElementCount === 0 && this.matches(":popover-open")) this.hidePopover();
      });
    });
    // `close` does not bubble, so it is caught in the capture phase.
    document.addEventListener(
      "close",
      (event) => {
        if (event.target === this.parentElement)
          this.moveTo(document.body, this.childElementCount > 0);
      },
      true,
    );
  }

  add(tone: string, message: string, items: string[] = []): HTMLElement {
    this.moveTo(document.querySelector<HTMLElement>("dialog:modal") ?? document.body, true);

    const toast = document.createElement("that-toast") as ThatToast;
    toast.setAttribute("tone", tone);
    toast.setAttribute("message", message);
    toast.items = items;
    this.append(toast);
    return toast;
  }

  // Moving a popover hides it, so it is shown again when it should be up.
  private moveTo(parent: HTMLElement, visible: boolean): void {
    if (this.parentElement !== parent) parent.append(this);
    if (visible && !this.matches(":popover-open")) this.showPopover();
  }
}

customElements.define("that-toasts", ThatToasts);
