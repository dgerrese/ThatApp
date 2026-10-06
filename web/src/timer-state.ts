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
 * first, and the dialog sends the POST while it is still open, so a failure
 * stays in it (#208).
 */
import {
  ApiError,
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

// One start or stop at a time, dialog through POST: a second click while the
// dialog chunk loads or a POST is out would open a second dialog or send a
// start this tab cannot round (#209).
let inFlight = false;

async function oneAtATime(action: () => Promise<void>): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    await action();
  } finally {
    inFlight = false;
  }
}

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

/** Asks how to stop the running timer; a confirmed rounding runs `commit`
 *  while the dialog is open. Imported lazily: the dialog is only ever needed
 *  after a click. */
async function askHowToStop(
  nextIssueKey: string | undefined,
  commit: (choice: StopChoice) => Promise<void>,
): Promise<void> {
  const issueKey = running?.issueKey;
  if (issueKey === undefined) return;
  const { confirmStop } = await import("./components/that-stop-dialog");

  await confirmStop(issueKey, nextIssueKey, elapsedSeconds, commit);
}

/** Starting over a running timer stops it first, so it asks how, the same as
 *  a stop does; kept running, nothing starts. */
async function startTimerNow(instanceId: number, issueKey: string): Promise<void> {
  const start = async (choice?: StopChoice): Promise<void> => {
    const response = await postStartTimer(instanceId, issueKey, choice);
    setRunning(response.running);
    if (response.stopped) announceEntriesChanged();
  };

  if (running) {
    await askHowToStop(issueKey, start);

    return;
  }
  try {
    await start();
  } catch (error) {
    // A 400 to a start with no rounding means a timer this tab never saw is
    // running. Re-read it and ask, so the first click is not a silent no-op
    // (#207). The second call takes the branch above, so it retries at most once.
    if (!(error instanceof ApiError && error.status === 400)) throw error;
    await readTimer().catch(() => undefined);
    if (isRunningTicket(instanceId, issueKey)) return;
    if (!running) throw error;
    await startTimerNow(instanceId, issueKey);
  }
}

async function stopTimerNow(): Promise<void> {
  await askHowToStop(undefined, async (choice) => {
    const response = await postStopTimer(choice);
    setRunning(null);
    if (response.stopped) announceEntriesChanged();
  });
}

export function startTimer(instanceId: number, issueKey: string): Promise<void> {
  return oneAtATime(() => startTimerNow(instanceId, issueKey));
}

export function stopTimer(): Promise<void> {
  return oneAtATime(stopTimerNow);
}
