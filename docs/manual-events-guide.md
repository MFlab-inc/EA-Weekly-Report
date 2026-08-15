# config/manual-events.json — 単発イベントの手動登録ガイド

対象: 公式ソースチェッカーに担当ソースが無いため定例欠落WARNが恒常的に出続けるイベント（例:
RBA総裁の下院経済委員会証言、task #18）や、臨時会合・突発イベント等、自動収集ではカバーできない
★★★候補の正規登録ルート。2026-08-15新設（しょうさん指示）。

## 仕組み

- `config/manual-events.json` の `entries` 配列に、しょうさんが1件ずつイベントを登録する
- `scripts/lib/manual-events.js` が形式検証（`validateManualEvents`）と候補変換
  （`manualEntryToCandidate`／`candidatesForTargetWeek`）を担う
- 観測パイプライン（`scripts/phase1/observation-run.mjs`）が対象週に該当するentriesを、公式ソース
  由来の候補と同列の候補イベントとして取り込む（`sourceId: "manual_events"`）
- 対象週の範囲外になったentriesは自動的に候補化されなくなる（`date`列で判定）。削除は任意（履歴として
  残してもレポートには影響しない）

## しょうさんの対応（RBA証言のWARNに気づいたときの例）

`RBA総裁下院経済委員会証言`の定例欠落WARN（`recurring_checks`、task #18）が出たら:

1. `aph.gov.au`（豪州議会）等で該当週の証言の有無・正確な日時を確認する
2. 確認できたら、以下の項目をClaude Codeへ伝える（会話でよい。GitHub Web UI操作は不要）:
   - 日付・現地時刻・現地タイムゾーン（または「時刻未定」）
   - 表示したい日本語名（例:「ブロックRBA総裁：下院経済委員会への出席」）
   - 重要度（★★★=3・★★=2・非掲載=0）
   - 出典（確認したURL・確認方法）
3. Claude Codeが`config/manual-events.json`へエントリを追加し、コミット・プッシュする

## エントリのスキーマ

```jsonc
{
  "id": "rba-testimony-2026-08",       // 一意な識別子（重複禁止）
  "date": "2026-08-14",                 // 発表の暦日（YYYY-MM-DD）
  "local_time": "08:30",                // 現地時刻（省略可。省略時は両方省略しtime未定扱い）
  "tz": "Australia/Sydney",             // IANAタイムゾーン（local_timeとセットで指定）
  "country": "AU",                      // ISO国コード（EU等の例外はofficial-sources.json慣行に合わせる）
  "kind": "testimony",                  // 任意。event-comments.jsonの定型コメント辞書と一致すればコメント自動付与
  "display_name": "ブロックRBA総裁：下院経済委員会への出席", // 辞書照合はせず運用者が直接指定
  "importance": 3,                      // 0/2/3のいずれか
  "source_note": "aph.gov.au 2026-08-10確認", // 出典メモ（必須）
  "registered_by": "しょうさん",          // 登録者（必須・監査用）
  "registered_at": "2026-08-15"          // 登録日（必須・監査用）
}
```

`local_time`/`tz`は両方指定するか両方省略する（省略時は`bond_auction`等と同じ「時刻未定」扱いで
`time: null`になる）。時刻はDST安全のためIANAタイムゾーン経由でJSTへ変換される
（`scripts/lib/tz-convert.js`、他の公式ソースと同じ仕組み）。

## 汎用性

RBA証言専用ではなく、臨時会合・突発イベントなど「公式ソースチェッカーの担当外だが★★★として
掲載したい」ケース全般の穴埋めとして使える。逆に、通常発生する定例イベント（月次統計・中銀会合等）は
公式ソースチェッカー（`config/official-sources.json`）側で担当ソースを確立するのが本則であり、
manual-events.jsonは「担当ソースを作るまでもない一過性のイベント」向け。
