#!/usr/bin/env node
/**
 * 配信された HTML で、実行されるインラインの script が CSP の nonce を持っているかを確かめる。
 * ステージングにデプロイした Worker が返した /zukan で使う。
 *
 * src/middleware.test.ts は middleware が作る CSP の中身（script-src の許可、script-src-elem がないことなど）を
 * 確かめるが、Next.js（と OpenNext）がその CSP から nonce を読んで自分のインライン script に付けるところまでは
 * 見られない。ここではそこだけを見る。
 *
 * 扱うのは、このサイトの HTML に出る形だけ（type なし・JavaScript・module の script と、JSON-LD などの
 * data block）。HTML は正規表現ではなく parse5 で読む（閉じタグの書き方の揺れなどをブラウザーと同じに扱う）。
 *
 * 使い方: node scripts/verify-csp-nonce.js <curl --dump-header の出力> <HTML>
 */

const fs = require("node:fs");
const { parse } = require("parse5");

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

// 実行される script の type（このサイトで使う形）。それ以外は data block として扱う
const EXECUTABLE_TYPES = new Set(["", "text/javascript", "application/javascript", "module"]);

const attribute = (node, name) => node.attrs?.find((a) => a.name === name)?.value ?? null;
const textOf = (node) => (node.childNodes ?? []).map((c) => (c.nodeName === "#text" ? c.value : "")).join("");

// parse5 は script を実行しない。<template> の中身（content）は別の文書なので、たどらない
function collectScripts(node, found = []) {
  if (node.nodeName === "script") found.push(node);
  for (const child of node.childNodes ?? []) collectScripts(child, found);
  return found;
}

function checkCspNonce(rawHeaders, html) {
  const csp = getLastCspHeader(rawHeaders);
  if (!csp) return { errors: ["Content-Security-Policy ヘッダーがない"], executableInline: 0, scripts: 0 };
  const nonce = getScriptNonceFromCsp(csp);
  if (!nonce) return { errors: [`CSP から nonce を読めない: ${csp}`], executableInline: 0, scripts: 0 };

  const errors = [];
  const scripts = collectScripts(parse(html));
  let executableInline = 0;
  for (const script of scripts) {
    const scriptNonce = attribute(script, "nonce");
    const label = `<script ${(script.attrs ?? []).map((a) => `${a.name}="${a.value}"`).join(" ")}>${textOf(script).slice(0, 60)}`;
    // ページに渡す x-nonce が CSP とずれていないか（data block でも見る）
    if (scriptNonce !== null && scriptNonce !== nonce) {
      errors.push(`CSP と違う nonce の script がある: ${label}`);
      continue;
    }
    const type = attribute(script, "type");
    const executable = type === null || EXECUTABLE_TYPES.has(type.trim().toLowerCase());
    if (!executable || attribute(script, "src") !== null || textOf(script) === "") continue;
    executableInline++;
    if (scriptNonce === null) errors.push(`nonce のないインラインの script がある（CSP で止まる）: ${label}`);
  }
  // Next.js は必ず self.__next_f などのインライン script を出す。0 個なら HTML を読み違えている
  if (executableInline === 0) {
    errors.push("実行されるインラインの script が 1 つもない（HTML の取得か読み取りがおかしい）");
  }
  return { errors, executableInline, scripts: scripts.length };
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
