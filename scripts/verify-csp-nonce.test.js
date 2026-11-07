const assert = require("node:assert/strict");
const test = require("node:test");

const { getScriptNonceFromHeader } = require("next/dist/server/app-render/get-script-nonce-from-header");
const { checkCspNonce, getScriptNonceFromCsp } = require("./verify-csp-nonce");

const NONCE = "AbCd+/EfGh0123456789==";
const headers = (csp) => {
  const lines = ["HTTP/2 200", "content-type: text/html; charset=utf-8"];
  if (csp !== undefined) lines.push(`content-security-policy: ${csp}`);
  return `${lines.join("\r\n")}\r\n\r\n`;
};
const CSP = `default-src 'self'; script-src 'self' https://udify.app 'nonce-${NONCE}'; style-src 'self' 'unsafe-inline'`;

const page = (...scripts) => `<!DOCTYPE html><html><head></head><body>${scripts.join("")}</body></html>`;
const NEXT_INLINE = `<script nonce="${NONCE}">(self.__next_f=self.__next_f||[]).push([0])</script>`;

test("nonce の読み取りは Next.js の getScriptNonceFromHeader と同じ結果になる", () => {
  for (const csp of [
    CSP,
    `default-src 'self' 'nonce-${NONCE}'`,
    `script-src 'self' nonce-${NONCE}`,
    `script-src 'self' 'nonce-${NONCE}A'`,
    `default-src 'self'`,
    `script-src-elem 'nonce-ELEM'; script-src 'nonce-${NONCE}'`,
  ]) {
    assert.equal(getScriptNonceFromCsp(csp), getScriptNonceFromHeader(csp), csp);
  }
});

test("実行される script がすべて CSP の nonce を持っていれば通る", () => {
  const result = checkCspNonce(
    headers(CSP),
    page(
      NEXT_INLINE,
      `<script src="/_next/static/chunks/app.js" async="" nonce="${NONCE}"></script>`,
      `<script id="website-structured-data" type="application/ld+json" nonce="${NONCE}">{"@type":"WebSite"}</script>`,
      `<script type="application/json">{"a":1}</script>`
    )
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.executableInline, 1);
  assert.equal(result.scripts, 4);
});

test("nonce のないインラインの script を見つける", () => {
  const result = checkCspNonce(headers(CSP), page(NEXT_INLINE, "<script>alert(1)</script>"));
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /nonce のないインラインの script/);
});

test("CSP と違う nonce の script を見つける（data block でも）", () => {
  for (const extra of [
    `<script nonce="OTHER">self.x=1</script>`,
    `<script type="application/ld+json" nonce="OTHER">{}</script>`,
    `<script src="/a.js" nonce="OTHER"></script>`,
  ]) {
    const result = checkCspNonce(headers(CSP), page(NEXT_INLINE, extra));
    assert.equal(result.errors.length, 1, extra);
    assert.match(result.errors[0], /CSP と違う nonce/);
  }
});

test("CSP の判定を受ける種類（JavaScript の MIME・module・importmap など）は nonce がないと失敗する", () => {
  for (const attrs of [
    'type="module"',
    'type="text/javascript"',
    'type="application/javascript"',
    'type="TEXT/JAVASCRIPT"',
    'type=" text/javascript1.5 "',
    'type="text/jscript"',
    'type="importmap"',
    'type="speculationrules"',
    'language="javascript"',
    'type="module" nomodule',
    'type="MODULE"',
  ]) {
    const result = checkCspNonce(headers(CSP), page(NEXT_INLINE, `<script ${attrs}>self.y=1</script>`));
    assert.equal(result.errors.length, 1, attrs);
    assert.match(result.errors[0], /nonce のないインライン/, attrs);
  }
});

test("HTML Standard の JavaScript MIME type essence はすべて実行される script として扱う", () => {
  // 確認スクリプトの一覧とは別に、仕様（https://mimesniff.spec.whatwg.org/#javascript-mime-type）から写す
  for (const type of [
    "application/ecmascript",
    "application/javascript",
    "application/x-ecmascript",
    "application/x-javascript",
    "text/ecmascript",
    "text/javascript",
    "text/javascript1.0",
    "text/javascript1.1",
    "text/javascript1.2",
    "text/javascript1.3",
    "text/javascript1.4",
    "text/javascript1.5",
    "text/jscript",
    "text/livescript",
    "text/x-ecmascript",
    "text/x-javascript",
  ]) {
    const result = checkCspNonce(headers(CSP), page(NEXT_INLINE, `<script type="${type}">self.y=1</script>`));
    assert.equal(result.errors.length, 1, type);
    assert.match(result.errors[0], /nonce のないインライン/, type);
  }
});

test("空白だけのインライン script は CSP の判定を受ける（空のものは受けない）", () => {
  assert.equal(checkCspNonce(headers(CSP), page(NEXT_INLINE, "<script> \n </script>")).errors.length, 1);
  assert.deepEqual(checkCspNonce(headers(CSP), page(NEXT_INLINE, "<script></script>")).errors, []);
});

test("入れ子の <noscript> は、script が有効なブラウザーと同じに読む", () => {
  // 最初の </noscript> で外側も閉じるので、その後ろの script は実行される
  const result = checkCspNonce(
    headers(CSP),
    page(NEXT_INLINE, "<noscript><noscript></noscript><script>self.x=1</script></noscript>")
  );
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /nonce のないインライン/);
});

test("この確認で判定できない HTML の形は失敗する", () => {
  const cases = [
    ['<meta http-equiv="Content-Security-Policy" content="script-src \'none\'">', /<meta> の CSP/],
    ['<iframe srcdoc="<script>self.y=1</script>"></iframe>', /srcdoc/],
    ['<svg><script>self.y=1</script></svg>', /SVG/],
    ['<svg><script src="/a.js">self.y=1</script></svg>', /SVG/],
    ['<script type=" MODULE ">self.y=1</script>', /扱いが分かれる/],
    ['<script type="importmap ">{}</script>', /扱いが分かれる/],
  ];
  for (const [extra, message] of cases) {
    const result = checkCspNonce(headers(CSP), page(NEXT_INLINE, extra));
    assert.equal(result.errors.length, 1, extra);
    assert.match(result.errors[0], message, extra);
  }
});

test("実行されない script は nonce がなくても失敗しない", () => {
  for (const extra of [
    // data block（JavaScript の MIME と完全に一致しないものも含む）
    '<script type="text/plain">self.y=1</script>',
    '<script type="text/javascript; charset=utf-8">self.y=1</script>',
    // type がなく language があると、"text/" + language で判定する
    '<script language="vbscript">self.y=1</script>',
    // module に対応したブラウザーは nomodule の classic script を実行しない
    "<script nomodule>self.y=1</script>",
    // script が有効なとき <noscript> の中身は文字になる
    "<noscript><script>self.y=1</script></noscript>",
    // <template> の中身は別の文書
    "<template><script>self.y=1</script></template>",
    // 空のインライン script は何もしない。src のあるものはホストの許可で判定される
    "<script></script>",
    '<script src="/_next/static/chunks/app.js">self.y=1</script>',
  ]) {
    assert.deepEqual(checkCspNonce(headers(CSP), page(NEXT_INLINE, extra)).errors, [], extra);
  }
});

test("この確認で判定できない CSP の形は失敗する", () => {
  const cases = [
    // 複数のポリシーはすべてが効く
    [`${CSP}, script-src 'none'`, /2 本/],
    // script 要素では script-src-elem が優先される
    [`${CSP}; script-src-elem 'none'`, /script-src-elem/],
    // Next.js の読み取りは script-src-attr の nonce を拾うが、ブラウザーは script-src で止める
    [`script-src-attr 'nonce-${NONCE}'; script-src 'none'`, /script-src-attr/],
    // ブラウザーは最初の script-src だけを使う
    [`script-src 'self' 'nonce-${NONCE}' 'sha256-OBTN3RiyCV4Bq7dFqZ5a2pAXjnCcCYeTJMO2I/LYKeo='; ${CSP}`, /2 回/],
  ];
  for (const [csp, message] of cases) {
    const result = checkCspNonce(headers(csp), page(NEXT_INLINE));
    assert.equal(result.errors.length, 1, csp);
    assert.match(result.errors[0], message);
  }

  const twoHeaders = `HTTP/2 200\r\ncontent-security-policy: ${CSP}\r\ncontent-security-policy: script-src 'none'\r\n\r\n`;
  assert.match(checkCspNonce(twoHeaders, page(NEXT_INLINE)).errors[0], /2 本/);
  // Report-Only は止めないので数えない
  const reportOnly = `HTTP/2 200\r\ncontent-security-policy: ${CSP}\r\ncontent-security-policy-report-only: script-src 'none'\r\n\r\n`;
  assert.deepEqual(checkCspNonce(reportOnly, page(NEXT_INLINE)).errors, []);
});

test("大文字のタグ・属性付きの閉じタグ・コメントをブラウザーと同じに読む", () => {
  const upper = checkCspNonce(headers(CSP), page(NEXT_INLINE, "<SCRIPT>self.a=1</SCRIPT>"));
  assert.equal(upper.errors.length, 1);
  const oddEnd = checkCspNonce(headers(CSP), page(NEXT_INLINE, '<script>self.b=1</script foo="bar">'));
  assert.equal(oddEnd.errors.length, 1);
  assert.equal(oddEnd.scripts, 2);
  // コメントの中の script は実行されない（--!> でもコメントは閉じる）
  const commented = checkCspNonce(
    headers(CSP),
    page(NEXT_INLINE, "<!-- <script>self.c=1</script> -->", "<!-- x --!><p>after</p>")
  );
  assert.deepEqual(commented.errors, []);
  assert.equal(commented.scripts, 1);
});

test("CSP がない・nonce を読めない・インラインの script がないときは失敗する", () => {
  assert.match(checkCspNonce(headers(undefined), page(NEXT_INLINE)).errors[0], /ヘッダーがない/);
  assert.match(checkCspNonce(headers(`script-src 'self'`), page(NEXT_INLINE)).errors[0], /nonce を読めない/);
  assert.match(checkCspNonce(headers(CSP), page()).errors[0], /1 つもない/);
});

test("リダイレクトをはさんだときは最後の応答の CSP を使う", () => {
  const raw = [
    "HTTP/2 308",
    "location: /zukan",
    `content-security-policy: script-src 'nonce-OLD'`,
    "",
    "HTTP/2 200",
    `content-security-policy: ${CSP}`,
    "",
  ].join("\r\n");
  assert.deepEqual(checkCspNonce(raw, page(NEXT_INLINE)).errors, []);
});
