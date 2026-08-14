---
name: ea-weekly-report
description: EA（自動売買）ユーザー向けの週次レポートを自動生成するスキル。毎週土曜日にスケジュール設定された時刻で実行する。日付計算・一次情報に基づく根拠台帳・市況データ収集・HTML生成・配信保留ゲート・プレビュー発行までの一連の手順を定義。
---

# EA週次レポート生成手順

このスキルは、EAユーザー向け週次レポート（毎週土曜日・スケジュール設定時刻に実行）の生成手順を定義します。
自動スケジュール実行時、または手動実行時に必ずこの手順に従ってください。

## STEP 1: 日付計算とカレンダーデータ収集

翌週の日付を動的に計算し、fxshihyo.comから指標データを収集します。

1. **日付計算スクリプトの実行**
   ```bash
   python3 /home/ubuntu/skills/ea-weekly-report/scripts/get_next_week_dates.py
   ```
   ※ このスクリプトは、実行日の曜日から「翌週月曜日〜金曜日」の日付を自動計算し、JSON形式で出力します。

2. **指標データの収集**
   スクリプトが出力した `dates_yyyymmdd`（5日分）の各日付について、`https://fxshihyo.com/ar/day{YYYYMMDD}.php` にアクセスし、経済指標・要人発言を収集します。

3. **calendar_weekly.md の確定保存（恒久運用・必須）**
   収集したデータから「★★」以上のイベントを全件抽出し、既存構造（日付別テーブル・SECTION 04掲載推奨リスト・備考）を維持して最新データで上書きします。固定の`/home/ubuntu/projects/project-…/`パスは**一切使用してはいけません**。必ず次の順序を守ります。

   1. `manus-config config load`を実行し、最新のプロジェクト共有ファイルを取得します。
   2. `~/.manus/config/project-file/calendar_weekly.md`を更新します。対象は翌週月曜〜金曜の5日分で、fxshihyo.comから取得した★★以上の全イベントです。
   3. `manus-config config save`を実行し、更新をプロジェクト共有ファイルとして確定保存します。
   4. 再度`manus-config config load`を実行し、`~/.manus/config/project-file/calendar_weekly.md`の収集日・対象週・★★以上イベント本文が、更新内容と一致することを確認します。
   5. 一致を確認できない場合は「更新完了」と報告せず、レポート全体を**配信保留（HOLD）**とし、原因を報告します。

   完了報告には、対象週、★★以上の件数、SECTION 04掲載推奨件数、再同期確認結果を必ず含めます。日曜・月曜の関連レポートは、土曜に確定保存された最新の共有カレンダーを参照し、fxshihyo.comを原則として再取得しません。

## STEP 1.5: 根拠台帳と一次情報の検証（本文生成前・必須）

本文・HTML・市場コメントを生成する**前に**、必ず `fx-ea-report-auditor` スキルを読み、非公開の根拠台帳を作成します。台帳で未検証の項目を本文に書いてはいけません。

1. **対象期間・曜日・JSTの再計算**
   - `get_next_week_dates.py` の出力を使用し、日付・曜日を固定値や手計算に依存しません。
   - 海外イベントは、発表元の現地日時・IANAタイムゾーン・JST変換値を別々に台帳へ記録し、夏時間を日付ごとにプログラムで再計算します。

2. **根拠台帳の作成**
   ```bash
   python3 /home/ubuntu/skills/fx-ea-report-auditor/scripts/create_evidence_ledger.py \
     --target-start YYYY-MM-DD --target-end YYYY-MM-DD \
     --research-started-at 'YYYY-MM-DDTHH:MM:SS+09:00' \
     --template-path /home/ubuntu/skills/ea-weekly-report/templates/ea_weekly_report_design_master.html \
     --output /home/ubuntu/ea_weekly_evidence_ledger.json
   ```

3. **一次情報の優先と値の分離**
   - 統計・政策・国債入札・休日は、発表主体、中央銀行、統計当局、取引所、財務省などの一次情報を最優先に確認します。
   - 前回値、改定値、予想値、結果を別々に記録します。未取得値は`未公表`・`未掲載`・`該当なし`とし、推測で補完しません。
   - 為替レートには銘柄、値、時点、タイムゾーン、`NY終値`・`終盤値`・`参考値`・`遅延価格`等の定義、遅延有無を記録します。定義の異なる値を混同しません。
   - 祝日、現物市場、先物・デリバティブ、決済・短縮取引は別々に確認します。

4. **本文生成前の台帳監査**
   ```bash
   python3 /home/ubuntu/skills/fx-ea-report-auditor/scripts/validate_ledger.py \
     /home/ubuntu/ea_weekly_evidence_ledger.json --strict --require-template
   ```
   終了コードが`0`以外、または未解決の競合・未取得の重要項目がある場合は、本文生成・プレビュー公開・WordPress用完成版の納品を停止し、判定を**配信保留**とします。

## STEP 1.6: SECTION 04の日付別カード要件（恒久・必須）

「来週の注目イベント（JST）」は、横断的な時刻一覧や日付を子カードごとに反復する表現にしません。EA利用者が停止・再開判断を時系列で行えるよう、**JST日付ごとの親カードを1枚**作り、その配下に時刻順の子カードを置きます。

1. **台帳のJST項目を必須化する**
   - `report_event_ids`に載せる各イベントは、`status: verified`、`importance: 3`、一次情報URLを満たすこと。
   - 海外イベントは、`jst_datetime`（タイムゾーン付き）を記録するか、公式確認済みの`jst_date`を記録する。時刻が確定している場合は`jst_time`を`HH:MM`形式で記録する。
   - 時刻が未公表の場合も`jst_date`は必須とし、`jst_time`は設定しない。固定時刻を推測・補完してはいけない。

2. **HTML表示を日付別の親子構造にする**
   - 掲載対象があるJST日だけを古い順に並べ、親カードに日付・曜日・当日の★★★件数を一度だけ表示する。
   - 親カードには`class="ea-date-group"`、`data-ea-date-group="true"`、`data-ea-date="YYYY-MM-DD"`、`data-ea-date-event-count`を付与する。
   - 子カードには日付ラベルを重複表示せず、時刻、国・地域、イベント名、重要度、一次情報、前回・改定・予想・結果の値区分を表示する。
   - 時刻確定済みイベントはJST時刻順に並べる。時刻未公表イベントは確定時刻の後ろに置き、「時刻未公表」「会合終了次第」等の根拠に沿った注記を残す。
   - 子カードは根拠台帳と同じ`data-ea-event-id`、`data-ea-event-importance`、`data-ea-source-url`を持ち、全体コンテナには`data-ea-date-group-count`、`data-ea-event-count`、`data-ea-important-count`を付与する。

3. **本文生成前の停止条件**
   - `jst_date`を特定できない海外イベント、🟡・🔴の未解決イベント、一次情報URLがないイベントはSECTION 04へ入れてはいけない。
   - すでに発表済みとなったイベントは、JST 09:00の配信時点で公式実績へ更新する。更新できない場合は配信保留とする。

## STEP 2: 最新市況データの収集とHTML更新

1. **市況データの収集**
   根拠台帳の情報源ポリシーに従い、最新の為替レート（USD/JPY、EUR/USD、GBP/USD、AUD/USD、NZD/USD、USD/CADなど）と前週の振り返り・対象週の相場展望を収集します。発表日時・結果・政策判断は一次情報を優先し、市場終盤値・背景説明は信頼できる通信社等を用います。終値・終盤値・参考値・遅延価格を混同せず、台帳で検証済みの値だけを反映します。

2. **承認済みデザイン原本からの更新（デザイン固定）**
   - 正式なデザイン原本は `/home/ubuntu/skills/ea-weekly-report/templates/ea_weekly_report_design_master.html` です。ユーザーが承認した、濃緑のグラデーションヘッダー、`EA`ロゴ、緑のヒーローバナー、角丸カード、`SEC 01`〜`SEC 05`、濃緑フッターからなる構成を必ず維持します。
   - 作業開始時にこの原本を `/home/ubuntu/design_a_combined.html` へコピーし、当該週のデータのみを更新します。原本が存在しない、または読み込めない場合は、別デザインを新規作成・代替してはなりません。作業を停止してユーザーへ報告します。
   - **更新してよい箇所**: `作成日`、対象期間、ヒーローの週番号・要約・注目バッジ、`SEC 01`〜`SEC 05`の数値・本文・イベント、フッターの日付・出典。
   - **変更してはならない箇所**: 配色、ロゴ、ヘッダー構造、ヒーロー、カード、表、セクション構成、フッター、余白、角丸などのデザインシステム。デザインの簡略化や別配色への変更は禁止します。

### デザイン整合性の事前確認

データ更新前に、原本に `site-header`、`logo-icon`（表示文字`EA`）、`hero`、`market-card`、`SEC 01`〜`SEC 05`、`site-footer` が含まれることを確認します。これらの要素が欠ける場合、または別配色・別レイアウトへの置換が必要になる場合は、ユーザー確認なしに生成を続けてはいけません。

### スマホ用サイトヘッダーの固定仕様

サイトヘッダーは、毎週次の文言・段組みを厳守して更新します。文言の省略、結合、追加、段数変更をしないでください。

| 位置 | 表示仕様 |
|---|---|
| 左上 | `EAユーザー向け週次レポート`を1行で表示 |
| 左下1段目 | `WEEKLY ECONOMIC CALENDAR`を1行で表示 |
| 左下2段目 | `EA STOP GUIDE`を1行で表示 |
| 右上 | `WEEKLY REPORT`を1行で表示 |
| 右下 | `作成日：YYYY年M月D日（曜）`を1行で表示 |

英語サブタイトルには`&`を入れず、必ず次のHTML構造で2段表示します。

```html
<p class="header-subtitle">
  <span style="display: block; white-space: nowrap;">WEEKLY ECONOMIC CALENDAR</span>
  <span style="display: block; white-space: nowrap;">EA STOP GUIDE</span>
</p>
```

ヘッダーの各文言には`white-space: nowrap`を適用します。サイトヘッダーには`width: 100%`と`box-sizing: border-box`を適用し、左右の領域には`min-width: 0`、可変幅、可変文字サイズを使用して、狭い画面でも見切れ・重複・意図しない改行を防ぎます。

> **変更範囲の制限:** ヘッダーのレスポンシブ調整を理由に、本文、掲載情報、日付、数値、配色、セクション構成、ヒーロー、カード、表、フッターを変更してはいけません。既存HTMLを原本として、サイトヘッダー内だけを最小変更してください。

### スマホヘッダーの納品前検証

プレビュー生成後、次の検証スクリプトを実行し、ビューポート幅`320px`、`360px`、`375px`、`390px`、`414px`をすべて検証します。

```bash
python3 /home/ubuntu/skills/ea-weekly-report/scripts/validate_mobile_header.py \
  /home/ubuntu/design_a_combined.html \
  --output-dir /home/ubuntu/mobile_header_validation
```

終了コード`0`かつ`validation.json`の`all_widths_pass`が`true`であることを確認します。各幅で次の条件を満たすまで修正を続け、1件でも不合格なら納品してはいけません。

| 必須検証項目 | 合格条件 |
|---|---|
| 日本語タイトル | 1行、画面内、右側文言と非重複 |
| 英語1段目 | `WEEKLY ECONOMIC CALENDAR`と完全一致、1行、画面内 |
| 英語2段目 | `EA STOP GUIDE`と完全一致、1行、画面内 |
| 右上文言 | `WEEKLY REPORT`の末尾まで表示、1行、画面内 |
| 作成日 | 曜日まで表示、1行、画面内 |
| ヘッダー全体 | 画面外へのはみ出し、文字の重複、意図しない改行がない |
| 変更範囲 | 原本との差分がサイトヘッダー内だけである |

機械検証に加えて、最小幅`320px`のスクリーンショットを目視確認します。納品報告には、5画面幅の検証結果と「ヘッダー以外を変更していない」ことを明記してください。

## STEP 3: ビルドとプレビュー生成

1. **デザイン整合性の最終確認**
   プレビュー前に、承認済みデザインの構成要素（濃緑ヘッダー、`EA`ロゴ、緑のヒーロー、`SEC 01`〜`SEC 05`、濃緑フッター）が残っていることを目視およびHTML上で確認します。これに加え、ヘッダー変更がある場合は「変更範囲の制限」とモバイルヘッダー検証を厳守します。

2. **ビルドスクリプトの実行**
   必ず以下の順序で実行してください（順序を間違えると古いデータがWordPress用HTMLに混入します）。
   ```bash
   cd /home/ubuntu
   python3 build_preview.py
   python3 build_wordpress.py
   ```

3. **WordPress HTML・重複情報・配信可否の最終監査**
   WordPress用HTMLには、台帳と照合するための`data-ea-event-id`、JST日時、国・地域、重要度、一次情報URL、値区分、件数属性を付与します。イベントを複数セクションに掲載しても、同じイベントIDと台帳データを使い、日時・数値・重要度・件数を一致させます。

   ```bash
   python3 /home/ubuntu/skills/fx-ea-report-auditor/scripts/publish_gate.py \
     --ledger /home/ubuntu/ea_weekly_evidence_ledger.json \
     --html /home/ubuntu/wordpress_report.html \
     --year YYYY \
     --result /home/ubuntu/ea_weekly_publish_gate.json \
     --require-template
   ```

   `PUBLISH_READY`以外は**配信保留**です。`HOLD`の場合、プレビューURL、WordPress用完成HTML、投稿用本文として納品・公開してはいけません。エラーを修正してから、必ずゲートを再実行します。

4. **SECTION 04の日付別カード監査（必須）**
   ```bash
   python3 /home/ubuntu/skills/ea-weekly-report/scripts/validate_daily_event_layout.py \
     /home/ubuntu/wordpress_report.html \
     /home/ubuntu/ea_weekly_evidence_ledger.json \
     --output /home/ubuntu/ea_weekly_daily_layout_audit.json
   ```
   この監査は、JST日付グループ、日付順、時刻順、日別件数、子カードの日付重複、`report_event_ids`の完全性、★★★重要度、一次情報URL、時刻未公表イベントの安全な表現を検証します。終了コードが`0`以外、またはJSONの`status`が`PASS`以外の場合、**PUBLISH_READYにかかわらず配信保留**とします。

5. **プレビューURLの発行**
   `PUBLISH_READY`を確認した後にだけ、HTTPサーバーを起動し、プレビューURLを発行します。
   ```bash
   pgrep -f "http.server 8080" && echo "running" || (cd /home/ubuntu && python3 -m http.server 8080 &)
   ```
   その後、`expose` ツールで8080ポートを公開します。

## STEP 4: 納品

1. 配信判定（`PUBLISH_READY`のみ配信可）と最終確認結果（作成日・対象期間・主要イベントの整合性）
2. プレビューURL
3. WordPress貼り付け用HTMLファイル（`/home/ubuntu/wordpress_report.html`）
4. 確定修正の要約、当日再確認が必要な項目、主要な一次情報のリンク

`HOLD`の場合は、問題の一覧・影響範囲・不足している一次情報をユーザーへ報告し、完成版は納品しません。
