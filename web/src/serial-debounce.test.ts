import { test } from "node:test";
import assert from "node:assert/strict";
import { serialDebounce } from "../tools/serial-debounce.mjs";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const DELAY = 10;

// A run that stays open until the test calls release(), so overlap is observable.
function gatedRun() {
  const state = { started: 0, active: 0, maxActive: 0, gates: [] as Array<() => void> };
  const run = () => {
    state.started++;
    state.active++;
    state.maxActive = Math.max(state.maxActive, state.active);
    return new Promise<void>((resolve) => {
      state.gates.push(() => {
        state.active--;
        resolve();
      });
    });
  };
  return { state, run };
}

test("a burst of triggers inside the window collapses to one run", async () => {
  let runs = 0;
  const trigger = serialDebounce(() => void runs++, { delayMs: DELAY });

  trigger();
  trigger();
  trigger();
  await sleep(DELAY * 4);

  assert.equal(runs, 1);
});

test("runs never overlap", async () => {
  const { state, run } = gatedRun();
  const trigger = serialDebounce(run, { delayMs: DELAY });

  trigger();
  await sleep(DELAY * 3);
  trigger();
  await sleep(DELAY * 3);
  state.gates.shift()?.();
  await sleep(DELAY * 3);
  state.gates.shift()?.();
  await sleep(DELAY * 3);

  assert.equal(state.maxActive, 1);
  assert.equal(state.started, 2);
});

test("triggers during a run cause exactly one more run, after the first finishes", async () => {
  const { state, run } = gatedRun();
  const trigger = serialDebounce(run, { delayMs: DELAY });

  trigger();
  await sleep(DELAY * 3);
  trigger();
  await sleep(DELAY * 3);
  trigger();
  await sleep(DELAY * 3);
  assert.equal(state.started, 1);

  state.gates.shift()?.();
  await sleep(DELAY * 3);
  assert.equal(state.started, 2);

  state.gates.shift()?.();
  await sleep(DELAY * 3);
  assert.equal(state.started, 2);
});

test("a rejected run goes to onError and a later trigger still runs", async () => {
  const errors: string[] = [];
  let runs = 0;
  const trigger = serialDebounce(
    () => {
      runs++;
      if (runs === 1) return Promise.reject(new Error("boom"));
    },
    { delayMs: DELAY, onError: (err) => errors.push((err as Error).message) },
  );

  trigger();
  await sleep(DELAY * 4);
  trigger();
  await sleep(DELAY * 4);

  assert.deepEqual(errors, ["boom"]);
  assert.equal(runs, 2);
});
