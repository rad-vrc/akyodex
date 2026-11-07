const assert = require("node:assert/strict");
const test = require("node:test");

const { getScriptNonceFromHeader } = require("next/dist/server/app-render/get-script-nonce-from-header");
const { checkCspNonce, getScriptNonceFromCsp } = require("./verify-csp-nonce");

const NONCE = "AbCd+/EfGh0123456789==";
const CSP = `default-src 'self'; script-src 'self' https://udify.app 'nonce-${NONCE}'; style-src 'self' 'unsafe-inline'`;
const headers = (csp) => {
  const lines = ["HTTP/2 200", "content-type: text/html; charset=utf-8"];
  if (csp !== undefined) lines.push(`content-security-policy: ${csp}`);
  return `${lines.join("\r\n")}\r\n\r\n`;
};
const page = (...scripts) => `<!DOCTYPE html><html><head></head><body>${scripts.join("")}</body></html>`;
const NEXT_INLINE = `<script nonce="${NONCE}">(self.__next_f=self.__next_f||[]).push([0])</script>`;

test("nonce の読み取りは Next.js の getScriptNonceFromHeader と同じ結果になる", () => {
  for (const csp of [
    CSP,
    `default-src 'self' 'nonce-${NONCE}'`,
    `script-src 'self' nonce-${NONCE}`,
    `script-src 'self' 'nonce-${NONCE}A'`,
    `default-src 'self'`,
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
      `<script type="application/json">{"a":1}</script>`,
      "<script></script>"
    )
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.executableInline, 1);
  assert.equal(result.scripts, 5);
});

test("nonce のないインラインの script を見つける（type なし・JavaScript・module）", () => {
  for (const extra of ["<script>self.a=1</script>", '<script type="text/javascript">self.a=1</script>', '<script type="module">self.a=1</script>']) {
    const result = checkCspNonce(headers(CSP), page(NEXT_INLINE, extra));
    assert.equal(result.errors.length, 1, extra);
    assert.match(result.errors[0], /nonce のないインラインの script/, extra);
  }
});

test("CSP と違う nonce の script を見つける（data block でも）", () => {
  for (const extra of [
    `<script nonce="OTHER">self.x=1</script>`,
    `<script type="application/ld+json" nonce="OTHER">{}</script>`,
  ]) {
    const result = checkCspNonce(headers(CSP), page(NEXT_INLINE, extra));
    assert.equal(result.errors.length, 1, extra);
    assert.match(result.errors[0], /CSP と違う nonce/);
  }
});

test("HTML はブラウザーと同じに読む（大文字のタグ・属性付きの閉じタグ・コメントの中）", () => {
  assert.equal(checkCspNonce(headers(CSP), page(NEXT_INLINE, "<SCRIPT>self.a=1</SCRIPT>")).errors.length, 1);
  assert.equal(checkCspNonce(headers(CSP), page(NEXT_INLINE, '<script>self.b=1</script foo="bar">')).errors.length, 1);
  assert.deepEqual(checkCspNonce(headers(CSP), page(NEXT_INLINE, "<!-- <script>self.c=1</script> -->")).errors, []);
});

test("CSP がない・nonce を読めない・インラインの script がないときは失敗する", () => {
  assert.match(checkCspNonce(headers(undefined), page(NEXT_INLINE)).errors[0], /ヘッダーがない/);
  assert.match(checkCspNonce(headers(`script-src 'self'`), page(NEXT_INLINE)).errors[0], /nonce を読めない/);
  assert.match(checkCspNonce(headers(CSP), page()).errors[0], /1 つもない/);
});

test("リダイレクトをはさんだときは最後の応答の CSP を使う", () => {
  const raw = ["HTTP/2 308", "location: /zukan", `content-security-policy: script-src 'nonce-OLD'`, "", "HTTP/2 200", `content-security-policy: ${CSP}`, ""].join("\r\n");
  assert.deepEqual(checkCspNonce(raw, page(NEXT_INLINE)).errors, []);
});
