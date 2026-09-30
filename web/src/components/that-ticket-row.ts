import { cutTextTooltip } from "../cut-text-tooltip";
import { fieldFigure } from "../duration";
import { iconMarkup } from "../icons";
import { paintInstanceDot } from "../instance-hue";
import { shownSeconds } from "../table-sort";
import { elapsedFor, isRunningTicket, onTimerChanged } from "../timer-state";
// A type-only import is erased at compile time (verbatimModuleSyntax makes
// that a guarantee), so describing the request with the dialog's own shape
// costs no bundle bytes and cannot drift from what openEntryDialog expects.
// The pin and unpin events below reuse it for the same reason: a pin event
// names the same ticket a log-time event does.
import type { EntryTicket } from "./that-entry-dialog";

/** Prefixed, like every custom event this app raises — see entries-changed.ts. */
export const LOG_TIME = "that-log-time";
export const PIN = "that-pin";
export const UNPIN = "that-unpin";

/** One id per pin control mounted, so its tooltip's `for` can resolve it on a
 *  page holding many rows in several cards. */
let pinTriggerSequence = 0;

/** Same reasoning as pinTriggerSequence, for the summary's own cut-text
 *  tooltip and the key link's own "open in Jira" one (#143). */
let summaryTriggerSequence = 0;

/**
 * One issue: its key, its summary and its status. Light DOM, so #7 and #8 can
 * append a timer and a duration field to it without a slot.
 *
 * The host is a native table row (`display: table-row`, set in styles.css)
 * holding five `<td>`s in the header's order — key, summary, status, today,
 * action — so it can sit directly in a `that-table`'s body. That combination
 * was verified in both target browsers before this was written.
 *
 * The key wears Chivo Mono via `.that-key` in styles.css — it is one of the
 * figures the second edition sets in the mono face, not the summary's prose.
 *
 * The key's column is sized in styles.css rather than here, from one width
 * shared by every card on the view — see .that-tbl .c-key — which is what
 * makes the summaries start at the same x down a card and across two of them.
 *
 * Cell content lives in wrappers the component owns and re-renders, rather
 * than in the host's children — the same shape that-button uses — so that
 * anything a later ticket appends survives an attribute change.
 */
export class ThatTicketRow extends HTMLElement {
  static get observedAttributes(): string[] {
    return [
      "key",
      "summary",
      "status",
      "url",
      "instance-id",
      "instance-name",
      "instance-position",
      "seconds",
      "pinned",
      "error",
    ];
  }

  private mounted = false;
  private trigger: HTMLButtonElement | undefined;
  private figure: HTMLElement | undefined;
  private pinTrigger: HTMLButtonElement | undefined;
  private pinTooltip: HTMLElement | undefined;
  private readonly pinTriggerId = `that-pin-${++pinTriggerSequence}`;
  // Same sequence value for all three (#143): one row, one number, three
  // prefixes, so nothing here collides across a page holding many rows.
  private readonly summaryId = `that-sum-${++summaryTriggerSequence}`;
  private readonly keyLinkId = `that-key-${summaryTriggerSequence}`;
  private readonly failureId = `that-fail-${summaryTriggerSequence}`;
  private stopTimerListening: (() => void) | undefined;

  connectedCallback(): void {
    this.mounted = true;
    this.render();
    // Outlives no navigation of its own: the row is rebuilt or removed with
    // its card, and disconnectedCallback below is what stops this from
    // outliving that.
    this.stopTimerListening = onTimerChanged(() => {
      this.paintDuration();
    });
  }

  disconnectedCallback(): void {
    this.stopTimerListening?.();
    this.stopTimerListening = undefined;
  }

  // #83's `that-table` re-sorts its body with `moveBefore`, which moves this
  // element without disconnecting it — but only because this no-op exists.
  // Without it the browser falls back to an ordinary remove-then-insert,
  // firing disconnectedCallback and then connectedCallback, and
  // connectedCallback calls render() unconditionally: every cell, including
  // whichever control the user had focused, would be rebuilt mid-sort.
  connectedMoveCallback(): void {}

  // `seconds` and `pinned` each move without the rest of the row changing, so
  // both repaint their own cell in place rather than rebuilding the row: a
  // rebuild would detach whichever control the user just used as a focus
  // target — showModal()'s return target for seconds, the button the user
  // just pressed for pinned — dropping a keyboard user at <body>.
  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (!this.mounted || oldValue === newValue) return;

    if (name === "seconds") {
      this.paintDuration();

      return;
    }
    if (name === "pinned") {
      this.paintPinned();

      return;
    }
    this.render();
  }

  private render(): void {
    const url = this.getAttribute("url") ?? "";

    const keyCell = document.createElement("td");
    keyCell.className = "c-key";
    keyCell.append(this.keyContent(url));
    if (url !== "") keyCell.append(this.keyTooltip());

    const sumCell = document.createElement("td");
    sumCell.className = "c-sum";
    sumCell.append(this.summarySpan(), this.summaryTooltip());
    const failure = this.getAttribute("error");
    if (failure !== null && failure !== "") {
      sumCell.append(this.failureNote(failure), this.failureTooltip(failure));
    }

    const statusCell = document.createElement("td");
    statusCell.className = "c-status text-ink-muted text-sm";
    statusCell.textContent = this.getAttribute("status") ?? "";

    const todayCell = document.createElement("td");
    todayCell.className = "c-today";
    todayCell.append(this.durationCell());

    const actCell = document.createElement("td");
    actCell.className = "c-act";
    // #8 gave this cell a second control, so it is one flex row now rather
    // than two bare children: a light-DOM custom element (that-timer, default
    // display: inline) sitting beside a block-level button forces the browser
    // to split the cell into anonymous blocks around them — the block-in-inline
    // case — which blew the row's height out past 34px. A single flex
    // wrapper sidesteps that entirely: every child becomes a flex item
    // regardless of its own declared display.
    const actRow = document.createElement("div");
    actRow.className = "flex items-center";
    this.appendTimerControl(actRow);
    this.appendPinControl(actRow);
    actCell.append(actRow);

    this.replaceChildren(keyCell, sumCell, statusCell, todayCell, actCell);
    this.paintDuration();
  }

  /** #8's play/stop button, before the pin per decision 1 of the timer
   *  design. A self-contained WebComponent, not an event dispatched to the
   *  view: unlike LOG_TIME/PIN/UNPIN, starting or stopping a timer needs no
   *  view-owned state, so it talks to timer-state.ts directly. */
  private appendTimerControl(cell: HTMLElement): void {
    const timer = document.createElement("that-timer");
    timer.setAttribute("instance-id", this.getAttribute("instance-id") ?? "0");
    timer.setAttribute("key", this.getAttribute("key") ?? "");
    // The gap the pin's own -mr-2 doesn't supply on this side — two square
    // buttons placed edge to edge with nothing between them otherwise.
    timer.className = "mr-1";
    cell.append(timer);
  }

  /**
   * The row's own way in to logging time, and this ticket's only new
   * affordance on it. Nothing about opening the dialog was ever drawn — the
   * board gives the row one control, #8's play circle — so this was settled
   * with the owner in the browser on 2026-08-21.
   *
   * A <button>, not the whole row: the row already holds the key's link and
   * will hold #8's start/stop control, and a button may contain neither. It
   * stays a button rather than becoming a span for the same reason — #8 puts
   * its control beside this one.
   *
   * The figure wears H:MM rather than the rail's Nh Nm because this is the
   * cell #8's timer ticks in, and a colon is this app's mark of a duration you
   * can start and stop.
   */
  private durationCell(): HTMLElement {
    // paintDuration(), called at the end of render(), repaints this the
    // moment trigger/figure exist — this is only what a first paint shows for
    // the instant before that.
    const figure = fieldFigure(this.durationSeconds());
    const key = this.getAttribute("key") ?? "";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.setAttribute("aria-haspopup", "dialog");
    // Named rather than left to read as "Log 0:00": down a list of rows that
    // sentence does not say which ticket it belongs to.
    trigger.setAttribute("aria-label", `Log time against ${key}, ${figure} today`);
    // The padding is given straight back as negative margin, which is the
    // design's rule for every control in a table: the ink meets the card edge,
    // not the hit area, and the row is the height its text asks for. Without
    // the give-back this cell was the tallest in the row and every card grew
    // by it. The left margin is not returned — the prototype's durbtn keeps
    // that side, so the figure stays clear of the summary beside it. Values
    // are .durbtn's own: padding 9px 13px, margin -9px -13px -9px 0.
    // No gap: the hint's own margin-right is the only space between it and the
    // figure, matching .durbtn's gap: 0 in the prototype.
    // inline-flex, not flex: the cell is width: 1% with text-align: right (see
    // that-table.ts's sortHeaderCell for the header's own case of this), and a
    // block-level flex box fills the column and ignores that alignment.
    trigger.className =
      "group hover:bg-hover -my-[9px] -mr-[13px] inline-flex shrink-0 cursor-pointer items-baseline " +
      "rounded-sm px-[13px] py-[9px]";

    // Decision 10 reverses the first edition's choice for a table: the hint
    // always occupies its width and only its opacity fades in, so the status
    // column beside it never jumps on hover. The reveal bargain — no width
    // until wanted — stays right for a narrow panel, but this component now
    // renders only inside a table, so reserve is the only case left here.
    const hint = document.createElement("span");
    hint.className =
      "text-primary mr-2.5 shrink-0 text-sm font-bold tracking-[0.06em] uppercase " +
      "whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100 " +
      "group-focus-visible:opacity-100";
    hint.textContent = "Log";
    // The accessible name is on the button; announcing "Log" again inside it
    // would read the word twice.
    hint.setAttribute("aria-hidden", "true");

    const total = document.createElement("span");
    total.className = "that-tnum font-mono text-base";
    total.textContent = figure;

    trigger.append(hint, total);
    trigger.addEventListener("click", () => {
      this.askForDialog();
    });
    this.trigger = trigger;
    this.figure = total;

    return trigger;
  }

  /** Whether the running timer, if any, is against this row's own ticket. */
  private mine(): boolean {
    return isRunningTicket(
      Number(this.getAttribute("instance-id") ?? "0"),
      this.getAttribute("key") ?? "",
    );
  }

  /** The figure this row shows — see shownSeconds, which the sort compares too. */
  private durationSeconds(): number {
    const seconds = Number(this.getAttribute("seconds") ?? "0");

    return shownSeconds({
      seconds: Number.isFinite(seconds) ? seconds : 0,
      elapsed: elapsedFor(
        Number(this.getAttribute("instance-id") ?? "0"),
        this.getAttribute("key") ?? "",
      ),
    });
  }

  /**
   * The Today figure, repainted on every `seconds` change (a fresh total) and
   * on every timer tick or switch (a fresh elapsed, or a fresh answer to "is
   * this mine").
   *
   * The key is deliberately not painted here. The visual language reserves the
   * running tone for the live timer and its stop control, and a key is neither
   * — so a running row's key stays ink-muted like every other.
   */
  private paintDuration(): void {
    const trigger = this.trigger;
    const figure = this.figure;
    if (!trigger || !figure) return;

    const running = this.mine();
    const shown = fieldFigure(this.durationSeconds());
    figure.textContent = shown;
    figure.classList.toggle("text-running", running);
    trigger.setAttribute(
      "aria-label",
      `Log time against ${this.getAttribute("key") ?? ""}, ${shown} today`,
    );
  }

  /**
   * The row's own way to pin or unpin its ticket, trailing in the action
   * column. The tooltip is `that-tooltip`'s first consumer in the app: its
   * `for` resolves the trigger by id, which is why the trigger needs one
   * unique across a page holding many rows, and `anchor="end"` keeps it from
   * hanging past the card the way a centred tooltip on a trailing control
   * would.
   *
   * The tooltip is never this control's accessible name — the aria-label set
   * in paintPinned names the ticket, independent of the tooltip's fixed
   * "pin ticket" / "unpin ticket" text.
   */
  private appendPinControl(cell: HTMLElement): void {
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.id = this.pinTriggerId;
    // -mr-2 is .iconbtn's own margin-right: -8px, so the control's ink reaches
    // the card's content edge instead of stopping short of it behind the
    // button's own hit area.
    trigger.className =
      "hover:bg-hover focus-visible:bg-hover -mr-2 flex h-[34px] w-[34px] shrink-0 cursor-pointer " +
      "items-center justify-center rounded-sm text-ink-muted hover:text-primary focus-visible:text-primary";
    trigger.addEventListener("click", () => {
      this.togglePinned();
    });

    const tooltip = document.createElement("that-tooltip");
    tooltip.setAttribute("for", this.pinTriggerId);
    tooltip.setAttribute("anchor", "end");

    cell.append(trigger, tooltip);
    this.pinTrigger = trigger;
    this.pinTooltip = tooltip;
    this.paintPinned();
  }

  /**
   * The in-place half of the `pinned` repaint — see attributeChangedCallback.
   * Toggling is optimistic: the icon, the aria-label and the tooltip all
   * update the moment the control is used, because a control that waits on a
   * network round trip before showing anything reads as broken.
   *
   * The control no longer takes the primary colour at rest just because the
   * row is pinned — 2026-09-10's decision, folded into this ticket rather
   * than kept as its own. The mark alone (`pin` against `pin-off`) says
   * "pinned" at rest; the primary colour is reserved for hover and
   * focus-visible, set once in the trigger's own class list in
   * appendPinControl rather than toggled here.
   */
  private paintPinned(): void {
    const trigger = this.pinTrigger;
    const tooltip = this.pinTooltip;
    if (!trigger || !tooltip) return;

    const pinned = this.hasAttribute("pinned");
    const key = this.getAttribute("key") ?? "";

    trigger.innerHTML = iconMarkup(pinned ? "pin-off" : "pin");
    trigger.setAttribute("aria-label", pinned ? `Unpin ${key}` : `Pin ${key}`);
    tooltip.textContent = pinned ? "unpin ticket" : "pin ticket";
  }

  /**
   * Flips the row's own pinned state and tells whoever is listening. The view
   * knows where a pin is actually persisted; the row only knows its ticket,
   * the same division of labour as askForDialog below.
   */
  private togglePinned(): void {
    const wasPinned = this.hasAttribute("pinned");
    if (wasPinned) {
      this.removeAttribute("pinned");
    } else {
      this.setAttribute("pinned", "");
    }

    this.dispatchEvent(
      new CustomEvent<EntryTicket>(wasPinned ? UNPIN : PIN, {
        bubbles: true,
        detail: this.ticket(),
      }),
    );
  }

  /**
   * The row knows its ticket but not where a dialog should live, and importing
   * one here would tie every row to it. So it asks, and the view — which owns
   * its own root — answers.
   */
  private askForDialog(): void {
    this.dispatchEvent(
      new CustomEvent<EntryTicket>(LOG_TIME, {
        bubbles: true,
        detail: this.ticket(),
      }),
    );
  }

  private ticket(): EntryTicket {
    return {
      instanceId: Number(this.getAttribute("instance-id") ?? "0"),
      instanceName: this.getAttribute("instance-name") ?? "",
      issueKey: this.getAttribute("key") ?? "",
      summary: this.getAttribute("summary") ?? "",
      status: this.getAttribute("status") ?? "",
    };
  }

  /**
   * An anchor only when there is somewhere to go. An instance migrated from a
   * gateway URL has no site, and an anchor with an empty href navigates to the
   * current page instead of doing nothing.
   *
   * Linked or not, the key is ink-muted: on a row, colour means state, and a
   * key wearing the primary would compete with the failed tone that #9 puts on
   * exactly this element. The link declares itself by darkening to full ink on
   * hover instead.
   */
  private keyLabel(url: string): HTMLElement {
    const key = this.getAttribute("key") ?? "";

    if (url === "") {
      // No title either (owner, 2026-09-25): a key with no site to open gets
      // no tooltip at all, not even the native one it used to carry.
      const span = document.createElement("span");
      span.className = "that-key that-tnum text-ink-muted";
      span.textContent = key;

      return span;
    }

    const link = document.createElement("a");
    // keyLinkId is set on the link alone — only when it exists, which is why
    // the plain-span branch above sets no id: this element's own tooltip
    // (keyTooltip below) is nothing to attach when there is nothing focusable
    // or hoverable to give it.
    link.id = this.keyLinkId;
    link.href = url;
    link.target = "_blank";
    // Without noopener the opened page gets a window.opener handle back here.
    link.rel = "noopener";
    link.className = "that-key that-tnum text-ink-muted";
    link.textContent = key;

    return link;
  }

  /** The key link's own that-tooltip (#143), replacing the native title it
   *  used to carry — default (centred) anchor, since the key is not a
   *  trailing control. */
  private keyTooltip(): HTMLElement {
    const tooltip = document.createElement("that-tooltip");
    tooltip.setAttribute("for", this.keyLinkId);
    tooltip.textContent = "open in Jira";

    return tooltip;
  }

  /**
   * The key, and — in a cross-instance table like Pinned — the dot saying which
   * Jira the row came from, 8px from it inside the same cell. A per-instance
   * card needs none: its own heading carries the dot, and a column of dots all
   * the same colour says nothing.
   */
  private keyContent(url: string): HTMLElement {
    const label = this.keyLabel(url);
    // A whole number, or no dot at all. Both empties have to be caught by hand
    // before Number() sees them: it reads null *and* "" as 0, which would paint
    // the first instance's hue on a row that never claimed one. Anything else
    // unparseable arrives as NaN and is refused the same way.
    const declared = this.getAttribute("instance-position")?.trim() ?? "";
    const position = declared === "" ? Number.NaN : Number(declared);
    if (!Number.isInteger(position)) return label;

    const holder = document.createElement("span");
    holder.className = "inline-flex items-center gap-2";
    const dot = document.createElement("span");
    paintInstanceDot(dot, position, this.getAttribute("instance-name") ?? "");
    holder.append(dot, label);

    return holder;
  }

  /**
   * Why a row is showing what it last knew rather than what is true now — a
   * pinned row whose instance could not be reached keeps its cached summary
   * and says this underneath it. role="status", matching that-alert, so it is
   * announced rather than only seen; text-failed, which is what the palette
   * calls its error tone.
   */
  private failureNote(message: string): HTMLElement {
    const note = document.createElement("span");
    note.id = this.failureId;
    note.tabIndex = 0;
    note.setAttribute("role", "status");
    note.className = "text-failed block truncate text-xs";
    note.textContent = message;

    return note;
  }

  /**
   * Opens on the note's own hover and its own focus (#236): the note is a Tab
   * stop whether or not it is cut, so the Tab order never changes with the
   * window's width, and `when-cut` keeps this shut when there is nothing to
   * give back.
   */
  private failureTooltip(message: string): HTMLElement {
    return cutTextTooltip(this.failureId, message);
  }

  /** Focusable (#143 task 9, owner): its own tab stop rather than borrowing
   *  the key link's, so its tooltip can open on its own focus instead of a
   *  neighbour's. */
  private summarySpan(): HTMLElement {
    const summary = document.createElement("span");
    summary.id = this.summaryId;
    summary.tabIndex = 0;
    summary.className = "block truncate";
    summary.textContent = this.getAttribute("summary") ?? "";

    return summary;
  }

  /**
   * that-tooltip's first cut-text consumer (#143): `for` gives back the
   * summary's own hover and, since task 9, its own focus too, so a key focus
   * opens only the key's own "open in Jira" tooltip (keyTooltip above),
   * never this one.
   */
  private summaryTooltip(): HTMLElement {
    return cutTextTooltip(this.summaryId, this.getAttribute("summary") ?? "");
  }
}

customElements.define("that-ticket-row", ThatTicketRow);
