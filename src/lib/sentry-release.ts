/**
 * Sentry のリリース名。
 *
 * 本番とステージングの Worker は、デプロイのときに git のコミット（40 桁の SHA）を版の印（tag）として付けている
 * （wrangler の --tag。X-Akyodex-Worker-Tag と同じ値）。ブラウザー・Worker の両方でこれをリリース名にし、
 * ソースマップも同じ名前で Sentry に上げる（scripts/sentry-browser-sourcemaps.js）。
 *
 * ブラウザーへは、サーバーが描く <html> の data-sentry-release で渡す。JS に埋め込むとデプロイのたびに
 * そのチャンクが変わり、再訪問した人が読み直すことになるため（HTML はもともとリクエストごとに作る）。
 *
 * このファイルはブラウザーでも読むので、Cloudflare の API には触れない（サーバー側は sentry-release-server.ts）。
 */

/** <html> に付ける属性の名前。dataset では sentryRelease */
export const SENTRY_RELEASE_ATTRIBUTE = 'data-sentry-release';

const GIT_SHA = /^[0-9a-f]{40}$/;

/** git のコミット（40 桁の小文字の 16 進）だけをリリース名として受け付ける。それ以外は undefined */
export function normalizeSentryRelease(value: unknown): string | undefined {
  return typeof value === 'string' && GIT_SHA.test(value) ? value : undefined;
}

/** Worker の CF_VERSION_METADATA（id・tag・timestamp）から、tag をリリース名として取り出す */
export function releaseFromWorkerVersion(versionMetadata: unknown): string | undefined {
  if (typeof versionMetadata !== 'object' || versionMetadata === null) {
    return undefined;
  }
  return normalizeSentryRelease((versionMetadata as { tag?: unknown }).tag);
}

/** サーバーが <html> に書いたリリース名を読む。ない・形が違うときは undefined */
export function readBrowserSentryRelease(doc: { documentElement?: { dataset?: DOMStringMap } } | undefined): string | undefined {
  return normalizeSentryRelease(doc?.documentElement?.dataset?.sentryRelease);
}
