/**
 * Sizes the issue-key column to the widest key on the view.
 *
 * The key column is what makes every summary start at the same x. A fixed
 * width does that only while every key fits: one key wider than the column
 * pushes its own summary right and the list goes ragged. Real data reaches
 * that immediately — a ten-character key already overruns the 76px the design
 * drew for its seven-character examples. So the number is a floor rather than
 * the width, and this is what raises it.
 *
 * One measurement for the whole view, not one per card. A table sizes its own
 * columns from its own content, so two cards measured separately come out
 * different widths whenever their project keys differ in length — RIDGE-5301
 * against NW-806 put them 8px apart — and cards that are each tidy on their own
 * and out of step with each other is the defect the second edition's shared
 * spacing rule exists to prevent. Measuring every key on the view and setting
 * one property on the region holding them makes the cards agree.
 */

/** The design's column, kept as the minimum so ordinary keys look as drawn. */
const FLOOR_PX = 76;

function widestKey(scope: HTMLElement): number {
  let widest = 0;

  for (const key of scope.querySelectorAll<HTMLElement>(".that-key")) {
    // The text, not the box: the box already carries the floor, so measuring it
    // would only ever measure the floor back.
    const range = document.createRange();
    range.selectNodeContents(key);
    widest = Math.max(widest, range.getBoundingClientRect().width);
  }

  return widest;
}

/**
 * Call once with an element containing every key on the view, after it is in
 * the document — an element outside it has no layout to measure. The property
 * lands on that element, and `.that-tbl .c-key` in styles.css is what reads it.
 */
export function alignKeyColumn(scope: HTMLElement): void {
  const apply = (): void => {
    const widest = widestKey(scope);
    if (widest > 0) {
      scope.style.setProperty("--that-key-col", `${Math.ceil(Math.max(FLOOR_PX, widest))}px`);
    }
  };

  apply();

  // The first pass can land before the webfont does, and a key measured in the
  // fallback face is measured at the wrong width. Re-measuring when the font
  // arrives costs nothing when it is already there.
  void document.fonts?.ready.then(apply);
}
