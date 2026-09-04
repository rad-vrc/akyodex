import assert from "node:assert/strict";
import test from "node:test";

import {
  getInitialReferenceImageStage,
  getReferenceImageIdentity,
  getNextReferenceImageStage,
  getReferenceImageUrls,
  resolveReferenceImageUrl,
  type ReferenceImageStage,
} from "./reference-image";

test("builds fixed direct R2 preview, zoom, and original URLs", () => {
  assert.deepEqual(
    getReferenceImageUrls({
      cardUrl: "/api/avatar-image?id=0800&w=800",
      originalBaseUrl: "https://images.akyodex.com/",
      referenceBaseUrl: "https://images.akyodex.com/reference/",
      serial: "0800",
    }),
    {
      card: "/api/avatar-image?id=0800&w=800",
      original: "https://images.akyodex.com/0800.png",
      preview: "https://images.akyodex.com/reference/0800-960.webp",
      zoom: "https://images.akyodex.com/reference/0800-1920.webp",
    },
  );
});

test("non-four-digit serials never construct derivatives and preserve original-to-card fallback", () => {
  for (const serial of ["Booth0001", "800", "10000"]) {
    const urls = getReferenceImageUrls({
      cardUrl: "/card.webp",
      originalBaseUrl: "https://images.akyodex.com",
      referenceBaseUrl: "https://images.akyodex.com/reference",
      serial,
    });
    assert.equal(urls.preview, null);
    assert.equal(urls.zoom, null);
    assert.equal(urls.original, `https://images.akyodex.com/${serial}.png`);
    const stages: ReferenceImageStage[] = [getInitialReferenceImageStage(urls)];
    while (stages.at(-1) !== "unavailable") {
      stages.push(getNextReferenceImageStage(stages.at(-1)!));
    }
    assert.deepEqual(stages, ["original", "card", "unavailable"]);
  }
});

test("image identity includes fallback URLs and type, but not unrelated item properties", () => {
  const urls = getReferenceImageUrls({
    cardUrl: "/card-v1.webp",
    originalBaseUrl: "https://images.akyodex.com",
    referenceBaseUrl: "https://images.akyodex.com/reference",
    serial: "0800",
  });
  assert.equal(getInitialReferenceImageStage(urls), "preview");
  const item = { id: "0800", entryType: "avatar", serial: "0800", cardUrl: urls.card, urls, isFavorite: false };
  const identity = getReferenceImageIdentity(item);
  const favoriteUpdated = { ...item, isFavorite: true };
  assert.equal(getReferenceImageIdentity(favoriteUpdated), identity);
  for (const update of [
    { id: "0801" }, { serial: "0801" }, { entryType: "booth" },
    { cardUrl: "/card-v2.webp", urls: { ...urls, card: "/card-v2.webp" } },
    { urls: { ...urls, preview: "https://other.example/0800-960.webp" } },
    { urls: { ...urls, zoom: "https://other.example/0800-1920.webp" } },
    { urls: { ...urls, original: "https://other.example/0800.png" } },
  ]) assert.notEqual(getReferenceImageIdentity({ ...item, ...update }), identity);
  assert.notEqual(getReferenceImageIdentity({ ...item, entryType: "world", urls: null }), identity);
});

test("uses the exact failure order without skipping the generated zoom derivative", () => {
  const stages: ReferenceImageStage[] = ["preview"];
  while (stages.at(-1) !== "unavailable") {
    stages.push(getNextReferenceImageStage(stages.at(-1) ?? "preview"));
  }

  assert.deepEqual(stages, ["preview", "zoom", "original", "card", "unavailable"]);
});

test("resolves no URL for the terminal unavailable stage", () => {
  const urls = getReferenceImageUrls({
    cardUrl: "/card.webp",
    originalBaseUrl: "https://images.akyodex.com",
    referenceBaseUrl: "https://images.akyodex.com/reference",
    serial: "0800",
  });

  assert.equal(resolveReferenceImageUrl("preview", urls), urls.preview);
  assert.equal(resolveReferenceImageUrl("zoom", urls), urls.zoom);
  assert.equal(resolveReferenceImageUrl("original", urls), urls.original);
  assert.equal(resolveReferenceImageUrl("card", urls), urls.card);
  assert.equal(resolveReferenceImageUrl("unavailable", urls), null);
});
