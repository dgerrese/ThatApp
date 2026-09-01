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
