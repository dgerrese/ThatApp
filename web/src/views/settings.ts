import "../components/wd-alert";
import "../components/wd-button";
import "../components/wd-card";

import { ApiError, createInstance, deleteInstance, listInstances, testInstance, updateInstance } from "../api";
import type { Instance } from "../types";

export async function render(root: HTMLElement): Promise<void> {
  const container = document.createElement("div");
  container.className = "space-y-6";
  root.append(container);

  await refresh(container);
}

async function refresh(container: HTMLElement): Promise<void> {
  container.replaceChildren();

  let instances: Instance[];
  try {
    instances = await listInstances();
  } catch (error) {
    container.append(alertFor("error", messageOf(error)));
    return;
  }

  container.append(instanceList(container, instances), instanceForm(container, undefined));
}

function instanceList(container: HTMLElement, instances: Instance[]): HTMLElement {
  const card = document.createElement("wd-card");
  card.setAttribute("heading", "Jira instances");

  if (instances.length === 0) {
    const empty = document.createElement("p");
    empty.className = "text-sm text-neutral-600";
    empty.textContent = "No instances yet. Add one below.";
    card.append(empty);

    return card;
  }

  const list = document.createElement("ul");
  list.className = "divide-y divide-neutral-200";
  for (const instance of instances) {
    list.append(instanceRow(container, instance));
  }
  card.append(list);

  return card;
}

function instanceRow(container: HTMLElement, instance: Instance): HTMLElement {
  const row = document.createElement("li");
  row.className = "py-3";
  row.dataset["instanceId"] = String(instance.id);

  const heading = document.createElement("div");
  heading.className = "flex items-center justify-between gap-3";

  const labels = document.createElement("div");
  const name = document.createElement("p");
  name.className = "font-medium";
  name.textContent = instance.name;
  const detail = document.createElement("p");
  detail.className = "text-sm text-neutral-600";
  detail.textContent = `${instance.email} · ${instance.siteUrl || "no site URL"}`;
  labels.append(name, detail);

  const actions = document.createElement("div");
  actions.className = "flex gap-2";
  const test = button("Test", "secondary");
  const edit = button("Edit", "secondary");
  const remove = button("Remove", "danger");
  actions.append(test, edit, remove);

  heading.append(labels, actions);
  row.append(heading);

  const status = document.createElement("div");
  status.className = "mt-2 empty:mt-0";
  row.append(status);

  // A migrated row that held a gateway URL: REST calls still work, but #5 has no
  // URL to link an issue to until the user supplies one.
  if (instance.siteUrl === "") {
    row.append(
      alertFor(
        "warning",
        "This instance has no site URL, so issue links are unavailable. Edit it to add one.",
      ),
    );
  }

  test.addEventListener("click", () => {
    void runConnectionTest(instance, test, status);
  });
  edit.addEventListener("click", () => {
    container.replaceChildren(instanceForm(container, instance));
  });
  remove.addEventListener("click", () => {
    void removeInstance(container, instance, remove, status);
  });

  return row;
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
  container: HTMLElement,
  instance: Instance,
  trigger: HTMLElement,
  status: HTMLElement,
): Promise<void> {
  trigger.setAttribute("disabled", "");

  try {
    await deleteInstance(instance.id);
    await refresh(container);
  } catch (error) {
    status.replaceChildren(alertFor("error", messageOf(error)));
    trigger.removeAttribute("disabled");
  }
}

function instanceForm(container: HTMLElement, editing: Instance | undefined): HTMLElement {
  const card = document.createElement("wd-card");
  card.setAttribute("heading", editing ? `Edit ${editing.name}` : "Add an instance");

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

  form.append(name.wrapper, siteUrl.wrapper, email.wrapper, token.wrapper, status, submit);
  card.append(form);

  // wd-button renders a real <button type="button">, so it does not submit the
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

    try {
      if (editing) {
        await updateInstance(editing.id, draft);
      } else {
        await createInstance(draft);
      }
      await refresh(container);
    } catch (error) {
      status.replaceChildren(alertFor("error", messageOf(error)));
      submit.removeAttribute("disabled");
    }
  }

  return card;
}

interface Field {
  wrapper: HTMLElement;
  input: HTMLInputElement;
}

function field(name: string, label: string, type: string, value: string): Field {
  const wrapper = document.createElement("label");
  wrapper.className = "block";

  const caption = document.createElement("span");
  caption.className = "mb-1 block text-sm font-medium text-neutral-700";
  caption.textContent = label;

  const input = document.createElement("input");
  input.name = name;
  input.type = type;
  input.value = value;
  input.className =
    "w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm " +
    "focus:border-neutral-900 focus:outline-none";

  wrapper.append(caption, input);

  return { wrapper, input };
}

function button(label: string, variant: string): HTMLElement {
  const element = document.createElement("wd-button");
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
