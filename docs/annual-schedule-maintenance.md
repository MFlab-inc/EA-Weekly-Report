# 年次スケジュールconfigの運用手順

対象: `docs/phase1-official-sources.md` で「年次スケジュールconfig型」に分類した公式ソース（発表元が向こう1年程度の日程を事前公表しており、週次スクレイピングでなくconfig照合で足りるもの）。SPEC §3.5参照。

## 仕組み

- 各ソースの確定済み日程は `config/official-sources.json`（Phase 1構築）内に、そのソース専用のスケジュール配列として保持する
- 週次runのcheck段で、年次スケジュールconfig型の各ソースについて「対象週から4週先までの日程がconfigに存在するか」を確認する
- 存在しない場合はWARNを出す（HOLDにはしない。ただし放置すると当該ソースの検出が静かに欠落し続けるため、しょうさんへの可視化が目的）
- WARNは `hold-report.json` と同様の仕組みでActionsログ・Pagesプレビューに出す想定（PUBLISH_READY自体は妨げない）

## しょうさんの対応

WARNが出たら、そのメッセージ（対象ソース名）をそのままClaude Codeに伝えてください。「◯◯（発表元名）の年次スケジュールWARNが出ています」で通じます。config更新はClaude Code側で行います（GitHub Web UI操作は不要）。

## 各ソースの年次公表時期（実測済み・Phase 0/1調査結果に基づく）

| ソース | 年次スケジュール公表時期 | 公表内容 | 出典URL（実測時点） |
|---|---|---|---|
| BOJ（金融政策決定会合） | 毎年7月31日（翌年分） | 翌年8回の会合日程＋主な意見・議事要旨の発表日 | boj.or.jp/en/mopo/mpmsche_minu/index.htm（mpm_index.htm。2026-08-14実測でHTML抽出済み。PDFより安定） |
| MOF（国債発行計画） | 毎年12月頃（翌年度＝4月始まり分） | 年間発行計画。年度途中（6月頃）に改定あり | mof.go.jp/jgbs/issuance_plan/fy{年度}/（未実測。task #11） |
| RBA（理事会日程） | 前年内（例: 2025年に2026年分。2026-08-14実測時点で2027年分も一部掲載済み） | 翌年8回の会合日程（政策金利＋四半期報告＋会見） | rba.gov.au/schedules-events/board-meeting-schedules.html（2026-08-14実測でHTML抽出済み。四半期報告(SMP)月はFeb/May/Aug/Novと推定＝Aug以外は月曜FF突合待ち） |
| Statistics Canada（Labour Force Survey・国際商品貿易） | 毎年公表（前年に翌年分＋当年残り分をカバー。今回確認分は2026年1月〜2027年3月） | Labour Force Survey（雇用統計）・Canadian international merchandise trade（国際商品貿易）の発表日・対象期間一覧（1年分の全指標を含む年次PDFの一部） | statcan.gc.ca/n1/release-diffusion/{年}-eng.pdf（**2026-08-14再実測で解決**: 直接取得可能・リダイレクト無し・HTTP 200のPDFと判明。前回記録「中間HTML着地ページに転送」は誤りだった。`scripts/checkers/extractors/statcan.js`で抽出、ground truthと完全一致確認済み。`docs/phase1-official-sources.md` §7-5・task #15参照） |
| ISM（製造業/非製造業PMI） | **手動確定が必要（自動取得不可）**。年1回、下記手順で確定 | 製造業=第1営業日・非製造業=第3営業日・米東部10:00（規則ドラフト） | ismworld.org/.../rob-report-calendar/（CAPTCHAのため自動取得不可）。**2026-08-14: 初回確定完了**（しょうさん目視確認、8〜10月分。下記「ISM固有の手順」参照） |

### ISM固有の手順（年1回・手動照合が必須）

ISM公式サイトは自動取得がCAPTCHAでブロックされるため、他ソースと異なり**人手による年1回の照合**が必須の工程として組み込まれている（`docs/phase1-official-sources.md` §5-4）:

1. ルールベースで翌年分ドラフトを機械生成（製造業=各月第1営業日、非製造業=各月第3営業日、米東部10:00、米連邦祝日を考慮。`scripts/lib/ism-schedule.js`）
2. しょうさんまたはClaude Codeが、ismworld.orgのリリースカレンダーページをブラウザで開き、ドラフトと目視で突合（祝日ずれ等の例外を確認）
3. 確定した日程を`config/official-sources.json`のISMエントリへ手動反映・コミット（`schedule_status`を`confirmed`に、`confirmed_at`/`confirmed_by`を記録）
4. 以後は残量監視WARN（本文の仕組み参照）が翌年分の確定時期を知らせる

**初回実施記録**: 2026-08-14、しょうさんが8〜10月分ドラフト（6件）をISM公式カレンダーページと目視突合し、全件一致を確認（`config/official-sources.json` us_ism.confirmed_at参照）。

**確定済み（2026-08-14実測）**: ABSは公表ホライズンが向こう6ヶ月分のみと確認したため年次config型は不採用（weekly_scrapeのまま）。Statistics Canadaは年次PDFが直接取得可能と判明し年次config型で解決（上表参照）。RBA議会証言（aph.gov.au）は未実測・担当ソース未定義（task化未実施）。

### Stats NZ固有の手順（annual_schedule_config型ではなくweekly_scrape型・四半期ごとの手動URL更新が必要）

Stats NZはopen data API（api.stats.govt.nz）が2024-08-30に閉鎖済み、年次PDFカレンダーも見つからなかったため、annual_schedule_config型は採用できなかった。代わりに、各四半期の情報公開ページ（例: `labour-market-statistics-june-2026-quarter`）自体が本文に次回リリース予定日を埋め込み公表している（Stats NZ自身の公式コンテンツ）ことを利用し、`scripts/checkers/extractors/nz-statsnz.js`でこれを抽出する方式とした（`config/official-sources.json`のnz_statsnz.typeはweekly_scrapeのまま）。

この方式は**四半期ごとに`access.targets`のURLを最新の公表ページへ手動更新する必要がある**（jp_mofの月次URL更新と同種の運用）:

1. 新しい四半期のLabour market statisticsが公表されたら（例年2月・5月・8月・11月上旬）、`config/official-sources.json`のnz_statsnz.access.targets[0].urlを新しいページ（例: `labour-market-statistics-september-2026-quarter`）へ更新する
2. URLの更新を怠ると、ページに埋め込まれた「次回リリース予定日」が既に過ぎた日付になり、抽出結果が対象週と一致しなくなる。この場合`extractNzNextRelease`は次回リリース予定日の埋め込みテキスト自体は見つかる可能性があるが、対象週の日程を含まない結果になるため、フェールクローズ規則（該当週に必要ならHOLD）で安全側に倒れる
3. しょうさんへの通知は不要（Claude Code側でURL更新を検知・実施する運用を想定）だが、残量監視の仕組みがannual_schedule_config型と異なりまだ無いため、当面は月次の定期確認（task化検討）が必要

**初回実施記録（2026-08-14）**: 前四半期（2026年3月期）ページの埋め込みテキストが「Labour market statistics: June 2026 quarter will be released on 5 August 2026」を予告しており、ground truth（nz_labour_q2_20260805）と完全一致することを確認した。

## config更新時のチェックリスト（Claude Code向け）

1. 該当ソースの最新年次スケジュールPDF/ページを取得
2. `config/official-sources.json` の当該ソースエントリを更新（既存の過去日程は履歴として残すか削除するかは容量次第で判断）
3. `npm test` で既存テストに影響がないことを確認
4. コミットメッセージに更新元URLと公表日を明記
