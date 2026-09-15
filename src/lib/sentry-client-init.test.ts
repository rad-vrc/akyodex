import assert from "node:assert/strict";
import test from "node:test";

import {
  INCOMPLETE_APP_ROUTER_TRANSACTION_NAME,
  filterNextRedirectEvent,
  isNextRedirectError,
  normalizeNextStackFrame,
  resolveBrowserSentryOptions,
} from "./sentry-client-init";

test("normalizeNextStackFrame は Next 用 SDK と同じく origin を app:// に置き換え、フレームワークのチャンクを in_app=false にする", () => {
  assert.deepEqual(
    normalizeNextStackFrame({ filename: "https://akyodex.com/_next/static/chunks/13gzdycvfr4_e.js", in_app: true }),
    { filename: "app:///_next/static/chunks/13gzdycvfr4_e.js", in_app: true },
  );
  // %20 などは復号される
  assert.equal(
    normalizeNextStackFrame({ filename: "https://akyodex.com/_next/static/chunks/a%20b.js" }).filename,
    "app:///_next/static/chunks/a b.js",
  );
  // Next 内部のチャンクは in_app=false
  const framework = normalizeNextStackFrame({
    filename: "https://akyodex.com/_next/static/chunks/framework-0123456789abcdef.js",
    in_app: true,
  });
  assert.equal(framework.in_app, false);
  const main = normalizeNextStackFrame({
    filename: "https://akyodex.com/_next/static/chunks/main-app-abcdef0123.js",
    in_app: true,
  });
  assert.equal(main.in_app, false);
  // URL でないファイル名はそのまま
  assert.deepEqual(normalizeNextStackFrame({ filename: "<anonymous>" }), { filename: "<anonymous>" });
  assert.deepEqual(normalizeNextStackFrame({}), {});
});

test("isNextRedirectError / filterNextRedirectEvent は redirect() の制御用エラーだけを落とす", () => {
  const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/zukan;307;" });
  assert.equal(isNextRedirectError(redirect), true);
  assert.equal(isNextRedirectError(new Error("boom")), false);
  assert.equal(isNextRedirectError({ digest: "NEXT_REDIRECT;" }), false, "Error でなければ対象外");

  const event = { exception: { values: [{ value: "boom" }] } };
  assert.equal(filterNextRedirectEvent(event, { originalException: redirect }), null);
  assert.equal(filterNextRedirectEvent({ exception: { values: [{ value: "NEXT_REDIRECT" }] } }), null);
  assert.equal(filterNextRedirectEvent(event, { originalException: new Error("boom") }), event);
  assert.equal(filterNextRedirectEvent(event), event);
});

test("resolveBrowserSentryOptions は従来の instrumentation-client と同じ設定を組み立て、DSN が無ければ null", () => {
  assert.equal(resolveBrowserSentryOptions({ dsn: undefined, nodeEnv: "production" }), null);
  assert.equal(resolveBrowserSentryOptions({ dsn: "" }), null);

  const production = resolveBrowserSentryOptions({
    dsn: "https://k@o1.ingest.sentry.io/1",
    environment: "production",
    nodeEnv: "production",
  });
  assert.ok(production);
  assert.equal(production.dsn, "https://k@o1.ingest.sentry.io/1");
  assert.equal(production.environment, "production");
  assert.equal(production.enableMetrics, true, "既存の Web Vitals 分布は metrics で送る");
  assert.equal(production.tracesSampleRate, 0.1);
  assert.equal(production.sendDefaultPii, false);
  assert.ok(Array.isArray(production.ignoreSpans));
  assert.ok(production.ignoreSpans?.some((p) => p instanceof RegExp && p.test("/404")));
  assert.ok(
    production.ignoreSpans?.some((p) => p instanceof RegExp && p.test(INCOMPLETE_APP_ROUTER_TRANSACTION_NAME)),
  );

  // integrations: 既定 + RewriteFrames（Next のスタック補正相当）。BrowserTracing は含めない
  assert.equal(typeof production.integrations, "function");
  const integrations = (production.integrations as (d: Array<{ name: string }>) => Array<{ name: string }>)([
    { name: "InboundFilters" },
  ]);
  assert.deepEqual(
    integrations.map((i) => i.name),
    ["InboundFilters", "RewriteFrames"],
  );

  // 環境の解決: NEXT_PUBLIC_SENTRY_ENVIRONMENT > NODE_ENV > production。開発は 100% サンプル
  assert.equal(resolveBrowserSentryOptions({ dsn: "x", nodeEnv: "development" })?.environment, "development");
  assert.equal(resolveBrowserSentryOptions({ dsn: "x", nodeEnv: "development" })?.tracesSampleRate, 1.0);
  assert.equal(resolveBrowserSentryOptions({ dsn: "x" })?.environment, "production");

  // 本番・プレビューでは送信フックを足さない（SDK 既定のまま送る）
  assert.equal(production.beforeSend, undefined);
  assert.equal(production.beforeSendTransaction, undefined);
  assert.equal(production.beforeSendMetric, undefined);
});

test("lighthouse-ci では SDK を本番と同じに初期化したまま、全種類の送信を捨てる", () => {
  const lighthouse = resolveBrowserSentryOptions({
    dsn: "https://k@o1.ingest.sentry.io/1",
    environment: "lighthouse-ci",
    nodeEnv: "production",
  });
  assert.ok(lighthouse);
  assert.equal(lighthouse.environment, "lighthouse-ci");
  // 初期化条件は本番と同一（DSN を外して SDK ごと止めると CI の計測条件が本番からずれる）
  assert.equal(lighthouse.enableMetrics, true);
  assert.equal(lighthouse.tracesSampleRate, 0.1);
  assert.equal(typeof lighthouse.integrations, "function");
  // 送信段階で捨てる
  const event = { type: undefined, event_id: "e" } as never;
  const hint = {} as never;
  assert.equal(lighthouse.beforeSend?.(event, hint), null);
  assert.equal(lighthouse.beforeSendTransaction?.(event, hint), null);
  assert.equal(lighthouse.beforeSendMetric?.({ name: "web_vitals.lcp" } as never), null);
  assert.equal(lighthouse.beforeSendLog?.({ message: "x" } as never), null);
});
