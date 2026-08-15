# 根拠台帳（ledger）スキーマ v1.0

task #13（検証スクリプト5本の移植＋新設3検査）、しょうさん指示2026-08-15で再定義。
`data/ledger/YYYY-MM-DD.json`（YYYY-MM-DD=対象週の月曜）として週次runごとに生成する。

**旧Manusスキーマ（`reference/fx-ea-report-auditor-skill/references/verification-schema.md`）は
継承しない。** 旧スキーマは市況セクション（`market_prices`/`market_holidays`）や前回値・予想値の
値オブジェクト（`show_prev_forecast=false`が恒久既定値のv4では使い道が無い）を前提にしており、
新設計では捨てた。継承するのは**「1イベント＝1レコード、出典を必ず持つ」という設計思想のみ**。
目的は「掲載した各イベントの根拠を後から追跡できること」の一点に絞る。

## スキーマ

```jsonc
{
  "meta": {
    "schema_version": "1.0",
    "generated_at": "2026-08-15T08:06:00+09:00",      // オフセット付きISO日時
    "target_week_start": "2026-08-17",                 // 対象週月曜
    "target_week_end": "2026-08-21",                   // 対象週金曜
    "pipeline_version": "...",                          // 生成パイプラインのバージョン識別子
    "outcome": "PUBLISH_READY",                         // "PUBLISH_READY" | "HOLD"
    "warnings": ["..."],                                 // 非ブロッキング（残量監視WARN・定例欠落WARN等）
    "holds": []                                           // outcome=HOLD時は1件以上必須（HOLD理由）
  },
  "sources": [
    {
      "source_id": "au_rba",                             // config/official-sources.jsonのid、または"manual"
      "type": "annual_schedule_config",                   // date_api_fred|weekly_scrape|annual_schedule_config|manual
      "fetched_at": "2026-08-15T08:00:00+09:00",
      "url": "https://www.rba.gov.au/schedules-events/board-meeting-schedules.html",
      "ok": true,
      "http_status": null,                                 // annual_schedule_config/manualは実フェッチが無いためnull
      "extractor_result_count": 1,
      "robots_checked": true,
      "fail_closed_decision": "OK"                          // OK|WARN|HOLD|SKIPPED
    }
  ],
  "events": [
    {
      "event_id": "au-rba-rate-2026-08-18",                // country-kind-date形式（衝突時は-2, -3…を付与）
      "date_local": "2026-08-18", "time_local": "14:30", "tz": "Australia/Sydney", // 現地表記（両方nullも可＝時刻未公表）
      "date_jst": "2026-08-18",                             // JST日付（bucketingの正）
      "datetime_jst": "2026-08-18T13:30:00+09:00",          // time_status=publishedのとき必須、unpublishedならnull
      "time_status": "published",                            // published | unpublished
      "country": "AU", "currency": "AUD",                    // ISO国コード・通貨コード
      "kind": "policy_rate",                                  // config/importance-rules.jsonのkind体系
      "name_ja": "RBA政策金利＆声明発表",                     // 表示名（必須。辞書解決できない場合は暫定ラベルにフォールバック）
      "importance": 3,                                        // 2または3のみ（0=非掲載は台帳に載せない）
      "source_id": "au_rba",                                  // sources[]のいずれかのIDと一致必須
      "source_evidence": "ground truth au-rba-rate-2026-08-11と一致確認済み", // 必須。空なら台帳生成時点でHOLD
      "name_resolution": "dictionary",                        // dictionary | rule_generated
      "halt_window_start_jst": "2026-08-18T01:30:00+09:00",   // importance=3・時刻確定時のみ必須
      "halt_window_end_jst": "2026-08-18T09:30:00+09:00",
      "bundle_id": null                                        // 同一発表枠として束ねる場合のグループID（任意）
    }
  ],
  "coverage": {
    "expected_coverage": { "required": 8, "missing": [] },     // scripts/lib/validate-expected-coverage.jsの結果
    "recurring_checks": [{ "name": "米雇用統計", "applies_this_week": false, "found": false }]
  }
}
```

## events[]とレンダリング結果の1対1対応

台帳にないイベントがHTMLに出ること、逆にHTMLに出ないイベントが台帳にあることは、いずれも
`scripts/check/ledger-html-audit.mjs`で検査してHOLDにする（旧`validate_report.py`・
`validate_daily_event_layout.py`の実質的な後継。詳細は`docs/validate-scripts-guide.md`）。

## 手動イベント（config/manual-events.json由来）の扱い

`source_id: "manual"`として他の公式ソース由来イベントと同列にeventsへ記録する。`sources[]`にも
`source_id: "manual"`のエントリを常に1件追加し（対象週にmanual-events.jsonの該当が無くても
`extractor_result_count: 0`で追加）、event.source_idの参照整合性を保つ。`source_evidence`には
`config/manual-events.json`の`source_note`をそのまま使う。

## 生成・検証・利用

- 生成: `scripts/lib/build-ledger.js`（`buildLedger()`）。`scripts/checkers/harness.mjs`の
  `runChecks()`結果＋`config/manual-events.json`の候補を入力とする
- スキーマ検証: `scripts/lib/validate-ledger.js`（`validateLedger()`。純粋関数、`test/validate-ledger.test.js`）
- HTML突合: `scripts/check/ledger-html-audit.mjs`
- 全検査の集約（PUBLISH_READY/HOLD判定）: `scripts/check/gate.mjs`

## 既知の簡略化（今後の課題）

- `name_ja`の解決はまだ`config/event-names.json`辞書照合（`name_resolution: "dictionary"`）に限られ、
  SPEC §4.2の規則生成命名（「{人名}{役職}の記者会見」等、`config/officials.json`参照）は未実装。
  現状は`scripts/lib/build-ledger.js`の`FALLBACK_KIND_LABEL`（kind→簡易日本語ラベル）で暫定対応し、
  `name_resolution: "rule_generated"`として台帳上も「これは最終形の命名ではない」と分かるようにしている
- `bundle_id`（同一発表枠のグルーピング）は台帳生成時点では未計算（常にnull）。design-mock_v1.2.htmlの
  「発表枠」概念（例: RBA政策金利＋声明＋SOMPを1枠として停止バーを連結する）は現状レンダラー側
  （`scripts/render/build-report-data.js`の`windowGroups`）が個別に担っており、台帳との統合は未実施
- `sources[].http_status`は現状常にnull（harness.mjsが個別ソースのHTTPステータスをresult最上位に
  集約していないため）。今後の精緻化候補
