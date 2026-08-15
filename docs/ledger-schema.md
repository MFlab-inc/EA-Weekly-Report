# 根拠台帳（ledger）スキーマ v1.0 — v4レイアウト向け改訂

task #13（検証スクリプト5本の移植＋新設3検査）にあたり、`reference/fx-ea-report-auditor-skill/references/verification-schema.md`
（Manus時代の旧スキーマ）の**構造を継承しつつ、v4レイアウト（`templates/design-mock_v1.2.html`）の
実際の情報量に合わせてフィールドを簡素化**した。HANDOFF.md §5「台帳JSON構造として継承。一部フィールドの
意味を§3に従い改訂」・SPEC.md §8「期待構造をv4へ更新」の指示に基づく判断。

## 旧スキーマから落としたもの（理由）

| 旧フィールド | 理由 |
|---|---|
| `market_prices[]`・`market_holidays[]` | v4のSPEC §6セクション構成（ヒーロー／EA停止スケジュール／注目イベント／リスク管理／BTC週末ガイド／フッター）に価格・休場カレンダー表示は無い。表示されない情報を台帳で監査する意味がないため削除 |
| `previous`/`revised`/`forecast`/`result`（値オブジェクト） | `config/report-policy.json`の`show_prev_forecast=false`が恒久既定値（SPEC §7）のため、v4は数値行を一切表示しない。value_status監査は対象データが存在しないため削除 |
| `approved_template_path` / `--require-template` | 「承認済みテンプレート」という概念が新パイプラインに無い（テンプレートは`templates/design-mock_v1.2.html`固定・レンダラーがこれを再現する契約のため、実行時に「どのテンプレートを使ったか」を台帳へ記録する意味がない） |
| `event_type`（economic_indicator等の5値enum） | 本パイプラインの実際のkind分類（`config/importance-rules.json`のkind_definitions＋規則生成kind）と二重管理になるため、`event_kind`として実際のkind文字列（例: `cpi`・`policy_rate`）をそのまま保持する形に統一 |
| `data-ea-event-date`/`data-ea-event-time-jst`/`data-ea-event-country`/`data-ea-source-url`/`data-ea-canonical`（HTML側属性） | v4のHTML属性契約はSPEC §6で`event-id`・`event-importance`のみに簡素化されている（`templates/design-mock_v1.2.html`実測で確認）。台帳自体にはjst_datetime等を引き続き保持するが、HTML側との突合はevent-id・importanceの集合一致のみに簡素化される（下記「v4での監査範囲の縮小について」参照） |

## スキーマ

```jsonc
{
  "schema_version": "1.0",
  "report": {
    "report_type": "ea_weekly",
    "target_start": "YYYY-MM-DD",     // 対象週月曜
    "target_end": "YYYY-MM-DD",       // 対象週金曜
    "display_timezone": "Asia/Tokyo",
    "created_date_ja": "YYYY年M月D日（曜）", // ヘッダー「作成日」表示に使う値
    "research_started_at": "ISO8601（オフセット必須）",
    "generated_at": "ISO8601（オフセット必須）または null"
  },
  "target_dates_jst": [{ "date": "YYYY-MM-DD", "weekday_jst": "月" }, /* ... 5営業日分 */],
  "events": [
    {
      "id": "国-指標-YYYYMMDD形式の一意キー",
      "event_name": "日本語表示名（config/event-names.json解決済み、または規則生成名）",
      "country_or_region": "日本語国名表示（countryJa。例: 日本・豪州・米国）",
      "currency": "通貨コード（例: JPY）",
      "event_kind": "kind文字列（config/importance-rules.jsonのkind_definitions準拠。例: cpi・policy_rate）",
      "official_local_datetime": "ISO8601（オフセット必須）または null（time_status!=verifiedの場合）",
      "official_timezone": "IANAタイムゾーン名 または null",
      "jst_datetime": "ISO8601 +09:00 または null",
      "time_status": "verified | not_published",
      "jst_date": "YYYY-MM-DD",
      "weekday_jst": "月〜日（time_status問わず対象週内の日付には設定）",
      "importance": 2 または 3,       // 0（非掲載）は台帳に載せない＝そもそも「イベント」として扱わない
      "importance_source": "config/importance-rules.json",
      "source": { "publisher": "発表元名", "url": "https://...", "checked_at": "ISO8601（オフセット必須）" },
      "status": "verified | pending | conflict",
      "notes": "任意の注記"
    }
  ],
  "report_event_ids": ["..."],  // 「対象週の注目イベント」セクション（★★★・★★両方）に掲載する全イベントのid
  "open_issues": [{ "severity": "error|blocker|warning|info", "message": "..." }]
}
```

## v4での監査範囲の縮小について

旧`validate_report.py`はHTML側に`data-ea-event-date`・`data-ea-event-time-jst`・`data-ea-event-country`・
`data-ea-source-url`・`data-ea-canonical`・値オブジェクト属性(`data-ea-field`/`data-ea-value`/`data-ea-value-status`)
を要求し、台帳の該当フィールドと1件ずつ突合していた。v4のHTML属性契約（SPEC §6）はこれらを持たないため、
**HTML×台帳照合はevent-id集合の一致とevent-importance値の一致のみ**に縮小される。時刻・国・出典URLの
正しさは（1）台帳自体の`validate_ledger.py`による自己整合性検査（JST変換の再計算一致等）と、
（2）レンダラー（`scripts/render/`）のユニットテスト（`test/renderer.test.js`等、時刻の並び順・表示文字列を検証）
の2層で担保する設計とした。時刻順序チェック（`known_time_positions`ソート確認等）も同様の理由でHTML監査からは外し、
レンダラー側のユニットテスト（`dateGroup()`の`sorted`ロジック）の責務とする。
