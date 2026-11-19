/**
 * A section or view's title and the controls beside it — the prototype's
 * `.pageh` (docs/superpowers/prototypes/2026-09-03-app-prototype.html, lines
 * 329, 331 and 353). Today's two sections and Week's own title all wear this
 * shape; before this it was two copies, one per view, which is exactly the
 * drift CB#117 exists to undo.
 *
 * Returns both the heading element, for a caller that repaints its own text
 * later (Week's does, on every read), and the box around it, for a caller
 * that appends trailing controls (every caller does).
 */
export function pageHeading(
  text: string,
  headingId?: string,
): { box: HTMLElement; heading: HTMLHeadingElement } {
  const box = document.createElement("div");
  // flex-wrap: Today's own heading never has enough content to need a second
  // line, but Week's carries a rule, two toolbar buttons and the arrow
  // controls beside the title — on a phone that row's unshrinkable content
  // is wider than the column, and without wrap the overflow reached <body>
  // and the page scrolled sideways, which no view may ever do.
  box.className = "mb-2.5 flex flex-wrap items-center gap-2";

  const heading = document.createElement("h2");
  if (headingId !== undefined) heading.id = headingId;
  heading.className = "text-lg font-medium";
  heading.textContent = text;
  box.append(heading);

  return { box, heading };
}
