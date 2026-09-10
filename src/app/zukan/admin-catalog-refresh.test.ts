import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAdminCsvCatalog } from './catalog-data-loader';

/**
 * 管理画面の再取得は、遅れる公開カタログではなく保存先の CSV スナップショットを読む
 * （/api/admin/catalog）。遅延と削除を区別できるようにするため。
 *
 * 失敗は必ず例外にする。空配列を成功として返すと、呼び出し側がそれを完全なスナップショット
 * として扱い、一覧と保留を失う。
 */

const row = { id: '0001', nickname: 'Test', avatarName: 'Test', category: 'New category', author: 'Author' };
const payload = (data: unknown[] = [row]) => ({ success: true, head: 'a'.repeat(40), count: data.length, data });

test('管理用再取得は保存先の CSV を、ブラウザキャッシュを使わずに読む', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.match(url, /^\/api\/admin\/catalog\?refresh=\d+$/, '公開カタログを読んではいけない');
    assert.equal(options.cache, 'no-store');
    return Response.json(payload());
  });
  const { head, rows } = await loadAdminCsvCatalog();
  assert.equal(head, 'a'.repeat(40), 'どの版を読んだか追えること');
  assert.equal(rows[0].category, 'New category');
});

test('管理用 API の失敗で、古いスナップショットへ落ちない', async (t) => {
  for (const response of [
    () => new Response('', { status: 503 }),
    () => new Response('', { status: 401 }),
    () => Response.json({ success: false, error: '保存先の最新データを取得できませんでした。' }),
  ]) {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls += 1;
      return response();
    });
    await assert.rejects(loadAdminCsvCatalog());
    assert.equal(calls, 1, '公開カタログへ問い合わせ直してはいけない');
  }
});

test('空・重複・欠けた応答は、一覧を置き換えずに例外にする', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json(payload([])));
  await assert.rejects(loadAdminCsvCatalog(), '空配列を完全なスナップショットとして扱わない');
  t.mock.method(globalThis, 'fetch', async () => Response.json(payload([row, row])));
  await assert.rejects(loadAdminCsvCatalog());
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, count: 1, data: [row] }));
  await assert.rejects(loadAdminCsvCatalog(), 'head の無い応答は受け取らない');
});

test('取り消しは中断として返る', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return Response.json(payload());
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadAdminCsvCatalog(controller.signal), { name: 'AbortError' });
});

/*
 * count は「サーバが数えた件数」。data と食い違うのは応答が途中で欠けたときで、
 * そのまま受けると部分的な一覧を完全なスナップショットとして扱い、載っていない行が
 * 削除されたように見える。ID が空の行も同じで、保留・ハイライトが全部 ID で引くので
 * 無関係な行に紐づいて見える（parseCsvToAkyoData は ID の無い行も落とさずに返す）。
 */
test('count と件数が食い違う応答、ID の無い行を含む応答は受け取らない', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ...payload([row]), count: 2 }));
  await assert.rejects(loadAdminCsvCatalog(), 'count が多い応答は欠けている');

  t.mock.method(globalThis, 'fetch', async () => Response.json({ ...payload([row, { ...row, id: '0002' }]), count: 1 }));
  await assert.rejects(loadAdminCsvCatalog(), 'count が少ない応答も食い違い');

  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, head: 'a'.repeat(40), data: [row] }));
  await assert.rejects(loadAdminCsvCatalog(), 'count の無い応答は受け取らない');

  t.mock.method(globalThis, 'fetch', async () => Response.json(payload([{ ...row, id: '' }])));
  await assert.rejects(loadAdminCsvCatalog(), 'ID の空いた行を混ぜない');

  t.mock.method(globalThis, 'fetch', async () => Response.json(payload([row, { ...row, id: '' }])));
  await assert.rejects(loadAdminCsvCatalog(), '1 行でも ID が無ければ受け取らない');
});

/*
 * HTTP の失敗は、本文の形が正しくても失敗として扱う。既存の失敗ケースは本文が空で、
 * `response.json()` がそこで throw するため、ok の検査を外しても偶然 reject していた
 * （2026-09-10、変異で実測）。中間の 503 が正常な形の本文を返すのは普通にあり得る。
 */
test('HTTP が失敗なら、本文の形が正しくても受け取らない', async (t) => {
  for (const status of [503, 502, 401]) {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls += 1;
      return Response.json(payload(), { status });
    });
    await assert.rejects(loadAdminCsvCatalog(), `HTTP ${status} を成功として扱わない`);
    assert.equal(calls, 1, '公開カタログへ問い合わせ直してはいけない');
  }
});

/*
 * 期限は本文の読み取りまで含める。**ヘッダーだけ届いて本文が来ない止まり方がある**ので、
 * fetch の解決だけを見ていると永久に待つ。
 *
 * ここが返らないと EditTab は refreshing を握ったままになり、それが AdminTabs の busy へ
 * 伝わって再取得ボタンも全タブも無効になる。失敗表示も出ず、画面内に取得を止める手段が
 * 無い。旧 loadLatestAdminCatalog は fetchCatalogSource 越しに 15 秒の期限を持っていた。
 *
 * 期限そのものは実時間で短く与えて試す（node:test の mock.timers を有効にすると、
 * ランナー自身が止まって結果が出ない）。既定値は setTimeout の引数で押さえる。
 */
const stallUntilAborted = (options: RequestInit) =>
  new Promise<never>((_resolve, reject) => {
    options.signal?.addEventListener(
      'abort',
      () => reject(new DOMException('aborted', 'AbortError')),
      { once: true },
    );
  });

test('応答ヘッダーが来ないまま止まったら、期限で失敗にする', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => stallUntilAborted(options));
  await assert.rejects(loadAdminCsvCatalog(undefined, 20), (error: Error) => {
    // 外から止めたのではないので AbortError にしてはいけない。AbortError だと呼び出し側が
    // 「利用者が取り消した」と読んで、失敗表示を出さずに終わる
    assert.equal(error.name, 'CatalogDeadlineError');
    return true;
  });
});

test('ヘッダーは来たのに本文が来ないまま止まっても、期限で失敗にする', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => ({
    ok: true,
    status: 200,
    json: () => stallUntilAborted(options),
  }) as unknown as Response);
  await assert.rejects(loadAdminCsvCatalog(undefined, 20), { name: 'CatalogDeadlineError' });
});

test('期限切れのあとも、もう一度取得できる', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => stallUntilAborted(options));
  await assert.rejects(loadAdminCsvCatalog(undefined, 20), { name: 'CatalogDeadlineError' });

  t.mock.method(globalThis, 'fetch', async () => Response.json(payload()));
  const { rows } = await loadAdminCsvCatalog(undefined, 20);
  assert.equal(rows.length, 1, '期限切れで壊れた状態が残らない');
});

test('既定の期限は 15 秒で、本文の読み取りまで 1 本で覆う', async (t) => {
  const delays: number[] = [];
  const realSetTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', ((handler: TimerHandler, ms?: number, ...rest: unknown[]) => {
    if (typeof ms === 'number') delays.push(ms);
    return (realSetTimeout as (...args: unknown[]) => unknown)(handler, ms, ...rest);
  }) as typeof setTimeout);
  let bodyRead = false;
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => { bodyRead = true; return { success: true, head: 'a'.repeat(40), count: 1, data: [row] }; },
  }) as unknown as Response);

  const { rows } = await loadAdminCsvCatalog();
  assert.equal(rows.length, 1);
  assert.ok(bodyRead, '本文まで読んでいる');
  assert.ok(delays.includes(15_000), `既定の期限が掛かっていない: ${delays.join(',')}`);
  assert.equal(delays.filter((ms) => ms === 15_000).length, 1, '期限は 1 本。fetch と本文で分けない');
});
