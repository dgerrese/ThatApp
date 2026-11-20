// Debounces triggers by delayMs and runs `run` one at a time: triggers that
// land during a run collapse into exactly one more run after it settles.
export function serialDebounce(run, { delayMs = 50, onError = () => {} } = {}) {
  let timer;
  let running = false;
  let again = false;

  const start = async () => {
    running = true;
    try {
      await run();
    } catch (err) {
      onError(err);
    }
    running = false;
    if (again) {
      again = false;
      start();
    }
  };

  return () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (running) again = true;
      else start();
    }, delayMs);
  };
}
