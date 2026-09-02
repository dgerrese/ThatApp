/**
 * A week's range, as the rail's period label reads it — `7–13 Sep`.
 *
 * Both bounds come from the server's own response, so this never decides which
 * week anything is in; it only renders one. It splits the ISO strings rather
 * than parsing them, because `new Date("2026-09-07")` is UTC midnight and every
 * getter reads it in the browser's zone — one timezone west and the label is off
 * by a day. Splitting has no zone to be wrong about.
 */
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

interface Parts {
  year: string;
  month: string;
  day: number;
}

function partsOf(iso: string): Parts {
  const [year = "", month = "", day = ""] = iso.split("-");

  return { year, month: MONTHS[Number(month) - 1] ?? month, day: Number(day) };
}

export function weekLabel(start: string, end: string): string {
  const from = partsOf(start);
  const to = partsOf(end);

  if (from.year !== to.year) {
    return `${String(from.day)} ${from.month} ${from.year} – ${String(to.day)} ${to.month} ${to.year}`;
  }
  if (from.month !== to.month) {
    return `${String(from.day)} ${from.month} – ${String(to.day)} ${to.month}`;
  }

  return `${String(from.day)}–${String(to.day)} ${from.month}`;
}
