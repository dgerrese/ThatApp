import { startRail } from "./rail";
import { startRouter } from "./router";

// Before the router, and independent of it: the rail is the shell's own
// instrument, and it must be reading the day whether or not a view renders.
startRail();

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
