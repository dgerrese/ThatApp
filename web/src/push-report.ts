import type { PushResponse, PushResult } from "./types";

/**
 * The one rendering of a finished push, shared by every view that can trigger
 * one. Not duplicated per view on purpose: the store_failed branch below is a
 * safety property, and a second copy is a second chance to word it wrongly.
 */
export interface PushReportOptions {
  /** Prefix each failure with its day. A week push covers several; a day push does not. */
  nameDays?: boolean;
}

/**
 * Names every entry that did not reach Jira. A count alone would be the blanket
 * status the spec calls a defect: with several entries against one ticket, "2
 * failed" does not say which two.
 *
 * A failure whose code is `store_failed` is reported apart from the rest, and
 * that split is the point of reading the code at all. Those entries did reach
 * Jira — only the local record of them did not — so the retry that is right for
 * every other failure is exactly wrong for them: pressing Push again logs the
 * time in Jira twice, and nothing in this app can undo it.
 *
 * `unanswered` names the days whose request never came back at all. They have
 * no results to count either way, so a report reading only the responses would
 * find no failures and print the success line over a push that half finished.
 */
export function pushReportNodes(
  responses: PushResponse[],
  unanswered: string[],
  options: PushReportOptions = {},
): Node[] {
  const all = responses.flatMap((response) =>
    response.results.map((result) => ({ day: response.day, result })),
  );
  const failed = all.filter((line) => line.result.status === "failed");
  const pushed = all.filter((line) => line.result.status === "pushed");

  if (failed.length === 0 && unanswered.length === 0) {
    return [
      alertFor(
        "success",
        `Pushed ${String(pushed.length)} ${pushed.length === 1 ? "entry" : "entries"} to Jira.`,
      ),
    ];
  }

  const stranded = failed.filter((line) => line.result.error?.code === "store_failed");
  const retryable = failed.filter((line) => line.result.error?.code !== "store_failed");
  const nodes: Node[] = [];

  if (retryable.length > 0) {
    nodes.push(
      alertFor(
        "warning",
        `${String(retryable.length)} of ${String(all.length)} entries did not ` +
          "reach Jira. Press Push to Jira again to retry them.",
      ),
      failureList(
        retryable.map(
          (line) =>
            label(line.day, line.result, options) +
            ` — ${line.result.error?.message ?? "unknown error"}`,
        ),
      ),
    );
  }

  if (unanswered.length > 0) {
    nodes.push(
      alertFor(
        "warning",
        `${String(unanswered.length)} ${unanswered.length === 1 ? "day" : "days"} did not ` +
          `answer, so what happened to ${unanswered.length === 1 ? "its" : "their"} time is ` +
          "not known here. Press Push to Jira again.",
      ),
      failureList(unanswered),
    );
  }

  if (stranded.length > 0) {
    nodes.push(
      alertFor(
        "error",
        `${String(stranded.length)} ${stranded.length === 1 ? "entry" : "entries"} reached Jira ` +
          "but could not be recorded here. Check the issue in Jira before pushing again — " +
          "pushing now would log the time twice.",
      ),
      failureList(stranded.map((line) => label(line.day, line.result, options))),
    );
  }

  return nodes;
}

/** A week push covers several days, so "RID-204 failed" does not say where to look. */
function label(day: string, result: PushResult, options: PushReportOptions): string {
  return options.nameDays === true ? `${day} · ${result.issueKey}` : result.issueKey;
}

/**
 * A sibling of the alert it follows, never a child of it: that-alert renders by
 * calling this.replaceChildren(mark, message), so anything appended inside it
 * is discarded the next time an attribute changes.
 */
function failureList(lines: string[]): HTMLElement {
  const list = document.createElement("ul");
  list.className = "mt-2 ml-6 space-y-1 text-sm";
  for (const line of lines) {
    const item = document.createElement("li");
    item.textContent = line;
    list.append(item);
  }

  return list;
}

function alertFor(tone: string, message: string): HTMLElement {
  const alert = document.createElement("that-alert");
  alert.setAttribute("tone", tone);
  alert.setAttribute("message", message);

  return alert;
}
