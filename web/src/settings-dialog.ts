import "./components/that-alert";
import "./components/that-button";
import "./components/that-confirm";

import { alertFor, messageOf } from "./alert";
import { createInstance, deleteInstance, listInstances, testInstance, updateInstance } from "./api";
import { confirmDestructive } from "./components/that-confirm";
import { announceEntriesChanged } from "./entries-changed";
import { clockTime } from "./format";
import { iconMarkup } from "./icons";
import { paintInstanceDot } from "./instance-hue";
import { navigate } from "./router";
import { setThemePreference, themePreference } from "./theme";
import type { IconName } from "./icons";
import type { Instance } from "./types";
import type { ThemePreference } from "./theme";

interface Regions {
  errorSlot: HTMLElement;
  listSlot: HTMLElement;
  formSection: HTMLElement;
  addButton: HTMLButtonElement;
  // Numbers every list read this dialog starts, so refresh() can tell the
  // answer it is holding from one a later read has already superseded (#56).
  latestListRead: number;
  // Set by a save or a removal: the view beneath was drawn from the instances
  // as they were, and a removal also deleted entries the rail is counting.
  changed: boolean;
  closed: boolean;
  // What pressed open the form showing now, so closing it can hand focus back.
  formOpener: HTMLElement;
}

const HEADING_ID = "that-settings-heading";

/**
 * The top-layer element fills the viewport and is the scroller; the panel is an
 * ordinary child centred by its own auto margins (prototype lines 245–247).
 * Never centre it with align-items or justify-content instead: content centred
 * in a scroll container overflows both edges, and nothing can scroll to what
 * lies above the start edge, so a tall panel silently loses its top. The margin
 * is stated because Preflight's `* { margin: 0 }` beats the UA's own.
 */
const DIALOG_CLASS =
  "text-ink fixed inset-0 m-0 size-full max-h-none max-w-none overflow-y-auto border-0 " +
  "bg-scrim p-7 backdrop:bg-transparent open:flex open:flex-col";
const PANEL_CLASS =
  "bg-raised border-edge shadow-dialog m-auto w-[620px] max-w-full shrink-0 rounded-md border";
const SECTION_CLASS = "border-edge border-b px-5 py-[15px] last:border-b-0";
const SECTION_HEADING_CLASS = "text-ink-muted mb-2.5 text-xs font-bold tracking-[0.16em] uppercase";

export function showSettings(): void {
  // A second press that arrived while the first one's chunk was loading.
  if (document.getElementById(HEADING_ID)) return;

  const addButton = addInstanceButton(() => {
    showForm(regions, undefined, addButton);
  });
  const regions: Regions = {
    errorSlot: document.createElement("div"),
    listSlot: document.createElement("div"),
    formSection: document.createElement("section"),
    addButton,
    latestListRead: 0,
    changed: false,
    closed: false,
    formOpener: addButton,
  };
  regions.formSection.className = SECTION_CLASS;
  regions.formSection.hidden = true;

  const instances = section("Jira instances");
  instances.append(regions.errorSlot, regions.listSlot, addButton);

  const appearance = section("Appearance");
  appearance.append(themeControl());

  const dialog = document.createElement("dialog");
  dialog.className = DIALOG_CLASS;
  dialog.setAttribute("aria-labelledby", HEADING_ID);

  const panel = document.createElement("div");
  panel.dataset["settingsPanel"] = "";
  panel.className = PANEL_CLASS;
  panel.append(header(dialog), instances, regions.formSection, appearance);
  dialog.append(panel);

  dialog.addEventListener("close", () => {
    dialog.remove();
    regions.closed = true;
    if (regions.changed) void redrawBeneath();
  });

  // Chromium's close watcher: once a cancel is prevented, the next close request
  // with no user activation in between closes the dialog without a cancelable
  // cancel. By then the form is already closed, and reopening it takes a click
  // or a key that counts as activation, so a second Escape still means Settings.
  dialog.addEventListener("cancel", (event) => {
    if (regions.formSection.hidden) return;
    event.preventDefault();
    hideForm(regions);
  });

  document.body.append(dialog);
  dialog.showModal();

  void refresh(regions);
}

/** A change answered after the dialog closed missed the close's redraw, so it
 *  redraws on its own. */
function markChanged(regions: Regions): void {
  regions.changed = true;
  if (regions.closed) void redrawBeneath();
}

async function redrawBeneath(): Promise<void> {
  const redrawn = navigate(window.location.pathname + window.location.search);
  announceEntriesChanged();
  await redrawn;
  // Today's "Open Settings" is the opener the dialog hands focus back to, and
  // the redraw just replaced it, which drops focus to <body>.
  if (document.activeElement === null || document.activeElement === document.body) {
    document.getElementById("settings-cog")?.focus();
  }
}

function header(dialog: HTMLDialogElement): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "border-edge flex items-center gap-3 border-b px-5 py-3.5";

  const heading = document.createElement("h2");
  heading.id = HEADING_ID;
  heading.className = "text-xl font-bold tracking-[-0.015em]";
  heading.textContent = "Settings";

  // Chrome, not an action on data: a glyph, per the language's decision 12.
  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.className =
    "text-ink-muted hover:bg-hover hover:text-ink focus-visible:bg-hover focus-visible:text-ink " +
    "ml-auto flex size-[34px] shrink-0 cursor-pointer items-center justify-center rounded-sm";
  close.innerHTML = iconMarkup("close");
  close.addEventListener("click", () => {
    dialog.close();
  });

  bar.append(heading, close);

  return bar;
}

function section(heading: string): HTMLElement {
  const element = document.createElement("section");
  element.className = SECTION_CLASS;

  const title = document.createElement("h3");
  title.className = SECTION_HEADING_CLASS;
  title.textContent = heading;
  element.append(title);

  return element;
}

// regions is captured by every closure this dialog creates (button handlers,
// save()), so a read that resolves after the dialog closed writes into its own
// detached elements, never into a later dialog.
async function refresh(regions: Regions): Promise<void> {
  const thisRead = ++regions.latestListRead;
  let instances: Instance[];
  try {
    instances = await listInstances();
  } catch (error) {
    if (thisRead !== regions.latestListRead) return;
    regions.errorSlot.replaceChildren(alertFor("error", messageOf(error)));

    return;
  }

  if (thisRead !== regions.latestListRead) return;
  regions.errorSlot.replaceChildren();
  reconcileList(regions, instances);
}

function reconcileList(regions: Regions, instances: Instance[]): void {
  const slot = regions.listSlot;
  const notice = slot.querySelector("[data-empty-notice]");
  let list = slot.querySelector("ul");

  if (instances.length === 0) {
    list?.remove();
    if (!notice) {
      slot.append(emptyNotice());
    }

    return;
  }

  notice?.remove();
  if (!list) {
    list = newList();
    slot.append(list);
  }

  const existing = new Map<string, HTMLElement>();
  for (const row of list.querySelectorAll<HTMLElement>("li[data-instance-id]")) {
    const key = row.dataset["instanceId"];
    if (key !== undefined) {
      existing.set(key, row);
    }
  }

  // Appending a node that is already a child moves it, so this also enforces
  // the server's ordering without a separate pass.
  for (const [position, instance] of instances.entries()) {
    const key = String(instance.id);
    const row = existing.get(key);
    if (row) {
      existing.delete(key);
      patchRow(row, instance, position);
      list.append(row);
    } else {
      list.append(instanceRow(regions, instance, position));
    }
  }

  for (const stale of existing.values()) {
    stale.remove();
  }
}

function showForm(regions: Regions, editing: Instance | undefined, opener: HTMLElement): void {
  regions.formOpener = opener;
  regions.formSection.replaceChildren(instanceForm(regions, editing));
  regions.formSection.hidden = false;
  // Focusing scrolls the dialog to it, which is what the drawing's script does.
  regions.formSection.querySelector("input")?.focus();
}

function hideForm(regions: Regions): void {
  // Save disables its own focused button while in flight, which drops focus to
  // <body>: that focus was the form's too.
  const hadFocus =
    regions.formSection.contains(document.activeElement) ||
    document.activeElement === document.body;
  regions.formSection.replaceChildren();
  regions.formSection.hidden = true;
  if (hadFocus) {
    const opener = regions.formOpener;
    // A row's Edit is disabled while its save is in flight, and takes no focus.
    (opener.isConnected && !opener.matches(":disabled") ? opener : regions.addButton).focus();
  }
}

function addInstanceButton(onPress: () => void): HTMLButtonElement {
  const add = document.createElement("button");
  add.type = "button";
  // Its words are its name; the label repeats them, as toolbarButton's does.
  add.setAttribute("aria-label", "Add an instance");
  // 12px of padding matches the rows' own, so the two hover boxes share a left
  // edge inside the dialog's gutter (prototype lines 262–265).
  add.className =
    "text-primary hover:bg-hover mt-1.5 inline-flex cursor-pointer items-center gap-3 " +
    "rounded-sm px-3 py-2.5 text-base font-bold";
  add.innerHTML = iconMarkup("plus", 17);
  add.append("Add an instance");
  add.addEventListener("click", onPress);

  return add;
}

function newList(): HTMLUListElement {
  return document.createElement("ul");
}

function emptyNotice(): HTMLElement {
  const empty = document.createElement("p");
  empty.dataset["emptyNotice"] = "";
  empty.className = "text-sm text-ink-muted";
  empty.textContent = "No instances yet. Add one below.";

  return empty;
}

// Handlers close over this per-row state rather than the instance parameter
// instanceRow was called with, so a row reused by reconcileList reads the
// current instance on click instead of the one it happened to be built from.
// Keyed by the row element (not module-level) so it is collected with the row.
const rowState = new WeakMap<HTMLElement, { instance: Instance }>();

// A second Edit on an instance whose save has not answered would open on
// pre-save values and overwrite that save (#200).
const savingIds = new Set<number>();

// Queries the live document: a save outlives the dialog that started it, and
// its finally must reach the row a reopened dialog shows, not its own detached one.
function setRowEditDisabled(instanceId: number, disabled: boolean): void {
  document
    .querySelector(`li[data-instance-id="${String(instanceId)}"] [data-row-action="edit"]`)
    ?.toggleAttribute("disabled", disabled);
}

/**
 * What the last connection test said, per instance id, for the life of the
 * page: closing Settings keeps it, a reload forgets it, and nothing stores it —
 * a stored verdict is a claim about credentials that can be revoked outside
 * this app (#89).
 */
type Verdict = { ok: true; at: Date } | { ok: false; at: Date; message: string };
const verdicts = new Map<number, Verdict>();
// The test each instance is waiting on. Forgetting a verdict drops its entry, so
// an answer arriving after a save or a removal is discarded rather than written
// back — onto a changed token, or onto whichever instance is given the freed id.
const pendingTests = new Map<number, symbol>();

const HEALTH_CLASS = "inline-flex shrink-0 items-center gap-1.5 text-sm";

/** The prototype's `.iconbtn` in `ul.inst` (lines 141–161): the wash on hover
 *  and focus, and the primary on hover — the failed tone, for remove. */
const ROW_BUTTON_CLASS =
  "text-ink-muted hover:bg-hover focus-visible:bg-hover focus-visible:text-ink -mr-2 flex " +
  "size-[34px] shrink-0 cursor-pointer items-center justify-center rounded-sm " +
  "disabled:cursor-default disabled:opacity-60";

const ROW_ACTIONS = {
  test: { icon: "plug", verb: "Test", words: "test connection", hover: "hover:text-primary" },
  edit: { icon: "edit", verb: "Edit", words: "edit instance", hover: "hover:text-primary" },
  remove: { icon: "trash", verb: "Remove", words: "remove instance", hover: "hover:text-failed" },
} as const satisfies Record<string, { icon: IconName; verb: string; words: string; hover: string }>;

type RowAction = keyof typeof ROW_ACTIONS;

function instanceRow(regions: Regions, instance: Instance, position: number): HTMLElement {
  const row = document.createElement("li");
  row.className = "bg-surface mb-[7px] rounded-sm px-3 py-2.5";
  row.dataset["instanceId"] = String(instance.id);

  const state = { instance };
  rowState.set(row, state);

  const line = document.createElement("div");
  line.className = "flex items-center gap-3";

  // 8px is this row's own drawn size (prototype line 464). .that-dot's 7px is
  // unlayered CSS, which no utility can override; an inline style can.
  const dot = document.createElement("span");
  dot.dataset["rowDot"] = "";
  dot.style.width = "8px";
  dot.style.height = "8px";

  const identity = document.createElement("div");
  identity.className = "flex min-w-0 flex-1 flex-col gap-0.5";
  const name = document.createElement("span");
  name.dataset["rowName"] = "";
  name.className = "text-ink text-lg font-medium";
  const host = document.createElement("span");
  host.dataset["rowHost"] = "";
  host.className = "text-ink-muted font-mono text-sm";
  identity.append(name, host);

  const health = document.createElement("span");
  health.dataset["rowHealth"] = "";

  const actions = document.createElement("div");
  actions.className = "flex shrink-0 gap-1";
  const [test, testTip] = rowButton("test", instance.id);
  const [edit, editTip] = rowButton("edit", instance.id);
  const [remove, removeTip] = rowButton("remove", instance.id);
  actions.append(test, testTip, edit, editTip, remove, removeTip);

  line.append(dot, identity, health, actions);

  const status = document.createElement("div");
  status.className = "mt-2 empty:mt-0";
  status.dataset["rowStatus"] = "";
  row.append(line, status);

  test.addEventListener("click", () => {
    void runConnectionTest(state.instance, test, row);
  });
  edit.addEventListener("click", () => {
    showForm(regions, state.instance, edit);
  });
  remove.addEventListener("click", () => {
    void removeInstance(regions, state.instance, remove, status);
  });

  patchRow(row, instance, position);
  paintVerdict(row, instance.id);

  return row;
}

function rowButton(action: RowAction, instanceId: number): [HTMLButtonElement, HTMLElement] {
  const { icon, verb, words, hover } = ROW_ACTIONS[action];

  const button = document.createElement("button");
  button.type = "button";
  button.id = `that-instance-${action}-${String(instanceId)}`;
  button.dataset["rowAction"] = action;
  // patchRow names the instance, and renames it after an edit.
  button.setAttribute("aria-label", verb);
  button.className = `${ROW_BUTTON_CLASS} ${hover}`;
  button.innerHTML = iconMarkup(icon, 17);

  const tooltip = document.createElement("that-tooltip");
  tooltip.setAttribute("for", button.id);
  tooltip.setAttribute("anchor", "end");
  tooltip.textContent = words;

  return [button, tooltip];
}

function patchRow(row: HTMLElement, instance: Instance, position: number): void {
  const state = rowState.get(row);
  if (state) {
    state.instance = instance;
  }

  const dot = row.querySelector<HTMLElement>("[data-row-dot]");
  if (dot) {
    paintInstanceDot(dot, position, instance.name);
  }
  const name = row.querySelector<HTMLElement>("[data-row-name]");
  if (name) {
    name.textContent = instance.name;
  }
  const host = row.querySelector<HTMLElement>("[data-row-host]");
  if (host) {
    host.textContent = hostLine(instance);
  }
  for (const button of row.querySelectorAll<HTMLElement>("[data-row-action]")) {
    const action = button.dataset["rowAction"];
    if (action === "test" || action === "edit" || action === "remove") {
      button.setAttribute("aria-label", `${ROW_ACTIONS[action].verb} ${instance.name}`);
    }
    if (action === "edit") {
      button.toggleAttribute("disabled", savingIds.has(instance.id));
    }
  }

  // A migrated row that held a gateway URL: REST calls still work, but #5 has no
  // URL to link an issue to until the user supplies one. Re-evaluated on every
  // patch, since editing can add or remove the site URL without a page reload.
  const warning = row.querySelector<HTMLElement>("[data-site-url-warning]");
  if (instance.siteUrl === "") {
    if (!warning) {
      const alert = alertFor(
        "warning",
        "This instance has no site URL, so issue links are unavailable. Edit it to add one.",
      );
      alert.dataset["siteUrlWarning"] = "";
      row.append(alert);
    }
  } else {
    warning?.remove();
  }
}

/**
 * The drawing's two health states. A failed verdict is not drawn yet, so the
 * server's own message stays in the alert beneath the row, as it did before.
 */
function paintVerdict(row: HTMLElement, instanceId: number): void {
  const health = row.querySelector<HTMLElement>("[data-row-health]");
  const status = row.querySelector<HTMLElement>("[data-row-status]");
  if (!health || !status) return;

  const verdict = verdicts.get(instanceId);
  status.replaceChildren();
  if (!verdict) {
    health.className = `${HEALTH_CLASS} text-ink-muted`;
    health.textContent = "Not tested";
  } else if (verdict.ok) {
    health.className = `${HEALTH_CLASS} text-running`;
    // No aria-label: the check is decoration beside the words that name the state.
    health.innerHTML = iconMarkup("check", 15);
    health.append(`Connected · ${clockTime(verdict.at)}`);
  } else {
    health.className = HEALTH_CLASS;
    health.replaceChildren();
    status.append(alertFor("error", verdict.message));
  }
}

/** The drawing's `.ihost`. A migrated instance has no site URL and so no host;
 *  the warning beneath its row says why. */
function hostLine(instance: Instance): string {
  if (instance.siteUrl === "") return instance.email;

  let host: string;
  try {
    host = new URL(instance.siteUrl).host;
  } catch {
    host = instance.siteUrl;
  }

  return `${host} · ${instance.email}`;
}

// A saved token is never echoed back by the API, so a token-only edit is
// invisible to any comparison of the reconciled Instance — patchRow cannot see
// it. Forgetting here, scoped to the one instance just saved, reaches that case
// and never touches a sibling row's own test in flight.
function forgetVerdict(regions: Regions, instanceId: number): void {
  verdicts.delete(instanceId);
  pendingTests.delete(instanceId);
  const row = regions.listSlot.querySelector<HTMLElement>(`li[data-instance-id="${instanceId}"]`);
  if (row) {
    paintVerdict(row, instanceId);
  }
}

async function runConnectionTest(
  instance: Instance,
  trigger: HTMLButtonElement,
  row: HTMLElement,
): Promise<void> {
  const pending = Symbol();
  pendingTests.set(instance.id, pending);
  trigger.disabled = true;
  row
    .querySelector<HTMLElement>("[data-row-status]")
    ?.replaceChildren(alertFor("warning", "Testing…"));

  let verdict: Verdict;
  try {
    await testInstance(instance.id);
    verdict = { ok: true, at: new Date() };
  } catch (error) {
    verdict = { ok: false, at: new Date(), message: messageOf(error) };
  } finally {
    trigger.disabled = false;
  }

  if (pendingTests.get(instance.id) !== pending) return;
  pendingTests.delete(instance.id);
  verdicts.set(instance.id, verdict);
  // Settings may have been closed and reopened meanwhile, which built a new row.
  const live = document.querySelector<HTMLElement>(`li[data-instance-id="${instance.id}"]`);
  if (live) {
    paintVerdict(live, instance.id);
  }
}

async function removeInstance(
  regions: Regions,
  instance: Instance,
  trigger: HTMLButtonElement,
  status: HTMLElement,
): Promise<void> {
  const confirmed = await confirmDestructive({
    heading: `Remove ${instance.name}?`,
    body: "Its pinned issues and any time logged against it are deleted too. This cannot be undone.",
    confirmLabel: "Remove instance",
  });
  if (!confirmed) return;

  trigger.disabled = true;

  try {
    await deleteInstance(instance.id);
    markChanged(regions);
    // SQLite gives a freed id to the next instance created (no AUTOINCREMENT).
    forgetVerdict(regions, instance.id);
    await refresh(regions);

    // The list persists beside the form now, so Remove is reachable while that
    // same instance is being edited. Left alone, the form would still read
    // "Edit <name>" and PATCH an id SQLite is free to hand to whatever
    // instance is created next (no AUTOINCREMENT on instances.id).
    if (regions.formSection.querySelector(`[data-editing-id="${instance.id}"]`)) {
      hideForm(regions);
    }
    refocusAfterRemoval(regions);
  } catch (error) {
    status.replaceChildren(alertFor("error", messageOf(error)));
    trigger.disabled = false;
  }
}

/**
 * `refresh()` above just rebuilt the list, which for a Remove press deletes
 * the very row — and its own Remove button — the keyboard is still on. The
 * browser resolves a focused element vanishing by dropping focus to <body>,
 * which is reachable but announces nothing; this sends it on to the next
 * thing worth pressing instead — another instance's own first control, or
 * Add an instance once none is left. A no-op whenever focus is
 * anywhere else, so it never steals it from something the confirm dialog's
 * own close (or a later click) already put it on.
 */
function refocusAfterRemoval(regions: Regions): void {
  if (document.activeElement !== document.body) return;

  (regions.listSlot.querySelector<HTMLElement>("button") ?? regions.addButton).focus();
}

function instanceForm(regions: Regions, editing: Instance | undefined): HTMLElement {
  const holder = document.createElement("div");
  holder.dataset["instanceForm"] = "";
  if (editing) {
    holder.dataset["editingId"] = String(editing.id);
  }

  const heading = document.createElement("h3");
  heading.className = SECTION_HEADING_CLASS;
  heading.textContent = editing ? `Edit ${editing.name}` : "Add an instance";

  const form = document.createElement("form");
  form.noValidate = true;

  // align-items: end — every input sits at the bottom of its row, so a longer
  // helper lifts its own label rather than pushing its input out of line.
  const fields = document.createElement("div");
  fields.className = "grid grid-cols-2 items-end gap-3.5";

  const name = field({
    name: "name",
    label: "Name",
    type: "text",
    mono: false,
    value: editing?.name ?? "",
    placeholder: "Ridgeline",
  });
  const siteUrl = field({
    name: "siteUrl",
    label: "Site URL",
    type: "url",
    mono: true,
    value: editing?.siteUrl ?? "",
    placeholder: "https://…atlassian.net",
  });
  const email = field({
    name: "email",
    label: "Account email",
    type: "email",
    mono: false,
    value: editing?.email ?? "",
    placeholder: "you@example.com",
  });
  const token = field({
    name: "token",
    label: "API token",
    type: "password",
    mono: true,
    value: "",
    placeholder: "••••••••••••",
    help: editing
      ? "Leave blank to keep the stored one"
      : "Stored encrypted. It is never shown again.",
  });
  fields.append(name.wrapper, siteUrl.wrapper, email.wrapper, token.wrapper);

  const note = tokenNote();
  note.classList.add("mt-3");

  const status = document.createElement("div");
  status.className = "mt-3 empty:hidden";

  const submit = button(editing ? "Save changes" : "Add instance", "primary");
  const cancel = button("Cancel", "secondary");
  cancel.addEventListener("click", () => {
    hideForm(regions);
  });

  const actions = document.createElement("div");
  actions.className = "mt-4 flex gap-2";
  actions.append(submit, cancel);

  form.append(fields, note, status, actions);
  holder.append(heading, form);

  // that-button renders a real <button type="button">, so it does not submit the
  // form on its own; this click handler is the only path into save().
  submit.addEventListener("click", () => {
    void save();
  });

  async function save(): Promise<void> {
    submit.setAttribute("disabled", "");
    status.replaceChildren();

    const draft = {
      name: name.input.value,
      siteUrl: siteUrl.input.value,
      email: email.input.value,
      ...(token.input.value === "" ? {} : { token: token.input.value }),
    };

    if (editing) {
      savingIds.add(editing.id);
      setRowEditDisabled(editing.id, true);
    }

    try {
      await (editing ? updateInstance(editing.id, draft) : createInstance(draft));
      markChanged(regions);
      await refresh(regions);
    } catch (error) {
      if (regions.formSection.contains(holder)) {
        status.replaceChildren(alertFor("error", messageOf(error)));
        submit.removeAttribute("disabled");
      } else {
        const label = editing?.name ?? (draft.name || "the new instance");
        regions.errorSlot.replaceChildren(
          alertFor("error", `Could not save ${label}: ${messageOf(error)}`),
        );
      }

      return;
    } finally {
      if (editing) {
        savingIds.delete(editing.id);
        setRowEditDisabled(editing.id, false);
      }
    }

    if (editing) {
      forgetVerdict(regions, editing.id);
    }
    // After the finally: hideForm hands focus to the Edit that opened this form,
    // and a disabled button cannot take it. Reset only the form this save came
    // from; the user may have moved on while it was in flight (#161).
    if (regions.formSection.contains(holder)) {
      hideForm(regions);
    }
  }

  return holder;
}

const TOKEN_PAGE = "https://id.atlassian.com/manage-profile/security/api-tokens";

/**
 * The prototype's `.tnote`. Guidance rather than a check: the connection test
 * only reads, and Jira has no side-effect-free write to probe a token's write
 * scope with, so a token missing write:jira-work passes it and fails every
 * push (#80). The link carries the current truth if Atlassian renames things.
 */
function tokenNote(): HTMLElement {
  const note = document.createElement("div");
  note.dataset["tokenNote"] = "";
  note.className =
    "flex items-start gap-2.5 rounded-sm border border-edge px-3 py-2.5 " +
    "text-sm leading-[1.55] text-ink-muted";

  const mark = document.createElement("span");
  mark.className = "mt-px shrink-0";
  mark.innerHTML = iconMarkup("info", 18);

  // Neither mark takes an aria-label: both are decorative, the note's text
  // says everything, and the link's accessible name stays "Create a token".
  const link = document.createElement("a");
  link.href = TOKEN_PAGE;
  link.target = "_blank";
  // Without noopener the opened page gets a window.opener handle back here.
  link.rel = "noopener";
  link.className = "inline-flex items-center gap-[3px] font-bold text-primary";
  link.textContent = "Create a token";
  link.insertAdjacentHTML("beforeend", iconMarkup("external", 14));

  const text = document.createElement("span");
  text.append(
    "Use an unscoped API token, or a scoped one with ",
    scope("read:jira-user"),
    " ",
    scope("read:jira-work"),
    " ",
    scope("write:jira-work"),
    ". Without ",
    scope("write:jira-work"),
    " your issues still list, but pushes fail. ",
    link,
  );

  note.append(mark, text);

  return note;
}

function scope(name: string): HTMLElement {
  const chip = document.createElement("span");
  chip.className =
    "whitespace-nowrap rounded-sm bg-hover px-[5px] py-px font-mono text-xs text-ink";
  chip.textContent = name;

  return chip;
}

interface Field {
  wrapper: HTMLElement;
  input: HTMLInputElement;
}

interface FieldSpec {
  name: string;
  label: string;
  type: string;
  value: string;
  placeholder: string;
  /** The drawing sets URLs and secrets in mono, words in the sans (`.plain`). */
  mono: boolean;
  help?: string;
}

/** The prototype's `.fld` (lines 336–343): label, an optional muted helper, input. */
function field(spec: FieldSpec): Field {
  const id = `that-settings-${spec.name}`;

  const wrapper = document.createElement("div");
  wrapper.className = "flex min-w-0 flex-col gap-[5px]";

  const label = document.createElement("label");
  label.htmlFor = id;
  label.className = "text-ink-muted text-xs font-bold tracking-[0.06em] uppercase";
  label.textContent = spec.label;
  wrapper.append(label);

  const input = document.createElement("input");
  input.id = id;
  input.name = spec.name;
  input.type = spec.type;
  input.value = spec.value;
  input.placeholder = spec.placeholder;
  input.className =
    "bg-surface border-edge text-ink placeholder:text-ink-muted w-full rounded-sm border " +
    "px-3 py-[9px] text-lg placeholder:opacity-80 focus:border-primary focus:outline-none " +
    (spec.mono ? "font-mono" : "font-sans");

  if (spec.help) {
    const help = document.createElement("span");
    help.id = `${id}-help`;
    help.className = "text-ink-muted mb-px text-xs leading-[1.4] opacity-80";
    help.textContent = spec.help;
    input.setAttribute("aria-describedby", help.id);
    wrapper.append(help);
  }

  wrapper.append(input);

  return { wrapper, input };
}

function button(label: string, variant: string): HTMLElement {
  const element = document.createElement("that-button");
  element.setAttribute("label", label);
  element.setAttribute("variant", variant);

  return element;
}

const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  // "auto" is the System state: an absent data-theme follows prefers-color-scheme.
  { value: "auto", label: "System" },
];

/** The prototype's `.seg`, lit by aria-pressed (lines 267–270, and 50 for light). */
const SEGMENT_CLASS =
  "text-ink-muted hover:text-ink cursor-pointer rounded-xs px-[15px] py-[7px] text-base " +
  "aria-pressed:bg-raised aria-pressed:text-ink aria-pressed:font-bold " +
  "aria-pressed:shadow-[inset_0_0_0_1px_var(--color-edge-ring),0_1px_2px_light-dark(oklch(0_0_0/0.05),oklch(0_0_0/0.35))]";

function themeControl(): HTMLElement {
  const row = document.createElement("div");
  row.className = "flex items-center gap-3.5";

  const label = document.createElement("span");
  label.id = "that-settings-theme";
  label.className = "text-ink text-base";
  label.textContent = "Theme";

  const segment = document.createElement("div");
  segment.setAttribute("role", "group");
  segment.setAttribute("aria-labelledby", label.id);
  segment.className = "bg-surface ml-auto inline-flex gap-[3px] rounded-sm p-[3px]";

  const current = themePreference();
  for (const option of THEME_OPTIONS) {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.className = SEGMENT_CLASS;
    choice.textContent = option.label;
    choice.setAttribute("aria-pressed", String(option.value === current));
    choice.addEventListener("click", () => {
      setThemePreference(option.value);
      for (const other of segment.querySelectorAll("button")) {
        other.setAttribute("aria-pressed", String(other === choice));
      }
    });
    segment.append(choice);
  }

  row.append(label, segment);

  return row;
}
