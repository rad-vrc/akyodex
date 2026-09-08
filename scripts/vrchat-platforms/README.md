# 対応機種カテゴリの取得と付与

`対応機種/PC`・`対応機種/Quest(Android)`・`対応機種/iOS` の元になったデータと、
それを作った手順を残してある。**通常の運用では動かさない。** 新しい Akyo の対応機種は
管理画面のカテゴリ欄で手入力する。

大量に取り直す必要が出たとき（たとえば作者が後から Quest 版を上げた分をまとめて反映したい、
といった場合）だけ、ここを使う。

## ファイル

| | |
|---|---|
| `fetch-platforms.mjs` | VRChat API から `unityPackages[].platform` を集めて `platforms.json` を作る |
| `apply-platform-categories.mjs` | `platforms.json` をもとに日本語 CSV の Category 列へ付与する |
| `platforms.json` | 2026-09-08 に取得した結果。949 件ぶんの判定根拠 |

## impostor を除外している理由

VRChat は **PC のみでアップロードされたアバターにも Quest / iOS 用の impostor（自動生成の
代替モデル）を作る**。`unityPackages[].platform` をそのまま数えると、ほぼ全件が「対応」に
見えてしまう。実際 2026-09-08 の取得では Quest が 870 件、iOS が 824 件に見えていた。

impostor は `variant === "impostor"` と `impostorizerVersion` の有無で判別できる。これを
除くと Quest 517 件、iOS 66 件になった。作者が実際に上げたビルドの `variant` は `security`
または `standard` で、どちらも対応機種として数える。

判定はオーナー所有の 10 件（0064〜0068 / 0732 / 0744 / 0761 / 0870 / 0912）で突き合わせ、
10/10 一致することを確認した。0732 だけ iOS 非対応で、その iOS は impostor のみだった。

参考: https://creators.vrchat.com/avatars/avatar-impostors/

## 使い方

VRChat の auth クッキーが要る。**値はコマンドに書かず、環境変数から渡す。**
スクリプトは値を表示も保存もしない。

```powershell
$env:VRCHAT_AUTH_COOKIE = Read-Host "auth クッキーの値" -MaskInput; node scripts/vrchat-platforms/fetch-platforms.mjs data/akyo-data-ja.csv scripts/vrchat-platforms/platforms.json; Remove-Item Env:\VRCHAT_AUTH_COOKIE
```

クッキーは vrchat.com にログインした状態で、DevTools → Application → Cookies → `auth` から取る。

取得できたら付与する。

```powershell
node scripts/vrchat-platforms/apply-platform-categories.mjs data/akyo-data-ja.csv scripts/vrchat-platforms/platforms.json --dry-run
```

`--dry-run` を外すと書き込む。そのあと EN/KO CSV と JSON を作り直す。

```powershell
node scripts/sync-akyo-data-en-from-ja.js; node scripts/generate-ko-data.js; npm run data:convert; npm run categories:canonical
```

## VRChat のガイドラインに沿っている点

https://hello.vrchat.com/creator-guidelines

- User-Agent で名乗る（`akyodex-platform-backfill/1.0 (+https://akyodex.com)`）
- 固定間隔で叩かない（1.2 秒 + ジッター）
- エラー時はバックオフする（429 / 5xx で指数バックオフ、最大 5 回）
- キャッシュする（結果を書き出し、再実行時は取得済みを飛ばす）
- 他人の代理で動かない（**オーナー本人のアカウントで、本人の PC から**実行する。
  Worker やサーバーから訪問者の代理で叩かないこと）

## 判定できなかったもの

`platforms.json` に `status: 404` で残っている個体は、非公開化または削除済み。
これらには対応機種カテゴリを付けない。2026-09-08 時点では 0552（シャトルAkyo）と
0673（Agyo）の 2 件。

`source` に `manual` と書かれている記録は API ではなくオーナーの申告によるもの。
