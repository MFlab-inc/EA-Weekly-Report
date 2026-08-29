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
    "generated_from_commit": "03fcd77b...",             // 生成時点のmainブランチコミットSHA（ローカル生成時等はnull）。
                                                          // weekly.ymlの冪等チェックが「対象週ファイルの存在」だけでなく
                                                          // 「現在のHEADと同一コミットで生成済みか」を判定するために使う
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

- `name_ja`の規則生成命名（SPEC §4.2、`scripts/lib/naming.js`）は、しょうさん指示2026-08-15で
  文脈情報（periodJa・tenorJa・speakerLastName）の配線まで完了し、8kindすべてが
  `scripts/lib/build-ledger.js`の`resolveRuleGeneratedName()`経由で台帳生成時に解決される
  （`officialsConfig`引数で`config/officials.json`を渡した場合）:
  - `policy_rate`/`quarterly_report`/`press_conference`: 8中銀すべてに対応
  - `opinions_summary`/`minutes_summary`（BOJ限定）: `scripts/lib/boj-meeting-schedule.js`が
    `jp_boj`の`policy_rate`日程から会合開催日レンジを機械的に導出し、periodJaを付与する
    （既刊2週の実例・`test/boj-meeting-schedule.test.js`で検証済み）
  - `bond_auction`: `scripts/checkers/extractors/mof.js`・`us-treasury.js`が抽出する`tenorJa`が
    `resolve-candidate.js`経由で台帳まで届く。発行年月は入札日の年月から導出
  - `official_speech`: `naming.resolveOfficialBySurname`で`speakerLastName`を照合するが、
    2026-08-15時点`config/officials.json`にFRB理事個人（議長以外）が未登録（task #17）のため、
    実運用では常にverified:falseの役職のみ命名になる（機構自体は配線済み・休眠状態）
  - `testimony`: `config/manual-events.json`由来の候補は運用者が`display_name`を直接指定するため
    （`docs/manual-events-guide.md`参照）、`candidate.displayName`が常に優先され本関数は使われない
  - 全kindとも`test/regen-sample-weeks.test.js`（既刊2週の実データ経路再生成テスト）で
    end-to-endの動作を確認済み
- `annual_schedule_config`型ソース（`us_ism`・`ca_ivey`・`ca_statcan`等）由来の候補で、
  SPEC §4.2の規則生成kind以外（`pmi_ism`・`trade_balance`・`employment_situation`等、
  `config/event-names.json`辞書照合対象）は、`scripts/phase1/observation-run.mjs`の
  `resolveAnnualDictionaryName()`が解決する（2026-08-15新設。country×kindで一意に決まらない場合
  [例: US `pmi_ism`=ISM製造業/非製造業の2エントリ]は`schedule`エントリの`subtype`で絞り込む）
- `bundle_id`（同一発表枠のグルーピング、task #34）は`scripts/lib/build-ledger.js`の
  `computeBundleIds()`が算出する（しょうさん確定ルール2026-08-15「同一国×同一source_id×
  同一日×発表時刻90分以内」）。design-mock_v1.2.htmlの「発表枠」概念（例: RBA政策金利＋声明＋
  SOMPを1枠として停止バーを連結する）は`scripts/render/ledger-to-week-input.js`の
  `windowGroupsForDay()`がbundle_idに基づきグルーピングして再現する。既刊2週のRBA3件クラスタ・
  CPI2件クラスタ・PPI2件クラスタで検証済み（`test/build-ledger.test.js`・
  `test/ledger-to-week-input.test.js`）。既知の簡略化: windowGroupsのlabelItemsテキストは
  台帳の`name_ja`（フル正式名）をそのまま「・」連結する。既刊は視覚的コンパクトさのため
  手動で短縮表記（例:「RBA政策金利＆声明・四半期金融政策報告」）を使っており、本アダプタは
  そのような短縮辞書を持たないため文言がやや長くなる
- `sources[].http_status`は現状常にnull（harness.mjsが個別ソースのHTTPステータスをresult最上位に
  集約していないため）。今後の精緻化候補

## 実バグ修正の記録（task #38・実ネットワーク検証で発見）

`meta.generated_at`・`sources[].fetched_at`は「オフセット付きISO日時」必須（`ISO_DATETIME_OFFSET_RE`
はミリ秒非対応）。`scripts/build-ledger.mjs`のCLIエントリが`new Date().toISOString()`
（UTC・`Z`・ミリ秒付き）を直接使っていたため、実ネットワーク経路（fixtureで固定文字列を渡さない
唯一の経路）で台帳生成が毎回スキーマ検証エラーになっていた。fixtureベースのテストは全て
`generatedAt`を固定文字列で渡していたため検知できていなかった。`scripts/lib/tz-convert.js`に
`nowJstIso()`（+09:00オフセット・ミリ秒なし）を新設して置き換え、`scripts/check/gate.mjs`の
`checked_at_jst`（同じく`new Date().toISOString()`でUTCを格納していた命名ミス）も合わせて修正した
（`test/tz-convert.test.js`に回帰テスト追加）。

同じ実ネットワーク検証で2件目の実バグも発覚: `scripts/check/ledger-html-audit.mjs`の
`auditDateGroups()`が「台帳にイベントがある日付」のみを期待値集合としており、対象週5日のうち
2日以上でイベントが0件になる週（実際に2026-08-17週で発生: 入札3件のみで月・金がいずれも0件）で
`DATE_GROUP_UNEXPECTED`/`DATE_GROUP_EXTRA`を誤検知してHOLDになっていた。SPEC §6.3「日別カード×5」
どおり、レンダラー（`ledger-to-week-input.js`の`buildDays()`）はイベント0件の日も空の日付グループを
出力する仕様であり、監査側の期待値もそれに合わせて「対象週5日全て」に修正した
（`test/ledger-html-audit.test.js`・`test/gate.test.js`のフィクスチャも実レンダラーの出力形に合わせて修正）。
