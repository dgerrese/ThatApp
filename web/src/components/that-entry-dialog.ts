import "./that-alert";
import "./that-button";
import "./that-confirm";
import "./that-duration";

import { ApiError, createEntry, deleteEntry, listEntries, updateEntry } from "../api";
import { confirmDestructive } from "./that-confirm";
import { announceEntriesChanged } from "../entries-changed";
import { totalFigure } from "../format";
import { iconMarkup } from "../icons";
import type { Entry } from "../types";
import type { ThatDuration } from "./that-duration";

/** What the row that opened the dialog knows about its ticket. */
export interface EntryTicket {
  instanceId: number;
  instanceName: string;
  issueKey: string;
  summary: string;
  status: string;
}

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
 * It is appended beside the view rather than inside the row that opened it.
 * Today re-renders its lists wholesale on Refresh, and a dialog nested in a row
 * would be destroyed mid-edit — #29's bug wearing new clothes.
 *
 * There is exactly one place to type. Editing loads the entry into the same
 * foot form and names the mode on a line of its own, so the stepper, the
 * comment and the one primary button sit where they sat when adding.
 */
export class ThatEntryDialog extends HTMLElement {
  /** Assigned before the element is appended, which is what connectedCallback builds from. */
  ticket: EntryTicket | undefined;

  private dialog: HTMLDialogElement | undefined;
  private total: HTMLElement | undefined;
  private list: HTMLElement | undefined;
  private notice: HTMLElement | undefined;
  private modeLine: HTMLElement | undefined;
  private modeLabel: HTMLElement | undefined;
  private duration: ThatDuration | undefined;
  private comment: HTMLInputElement | undefined;
  private submit: HTMLElement | undefined;

  private entries: Entry[] = [];
  private editing: Entry | undefined;
  private busy = false;

  connectedCallback(): void {
    if (this.dialog || !this.ticket) return;

    this.build(this.ticket).showModal();
    void this.reload();
  }

  private build(ticket: EntryTicket): HTMLDialogElement {
    const dialog = document.createElement("dialog");
    dialog.className =
      "bg-raised text-ink shadow-dialog m-auto w-[560px] max-w-[calc(100vw-2rem)] rounded-md p-5";
    dialog.setAttribute("aria-labelledby", "that-entry-dialog-heading");

    dialog.append(this.header(ticket), this.entryList(), this.footForm());
    // Closing is the only exit, whether it came from Esc, the round Close or a
    // successful mutation, so the element removes itself from one place.
    dialog.addEventListener("close", () => {
      this.remove();
    });

    this.dialog = dialog;
    this.append(dialog);

    return dialog;
  }

  private header(ticket: EntryTicket): HTMLElement {
    const header = document.createElement("div");
    header.className = "flex items-start justify-between gap-4";

    const identity = document.createElement("div");
    identity.className = "min-w-0";

    const heading = document.createElement("h2");
    heading.id = "that-entry-dialog-heading";
    heading.className = "text-xl font-bold tracking-[-0.02em]";
    heading.textContent = ticket.summary;

    const meta = document.createElement("p");
    meta.className = "text-ink-muted mt-0.5 text-sm";
    // A middle dot rather than three spans: the three facts read as one line,
    // and the status is not a chip here — the row already draws it as one.
    meta.textContent = [ticket.issueKey, ticket.instanceName, ticket.status]
      .filter((part) => part !== "")
      .join(" · ");

    identity.append(heading, meta);

    const right = document.createElement("div");
    right.className = "flex shrink-0 items-center gap-3";

    const total = document.createElement("div");
    // Named, like #rail-total: one dialog is open at a time, and the ticket's
    // total and an entry's duration can read the same figure — which leaves
    // nothing else to tell them apart.
    total.id = "that-entry-dialog-total";
    total.className = "that-tnum text-[22px] leading-none font-bold tracking-[-0.02em]";
    total.textContent = totalFigure(0);
    this.total = total;

    right.append(total, this.closeButton());
    header.append(identity, right);

    return header;
  }

  private closeButton(): HTMLElement {
    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.className =
      "text-ink-muted hover:bg-hover hover:text-ink flex h-7 w-7 cursor-pointer " +
      "items-center justify-center rounded-full text-base";
    close.innerHTML = iconMarkup("close");
    close.addEventListener("click", () => {
      this.dialog?.close();
    });

    return close;
  }

  private entryList(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "mt-4";

    const list = document.createElement("ul");
    list.className = "divide-y divide-edge";
    this.list = list;

    wrapper.append(list);

    return wrapper;
  }

  private footForm(): HTMLElement {
    const foot = document.createElement("div");
    foot.className = "border-edge mt-4 border-t pt-4";

    const notice = document.createElement("div");
    notice.className = "mb-2 empty:hidden";
    this.notice = notice;

    foot.append(notice, this.modeRow(), this.fieldRow());

    return foot;
  }

  /**
   * The mode gets a line of its own so the field row below it is identical in
   * both modes. Every arrangement that put the mode or its dismissal inside the
   * field row cost the comment field width; this one costs height instead, and
   * the comment is the field that grows.
   */
  private modeRow(): HTMLElement {
    const row = document.createElement("div");
    row.className = "mb-2 flex items-center justify-between gap-2";
    row.hidden = true;

    const label = document.createElement("span");
    label.className = "text-ink-muted text-xs font-bold tracking-[0.06em] uppercase";
    this.modeLabel = label;

    // Cancel stays visible rather than living only on Esc. #29 added exactly
    // this to Settings' edit mode because it was missing, and nothing about
    // being inside a modal changes the argument.
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.setAttribute("aria-label", "Stop editing");
    cancel.className = "text-ink-muted hover:text-ink cursor-pointer px-1 text-base leading-none";
    cancel.innerHTML = iconMarkup("close");
    cancel.addEventListener("click", () => {
      this.stopEditing();
    });

    row.append(label, cancel);
    this.modeLine = row;

    return row;
  }

  private fieldRow(): HTMLElement {
    const row = document.createElement("div");
    row.className = "flex items-center gap-2";

    const duration = document.createElement("that-duration") as ThatDuration;
    duration.setAttribute("label", "Duration");
    this.duration = duration;

    const comment = document.createElement("input");
    comment.type = "text";
    comment.placeholder = "What did you work on?";
    comment.className =
      "border-edge min-w-0 flex-1 rounded-sm border px-3 py-1.5 text-sm " +
      "focus:border-ink focus:outline-none";
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

    row.append(duration, comment, submit);

    return row;
  }

  /**
   * Re-reads the day and redraws everything that depends on it, returning the
   * whole day so a mutation can hand it to the announcement. Filtered here
   * rather than asked for by issue: the rail and the row totals want the same
   * response, and one read keeps every figure agreeing by construction rather
   * than by three reads of one table.
   */
  private async reload(): Promise<Entry[] | null> {
    const ticket = this.ticket;
    if (!ticket) return null;

    try {
      const entries = await listEntries();
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
    if (!list || !total) return;

    total.textContent = totalFigure(this.entries.reduce((sum, entry) => sum + entry.seconds, 0));

    if (this.entries.length === 0) {
      list.replaceChildren(emptyLine());
      return;
    }

    list.replaceChildren(...this.entries.map((entry) => this.entryRow(entry)));
  }

  private entryRow(entry: Entry): HTMLElement {
    const row = document.createElement("li");
    row.className = "flex items-baseline gap-3 py-2";
    // Dimming every row but the one being edited is what binds the foot form to
    // a particular entry — there is nothing else on screen that says which.
    if (this.editing && this.editing.id !== entry.id) {
      row.classList.add("opacity-40");
    }

    const started = document.createElement("span");
    started.className = "text-ink-muted that-tnum shrink-0 text-sm";
    started.textContent = clockTime(entry.startedAt);

    const duration = document.createElement("span");
    duration.className = "that-tnum w-16 shrink-0 font-bold";
    duration.textContent = totalFigure(entry.seconds);

    const comment = document.createElement("span");
    comment.className = "min-w-0 flex-1 truncate text-base";
    comment.textContent = entry.comment;
    if (entry.comment === "") {
      comment.classList.add("text-ink-faint");
      comment.textContent = "No comment";
    }

    const actions = document.createElement("div");
    actions.className = "flex shrink-0 items-center gap-1";
    actions.append(
      rowAction("Edit", `Edit the ${clockTime(entry.startedAt)} entry`, () => {
        this.startEditing(entry);
      }),
      rowAction("Delete", `Delete the ${clockTime(entry.startedAt)} entry`, () => {
        void this.confirmAndDelete(entry);
      }),
    );

    const badge = pushBadge(entry.pushState);
    row.append(started, duration, comment, ...(badge ? [badge] : []), actions);

    return row;
  }

  private startEditing(entry: Entry): void {
    this.editing = entry;
    if (this.duration) this.duration.seconds = entry.seconds;
    if (this.comment) this.comment.value = entry.comment;
    this.submit?.setAttribute("label", "Save");
    if (this.modeLabel)
      this.modeLabel.textContent = `Editing the ${clockTime(entry.startedAt)} entry`;
    if (this.modeLine) this.modeLine.hidden = false;
    this.clearNotice();
    this.renderEntries();
    this.comment?.focus();
  }

  private stopEditing(): void {
    this.editing = undefined;
    if (this.duration) this.duration.seconds = 0;
    if (this.comment) this.comment.value = "";
    this.submit?.setAttribute("label", "Add entry");
    if (this.modeLine) this.modeLine.hidden = true;
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
    this.setBusy(true);
    try {
      if (editing) {
        await updateEntry(editing.id, { seconds, comment: comment.value });
      } else {
        await createEntry({
          instanceId: ticket.instanceId,
          issueKey: ticket.issueKey,
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
    }
  }

  private async confirmAndDelete(entry: Entry): Promise<void> {
    const confirmed = await confirmDestructive({
      heading: "Delete this entry?",
      body: `${totalFigure(entry.seconds)} logged at ${clockTime(entry.startedAt)} will be removed.`,
      confirmLabel: "Delete",
    });
    if (!confirmed) return;

    try {
      await deleteEntry(entry.id);
      // An entry being edited that is then deleted leaves the foot form bound
      // to a row that no longer exists, and Save would 404.
      if (this.editing?.id === entry.id) this.stopEditing();
      await this.afterMutation();
    } catch (error) {
      this.showFailure(error, "Could not delete the entry.");
    }
  }

  private async afterMutation(): Promise<void> {
    const day = await this.reload();
    // The reload's response rides on the announcement, so the rail and the row
    // totals repaint from the read this dialog already made instead of racing
    // three of their own. A failed reload announces without it — the mutation
    // itself succeeded, so the listeners fall back to reading the day
    // themselves.
    announceEntriesChanged(day ?? undefined);
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
    const alert = document.createElement("that-alert");
    alert.setAttribute("tone", tone);
    alert.setAttribute("message", message);
    this.notice?.replaceChildren(alert);
  }

  private clearNotice(): void {
    this.notice?.replaceChildren();
  }
}

/**
 * The badge an entry wears for its push state. "unpushed" deliberately renders
 * nothing: it is the ordinary state of a fresh entry, and a chip on every row
 * would say least where it appeared most.
 */
function pushBadge(state: Entry["pushState"]): HTMLElement | null {
  // Each badged state is named, and anything else gets no badge — never a
  // default of "Pushed". pushState crosses the network and is only typed at
  // compile time, so a state this build does not recognise (a cached shell
  // against a newer server, a response that lost the field) reaches here as
  // something neither branch below should claim. Telling someone their time
  // reached Jira when it did not is the one wrong answer indistinguishable
  // from a true one; no badge merely says nothing.
  if (state !== "pushed" && state !== "dirty") return null;

  const badge = document.createElement("span");
  badge.className = "shrink-0 text-xs font-medium";

  if (state === "dirty") {
    badge.classList.add("text-pending");
    badge.textContent = "Edited since push";
  } else {
    badge.classList.add("text-running");
    badge.textContent = "Pushed";
  }

  return badge;
}

function rowAction(label: string, description: string, act: () => void): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.setAttribute("aria-label", description);
  button.className =
    "text-ink-muted hover:bg-hover hover:text-ink cursor-pointer rounded-sm px-2 py-1 text-sm";
  button.addEventListener("click", act);

  return button;
}

function emptyLine(): HTMLElement {
  const line = document.createElement("li");
  line.className = "text-ink-muted py-2 text-base";
  line.textContent = "Nothing logged against this ticket today.";

  return line;
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
