import assert from "node:assert/strict";
import test from "node:test";

import type { AkyoData } from "@/types/akyo";
import {
  CATALOG_CACHE_CONTROL,
  CATALOG_SCHEMA_VERSION,
  createCatalogHttpResponse,
  createCatalogPayload,
  extractSerializedCatalogPayload,
  getCatalogKVKey,
  serializeCatalogPayload,
  writeCatalogPayloadToKV,
} from "./catalog-payload";

function createAkyo(): AkyoData {
  const sourceUrl =
    "https://vrchat.com/home/avatar/avtr_471f82ba-0c0b-4fe5-9f9c-3c7d88ab1921";
  return {
    id: "0001",
    entryType: "avatar",
    displaySerial: "0001",
    appearance: "deprecated appearance",
    nickname: "オリジンAkyo",
    avatarName: "Akyo origin",
    category: "チョコミント類",
    comment: "すべてのはじまり",
    author: "ugai",
    attribute: "チョコミント類",
    notes: "すべてのはじまり",
    creator: "ugai",
    sourceUrl,
    avatarUrl: sourceUrl,
    boothUrl: "https://example.booth.pm/items/1",
  };
}

test("createCatalogPayload preserves canonical UI fields and removes duplicate aliases", async () => {
  const payload = await createCatalogPayload("ja", [createAkyo()]);

  assert.equal(payload.schemaVersion, CATALOG_SCHEMA_VERSION);
  assert.equal(payload.language, "ja");
  assert.equal(payload.count, 1);
  assert.match(payload.revision, /^[a-f0-9]{64}$/);
  assert.deepEqual(payload.data[0], {
    id: "0001",
    entryType: "avatar",
    displaySerial: "0001",
    nickname: "オリジンAkyo",
    avatarName: "Akyo origin",
    category: "チョコミント類",
    comment: "すべてのはじまり",
    author: "ugai",
    sourceUrl:
      "https://vrchat.com/home/avatar/avtr_471f82ba-0c0b-4fe5-9f9c-3c7d88ab1921",
    boothUrl: "https://example.booth.pm/items/1",
  });
  assert.equal("appearance" in payload.data[0], false);
  assert.equal("attribute" in payload.data[0], false);
  assert.equal("notes" in payload.data[0], false);
  assert.equal("creator" in payload.data[0], false);
  assert.equal("avatarUrl" in payload.data[0], false);
});

test("serializeCatalogPayload is deterministic for identical normalized data", async () => {
  const first = await serializeCatalogPayload("en", [createAkyo()]);
  const second = await serializeCatalogPayload("en", [createAkyo()]);

  assert.deepEqual(second, first);
  assert.equal(JSON.parse(first.text).revision, first.revision);
});

test("createCatalogHttpResponse returns ETag cache headers and supports 304", async () => {
  const serialized = await serializeCatalogPayload("ko", [createAkyo()]);
  const response = createCatalogHttpResponse(serialized);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), CATALOG_CACHE_CONTROL);
  assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("ETag"), `"${serialized.revision}"`);
  assert.equal(await response.text(), serialized.text);

  const notModified = createCatalogHttpResponse(serialized, `"${serialized.revision}"`);
  assert.equal(notModified.status, 304);
  assert.equal(await notModified.text(), "");
  assert.equal(notModified.headers.get("ETag"), `"${serialized.revision}"`);
});

test("writeCatalogPayloadToKV stores the completed JSON string under the language key", async () => {
  const writes: Array<{ key: string; value: string }> = [];
  const kv = {
    async put(key: string, value: string) {
      writes.push({ key, value });
    },
  };
  const serialized = await serializeCatalogPayload("ja", [createAkyo()]);

  await writeCatalogPayloadToKV(kv, "ja", serialized.text);

  assert.equal(getCatalogKVKey("ja"), "catalog:v1:ja");
  assert.deepEqual(writes, [
    { key: "catalog:v1:ja", value: serialized.text },
  ]);
});

test("extractSerializedCatalogPayload reads only serializer-owned catalog strings", async () => {
  const serialized = await serializeCatalogPayload("ja", [createAkyo()]);

  assert.deepEqual(extractSerializedCatalogPayload(serialized.text, "ja"), serialized);
  assert.equal(extractSerializedCatalogPayload(serialized.text, "en"), null);
  assert.equal(extractSerializedCatalogPayload('{"schemaVersion":1}', "ja"), null);
});
