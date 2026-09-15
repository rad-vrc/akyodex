import assert from "node:assert/strict";
import test from "node:test";

import {
  DROP_ALL_TELEMETRY_HOOKS,
  isSyntheticSentryEnvironment,
  resolveSentryEnvironment,
  telemetryHooksFor,
} from "./sentry-environment";

test("resolveSentryEnvironment は NEXT_PUBLIC_SENTRY_ENVIRONMENT を優先し、無ければ NODE_ENV、それも無ければ production", () => {
  assert.equal(resolveSentryEnvironment({ environment: "lighthouse-ci", nodeEnv: "production" }), "lighthouse-ci");
  assert.equal(resolveSentryEnvironment({ environment: "preview", nodeEnv: "production" }), "preview");
  assert.equal(resolveSentryEnvironment({ environment: "", nodeEnv: "development" }), "development", "空文字は未設定扱い");
  assert.equal(resolveSentryEnvironment({ nodeEnv: "test" }), "test");
  assert.equal(resolveSentryEnvironment({}), "production");
});

test("lighthouse-ci だけが合成トラフィックの環境", () => {
  assert.equal(isSyntheticSentryEnvironment("lighthouse-ci"), true);
  for (const environment of ["production", "preview", "staging", "development", undefined]) {
    assert.equal(isSyntheticSentryEnvironment(environment), false, String(environment));
  }
});

test("合成トラフィックの環境では 4 種類の送信フックすべてが null を返し、それ以外ではフックを足さない", () => {
  const hooks = telemetryHooksFor("lighthouse-ci");
  assert.deepEqual(Object.keys(hooks).sort(), ["beforeSend", "beforeSendLog", "beforeSendMetric", "beforeSendTransaction"]);
  for (const [name, hook] of Object.entries(DROP_ALL_TELEMETRY_HOOKS)) {
    // SDK は (event, hint) / (metric) / (log) で呼ぶ。どの形でも null
    assert.equal((hook as (...args: unknown[]) => unknown)({ type: name }, { originalException: new Error("x") }), null, name);
  }
  assert.deepEqual(telemetryHooksFor("production"), {});
  assert.deepEqual(telemetryHooksFor("preview"), {});
});
