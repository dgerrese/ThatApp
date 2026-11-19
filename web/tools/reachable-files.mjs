// esbuild's minified ESM output names its siblings in exactly three shapes:
// `from"./x.js"`, `import"./x.js"` and `import("./x.js")`.
const SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*["']\.\/([\w.-]+\.js)["']/g;

/**
 * Every file `entry` reaches through relative imports, read through `read`
 * (undefined for a file that does not exist). Derived from what is actually on
 * disk, so it cannot disagree with the build that wrote it — the failure CB#67
 * was about.
 */
export function reachableFiles(entry, read) {
  const seen = new Set([entry]);
  const missing = [];
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.shift();
    const source = read(file);
    if (source === undefined) continue;

    for (const match of source.matchAll(SPECIFIER)) {
      const target = match[1];
      if (seen.has(target)) continue;
      seen.add(target);
      if (read(target) === undefined) {
        missing.push({ file: target, from: file });
        continue;
      }
      queue.push(target);
    }
  }

  const files = [...seen].filter((file) => !missing.some((gone) => gone.file === file)).sort();

  return { files, missing };
}
