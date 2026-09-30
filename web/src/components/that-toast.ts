import { iconMarkup } from "../icons";
import { toneMark } from "./that-alert";

/**
 * One toast (#123): that-alert's row — the tone's mark, the words in ordinary
 * ink — with its list, a Dismiss button, and, for a success, the countdown line
 * whose animation is the toast's life. Not a live region: the host is.
 * `block` is the dialog-block variant: sized by its host, and no countdown,
 * because a block leaves only when closed, retried or its dialog closes.
 */
export class ThatToast extends HTMLElement {
  items: string[] = [];

  connectedCallback(): void {
    if (this.childElementCount > 0) return;
    const tone = this.getAttribute("tone") ?? "warning";
    const block = this.hasAttribute("block");

    this.className =
      "bg-raised text-ink shadow-toast block rounded-md pt-[11px] pr-3 pb-[11px] pl-[14px] " +
      (block ? "w-full" : "w-[320px]");

    const row = document.createElement("div");
    row.className = "flex items-start gap-[10px] text-base leading-5";
    const mark = toneMark(tone);
    mark.classList.replace("leading-6", "leading-5");
    const message = document.createElement("span");
    message.className = "min-w-0 flex-1";
    message.textContent = this.getAttribute("message") ?? "";
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.setAttribute("aria-label", "Dismiss");
    dismiss.className =
      "text-ink-muted hover:text-ink focus-visible:text-ink -my-0.5 flex shrink-0 cursor-pointer items-center justify-center rounded-sm";
    dismiss.innerHTML = iconMarkup("close", 16);
    dismiss.addEventListener("click", () => this.dismiss());
    row.append(mark, message, dismiss);
    this.append(row);

    if (this.items.length > 0) {
      const list = document.createElement("ul");
      list.className = "text-ink-muted mt-2 ml-7 space-y-1 text-sm";
      for (const item of this.items) {
        const li = document.createElement("li");
        li.textContent = item;
        list.append(li);
      }
      this.append(list);
    }

    if (tone === "success" && !block) {
      const track = document.createElement("div");
      track.dataset["countdown"] = "";
      track.className = "bg-edge mt-[9px] h-[2px] overflow-hidden rounded-full";
      const fill = document.createElement("span");
      fill.className = "bg-ink-muted block h-full";
      fill.addEventListener("animationend", () => this.dismiss());
      track.append(fill);
      this.append(track);
    }
  }

  dismiss(): void {
    this.dispatchEvent(new Event("toast-dismissed", { bubbles: true }));
    this.remove();
  }
}

customElements.define("that-toast", ThatToast);
