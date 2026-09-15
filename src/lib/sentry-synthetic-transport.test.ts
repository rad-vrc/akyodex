/**
 * 実際の BrowserClient に resolveBrowserSentryOptions の結果を渡し、transport に何が
 * 届くかを見る。フックを単体で呼ぶテスト（sentry-client-init.test.ts）では、SDK が
 * 捨てた件数を client_report として送る経路（sendClientReports）を見落とす。
 */
import assert from "node:assert/strict";
import test from "node:test";

import * as Sentry from "@sentry/react";

import { resolveBrowserSentryOptions } from "./sentry-client-init";

const DSN = "https://public@o1.ingest.sentry.io/1";

/** envelope 内の item type を並べる（event / transaction / metric / client_report ...） */
function startClient(environment: string, override: Partial<Sentry.BrowserOptions> = {}) {
  const options = resolveBrowserSentryOptions({ dsn: DSN, environment, nodeEnv: "production" });
  assert.ok(options);
  const delivered: string[] = [];
  const client = new Sentry.BrowserClient({
    ...options,
    ...override,
    stackParser: Sentry.defaultStackParser,
    integrations: [],
    transport: (transportOptions) =>
      Sentry.createTransport(transportOptions, async () => ({ statusCode: 200 })),
  });
  client.on("beforeEnvelope", (envelope) => {
    for (const item of envelope[1]) {
      delivered.push(item[0].type);
    }
  });
  Sentry.setCurrentClient(client);
  client.init();
  return { client, delivered };
}

/** 送信対象を一通り発生させ、通常の flush と、非表示時に走る捨てた件数の報告を両方通す */
async function exercise(client: Sentry.BrowserClient) {
  Sentry.captureMessage("Web Vitals degraded: LCP", "warning");
  Sentry.captureException(new Error("synthetic failure"));
  Sentry.metrics.distribution("web_vitals.lcp", 4684, { unit: "millisecond" });
  await client.flush(2000);
  // BrowserClient が visibilitychange(hidden) で呼ぶのと同じ処理
  (client as unknown as { _flushOutcomes(): void })._flushOutcomes();
  await client.flush(2000);
}

test("lighthouse-ci: 実 SDK の transport には event も metric も client_report も届かない", async () => {
  const { client, delivered } = startClient("lighthouse-ci");
  await exercise(client);
  assert.deepEqual(delivered, []);
  await client.close();
});

test("対照: sendClientReports を SDK 既定（true）に戻すと、捨てた件数が client_report として届く", async () => {
  const { client, delivered } = startClient("lighthouse-ci", { sendClientReports: true });
  await exercise(client);
  assert.deepEqual(delivered, ["client_report"], "フックだけでは止まらない経路がこれ");
  await client.close();
});

test("production: 同じ経路で event が届く（テスト側の配線が生きていることの対照）", async () => {
  const { client, delivered } = startClient("production");
  await exercise(client);
  assert.ok(delivered.includes("event"), `delivered: ${delivered.join(", ")}`);
  assert.ok(!delivered.includes("client_report"), "本番では捨てたものが無いので client_report も出ない");
  await client.close();
});
