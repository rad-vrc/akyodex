import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveCatalogLanguage,
  resolveClientCatalogUrl,
} from "./catalog-language";

test("resolveCatalogLanguage accepts middleware languages and rejects other values", () => {
  assert.equal(resolveCatalogLanguage("ja"), "ja");
  assert.equal(resolveCatalogLanguage("en"), "en");
  assert.equal(resolveCatalogLanguage("ko"), "ko");
  assert.equal(resolveCatalogLanguage("fr"), "ja");
  assert.equal(resolveCatalogLanguage(null), "ja");
});

test("resolveClientCatalogUrl follows a client language change", () => {
  assert.equal(
    resolveClientCatalogUrl("/api/catalog/ja", "ja", "ja"),
    "/api/catalog/ja",
  );
  assert.equal(
    resolveClientCatalogUrl("/api/catalog/ja", "ja", "en"),
    "/api/catalog/en",
  );
});
