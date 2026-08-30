import assert from "node:assert/strict";
import test from "node:test";

import {
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
