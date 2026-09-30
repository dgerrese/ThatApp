import type { WeekFetchResponse } from "./types.ts";

/** One alert and the list beside it. An empty list means the alert stands alone. */
export interface ReportLine {
  tone: "success" | "warning" | "error";
  message: string;
  items: string[];
}

/**
 * What a finished fetch says, decided apart from how it is drawn so the wording
 * can be read as a table.
 *
 * A clean run is the counts and nothing else. Names appear in exactly two cases,
 * and both are things the user has to go and do something about: an entry whose
 * unpushed edit the fetch kept over what came back, and an instance that could
 * not be read. Entries left alone for any other reason are not reported at all —
 * on a clean run that count is noise, and where it matters the list carries it.
 */
export function fetchReportLines(response: WeekFetchResponse): ReportLine[] {
  const lines: ReportLine[] = [{ tone: "success", message: summarise(response), items: [] }];

  if (response.keptLocal.length > 0) {
    const many = response.keptLocal.length !== 1;
    lines.push({
      tone: "warning",
      message:
        `${String(response.keptLocal.length)} ${many ? "entries have" : "entry has"} changes ` +
        `you have not pushed, and the worklog holds something different. ` +
        `${many ? "They were" : "It was"} left as ${many ? "they are" : "it is"}.`,
      items: response.keptLocal.map((kept) => `${kept.day} · ${kept.issueKey}`),
    });
  }

  for (const failure of response.failures) {
    lines.push({
      tone: "error",
      message: `${failure.instanceName} could not be read, so none of its time is here.`,
      items: [failure.error.message],
    });
  }

  return lines;
}

/** "Added 3 entries and updated 1." — or that nothing changed, rather than two zeroes. */
function summarise(response: WeekFetchResponse): string {
  if (response.created === 0 && response.updated === 0) {
    return "Nothing to add or update.";
  }

  const entries = response.created === 1 ? "entry" : "entries";

  return `Added ${String(response.created)} ${entries} and updated ${String(response.updated)}.`;
}
