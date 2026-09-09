import { exactSecondsFromTyped, fieldFigure, secondsFromTyped, steppedSeconds } from "../duration";
import { iconMarkup, type IconName } from "../icons";

/**
 * A duration you can step or type: minus, a field, plus, glued into one bordered
 * group. Light DOM, like everything here.
 *
 * The arithmetic is not in this file. `../duration` owns reading a typed figure
 * and finding the next step, because that rule is where a mistake reaches Jira
 * as the wrong number of hours and it is only testable away from the DOM.
 *
 * The group carries the border and the focus ring — via `:focus-within`, so
 * pressing `+` lights the whole control rather than nothing, and the input
 * inside it is borderless. Radius sits on the outside corners only; the seams
 * between the three parts are hairlines.
 *
 * Reusable by #8, which puts a start/stop control beside it.
 */
export class ThatDuration extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["seconds", "disabled"];
  }

  private input: HTMLInputElement | undefined;
  private buttons: HTMLButtonElement[] = [];
  private committed = 0;

  /** Whole seconds, always what the control would post. */
  get seconds(): number {
    return this.committed;
  }

  set seconds(value: number) {
    this.committed = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
    this.showCommitted();
  }

  connectedCallback(): void {
    if (!this.input) this.build();
    this.readSeconds();
    this.applyDisabled();
  }

  // Split by attribute rather than re-reading both: the dialog sets `seconds`
  // as a property, so re-applying a stale `seconds` attribute every time
  // `disabled` toggled would put the old figure back mid-edit.
  attributeChangedCallback(name: string): void {
    if (!this.input) return;
    if (name === "seconds") this.readSeconds();
    if (name === "disabled") this.applyDisabled();
  }

  private build(): void {
    const group = document.createElement("div");
    // Height set here rather than left to the input's padding plus its line
    // height: Chivo Mono's own line-height differs from Chivo's, so the same
    // nominal font-size does not sum to the same pixel height across the two
    // faces. Pinning it here is what lets `.durgroup input`'s drawn 9px 8px
    // padding sit inside the same 38px `.btn` draws, instead of chasing a
    // font metric no CSS property here controls.
    group.className =
      "inline-flex h-[38px] items-stretch overflow-hidden rounded-sm border border-edge " +
      "focus-within:border-ink";

    const minus = this.stepButton("minus", -1, "Fifteen minutes less");
    const plus = this.stepButton("plus", 1, "Fifteen minutes more");
    // The seams. Border on the buttons rather than the input, so the group
    // keeps exactly two hairlines however the input is styled later.
    minus.classList.add("border-edge", "border-r");
    plus.classList.add("border-edge", "border-l");

    const input = document.createElement("input");
    input.type = "text";
    input.autocomplete = "off";
    // Not type="number": its spinner would be a second stepper next to ours,
    // and it rejects the `8:15` the parse rule is required to accept. inputmode
    // is what gets the number pad on the phone in #53 without either.
    input.inputMode = "numeric";
    input.setAttribute("aria-label", this.getAttribute("label") ?? "Duration");
    input.className =
      "w-16 bg-transparent px-2 py-[9px] text-center font-mono text-sm tabular-nums " +
      "focus:outline-none disabled:cursor-not-allowed";
    this.input = input;

    input.addEventListener("keydown", (event) => {
      this.onKeydown(event);
    });
    // Commit on blur as well as Enter: leaving the field with a figure in it
    // and finding the old one back is the same broken feeling as typing 7 and
    // getting nothing.
    input.addEventListener("blur", () => {
      this.commitTyped();
    });

    group.append(minus, input, plus);
    this.append(group);
    this.showCommitted();
  }

  private stepButton(icon: IconName, direction: 1 | -1, label: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = iconMarkup(icon);
    button.setAttribute("aria-label", label);
    // tabindex="-1" keeps Tab going input to input through a form: the steps
    // these buttons take are already on ArrowUp and ArrowDown in the field.
    button.tabIndex = -1;
    button.className =
      "text-ink-muted hover:bg-hover hover:text-ink cursor-pointer px-2 text-base " +
      "disabled:cursor-not-allowed disabled:opacity-50";
    button.addEventListener("click", () => {
      this.stepBy(direction);
    });
    this.buttons.push(button);

    return button;
  }

  private onKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      this.stepBy(event.key === "ArrowUp" ? 1 : -1);

      return;
    }
    if (event.key === "Enter") {
      // The dialog's foot form has no submit button, but a stray Enter here
      // should read the figure rather than travel anywhere.
      event.preventDefault();
      this.commitTyped();
    }
  }

  /**
   * Steps from the typed figure if one is readable, so `+` never discards it —
   * and from its exact reading, not the snapped one: snapping a typed 7 to
   * 0:15 first would step clean past the quarter hour the press should land on.
   * An untouched field steps from the committed seconds themselves, which is
   * what keeps a stored 7m13s going up to 0:15 rather than re-reading its own
   * rounded display.
   */
  private stepBy(direction: 1 | -1): void {
    const input = this.input;
    const typed =
      input && input.value !== fieldFigure(this.committed)
        ? exactSecondsFromTyped(input.value)
        : null;
    this.seconds = steppedSeconds(typed ?? this.committed, direction);
  }

  private commitTyped(): void {
    const input = this.input;
    if (!input) return;

    // An untouched field commits nothing. It shows the committed figure
    // rounded for display, and re-reading that rounding would snap a non-grid
    // entry — the API accepts them, and #8's timer will write them — to the
    // grid on a mere Tab through the field.
    if (input.value === fieldFigure(this.committed)) return;

    // A refusal restores the last good figure. Committing a guess is how a
    // control posts something nobody typed.
    this.seconds = secondsFromTyped(input.value) ?? this.committed;
  }

  private showCommitted(): void {
    if (this.input) this.input.value = fieldFigure(this.committed);
  }

  private readSeconds(): void {
    const attribute = this.getAttribute("seconds");
    if (attribute === null) return;

    const parsed = Number(attribute);
    this.seconds = Number.isFinite(parsed) ? parsed : 0;
  }

  private applyDisabled(): void {
    const disabled = this.hasAttribute("disabled");
    if (this.input) this.input.disabled = disabled;
    for (const button of this.buttons) button.disabled = disabled;
  }
}

customElements.define("that-duration", ThatDuration);
