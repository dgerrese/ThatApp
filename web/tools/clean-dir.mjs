import { readdirSync, rmSync } from "node:fs";

// Empties dir except the names in keep. A missing dir is already clean.
export function cleanDir(dir, keep = []) {
  let names;
  try {
    names = readdirSync(dir);
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  for (const name of names) {
    if (!keep.includes(name)) rmSync(`${dir}/${name}`, { recursive: true, force: true });
  }
}
