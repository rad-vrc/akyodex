import assert from "node:assert/strict";
import test from "node:test";

import { isGoogleWrsServiceWorkerRejection } from "./service-worker-errors";

test("identifies only Google WRS service worker rejections", () => {
  const wrsError = new Error("Rejected");
  wrsError.stack =
    "Error: Rejected\n    at wrsParams.serviceWorkers.navigator.serviceWorker.register (<anonymous>:12:648)";

  assert.equal(isGoogleWrsServiceWorkerRejection(wrsError), true);
  assert.equal(isGoogleWrsServiceWorkerRejection(new Error("Rejected")), false);
  assert.equal(
    isGoogleWrsServiceWorkerRejection(
      new Error("Failed to register a ServiceWorker"),
    ),
    false,
  );
});
