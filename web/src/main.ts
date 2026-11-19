import { startRail } from "./rail";
import { startRailVersion } from "./rail-version";
import { openSettings } from "./open-settings";
import { startRouter } from "./router";

// Before the router, and independent of it: the rail is the shell's own
// instrument, and it must be reading the day whether or not a view renders.
startRail();
startRailVersion();

// Every other reusable component is registered by whichever view imports it
// first. This one is reached for by tag name from anything that wants a
// tooltip — a ticket row, an icon button — and never by an import, so it is
// registered here instead, unconditionally, rather than left undefined until
// one of them tries. A dynamic import rather than a static one: splitting
// keeps it out of app.js, in its own chunk, which is what the rest of this
// shell's code-splitting already assumes.
void import("./components/that-tooltip");

// CB#123: the toast host sits in the markup from first render; its behaviour
// comes from its own chunk, like that-tooltip's.
void import("./components/that-toasts");

const root = document.querySelector<HTMLElement>("#view");
if (root) {
  startRouter(root);
}

document.querySelector("#settings-cog")?.addEventListener("click", () => {
  void openSettings();
});

// Guarded because a Firefox private window has no navigator.serviceWorker.
// Registered after load so it never competes with the app's own bundle for
// the network on first paint.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
