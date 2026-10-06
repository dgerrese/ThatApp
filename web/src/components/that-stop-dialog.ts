import "./that-button";
import "./that-dialog-blocks";

import { ApiError } from "../api";
import { fieldFigure, roundedSeconds } from "../duration";
import type { Rounding, StopChoice } from "../types";
import type { ThatDialogBlocks } from "./that-dialog-blocks";
import {
  COMMENT_FIELD_CLASS,
  CONFIRM_BODY_CLASS,
  CONFIRM_DIALOG_CLASS,
  CONFIRM_HEADING_CLASS,
  dialogButton,
} from "./that-confirm";

/**
 * The stop dialog of #185: the rounding is the button. A native <dialog>
 * like that-confirm's, whose shell and buttons it borrows; wider than
 * that-confirm's max-w-sm so the button row holds on one line (Decision 13).
 *
 * The timer keeps running while this is open, so the run line and both
 * labels repaint every second — a button always names what the server,
 * reading its own clock at the click, will write.
 */
export class ThatStopDialog extends HTMLElement {
  issueKey = "";
  nextIssueKey: string | undefined;
  elapsed: () => number = () => 0;
  commit: (choice: StopChoice) => Promise<void> = () => Promise.resolve();

  private readonly blocks = document.createElement("that-dialog-blocks") as ThatDialogBlocks;

  private dialog: HTMLDialogElement | undefined;
  private ran: HTMLElement | undefined;
  private keep: HTMLElement | undefined;
  private down: HTMLElement | undefined;
  private up: HTMLElement | undefined;
  private field: HTMLInputElement | undefined;
  private tick: number | undefined;
  private busy = false;

  get comment(): string {
    return this.field?.value.trim() ?? "";
  }

  connectedCallback(): void {
    if (this.dialog) return;

    const dialog = document.createElement("dialog");
    dialog.className = `${CONFIRM_DIALOG_CLASS} w-[440px] max-w-[calc(100vw-2rem)]`;

    const heading = document.createElement("h2");
    heading.id = "that-stop-dialog-heading";
    heading.className = CONFIRM_HEADING_CLASS;
    heading.textContent = this.nextIssueKey
      ? `Stop ${this.issueKey} and start ${this.nextIssueKey}?`
      : "Stop the timer?";

    const line = document.createElement("p");
    line.className = CONFIRM_BODY_CLASS;
    const key = document.createElement("span");
    key.className = "that-key that-tnum";
    key.textContent = this.issueKey;
    const ran = document.createElement("span");
    ran.className = "that-tnum font-mono";
    line.append(key, " ran ", ran);

    const label = document.createElement("label");
    label.className = "mb-4 grid gap-1.5";
    const eyebrow = document.createElement("span");
    eyebrow.className = "text-ink-muted text-xs font-bold tracking-[0.16em] uppercase";
    eyebrow.textContent = "Description";
    const field = document.createElement("input");
    field.type = "text";
    field.placeholder = "Optional — becomes the Jira worklog comment";
    field.className = COMMENT_FIELD_CLASS;
    field.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      void this.confirm("up");
    });
    label.append(eyebrow, field);

    const actions = document.createElement("div");
    actions.className = "flex flex-wrap justify-end gap-2";
    const keep = dialogButton("Keep running", "secondary");
    const down = dialogButton("", "secondary");
    const up = dialogButton("", "primary");
    keep.addEventListener("click", () => dialog.close());
    down.addEventListener("click", () => void this.confirm("down"));
    up.addEventListener("click", () => void this.confirm("up"));
    actions.append(keep, down, up);

    // Esc is a cancel; one arriving while a POST is out would close the dialog under it.
    dialog.addEventListener("cancel", (event) => {
      if (this.busy) event.preventDefault();
    });

    dialog.setAttribute("aria-labelledby", heading.id);
    dialog.append(heading, line, label, actions, this.blocks);
    this.append(dialog);
    this.dialog = dialog;
    this.ran = ran;
    this.keep = keep;
    this.down = down;
    this.up = up;
    this.field = field;

    this.paint();
    this.tick = window.setInterval(() => this.paint(), 1000);
    dialog.showModal();
    this.blocks.attach(dialog);
  }

  disconnectedCallback(): void {
    window.clearInterval(this.tick);
  }

  /** Commits the choice first and closes only once it landed; a failure stays
   *  in the dialog as a block, so the typed description survives a retry. */
  private async confirm(round: Rounding): Promise<void> {
    if (this.busy) return;
    this.blocks.clear();
    this.setBusy(true);
    try {
      await this.commit({ round, comment: this.comment });
      this.dialog?.close();
    } catch (error) {
      this.blocks.add(
        "error",
        error instanceof ApiError ? error.message : "Could not stop the timer — try again.",
      );
    } finally {
      this.setBusy(false);
    }
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    for (const button of [this.keep, this.down, this.up]) {
      if (busy) button?.setAttribute("disabled", "");
      else button?.removeAttribute("disabled");
    }
  }

  private paint(): void {
    const seconds = this.elapsed();
    if (this.ran) this.ran.textContent = fieldFigure(seconds);

    const floor = roundedSeconds(seconds, "down");
    setIfChanged(this.down, "label", floor === 0 ? "Discard run" : `Log ${fieldFigure(floor)}`);
    setIfChanged(this.down, "variant", floor === 0 ? "danger" : "secondary");
    setIfChanged(this.up, "label", `Log ${fieldFigure(roundedSeconds(seconds, "up"))}`);
  }
}

function setIfChanged(element: HTMLElement | undefined, name: string, value: string): void {
  if (element && element.getAttribute(name) !== value) element.setAttribute(name, value);
}

customElements.define("that-stop-dialog", ThatStopDialog);

/** Opens the stop dialog; a confirmed rounding runs `commit` while the dialog
 *  stays open. Resolves once the dialog closes — committed, kept running, or Esc. */
export function confirmStop(
  issueKey: string,
  nextIssueKey: string | undefined,
  elapsed: () => number,
  commit: (choice: StopChoice) => Promise<void>,
): Promise<void> {
  const element = document.createElement("that-stop-dialog") as ThatStopDialog;
  element.issueKey = issueKey;
  element.nextIssueKey = nextIssueKey;
  element.elapsed = elapsed;
  element.commit = commit;
  document.body.append(element);

  const dialog = element.querySelector("dialog");
  if (!dialog) {
    element.remove();

    return Promise.resolve();
  }

  // <dialog>'s close event does not bubble, so this listens on the dialog itself.
  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => {
        element.remove();
        resolve();
      },
      { once: true },
    );
  });
}
