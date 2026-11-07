import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import * as sentryRelease from './sentry-release';

// 実際の instrumentation-client.ts を評価し、サーバーが <html data-sentry-release> に書いた値が
// ブラウザーの Sentry の初期化（initBrowserSentry）に渡ることを確かめる。
// HTML にリリース名があることはステージングの確認が見るが、そこから SDK に渡るところは見られないため
const source = readFileSync(new URL('../../instrumentation-client.ts', import.meta.url), 'utf8');
const COMMIT = '636be8fef64a182f553247ef311482f6fd17c335';

function loadInstrumentationClient(documentLike: unknown) {
  const initCalls: Array<Record<string, unknown>> = [];
  const dependencies: Record<string, unknown> = {
    '@/lib/sentry-client-init': {
      initBrowserSentry: (env: Record<string, unknown>) => {
        initCalls.push(env);
        return false; // tracing の読み込みには進ませない
      },
    },
    '@/lib/sentry-release': sentryRelease,
    '@/lib/sentry-tracing-loader': {
      forwardRouterTransitionStart: () => {},
      scheduleSentryTracingLoad: () => assert.fail('初期化しなかったときは呼ばない'),
    },
  };
  const exports = {};
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      document: documentLike,
      process: { env: { NEXT_PUBLIC_SENTRY_DSN: 'https://public@example.invalid/1', NODE_ENV: 'production' } },
      require: (name: string) => {
        assert.ok(Object.hasOwn(dependencies, name), `想定していない import: ${name}`);
        return dependencies[name];
      },
    }
  );
  assert.equal(initCalls.length, 1);
  return initCalls[0];
}

test('instrumentation-client は <html data-sentry-release> の値を release として初期化に渡す', () => {
  const env = loadInstrumentationClient({ documentElement: { dataset: { sentryRelease: COMMIT } } });
  assert.equal(env.release, COMMIT);
  assert.equal(env.dsn, 'https://public@example.invalid/1');
});

test('属性がない・形が違うときは release を渡さない', () => {
  assert.equal(loadInstrumentationClient({ documentElement: { dataset: {} } }).release, undefined);
  assert.equal(
    loadInstrumentationClient({ documentElement: { dataset: { sentryRelease: 'not-a-commit' } } }).release,
    undefined
  );
});
