# app-itonami-organism-viz — Organism Viz

organism の生きている度合い A(t) = ⟨M,D,C,P,G⟩ を、合計値にせず 5 つのまま計算します。観察サイクルの軸の表、cell の数、恒常性の範囲（ideal state）との照合、剪定候補の報告を手元で扱います。

Tauri **3.0.0-alpha.6** の独立 app（`tauri-runtime-wry`、OS の WebView）と、同じファイルの static Web ビルドです。記録はすべてこの端末の中（localStorage、key `itonami.organism-viz.v1`）に保存し、外部へは通信しません。外部操作の宣言もありません（`dist/descriptor.json` の `operations: []`）。保存に失敗したときは画面に表示します。

## できること

| 操作 | 内容 |
| --- | --- |
| 観察サイクルを記録 (recordCycle) | 観察の本文を貼り付けます。／ 1 ／ **Motion** ／ 7 / 10 ／ の形の行を軸として読みます。 |
| aliveness を計算 (computeAliveness) | M は記録したサイクルの軸の変化、C は軸どうしの相関から計算します。D・P・G は入力した数から計算します。合計値は出しません。 |
| 範囲と照合 (checkIdealState) | symbol は listRanges で確認できます（例: v_adr、n_cells）。 |
| cell を評価 (assessCell) | — |
| app を評価 (assessApp) | — |
| 範囲の一覧 (listRanges) | — |
| 剪定候補の報告 (pruningReport) | app はそれを消しません。候補を並べるだけで、消すかどうかは人が決めます。 |

記録（collection）: `cloud.itonami.apps.organismViz.aliveness`、`cloud.itonami.apps.organismViz.cycle`、`cloud.itonami.apps.organismViz.pruningCandidate`

## 補足

- `src/domain/organism.ts` は `src/itonami_organism_viz/{aliveness,ideal_state,pruning}.cljk` の純粋な関数の移植で、テストも同じ値で移しました。
- 旧ツールは monorepo の checkout を走査していました（観察ファイル、cell、app）。この app にはファイルを読む権限がないので、観察サイクルの本文・cell の数・剪定候補の事実は入力します。
- 丸めは cljs 版と同じ方法（先に 10^n 倍してから偶数丸め）です。2.675 のように 10^n 倍がちょうど .5 になる値では、Python の `round` と結果が違います（2.68 と 2.67）。
- Python 版（`src/itonami_organism_viz/*.py`、`Dockerfile`、`pyproject.toml`）、旧 Svelte UI（`web/`）、`.cljk` の原本は残しています。`package.json` は Tauri app 用に置き換えたので、旧 `kbb` の test script はなくなりました。

## 構成

| パス | 役割 |
| --- | --- |
| `src/domain/` | domain logic（TypeScript）。ビルド時に Node の type stripping で JS にします（bundler・依存なし） |
| `src/local-store.js` | この端末内の record store。domain が使う `read` / `write` を localStorage で実装 |
| `src/app-def.js` | 画面の操作と domain 関数・collection の対応 |
| `src/ui/` | 依存なしの UI。DOM はテキストノードだけで組み、HTML 文字列を使いません（CSP `style-src 'self'`） |
| `vendor/` | kotoba-lang/kotoba の `kotoba-client-runtime.js` / consent CSS と `PINS.json`。`scripts/build.mjs` が digest のずれで失敗します |
| `src-tauri/` | Tauri v3 host。read-only command は `awai_host_info` の 1 つだけ。filesystem・network・shell・installer 権限なし |
| `web/` | 旧 Svelte UI。この app のビルド・テストでは使いません |

## コマンド

```sh
npm ci
npm test              # build してから domain と local-only のテスト（local-only.test.mjs, organism-viz.test.ts）
npm run build         # dist/ と SHA-256 の release.json
npm run build:desktop # native desktop 実行ファイル（bundle・署名なし）
```

## 状態と制限（AWAI-3079, 2026-11-17）

- 旧構成（Cloudflare Worker の XRPC dispatcher / adapter、`wrangler.jsonc`、`@etzhayyim/sdk`）は削除しました。履歴は git にあります。
- 検証済み: `npm test`、`npm run build`、`cargo check`（Tauri 3.0.0-alpha.6）。
- 未検証: native window の起動、`tauri build`、Android、署名、配布。アイコンは app-soshiki の仮アイコンです。

## Android（Itonami Store）

AWAI-3502 で Android 版を加えました。Store の ID は `network.itonami.organismviz` です。

- `npm run build:android`（`scripts/android-apk.sh`）が、`tauri android build --debug --apk --target aarch64` で APK を作り、SHA-256 を表示します。Android SDK・NDK 27・JDK 21・Rust の `aarch64-linux-android` が要ります。
- 出力は `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`（約 20 MB、手元の Android debug 鍵で署名）です。
- manifest に `INTERNET` 権限はありません。OS が app の通信をすべて止めます。
- ネイティブライブラリは 16 KB 境界にそろえ（Android 15 以降の 16 KB ページ）、debug 情報を除いています。画面はシステムバーと切り欠きを避け、明暗の配色に合わせます。
- Store への掲載は network-awai/awai-os の `android/local-apps.json` と `build.py --local-apps-dir` で行います。
- 確認済み: APK の作成、パッケージ名・権限・署名・16 KB 境界の確認。エミュレータでの起動は awai-os 側の記録を見てください。実機・署名済みの配布は未確認です。
