import "../components/that-alert";
import "../components/that-button";
import "../components/that-card";
import "../components/that-confirm";

import { alertFor, messageOf } from "../alert";
import {
  createInstance,
  deleteInstance,
  listInstances,
  testInstance,
  updateInstance,
} from "../api";
import { confirmDestructive } from "../components/that-confirm";
import { iconMarkup } from "../icons";
import { setRailPeriod, TODAY_PERIOD } from "../rail";
import { setThemePreference, themePreference } from "../theme";
import type { Instance } from "../types";
import type { ThemePreference } from "../theme";

interface Regions {
  errorSlot: HTMLElement;
  listCard: HTMLElement;
  formCard: HTMLElement;
  // Numbers every list read this render starts, so refresh() can tell the
  // answer it is holding from one a later read has already superseded (#56).
  latestListRead: number;
}

export async function render(root: HTMLElement): Promise<void> {
  setRailPeriod(TODAY_PERIOD);

  const regions: Regions = {
    errorSlot: document.createElement("div"),
    listCard: document.createElement("div"),
    formCard: document.createElement("div"),
    latestListRead: 0,
  };
  regions.formCard.className = "mt-6";

  // that-card overwrites its own className on connect, so the spacing lives on a
  // wrapper. Appearance sits outside the regions refresh() touches.
  const appearance = document.createElement("div");
  appearance.className = "mt-6";
  appearance.append(appearanceCard());

  root.append(regions.errorSlot, regions.listCard, regions.formCard, appearance);

  showForm(regions, undefined);
  await refresh(regions);
}

// regions is captured by every closure this function and its callees create
// (button handlers, save()), so a render() superseded by a later navigation
// still writes into its own detached elements when it resolves late, never
// into whatever is now on screen.
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
  const card = regions.listCard.querySelector<HTMLElement>("that-card") ?? newListCard(regions);

  // Never replaceChildren() on the card itself: that-card injects its heading once,
  // in connectedCallback, so wiping its children deletes the heading with no way
  // to get it back.
  const notice = card.querySelector("[data-empty-notice]");
  let list = card.querySelector("ul");

  if (instances.length === 0) {
    list?.remove();
    if (!notice) {
      card.append(emptyNotice());
    }

    return;
  }

  notice?.remove();
  if (!list) {
    list = newList();
    card.append(list);
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
  for (const instance of instances) {
    const key = String(instance.id);
    const row = existing.get(key);
    if (row) {
      existing.delete(key);
      patchRow(row, instance);
      list.append(row);
    } else {
      list.append(instanceRow(regions, instance));
    }
  }

  for (const stale of existing.values()) {
    stale.remove();
  }
}

function showForm(regions: Regions, editing: Instance | undefined): void {
  regions.formCard.replaceChildren(instanceForm(regions, editing));
}

function newListCard(regions: Regions): HTMLElement {
  const card = document.createElement("that-card");
  card.setAttribute("heading", "Jira instances");
  regions.listCard.replaceChildren(card);

  return card;
}

function newList(): HTMLUListElement {
  const list = document.createElement("ul");
  list.className = "divide-y divide-edge";

  return list;
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

function setRowEditDisabled(regions: Regions, instanceId: number, disabled: boolean): void {
  const row = regions.listCard.querySelector<HTMLElement>(`li[data-instance-id="${instanceId}"]`);
  row?.querySelector("[data-row-edit]")?.toggleAttribute("disabled", disabled);
}

function instanceRow(regions: Regions, instance: Instance): HTMLElement {
  const row = document.createElement("li");
  row.className = "py-3";
  row.dataset["instanceId"] = String(instance.id);

  const state = { instance };
  rowState.set(row, state);

  const heading = document.createElement("div");
  heading.className = "flex items-center justify-between gap-3";

  const labels = document.createElement("div");
  const name = document.createElement("p");
  name.dataset["rowName"] = "";
  name.className = "font-medium";
  const detail = document.createElement("p");
  detail.dataset["rowDetail"] = "";
  detail.className = "text-sm text-ink-muted";
  labels.append(name, detail);

  const actions = document.createElement("div");
  actions.className = "flex gap-2";
  const test = button("Test", "secondary");
  const edit = button("Edit", "secondary");
  edit.dataset["rowEdit"] = "";
  const remove = button("Remove", "danger");
  actions.append(test, edit, remove);

  heading.append(labels, actions);
  row.append(heading);

  const status = document.createElement("div");
  status.className = "mt-2 empty:mt-0";
  status.dataset["rowStatus"] = "";
  row.append(status);

  test.addEventListener("click", () => {
    void runConnectionTest(state.instance, test, status);
  });
  edit.addEventListener("click", () => {
    showForm(regions, state.instance);
  });
  remove.addEventListener("click", () => {
    void removeInstance(regions, state.instance, remove, status);
  });

  patchRow(row, instance);

  return row;
}

function patchRow(row: HTMLElement, instance: Instance): void {
  const state = rowState.get(row);
  if (state) {
    state.instance = instance;
  }

  const name = row.querySelector<HTMLElement>("[data-row-name]");
  const detail = row.querySelector<HTMLElement>("[data-row-detail]");
  if (name) {
    name.textContent = instance.name;
  }
  if (detail) {
    detail.textContent = `${instance.email} · ${instance.siteUrl || "no site URL"}`;
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

  row.querySelector("[data-row-edit]")?.toggleAttribute("disabled", savingIds.has(instance.id));
}

// A saved token is never echoed back by the API (Instance carries no token
// field), so a token-only edit is invisible to any comparison of the
// reconciled Instance against its prior state — patchRow cannot detect it.
// Clearing here instead, scoped to the one row that was just saved, reaches
// that case too and — because it is scoped to that id — never touches a
// sibling row's own in-flight "Testing…" the way an unconditional clear in
// patchRow's per-row reconcile pass would.
function clearRowStatus(regions: Regions, instanceId: number): void {
  const row = regions.listCard.querySelector<HTMLElement>(`li[data-instance-id="${instanceId}"]`);
  row?.querySelector<HTMLElement>("[data-row-status]")?.replaceChildren();
}

async function runConnectionTest(
  instance: Instance,
  trigger: HTMLElement,
  status: HTMLElement,
): Promise<void> {
  trigger.setAttribute("disabled", "");
  status.replaceChildren(alertFor("warning", "Testing…"));

  try {
    const result = await testInstance(instance.id);
    status.replaceChildren(alertFor("success", `Connected as ${result.displayName}.`));
  } catch (error) {
    status.replaceChildren(alertFor("error", messageOf(error)));
  } finally {
    trigger.removeAttribute("disabled");
  }
}

async function removeInstance(
  regions: Regions,
  instance: Instance,
  trigger: HTMLElement,
  status: HTMLElement,
): Promise<void> {
  const confirmed = await confirmDestructive({
    heading: `Remove ${instance.name}?`,
    body: "Its pinned issues and any time logged against it are deleted too. This cannot be undone.",
    confirmLabel: "Remove instance",
  });
  if (!confirmed) return;

  trigger.setAttribute("disabled", "");

  try {
    await deleteInstance(instance.id);
    await refresh(regions);

    // The list persists beside the form now, so Remove is reachable while that
    // same instance is being edited. Left alone, the form would still read
    // "Edit <name>" and PATCH an id SQLite is free to hand to whatever
    // instance is created next (no AUTOINCREMENT on instances.id).
    if (regions.formCard.querySelector(`[data-editing-id="${instance.id}"]`)) {
      showForm(regions, undefined);
    }
  } catch (error) {
    status.replaceChildren(alertFor("error", messageOf(error)));
    trigger.removeAttribute("disabled");
  }
}

function instanceForm(regions: Regions, editing: Instance | undefined): HTMLElement {
  const card = document.createElement("that-card");
  card.setAttribute("heading", editing ? `Edit ${editing.name}` : "Add an instance");
  if (editing) {
    card.dataset["editingId"] = String(editing.id);
  }

  const form = document.createElement("form");
  form.className = "space-y-3";
  form.noValidate = true;

  const name = field("name", "Name", "text", editing?.name ?? "");
  const siteUrl = field("siteUrl", "Site URL", "url", editing?.siteUrl ?? "");
  const email = field("email", "Account email", "email", editing?.email ?? "");
  const token = field(
    "token",
    editing ? "API token (leave blank to keep the stored one)" : "API token",
    "password",
    "",
  );

  const status = document.createElement("div");
  const submit = button(editing ? "Save changes" : "Add instance", "primary");

  const actions = document.createElement("div");
  actions.className = "flex gap-2";
  actions.append(submit);

  if (editing) {
    const cancel = button("Cancel changes", "secondary");
    cancel.addEventListener("click", () => {
      showForm(regions, undefined);
    });
    actions.append(cancel);
  }

  form.append(
    name.wrapper,
    siteUrl.wrapper,
    email.wrapper,
    token.wrapper,
    tokenNote(),
    status,
    actions,
  );
  card.append(form);

  // that-button renders a real <button type="button">, so it does not submit the
  // form on its own; this click handler is the only path into save().
  submit.addEventListener("click", () => {
    void save();
  });

  async function save(): Promise<void> {
    submit.setAttribute("disabled", "");
    status.replaceChildren();

    if (editing) {
      savingIds.add(editing.id);
      setRowEditDisabled(regions, editing.id, true);
    }

    const draft = {
      name: name.input.value,
      siteUrl: siteUrl.input.value,
      email: email.input.value,
      ...(token.input.value === "" ? {} : { token: token.input.value }),
    };

    try {
      await (editing ? updateInstance(editing.id, draft) : createInstance(draft));
      await refresh(regions);
      if (editing) {
        clearRowStatus(regions, editing.id);
      }
      // The user may have moved on while this save was in flight (#161). An Edit
      // form they opened on this same instance was filled from pre-save values.
      if (regions.formCard.contains(card)) {
        showForm(regions, undefined);
      }
    } catch (error) {
      if (regions.formCard.contains(card)) {
        status.replaceChildren(alertFor("error", messageOf(error)));
        submit.removeAttribute("disabled");
      } else {
        const label = editing?.name ?? (draft.name || "the new instance");
        regions.errorSlot.replaceChildren(
          alertFor("error", `Could not save ${label}: ${messageOf(error)}`),
        );
      }
    } finally {
      if (editing) {
        savingIds.delete(editing.id);
        setRowEditDisabled(regions, editing.id, false);
      }
    }
  }

  return card;
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

function field(name: string, label: string, type: string, value: string): Field {
  const wrapper = document.createElement("label");
  wrapper.className = "block";

  const caption = document.createElement("span");
  caption.className = "mb-1 block text-sm font-medium text-ink";
  caption.textContent = label;

  const input = document.createElement("input");
  input.name = name;
  input.type = type;
  input.value = value;
  input.className =
    "w-full rounded-sm border border-edge px-3 py-1.5 text-sm " +
    "focus:border-ink focus:outline-none";

  wrapper.append(caption, input);

  return { wrapper, input };
}

function button(label: string, variant: string): HTMLElement {
  const element = document.createElement("that-button");
  element.setAttribute("label", label);
  element.setAttribute("variant", variant);

  return element;
}

const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "auto", label: "Auto" },
];

/**
 * Plain markup rather than a that-* component: this has exactly one call site,
 * and the settings form already builds its controls from local helpers. Native
 * radios also inherit color-scheme themeing without any extra work.
 */
function appearanceCard(): HTMLElement {
  const card = document.createElement("that-card");
  card.setAttribute("heading", "Appearance");

  const fieldset = document.createElement("fieldset");
  const legend = document.createElement("legend");
  legend.className = "mb-2 text-sm font-medium";
  legend.textContent = "Theme";
  fieldset.append(legend);

  const current = themePreference();
  for (const option of THEME_OPTIONS) {
    const wrapper = document.createElement("label");
    wrapper.className = "mr-4 inline-flex items-center gap-2 text-sm";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "theme";
    radio.value = option.value;
    radio.checked = option.value === current;
    radio.addEventListener("change", () => {
      setThemePreference(option.value);
    });

    const caption = document.createElement("span");
    caption.textContent = option.label;

    wrapper.append(radio, caption);
    fieldset.append(wrapper);
  }

  card.append(fieldset);

  return card;
}
