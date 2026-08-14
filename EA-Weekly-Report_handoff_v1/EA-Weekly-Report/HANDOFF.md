# HANDOFF.md — Claude Code への引き継ぎ書

作成: Claude Chat（2026-08-13）／依頼者: しょうさん（MFlab-inc）
本リポジトリは **EAユーザー向け週次レポート（毎週土曜配信・WordPress掲載）の完全自動生成システム** を新規構築するためのもの。台本フェーズ（仕様・デザイン・決定事項）は完了済み。Claude Codeの役割は実装・実測検証・並行運用検収である。

## 0. 読む順番

1. 本書（HANDOFF.md）
2. `SPEC.md` — 仕様正本v2.0（実装の唯一の正）
3. `docs/rebuild-plan_v0.3.md` — 決定の経緯・実測結果・理由（背景理解用）
4. `templates/design-mock_v1.2.html` — デザイン契約（レンダラーはこの見た目を再現する）
5. `reference/` — 旧環境（Manus）の資産。検証スクリプトの移植元とテストフィクスチャ

## 1. ミッション（Definition of Done）

GitHub Actionsのみで毎週土曜08:06 JSTに以下が全自動で完了する状態:
収集（みんかぶ＋Forex Factory）→ 正規化・台帳生成 → 機械検査 → HTML生成（WordPress断片＋Pagesプレビュー）→ 検証ゲート → `output/ea-weekly-YYYYMMDD.html` コミット。検証不合格時はHOLD（run失敗＋`hold-report.json`、outputは未更新）。

**検収基準（すべて必須）**
1. `reference/sample-report_20260808.html` に掲載された全イベント（8/3週・8/10週の2週分）を、新パイプラインが対象週指定で100%捕捉できる（イベント名・日時・重要度の一致。名称は新命名規則での同定で可）
2. 停止目安（4〜12時間前）の計算がSPEC §5の全ケース（前日跨ぎ・週明け特例・発表枠束ね・時刻未公表除外）で正しい（単体テスト必須）
3. レンダリング結果が `templates/design-mock_v1.2.html` と構造・スタイル一致（数値・イベントは週データ差し替え）。モバイル幅320/360/375/390/414pxで横スクロールが発生しない
4. 検証ゲート全PASS／意図的に壊したデータでHOLDが機能する（フェールクローズ確認）
5. 数値表示トグル（`config/report-policy.json` の `show_prev_forecast`）ON/OFF両方で正常レンダリング
6. 現行配信（Manus）との並行運用1〜2週で内容突合し、しょうさんが検収OKを出す

## 2. 実装順（推奨）

- **Phase 0（実測・半日想定）**: 下記「要実測項目」を先に潰す。結果は `docs/phase0-findings.md` に記録
- **Phase 1**: `scripts/` 実装（collect→ledger→check→render）。言語: 収集・生成はNode.js（標準ライブラリ優先）、検証はPython（`reference/fx-ea-report-auditor-skill/scripts/` の5本を移植）
- **Phase 1.5**: 検証新設3本（鮮度・突合/欠落・ポリシーlint＋リンク到達性/ドメインホワイトリスト）
- **Phase 2**: `workflows-draft/weekly.yml` を `.github/workflows/` へ移設・有効化 → テスト週生成 → 並行運用

## 3. Phase 0 要実測項目（SPECの未確定を確定させる）

| # | 項目 | 合否基準・備考 |
|---|---|---|
| 1 | みんかぶ `?date=<対象週月曜>` の取得 | 静的HTMLで対象週7日分（月〜日）・「データ取得時間」が取れること。★の表現方法（img alt/class等）を特定し★5→★3マッピング（config仮置き）を既刊2週で校正 |
| 2 | FF週次JSONの土曜時点での翌週分可用性 | `nextweek.json` 404の既知情報あり（rebuild-plan §4.3）。thisweekの週境界切替タイミングを実測。取れない場合の代替をSPEC §3.4の優先順で確定 |
| 3 | FFフィードの発言・会見・証言・入札の収録確認 | 既刊2週の該当イベントがFFに存在するか突合（検収基準1の前提） |
| 4 | みんかぶ・FFの利用条件 | 自動取得・転載可否。**みんかぶへの許諾確認はしょうさんのタスク（進行中）**。結果が出るまで `show_prev_forecast` は実装上ON/OFF両対応で作る |
| 5 | `config/officials.json` の現職者名 | 全役職を公式サイトで照合し `verified: true` に更新。未検証のままの役職は人名を出さず役職のみ命名（SPEC §4.3のフォールバック） |

## 4. 制約・禁止事項（厳守）

1. **fxshihyo.com の自動取得は行わない**（robots.txt不許可を実測済み。rebuild-plan §12.2）。読者向けリンク掲載は可
2. **Alternative.me は使用しない**（しょうさんの既存パイプラインでの禁止ソース）
3. Manus依存（`manus-config`・`/home/ubuntu/`固定パス・`expose`）は一切持ち込まない。referenceの旧コードを移植する際は必ず除去
4. しょうさんの既存リポジトリ（FXDaily-Levels / EA-Risk-Monitor / CFTC-COT ほか）には一切触れない
5. 読者向け表記: 「JST」禁止（「日本時間」）、英語イベント名禁止、市況サマリー・相場展望・価格一覧の禁止（SPEC §6.6）
6. アクセスマナー: 取得間1500ms・UA明示・週次のみ・キャッシュ優先の冪等設計（SPEC §3.6）
7. 語「仮想通貨」は自筆テキストで使用しない（「暗号資産」を使用）。外部サイトの正式名称の引用のみ例外
8. Secrets・口座情報・EA仕様は本リポジトリに置かない（本リポジトリはPublic運用前提。現状の同梱物はすべて公開可の情報のみ）

## 5. 検証スクリプト移植の方針

`reference/fx-ea-report-auditor-skill/scripts/`（validate_ledger / validate_report / publish_gate）と `reference/ea-weekly-report-skill/scripts/`（validate_daily_event_layout / validate_mobile_header ほか）を `scripts/validate/` へ移植する。**検証観点は維持し、期待するHTML構造・data-ea-*属性は新レイアウト（ea-only-v4、templates/design-mock_v1.2.html準拠）に更新**する。維持すべき観点: 台帳整合／禁止タグ・外部JS・トラッキング検出／禁止セクション検出／日付別カード構造／モバイル多幅レイアウト（Playwright）／PUBLISH_READY判定のフェールクローズ。

## 6. しょうさんの運用（実装が満たすべきUX）

- 土曜朝: Pagesプレビューで「配信可」表示と見た目を確認 → `output/ea-weekly-YYYYMMDD.html` をGitHub Raw表示 → 全選択コピー → WordPress貼り付け（約5分）
- HOLD時: Actions失敗通知メール → プレビューの保留表示と `hold-report.json` の理由を確認 → 解消後にworkflow_dispatchで手動再実行
- しょうさんはコマンドラインを使わない（GitHub Web UI操作のみ）。セットアップ・運用手順書は画面手順ベースで `docs/setup-guide.md` として作成すること

## 7. 進め方のルール

- 疑問が出たら推測で埋めず、SPECの該当節を根拠に判断。SPECにない事項は `docs/open-questions.md` に記録してしょうさんに確認
- 単体テスト先行（停止目安計算・日付境界・マッピングは特に）。テストは `test/` に置き、全件PASSをコミット条件とする
- こまめにコミット。Phase完了ごとに動作サマリーを `docs/` に残す
