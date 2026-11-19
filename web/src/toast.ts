import type { ThatToasts } from "./components/that-toasts";

export type Tone = "success" | "warning" | "error";

/**
 * Shows a toast (CB#123). The host is in index.html from first render and is
 * upgraded from its own chunk; this waits for that before adding.
 */
export function toast(tone: Tone, message: string, items: string[] = []): void {
  void customElements.whenDefined("that-toasts").then(() => {
    document.querySelector<ThatToasts>("that-toasts")?.add(tone, message, items);
  });
}
