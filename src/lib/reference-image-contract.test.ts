import assert from "node:assert/strict";
import test from "node:test";
import {
  getReferenceDerivativeKey,
  REFERENCE_GENERATOR_VERSION,
  REFERENCE_IMAGE_CACHE_CONTROL,
  REFERENCE_QUALITY,
  REFERENCE_SERIAL_PATTERN,
  REFERENCE_SOURCE_KEY_PATTERN,
  REFERENCE_VARIANTS,
} from "./reference-image-contract";

test("keeps the agreed reference image storage and transformation contract", () => {
  assert.equal(REFERENCE_GENERATOR_VERSION, "v1");
  assert.equal(REFERENCE_QUALITY, 82);
  assert.equal(REFERENCE_IMAGE_CACHE_CONTROL, "public, max-age=0, must-revalidate");
  assert.deepEqual(REFERENCE_VARIANTS, [
    { kind: "preview", width: 960, maxBytes: 250_000 },
    { kind: "zoom", width: 1920, maxBytes: 600_000 },
  ]);
  assert.equal(getReferenceDerivativeKey("0800", 960), "reference/0800-960.webp");
  assert.equal(getReferenceDerivativeKey("0800", 1920), "reference/0800-1920.webp");
  for (const serial of ["0800", "0001", "9999"]) {
    assert.equal(REFERENCE_SERIAL_PATTERN.test(serial), true);
    assert.equal(REFERENCE_SOURCE_KEY_PATTERN.exec(`${serial}.png`)?.[1], serial);
  }
  for (const serial of ["800", "10000", "Booth0001", "../0800"]) {
    assert.equal(REFERENCE_SERIAL_PATTERN.test(serial), false);
    assert.equal(REFERENCE_SOURCE_KEY_PATTERN.test(`${serial}.png`), false);
  }
});
