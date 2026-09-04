import { fieldFigure } from "../duration";
// A type-only import is erased at compile time (verbatimModuleSyntax makes
// that a guarantee), so describing the request with the dialog's own shape
// costs no bundle bytes and cannot drift from what openEntryDialog expects.
import type { EntryTicket } from "./that-entry-dialog";

/** Prefixed, like every custom event this app raises — see entries-changed.ts. */
export const LOG_TIME = "that-log-time";

/**
 * One issue: its key, its summary and its status. Light DOM, so #7 and #8 can
 * append a timer and a duration field to it without a slot.
 *
 * The key is set in the body face rather than a monospace one. Space Grotesk
 * carries tabular figures, so keys still align in a column, and a second family
 * loaded for four characters a row costs bytes the 14kB budget would notice.
 *
 * That column is a fixed width rather than the key's own: it is what makes the
 * summaries start at the same x down the whole card, which is the alignment the
 * design draws.
 *
 * Its own content lives in a wrapper the component owns and re-renders, rather
 * than in the host's children — the same shape that-button uses — so that anything
 * a later ticket appends survives an attribute change.
 */
export class ThatTicketRow extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["key", "summary", "status", "url", "instance-id", "instance-name", "seconds"];
  }

  private body: HTMLElement | undefined;
  private trigger: HTMLButtonElement | undefined;
  private figure: HTMLElement | undefined;

  connectedCallback(): void {
    this.className = "flex items-baseline gap-3 py-3";

    if (!this.body) {
      this.body = document.createElement("div");
      this.body.className = "flex min-w-0 flex-1 items-baseline justify-between gap-3";
      this.append(this.body);
    }
    this.render();
  }

  // `seconds` moves on every row whenever any entry changes, so it repaints
  // the figure in place rather than rebuilding the body: a rebuild would
  // detach the trigger showModal() holds as its focus-return target, dropping
  // a keyboard user at <body> when the dialog that caused the change closes.
  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (!this.body || oldValue === newValue) return;

    if (name === "seconds") {
      this.paintSeconds();

      return;
    }
    this.render();
  }

  private render(): void {
    const body = this.body;
    if (!body) return;

    const url = this.getAttribute("url") ?? "";

    const identity = document.createElement("div");
    // min-w-0 and flex-1 are load-bearing: a flex item's floor is its
    // min-content width, so without them this box refuses to shrink, the
    // summary's truncate never engages, and a long title pushes the status
    // clean past the card's edge on a narrow viewport.
    identity.className = "flex min-w-0 flex-1 items-baseline gap-3";
    identity.append(this.keyLabel(url), this.summarySpan());

    const status = document.createElement("span");
    status.className = "text-ink-muted shrink-0 text-sm";
    status.textContent = this.getAttribute("status") ?? "";

    body.replaceChildren(identity, status, this.durationCell());
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
      "group hover:bg-surface flex shrink-0 cursor-pointer items-baseline gap-1.5 " +
      "rounded-md px-1.5 py-0.5";

    // The hint answers the one real weakness of an affordance that exists only
    // on hover, without drawing anything permanent into the resting row. It
    // widens the button, so the summary re-truncates while it is out: the owner
    // chose that on 2026-08-21 knowing the cost, over three arrangements that
    // hold the row still. It is a consequence, not a defect — reserving the
    // width to "fix" it means going back to the owner first.
    const hint = document.createElement("span");
    hint.className =
      "text-primary max-w-0 overflow-hidden text-sm font-bold tracking-[0.06em] uppercase " +
      "opacity-0 transition-all duration-150 group-hover:max-w-12 group-hover:opacity-100 " +
      "group-focus-visible:max-w-12 group-focus-visible:opacity-100";
    hint.textContent = "Log";
    // The accessible name is on the button; announcing "Log" again inside it
    // would read the word twice.
    hint.setAttribute("aria-hidden", "true");

    const total = document.createElement("span");
    total.className = "that-tnum text-base";
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
   * The row knows its ticket but not where a dialog should live, and importing
   * one here would tie every row to it. So it asks, and the view — which owns
   * its own root — answers.
   */
  private askForDialog(): void {
    this.dispatchEvent(
      new CustomEvent<EntryTicket>(LOG_TIME, {
        bubbles: true,
        detail: {
          instanceId: Number(this.getAttribute("instance-id") ?? "0"),
          instanceName: this.getAttribute("instance-name") ?? "",
          issueKey: this.getAttribute("key") ?? "",
          summary: this.getAttribute("summary") ?? "",
          status: this.getAttribute("status") ?? "",
        },
      }),
    );
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

  private summarySpan(): HTMLElement {
    const summary = document.createElement("span");
    summary.className = "min-w-0 flex-1 truncate text-lg";
    summary.textContent = this.getAttribute("summary") ?? "";

    return summary;
  }
}

customElements.define("that-ticket-row", ThatTicketRow);
