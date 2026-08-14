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
| FRB（FOMC政策金利カレンダー） | 随時（前年末〜当年始めに翌年分を公表。実測時点で2027年分も掲載済み） | 年8回の会合日程（政策金利＋会見＋うち4回はSummary of Economic Projections＝四半期報告相当） | federalreserve.gov/monetarypolicy/fomccalendars.htm（2026-08-15実測でHTML抽出済み。task #19。`scripts/checkers/extractors/frb-policy-rate.js`） |
| ECB（Governing Council政策金利カレンダー） | 随時（実測時点で2028年分まで掲載済み） | 年8回の金融政策会合日程（政策金利＋会見） | ecb.europa.eu/press/calendars/mgcgc/html/index.en.html（2026-08-15実測でHTML抽出済み。task #19。`scripts/checkers/extractors/ecb-policy-rate.js`。country="EU"採用の設計判断は下記参照） |
| BOE（MPC政策金利カレンダー） | 随時（実測時点で2026・2027年分が確定済み(confirmed)として掲載） | 年8回の会合日程（政策金利のみ。会見は本ソース未収録） | bankofengland.co.uk/monetary-policy/upcoming-mpc-dates（2026-08-15実測でHTML抽出済み。task #19。`scripts/checkers/extractors/boe-policy-rate.js`） |
| RBNZ（OCR政策金利カレンダー） | **手動確定が必要（robots.txt自体が403でインフラ側ブロック）**。年1回、下記手順で確定 | 年8回のOCR決定日程（現地時間14:00が通例。要ページ確認） | rbnz.govt.nz/.../monetary-policy-and-ocr-decision-dates-until-february-2027（自動取得不可。しょうさんへ確認依頼中。下記「RBNZ固有の手順」参照） |
| SNB（金融政策評価カレンダー） | **手動確定が必要（先行一括公表ページ無し）**。四半期ごとに直近会合を確認 | 年4回（3・6・9・12月）の金融政策評価 | snb.ch/en/the-snb/mandates-goals/monetary-policy/decisions（自動取得不可・先行一括公表ページ未発見。しょうさんへ確認依頼中。下記「SNB固有の手順」参照） |

### ISM固有の手順（年1回・手動照合が必須）

ISM公式サイトは自動取得がCAPTCHAでブロックされるため、他ソースと異なり**人手による年1回の照合**が必須の工程として組み込まれている（`docs/phase1-official-sources.md` §5-4）:

1. ルールベースで翌年分ドラフトを機械生成（製造業=各月第1営業日、非製造業=各月第3営業日、米東部10:00、米連邦祝日を考慮。`scripts/lib/ism-schedule.js`）
2. しょうさんまたはClaude Codeが、ismworld.orgのリリースカレンダーページをブラウザで開き、ドラフトと目視で突合（祝日ずれ等の例外を確認）
3. 確定した日程を`config/official-sources.json`のISMエントリへ手動反映・コミット（`schedule_status`を`confirmed`に、`confirmed_at`/`confirmed_by`を記録）
4. 以後は残量監視WARN（本文の仕組み参照）が翌年分の確定時期を知らせる

**初回実施記録**: 2026-08-14、しょうさんが8〜10月分ドラフト（6件）をISM公式カレンダーページと目視突合し、全件一致を確認（`config/official-sources.json` us_ism.confirmed_at参照）。

**確定済み（2026-08-14実測）**: ABSは公表ホライズンが向こう6ヶ月分のみと確認したため年次config型は不採用（weekly_scrapeのまま）。Statistics Canadaは年次PDFが直接取得可能と判明し年次config型で解決（上表参照）。RBA議会証言（aph.gov.au）は未実測・担当ソース未定義（task化未実施）。

### RBNZ固有の手順（年1回・手動照合が必須。ISMと同方式）

RBNZ公式サイトはrobots.txt自体がHTTP 403でインフラ側ブロックされており自動取得不可（2026-08-15実測）。一方でRBNZは年8回のOCR（Official Cash Rate）決定日程を「until February 2027」のような専用ページで前年に一括先行公表する運用のため、ISMと同じ「人間が年1回、公式ページを目視して確定する」annual_schedule_config方式を採用する。WARN暫定緩和では対応しない（NZDペア運用者にとってRBNZ政策金利は★★★の停止対象のため、しょうさん指示によりWARNのみの緩和は不採用）。

1. しょうさんが下記URLをブラウザで開き、以下の項目を目視確認してClaude Codeへ転記する:
   - **確認URL**: `https://www.rbnz.govt.nz/news-and-events/how-we-release-information/monetary-policy-and-ocr-decision-dates-until-february-2027`
   - **転記してほしい項目**（会合ごとに）:
     - 会合日（決定発表日）
     - 発表時刻（現地時間。暫定値はNZ時間14:00と想定しているが、ページ記載の実際の値で確認してほしい）
     - 現地タイムゾーン表記（NZST/NZDTの記載有無・サマータイム切替の記載があれば併せて）
2. 転記内容をClaude Codeが`config/official-sources.json`のrbnz_policy_rate.scheduleへ反映し、`schedule_status`を`confirmed`に、`confirmed_at`/`confirmed_by`を記録する
3. 以後は残量監視WARN（本文の仕組み参照）が翌年分の確定時期を知らせる

**現在の状態（2026-08-15）**: config側の受け皿（type=annual_schedule_config・schedule=[]・access.manual_verify_url設定済み）は準備完了。しょうさんへの確認依頼中で未確定（`schedule_status: "awaiting_confirmation"`）。scheduleが空のため残量監視WARNが常時出る状態になっている（これは意図した挙動＝確定するまで「未確定」であることを毎回可視化する）。

### SNB固有の手順（RBNZと異なり先行一括公表ページが無いため四半期ごとの確認が必要）

SNBは年4回（3・6・9・12月）の金融政策評価を実施するが、WebSearch再調査（2026-08-15）でもFRB/ECB/BOE/RBNZのような「翌年分を一括先行公表する専用ページ」は見つからなかった。実際の会合日は、その回が近づいてから（プレスリリースの形で）公表される運用とみられる。data.snb.ch/en/calendar（データポータル）はAngular SPAで静的取得不可と確認済み。

しょうさんへの依頼内容（RBNZと同時に確認をお願いしたい）:
- **確認URL**: `https://www.snb.ch/en/the-snb/mandates-goals/monetary-policy/decisions`（過去実績のみのアーカイブだが、直近の次回会合予告が掲載されていないか確認してほしい。無ければその旨を教えてほしい）
- 次回（2026年9月）・次々回（2026年12月）の会合日が確認できる場合は、会合日・発表時刻・現地TZを転記してほしい
- 確認できない場合は、四半期の会合が近づく都度（例年2月・5月・8月・11月頃に次回分の公表がある想定）、改めて確認をお願いする運用にする

**現在の状態（2026-08-15）**: config側の受け皿（type=annual_schedule_config・schedule=[]・access.manual_verify_url設定済み）は準備完了。しょうさんへの確認依頼中で未確定（`schedule_status: "awaiting_confirmation"`）。RBNZ同様、scheduleが空の間は残量監視WARNが常時出る。

### Stats NZ固有の手順（annual_schedule_config型ではなくweekly_scrape型・四半期ごとの手動URL更新が必要）

Stats NZはopen data API（api.stats.govt.nz）が2024-08-30に閉鎖済み、年次PDFカレンダーも見つからなかったため、annual_schedule_config型は採用できなかった。代わりに、各四半期の情報公開ページ（例: `labour-market-statistics-june-2026-quarter`）自体が本文に次回リリース予定日を埋め込み公表している（Stats NZ自身の公式コンテンツ）ことを利用し、`scripts/checkers/extractors/nz-statsnz.js`でこれを抽出する方式とした（`config/official-sources.json`のnz_statsnz.typeはweekly_scrapeのまま）。

この方式は**四半期ごとに`access.targets`のURLを最新の公表ページへ手動更新する必要がある**（jp_mofの月次URL更新と同種の運用）:

1. 新しい四半期のLabour market statisticsが公表されたら（例年2月・5月・8月・11月上旬）、`config/official-sources.json`のnz_statsnz.access.targets[0].urlを新しいページ（例: `labour-market-statistics-september-2026-quarter`）へ更新する
2. URLの更新を怠ると、ページに埋め込まれた「次回リリース予定日」が既に過ぎた日付になる。この場合`config/official-sources.json`のnz_statsnz.access.next_release_pointer:trueにより、`checkWeeklyScrapeSource`が「抽出結果が全件対象週より過去＝URL更新漏れの疑い」として構造的失敗（ok:false）を明示的に返すよう実装済み（2026-08-14・task #18対応時に追加）。annual_schedule_config型の残量監視WARN（4週先までの日程確認）とは仕組みが異なるが、同じ「更新漏れを黙って見逃さない」という目的をweekly_scrape型なりの方式で満たしている
3. しょうさんへの通知は不要（Claude Code側でURL更新を検知・実施する運用を想定）。更新漏れは上記2の構造的失敗が対象週で顕在化した時点でActionsログ・hold-report経由で分かる

**次回のURL更新目安**: 2026年11月上旬（2026年9月期のLabour market statisticsが公表され次第、`labour-market-statistics-september-2026-quarter`へ更新）。

**初回実施記録（2026-08-14）**: 前四半期（2026年3月期）ページの埋め込みテキストが「Labour market statistics: June 2026 quarter will be released on 5 August 2026」を予告しており、ground truth（nz_labour_q2_20260805）と完全一致することを確認した。

### ECBのcountry="EU"採用について（task #19・2026-08-15）

`official-sources.json`のcountryフィールドは他ソースでは全てISO国コード（US/JP/GB/AU/CA/NZ/CH/CN）だが、ECB（ユーロ圏）は単一国に対応しないため`"EU"`とした。影響範囲を確認済み: `scripts/lib/naming.js`のpolicyRateName()等はbankAbbr（"ECB"）を直接受け取る設計でcountry値に依存しない。`resolveCandidateEvent`のruleGenerated分岐（SPEC §4.2の規則生成命名kind向け）を使うためevent-names.json辞書照合（country+kindキー）も経由しない。よって"EU"という非ISOコードによる実害は無いと判断した。`scripts/phase0/phase0.mjs`のCOUNTRY_JA_TO_CODEマップで「ユーロ圏」→「EU」の対応が既に前例としてあり整合的。

## config更新時のチェックリスト（Claude Code向け）

1. 該当ソースの最新年次スケジュールPDF/ページを取得
2. `config/official-sources.json` の当該ソースエントリを更新（既存の過去日程は履歴として残すか削除するかは容量次第で判断）
3. `npm test` で既存テストに影響がないことを確認
4. コミットメッセージに更新元URLと公表日を明記
