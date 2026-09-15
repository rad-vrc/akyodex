import assert from "node:assert/strict";
import test from "node:test";

import {
  DROP_ALL_TELEMETRY_OPTIONS,
  isSyntheticSentryEnvironment,
  resolveSentryEnvironment,
  telemetryOptionsFor,
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

test("合成トラフィックの環境では 4 種類の送信フックが null を返し client_report も止まる。それ以外では何も足さない", () => {
  const options = telemetryOptionsFor("lighthouse-ci");
  assert.deepEqual(
    Object.keys(options).sort(),
    ["beforeSend", "beforeSendLog", "beforeSendMetric", "beforeSendTransaction", "sendClientReports"],
  );
  assert.equal(options.sendClientReports, false, "捨てた件数の報告（client_report）も送らない");
  const { sendClientReports: _ignored, ...hooks } = DROP_ALL_TELEMETRY_OPTIONS;
  void _ignored;
  for (const [name, hook] of Object.entries(hooks)) {
    // SDK は (event, hint) / (metric) / (log) で呼ぶ。どの形でも null
    assert.equal((hook as (...args: unknown[]) => unknown)({ type: name }, { originalException: new Error("x") }), null, name);
  }
  assert.deepEqual(telemetryOptionsFor("production"), {});
  assert.deepEqual(telemetryOptionsFor("preview"), {});
});
