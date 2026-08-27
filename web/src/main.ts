import { startRail } from "./rail";
import { startRouter } from "./router";

// Before the router, and independent of it: the rail is the shell's own
// instrument, and it must be reading the day whether or not a view renders.
startRail();

const root = document.querySelector<HTMLElement>("#view");
if (root) {
  startRouter(root);
}
