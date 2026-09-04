import "./that-button";

/**
 * Wraps a native <dialog> rather than building a modal from a div: showModal()
 * supplies the focus trap, the inert background, the top layer, Esc dismissal
 * and returning focus to whatever opened it. None of that is reimplemented.
 *
 * Backdrop-click dismissal is deliberately absent — <dialog> does not do it,
 * Esc already provides the safe exit, and adding it means hit-testing by hand.
 */
export class ThatConfirm extends HTMLElement {
  connectedCallback(): void {
    if (this.querySelector("dialog")) return;

    const dialog = document.createElement("dialog");
    // Preflight's `* { margin: 0 }` is author origin, which beats the UA's own
    // `dialog { margin: auto }` regardless of specificity — without this the
    // dialog resolves to the top-left corner in both Firefox and Chromium.
    dialog.className = "bg-raised text-ink shadow-card m-auto max-w-sm rounded-2xl p-5";

    const heading = document.createElement("h2");
    heading.id = "that-confirm-heading";
    heading.className = "mb-2 text-xl font-bold tracking-[-0.02em]";
    heading.textContent = this.getAttribute("heading") ?? "";

    const body = document.createElement("p");
    body.id = "that-confirm-body";
    body.className = "text-ink-muted mb-4 text-base";
    body.textContent = this.getAttribute("body") ?? "";

    const actions = document.createElement("div");
    actions.className = "flex justify-end gap-2";
    const cancel = dialogButton("Cancel", "secondary");
    const confirm = dialogButton(this.getAttribute("confirm-label") ?? "Confirm", "danger");
    actions.append(cancel, confirm);

    dialog.setAttribute("aria-labelledby", heading.id);
    dialog.setAttribute("aria-describedby", body.id);
    dialog.append(heading, body, actions);
    this.append(dialog);

    cancel.addEventListener("click", () => {
      dialog.close("cancel");
    });
    confirm.addEventListener("click", () => {
      dialog.close("confirm");
    });

    dialog.showModal();
  }
}

function dialogButton(label: string, variant: string): HTMLElement {
  const element = document.createElement("that-button");
  element.setAttribute("label", label);
  element.setAttribute("variant", variant);

  return element;
}

customElements.define("that-confirm", ThatConfirm);

/**
 * Resolves true only on the confirming button; Cancel, Esc and any other close
 * resolve false, so a mis-read never destroys anything.
 */
export function confirmDestructive(options: {
  heading: string;
  body: string;
  confirmLabel: string;
}): Promise<boolean> {
  const element = document.createElement("that-confirm");
  element.setAttribute("heading", options.heading);
  element.setAttribute("body", options.body);
  element.setAttribute("confirm-label", options.confirmLabel);
  document.body.append(element);

  const dialog = element.querySelector("dialog");
  if (!dialog) {
    element.remove();

    return Promise.resolve(false);
  }

  // <dialog>'s close event does not bubble, so this listens on the dialog itself.
  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => {
        const confirmed = dialog.returnValue === "confirm";
        element.remove();
        resolve(confirmed);
      },
      { once: true },
    );
  });
}
