import { startRouter } from "./router";

const root = document.querySelector<HTMLElement>("#view");
if (root) {
  startRouter(root);
}
