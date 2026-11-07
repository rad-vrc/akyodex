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

// curl --dump-header はリダイレクトなどで複数の応答のヘッダーを並べるので、最後の応答のものを使う
function getLastCspHeader(rawHeaders) {
  const blocks = rawHeaders.split(/\r?\n\r?\n/).filter((b) => /^HTTP\//.test(b.trim()));
  const last = blocks[blocks.length - 1] ?? rawHeaders;
  const line = last.split(/\r?\n/).find((l) => /^content-security-policy:/i.test(l));
  return line ? line.replace(/^[^:]+:\s*/, "").trim() : undefined;
}

// type がない・JavaScript の MIME・module のものだけが実行される。application/ld+json などは data block
function isExecutable(type) {
  if (type === null) return true;
  const t = type.trim().toLowerCase();
  return t === "" || t === "module" || /^(?:text|application)\/(?:x-)?(?:javascript|ecmascript)$/.test(t);
}

function checkCspNonce(rawHeaders, html) {
  const errors = [];
  const csp = getLastCspHeader(rawHeaders);
  if (!csp) {
    return { errors: ["Content-Security-Policy ヘッダーがない"], nonce: undefined, executableInline: 0, scripts: 0 };
  }
  const nonce = getScriptNonceFromCsp(csp);
  if (!nonce) {
    return { errors: [`CSP から nonce を読めない: ${csp}`], nonce: undefined, executableInline: 0, scripts: 0 };
  }

  // HTML は正規表現ではなくパーサーで読む（閉じタグの書き方の揺れなどをブラウザーと同じに扱うため）。
  // jsdom は既定では script を実行しない
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM(html);
  const elements = [...dom.window.document.querySelectorAll("script")];
  dom.window.close();

  let executableInline = 0;
  for (const element of elements) {
    const scriptNonce = element.getAttribute("nonce");
    const body = element.textContent ?? "";
    const label = `${element.outerHTML.slice(0, 140)}`;

    if (scriptNonce !== null && scriptNonce !== nonce) {
      errors.push(`CSP と違う nonce の script がある: ${label}`);
      continue;
    }
    if (isExecutable(element.getAttribute("type")) && !element.hasAttribute("src") && body.trim() !== "") {
      executableInline++;
      if (scriptNonce === null) {
        errors.push(`nonce のないインラインの script がある（CSP で止まる）: ${label}`);
      }
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
