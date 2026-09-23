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
  "add-to-week",
  "search",
  "play",
  "stop",
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
  pin: '<path d="M8.6 3.5h6.8M10.2 3.5v5.3l-2.7 3.2a1 1 0 0 0 .77 1.64h7.46a1 1 0 0 0 .77-1.64L13.8 8.8V3.5M12 13.64V20.5"/>',
  // The slash is the whole difference, so it is drawn corner to corner rather
  // than as a short stroke: at 18px a subtle one reads as a rendering artefact.
  "pin-off":
    '<path d="M8.6 3.5h6.8M13.8 3.5v5.3l2.7 3.2a1 1 0 0 1-.77 1.64h-3.4M10.2 5.4v3.4l-2.7 3.2a1 1 0 0 0 .77 1.64h3.2M12 13.64V20.5M4.2 4.2 19.8 19.8"/>',
  sortable: '<path d="M8 10.5 12 6.5l4 4M8 13.5l4 4 4-4"/>',
  // An arc rather than a closed ring, with the arrowhead standing in for the
  // missing quarter: a full circle reads as a spinner, which promises motion
  // this control does not make until it is pressed.
  refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 3.5V9h-5.5"/>',
  // A cloud with a downward arrow, drawn in the design session of 2026-09-08 and
  // reproduced here exactly. Deliberately not the refresh arrows: those mean the
  // view was read again, which is what they mean on Today, where nothing is
  // written. This one pulls time in and stores it.
  //
  // The arrow's geometry is the owner's, not a judgement to re-make. It was once
  // lengthened to exit the cloud on the argument that it read as a dent at 17px,
  // and reverted: on screen it read as a tail. If it looks wrong, show them a
  // render and ask — do not redraw it.
  fetch:
    '<path d="M7.4 19h9.9a3.6 3.6 0 0 0 .5-7.16 5.6 5.6 0 0 0-10.8-1.2A3.98 3.98 0 0 0 7.4 19Z"/>' +
    '<path d="M12 10.5v6"/><path d="M9.4 14 12 16.6l2.6-2.6"/>',
  // Transcribed from the prototype's #p-desc; ascending is its own mirror,
  // both settled in the design session of 2026-09-18.
  ascending: '<path d="M12 19.5V5M6.4 10.6 12 5l5.6 5.6"/>',
  descending: '<path d="M12 4.5V19M6.4 13.4 12 19l5.6-5.6"/>',
  // Both transcribed from the prototype's #p-edit and #p-trash. The nib is
  // drawn as a separate stroke from the barrel so the pencil still reads as one
  // at 17px, where a single closed outline collapses into a lozenge.
  edit: '<path d="M4.5 19.5h4l10-10a2.1 2.1 0 0 0-3-3l-10 10Z"/><path d="M14 6.5l3 3"/>',
  trash: '<path d="M4.5 6.5h15M9.5 6.5V4.2h5v2.3M6.5 6.5l1 13h9l1-13M10.5 10v6M13.5 10v6"/>',
  "add-to-week":
    '<path d="M4 5h16"/><path d="M4 10h16"/>' +
    '<path d="M20 14v1a2 2 0 0 1-2 2H8"/><path d="M11 14l-3 3 3 3"/>',
  // Transcribed from the prototype's #p-search, for that-issue-search's field.
  search: '<circle cx="11" cy="11" r="6.6"/><path d="M15.9 15.9 20.5 20.5"/>',
  // #8's row and rail controls. The design's own geometry
  // (2026-09-18-timer-design.md, Task 4 of the plan) — a rounded triangle and
  // a rounded square, not drawn here first.
  play: '<path d="M8 5.6v12.8a.6.6 0 0 0 .92.5l9.6-6.4a.6.6 0 0 0 0-1l-9.6-6.4A.6.6 0 0 0 8 5.6Z"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
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
