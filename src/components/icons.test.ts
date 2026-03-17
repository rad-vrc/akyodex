import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { IconGrid } from "./icons";

test("IconGrid renders a two-card filled stack", () => {
  const markup = renderToStaticMarkup(React.createElement(IconGrid));
  const rectCount = (markup.match(/<rect/g) || []).length;

  assert.equal(rectCount, 2);
  assert.match(markup, /viewBox="40 32 348 304"/);
  // Back card uses reduced opacity
  assert.match(markup, /opacity="0.35"/);
  // Front card is rotated
  assert.match(markup, /transform="rotate\(-13 176 184\)"/);
  // Cards are filled, not stroked
  assert.match(markup, /fill="currentColor"/);
  assert.doesNotMatch(markup, /stroke-width/);
});
