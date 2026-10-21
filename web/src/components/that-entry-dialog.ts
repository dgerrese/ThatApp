import "./that-button";
import "./that-confirm";
import "./that-dialog-blocks";
import "./that-duration";

import { ApiError, createEntry, deleteEntry, listEntries, restoreEntry, updateEntry } from "../api";
import { COMMENT_FIELD_CLASS, confirmDestructive } from "./that-confirm";
import { cutTextTooltip } from "../cut-text-tooltip";
import { announceEntriesChanged } from "../entries-changed";
import { longDay, totalFigure } from "../format";
import { iconMarkup } from "../icons";
import { paintInstanceDot } from "../instance-hue";
import { PUSH_MARKS, countsInTotals, knownPushState, type PushMark } from "../push-marks";
import type { Entry } from "../types";
import type { ThatDialogBlocks } from "./that-dialog-blocks";
import type { ThatDuration } from "./that-duration";

/**
 * What the row that opened the dialog knows about its ticket.
 *
 * `instancePosition` is the one thing a row does not know: it is the index into
 * the instance list's created_at order, which is the view's own business — the
 * same figure `Pin` and `WeekRow` carry, and what the header's dot keys its hue
 * off. Optional because the pin events reuse this shape and have no use for it,
 * and because a wrong position paints one instance in another's colour, which
 * is worse than no dot at all.
 */
export interface EntryTicket {
  instanceId: number;
  instanceName: string;
  instancePosition?: number;
  issueKey: string;
  summary: string;
  status: string;
  /** The day this ticket's dialog edits, if it is not today's. Week sets this
   *  from the cell it was opened from; Today never does — a row has no day of
   *  its own to name, since it always means today. */
  day?: string;
}

/** One id per dialog mounted, so the popovers inside it resolve their triggers
 *  even if a second dialog were ever appended beside the first. */
let dialogSequence = 0;

/**
 * The prototype's .iconbtn without its ink: 34 square, and the wash on hover
 * and on focus so a keyboard sees what a pointer does.
 *
 * The colour is split off rather than defaulted here, because two competing
 * `hover:text-*` utilities on one element are decided by the order Tailwind
 * emits them in, not the order they are written in — and Tailwind emits
 * `hover:text-ink` last, so a destructive button appending `hover:text-failed`
 * to this string turned ink under the pointer. Neither specificity nor class
 * order can fix that; only not stating both can.
 */
const ICON_BUTTON_FRAME =
  "hover:bg-hover focus-visible:bg-hover flex size-[34px] shrink-0 " +
  "cursor-pointer items-center justify-center rounded-sm";

const ICON_BUTTON_BASE = `text-ink-muted ${ICON_BUTTON_FRAME}`;

const ICON_BUTTON = `${ICON_BUTTON_BASE} hover:text-ink focus-visible:text-ink`;

/** Delete is the one irreversible thing on a row, and the only control in the
 *  app that announces itself before it is pressed. */
const ICON_BUTTON_DESTRUCTIVE = `${ICON_BUTTON_BASE} hover:text-failed focus-visible:text-failed`;

/** Restore is ink at rest, as the design session drew it: it is the one
 *  control on a struck row, and muted would sink it into the strike. */
const ICON_BUTTON_RESTORE = `text-ink ${ICON_BUTTON_FRAME}`;

/** A pending delete's duration and comment: struck, in the muted ink, with the
 *  strike itself in the faint mark colour (#280, option C). */
const STRUCK = ["text-ink-muted", "line-through", "decoration-ink-faint"];

/** The prototype's `.etitle`: the day line and the summary beneath the
 *  identity row both wear it, so the two lines read as one register. */
const SUBLINE_CLASS = "text-ink-muted mt-[5px] text-base leading-[1.35] [overflow-wrap:anywhere]";

/**
 * One ticket's logged time for today: what is already down, and the single form
 * that adds to it or edits it.
 *
 * A native <dialog> opened with showModal(), following that-confirm — the focus
 * trap, the inert background, the top layer, Esc and returning focus to the
 * trigger all come from the platform. Its no-dismiss-on-backdrop rule carries
 * over unchanged, and so does the explicit margin: Preflight's `* { margin: 0 }`
 * is author origin and beats the UA's `dialog { margin: auto }`, which lands the
 * card in the top-left corner of both target browsers without it.
 *
 * **It names its own ink.** The user-agent stylesheet gives every dialog
 * `color: CanvasText`, and a UA declaration beats inheritance — so a dialog that
 * does not state a colour wears the browser's, not the app's. That is trap 4 of
 * the design, and it survived thirteen prototype passes because on a dark ground
 * the two are near enough to look identical. `text-ink` on the element below is
 * the whole fix, and entries.spec.ts asserts it in both themes.
 *
 * It is appended beside the view rather than inside the row that opened it.
 * Today re-renders its lists wholesale on Refresh, and a dialog nested in a row
 * would be destroyed mid-edit — #29's bug wearing new clothes.
 *
 * There is exactly one place to type. Editing loads the entry into the same
 * foot form; which entry is named by the row itself taking an active state, so
 * the stepper, the comment and the one primary button sit where they sat when
 * adding.
 */
export class ThatEntryDialog extends HTMLElement {
  /** Assigned before the element is appended, which is what connectedCallback builds from. */
  ticket: EntryTicket | undefined;

  private dialog: HTMLDialogElement | undefined;
  private total: HTMLElement | undefined;
  private dayLine: HTMLElement | undefined;
  private list: HTMLElement | undefined;
  private empty: HTMLElement | undefined;
  private readonly blocks = document.createElement("that-dialog-blocks") as ThatDialogBlocks;
  private duration: ThatDuration | undefined;
  private comment: HTMLInputElement | undefined;
  private submit: HTMLElement | undefined;
  private cancel: HTMLElement | undefined;
  private closeControl: HTMLElement | undefined;

  private entries: Entry[] = [];
  private editing: Entry | undefined;
  private busy = false;
  private readonly sequence = ++dialogSequence;
  /** The day the last successful reload resolved as "today", per the server's
   *  own clock — what afterMutation compares the ticket's day against to
   *  decide whether an announcement may carry a payload, and what an
   *  unscoped dialog's day line names once it is known. */
  private today: string | undefined;

  connectedCallback(): void {
    if (this.dialog || !this.ticket) return;

    const dialog = this.build(this.ticket);
    dialog.showModal();
    this.blocks.attach(dialog);
    void this.reload();
  }

  private build(ticket: EntryTicket): HTMLDialogElement {
    const dialog = document.createElement("dialog");
    // No padding of its own: the header, the list and the foot each own their
    // own, which is what lets the two hairlines between them run the full width.
    dialog.className =
      "bg-raised text-ink shadow-dialog border-edge m-auto w-[580px] max-w-[calc(100vw-2rem)] " +
      "rounded-md border";
    dialog.setAttribute("aria-labelledby", this.headingId);

    dialog.append(this.header(ticket), this.entryList(), this.emptyLine(ticket), this.footForm());
    // Closing is the only exit, whether it came from Esc, the round Close or a
    // successful mutation, so the element removes itself from one place.
    dialog.addEventListener("close", () => {
      this.remove();
    });

    this.dialog = dialog;
    // Inside the dialog: a modal dialog leaves everything outside it inert.
    dialog.append(this.blocks);
    this.append(dialog);

    return dialog;
  }

  private get headingId(): string {
    return `that-entry-dialog-heading-${String(this.sequence)}`;
  }

  private get instanceId(): string {
    return `that-entry-dialog-instance-${String(this.sequence)}`;
  }

  /**
   * The instance dot, the instance and the key on one line, with the total and
   * Close pushed right by the total's own auto margin. The day sits on the
   * line beneath — every dialog names its day, per the design's Decision 2 —
   * and the summary, when there is one, follows beneath that. The status is
   * not here: the row that opened this already draws it.
   *
   * The dot sits outside the heading on purpose: it carries the instance name
   * as its accessible label, and inside the heading that name would be read
   * twice — once from the dot and once from the word beside it.
   */
  private header(ticket: EntryTicket): HTMLElement {
    const header = document.createElement("div");
    header.className = "border-edge flex flex-col border-b px-5 pt-4 pb-3.5";

    const identity = document.createElement("div");
    identity.className = "flex items-center gap-[9px]";

    const heading = document.createElement("h2");
    heading.id = this.headingId;
    heading.className = "flex min-w-0 items-center gap-[9px]";

    const instance = document.createElement("span");
    instance.id = this.instanceId;
    instance.tabIndex = 0;
    instance.className = "text-ink-muted truncate text-xs font-bold tracking-[0.16em] uppercase";
    instance.textContent = ticket.instanceName;

    // A character, not a mark: punctuation between two facts is typography, and
    // the design says so in as many words.
    const separator = document.createElement("span");
    separator.className = "text-ink-muted shrink-0 text-sm leading-none";
    separator.setAttribute("aria-hidden", "true");
    separator.textContent = "·";

    const key = document.createElement("span");
    key.className = "that-key that-tnum text-ink-muted shrink-0";
    key.textContent = ticket.issueKey;

    heading.append(instance, separator, key);

    const total = document.createElement("div");
    // Named, like #rail-total: one dialog is open at a time, and the ticket's
    // total and an entry's duration can read the same figure — which leaves
    // nothing else to tell them apart.
    total.id = "that-entry-dialog-total";
    // shrink-0, like the prototype's `.etotal { flex: none }`: without it the
    // total is a shrinkable flex item, and a long instance name wraps the
    // figure instead of truncating itself.
    total.className =
      "that-tnum ml-auto shrink-0 font-mono text-[22px] leading-none font-bold tracking-[-0.02em]";
    total.textContent = totalFigure(0);
    this.total = total;

    const position = ticket.instancePosition;
    if (position !== undefined) {
      const dot = document.createElement("span");
      paintInstanceDot(dot, position, ticket.instanceName);
      identity.append(dot);
    }
    identity.append(heading, total, this.closeButton());
    header.append(identity, this.instanceTooltip(ticket.instanceName));

    // Hidden until updateDayLine has a day to show: a scoped ticket's day is
    // known synchronously, but an unscoped one waits on reload() to learn
    // what the server resolved as today.
    const dayLine = document.createElement("p");
    dayLine.id = "that-entry-dialog-day";
    dayLine.className = SUBLINE_CLASS;
    dayLine.hidden = true;
    this.dayLine = dayLine;
    header.append(dayLine);
    this.updateDayLine();

    // Nothing at all when there is no summary, rather than an empty line the
    // layout still pays for: Week's rows carry keys only and open this dialog
    // with a blank one.
    if (ticket.summary !== "") {
      const subtitle = document.createElement("p");
      // Named, now that the empty line beneath the list (D6 of #117 task 11)
      // is a second <p> in the sheet: a bare "p" locator would resolve either
      // one.
      subtitle.id = "that-entry-dialog-summary";
      subtitle.className = SUBLINE_CLASS;
      subtitle.textContent = ticket.summary;
      header.append(subtitle);
    }

    return header;
  }

  /**
   * Fills in the day line once it is known: `ticket.day` when the dialog is
   * scoped, `this.today` — the server's own resolved "today" — otherwise.
   * Called from `header()` for the synchronous case and again from
   * `reload()` once an unscoped dialog's `today` arrives.
   */
  private updateDayLine(): void {
    const line = this.dayLine;
    if (!line) return;

    const day = this.ticket?.day ?? this.today;
    if (day === undefined) {
      line.hidden = true;

      return;
    }
    line.textContent = longDay(day);
    line.hidden = false;
  }

  /**
   * Opens on the name's own hover and its own focus (#236): the name is a Tab
   * stop whether or not it is cut, and `when-cut` keeps this shut when it fits.
   */
  private instanceTooltip(name: string): HTMLElement {
    return cutTextTooltip(this.instanceId, name);
  }

  private closeButton(): HTMLElement {
    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.className = ICON_BUTTON;
    close.innerHTML = iconMarkup("close");
    // The instance name before it in the header is a Tab stop now (#236);
    // without this, showModal() would focus the name instead of Close, and
    // open its tooltip the moment the dialog appears.
    close.autofocus = true;
    close.addEventListener("click", () => {
      this.dialog?.close();
    });
    this.closeControl = close;

    return close;
  }

  /**
   * Deleting an entry removes the very row — and its own Delete button — the
   * keyboard was just on: renderEntries() rebuilds the list wholesale, the
   * same reason today.ts's pin controls needed this. Left alone, focus falls
   * out of the dialog entirely (the confirm dialog's own close already
   * restored it to the now-gone button). Close is the one control this
   * dialog always has, deleted-to-empty or not, so it is the fallback. A
   * no-op once focus already landed somewhere inside the dialog — startEditing
   * moves it to the comment field itself, which this must not override.
   * `preferred` wins over Close while it is still in the dialog: save()
   * passes the control it disabled, which dropped focus to <body>.
   */
  private refocusIfLostFromDialog(preferred?: Element | null): void {
    const dialog = this.dialog;
    const active = document.activeElement;
    if (!dialog || (active && dialog.contains(active))) return;

    if (preferred instanceof HTMLElement && dialog.contains(preferred)) preferred.focus();
    else this.closeControl?.focus();
  }

  private entryList(): HTMLElement {
    const list = document.createElement("ul");
    list.className = "flex flex-col gap-0.5 px-3.5 py-2";
    this.list = list;

    return list;
  }

  /**
   * Beneath the list rather than inside it — the prototype's `.eempty` is a
   * sibling of `.elist`, not one of its items — and padded to the header's own
   * 20px gutter rather than the list's 14px, which is what lines the line's
   * left edge up with the heading above it.
   *
   * Names the day it is empty for when the ticket is scoped, per Decision 4;
   * an unscoped ticket keeps the plain "today" wording rather than spelling
   * out the date, so it reads as it always has.
   */
  private emptyLine(ticket: EntryTicket): HTMLElement {
    const line = document.createElement("p");
    line.className = "text-ink-muted px-5 pt-[10px] pb-4 text-base";
    line.textContent =
      ticket.day === undefined
        ? "Nothing logged against this ticket today."
        : `Nothing logged against this ticket on ${longDay(ticket.day)}.`;
    line.hidden = true;
    this.empty = line;

    return line;
  }

  private footForm(): HTMLElement {
    const foot = document.createElement("div");
    foot.className = "border-edge border-t px-5 pt-3.5 pb-4";

    foot.append(this.fieldRow());

    return foot;
  }

  private fieldRow(): HTMLElement {
    const row = document.createElement("div");
    row.className = "flex items-center gap-3";

    const duration = document.createElement("that-duration") as ThatDuration;
    duration.setAttribute("label", "Duration");
    this.duration = duration;

    const comment = document.createElement("input");
    comment.type = "text";
    comment.placeholder = "What did you work on?";
    comment.id = `that-entry-dialog-comment-${String(this.sequence)}`;
    // text-sm, matching the duration field beside it rather than the
    // prototype's 15px — the drawing's padding is transcribed, in the same
    // ticket that raises the button and the duration field beside it, but the
    // 15px font size was never one of the drawn drift criteria. The measured
    // agreement between the three is asserted in entries.spec.ts.
    // h-[38px] rather than leaving the height to padding plus line height, for
    // the same reason that-duration's group pins its own: this field's font
    // and the duration field's mono face resolve "normal" line-height a pixel
    // or two apart at the same nominal size, and only an explicit height keeps
    // all three foot-form controls at the drawn 38px regardless.
    comment.className = COMMENT_FIELD_CLASS;
    comment.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      void this.save();
    });
    this.comment = comment;

    const submit = document.createElement("that-button");
    submit.setAttribute("variant", "primary");
    submit.setAttribute("label", "Add entry");
    submit.addEventListener("click", () => {
      void this.save();
    });
    this.submit = submit;

    // #297: sr-only is absolutely positioned, so it is no flex item and the
    // row's gap and the drawn 38px bar are untouched.
    const label = document.createElement("label");
    label.htmlFor = comment.id;
    label.className = "sr-only";
    label.textContent = "Description";

    row.append(duration, label, comment, submit, ...this.cancelEditControl());

    return row;
  }

  /**
   * Cancel is an icon beside Save rather than a word, and it is present only
   * while there is an edit to abandon. It stays visible rather than living only
   * on Esc — #29 added exactly this to Settings' edit mode because it was
   * missing, and nothing about being inside a modal changes the argument.
   *
   * The tooltip is never its accessible name: the aria-label below stands on
   * its own for a keyboard and a screen reader, which a hover tooltip reaches
   * neither of.
   */
  private cancelEditControl(): HTMLElement[] {
    const id = `that-entry-cancel-${String(this.sequence)}`;

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.id = id;
    cancel.hidden = true;
    cancel.setAttribute("aria-label", "Stop editing");
    cancel.className = ICON_BUTTON;
    cancel.innerHTML = iconMarkup("close");
    cancel.addEventListener("click", () => {
      this.stopEditing();
    });
    this.cancel = cancel;

    const tooltip = document.createElement("that-tooltip");
    tooltip.setAttribute("for", id);
    tooltip.setAttribute("anchor", "end");
    tooltip.textContent = "cancel editing";

    return [cancel, tooltip];
  }

  /**
   * Re-reads the ticket's own day — a ranged read when it has one, the bare
   * (today) read when it does not — and redraws everything that depends on
   * it, returning the whole day so a mutation can hand it to the
   * announcement. Filtered here rather than asked for by issue: the rail and
   * the row totals want the same response, and one read keeps every figure
   * agreeing by construction rather than by three reads of one table.
   */
  private async reload(): Promise<Entry[] | null> {
    const ticket = this.ticket;
    if (!ticket) return null;

    try {
      const range = ticket.day === undefined ? undefined : { from: ticket.day, to: ticket.day };
      const { today, entries } = await listEntries(range);
      this.today = today;
      this.updateDayLine();
      this.entries = entries.filter(
        (entry) => entry.instanceId === ticket.instanceId && entry.issueKey === ticket.issueKey,
      );
      this.renderEntries();

      return entries;
    } catch (error) {
      this.showFailure(error, "Could not read the time logged against this ticket.");

      return null;
    }
  }

  private renderEntries(): void {
    const list = this.list;
    const total = this.total;
    const empty = this.empty;
    if (!list || !total || !empty) return;

    total.textContent = totalFigure(
      this.entries.filter(countsInTotals).reduce((sum, entry) => sum + entry.seconds, 0),
    );

    const hasEntries = this.entries.length > 0;
    empty.hidden = hasEntries;
    list.replaceChildren(...(hasEntries ? this.entries.map((entry) => this.entryRow(entry)) : []));
  }

  /**
   * One entry: what it cost, what it was for, whether Jira has it, and the two
   * ways to change it. The start time is gone from the line — it named nothing
   * a reader was looking for — but it stays in both controls' accessible names,
   * where it is the only thing telling two entries of the same length apart.
   */
  private entryRow(entry: Entry): HTMLElement {
    const pending = entry.pushState === "deleted";
    const row = document.createElement("li");
    row.className = "flex items-center gap-3 rounded-sm px-2.5 py-2";
    // The whole of what says which entry the foot form is bound to, now that no
    // other row dims and no line of text names one: a wash and a bar down the
    // left edge, drawn as an inset shadow so switching it on moves nothing.
    if (this.editing?.id === entry.id) {
      row.classList.add("bg-hover", "shadow-[inset_2px_0_0_var(--color-primary)]");
    }

    const duration = document.createElement("span");
    duration.className = "that-tnum font-mono w-[68px] shrink-0 font-bold";
    duration.textContent = totalFigure(entry.seconds);
    if (pending) duration.classList.add(...STRUCK);

    const commentId = `that-entry-comment-${this.sequence}-${entry.id}`;
    const comment = document.createElement("span");
    comment.id = commentId;
    comment.tabIndex = 0;
    comment.className = "min-w-0 flex-1 truncate text-base";
    comment.textContent = entry.comment;
    if (entry.comment === "") {
      // Muted, not faint: --color-ink-faint is a mark colour and fails the text
      // contrast floor in both themes. These are words.
      comment.classList.add("text-ink-muted");
      comment.textContent = "No comment";
    }
    if (pending) comment.classList.add(...STRUCK);

    const time = clockTime(entry.startedAt);
    const actions = document.createElement("div");
    actions.className = "flex shrink-0 items-center gap-1.5";
    if (pending) {
      // The edit slot stays, empty, so Restore lands exactly where Delete was
      // and nothing in the row moves.
      const editSlot = document.createElement("span");
      editSlot.className = "size-[34px] shrink-0";
      actions.append(
        editSlot,
        ...rowAction(
          "undo",
          `Restore the ${time} entry`,
          "restore entry",
          ICON_BUTTON_RESTORE,
          this.restoreId(entry),
          () => {
            void this.restore(entry);
          },
        ),
      );
    } else {
      actions.append(
        ...rowAction(
          "edit",
          `Edit the ${time} entry`,
          "edit entry",
          ICON_BUTTON,
          `that-entry-edit-${this.sequence}-${entry.id}`,
          () => {
            this.startEditing(entry);
          },
        ),
        ...rowAction(
          "trash",
          `Delete the ${time} entry`,
          "delete entry",
          ICON_BUTTON_DESTRUCTIVE,
          this.deleteId(entry),
          () => {
            void this.confirmAndDelete(entry);
          },
        ),
      );
    }

    // The popover rides inside the row rather than beside it. It is closed —
    // and so `display: none` — until it is shown, and open it is in the top
    // layer, out of this flex line either way.
    row.append(
      duration,
      comment,
      this.commentTooltip(commentId, entry.comment),
      ...this.pushMark(entry),
      actions,
    );

    return row;
  }

  /**
   * Opens on the comment's own hover and its own focus (#236), never on a
   * neighbour's: the comment is a Tab stop whether or not it is cut —
   * "No comment" included — so the Tab order never changes with the window's
   * width, and `when-cut` keeps this shut when there is nothing to give back.
   */
  private commentTooltip(forId: string, comment: string): HTMLElement {
    return cutTextTooltip(forId, comment === "" ? "No comment" : comment);
  }

  /**
   * The push state as a mark with a popover naming it. `pushed` gets the drawn
   * check the prototype gives it: this row has the room a grid cell does not.
   *
   * `unpushed` draws a mark rather than nothing: a fresh entry is the case this
   * dialog is most often looking at, and the marker is what the design gives it
   * instead of a line of prose explaining that saving is not sending.
   *
   * `role="img"` with a label, because the mark is the only thing here carrying
   * the fact; the popover is decoration over it and never the accessible name.
   */
  private pushMark(entry: Entry): [HTMLElement, HTMLElement] {
    const state: PushMark = PUSH_MARKS[knownPushState(entry.pushState)];
    const id = `that-entry-mark-${String(this.sequence)}-${String(entry.id)}`;

    const holder = document.createElement("span");
    holder.id = id;
    holder.tabIndex = 0;
    holder.setAttribute("role", "img");
    holder.setAttribute("aria-label", state.words);
    holder.className = `flex size-[22px] shrink-0 items-center justify-center rounded-sm ${state.tone}`;

    if (state.icon) {
      holder.innerHTML = iconMarkup(state.icon, 15);
    } else if (state.shape !== undefined) {
      const shape = document.createElement("span");
      shape.className = state.shape;
      if (state.markup !== undefined) shape.innerHTML = state.markup;
      holder.append(shape);
    }

    const tooltip = document.createElement("that-tooltip");
    tooltip.setAttribute("for", id);
    tooltip.textContent = state.words;

    return [holder, tooltip];
  }

  private startEditing(entry: Entry): void {
    this.editing = entry;
    if (this.duration) this.duration.seconds = entry.seconds;
    if (this.comment) this.comment.value = entry.comment;
    this.submit?.setAttribute("label", "Save");
    if (this.cancel) this.cancel.hidden = false;
    this.clearNotice();
    this.renderEntries();
    this.comment?.focus();
  }

  private stopEditing(): void {
    this.editing = undefined;
    if (this.duration) this.duration.seconds = 0;
    if (this.comment) this.comment.value = "";
    this.submit?.setAttribute("label", "Add entry");
    if (this.cancel) this.cancel.hidden = true;
    this.renderEntries();
  }

  private async save(): Promise<void> {
    const ticket = this.ticket;
    const duration = this.duration;
    const comment = this.comment;
    if (!ticket || !duration || !comment || this.busy) return;

    const seconds = duration.seconds;
    if (seconds <= 0) {
      this.showNotice("error", "Enter a duration first.");

      return;
    }

    const editing = this.editing;
    this.clearNotice();
    const focused = document.activeElement;
    this.setBusy(true);
    try {
      if (editing) {
        await updateEntry(editing.id, { seconds, comment: comment.value });
      } else {
        await createEntry({
          instanceId: ticket.instanceId,
          issueKey: ticket.issueKey,
          day: ticket.day,
          seconds,
          comment: comment.value,
        });
      }
      this.stopEditing();
      await this.afterMutation();
    } catch (error) {
      this.showFailure(error, "Could not save the entry.");
    } finally {
      this.setBusy(false);
      this.refocusIfLostFromDialog(focused);
    }
  }

  private async confirmAndDelete(entry: Entry): Promise<void> {
    const logged = `${totalFigure(entry.seconds)} logged at ${clockTime(entry.startedAt)}`;
    // An entry Jira holds waits for the push and can be restored until then;
    // one it does not goes now. Neither wording names Jira (#280, decision 9).
    const waits = entry.pushState === "pushed" || entry.pushState === "dirty";
    const confirmed = await confirmDestructive({
      heading: "Delete this entry?",
      body: waits
        ? `${logged} will be deleted at the next push. You can restore it until then.`
        : `${logged} will be removed.`,
      confirmLabel: "Delete",
    });
    if (!confirmed) return;

    this.clearNotice();
    try {
      await deleteEntry(entry.id);
      // An entry being edited that is then deleted leaves the foot form bound
      // to a row that is gone or can no longer be edited.
      if (this.editing?.id === entry.id) this.stopEditing();
      await this.afterMutation();
      this.focusOrFallback(this.restoreId(entry));
    } catch (error) {
      this.showFailure(error, "Could not delete the entry.");
    }
  }

  private async restore(entry: Entry): Promise<void> {
    this.clearNotice();
    try {
      await restoreEntry(entry.id);
      await this.afterMutation();
      this.focusOrFallback(this.deleteId(entry));
    } catch (error) {
      this.showFailure(error, "Could not restore the entry.");
      // Another tab restored it, or a push removed it: the row on screen is stale.
      if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
        await this.reload();
        this.refocusIfLostFromDialog();
      }
    }
  }

  private deleteId(entry: Entry): string {
    return `that-entry-delete-${this.sequence}-${entry.id}`;
  }

  private restoreId(entry: Entry): string {
    return `that-entry-restore-${this.sequence}-${entry.id}`;
  }

  /** Delete and Restore share a slot, so after either the other is where focus
   *  goes; a row that is gone falls back to Close. */
  private focusOrFallback(id: string): void {
    const control = this.dialog?.querySelector<HTMLElement>(`#${id}`);
    if (control) control.focus();
    else this.refocusIfLostFromDialog();
  }

  private async afterMutation(): Promise<void> {
    const entries = await this.reload();
    // The reload's response rides on the announcement, so the rail and the
    // row totals repaint from the read this dialog already made instead of
    // racing three of their own. A failed reload announces without it — the
    // mutation itself succeeded, so the listeners fall back to reading the
    // day themselves.
    //
    // A ticket scoped to a day that is not today's is a second reason to
    // withhold the payload: what was just read is that other day's whole
    // list, and every listener answers its own period — Today's above all —
    // so handing it over would paint those rows over today's instead of
    // leaving each listener to re-read the period it actually shows.
    const scopedToOtherDay = this.ticket?.day !== undefined && this.ticket.day !== this.today;
    announceEntriesChanged(scopedToOtherDay ? undefined : (entries ?? undefined));
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    if (busy) {
      this.submit?.setAttribute("disabled", "");
      this.duration?.setAttribute("disabled", "");
    } else {
      this.submit?.removeAttribute("disabled");
      this.duration?.removeAttribute("disabled");
    }
  }

  private showFailure(error: unknown, fallback: string): void {
    this.showNotice("error", error instanceof ApiError ? error.message : fallback);
  }

  private showNotice(tone: string, message: string): void {
    this.blocks.clear();
    this.blocks.add(tone, message);
  }

  private clearNotice(): void {
    this.blocks.clear();
  }
}

/**
 * An icon-only control on a row, with its `.tip` popover — the same shape
 * `cancelEditControl` uses beside it. The mark is aria-hidden by construction,
 * so the name has to be the label; the tooltip is never that name, which is
 * why its words are the plain "edit entry" / "delete entry" / "restore entry"
 * rather than the aria-label's time-specific sentence.
 */
function rowAction(
  icon: "edit" | "trash" | "undo",
  description: string,
  words: string,
  className: string,
  id: string,
  act: () => void,
): HTMLElement[] {
  const button = document.createElement("button");
  button.type = "button";
  button.id = id;
  button.setAttribute("aria-label", description);
  button.className = className;
  button.innerHTML = iconMarkup(icon, 17);
  button.addEventListener("click", act);

  const tooltip = document.createElement("that-tooltip");
  tooltip.setAttribute("for", id);
  tooltip.setAttribute("anchor", "end");
  tooltip.textContent = words;

  return [button, tooltip];
}

/**
 * The wall clock an entry was started at, read straight out of the string.
 *
 * Deliberately not via Date: the server has already converted started_at into
 * THAT_TIMEZONE, and parsing it would re-convert it into whatever zone this
 * browser is in — which is exactly the disagreement the configured zone exists
 * to prevent.
 */
function clockTime(startedAt: string): string {
  return startedAt.slice(11, 16);
}

customElements.define("that-entry-dialog", ThatEntryDialog);

/**
 * Opens the dialog for one ticket, appended to `host` — the view's own root,
 * never the row that asked for it.
 */
export function openEntryDialog(host: HTMLElement, ticket: EntryTicket): void {
  const element = document.createElement("that-entry-dialog") as ThatEntryDialog;
  element.ticket = ticket;
  host.append(element);
}
