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
  "pin",
  "pin-off",
  "sortable",
  "ascending",
  "descending",
  "refresh",
  "fetch",
  "edit",
  "trash",
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
  pin: '<path d="M10 3.5h4M12 3.5v5.5M7.5 9h9l1.2 5.2H6.3L7.5 9ZM12 14.2v6.3"/>',
  // The slash is the whole difference, so it is drawn corner to corner rather
  // than as a short stroke: at 18px a subtle one reads as a rendering artefact.
  "pin-off": '<path d="M10 3.5h4M12 3.5v5.5M7.5 9h9l1.2 5.2H6.3L7.5 9ZM12 14.2v6.3"/><path d="M4 4l16 16"/>',
  sortable: '<path d="M8 10.5 12 6.5l4 4M8 13.5l4 4 4-4"/>',
  // An arc rather than a closed ring, with the arrowhead standing in for the
  // missing quarter: a full circle reads as a spinner, which promises motion
  // this control does not make until it is pressed.
  refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 3.5V9h-5.5"/>',
  // A cloud with an arrow coming down out of it. Deliberately not the refresh
  // arrows: those mean the view was read again, which is what they mean on
  // Today, where nothing is written. This one pulls time in and stores it.
  fetch:
    '<path d="M7.4 19h9.9a3.6 3.6 0 0 0 .5-7.16 5.6 5.6 0 0 0-10.8-1.2A3.98 3.98 0 0 0 7.4 19Z"/>' +
    '<path d="M12 9.5v11"/><path d="M8.5 17 12 20.5l3.5-3.5"/>',
  ascending: '<path d="M12 19V6M7.5 10.5 12 6l4.5 4.5"/>',
  descending: '<path d="M12 5v13M7.5 13.5 12 18l4.5-4.5"/>',
  // Both transcribed from the prototype's #p-edit and #p-trash. The nib is
  // drawn as a separate stroke from the barrel so the pencil still reads as one
  // at 17px, where a single closed outline collapses into a lozenge.
  edit: '<path d="M4.5 19.5h4l10-10a2.1 2.1 0 0 0-3-3l-10 10Z"/><path d="M14 6.5l3 3"/>',
  trash: '<path d="M4.5 6.5h15M9.5 6.5V4.2h5v2.3M6.5 6.5l1 13h9l1-13M10.5 10v6M13.5 10v6"/>',
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
