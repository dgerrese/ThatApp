/**
 * The raised surface every card-shaped element sits on — `that-card` and the
 * table shell both listing views share (Week's grid, task 9, is the third).
 * One constant so the three cannot drift into disagreeing paddings, which is
 * exactly how they drifted the first time: the shipped 16px block padding
 * against the drawing's 14px (`.tcard`, docs/superpowers/prototypes/2026-09-03-app-prototype.html).
 */
export const CARD_SURFACE_CLASSES = "bg-raised shadow-card block rounded-md px-5 py-3.5";
