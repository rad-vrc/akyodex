import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
// Next.js が App Router の描画で使うのと同じ関数。リクエストの Content-Security-Policy から
// nonce を取り出し、Next.js 自身のインライン script（self.__next_f など）に付ける。
// next/dist/server/lib/router-utils/resolve-routes.js は、middleware が応答に付けたヘッダーを
// リクエストにも写すので、ここで読めない形の CSP だと Next.js の script に nonce が付かない
import { getScriptNonceFromHeader } from 'next/dist/server/app-render/get-script-nonce-from-header';
import { middleware } from './middleware';

// NextResponse.next({ request: { headers } }) は、差し替えたリクエストのヘッダーを
// x-middleware-request-<name> として応答に載せる
const FORWARDED_NONCE_HEADER = 'x-middleware-request-x-nonce';

type Case = { name: string; url: string; headers?: Record<string, string> };

// middleware.ts の分岐（admin・Cookie・Cloudflare の国・Accept-Language）をすべて通す
const CASES: Case[] = [
  { name: 'admin', url: 'https://akyodex.com/admin' },
  { name: 'Cookie の言語', url: 'https://akyodex.com/zukan', headers: { cookie: 'AKYO_LANG=en' } },
  { name: 'Cloudflare の国', url: 'https://akyodex.com/zukan', headers: { 'cf-ipcountry': 'KR' } },
  { name: 'Accept-Language', url: 'https://akyodex.com/zukan', headers: { 'accept-language': 'ja' } },
];

function run(c: Case) {
  const response = middleware(new NextRequest(c.url, { headers: c.headers }));
  const csp = response.headers.get('content-security-policy');
  assert.ok(csp, `${c.name}: Content-Security-Policy がない`);
  return { csp, forwarded: response.headers.get(FORWARDED_NONCE_HEADER) };
}

function scriptSrc(csp: string): string[] {
  const directive = csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith('script-src '));
  assert.ok(directive, 'script-src がない');
  return directive.split(/\s+/).slice(1);
}

for (const c of CASES) {
  test(`CSP の nonce を Next.js が読めて、ページに渡す x-nonce と一致する（${c.name}）`, () => {
    const { csp, forwarded } = run(c);
    const nonce = getScriptNonceFromHeader(csp);
    assert.ok(nonce, `Next.js が CSP から nonce を読めない: ${csp}`);
    assert.equal(forwarded, nonce, 'layout.tsx に渡す x-nonce が CSP の nonce と違う');
  });
}

test('nonce はリクエストごとに変わる', () => {
  const nonces = new Set(
    Array.from({ length: 5 }, () => getScriptNonceFromHeader(run(CASES[3]).csp))
  );
  assert.equal(nonces.size, 5);
});

test('script-src はインラインの script を nonce だけで許可する', () => {
  const sources = scriptSrc(run(CASES[3]).csp);
  assert.equal(sources.filter((s) => s.startsWith("'nonce-")).length, 1);
  assert.ok(!sources.includes("'unsafe-inline'"), "'unsafe-inline' があると nonce が意味をなさない");
  // Dify はこの文書にインラインの script を置かないので、ハッシュは要らない（PR #611）。
  // ハッシュを足すなら、親ページに同じ中身のインライン script があり、nonce では足りないことを
  // 確かめてからこのテストを直す。Dify の iframe（udify.app）の中の script には親の CSP は効かない
  assert.deepEqual(
    sources.filter((s) => s.startsWith("'sha256-") || s.startsWith("'sha384-") || s.startsWith("'sha512-")),
    []
  );
});

test('静的ファイルと API には CSP を付けない', () => {
  for (const url of ['https://akyodex.com/api/catalog', 'https://akyodex.com/_next/static/x.js', 'https://akyodex.com/favicon.ico']) {
    const response = middleware(new NextRequest(url));
    assert.equal(response.headers.get('content-security-policy'), null, url);
  }
});
