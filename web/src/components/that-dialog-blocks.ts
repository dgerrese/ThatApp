import "./that-toast";
import type { ThatToast } from "./that-toast";

/**
 * The entry dialog's blocks (#123): messages drawn above the dialog's box, its
 * width, stacking upward. The host lives inside the dialog, because a modal
 * dialog makes everything outside its subtree inert and a Dismiss must be
 * clickable. It is `fixed` rather than absolute so the dialog's own
 * `overflow: auto` cannot clip what is drawn beyond its top edge, and is
 * positioned from the dialog's box on every size change (the entry list loads
 * after open and the dialog is centred, so its top moves).
 */
export class ThatDialogBlocks extends HTMLElement {
  private dialog: HTMLDialogElement | undefined;
  private readonly observer = new ResizeObserver(() => {
    this.place();
  });

  constructor() {
    super();
    this.addEventListener("toast-dismissed", () => {
      queueMicrotask(() => {
        if (this.childElementCount === 0) this.hidden = true;
      });
    });
  }

  connectedCallback(): void {
    this.setAttribute("role", "status");
    this.setAttribute("aria-live", "polite");
    this.className = "fixed m-0 flex flex-col gap-2 p-0";
    this.hidden = true;
    window.addEventListener("resize", this.onResize);
  }

  disconnectedCallback(): void {
    this.observer.disconnect();
    window.removeEventListener("resize", this.onResize);
  }

  attach(dialog: HTMLDialogElement): void {
    this.dialog = dialog;
    this.observer.disconnect();
    this.observer.observe(dialog);
    this.place();
  }

  add(tone: string, message: string): void {
    this.hidden = false;
    const block = document.createElement("that-toast") as ThatToast;
    block.setAttribute("block", "");
    block.setAttribute("tone", tone);
    block.setAttribute("message", message);
    this.append(block);
    this.place();
  }

  clear(): void {
    this.replaceChildren();
    this.hidden = true;
  }

  private readonly onResize = (): void => {
    this.place();
  };

  private place(): void {
    const rect = this.dialog?.getBoundingClientRect();
    if (!rect) return;
    this.style.left = `${String(rect.left)}px`;
    this.style.width = `${String(rect.width)}px`;
    this.style.bottom = `${String(window.innerHeight - rect.top + 8)}px`;
  }
}

customElements.define("that-dialog-blocks", ThatDialogBlocks);
