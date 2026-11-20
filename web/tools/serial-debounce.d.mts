export declare function serialDebounce(
  run: () => Promise<void> | void,
  options?: { delayMs?: number; onError?: (err: unknown) => void },
): () => void;
