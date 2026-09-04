import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReferenceDownloadFilename,
  buildReferenceDownloadHeaders,
  REFERENCE_DOWNLOAD_CACHE_CONTROL,
  referenceDownloadEtagMatches,
} from "./reference-download";

test("原本は毎回再検証させる（同名上書きを最大 1 日見逃さない）", () => {
  assert.equal(REFERENCE_DOWNLOAD_CACHE_CONTROL, "public, max-age=0, must-revalidate");
});

test("添付ダウンロードのファイル名とヘッダーは従来どおり", () => {
  assert.equal(buildReferenceDownloadFilename("0001"), "akyo-0001-reference.png");

  const headers = buildReferenceDownloadHeaders({
    id: "0001",
    etag: '"abc123"',
    contentLength: 4298085,
  });

  assert.equal(headers.get("Content-Type"), "image/png");
  assert.equal(
    headers.get("Content-Disposition"),
    'attachment; filename="akyo-0001-reference.png"',
  );
  assert.equal(headers.get("Content-Length"), "4298085");
  assert.equal(headers.get("ETag"), '"abc123"');
  assert.equal(headers.get("Cache-Control"), REFERENCE_DOWNLOAD_CACHE_CONTROL);
});

test("ETag や Content-Length が無い場合はヘッダーを出さない", () => {
  const headers = buildReferenceDownloadHeaders({ id: "0042", etag: null });

  assert.equal(headers.has("ETag"), false);
  assert.equal(headers.has("Content-Length"), false);
  assert.equal(
    headers.get("Content-Disposition"),
    'attachment; filename="akyo-0042-reference.png"',
  );
});

test("If-None-Match は複数値・弱い ETag・ワイルドカードを扱う", () => {
  assert.equal(referenceDownloadEtagMatches('"abc"', '"abc"'), true);
  assert.equal(referenceDownloadEtagMatches('W/"abc"', '"abc"'), true);
  assert.equal(referenceDownloadEtagMatches('"abc"', 'W/"abc"'), true);
  assert.equal(referenceDownloadEtagMatches('"zzz", "abc"', '"abc"'), true);
  assert.equal(referenceDownloadEtagMatches("*", '"abc"'), true);

  assert.equal(referenceDownloadEtagMatches('"zzz"', '"abc"'), false, "別の版は一致しない");
  assert.equal(referenceDownloadEtagMatches(null, '"abc"'), false);
  assert.equal(referenceDownloadEtagMatches('"abc"', null), false, "ETag 不明なら 304 にしない");
  assert.equal(referenceDownloadEtagMatches("", '"abc"'), false);
});
