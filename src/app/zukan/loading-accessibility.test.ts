import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import { LoadingAnnouncement } from "./loading-announcement";
import { ZukanLoadingView } from "./loading";

test("zukan loading state announces progress through a live region", () => {
  const markup = renderToStaticMarkup(LoadingAnnouncement({ text: "Loading data..." }));

  assert.match(markup, /role="status"/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /Loading data/);
});

test("zukan route loading keeps only the logo and compact progress UI", () => {
  const markup = renderToStaticMarkup(
    createElement(ZukanLoadingView, { lang: "ja" }),
  );

  assert.match(markup, /logo-mobile\.webp/);
  assert.match(markup, /role="status"/);
  assert.doesNotMatch(markup, /animate-pulse/);
  assert.doesNotMatch(markup, /backdrop-blur/);
  assert.doesNotMatch(markup, /aspect-\[3\/2\]/);
});
