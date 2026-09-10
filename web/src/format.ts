/**
 * The two duration shapes, and the only place either is produced.
 *
 * Format carries meaning here. A timer is something you can start and stop; a
 * total is a sum you cannot. The reader learns the shape, and the shape is what
 * tells them whether a control exists — so a colon somewhere you cannot press
 * play is a bug, not a formatting preference.
 *
 * Both take whole seconds. Negative input is treated as zero: a duration that
 * ran backwards is a bug upstream, and rendering "-1h 00m" would put it on
 * screen instead of failing where it happened.
 */

const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;

function wholeMinutes(seconds: number): { hours: number; minutes: number } {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;

  return {
    hours: Math.floor(safe / SECONDS_PER_HOUR),
    minutes: Math.floor((safe % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE),
  };
}

/**
 * One ticket's accumulator, as `HH:MM` — `02:30`. Hours are zero-padded to two
 * digits and keep growing past 99 rather than wrapping, because a timer left
 * running overnight should look wrong rather than look plausible.
 */
export function timerFigure(seconds: number): string {
  const { hours, minutes } = wholeMinutes(seconds);

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * A sum you cannot start or stop, as `Nh Nm` — `5h 15m`, `0h 00m`. Hours are
 * not padded; minutes always are, so a column of totals still aligns.
 */
export function totalFigure(seconds: number): string {
  const { hours, minutes } = wholeMinutes(seconds);

  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

/**
 * A moment on the clock, local to the browser, as `HH:MM` — `14:32`. For
 * "showing what was here at", not for a duration, so it takes a `Date`
 * rather than seconds and carries no negative-time guard.
 *
 * Browser-local is deliberate here and only here: this names a moment the
 * viewer just lived through, so their own clock is the right one. Nothing that
 * decides which *day* an entry belongs to may follow it — that is resolved
 * against THAT_TIMEZONE on the server, which must agree with the end-of-day push
 * and the weekly rollup even when no browser is open.
 */
export function clockTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/**
 * Days since the Unix epoch for a proleptic-Gregorian y/m/d — Howard Hinnant's
 * days_from_civil. Chosen over a running calendar table because it is a closed
 * form: no month-length table to keep in step with the leap-year rule, and no
 * branch for the century exceptions.
 */
function daysFromCivil(year: number, month: number, day: number): number {
  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor((shiftedYear >= 0 ? shiftedYear : shiftedYear - 399) / 400);
  const yearOfEra = shiftedYear - era * 400;
  const monthOfYear = (month + 9) % 12; // March = 0, ..., February = 11
  const dayOfYear = Math.floor((153 * monthOfYear + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;

  return era * 146097 + dayOfEra - 719468;
}

/**
 * `"2026-09-08"` becomes `"Tuesday 8 September"` — the weekday and month
 * spelled out in full, the day number unpadded.
 *
 * Never via `Date`: parsing the string into one and reading a getter back
 * would apply whatever zone the browser happens to be in, which is the one
 * thing this whole ticket exists to prevent. The weekday instead comes from
 * days-from-civil arithmetic on the parsed parts, so the function touches no
 * clock at all — it takes a string and returns a string.
 */
export function longDay(day: string): string {
  const [yearPart = "", monthPart = "", dayPart = ""] = day.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  const date = Number(dayPart);

  const epochDay = daysFromCivil(year, month, date);
  // Epoch day 0 (1970-01-01) was a Thursday, index 4 in WEEKDAYS below.
  const weekdayIndex = (((epochDay % 7) + 7) % 7 + 4) % 7;

  return `${WEEKDAYS[weekdayIndex] ?? ""} ${String(date)} ${MONTHS[month - 1] ?? ""}`;
}
