/**
 * Sizes a list's issue-key column to the widest key it actually contains.
 *
 * The key column is what makes every summary in a card start at the same x. A
 * fixed width does that only while every key fits: one key wider than the
 * column pushes its own summary right and the list goes ragged. Real data
 * reaches that immediately — a ten-character key already overruns the 76px the
 * design drew for its seven-character examples.
 *
 * So the number is a floor rather than the width. Each list measures its own
 * keys and shares one column, which is what keeps alignment a property of the
 * list rather than a bet on how long a project key happens to be.
 */

/** The design's column, kept as the minimum so ordinary keys look as drawn. */
const FLOOR_PX = 76;

function widestKey(list: HTMLElement): number {
  let widest = 0;

  for (const key of list.querySelectorAll<HTMLElement>(".that-key")) {
    // The text, not the box: the box already carries the floor, so measuring it
    // would only ever measure the floor back.
    const range = document.createRange();
    range.selectNodeContents(key);
    widest = Math.max(widest, range.getBoundingClientRect().width);
  }

  return widest;
}

/**
 * Call once per list, after it is in the document — an element outside it has
 * no layout to measure.
 */
export function alignKeyColumn(list: HTMLElement): void {
  const apply = (): void => {
    const widest = widestKey(list);
    if (widest > 0) {
      list.style.setProperty("--that-key-col", `${Math.ceil(Math.max(FLOOR_PX, widest))}px`);
    }
  };

  apply();

  // The first pass can land before the webfont does, and a key measured in the
  // fallback face is measured at the wrong width. Re-measuring when the font
  // arrives costs nothing when it is already there.
  void document.fonts?.ready.then(apply);
}
