import { getVersion } from "./api.ts";
import { iconMarkup } from "./icons.ts";
import type { VersionStatus } from "./types.ts";

const REFRESH_MS = 60 * 60 * 1000;

/**
 * Owns one child of the foot and rebuilds only that, so a block another ticket
 * puts beside it survives a repaint.
 */
export function paintVersion(foot: HTMLElement, status: VersionStatus): void {
  let box = foot.querySelector<HTMLElement>("[data-version]");
  if (box === null) {
    box = document.createElement("div");
    box.dataset.version = "";
    box.className = "flex flex-col gap-1.5 text-[12.5px] leading-[1.35]";
    foot.append(box);
  }
  const lines: HTMLElement[] = [];

  if (status.latest !== null) {
    const link = document.createElement("a");
    link.href = status.latest.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.className = "text-primary-rail inline-flex items-center gap-1.5 text-[13px] font-bold";
    link.append(`${status.latest.version} available`);
    const cue = document.createElement("span");
    cue.className = "sr-only";
    cue.textContent = " (opens in a new tab)";
    link.append(cue);
    link.insertAdjacentHTML("beforeend", iconMarkup("external", 13));
    lines.push(link);
  }

  if (status.error !== "") {
    const failed = document.createElement("span");
    failed.className = "text-rail-muted";
    const label = document.createElement("i");
    label.className = "text-failed-rail not-italic";
    label.textContent = "Update check failed:";
    failed.append(label, ` ${status.error}`);
    lines.push(failed);
  }

  const version = document.createElement("span");
  version.className = "text-rail-muted font-mono text-xs";
  version.textContent = `ThatApp ${status.version}`;
  lines.push(version);

  box.replaceChildren(...lines);
}

async function refresh(foot: HTMLElement): Promise<void> {
  try {
    paintVersion(foot, await getVersion());
  } catch {
    // A failed fetch leaves the foot as it was: nothing on first load, the last reading after.
  }
}

export function startRailVersion(): void {
  const foot = document.querySelector<HTMLElement>("#rail-version");
  if (foot === null) return;
  void refresh(foot);
  setInterval(() => void refresh(foot), REFRESH_MS);
}
