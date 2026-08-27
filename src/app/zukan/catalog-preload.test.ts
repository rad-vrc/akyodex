import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CatalogPreload } from "./catalog-preload";

test("CatalogPreload emits an anonymous fetch preload for the exact catalog URL", () => {
  const markup = renderToStaticMarkup(
    createElement(CatalogPreload, { href: "/api/catalog/en" }),
  );

  assert.match(markup, /rel="preload"/);
  assert.match(markup, /href="\/api\/catalog\/en"/);
  assert.match(markup, /as="fetch"/);
  assert.match(markup, /crossorigin=""/);
  assert.match(markup, /type="application\/json"/);
  assert.match(markup, /rel="preconnect"/);
  assert.match(markup, /href="https:\/\/images\.akyodex\.com"/);
});
