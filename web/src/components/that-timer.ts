import { iconMarkup } from "../icons";
import { isRunningTicket, onTimerChanged, startTimer, stopTimer } from "../timer-state";

/** One id per timer control mounted, so its tooltip's `for` can resolve it on
 *  a page holding many rows — the same reasoning that-ticket-row.ts's own
 *  pinTriggerSequence gives (#143). */
let timerTriggerSequence = 0;

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
  private tooltip: HTMLElement | undefined;
  private readonly triggerId = `that-timer-${++timerTriggerSequence}`;
  private stopListening: (() => void) | undefined;
  // What paint() last drew, so the once-a-second tick — which fires the same
  // onTimerChanged event a start, stop or switch does — does not rewrite the
  // trigger's innerHTML (an SVG re-parse) every second for a control whose
  // own mine() never moves on a tick. undefined forces the first paint().
  private renderedMine: boolean | undefined;

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

  // that-table moves rows with moveBefore; without this no-op the move
  // reconnects this element and render() replaces a button that may hold focus.
  connectedMoveCallback(): void {}

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
    trigger.id = this.triggerId;
    // The pin control's own class list (that-ticket-row.ts's
    // appendPinControl), a 34px square wash button, minus its own resting
    // colour — that toggles between text-ink-muted and text-running below.
    trigger.className =
      "hover:bg-hover focus-visible:bg-hover flex h-[34px] w-[34px] shrink-0 cursor-pointer " +
      "items-center justify-center rounded-sm hover:text-primary focus-visible:text-primary";
    trigger.addEventListener("click", () => {
      void this.toggle();
    });

    // Follows the pin control's own button-plus-tooltip pattern (#143):
    // anchor="end" for a trailing control, text set alongside the aria-label
    // in paint() below.
    const tooltip = document.createElement("that-tooltip");
    tooltip.setAttribute("for", this.triggerId);
    tooltip.setAttribute("anchor", "end");

    this.replaceChildren(trigger, tooltip);
    this.trigger = trigger;
    this.tooltip = tooltip;
    this.renderedMine = undefined;
    this.paint();
  }

  private paint(): void {
    const trigger = this.trigger;
    const tooltip = this.tooltip;
    if (!trigger || !tooltip) return;

    const running = this.mine();
    if (running === this.renderedMine) return;
    this.renderedMine = running;

    const label = running ? "stop timer" : "start timer";
    trigger.innerHTML = iconMarkup(running ? "stop" : "play");
    trigger.setAttribute("aria-label", label);
    tooltip.textContent = label;
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
      // Swallowed rather than surfaced: this button paints from
      // isRunningTicket() alone, never optimistically, so a failed call left
      // no state here to revert — the control just stays exactly as it was
      // and a retry is another click away. Whether a failure deserves its own
      // on-screen message is a design question the timer design does not
      // answer, so this does not invent one.
    }
  }
}

customElements.define("that-timer", ThatTimer);
