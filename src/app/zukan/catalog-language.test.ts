import assert from "node:assert/strict";
import test from "node:test";

import { resolveCatalogLanguage } from "./catalog-language";

test("resolveCatalogLanguage accepts middleware languages and rejects other values", () => {
  assert.equal(resolveCatalogLanguage("ja"), "ja");
  assert.equal(resolveCatalogLanguage("en"), "en");
  assert.equal(resolveCatalogLanguage("ko"), "ko");
  assert.equal(resolveCatalogLanguage("fr"), "ja");
  assert.equal(resolveCatalogLanguage(null), "ja");
});
