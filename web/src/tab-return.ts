/**
 * Runs `handle` once each time the user comes back to the tab: visible again
 * after it was hidden, or focused again after the window lost focus (#253).
 * Something outside the tab — an MCP client, mostly — may have started a
 * timer or logged time meanwhile, and the server has no way to say so.
 *
 * `away` is the guard. A real return delivers visibilitychange and focus
 * together, and a tab that never left can still receive either; without it
 * the first would cost two reads and the second a read for nothing. Neither
 * listener captures, so focus moving between controls inside the page — which
 * does not bubble to window — never counts as a return.
 */
export function onTabReturn(handle: () => void): void {
  let away = false;
  const back = (): void => {
    if (!away) return;
    away = false;
    handle();
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") away = true;
    else back();
  });
  window.addEventListener("blur", () => {
    away = true;
  });
  window.addEventListener("focus", back);
}
