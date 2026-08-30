import assert from "node:assert/strict";
import test from "node:test";

import {
  createInitialDetailImageState,
  getNextDetailImageState,
} from "./reference-sheet-image-client";

const avatarArgs = {
  entryType: "avatar" as const,
  id: "Avatar0800",
  displaySerial: "0800",
  sourceUrl: "https://vrchat.com/home/avatar/avtr_example",
  r2BaseUrl: "https://images.akyodex.com",
};

test("avatar detail images start with the optimized reference sheet API", () => {
  assert.deepEqual(createInitialDetailImageState(avatarArgs), {
    stage: "reference-optimized",
    url: "/api/reference-image?id=0800",
  });
});

test("avatar detail images fall back through original PNG and card image", () => {
  const initial = createInitialDetailImageState(avatarArgs);
  const original = getNextDetailImageState(initial, avatarArgs);
  assert.deepEqual(original, {
    stage: "reference-original",
    url: "https://images.akyodex.com/0800.png",
  });

  const card = getNextDetailImageState(original, avatarArgs);
  assert.equal(card.stage, "card");
  assert.match(card.url ?? "", /^\/api\/avatar-image\?/);
  assert.match(card.url ?? "", /w=800/);

  assert.deepEqual(getNextDetailImageState(card, avatarArgs), {
    stage: "failed",
    url: null,
  });
});

test("world detail images keep the existing card image route", () => {
  const worldArgs = {
    entryType: "world" as const,
    id: "World0001",
    displaySerial: "0001",
    sourceUrl: "https://vrchat.com/home/world/wrld_example",
    r2BaseUrl: "https://images.akyodex.com",
  };

  const initial = createInitialDetailImageState(worldArgs);
  assert.equal(initial.stage, "card");
  assert.match(initial.url ?? "", /^\/api\/vrc-world-image\?/);
  assert.deepEqual(getNextDetailImageState(initial, worldArgs), {
    stage: "failed",
    url: null,
  });
});
