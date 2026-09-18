export declare function reachableFiles(
  entry: string,
  read: (file: string) => string | undefined,
): { files: string[]; missing: Array<{ file: string; from: string }> };
