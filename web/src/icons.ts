/**
 * Every mark that carries meaning, drawn rather than typed. A typed character is
 * rendered by whichever font resolves it — coverage and metrics vary, and a face
 * lacking the codepoint draws something else or nothing at all. An icon that
 * changes shape with the font is not a component.
 *
 * Markup rather than elements: the unit suite runs without a DOM, and a string
 * is the shape that stays testable there. Callers insert it with innerHTML,
 * which is safe because nothing here is interpolated from data.
 *
 * Punctuation is not an icon: an em dash meaning "no value" and a middot between
 * two facts are typography and stay characters.
 */
export const ICON_NAMES = [
  "close",
  "minus",
  "plus",
  "arrow-left",
  "arrow-right",
  "success",
  "warning",
  "failed",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

const PATHS: Record<IconName, string> = {
  close: '<path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"/>',
  minus: '<path d="M6 12h12"/>',
  plus: '<path d="M12 6v12M6 12h12"/>',
  "arrow-left": '<path d="M19 12H5M10 7l-5 5 5 5"/>',
  "arrow-right": '<path d="M5 12h14M14 7l5 5-5 5"/>',
  success: '<circle cx="12" cy="12" r="8.5"/><path d="M8.2 12.4l2.6 2.6 5-5.4"/>',
  // A triangle for "not sent yet" and a circle for "sent and refused". The two
  // shared one glyph and differed by colour alone, which this language forbids.
  warning: '<path d="M12 4.6 21 19.4H3L12 4.6Z"/><path d="M12 10.2v3.6M12 16.6h.01"/>',
  failed: '<circle cx="12" cy="12" r="8.5"/><path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6"/>',
};

/**
 * `aria-hidden` is not an oversight: the mark is decorative and the control it
 * sits in carries the accessible name.
 */
export function iconMarkup(name: IconName, size = 18): string {
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="1.9" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`
  );
}
