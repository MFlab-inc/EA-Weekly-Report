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
| BOJ（金融政策決定会合） | 毎年7月31日（翌年分） | 翌年8回の会合日程 | boj.or.jp/mopo/mpmsche_minu/m_ref/mref{YY}0731a.pdf |
| MOF（国債発行計画） | 毎年12月頃（翌年度＝4月始まり分） | 年間発行計画。年度途中（6月頃）に改定あり | mof.go.jp/jgbs/issuance_plan/fy{年度}/ |
| RBA（理事会日程） | 前年内（例: 2025年に2026年分） | 翌年の会合日程 | rba.gov.au 媒体発表（"[Year] Monetary Policy Board Meeting Dates"） |
| Statistics Canada（主要統計） | 毎年公表（当年+翌年分をカバー） | CPI・GDP・雇用統計等の発表日一覧 | statcan.gc.ca/n1/release-diffusion/{年}-eng.pdf |
| ISM（製造業/非製造業PMI） | **手動確定が必要（自動取得不可）**。年1回、下記手順で確定 | 製造業=第1営業日・非製造業=第3営業日・米東部10:00（規則ドラフト） | ismworld.org/.../rob-report-calendar/（CAPTCHAのため自動取得不可） |

### ISM固有の手順（年1回・手動照合が必須）

ISM公式サイトは自動取得がCAPTCHAでブロックされるため、他ソースと異なり**人手による年1回の照合**が必須の工程として組み込まれている（`docs/phase1-official-sources.md` §5-4）:

1. ルールベースで翌年分ドラフトを機械生成（製造業=各月第1営業日、非製造業=各月第3営業日、米東部10:00、米連邦祝日を考慮）
2. しょうさんまたはClaude Codeが、ismworld.orgのリリースカレンダーページをブラウザで開き、ドラフトと目視で突合（祝日ずれ等の例外を確認）
3. 確定した日程を`config/official-sources.json`のISMエントリへ手動反映・コミット
4. 以後は残量監視WARN（本文の仕組み参照）が翌年分の確定時期を知らせる

**要確認（実測で確定次第この表を更新）**: RBA議会証言（aph.gov.au）・ABS（6ヶ月先までしか公表されない可能性・要確認）・Stats NZ（公表期間未確定）・ONS（release stub pageが1年超先まで存在する例を確認済みだが、確定日程かどうか要区別）は年次config型に向かない、または年次+都度確認のハイブリッドが必要な可能性がある。詳細は `docs/phase1-official-sources.md` の実測結果参照。

## config更新時のチェックリスト（Claude Code向け）

1. 該当ソースの最新年次スケジュールPDF/ページを取得
2. `config/official-sources.json` の当該ソースエントリを更新（既存の過去日程は履歴として残すか削除するかは容量次第で判断）
3. `npm test` で既存テストに影響がないことを確認
4. コミットメッセージに更新元URLと公表日を明記
