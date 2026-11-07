import assert from 'node:assert/strict';
import test from 'node:test';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { NextRequest } from 'next/server';
// Next.js が App Router の描画で使うのと同じ関数。リクエストの Content-Security-Policy から
// nonce を取り出し、Next.js 自身のインライン script（self.__next_f など）に付ける。
// middleware が応答に付けたヘッダーは、リクエストにも写される。Node のサーバーでは
// next/dist/server/lib/router-utils/resolve-routes.js、本番の Workers（OpenNext）では
// @opennextjs/aws の core/routingHandler.js と core/requestHandler.js がこれを行う。
// ここで読めない形の CSP だと、Next.js の script に nonce が付かない。
// この関数が残ったまま描画側が nonce を使わなくなる変化は、この単体テストでは捕まえられない。
// それはステージングの確認（scripts/verify-csp-nonce.js）が実際の HTML で見る
import { getScriptNonceFromHeader } from 'next/dist/server/app-render/get-script-nonce-from-header';

// 配信される本番のポリシーを確かめる（開発時だけ script-src に 'unsafe-eval' が入る）。
// middleware.ts は読み込んだ時点の NODE_ENV でポリシーを決めるので、先に入れてから動的に読み込む。
// node --test はファイルごとに別のプロセスで走るので、ほかのテストには漏れない
let loaded: Promise<typeof import('./middleware')> | undefined;
function loadMiddleware() {
  if (!loaded) {
    Object.assign(process.env, { NODE_ENV: 'production' });
    loaded = import('./middleware');
  }
  return loaded;
}

// NextResponse.next({ request: { headers } }) は、差し替えたリクエストのヘッダーを
// x-middleware-request-<name> として応答に載せる
const FORWARDED_NONCE_HEADER = 'x-middleware-request-x-nonce';

// CSP Level 3 は、nonce をエンコード前で 128 ビット以上にするよう勧めている
const MIN_NONCE_BYTES = 16;

type Case = { name: string; url: string; headers?: Record<string, string> };

// middleware.ts の分岐（admin・Cookie・Cloudflare の国・Accept-Language）をすべて通す
const CASES: Case[] = [
  { name: 'admin', url: 'https://akyodex.com/admin' },
  { name: 'Cookie の言語', url: 'https://akyodex.com/zukan', headers: { cookie: 'AKYO_LANG=en' } },
  { name: 'Cloudflare の国', url: 'https://akyodex.com/zukan', headers: { 'cf-ipcountry': 'KR' } },
  { name: 'Accept-Language', url: 'https://akyodex.com/zukan', headers: { 'accept-language': 'ja' } },
];

async function run(c: Case) {
  const { middleware } = await loadMiddleware();
  const response = middleware(new NextRequest(c.url, { headers: c.headers }));
  const csp = response.headers.get('content-security-policy');
  assert.ok(csp, `${c.name}: Content-Security-Policy がない`);
  return { csp, forwarded: response.headers.get(FORWARDED_NONCE_HEADER) };
}

// 同じ directive が 2 回あると、ブラウザーは最初のものだけを使う。後ろの値で上書きして読むと
// ブラウザーと違うものを確かめてしまうので、重複そのものを失敗にする
function directives(csp: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const directive of csp.split(';')) {
    const [name, ...sources] = directive.trim().split(/\s+/);
    if (!name) continue;
    const key = name.toLowerCase();
    assert.equal(map.has(key), false, `CSP に ${key} が 2 回ある（ブラウザーは最初のものだけを使う）`);
    map.set(key, sources);
  }
  return map;
}

for (const c of CASES) {
  test(`CSP の nonce を Next.js が読めて、middleware がリクエストに載せる x-nonce と一致する（${c.name}）`, async () => {
    const { csp, forwarded } = await run(c);
    const nonce = getScriptNonceFromHeader(csp);
    assert.ok(nonce, `Next.js が CSP から nonce を読めない: ${csp}`);
    assert.equal(forwarded, nonce, 'リクエストに載せる x-nonce（layout.tsx が読む）が CSP の nonce と違う');
  });
}

test('nonce はリクエストごとに変わり、16 バイト以上ある', async () => {
  const nonces: string[] = [];
  for (let i = 0; i < 5; i++) {
    const nonce = getScriptNonceFromHeader((await run(CASES[3])).csp);
    assert.ok(nonce);
    nonces.push(nonce);
  }
  assert.equal(new Set(nonces).size, 5);
  for (const nonce of nonces) {
    const bytes = Buffer.from(nonce, 'base64').length;
    assert.ok(bytes >= MIN_NONCE_BYTES, `nonce が短い（${bytes} バイト）`);
  }
});

test('本番のポリシーで script の実行を許可するのは script-src の self・ホスト・nonce だけ', async () => {
  const policy = directives((await run(CASES[3])).csp);
  // script-src-elem と script-src-attr は、script 要素とイベントハンドラ属性について
  // script-src より優先される。ここに 'unsafe-inline' などがあると、script-src を見ても分からない
  for (const name of ['script-src-elem', 'script-src-attr']) {
    assert.equal(policy.has(name), false, `${name} があると script-src の判定を上書きする`);
  }

  const sources = policy.get('script-src');
  assert.ok(sources, 'script-src がない');
  const keywords = sources.filter((s) => s.startsWith("'"));
  const nonces = keywords.filter((s) => s.startsWith("'nonce-"));
  assert.equal(nonces.length, 1);
  // 'unsafe-eval' は開発時だけ（React の開発用の診断が eval を使う）で、本番には入れない。
  // 'unsafe-inline' は、nonce があれば対応ブラウザーでは無視されるが、意図しない許可を残さないため入れない。
  // 'strict-dynamic' はホストの許可を無効にし、Dify・GA などの読み込み方が変わる。
  // ハッシュは、Dify がこの文書にインラインの script を置かないので要らない（PR #611）。
  // 足すときは、親ページに同じ中身のインライン script があり、nonce では足りないことを確かめてからこのテストを直す。
  // Dify の iframe（udify.app）の中の script には親の CSP は効かない
  assert.deepEqual([...keywords].sort(), ["'self'", ...nonces].sort());
});

test('middleware はページで動き、静的ファイルと API では動かない', async () => {
  const { config } = await loadMiddleware();
  const matches = (url: string, headers?: Record<string, string>) =>
    unstable_doesMiddlewareMatch({ config, url, headers });
  for (const url of ['/', '/zukan', '/zukan/0001', '/admin', '/admin/edit']) {
    assert.equal(matches(url), true, `${url} で middleware が動かない（CSP と nonce が付かない）`);
  }
  for (const url of ['/api/catalog/ja', '/_next/static/chunks/app.js', '/images/logo.png', '/favicon.ico']) {
    assert.equal(matches(url), false, `${url} で middleware が動く`);
  }
  // 先読みのリクエストは HTML を返さないので除く（Next.js のルーターと、ブラウザーの purpose: prefetch）
  assert.equal(matches('/zukan', { 'next-router-prefetch': '1' }), false);
  assert.equal(matches('/zukan', { purpose: 'prefetch' }), false);
});

test('静的ファイルと API には CSP を付けない（matcher をすり抜けた場合の守り）', async () => {
  const { middleware } = await loadMiddleware();
  for (const url of ['https://akyodex.com/api/catalog', 'https://akyodex.com/_next/static/x.js', 'https://akyodex.com/favicon.ico']) {
    const response = middleware(new NextRequest(url));
    assert.equal(response.headers.get('content-security-policy'), null, url);
  }
});
