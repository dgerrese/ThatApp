interface View {
  render(root: HTMLElement): Promise<void>;
}

/**
 * Views load through dynamic import() so the entry bundle stays under the 14kB
 * initial-response budget. build.mjs must keep splitting on, or esbuild inlines
 * these and the deferral silently stops happening.
 */
const routes: Record<string, () => Promise<View>> = {
  "/settings": () => import("./views/settings"),
  "/today": () => import("./views/today"),
};

let mountPoint: HTMLElement | undefined;

export function startRouter(root: HTMLElement): void {
  mountPoint = root;

  window.addEventListener("popstate", () => {
    void renderCurrent();
  });

  // Intercept in-app links so navigation does not reload the shell.
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest("a[data-route]");
    if (!(link instanceof HTMLAnchorElement)) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }

    event.preventDefault();
    navigate(new URL(link.href).pathname);
  });

  void renderCurrent();
}

export function navigate(path: string): void {
  if (path !== window.location.pathname) {
    window.history.pushState({}, "", path);
  }
  void renderCurrent();
}

async function renderCurrent(): Promise<void> {
  const root = mountPoint;
  if (!root) return;

  const load = routes[window.location.pathname];
  if (!load) {
    renderPlaceholder(root);
    return;
  }

  const view = await load();
  root.replaceChildren();
  await view.render(root);
}

/**
 * Stands in for Today until #5 lands it. The server serves the app shell for any
 * unknown path, so this is what an unrouted URL reaches.
 */
function renderPlaceholder(root: HTMLElement): void {
  root.replaceChildren();

  const paragraph = document.createElement("p");
  paragraph.className = "text-ink-muted";
  paragraph.textContent = "Nothing here yet. Add a Jira instance to get started.";

  const link = document.createElement("a");
  link.href = "/settings";
  link.dataset["route"] = "";
  link.className = "mt-4 inline-block font-medium text-link underline";
  link.textContent = "Open Settings";

  root.append(paragraph, link);
}
