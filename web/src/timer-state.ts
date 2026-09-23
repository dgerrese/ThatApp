/**
 * The one running timer, held here and nowhere else, read once at start-up
 * (the rail's job — see rail.ts) and again after every start or stop.
 *
 * `announceTimerChanged` carries no payload: every subscriber already reads
 * `currentTimer()`/`elapsedSeconds()` off this module, the same shape
 * `entries-changed.ts` and `push-reported.ts` use for an event that means
 * "something moved, go and look" rather than "here is what moved".
 *
 * The 1-second tick exists only while a timer runs, and it is the same
 * announcement a start or stop fires — a subscriber cannot tell a tick from a
 * state change, and does not need to: both mean "repaint from what this
 * module says now".
 *
 * A stop, or a start over a running timer, asks the stop dialog how to round
 * first; the dialog is the only way either reaches the server.
 */
import {
  getTimer,
  startTimer as postStartTimer,
  stopTimer as postStopTimer,
} from "./api";
import { announceEntriesChanged } from "./entries-changed";
import type { RunningTimer, StopChoice } from "./types";

const TIMER_CHANGED = "that-timer-changed";
const TICK_MS = 1000;

let running: RunningTimer | null = null;
let tickHandle: number | undefined;

export function currentTimer(): RunningTimer | null {
  return running;
}

/** Whether `instanceId`/`issueKey` name the ticket the running timer is
 *  against — the one comparison every row and the rail's own button need,
 *  kept in one place so it cannot drift between them. */
export function isRunningTicket(instanceId: number, issueKey: string): boolean {
  return running !== null && running.instanceId === instanceId && running.issueKey === issueKey;
}

/** Whole seconds since the running timer's start, or 0 with none running.
 *  `startedAt` is RFC 3339 with an explicit offset, so Date.parse resolves it
 *  to the same instant regardless of this browser's own zone. */
export function elapsedSeconds(): number {
  if (!running) return 0;

  return Math.max(0, Math.floor((Date.now() - Date.parse(running.startedAt)) / 1000));
}

/** The seconds the running timer adds to this ticket's figure: its elapsed
 *  time when it is this ticket's, 0 otherwise. */
export function elapsedFor(instanceId: number, issueKey: string): number {
  return isRunningTicket(instanceId, issueKey) ? elapsedSeconds() : 0;
}

function setRunning(next: RunningTimer | null): void {
  running = next;
  if (running && tickHandle === undefined) {
    tickHandle = window.setInterval(announceTimerChanged, TICK_MS);
  } else if (!running && tickHandle !== undefined) {
    window.clearInterval(tickHandle);
    tickHandle = undefined;
  }
  announceTimerChanged();
}

function announceTimerChanged(): void {
  document.dispatchEvent(new CustomEvent(TIMER_CHANGED));
}

/** Returns the function that stops listening. */
export function onTimerChanged(handle: () => void): () => void {
  document.addEventListener(TIMER_CHANGED, handle);

  return () => document.removeEventListener(TIMER_CHANGED, handle);
}

export async function readTimer(): Promise<void> {
  const response = await getTimer();
  setRunning(response.running);
  if (response.stopped) announceEntriesChanged();
}

/** The stop dialog's answer for the running timer, or null when it was kept
 *  running. Imported lazily: the dialog is only ever needed after a click. */
async function askHowToStop(nextIssueKey?: string): Promise<StopChoice | null> {
  const issueKey = running?.issueKey;
  if (issueKey === undefined) return null;
  const { confirmStop } = await import("./components/that-stop-dialog");

  return confirmStop(issueKey, nextIssueKey, elapsedSeconds);
}

/** Starting over a running timer stops it first, so it asks how, the same as
 *  a stop does; kept running, nothing starts. */
export async function startTimer(instanceId: number, issueKey: string): Promise<void> {
  let choice: StopChoice | undefined;
  if (running) {
    const answer = await askHowToStop(issueKey);
    if (!answer) return;
    choice = answer;
  }
  const response = await postStartTimer(instanceId, issueKey, choice);
  setRunning(response.running);
  if (response.stopped) announceEntriesChanged();
}

export async function stopTimer(): Promise<void> {
  const choice = await askHowToStop();
  if (!choice) return;
  const response = await postStopTimer(choice);
  setRunning(null);
  if (response.stopped) announceEntriesChanged();
}
