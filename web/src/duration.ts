/**
 * Reading a typed duration, and writing one back into the field.
 *
 * This is deliberately DOM-free and lives outside `components/`, so the rule
 * can be tested without a browser — the component around it is a stepper and
 * three event listeners, but the arithmetic here is where a mistake reaches
 * Jira as the wrong number of hours.
 *
 * It is the inverse of `format.ts` and kept apart from it on purpose: that
 * module produces the two *display* shapes, a timer and a total, and neither is
 * ever parsed back. `H:MM` here is the editable shape, which is a third thing.
 */

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const STEP_MINUTES = 15;
const MAX_MINUTES = 24 * MINUTES_PER_HOUR;
const MAX_DIGITS = 4;

/**
 * Whole seconds for what the user typed, or `null` if it cannot be read as a
 * duration — no digits at all, more than four of them, or more than a day.
 * A refusal is a signal to restore the field, never to commit a guess.
 *
 * The last two digits are minutes and anything before them is hours, so `175`
 * is 1h75m and carries to 2h15m. The result lands on a quarter hour, except
 * that anything the user typed above zero keeps at least one step: rounding to
 * nearest would turn `7` into nothing, and a field that eats a keystroke reads
 * as broken rather than as strict.
 */
export function secondsFromTyped(typed: string): number | null {
  const digits = typed.replace(/\D/g, "");
  if (digits.length === 0 || digits.length > MAX_DIGITS) return null;

  const minutePart = digits.length <= 2 ? digits : digits.slice(-2);
  const hourPart = digits.length <= 2 ? "0" : digits.slice(0, -2);

  const typedMinutes = Number(hourPart) * MINUTES_PER_HOUR + Number(minutePart);
  if (typedMinutes > MAX_MINUTES) return null;

  const stepped = Math.round(typedMinutes / STEP_MINUTES) * STEP_MINUTES;
  const minutes = typedMinutes > 0 ? Math.max(stepped, STEP_MINUTES) : 0;

  return minutes * SECONDS_PER_MINUTE;
}

/**
 * What the field shows once a figure has been committed: `H:MM`, hours
 * unpadded and minutes always padded. Distinct from `totalFigure`'s `Nh Nm` on
 * purpose — this one is editable, and the colon is the mark of that.
 */
export function fieldFigure(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const totalMinutes = Math.floor(safe / SECONDS_PER_MINUTE);
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;

  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

/**
 * The figure one press of `−` or `+` reaches, in seconds. It moves to the next
 * quarter hour in that direction rather than adding a quarter to whatever it
 * was given, which is the same thing for a figure already on the grid and the
 * right thing for one that is not — #8's timer will hand this a run of 7m13s,
 * and stepping up from there means 0h 15m.
 *
 * Clamped to the same range the parse rule accepts, so neither end can leave
 * the control holding something the API would reject.
 */
export function steppedSeconds(seconds: number, direction: 1 | -1): number {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const steps = safe / (STEP_MINUTES * SECONDS_PER_MINUTE);
  const next = direction > 0 ? Math.floor(steps) + 1 : Math.ceil(steps) - 1;
  const minutes = Math.min(Math.max(next * STEP_MINUTES, 0), MAX_MINUTES);

  return minutes * SECONDS_PER_MINUTE;
}
