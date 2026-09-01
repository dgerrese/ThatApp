/**
 * The per-instance hue ramp. Identity, never state: a hue says which Jira a row
 * came from and never whether anything is wrong.
 *
 * Every hue sits at least 25 degrees from the four reserved by roles — primary
 * 330, running 150, not-pushed 85, failed 25 — and from its neighbours here, so
 * no instance can be mistaken for a state and no two instances for each other.
 * 265 and 175 lead because they are the two the approved design drew.
 */
const RAMP = [265, 175, 295, 205, 115, 235] as const;

/**
 * The hue for the instance at `position`, which is its index in `created_at`
 * order. Cycles rather than running out, so a seventh instance is still
 * identifiable — it just shares a hue with the first, which the instance name
 * beside it disambiguates.
 */
export function instanceHue(position: number): number {
  const index = ((position % RAMP.length) + RAMP.length) % RAMP.length;

  return RAMP[index] ?? RAMP[0];
}

/**
 * Marks `element` as carrying an instance's identity colour. The name is set as
 * the accessible label rather than left to the hue, so identity survives a
 * monochrome screen and a colour deficiency both.
 */
export function paintInstanceDot(element: HTMLElement, position: number, name: string): void {
  element.classList.add("that-dot");
  element.style.setProperty("--h", String(instanceHue(position)));
  element.title = name;
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", name);
}
