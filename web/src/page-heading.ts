/**
 * A section or view's title and the controls beside it — the prototype's
 * `.pageh` (docs/superpowers/prototypes/2026-09-03-app-prototype.html, lines
 * 318 and 340). Today's two sections and Week's own title all wear this
 * shape; before this it was two copies, one per view, which is exactly the
 * drift #117 exists to undo.
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
  box.className = "mb-2.5 flex items-center gap-2";

  const heading = document.createElement("h2");
  if (headingId !== undefined) heading.id = headingId;
  heading.className = "text-lg font-medium";
  heading.textContent = text;
  box.append(heading);

  return { box, heading };
}
