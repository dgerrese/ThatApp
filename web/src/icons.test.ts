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
    assert.match(svg, /<(path|circle)/, `${name} draws something`);
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
