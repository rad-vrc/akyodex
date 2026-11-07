#!/usr/bin/env node
/**
 * 実際に配信された HTML で、実行される script が CSP の nonce を持っているかを確かめる。
 *
 * src/middleware.test.ts は middleware が作る CSP を確かめるが、Next.js（と OpenNext）が
 * その CSP から nonce を読んで自分のインライン script に付けるところまでは見られない。
 * ステージングにデプロイした Workers が返した /zukan の応答で、そこを確かめる。
 *
 * 使い方: node scripts/verify-csp-nonce.js <curl --dump-header の出力> <HTML>
 */

const fs = require("node:fs");

// Next.js の getScriptNonceFromHeader と同じ規則（script-src で始まる最初の directive、
// なければ default-src の最初の nonce）。中身を変えるときは verify-csp-nonce.test.js で突き合わせる
const CSP_NONCE_SOURCE_REGEX = /^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/;

function getScriptNonceFromCsp(csp) {
  const directives = csp.split(";").map((d) => d.trim());
  const directive =
    directives.find((d) => d.startsWith("script-src")) ||
    directives.find((d) => d.startsWith("default-src"));
  if (!directive) return undefined;
  for (const source of directive.split(/\s+/).slice(1)) {
    const match = source.trim().match(CSP_NONCE_SOURCE_REGEX);
    if (match) return match[1];
  }
  return undefined;
}

// curl --dump-header はリダイレクトなどで複数の応答のヘッダーを並べるので、最後の応答のものを使う。
// Content-Security-Policy は複数行あっても、1 行にカンマで並べても、それぞれが別のポリシーとして
// すべて効く（CSP Level 3）。Report-Only は止めないので見ない
function getLastCspPolicies(rawHeaders) {
  const blocks = rawHeaders.split(/\r?\n\r?\n/).filter((b) => /^HTTP\//.test(b.trim()));
  const last = blocks[blocks.length - 1] ?? rawHeaders;
  return last
    .split(/\r?\n/)
    .filter((l) => /^content-security-policy:/i.test(l))
    .flatMap((l) => l.replace(/^[^:]+:\s*/, "").split(","))
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

// この確認は「ポリシーが 1 本で、script の可否を script-src（なければ default-src）が決める」形を前提にする。
// それ以外の形では、nonce が合っていても別の directive やポリシーで止まりうるので、確かめられないとして落とす
function checkPolicyShape(policy) {
  const errors = [];
  const names = policy
    .split(";")
    .map((d) => d.trim().split(/\s+/)[0]?.toLowerCase())
    .filter(Boolean);
  for (const name of new Set(names.filter((n, i) => names.indexOf(n) !== i))) {
    errors.push(`CSP に ${name} が 2 回ある（ブラウザーは最初のものだけを使う）`);
  }
  if (names.includes("script-src-elem")) {
    errors.push("CSP に script-src-elem がある（script 要素では script-src より優先される。この確認は script-src を前提にしている）");
  }
  return errors;
}

// HTML Standard の JavaScript MIME type essence（大文字小文字は区別しない）
const JAVASCRIPT_MIME_TYPE_ESSENCES = new Set([
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
]);

function stripAsciiWhitespace(value) {
  let start = 0;
  let end = value.length;
  while (start < end && " \t\n\f\r".includes(value[start])) start++;
  while (end > start && " \t\n\f\r".includes(value[end - 1])) end--;
  return value.slice(start, end);
}

// HTML Standard の「prepare the script element」の type の決め方。インラインのとき CSP の判定を
// 受ける種類（classic・module・importmap・speculationrules）を返し、data block なら null
function scriptKind(element) {
  const type = element.getAttribute("type");
  const language = element.getAttribute("language");
  if (type === "" || (type === null && (language === null || language === ""))) return "classic";
  const typeString = (type !== null ? stripAsciiWhitespace(type) : `text/${language}`).toLowerCase();
  if (JAVASCRIPT_MIME_TYPE_ESSENCES.has(typeString)) return "classic";
  if (["module", "importmap", "speculationrules"].includes(typeString)) return typeString;
  return null;
}

function checkCspNonce(rawHeaders, html) {
  const errors = [];
  const policies = getLastCspPolicies(rawHeaders);
  if (policies.length === 0) {
    return { errors: ["Content-Security-Policy ヘッダーがない"], nonce: undefined, executableInline: 0, scripts: 0 };
  }
  if (policies.length > 1) {
    return {
      errors: [`CSP のポリシーが ${policies.length} 本ある（すべてが効くので、この確認では判定できない）`],
      nonce: undefined,
      executableInline: 0,
      scripts: 0,
    };
  }
  const [csp] = policies;
  const shapeErrors = checkPolicyShape(csp);
  if (shapeErrors.length > 0) {
    return { errors: shapeErrors, nonce: undefined, executableInline: 0, scripts: 0 };
  }
  const nonce = getScriptNonceFromCsp(csp);
  if (!nonce) {
    return { errors: [`CSP から nonce を読めない: ${csp}`], nonce: undefined, executableInline: 0, scripts: 0 };
  }

  // HTML は正規表現ではなくパーサーで読む（閉じタグの書き方の揺れなどをブラウザーと同じに扱うため）。
  // jsdom は既定では script を実行しない
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM(html);
  // <template> の中身は別の文書なので querySelectorAll に出てこない（ブラウザーでも実行されない）
  const elements = [...dom.window.document.querySelectorAll("script")].filter(
    // ブラウザーは script が有効なとき <noscript> の中身を文字として扱うので、中の script は要素にならない。
    // jsdom は script を実行しない設定だと要素として読むので、ここで外す
    (element) => !element.closest("noscript")
  );
  const checked = elements.map((element) => ({
    element,
    kind: scriptKind(element),
    nonce: element.getAttribute("nonce"),
    inline: !element.hasAttribute("src"),
    empty: (element.textContent ?? "") === "",
    label: element.outerHTML.slice(0, 140),
  }));
  dom.window.close();

  let executableInline = 0;
  for (const script of checked) {
    if (script.nonce !== null && script.nonce !== nonce) {
      errors.push(`CSP と違う nonce の script がある: ${script.label}`);
      continue;
    }
    // module に対応したブラウザーは nomodule の classic script を実行しない（CSP の判定より前に抜ける）
    if (script.kind === "classic" && script.element.hasAttribute("nomodule")) continue;
    // src のある script はホストの許可で判定され、空のインライン script は実行するものがない
    if (script.kind === null || !script.inline || script.empty) continue;
    executableInline++;
    if (script.nonce === null) {
      errors.push(`nonce のないインラインの script がある（CSP で止まる）: ${script.label}`);
    }
  }
  const scripts = elements.length;

  // Next.js は必ず self.__next_f などのインライン script を出す。0 個なら HTML を読み違えている
  if (executableInline === 0) {
    errors.push("実行されるインラインの script が 1 つもない（HTML の取得か読み取りがおかしい）");
  }
  return { errors, nonce, executableInline, scripts };
}

function main(argv) {
  const [headersPath, bodyPath] = argv;
  if (!headersPath || !bodyPath) {
    console.error("使い方: node scripts/verify-csp-nonce.js <ヘッダーのファイル> <HTML のファイル>");
    return 2;
  }
  const result = checkCspNonce(fs.readFileSync(headersPath, "utf8"), fs.readFileSync(bodyPath, "utf8"));
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(`::error::${error}`);
    return 1;
  }
  console.log(
    `CSP の nonce を確認: script 要素 ${result.scripts} 個、実行されるインラインの script ${result.executableInline} 個がすべて CSP と同じ nonce を持つ`
  );
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { checkCspNonce, getScriptNonceFromCsp };
