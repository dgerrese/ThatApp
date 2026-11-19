import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

import { paintVersion } from "./rail-version.ts";
import type { VersionStatus } from "./types.ts";

const dom = new Window();
Object.assign(globalThis, { document: dom.document });

const RUNNING = "2026.47.1";
const UP_TO_DATE: VersionStatus = { version: RUNNING, latest: null, error: "" };
const UPDATE: VersionStatus = {
  version: RUNNING,
  latest: {
    version: "2026.49.1",
    url: "https://github.com/dgerrese/ThatApp/releases/tag/v2026.49.1",
  },
  error: "",
};
const FAILED: VersionStatus = { version: RUNNING, latest: null, error: "GitHub did not answer." };

function foot(): HTMLElement {
  return document.createElement("div");
}

function lines(el: HTMLElement): string[] {
  const box = el.querySelector("[data-version]");
  return [...(box?.children ?? [])].map((l) => l.textContent ?? "");
}

test("up to date shows only the version", () => {
  const el = foot();
  paintVersion(el, UP_TO_DATE);
  assert.deepEqual(lines(el), ["ThatApp 2026.47.1"]);
});

test("a newer release puts its line above the version, linking out", () => {
  const el = foot();
  paintVersion(el, UPDATE);
  assert.deepEqual(lines(el), ["2026.49.1 available (opens in a new tab)", "ThatApp 2026.47.1"]);
  const link = el.querySelector("a");
  assert.equal(link?.firstChild?.textContent, "2026.49.1 available");
  assert.equal(link?.querySelector(".sr-only")?.textContent, " (opens in a new tab)");
  assert.equal(link === null, false);
  assert.equal(link?.getAttribute("href"), UPDATE.latest?.url);
  assert.equal(link?.getAttribute("target"), "_blank");
  assert.equal(link?.getAttribute("rel"), "noopener");
});

test("a failed check says what failed, the label in its own element", () => {
  const el = foot();
  paintVersion(el, FAILED);
  assert.deepEqual(lines(el), ["Update check failed: GitHub did not answer.", "ThatApp 2026.47.1"]);
  assert.equal(el.querySelector("i")?.textContent, "Update check failed:");
});

test("a dev build reads ThatApp dev", () => {
  const el = foot();
  paintVersion(el, { version: "dev", latest: null, error: "" });
  assert.deepEqual(lines(el), ["ThatApp dev"]);
});

test("repainting from update to up to date removes the update line", () => {
  const el = foot();
  paintVersion(el, UPDATE);
  paintVersion(el, UP_TO_DATE);
  assert.deepEqual(lines(el), ["ThatApp 2026.47.1"]);
  assert.equal(el.querySelector("a") === null, true);
});

test("paint leaves a sibling block of the foot alone", () => {
  const el = foot();
  const other = document.createElement("p");
  other.textContent = "mine";
  el.append(other);
  paintVersion(el, UPDATE);
  paintVersion(el, UP_TO_DATE);
  assert.equal(el.querySelector("p")?.textContent, "mine");
});
