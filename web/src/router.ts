/** A view's own cleanup — e.g. an event listener it registered on `window`
 *  that must not outlive it. */
export type Teardown = () => void;

/**
 * What a view calls, any time during its own `render` — synchronously or
 * after its own async work — to hand the router its cleanup. Registration-
 * based rather than a value `render` returns: a returned teardown is only
 * known once the whole `render` (fan-out included) resolves, which leaves a
 * window, while it is still the view on screen, where the router cannot
 * unwire it yet. Calling this as soon as the thing needing cleanup exists
 * closes that window instead of merely narrowing it.
 *
 * Call it once per resource. Registrations compose rather than replace: a view
 * that hands over a timer and then a listener gets both unwired, in the order
 * it registered them.
 */
export type RegisterTeardown = (teardown: Teardown) => void;

interface View {
  render(root: HTMLElement, registerTeardown: RegisterTeardown): Promise<void>;
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

/**
 * "/" is not a view of its own. The rewrite uses replaceState rather than
 * pushState: a pushed redirect leaves "/" in the history stack, so Back lands on
 * it and is redirected forward again, trapping the user on Today.
 */
const redirects: Record<string, string> = { "/": "/today" };

let mountPoint: HTMLElement | undefined;
// Every cleanup the mounted view registered, composed into one — called right
// before the next view replaces it, so a listener a torn-down view left on
// `window` never fires again.
let teardownCurrentView: Teardown | undefined;
// Bumped once per renderCurrent() call, so a registerTeardown closure can
// tell whether the navigation it belongs to is still the one on screen — see
// registerTeardown below.
let navigationId = 0;

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

  const target = redirects[window.location.pathname];
  if (target) {
    window.history.replaceState({}, "", target);
  }

  markActiveRoute();

  teardownCurrentView?.();
  teardownCurrentView = undefined;

  const thisNavigation = ++navigationId;
  // A registration arriving after a later navigation has already started
  // (the view awaited something and lost a race with the next click) must
  // tear itself down immediately rather than overwrite the view now on
  // screen — the bug a return-based hook had, since nothing could run
  // between "render resolved" and "the value gets stored".
  const registerTeardown: RegisterTeardown = (teardown) => {
    if (thisNavigation !== navigationId) {
      teardown();
      return;
    }
    const previous = teardownCurrentView;
    teardownCurrentView = () => {
      previous?.();
      teardown();
    };
  };

  const load = routes[window.location.pathname];
  if (!load) {
    renderPlaceholder(root);
    return;
  }

  const view = await load();
  root.replaceChildren();
  await view.render(root, registerTeardown);
}

/**
 * The rail shows where you are by weight and fill, and aria-current is what
 * both the styling and a screen reader read it from. Set here rather than in
 * the shell because only the router knows which path won.
 */
function markActiveRoute(): void {
  for (const link of document.querySelectorAll("a[data-route]")) {
    if (!(link instanceof HTMLAnchorElement)) continue;

    if (new URL(link.href).pathname === window.location.pathname) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  }
}

/**
 * The fallback for a path with no view. "/" now leads to Today, so reaching this
 * means a genuinely unknown URL rather than the app's front door.
 */
function renderPlaceholder(root: HTMLElement): void {
  root.replaceChildren();

  const paragraph = document.createElement("p");
  paragraph.className = "text-ink-muted";
  paragraph.textContent = "There is nothing at this address.";

  const link = document.createElement("a");
  link.href = "/today";
  link.dataset["route"] = "";
  link.className = "text-primary mt-4 inline-block font-bold hover:underline";
  link.textContent = "Go to Today";

  root.append(paragraph, link);
}
