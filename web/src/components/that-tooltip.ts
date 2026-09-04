/**
 * A tooltip in the top layer, per decision 7 of the visual language: a
 * tooltip parented to its trigger can be clipped by any ancestor that gains
 * `overflow: hidden`, and that failure is invisible until the day it is not.
 * A `popover` sidesteps it entirely — the top layer sits outside every
 * ancestor's clipping and stacking context, which is also why position is
 * computed here against the trigger's bounding box rather than left to CSS:
 * the top layer removes the element from the trigger's coordinate space.
 *
 * It is never the accessible name. The trigger keeps its own `aria-label`
 * regardless of this component's presence, because a tooltip that only
 * appears on hover reaches neither a keyboard nor a screen reader on its
 * own — so nothing here sets ARIA on the trigger, ever.
 */
export class ThatTooltip extends HTMLElement {
  private trigger: HTMLElement | null = null;
  private readonly onShow = (): void => this.reveal();
  private readonly onHide = (): void => this.hidePopover();

  connectedCallback(): void {
    this.setAttribute("popover", "manual");
    this.className =
      "bg-rail text-rail-ink shadow-popover rounded-xs px-2 py-1 text-sm whitespace-nowrap";

    const id = this.getAttribute("for");
    const trigger = id ? document.getElementById(id) : null;
    if (!trigger) return;
    this.trigger = trigger;

    trigger.addEventListener("pointerenter", this.onShow);
    trigger.addEventListener("pointerleave", this.onHide);
    trigger.addEventListener("focus", this.onShow);
    trigger.addEventListener("blur", this.onHide);
  }

  disconnectedCallback(): void {
    const trigger = this.trigger;
    if (!trigger) return;

    trigger.removeEventListener("pointerenter", this.onShow);
    trigger.removeEventListener("pointerleave", this.onHide);
    trigger.removeEventListener("focus", this.onShow);
    trigger.removeEventListener("blur", this.onHide);
  }

  private reveal(): void {
    const trigger = this.trigger;
    if (!trigger) return;

    // showPopover() throws on a popover that is already open — reachable
    // when a trigger is both hovered and focused, such as a mouse resting on
    // it after a Tab landed there first.
    if (!this.matches(":popover-open")) this.showPopover();

    const box = trigger.getBoundingClientRect();
    const gap = 6;
    const left =
      this.getAttribute("anchor") === "end"
        ? box.right - this.offsetWidth
        : box.left + box.width / 2 - this.offsetWidth / 2;

    // All four longhands, not just top/left: the UA stylesheet gives an open
    // popover `inset: 0` for its default centred position, and leaving right
    // or bottom set would fight the explicit placement on some engines.
    this.style.top = `${box.bottom + gap}px`;
    this.style.left = `${left}px`;
    this.style.right = "auto";
    this.style.bottom = "auto";
    this.style.margin = "0";
  }
}

customElements.define("that-tooltip", ThatTooltip);
