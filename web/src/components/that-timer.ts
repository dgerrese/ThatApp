import { iconMarkup } from "../icons";
import { isRunningTicket, onTimerChanged, startTimer, stopTimer } from "../timer-state";

/**
 * The row's play/stop button — decision 1 of the timer design. Light DOM, in
 * a wrapper of its own rather than inside that-ticket-row's shadow, because
 * there is none: this element and the row it sits in share one document.
 *
 * It never paints optimistically: its only source of truth is
 * `isRunningTicket`, read fresh on every timer-changed announcement, so a
 * failed start or stop leaves the button exactly as it was rather than
 * needing a state to revert.
 */
export class ThatTimer extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["instance-id", "key"];
  }

  private trigger: HTMLButtonElement | undefined;
  private stopListening: (() => void) | undefined;

  connectedCallback(): void {
    this.render();
    this.stopListening = onTimerChanged(() => {
      this.paint();
    });
  }

  disconnectedCallback(): void {
    this.stopListening?.();
    this.stopListening = undefined;
  }

  attributeChangedCallback(): void {
    if (this.trigger) this.paint();
  }

  private mine(): boolean {
    return isRunningTicket(
      Number(this.getAttribute("instance-id") ?? "0"),
      this.getAttribute("key") ?? "",
    );
  }

  private render(): void {
    const trigger = document.createElement("button");
    trigger.type = "button";
    // The pin control's own class list (that-ticket-row.ts's
    // appendPinControl), a 34px square wash button, minus its own resting
    // colour — that toggles between text-ink-muted and text-running below.
    trigger.className =
      "hover:bg-hover focus-visible:bg-hover flex h-[34px] w-[34px] shrink-0 cursor-pointer " +
      "items-center justify-center rounded-sm hover:text-primary focus-visible:text-primary";
    trigger.addEventListener("click", () => {
      void this.toggle();
    });
    this.replaceChildren(trigger);
    this.trigger = trigger;
    this.paint();
  }

  private paint(): void {
    const trigger = this.trigger;
    if (!trigger) return;

    const running = this.mine();
    trigger.innerHTML = iconMarkup(running ? "stop" : "play");
    trigger.setAttribute("aria-label", running ? "stop timer" : "start timer");
    trigger.classList.toggle("text-running", running);
    trigger.classList.toggle("text-ink-muted", !running);
  }

  private async toggle(): Promise<void> {
    try {
      if (this.mine()) {
        await stopTimer();
      } else {
        await startTimer(
          Number(this.getAttribute("instance-id") ?? "0"),
          this.getAttribute("key") ?? "",
        );
      }
    } catch {
      // Nothing to undo: the button paints from isRunningTicket() alone, and
      // a failed call never touched it in the first place.
    }
  }
}

customElements.define("that-timer", ThatTimer);
