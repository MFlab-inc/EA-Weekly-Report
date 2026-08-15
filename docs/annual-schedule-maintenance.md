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
| BOC（政策金利発表カレンダー） | 毎年7〜8月頃（翌年分。2012年から継続する年次プレスリリース慣行をWebSearchで確認、2026-08-15） | 年8回の会合日程（政策金利＋うち1/4/7/10月の4回はMonetary Policy Report同時発表） | bankofcanada.ca『Bank of Canada publishes its {年} schedule for policy interest rate announcements and other major publications』（2026-08-15実測でプレスリリース本文2件を直接確認・annual_schedule_config化。`scripts/checkers/extractors/boc-policy-rate.js`は将来の再検証用に温存、harness.mjs実行時抽出からは除外） |
| RBNZ（OCR政策金利カレンダー） | 前年内（2026-02-19公表の最新ページで2028年2月分まで掲載）。年1回、下記手順で確定 | 年8回のOCR決定日程（現地時間14:00が通例） | rbnz.govt.nz/.../ocr-decision-dates-and-financial-stability-report-dates-to-feb-2028（**2026-08-15訂正**: 旧URL[until-february-2027]は廃止・404。しょうさんが一次ソースを直接確認し新URL・全12回分の日程を転記、schedule_status=confirmed。robots.txt自体が新URLでもHTTP403でありClaude Code側の自動取得は引き続き不可。下記「RBNZ固有の手順」参照） |
| SNB（Time schedule・金融政策評価カレンダー） | 常時（ページ自体が将来分を掲載し続けるため年次確定作業は不要） | 年4回（3・6・9・12月）の金融政策評価（press release 09:30＋news conference 10:00）＋Summary of monetary policy discussion | snb.ch/en/services-events/digital-services/event-schedule（**2026-08-15訂正**: 「一括先行公表なし」は誤りだった。しょうさんが一次ソースを直接確認し発見。同ページ本文の平文日程リストを`scripts/checkers/extractors/snb-policy-rate.js`で直接抽出するweekly_scrape型へ変更、annual_schedule_config方式は不採用。下記「SNB固有の手順」参照） |

### ISM固有の手順（年1回・手動照合が必須）

ISM公式サイトは自動取得がCAPTCHAでブロックされるため、他ソースと異なり**人手による年1回の照合**が必須の工程として組み込まれている（`docs/phase1-official-sources.md` §5-4）:

1. ルールベースで翌年分ドラフトを機械生成（製造業=各月第1営業日、非製造業=各月第3営業日、米東部10:00、米連邦祝日を考慮。`scripts/lib/ism-schedule.js`）
2. しょうさんまたはClaude Codeが、ismworld.orgのリリースカレンダーページをブラウザで開き、ドラフトと目視で突合（祝日ずれ等の例外を確認）
3. 確定した日程を`config/official-sources.json`のISMエントリへ手動反映・コミット（`schedule_status`を`confirmed`に、`confirmed_at`/`confirmed_by`を記録）
4. 以後は残量監視WARN（本文の仕組み参照）が翌年分の確定時期を知らせる

**初回実施記録**: 2026-08-14、しょうさんが8〜10月分ドラフト（6件）をISM公式カレンダーページと目視突合し、全件一致を確認（`config/official-sources.json` us_ism.confirmed_at参照）。

**確定済み（2026-08-14実測）**: ABSは公表ホライズンが向こう6ヶ月分のみと確認したため年次config型は不採用（weekly_scrapeのまま）。Statistics Canadaは年次PDFが直接取得可能と判明し年次config型で解決（上表参照）。RBA議会証言（aph.gov.au）は未実測・担当ソース未定義（task化未実施）。

### RBNZ固有の手順（年1回・手動照合が必須。ISMと同方式）

RBNZ公式サイトはrobots.txt自体がHTTP 403でインフラ側ブロックされており自動取得不可（2026-08-14実測、2026-08-15新URLでも再現）。一方でRBNZは年8回のOCR（Official Cash Rate）決定日程を専用ページで前年に一括先行公表する運用のため、ISMと同じ「人間が年1回、公式ページを目視して確定する」annual_schedule_config方式を採用する。WARN暫定緩和では対応しない（NZDペア運用者にとってRBNZ政策金利は★★★の停止対象のため、しょうさん指示によりWARNのみの緩和は不採用）。

1. しょうさんが下記URLをブラウザで開き、以下の項目を目視確認してClaude Codeへ転記する:
   - **確認URL**: `https://www.rbnz.govt.nz/news-and-events/how-we-release-information/ocr-decision-dates-and-financial-stability-report-dates-to-feb-2028`（2026-08-15訂正: 旧URL[...-until-february-2027]は廃止・404済み。新URLは2026-02-19公表・2028年2月分までカバー）
   - **転記してほしい項目**（会合ごとに）:
     - 会合日（決定発表日）
     - 発表時刻（現地時間。暫定値はNZ時間14:00と想定しているが、ページ記載の実際の値で確認してほしい）
     - 現地タイムゾーン表記（NZST/NZDTの記載有無・サマータイム切替の記載があれば併せて）
2. 転記内容をClaude Codeが`config/official-sources.json`のrbnz_policy_rate.scheduleへ反映し、`schedule_status`を`confirmed`に、`confirmed_at`/`confirmed_by`を記録する
3. 以後は残量監視WARN（本文の仕組み参照）が翌年分の確定時期を知らせる

**現在の状態（2026-08-15、しょうさんが一次ソース直接確認）**: 新URL・2026年9月〜2028年2月分の全12回分をしょうさんが直接転記し、`schedule_status: "confirmed"`・`status: "active"`へ反映済み（2027年から年7→8回体制へ増加し、旧2027年2月分程日程は1週間前倒しになった点も反映）。発表時刻14:00 NZTの一次ソース照合は**クローズ済み**（`docs/open-questions.md` O3）: しょうさんが直近MPSページ（2026年5月分）を直接確認し、公式ページ本文に時刻表記自体が無いことを確認（Claude Codeのrobots.txt 403実測と整合）。14:00 NZ時間（第三者複数ソースで裏付け済み）を慣行値として採用し、初回発生週（2026年9/2週）は月曜のFF事後突合runで実際の発表時刻を自動検知する運用でクローズした。

### SNB固有の手順（2026-08-15訂正: 先行一括公表あり・手動確認は不要に）

**訂正**: 旧記録「先行一括公表ページ無し・四半期ごとの手動確認が必要」は誤りだった。しょうさんが一次ソースを直接取得し、SNB公式「Time schedule」ページ（`https://www.snb.ch/en/services-events/digital-services/event-schedule`）に金融政策評価・Summary of monetary policy discussionを含む全日程が掲載されていることを発見した。

同ページは各イベントに個別iCalendarファイル（`snb.ch/public/ical/event/en/{uuid}.ics`）も提供しており、Claude Codeが実測（Actionsランナー経由）で94件のICSリンクを発見、サンプル3件とも有効なVCALENDAR形式（`X-WR-TIMEZONE:Europe/Zurich`・`REFRESH-INTERVAL:PT6H`）であることを確認した。ただしICS個別取得は94件と週次には非効率で、かつUUID→イベント名の対応がページのDOM順とずれる構造（実測で判明）のため、**同じ公式データソースであるページ本文の平文リスト（「DD.MM.YYYY HH:MM タイトル」形式）を直接パースするweekly_scrape抽出を採用**した（`scripts/checkers/extractors/snb-policy-rate.js`）。annual_schedule_config方式は不採用（ページ自体が常に将来分を掲載し続けるため、他の年次確定ソースと違って人間による年次確認作業が不要）。

しょうさん転記の日程（金融政策評価6回・Summary of monetary policy discussion 5回）はすべて実測データと完全一致確認済み。発表時刻（press release 09:30・news conference 10:00）もページ本文で確認済み。ページ末尾の注記に「All times are local time in Switzerland (CET/CEST)」との明記があることも実測で確認した（tz=Europe/Zurich指定でCET/CEST切替は自動判定される）。

**現在の状態（2026-08-15）**: `type: "weekly_scrape"`・`status: "active"`。RBNZとは異なり年次の手動確認作業自体が不要になったため、以後はページ構造変化時の抽出失敗（フェールクローズ）でのみ気づく運用（他のweekly_scrapeソースと同様）。

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

### 残量監視WARNの2つの原因パターン（task #49、しょうさん指示の切り分け、2026-08-15）

8/17週のフルパイプライン実ネットワーク検証で残量監視WARNが8件発生し、しょうさんの指示で
「configの日程追加で解消するもの」と「恒久的に解消しない構造的ブロッカー由来のもの」に
切り分けた。結果、原因は2パターンに分かれることが分かった：

**パターンA: しきい値ミスマッチ（config自体は十分。日程データ不足ではない）**

`checkResidualMonitoring`の既定`residual_monitor_weeks`（4週）は、月次・週次カデンスの
発表元を想定した値であり、**会合間隔・発表間隔がそれより長い発表元では、日程データが
将来まで正しく確定していても、対象週がたまたま「前回発表の直後」に当たると必ず
（誤って）WARNが出る**。これは日程データの欠落ではなく、しきい値が発表元の実際の頻度に
対して短すぎることが原因。該当ソースの`residual_monitor_weeks`を、既存scheduleの最大間隔
（週）以上に引き上げることで解消する（新しい日程の取得・ライブ検証は不要）。

2026-08-15時点で対応済み:

| ソース | 会合/発表間隔の最大値 | 引き上げ後の値 |
|---|---|---|
| `jp_boj` | 54日（約7.7週） | 9週 |
| `boe_policy_rate` | 49日（7.0週） | 8週 |
| `eurostat_gdp` | 78日（約11.1週、予備速報→統合速報ペア間の間隔） | 13週 |

**パターンB: 構造的ブロッカー（真に日程データが不足。config追加では解消しない）**

以下は`schedule[]`自体が実際に2026年半ば以降で終わっており、しきい値の調整では解消しない。
いずれも既存の実測（task #41ライブ検証等）で構造的アクセス制約が確認済み:

| ソース | 最終確定日 | ブロッカーの内容 |
|---|---|---|
| `nz_stats_cpi` | 2026-07-21 | Stats NZ release-calendar/がSPA構造（JavaScript動的読み込み）で取得不可。教訓2（本ドキュメント上部のnz_statsnz固有の手順と同根）のパターンをCPI/GDP側でも試す余地は残っている（未着手） |
| `nz_stats_gdp` | 2026-06-18 | 同上 |
| `cn_nbs_data` | 2026-07-16 | 国家統計局トップページは到達可能（HTTP 200・robots許可）だが年次文書一覧のみで実スケジュール本文が無い |
| `eu_flash_pmi` | 2026-07-24 | S&P Global press-release-hubのrobots.txt自体がHTTP 403（インフラ側ブロック）。UA偽装による回避は方針上不採用 |
| `gb_flash_pmi` | 2026-07-24 | 同上（S&P Global） |

これらは「WARNが出続ける想定内の状態」として扱う。解消するには新しい取得経路の発見
（教訓2「関連する別機関の静的公開」・教訓3「同一発表元の別形式静的資料」参照）が必要で、
現時点では見つかっていない。EU HICPで有効だった教訓2/3パターンをNZ Stats・中国NBSにも
試す価値はあるが、しょうさんの明示的な依頼があるまでは新規の調査には着手しない
（2026-08-15時点の判断。必要になれば別タスクとして着手する）。

## 「登録済みソースの取りこぼし」の2つの故障パターン（task #50/51、しょうさん指摘・2026-08-15）

Manus生成レポートとの突合で、登録済み（statusがactive/draft_scheduleの）ソースなのに特定のkindだけ発表が欠落する事故が繰り返し発生した（CA CPI・AU雇用統計・GB雇用統計/小売売上高・CA小売売上高・AU小売売上高）。原因を突き詰めると2つの異なるパターンに分かれる:

**パターン1: 単純な未マッピング（同一データ内に既に存在していた）**

ソースが取得している生データ（年次PDF・weekly_scrape対象ページ）自体には該当kindのデータが最初から含まれていたが、`kinds[]`配列・`event-names.json`の辞書エントリが漏れていたために分類・表示されなかったケース。修正は「既存fixtureを再確認し、辞書エントリを追加するだけ」で完結し、新規のライブ調査は不要（CA小売売上高がこの典型例）。

**パターン2: 発表元の統計改編への追随漏れ（AU小売売上高で新規発覚）**

パターン1と違い、発表元自体が指標の名称・構造を変更しており、旧名称でmatchしていたコードが新統計を認識できなくなっていたケース。AU小売売上高では、豪州統計局（ABS）が2025-07-31付けで月次「Retail Trade」の単独公表を終了し「Monthly Household Spending Indicator」（MHSI）へ統合した（Retail Trade Replacement Program）。これは抽出コードのバグではなく、**発表元側の制度変更に config が追随できていなかった**ことが原因。同じ轍を踏む可能性がある例: 各国統計局の指数改定・基準年変更（例: jp_stat_cpiの2025年基準改定が2027年2月分から予定されている。同ソースnotes参照）、指標の統合・分割・名称変更全般。

**再発防止策（task #50一括監査で試験導入）**: 登録済み全ソースについて「発表元が公表している全リリース種別」と「configで実際にマッピング済みのkinds[]」の差分を年1回棚卸しする。手順は既存のISM/RBNZ手動照合（本文上記）と同様の「人間が公式ページを一次確認する」枠組みを流用できる:

1. 各ソースのaccess.targetsの取得先ページ（またはその上位インデックスページ）を開き、そのソースが実際に公表している統計の一覧を確認する
2. `kinds[]`に含まれないが★★以上に相当しそうな項目が無いか確認する
3. 見つかった場合は、まず該当ソースの既存fixture（`test/fixtures/official-sources/{id}/`）に該当データが既に含まれていないか確認する（含まれていればパターン1、含まれていなければ発表元側の変更＝パターン2の可能性を疑い、WebSearchで名称変更・統合の有無を確認する）
4. `config/official-sources.json`のkinds[]・`config/event-names.json`のエントリを追加し、回帰テストを追加する

**初回実施記録（task #50、2026-08-15）**: 全31ソースを棚卸しし、上記の再発事例（GB雇用統計・GB小売売上高・CA小売売上高・AU小売売上高）を発見・修正した。加えて中国CPI（NBS）が未追跡と判明したが、こちらは「既存データ内の未マッピング」ではなく別日程の別リリースであり本監査の対象外の新規調査事項として別途記録した（`config/expected-coverage.json`の`_pending_not_yet_added`参照）。

**次回実施目安**: 年1回（次回目安2027年8月頃）、または新規ソース追加時・Manus等の外部レポートとの突合で新たな欠落が見つかった時。

## config更新時のチェックリスト（Claude Code向け）

1. 該当ソースの最新年次スケジュールPDF/ページを取得
2. `config/official-sources.json` の当該ソースエントリを更新（既存の過去日程は履歴として残すか削除するかは容量次第で判断）
3. `npm test` で既存テストに影響がないことを確認
4. コミットメッセージに更新元URLと公表日を明記
