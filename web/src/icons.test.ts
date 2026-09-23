import { test } from "node:test";
import assert from "node:assert/strict";
import { iconMarkup, ICON_NAMES, type IconName } from "./icons.ts";

test("every icon is on the 24 grid, in currentColor, and hidden from the reader", () => {
  for (const name of ICON_NAMES) {
    const svg = iconMarkup(name);
    assert.match(svg, /^<svg /, `${name} is an <svg>`);
    assert.match(svg, /viewBox="0 0 24 24"/, `${name} is on the 24 grid`);
    assert.match(svg, /stroke="currentColor"/, `${name} inherits its colour`);
    assert.match(svg, /stroke-width="1.9"/);
    assert.match(svg, /fill="none"/);
    assert.match(svg, /aria-hidden="true"/, `${name} is decorative: the label is the control's`);
    assert.match(svg, /<(path|circle|rect)/, `${name} draws something`);
  }
});

test("warning and failed do not share a shape", () => {
  const shape = (name: IconName) => iconMarkup(name).replace(/^<svg[^>]*>|<\/svg>$/g, "");
  assert.notEqual(
    shape("warning"),
    shape("failed"),
    "they were told apart by colour alone, which the language forbids",
  );
});

test("a size renders at that size and no other", () => {
  const svg = iconMarkup("close", 16);
  assert.match(svg, /width="16"/);
  assert.match(svg, /height="16"/);
  assert.equal(iconMarkup("close").includes('width="18"'), true, "18 is the default");
});

test("the marks the listing views need are drawn", () => {
  for (const name of ["pin", "pin-off", "sortable", "ascending", "descending"] as const) {
    assert.ok(ICON_NAMES.includes(name), `${name} is in the set`);
    assert.match(iconMarkup(name), /viewBox="0 0 24 24"/);
  }
});

test("pin and pin-off differ by more than a slash's absence", () => {
  assert.notEqual(iconMarkup("pin"), iconMarkup("pin-off"));
});

test("pin and pin-off are transcribed from the prototype's #p-pin and #p-pinoff", () => {
  // Pasted verbatim from docs/superpowers/prototypes/2026-09-03-app-prototype.html's <defs>.
  assert.match(
    iconMarkup("pin"),
    /<path d="M8\.6 3\.5h6\.8M10\.2 3\.5v5\.3l-2\.7 3\.2a1 1 0 0 0 \.77 1\.64h7\.46a1 1 0 0 0 \.77-1\.64L13\.8 8\.8V3\.5M12 13\.64V20\.5"\/>/,
  );
  assert.match(
    iconMarkup("pin-off"),
    /<path d="M8\.6 3\.5h6\.8M13\.8 3\.5v5\.3l2\.7 3\.2a1 1 0 0 1-\.77 1\.64h-3\.4M10\.2 5\.4v3\.4l-2\.7 3\.2a1 1 0 0 0 \.77 1\.64h3\.2M12 13\.64V20\.5M4\.2 4\.2 19\.8 19\.8"\/>/,
  );
});

test("ascending and descending are transcribed from the prototype's #p-desc and its mirror", () => {
  // Pasted verbatim from docs/superpowers/prototypes/2026-09-03-app-prototype.html's #p-desc and #p-asc.
  assert.match(iconMarkup("descending"), /<path d="M12 4\.5V19M6\.4 13\.4 12 19l5\.6-5\.6"\/>/);
  assert.match(iconMarkup("ascending"), /<path d="M12 19\.5V5M6\.4 10\.6 12 5l5\.6 5\.6"\/>/);
});

test("the three sort marks are three different shapes", () => {
  const shapes = new Set(
    ["sortable", "ascending", "descending"].map((n) => iconMarkup(n as IconName)),
  );
  assert.equal(shapes.size, 3, "a sort state told apart by colour alone is the defect this avoids");
});

test("the fetch glyph is not the refresh glyph", () => {
  const shape = (name: IconName) => iconMarkup(name).replace(/^<svg[^>]*>|<\/svg>$/g, "");
  assert.notEqual(
    shape("fetch"),
    shape("refresh"),
    "refresh means the view was re-read; fetch pulls time in and writes it",
  );
});
