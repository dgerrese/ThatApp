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
  // CB#107: a focus reveals the tooltip only when it is keyboard focus. The
  // browser already tells the two apart, and showModal() returns focus to the
  // opener on close — with :focus-visible after a keyboard close, without it
  // after a mouse close — so a mouse close no longer reopens the tooltip.
  private readonly onFocus = (event: FocusEvent): void => {
    if (event.target instanceof Element && event.target.matches(":focus-visible")) this.reveal();
  };
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

  // CB#267, WCAG 1.4.13 "dismissible": Escape closes a shown tooltip without
  // moving the pointer or focus. Captured on window and stopped there, so where
  // Escape already means something — a showModal() dialog, the search field —
  // the first press closes only the tooltip. preventDefault is what holds a
  // modal dialog open (see that-stop-dialog's holdEscapeWhileBusy).
  private readonly onEscape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !this.matches(":popover-open")) return;
    event.preventDefault();
    event.stopPropagation();
    this.hidePopover();
  };

  connectedCallback(): void {
    this.setAttribute("popover", "manual");
    this.className =
      "bg-tip text-rail-ink rounded-xs px-[9px] py-[5px] text-xs font-medium tracking-normal normal-case overflow-visible pointer-events-none " +
      (this.hasAttribute("wrap")
        ? "max-w-[340px] whitespace-normal break-words"
        : "whitespace-nowrap");

    const id = this.getAttribute("for");
    const trigger = id ? document.getElementById(id) : null;
    if (!trigger) return;
    this.trigger = trigger;

    trigger.addEventListener("pointerenter", this.onShow);
    trigger.addEventListener("pointerleave", this.onHide);
    trigger.addEventListener("focus", this.onFocus);
    trigger.addEventListener("blur", this.onHide);
    window.addEventListener("keydown", this.onEscape, true);

    // reveal() places the box once, at show time, from the trigger's rect and
    // this element's own width. A consumer can repaint this element's text —
    // and so its width — while the popover is still open: that-ticket-row's
    // pin control does exactly that. A click focus no longer re-reveals (CB#107),
    // so only watching the text keeps the box right. Watching rather than
    // hiding on click also lets hover-driven tests expect the tooltip to still
    // be open right after.
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
    trigger.removeEventListener("focus", this.onFocus);
    trigger.removeEventListener("blur", this.onHide);
    window.removeEventListener("keydown", this.onEscape, true);
  }

  private reveal(): void {
    const trigger = this.trigger;
    if (!trigger) return;

    // CB#143: a cut-text tooltip exists only to give back what the ellipsis took.
    if (this.hasAttribute("when-cut") && trigger.scrollWidth <= trigger.clientWidth) return;

    // See onHide: neither call throws on a redundant transition in either
    // target browser, and this guard is the same insurance.
    if (!this.matches(":popover-open")) this.showPopover();

    const box = trigger.getBoundingClientRect();

    // The drawing's .tip.right (prototype line 168): beside the trigger and
    // centred on it — the rail's cog, whose top-left corner leaves no room above.
    if (this.getAttribute("anchor") === "right") {
      const top = box.top + box.height / 2 - this.offsetHeight / 2;
      this.style.top = `${top}px`;
      this.style.left = `${box.right + 9}px`;
      this.style.right = "auto";
      this.style.bottom = "auto";
      this.style.margin = "0";
      this.pointArrow("right", box.top + box.height / 2 - top, this.offsetHeight);
      return;
    }
    const gap = 7;
    const left =
      this.getAttribute("anchor") === "end"
        ? box.right - this.offsetWidth
        : box.left + box.width / 2 - this.offsetWidth / 2;

    // Above by default — the drawing's .tip — falling back below when there
    // is not enough room, the drawing's own .tip.below (prototype line 144).
    // #content starts flush against the window's top edge (CB#3's), so a
    // trigger at the top of the content column, or Week's own header arrows,
    // would otherwise open partly off-screen.
    //
    // `below` is the opt-in for the drawing's other variant, `.tip.below`
    // (prototype line 166): open under the trigger instead, falling back
    // above when the box would run past the window's bottom edge. Task 7's
    // own case — the search panel stacks a row's key link over its summary,
    // so the summary's tooltip must open away from the key link above it,
    // not over it.
    const top = this.hasAttribute("below")
      ? box.bottom + gap + this.offsetHeight > window.innerHeight
        ? box.top - this.offsetHeight - gap
        : box.bottom + gap
      : box.top - this.offsetHeight - gap < 0
        ? box.bottom + gap
        : box.top - this.offsetHeight - gap;

    // Only a wrapping tooltip is clamped: it is the wide, cut-text case this
    // is for (CB#143), sized to run into a window edge. An icon tooltip's
    // anchor="end" pins its right edge to the trigger's on purpose, even past
    // the window's own left edge for a trigger mounted flush against it —
    // clamping that would pull it away from the trigger it is pinned to.
    const edge = 8;
    const clamped = this.hasAttribute("wrap")
      ? Math.min(Math.max(left, edge), window.innerWidth - this.offsetWidth - edge)
      : left;

    // All four longhands, not just top/left: the UA stylesheet gives an open
    // popover `inset: 0` for its default centred position, and leaving right
    // or bottom set would fight the explicit placement on some engines.
    this.style.top = `${top}px`;
    this.style.left = `${clamped}px`;
    this.style.right = "auto";
    this.style.bottom = "auto";
    this.style.margin = "0";
    this.pointArrow(
      top < box.top ? "above" : "below",
      box.left + box.width / 2 - clamped,
      this.offsetWidth,
    );
  }

  /** Aims the ::after arrow (styles.css) at the trigger's centre, `at` px along
   *  the facing edge, kept clear of the 2px corners. */
  private pointArrow(side: "above" | "below" | "right", at: number, length: number): void {
    this.dataset["side"] = side;
    this.style.setProperty("--arrow-at", `${Math.min(Math.max(at, 6), length - 6)}px`);
  }
}

customElements.define("that-tooltip", ThatTooltip);
