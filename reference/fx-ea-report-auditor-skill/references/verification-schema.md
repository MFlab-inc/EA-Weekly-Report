# 根拠台帳スキーマ

台帳はUTF-8のJSONで保存する。作成前に本文を書かず、各イベント・市況値・休日情報を台帳に入力する。必須項目が未取得の場合は値を推測せず、`status`と`value_status`で理由を示す。

```json
{
  "schema_version": "1.0",
  "report": {
    "report_type": "ea_weekly",
    "target_start": "2026-07-20",
    "target_end": "2026-07-24",
    "display_timezone": "Asia/Tokyo",
    "research_started_at": "2026-07-18T11:00:00+09:00",
    "generated_at": null,
    "approved_template_path": "/absolute/path/to/design_master.html"
  },
  "events": [],
  "market_prices": [],
  "market_holidays": [],
  "report_event_ids": [],
  "source_checks": [],
  "open_issues": []
}
```

## `events[]`

各経済指標、金融政策、会見、要人発言、国債入札を別イベントにする。政策判断と記者会見を1件に統合しない。

| フィールド | 必須 | 要件 |
|---|---:|---|
| `id` | はい | 全レポート内で一意の安定ID。例：`uk-cpi-2026-07-22`。 |
| `event_name` | はい | 発表主体の名称に沿う。速報・改定・確報、総合・コア、対象期間を含める。 |
| `country_or_region` | はい | ISO国コードまたは地域名。 |
| `event_type` | はい | `economic_indicator`、`central_bank_decision`、`press_conference`、`auction`、`speech`のいずれか。 |
| `official_local_datetime` | 条件付き | 公式時刻がある場合のみISO 8601で保存する。時刻が公式にない場合は`null`。 |
| `official_timezone` | はい | IANAタイムゾーン名。例：`Europe/London`。時刻未公表でも地域の正式IANA名を入れる。 |
| `jst_datetime` | 条件付き | `official_local_datetime`がある場合だけ、プログラムで算出したISO 8601のJST値を入れる。 |
| `time_status` | はい | `verified`、`not_published`、`to_be_confirmed`のいずれか。 |
| `event_date` | はい | 発表元の日付をISO日付で保存する。 |
| `weekday_jst` | 条件付き | `jst_datetime`がある場合はJST日付からプログラムで算出する。 |
| `importance` | はい | `1`、`2`、`3`または`null`。市場カレンダー由来なら`importance_source`を必須にする。 |
| `importance_source` | 条件付き | 重要度を使う場合の提供者・URL・確認時刻。 |
| `previous` | はい | `value`、`unit`、`definition`、`value_status`を持つオブジェクト。 |
| `revised` | はい | `value`、`unit`、`definition`、`value_status`を持つオブジェクト。改定なしは`not_applicable`。 |
| `forecast` | はい | `value`、`unit`、`definition`、`value_status`を持つオブジェクト。予想がない場合は`not_applicable`。 |
| `result` | はい | 発表前は`not_published`、発表後は公式結果。 |
| `source` | はい | 発表主体、URL、確認日時、対象期間、単位を持つオブジェクト。 |
| `status` | はい | `verified`、`pending`、`conflict`、`not_applicable`のいずれか。 |
| `notes` | はい | 定義差、留意事項、当日確認理由を簡潔に記載する。 |

値オブジェクトの例を示す。

```json
{
  "value": "3.1",
  "unit": "%",
  "definition": "前年比・総合・季節調整前",
  "value_status": "verified"
}
```

`value_status`は`verified`、`not_published`、`not_listed`、`not_applicable`のいずれかとする。`value`が`null`の場合は、`not_published`、`not_listed`、`not_applicable`のどれかを必ず指定する。

## `market_prices[]`

終値・終盤値・参考値・遅延価格を混同しない。各値に次の項目を持たせる。

```json
{
  "id": "usd-jpy-ny-close-2026-07-17",
  "instrument": "USD/JPY",
  "value": "162.39",
  "currency_or_unit": "JPY per USD",
  "price_definition": "NY close",
  "as_of": "2026-07-17T17:00:00-04:00",
  "as_of_timezone": "America/New_York",
  "delayed": false,
  "source": {
    "publisher": "Source name",
    "url": "https://example.invalid/source",
    "checked_at": "2026-07-18T10:00:00+09:00"
  },
  "status": "verified",
  "notes": ""
}
```

## `market_holidays[]`

祝日、現物市場、先物・デリバティブ、決済・短縮取引を1つの`closed`項目にまとめない。

```json
{
  "id": "us-holiday-2026-07-03",
  "market_date": "2026-07-03",
  "country_or_region": "US",
  "holiday_name": "Independence Day observed",
  "spot_fx_status": "open_or_not_applicable",
  "cash_market_status": "early_close",
  "derivatives_status": "early_close",
  "settlement_status": "restricted",
  "source": {
    "publisher": "Official venue or authority",
    "url": "https://example.invalid/calendar",
    "checked_at": "2026-07-01T09:00:00+09:00"
  },
  "status": "verified",
  "notes": ""
}
```

## `source_checks[]` と `open_issues[]`

`source_checks[]`には一次情報、経済カレンダー、通信社などを区別し、確認時刻と用途を保存する。`open_issues[]`には未取得値、競合、時刻未公表、リンク切れ、テンプレート原本不在を記録する。`severity`が`error`または`blocker`の問題が1件でもあれば配信保留とする。
