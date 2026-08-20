import "../components/wd-alert";
import "../components/wd-button";
import "../components/wd-card";
import "../components/wd-ticket-row";

import { ApiError, listIssues } from "../api";
import type { InstanceIssues, IssuesResponse } from "../types";

/**
 * The regions that outlive a fetch. They are threaded rather than held at module
 * scope: router.ts reuses one persistent mount point and has no navigation
 * cancellation, so module state would let a stale fetch write into a live view.
 */
interface Regions {
  header: HTMLElement;
  refresh: HTMLElement;
  results: HTMLElement;
}

export async function render(root: HTMLElement): Promise<void> {
  const container = document.createElement("div");
  container.className = "space-y-4";

  const header = document.createElement("div");
  header.className = "flex items-baseline justify-between";

  const heading = document.createElement("h2");
  heading.className = "text-lg font-medium";
  heading.textContent = "Assigned issues";

  const refresh = button("Refresh", "secondary");
  header.append(heading, refresh);

  // Hidden until the first response: there is nothing to refresh yet, and with
  // no instances configured it stays hidden for good.
  header.hidden = true;

  const results = document.createElement("div");
  results.className = "space-y-4";
  results.append(loadingLine());

  container.append(header, results);
  root.append(container);

  const regions: Regions = { header, refresh, results };
  refresh.addEventListener("click", () => {
    void load(regions);
  });

  await load(regions);
}

async function load(regions: Regions): Promise<void> {
  regions.refresh.setAttribute("disabled", "");

  try {
    // The cards already on screen stay put while this is in flight: a list that
    // blinks out and back is indistinguishable from one that broke.
    renderResponse(regions, await listIssues());
  } catch (error) {
    regions.header.hidden = false;
    regions.results.replaceChildren(alertFor("error", messageOf(error)));
  } finally {
    regions.refresh.removeAttribute("disabled");
  }
}

function renderResponse(regions: Regions, response: IssuesResponse): void {
  if (response.instances.length === 0) {
    regions.header.hidden = true;
    regions.results.replaceChildren(noInstances());
    return;
  }

  regions.header.hidden = false;
  regions.results.replaceChildren(...response.instances.map(instanceCard));
}

function instanceCard(group: InstanceIssues): HTMLElement {
  const card = document.createElement("wd-card");
  // wd-card has no observedAttributes, so the heading must be set before the
  // element is inserted; changing it afterwards silently does nothing.
  card.setAttribute("heading", group.name);

  if (group.error) {
    card.append(alertFor("error", group.error.message));

    return card;
  }

  if (group.issues.length === 0) {
    const empty = document.createElement("p");
    empty.className = "text-sm text-ink-muted";
    empty.textContent = "No issues assigned.";
    card.append(empty);

    return card;
  }

  const list = document.createElement("ul");
  list.className = "divide-y divide-edge";
  for (const issue of group.issues) {
    const item = document.createElement("li");
    const row = document.createElement("wd-ticket-row");
    row.setAttribute("key", issue.key);
    row.setAttribute("summary", issue.summary);
    row.setAttribute("status", issue.status);
    row.setAttribute("url", issue.url);
    item.append(row);
    list.append(item);
  }
  card.append(list);

  return card;
}

function loadingLine(): HTMLElement {
  const line = document.createElement("p");
  line.className = "text-sm text-ink-muted";
  line.textContent = "Loading…";

  return line;
}

function noInstances(): HTMLElement {
  const wrapper = document.createElement("div");

  const paragraph = document.createElement("p");
  paragraph.className = "text-ink-muted";
  paragraph.textContent = "No Jira instances yet. Add one to see your assigned issues.";

  const link = document.createElement("a");
  link.href = "/settings";
  link.dataset["route"] = "";
  link.className = "mt-4 inline-block font-medium text-link underline";
  link.textContent = "Open Settings";

  wrapper.append(paragraph, link);

  return wrapper;
}

// button, alertFor and messageOf are deliberate duplicates of the same three
// helpers in views/settings.ts. Extracting them into a shared module is the
// right end state, but it means editing settings.ts, which is outside this
// ticket's scope. Worth its own ticket.

function button(label: string, variant: string): HTMLElement {
  const element = document.createElement("wd-button");
  // label is the sole source of the inner button's accessible name; without it
  // role-based queries cannot find the button at all.
  element.setAttribute("label", label);
  element.setAttribute("variant", variant);

  return element;
}

function alertFor(tone: string, message: string): HTMLElement {
  const alert = document.createElement("wd-alert");
  alert.setAttribute("tone", tone);
  alert.setAttribute("message", message);

  return alert;
}

/** The server's message when there is one; ApiError carries it already. */
function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  return "Something went wrong.";
}
