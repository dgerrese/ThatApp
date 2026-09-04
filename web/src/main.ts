import { startRail } from "./rail";
import { startRouter } from "./router";

// Before the router, and independent of it: the rail is the shell's own
// instrument, and it must be reading the day whether or not a view renders.
startRail();

// Every other reusable component is registered by whichever view imports it
// first. This one has no view consumer yet — Task 3 of #95 is the first —
// so it is registered here instead, unconditionally, rather than left
// undefined until something finally reaches for it. A dynamic import rather
// than a static one: splitting keeps it out of app.js, in its own chunk,
// which is what the rest of this shell's code-splitting already assumes.
void import("./components/that-tooltip");

const root = document.querySelector<HTMLElement>("#view");
if (root) {
  startRouter(root);
}

// Guarded because a Firefox private window has no navigator.serviceWorker.
// Registered after load so it never competes with the app's own bundle for
// the network on first paint.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
