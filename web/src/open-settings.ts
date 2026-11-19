/**
 * Settings is a dialog over whatever view is mounted (CB#89). Its code loads on
 * first use, in a chunk of its own, so the initial response stays inside 14kB.
 */
export async function openSettings(): Promise<void> {
  const { showSettings } = await import("./settings-dialog");
  showSettings();
}
