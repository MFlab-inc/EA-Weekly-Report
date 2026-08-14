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
| Statistics Canada（主要統計） | 毎年公表（当年+翌年分をカバー）とされるが未確認 | CPI・GDP・雇用統計等の発表日一覧 | statcan.gc.ca/n1/release-diffusion/{年}-eng.pdf（2026-08-14実測: 直リンクせず中間HTML着地ページに転送。cal1-eng.htmは検索フォームで静的日程を含まず、実際の取得経路は未解決。`docs/phase1-official-sources.md` §7-5参照） |
| ISM（製造業/非製造業PMI） | **手動確定が必要（自動取得不可）**。年1回、下記手順で確定 | 製造業=第1営業日・非製造業=第3営業日・米東部10:00（規則ドラフト） | ismworld.org/.../rob-report-calendar/（CAPTCHAのため自動取得不可）。**2026-08-14: 初回確定完了**（しょうさん目視確認、8〜10月分。下記「ISM固有の手順」参照） |

### ISM固有の手順（年1回・手動照合が必須）

ISM公式サイトは自動取得がCAPTCHAでブロックされるため、他ソースと異なり**人手による年1回の照合**が必須の工程として組み込まれている（`docs/phase1-official-sources.md` §5-4）:

1. ルールベースで翌年分ドラフトを機械生成（製造業=各月第1営業日、非製造業=各月第3営業日、米東部10:00、米連邦祝日を考慮。`scripts/lib/ism-schedule.js`）
2. しょうさんまたはClaude Codeが、ismworld.orgのリリースカレンダーページをブラウザで開き、ドラフトと目視で突合（祝日ずれ等の例外を確認）
3. 確定した日程を`config/official-sources.json`のISMエントリへ手動反映・コミット（`schedule_status`を`confirmed`に、`confirmed_at`/`confirmed_by`を記録）
4. 以後は残量監視WARN（本文の仕組み参照）が翌年分の確定時期を知らせる

**初回実施記録**: 2026-08-14、しょうさんが8〜10月分ドラフト（6件）をISM公式カレンダーページと目視突合し、全件一致を確認（`config/official-sources.json` us_ism.confirmed_at参照）。

**確定済み（2026-08-14実測）**: ABSは公表ホライズンが向こう6ヶ月分のみと確認したため年次config型は不採用（weekly_scrapeのまま）。Stats NZはSPA構造（JS/API動的描画）で静的日程が取得できないと判明。Statistics Canadaは検索フォーム構造で同様に静的日程を含まないと判明（両者ともfollow-up調査中。`docs/phase1-official-sources.md` §7-5参照）。RBA議会証言（aph.gov.au）は未実測（優先度B対応後に検討）。

## config更新時のチェックリスト（Claude Code向け）

1. 該当ソースの最新年次スケジュールPDF/ページを取得
2. `config/official-sources.json` の当該ソースエントリを更新（既存の過去日程は履歴として残すか削除するかは容量次第で判断）
3. `npm test` で既存テストに影響がないことを確認
4. コミットメッセージに更新元URLと公表日を明記
