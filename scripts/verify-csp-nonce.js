#!/usr/bin/env node
/**
 * 実際に配信された HTML で、実行される script が CSP の nonce を持っているかを確かめる。
 *
 * src/middleware.test.ts は middleware が作る CSP を確かめるが、Next.js（と OpenNext）が
 * その CSP から nonce を読んで自分のインライン script に付けるところまでは見られない。
 * ステージングにデプロイした Workers が返した /zukan の応答で、そこを確かめる。
 *
 * 確かめられるのは「CSP のポリシーが 1 本で、script の可否を script-src（なければ default-src）が
 * 決め、HTML の script 要素がこの文書の HTML の script だけ」の形に限る。ほかの形（複数のポリシー、
 * script-src-elem・script-src-attr、<meta> の CSP、SVG の script、srcdoc の iframe、ブラウザーで
 * 扱いが分かれる type）は、nonce が合っていても止まりうるので「判定できない」として落とす。
 *
 * 使い方: node scripts/verify-csp-nonce.js <curl --dump-header の出力> <HTML>
 */

const fs = require("node:fs");
const { parse } = require("parse5");

// Next.js の getScriptNonceFromHeader と同じ規則（script-src で始まる最初の directive、
// なければ default-src の最初の nonce）。中身を変えるときは verify-csp-nonce.test.js で突き合わせる。
// 「script-src で始まる」は script-src-elem・script-src-attr にも当たるが、それらがある CSP は
// checkPolicyShape で先に落とすので、ここに来るときは script-src そのものだけに当たる
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

function checkPolicyShape(policy) {
  const errors = [];
  const names = policy
    .split(";")
    .map((d) => d.trim().split(/\s+/)[0]?.toLowerCase())
    .filter(Boolean);
  for (const name of new Set(names.filter((n, i) => names.indexOf(n) !== i))) {
    errors.push(`CSP に ${name} が 2 回ある（ブラウザーは最初のものだけを使う）`);
  }
  // script-src-elem は script 要素で、script-src-attr はイベントハンドラ属性で script-src より優先される。
  // 名前が script-src で始まるほかの directive も、Next.js の nonce の読み取りが拾ってしまう
  for (const name of new Set(names.filter((n) => n.startsWith("script-src") && n !== "script-src"))) {
    errors.push(`CSP に ${name} がある（この確認は script-src だけで判定する前提）`);
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
const SPECIAL_SCRIPT_TYPES = ["module", "importmap", "speculationrules"];

const ASCII_WHITESPACE = " \t\n\f\r";
function stripAsciiWhitespace(value) {
  let start = 0;
  let end = value.length;
  while (start < end && ASCII_WHITESPACE.includes(value[start])) start++;
  while (end > start && ASCII_WHITESPACE.includes(value[end - 1])) end--;
  return value.slice(start, end);
}

const HTML_NS = "http://www.w3.org/1999/xhtml";

function attribute(node, name) {
  const found = node.attrs?.find((a) => a.name === name);
  return found ? found.value : null;
}

function textOf(node) {
  return (node.childNodes ?? []).map((c) => (c.nodeName === "#text" ? c.value : "")).join("");
}

// HTML Standard の「prepare the script element」の type の決め方。インラインのとき CSP の判定を
// 受ける種類（classic・module・importmap・speculationrules）を返し、data block なら null。
// 前後に空白のある module などはブラウザーで扱いが分かれる（Chromium 141 は実行しない）ので "ambiguous"
function scriptKind(node) {
  const type = attribute(node, "type");
  const language = attribute(node, "language");
  if (type === "" || (type === null && (language === null || language === ""))) return "classic";
  const raw = type !== null ? type : `text/${language}`;
  const typeString = stripAsciiWhitespace(raw).toLowerCase();
  if (JAVASCRIPT_MIME_TYPE_ESSENCES.has(typeString)) return "classic";
  if (SPECIAL_SCRIPT_TYPES.includes(typeString)) return raw.toLowerCase() === typeString ? typeString : "ambiguous";
  return null;
}

// parse5 は既定で「script が有効」の読み方をする（ブラウザーと同じく <noscript> の中身は文字になる）。
// script は実行しない。<template> の中身（content）は別の文書なので、たどらない
function collect(node, found) {
  if (node.nodeName === "script") found.scripts.push(node);
  if (node.nodeName === "meta" && (attribute(node, "http-equiv") ?? "").toLowerCase() === "content-security-policy") {
    found.metaCsp++;
  }
  if (node.nodeName === "iframe" && attribute(node, "srcdoc") !== null) found.srcdoc++;
  for (const child of node.childNodes ?? []) collect(child, found);
  return found;
}

function checkCspNonce(rawHeaders, html) {
  const fail = (errors) => ({ errors, nonce: undefined, executableInline: 0, scripts: 0 });
  const policies = getLastCspPolicies(rawHeaders);
  if (policies.length === 0) return fail(["Content-Security-Policy ヘッダーがない"]);
  if (policies.length > 1) {
    return fail([`CSP のポリシーが ${policies.length} 本ある（すべてが効くので、この確認では判定できない）`]);
  }
  const [csp] = policies;
  const shapeErrors = checkPolicyShape(csp);
  if (shapeErrors.length > 0) return fail(shapeErrors);
  const nonce = getScriptNonceFromCsp(csp);
  if (!nonce) return fail([`CSP から nonce を読めない: ${csp}`]);

  // HTML は正規表現ではなくパーサーで読む（閉じタグの書き方の揺れなどをブラウザーと同じに扱うため）
  const found = collect(parse(html), { scripts: [], metaCsp: 0, srcdoc: 0 });
  const errors = [];
  if (found.metaCsp > 0) {
    errors.push("HTML に <meta> の CSP がある（ヘッダーとは別に効くので、この確認では判定できない）");
  }
  if (found.srcdoc > 0) {
    errors.push("srcdoc の iframe がある（中の script にも CSP が効くが、この確認は見ない）");
  }

  let executableInline = 0;
  for (const script of found.scripts) {
    const label = `<script ${(script.attrs ?? []).map((a) => `${a.name}="${a.value}"`).join(" ")}>${textOf(script).slice(0, 60)}`;
    if (script.namespaceURI !== HTML_NS) {
      errors.push(`SVG などの script がある（HTML の script と判定が違うので、この確認では判定できない）: ${label}`);
      continue;
    }
    const scriptNonce = attribute(script, "nonce");
    if (scriptNonce !== null && scriptNonce !== nonce) {
      errors.push(`CSP と違う nonce の script がある: ${label}`);
      continue;
    }
    const kind = scriptKind(script);
    if (kind === "ambiguous") {
      errors.push(`ブラウザーで扱いが分かれる type の script がある（この確認では判定できない）: ${label}`);
      continue;
    }
    // module に対応したブラウザーは nomodule の classic script を実行しない（CSP の判定より前に抜ける）
    if (kind === "classic" && attribute(script, "nomodule") !== null) continue;
    // data block は実行されない。src のある script はホストの許可で判定される。
    // 中身が空のインライン script は何もしない（空白だけなら CSP の判定を受ける）
    if (kind === null || attribute(script, "src") !== null || textOf(script) === "") continue;
    executableInline++;
    if (scriptNonce === null) {
      errors.push(`nonce のないインラインの script がある（CSP で止まる）: ${label}`);
    }
  }

  // Next.js は必ず self.__next_f などのインライン script を出す。0 個なら HTML を読み違えている
  if (executableInline === 0) {
    errors.push("実行されるインラインの script が 1 つもない（HTML の取得か読み取りがおかしい）");
  }
  return { errors, nonce, executableInline, scripts: found.scripts.length };
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
