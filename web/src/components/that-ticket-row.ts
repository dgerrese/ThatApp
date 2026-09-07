import { fieldFigure } from "../duration";
import { iconMarkup } from "../icons";
import { paintInstanceDot } from "../instance-hue";
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

  connectedCallback(): void {
    this.mounted = true;
    this.render();
  }

  // `seconds` and `pinned` each move without the rest of the row changing, so
  // both repaint their own cell in place rather than rebuilding the row: a
  // rebuild would detach whichever control the user just used as a focus
  // target — showModal()'s return target for seconds, the button the user
  // just pressed for pinned — dropping a keyboard user at <body>.
  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (!this.mounted || oldValue === newValue) return;

    if (name === "seconds") {
      this.paintSeconds();

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

    const sumCell = document.createElement("td");
    sumCell.className = "c-sum";
    sumCell.append(this.summarySpan());
    const failure = this.getAttribute("error");
    if (failure !== null && failure !== "") {
      sumCell.append(this.failureNote(failure));
    }

    const statusCell = document.createElement("td");
    statusCell.className = "c-status text-ink-muted text-sm";
    statusCell.textContent = this.getAttribute("status") ?? "";

    const todayCell = document.createElement("td");
    todayCell.className = "c-today";
    todayCell.append(this.durationCell());

    const actCell = document.createElement("td");
    actCell.className = "c-act";
    this.appendPinControl(actCell);

    this.replaceChildren(keyCell, sumCell, statusCell, todayCell, actCell);
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
    const figure = this.loggedFigure();
    const key = this.getAttribute("key") ?? "";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.setAttribute("aria-haspopup", "dialog");
    // Named rather than left to read as "Log 0:00": down a list of rows that
    // sentence does not say which ticket it belongs to.
    trigger.setAttribute("aria-label", `Log time against ${key}, ${figure} today`);
    trigger.className =
      "group hover:bg-hover flex shrink-0 cursor-pointer items-baseline gap-1.5 " +
      "rounded-sm px-1.5 py-0.5";

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

  /** Today's logged time as the cell wears it, read off the attribute. */
  private loggedFigure(): string {
    const seconds = Number(this.getAttribute("seconds") ?? "0");

    return fieldFigure(Number.isFinite(seconds) ? seconds : 0);
  }

  /** The in-place half of the `seconds` repaint: the figure and the name that speaks it. */
  private paintSeconds(): void {
    const trigger = this.trigger;
    const figure = this.figure;
    if (!trigger || !figure) return;

    const logged = this.loggedFigure();
    figure.textContent = logged;
    trigger.setAttribute(
      "aria-label",
      `Log time against ${this.getAttribute("key") ?? ""}, ${logged} today`,
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
    trigger.className =
      "hover:bg-hover focus-visible:bg-hover flex h-[34px] w-[34px] shrink-0 cursor-pointer " +
      "items-center justify-center rounded-sm text-ink-muted hover:text-ink focus-visible:text-ink";
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
   */
  private paintPinned(): void {
    const trigger = this.pinTrigger;
    const tooltip = this.pinTooltip;
    if (!trigger || !tooltip) return;

    const pinned = this.hasAttribute("pinned");
    const key = this.getAttribute("key") ?? "";

    trigger.innerHTML = iconMarkup(pinned ? "pin-off" : "pin");
    trigger.setAttribute("aria-label", pinned ? `Unpin ${key}` : `Pin ${key}`);
    trigger.classList.toggle("text-primary", pinned);
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
   * key wearing the primary would compete with the running and failed tones
   * that #8 and #9 put on exactly this element. The link declares itself by
   * darkening to full ink on hover instead.
   */
  private keyLabel(url: string): HTMLElement {
    const key = this.getAttribute("key") ?? "";

    if (url === "") {
      const span = document.createElement("span");
      span.className = "that-key that-tnum text-ink-muted";
      span.textContent = key;

      return span;
    }

    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    // Without noopener the opened page gets a window.opener handle back here.
    link.rel = "noopener";
    link.className = "that-key that-tnum text-ink-muted";
    link.textContent = key;

    return link;
  }

  /**
   * The key, and — in a cross-instance table like Pinned — the dot saying which
   * Jira the row came from, 8px from it inside the same cell. A per-instance
   * card needs none: its own heading carries the dot, and a column of dots all
   * the same colour says nothing.
   */
  private keyContent(url: string): HTMLElement {
    const label = this.keyLabel(url);
    const position = this.getAttribute("instance-position");
    if (position === null) return label;

    const holder = document.createElement("span");
    holder.className = "inline-flex items-center gap-2";
    const dot = document.createElement("span");
    paintInstanceDot(dot, Number(position), this.getAttribute("instance-name") ?? "");
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
    note.setAttribute("role", "status");
    note.className = "text-failed block truncate text-xs";
    note.textContent = message;

    return note;
  }

  private summarySpan(): HTMLElement {
    const summary = document.createElement("span");
    summary.className = "block truncate text-lg";
    summary.textContent = this.getAttribute("summary") ?? "";

    return summary;
  }
}

customElements.define("that-ticket-row", ThatTicketRow);
