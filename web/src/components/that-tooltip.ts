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
  private observer: MutationObserver | undefined;
  private readonly onShow = (): void => this.reveal();
  // Both halves of a pair can fire for one release, when a trigger is hovered
  // and focused at once, so each call can find the popover already in the
  // state it wants. Neither showPopover() nor hidePopover() throws in that
  // case in either target browser — measured on 2026-09-04, against the same
  // Chromium and Firefox the suite runs — so these two guards are cheap
  // insurance against a future engine that follows the specification more
  // literally, not a fix for anything observed.
  private readonly onHide = (): void => {
    if (this.matches(":popover-open")) this.hidePopover();
  };

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

    // reveal() places the box once, at show time, from the trigger's rect and
    // this element's own width. A consumer can repaint this element's text —
    // and so its width — while the popover is still open under the pointer:
    // that-ticket-row's pin control does exactly that, from "pin ticket" to
    // "unpin ticket", on the same click that leaves the tooltip open.
    // Chromium happens to focus a clicked button, which re-runs onShow and
    // hides the seam; Firefox does not focus a button on click, so the stale
    // box is real there, under the primary target. Watching the text directly
    // — rather than hiding on click, which would fight the hover-driven
    // tests that expect the tooltip to still be open right after — is what
    // makes both browsers agree.
    this.observer = new MutationObserver(() => {
      if (this.matches(":popover-open")) this.reveal();
    });
    this.observer.observe(this, { characterData: true, childList: true, subtree: true });
  }

  disconnectedCallback(): void {
    this.observer?.disconnect();
    this.observer = undefined;

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

    // See onHide: neither call throws on a redundant transition in either
    // target browser, and this guard is the same insurance.
    if (!this.matches(":popover-open")) this.showPopover();

    const box = trigger.getBoundingClientRect();
    const gap = 7;
    const left =
      this.getAttribute("anchor") === "end"
        ? box.right - this.offsetWidth
        : box.left + box.width / 2 - this.offsetWidth / 2;

    // Above by default — the drawing's .tip — falling back below when there
    // is not enough room, the drawing's own .tip.below (prototype line 144).
    // #content starts flush against the window's top edge (#3's), so a
    // trigger at the top of the content column, or Week's own header arrows,
    // would otherwise open partly off-screen.
    const top =
      box.top - this.offsetHeight - gap < 0
        ? box.bottom + gap
        : box.top - this.offsetHeight - gap;

    // All four longhands, not just top/left: the UA stylesheet gives an open
    // popover `inset: 0` for its default centred position, and leaving right
    // or bottom set would fight the explicit placement on some engines.
    this.style.top = `${top}px`;
    this.style.left = `${left}px`;
    this.style.right = "auto";
    this.style.bottom = "auto";
    this.style.margin = "0";
  }
}

customElements.define("that-tooltip", ThatTooltip);
