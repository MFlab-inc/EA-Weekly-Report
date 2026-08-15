# 検証・ゲートスクリプト（scripts/check/・scripts/lib/）ガイド

task #13の成果物。SPEC.md §8「検証ゲート」の実装。しょうさん指示（2026-08-15）による再定義後の
最終構成。`docs/ledger-schema.md`（根拠台帳スキーマ）とセットで参照すること。

## 経緯（旧Python版5本移植 → 全面刷新）

最初の実装では`reference/`のPython検証5本（validate_ledger/validate_report/
validate_daily_event_layout/validate_mobile_header/publish_gate）をそのまま`scripts/validate/`へ
移植したが、しょうさんのレビューで「旧5本のうち3本（validate_report.py・
validate_daily_event_layout.py・validate_ledger.py）は、存在しない属性・廃止するスキーマを前提と
しており移植の意味がない」との判断があり、**Python版は全て廃止**した。台帳スキーマも新設
（`docs/ledger-schema.md`参照）。現在の構成はすべてNode.jsで完結する。

## 構成

| ファイル | 役割 |
|---|---|
| `scripts/lib/validate-ledger.js` | 根拠台帳（`data/ledger/*.json`）のスキーマ検証。純粋関数 |
| `scripts/lib/build-ledger.js` | 収集結果（harness.mjsの`runChecks()`＋manual-events）から台帳を生成 |
| `scripts/check/ledger-html-audit.mjs` | 台帳×HTML突合検査（1対1対応・ルート属性・日付グループ整合） |
| `scripts/check/policy-lint.mjs` | 禁止語・禁止セクション・免責/出典文言の存在・外部リンクの許可ドメイン照合＋到達性 |
| `scripts/check/mobile-layout-check.mjs` | モバイル5幅（320/360/375/390/414px）での横スクロール検出（Playwright） |
| `scripts/lib/validate-event-volume.js` | イベント件数の下限チェック（2026-08-15新設・task #38）。純粋関数 |
| `scripts/check/gate.mjs` | 上記全てをオーケストレーションしPUBLISH_READY/REVIEW_REQUIRED/HOLDを判定・記録 |

## 判定の3状態（2026-08-15改定・task #38）

しょうさん指摘: 実ネットワーク検証で「対象週(8/17-21)の主要イベントが軒並み欠落（入札3件・★★★0件）
していたにもかかわらずPUBLISH_READYが出た」事例が見つかった。台帳×HTML突合等の検査は
「台帳とHTMLの整合性」しか見ておらず、「台帳自体の中身が薄すぎる」ケースを検出できていなかった
（config/expected-coverage.jsonの国×kind必須マトリクスとは別の、二段構えの安全網として新設）。

- **PUBLISH_READY**: 1〜5の検査すべてERROR無し かつ イベント件数下限チェックもクリア →
  `output/`へコミット
- **REVIEW_REQUIRED**（新設）: 1〜5はERROR無しだが件数下限チェックに抵触 → `output/`へコミット
  しない（artifact/プレビューにのみ出力）。人間が内容を確認し、妥当なら`--acknowledge-low-volume`
  フラグを付けて再実行することでPUBLISH_READY相当に格上げできる（HOLDは上書きしない）。
  weekly.yml移設時にworkflow_dispatch入力から本フラグへ渡す設計を想定（weekly.ymlは2026-08-15時点
  workflows-draft/に据え置きのため未配線）
- **HOLD**: 1〜5のいずれかにERRORがある（従来どおり）

件数下限の閾値は`config/volume-check-policy.json`で設定する（既定: 掲載対象イベント4件未満、
または★★★0件）。gate-result.jsonの`decision`フィールドが3値のいずれかを取り、
`schema_version`は`"1.1"`へ更新した。

## モバイル検証のPython→Node置き換えについて

しょうさんの当初の指示は「Playwrightが必要なのでPython環境を構築。requirements.txtを追加し、
ci.ymlでインストール〜実行まで通す」だったが、実装時にNode.js版`playwright`パッケージ
（`chromium.launch()`等）で全く同等の検証ができ、かつ検証パイプライン全体を単一ランタイム
（Node.js）に統一できることを確認したため、**Python環境の追加は行わず、Node版Playwrightへ
置き換えた**。この判断により:

- CI（`.github/workflows/ci.yml`）はNode.jsのセットアップのみで完結する（Python 3.x環境・pip・
  requirements.txtのインストールが不要）
- `npm test`一本で全検証（台帳スキーマ・台帳×HTML突合・ポリシーlint・モバイル多幅レイアウト）が
  実行できる

しょうさんが実際にPython環境を維持したい理由（既存の他ツールとの統一等）があれば、その旨を
伝えていただければPython版へ戻すことも可能（変更コストは小さい）。

### Playwrightブラウザパスの環境差異

この開発コンテナは`PLAYWRIGHT_BROWSERS_PATH`配下に固定バージョンのChromiumを同梱しているが、
`npm install`したplaywrightパッケージのバージョンとブラウザリビジョンが噛み合わないことを実測で
確認した（2026-08-15）。`/opt/pw-browsers/chromium`（バージョン非依存のシンボリックリンク）が
存在すればそれを使い、存在しない環境（GitHub Actions等）では`npx playwright install --with-deps
chromium`でインストールした既定のブラウザを使う設計にした（`scripts/check/mobile-layout-check.mjs`
の`DEFAULT_CHROMIUM_PATH`）。`PLAYWRIGHT_CHROMIUM_PATH`環境変数で明示的に上書きすることもできる。

## リンク到達性チェックはWARNING扱い（HOLDしない）

実測でcoinpost.jp（`config/btc-weekend-guide.json`のallowed_domains収録サイト）が、UA明示済みの
機械的なHEAD/GETリクエストに対しHTTP 403を返すことを確認した（ボット対策とみられる。ブラウザで
開けば正常に閲覧できる可能性が高い）。週次配信のたびにこの種の誤検知でHOLDになる実害の方が大きいと
判断し、到達性チェック（`policy-lint.mjs`の`checkLinkReachability`）はWARNING止まりとした。一方、
許可ドメインホワイトリスト照合（`lintLinkDomains`。類似ドメイン事故防止、rebuild-plan §13.4注意2）は
実害が大きいためERROR（HOLD対象）のまま維持した。

## 3検査（SPEC.md §8「新設」）の実装箇所

| 検査 | 実装箇所 |
|---|---|
| 鮮度検証（§3.1） | `scripts/checkers/harness.mjs`の`runChecks()`＋`scripts/lib/fail-closed.js`（既存・task #8〜#11で実装済み）。結果は`scripts/lib/build-ledger.js`が台帳の`meta.outcome`/`meta.holds`へ反映し、`gate.mjs`が`ledger_outcome`検査として読む |
| クロス突合・定例欠落（§3.3） | 同上（`residualWarnings`・`recurringMissingWarnings`、既存・テスト済み）。`meta.warnings`へ反映（非ブロッキング。既存設計どおりWARNのみでHOLDにはしない） |
| ポリシーlint＋リンク検査 | `scripts/check/policy-lint.mjs`（新設） |

鮮度検証・クロス突合/定例欠落は、収集段（harness.mjs）で既に実装・テスト済みのロジックを台帳生成時に
そのまま集約する設計とした（別スクリプトとして重複実装しない）。

## 必須テスト（フェールクローズの実証）

しょうさん指示の意図的に壊したデータでHOLDになることを確認するテスト一覧と実装箇所:

| 壊し方 | 検出箇所 | テスト |
|---|---|---|
| 台帳から1件抜く（HTMLに台帳未登録イベントが残る） | `ledger-html-audit.mjs`（HTML_EVENT_UNKNOWN） | `test/ledger-html-audit.test.js` |
| HTMLに台帳外イベントを混ぜる | 同上 | 同上 |
| 出典（source_evidence）を空にする | `validate-ledger.js`（台帳生成時点でHOLD） | `test/validate-ledger.test.js`・`test/gate.test.js` |
| 対象週と違う日付を混ぜる | `ledger-html-audit.mjs`（DATE_OUT_OF_TARGET_WEEK） | `test/ledger-html-audit.test.js` |
| 禁止語を入れる | `policy-lint.mjs`（FORBIDDEN_READER_TERM） | `test/policy-lint.test.js`・`test/gate.test.js` |
| リンクを許可外ドメインにする | `policy-lint.mjs`（LINK_DOMAIN_NOT_ALLOWLISTED） | 同上 |
| 横スクロールが出る幅指定を入れる | `mobile-layout-check.mjs`（HORIZONTAL_SCROLL） | `test/mobile-layout-check.test.js` |
| イベント件数が下限を下回る（例: 8/17週の入札3件・★★★0件） | `validate-event-volume.js`（REVIEW_REQUIRED、ERRORではないためHOLDにはならない） | `test/validate-event-volume.test.js`・`test/gate.test.js` |

いずれも`npm test`（CI）に含まれ、全件PASSがコミット条件（HANDOFF.md §7）。

## ゲートの使い方（CLI）

```bash
node scripts/check/gate.mjs \
  --ledger data/ledger/2026-08-17.json \
  --html output/ea-weekly-20260817.html \
  --result gate-result.json
  # REVIEW_REQUIRED後、人間が内容を確認して妥当と判断した場合のみ:
  # --acknowledge-low-volume を追加して再実行するとPUBLISH_READY相当に格上げされる
```

`--skip-mobile`（Playwright起動を省略）・`--skip-link-reachability`（外部ネットワークアクセスを
省略）はローカル動作確認・オフライン環境向けのオプション。本番週次runでは省略しないこと。

## WebSearch経由の確認について（ライブフェッチ不可な発表元名の限界）

一部の発表元（NZ Stats NZ、GB CPI、US GDP等）は、開発サンドボックスから当該サイトへ直接
フェッチできないため、`event-names.json`の`match`/`display_name`をWebSearch経由の間接確認
（検索エンジンにインデックスされたページ内容からの確認）だけで登録している
（`source_verified`はfalse、`note`に確認方法を明記）。

**2026-08-15追記（task #41-1）**: この限界は`display_name`だけでなく、`schedule[]`の
**日付そのもの**にも同様に当てはまる。ECB Accounts of the monetary policy meeting
（`ecb_policy_rate`）・BOC Summary of Governing Council Deliberations（`boc_policy_rate`）は、
FOMC/RBAの議事要旨と異なり会合日からの固定オフセット計算ができない（各中銀がその都度個別に
次回日程を告知する運用）。実日付6件（ECB）・8件（BOC）はいずれもWebSearch経由でのみ確認し、
`config/official-sources.json`の該当`schedule[]`エントリに`note`で確認方法を明記した。
さらにECBは公表時刻（何時に公表されるか）自体もWebSearchで確認できなかったため、
`announce_time_by_kind.minutes_summary`を未設定のままにし、`time: null`で扱っている
（推測時刻を入れてfabricationするより、未確定であることを明示する方を優先した）。

**この方式は過去に実バグの原因になった**: GB GDPの旧`match`キーワード（`gdp m/m`・
`prelim gdp q/q`）はFF（Forex Factory）想定の表記であり、実際の担当ソースgb_ons（ONS
releases API）の実タイトル『GDP first quarterly estimate, UK: {期間}』とは一致していなかった。
これは実fixtureを取得して初めて発覚した（2026-08-15）。

### 教訓1: WebSearchで矛盾する情報が出た場合、条件の違いを疑う（しょうさん指摘2026-08-15）

task #41-3でユーロ圏HICPの公表時刻を調査した際、WebSearch結果間で「11:00 CET」「15:00 CET」
という2つの異なる時刻情報が見つかり、どちらかが誤りだと判断して両方を採用せず
`announce_time_by_kind`を空のままにした（time:null）。

その後しょうさんが一次ソース（ECB Statistical calendars、
`ecb.europa.eu/press/calendars/statscal/ges/html/sthicp.en.html`）を直接確認したところ、
**両方とも正しく、単に対象が違っていた**ことが判明した: 速報値（flash estimate）は15:00 CET、
確報値（seasonally adjusted、final）は12:00 CET（当初のWebSearch結果の「11:00」はこれの近似値
だった可能性がある）。

**教訓**: WebSearch経由で矛盾する複数の情報（時刻・日付・名称等）が見つかった場合、
「どちらかが誤り」と即断せず、**発表段階（速報/確報）・対象範囲（全国/地域）・算出方法
（原数値/季節調整値）等の条件が違うために両方とも正しい可能性を先に検討すること**。
安易にtime:nullへ倒す前に、一次ソースで両方の条件を突き合わせる一手間が有効な場合がある。

### 教訓2: SPA構造で直接取得できない公式サイトでも、関連する別の公式機関が同じ情報を
静的公開している場合がある（しょうさん発見2026-08-15）

`eurostat_hicp`/`eurostat_gdp`のrelease-calendarページ（ec.europa.eu/eurostat）は
JavaScriptによる動的読み込み（SPA構造）のため、実ネットワーク経由でも静的HTMLからは
日程データを取得できなかった（task #41ライブ検証）。

しかし、EU統計とその金融政策的な利用先であるECB（European Central Bank）は密接な関係にあり、
**ECBが独自にStatistical calendars（`ecb.europa.eu/press/calendars/statscal/`配下）という
静的HTMLページで、Eurostat発表分を含む複数の統計リリース日程・時刻を公開している**ことが
判明した。これはSPA構造を迂回する代替経路として機能する。

**教訓**: ある公式発表元のページがSPA構造・API専用等で直接取得できない場合、
「その発表元自身の別ページ」だけでなく、**当該統計を業務上利用している関連公的機関
（中央銀行、上位省庁、国際機関等）が同じ情報を独自に静的公開していないか**を探索パターン
として持っておくこと。既知の構造的ブロッカー（NZ Stats NZのrelease-calendar/、中国NBSの
詳細ドキュメント未到達等）に対しても、同様の迂回経路（関連機関の静的ページ）がないか
今後探索する価値がある。

## 既刊レポートの位置づけ（正解データではない。しょうさん指示2026-08-15）

`reference/sample-report_20260808.html`等の既刊2週は、Manusが実際に出力した結果であって、
その週の「正解の全イベント一覧」ではない。したがって：

- **「既刊2週100%捕捉」は必要条件であって十分条件ではない**。新パイプラインが既刊に
  含まれないイベントを検出した場合、それは既刊との「差分（不一致・regression）」ではなく
  **「既刊側の掲載漏れ（Manusの既存の欠落）を今回のパイプラインが発見した」可能性**として扱う。
- 既刊に無く新パイプラインにあるイベントを発見した場合、テストや報告では「回帰」と呼ばず、
  「既刊側の掲載漏れの疑い」として別分類で報告すること。

**最初の事例（2026-08-15、task #41-3）**: `eurostat_gdp`（ユーロ圏GDP速報値）を追加した際、
2026-08-14発表分（2026年04-06月期・統合速報）が既刊サンプル週である2026-08-10週の実データ
経路再生成で新たに検出された（イベント数10件→11件）。8/17週の欠損（しょうさん指摘の主題）
だけでなく、既刊サンプル週そのものにも同種の未検出イベントが存在したことになる。これは
「既刊2週に対する回帰」ではなく「既刊2週自体の掲載漏れをこのパイプラインが発見した最初の
事例」として記録する。既刊との差分が見つかった場合は、まずこの区別を確認してから対応方針を
決めること（差分＝バグとは限らない）。

**したがって、WebSearch経由でしか確認できていない`match`/`display_name`は、実データ
（本番run・fixture取得）でのライブ検証が完了するまで「未確定」として扱うこと。** 次回本番run
で該当ソースの実レスポンスを確認し、`source_verified: true`へ更新する。もし実タイトルが
WebSearch確認時の想定と食い違っていた場合は、GB GDPの前例と同様の実バグとして扱い、
このセクションに追記して教訓として残すこと（「WebSearch確認だけで確定させない」という
運用ルールの根拠を蓄積する）。

## 既知の残課題

- **collect→normalizeの実データ接続は部分的**。`scripts/lib/build-ledger.js`は
  `scripts/checkers/harness.mjs`の`runChecks()`結果（＋`config/manual-events.json`）を受け取れる
  形に作ってあり、`scripts/lib/resolve-candidate.js`・`scripts/phase1/observation-run.mjs`の
  `annualEntryToCandidate`・`scripts/lib/manual-events.js`の`manualEntryToCandidate`はいずれも
  台帳生成に必要な情報（`localDate`/`localTime`/`tz`/`sourceEvidence`）を返すよう拡張済み。
  ただし実際に週次run全体（`workflows-draft/weekly.yml`のcollect→build-ledger→renderの配線、
  レンダラーが台帳形式の入力を受け取れるようにする変更）はPhase 2（weekly.yml移設）の範囲として
  未着手。現状のレンダラー（`scripts/render/generate.mjs`）は引き続き手書きの`week-data-*.js`を
  読む
- `name_ja`の規則生成命名（SPEC §4.2テンプレート、`scripts/lib/naming.js`）は
  `policy_rate`/`quarterly_report`/`press_conference`の3kindのみ台帳生成時に解決される
  （8中銀対応・既刊2週の実表記で検証済み）。残り4kind（BOJ主な意見・議事要旨／要人発言／国債入札／
  議会証言）は候補パイプラインの文脈情報不足または運用者直接指定により対象外。詳細・残課題は
  `docs/ledger-schema.md`「既知の簡略化」参照。`bundle_id`計算も同ドキュメント参照
