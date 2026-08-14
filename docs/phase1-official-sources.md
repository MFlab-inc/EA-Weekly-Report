# Phase 1 実装計画 — 公式ソースチェッカーの最小リストと実装順

作成: 2026-08-14／みんかぶFX恒久不使用決定（`docs/open-questions.md` 上位決定）を受けて、統計指標も発言系と同様に公式発表元から収集する。本書は既刊2週（`reference/sample-report_20260808.html`・全29イベント、`scripts/phase0/expected-events.json`）から逆算した**対象発表元の最小リスト**と**実装順**を定める。検収基準1（既刊2週の100%捕捉）は不変。

**実測状況（2026-08-14）**: 優先度A・9元すべての到達性実測が完了（`scripts/phase1/source-recon.mjs`、Actions run #1〜#3）。結果は §5 参照。

## 0. 国債入札について（確認事項1への回答）

既刊29イベントの国債入札は**すべて日本のJGB入札**（`jp_jgb_10y_auction_20260804`「10年利付国債（2026年8月債）の入札」・`jp_jgb_30y_auction_20260806`「30年利付国債（2026年8月債）の入札」、いずれも2026-08-03週・確認先「財務省」＝日本の財務省）。`reference/sample-report_20260808.html` 実データで確認済み。**米国債入札は既刊29イベントに含まれない**。

一方、`reference/calendar_weekly_20260810.md`（2026-08-10週の候補リスト）には米財務省（TreasuryDirect）ソースの3年・10年・30年債入札が候補として掲載されており、その週の最終レポート（★★★のみ掲載）で★★のため落選しただけで、**米国債入札も実運用では通常発生する候補カテゴリ**である。SPEC §4.2の命名テンプレート「入札=『米{年限}債入札』」も米国債を前提にしており、この整合性からも米財務省ソースの実装が必要と判断する。

→ **優先度Bに「B1a: 米財務省（TreasuryDirect）」を追加**し、既存のB1は「B1b: 日本財務省（MOF・JGB）」と明確化する（下表§1参照）。TreasuryDirectは公開APIを持つため実装難度は低い見込み（§5参照）。

## 1. 最小リスト（29イベント→15の発表元に集約、+将来対応の米財務省を含め16元）

### 優先度A — ★★★イベントを直接持つ発表元（停止スケジュールの根幹。最優先実装）

| # | 発表元 | サイト | 担当イベント（ground truth） | ★★★件数 | 実測結果（§5） |
|---|---|---|---|---|---|
| A1 | 米労働統計局（BLS） | bls.gov | CPI・PPI・雇用統計（NFP）＋JOLTS（★★） | 5 | ❌ robots.txt自体が403（インフラ側ブロック） |
| A2 | 豪州準備銀行（RBA） | rba.gov.au | 政策金利・声明・四半期報告・総裁会見・下院証言 | 4 | ✅ 到達・実データ確認 |
| A3 | 米国勢調査局（Census Bureau） | census.gov | 小売売上高＋貿易収支（★★） | 1 | ✅ 到達・実データ確認（RSS/JSON追加発見） |
| A4 | 英国家統計局（ONS） | api.beta.ons.gov.uk | GDP速報値 | 1 | ✅ 到達・構造化JSON API確認 |
| A5 | ニュージーランド統計局（Stats NZ） | stats.govt.nz | 雇用統計 | 1 | ✅ 到達・実データ確認（用語未特定） |
| A6 | カナダ統計局（Statistics Canada） | statcan.gc.ca | 雇用統計＋国際商品貿易（★★） | 1 | ✅ 到達・実データ確認 |
| A7 | 豪州統計局（ABS） | abs.gov.au | 貿易収支（Q2決定で★★★） | 1 | ✅ 到達・構造確認（用語未特定） |
| A8 | ISM | ismworld.org | 製造業/非製造業景況指数 | 2 | ⚠️ robots許可だが実ページはCAPTCHA付きログインへリダイレクト |
| A9 | 日本銀行（BOJ） | boj.or.jp | 主な意見（★★★）＋議事要旨（★★） | 1 | ✅ 到達・実データ確認 |

→ 9元中7元が実データ取得まで確認できた。BLS・ISMの2元は代替手段が必要（§5-4）。

### 優先度B — ★★のみの発表元（検収基準1の100%捕捉に必須。停止スケジュールには非影響）

| # | 発表元 | サイト | 担当イベント | ★★件数 |
|---|---|---|---|---|
| B1a | 米財務省（TreasuryDirect） | treasurydirect.gov | 米国債入札（3・10・30年等） | 実運用で発生（既刊2週には非該当・§0参照） |
| B1b | 日本財務省（MOF・JGB） | mof.go.jp | 10年・30年利付国債入札 | 2 |
| B2 | FRB（理事講演カレンダー） | federalreserve.gov | 理事講演（例: クック理事） | 1 |
| B3 | S&P Global（Caixin/RatingDog中国PMI） | ※要確認 | 中国製造業/非製造業PMI | 2 |
| B4 | S&P Global／CIPS（英建設業PMI） | ※要確認 | 英建設業PMI | 1 |
| B5 | ADP Research Institute | adpemploymentreport.com | ADP雇用統計 | 1 |
| B6 | Ivey Business School（Western大学） | ※要確認 | IveyPMI | 1 |

→ B1b〜B6で既刊の残り8件を回収。A+Bで29/29件。B1aは既刊には無いが実運用のため追加。

**懸念点**: 既刊2週だけで15〜16の異なる発表元が必要。`config/officials.json` にはECB・BOE・BOC・SNBなど、この2週には登場しないが将来週には出てくる中銀も含まれており、実運用では発表元がさらに増える。個別スクレイパーを保守するのは現実的ではないため、下記2の方式を採用する。

## 2. 実装方式 — 個別スクレイパーではなく設定駆動フレームワーク

`scripts/checkers/`配下に発表元ごとの専用コードを書くのではなく、**共通ハーネス＋`config/official-sources.json`（発表元ごとのURL・抽出ルール・kindマッピングを記述）**の構成を採用する（しょうさん承認済み）。理由:

- 将来の中銀・国が増えても新規コード追加ではなく設定追加で対応できる
- 各チェッカーの挙動（取得間隔・リトライ・キャッシュ・失敗時WARN/HOLD判定）を共通化でき、SPEC §3.6のアクセス設計を1箇所で担保できる
- 開発順序を「サイト構造の実測→config記述」に統一でき、Phase 0のみんかぶ/FF実測と同じ型で進められる

**年次スケジュールconfig型の採用（しょうさん承認済み）**: §5の実測で、BOJ・Census(PFEI)・Statistics Canadaは年次〜15ヶ月超先までの確定日程を事前公表していることを確認した。これらは週次スクレイピングでなく、**年1回の公式年次スケジュールを`config/official-sources.json`に取り込み、対象週との照合だけを週次で行う**方式とする。残量監視（対象週+4週先までの日程がconfigに無ければWARN）はSPEC §3.5・`docs/annual-schedule-maintenance.md` に規定済み。ISM等の民間指数機関も同様の年次固定日程方式が使えるか、実装時に個別確認する。

## 3. 実装順

1. ~~サイト実測~~ **完了（2026-08-14）**: A1〜A9の9元の到達性・取得方式を実測（§5）
2. ~~`config/official-sources.json` 設計＋共通ハーネス実装~~ **完了（2026-08-14）**: §6参照
3. **優先度A（A2・A3・A4・A5・A6・A7・A9の7元）の実装＋既刊2週での照合テスト**（次のタスク）: 到達確認済みの7元について`scripts/checkers/harness.mjs`のweekly_scrapeソース用に発表元別の抽出ルールを実装し、★★★のうちBLS担当分を除く大半の捕捉を確認
4. **BLS・ISMの代替手段確立**: BLSはUser-Agent変更等の追加調査またはiCalフィード（bls.ics）の別経路確認、ISMは年次固定日程（1st/3rd business day rule）方式で回避。この2元が埋まった時点で★★★13件・100%捕捉が完成
5. **優先度B（B1a・B1b〜B6）のサイト実測→実装**: 残り8件（★★）＋将来運用のB1aを回収し検収基準1（29/29件）を満たす
6. **`config/event-names.json`の実データ照合の残り**: AU trade_balance・NZ employment_situationは実データ照合済み（§5-3）。残るUS employment_indicator(JOLTS)・US pmi_ism(ISM Services)・優先度B系5件（CN PMI×2・GB建設業PMI・CA Ivey・US ADP）は優先度B実装時・ISM年次確認プロセス確立時に確認
7. **将来拡張分（officials.json記載だがこの2週には未出現の中銀: ECB・BOE・BOC・SNB）は、共通フレームワークへのconfig追加のみで対応**（優先度A/B完了後、並行運用開始までの間に着手）

## 4. 未解決の実装上の注意点（設計時に解決）

- 国債入札の命名規則（SPEC §4.2「入札=『米{年限}債入札』」）は米国債を前提にしているが、既刊8/3週の実例は日本のJGB入札。命名テンプレートは国別に分岐が必要（例: 日本=「{年限}利付国債（{年月}債）の入札」、米国=「米{年限}債入札」）。レンダラー実装時に反映する
- ISM等、優先度Aだが民間発表元のものは、政府統計機関と異なりリリース日程の公式APIがない場合がある（§5-4参照）

## 5. 優先度A・9元の実測結果（2026-08-14、Actions run 31783819083/31784090122/31784382820）

実測方式: robots.txtを対象ホストごとに先取得・解析（HTTP 404は「制限なし」として許可扱い、それ以外の失敗は慎重側に倒しSKIP）→許可パスのみ最小限フェッチ（1500ms間隔）。詳細は `scripts/phase1/source-recon.mjs`。

| ソース | robots.txt | 実データ取得 | 形式 | 年次固定日程 | 備考 |
|---|---|---|---|---|---|
| BLS | **403（ブロック）** | ❌ | ― | 年次ページ確認済み（既知）＋iCalフィード(bls.ics)の存在を確認 | robots.txt自体がAzure系IPからの取得で403。UA変更やiCal直接取得など代替経路の追加調査が必要 |
| RBA | 200・許可 | ✅ 23,737B HTML | HTML表 | 毎年、翌年分を媒体発表（例: 2025年に2026年分公表） | `schedules-events/board-meeting-schedules.html`。議会証言（下院経済委員会）は別途aph.gov.au（豪州議会）側の告知が必要 |
| Census | 200・許可 | ✅ PFEI PDF(266KB)・calendar-listview.html(91KB)・**RSS(10KB)** | PDF＋HTML＋**RSS発見** | PFEI（政府横断スケジュール）が毎年9月頃に翌年分公表 | calendar-listview.htmlに`econcards/assets/xml/indicator.xml`というRSSリンクを発見・取得成功。実データで「U.S. International Trade in Goods and Services」表記を確認 |
| ONS | 404→許可扱い | ✅ **構造化JSON API** 8,113B | **JSON（api.beta.ons.gov.uk/v1/search/releases）** | 統計実施規範で12ヶ月ローリング事前公表＋4週間前確定 | 9元中最良の形式。release_date・date_changes（訂正履歴）まで含む本格API。実データでGDP関連リリース（Blue Book等）を確認 |
| Stats NZ | 200・許可（Crawl-delay:10） | ✅ 53,580B HTML | HTML | 長期リリース計画ページの存在確認済み・horizon未確定 | `release-calendar/`。雇用統計の英語表記は今回の検索語では本文中に未検出（要再調査） |
| Statistics Canada | 200・許可（Crawl-delay:2） | ✅ release_schedule_html(20.7KB) ／ annual_schedule_pdf相当URLは**HTML着地ページに転送**(17.7KB) | HTML＋**PDFは中間ページ経由**（直リンク不可） | 「2026-2027 release dates」PDFで15ヶ月超先まで公表 | `n1/release-diffusion/2026-eng.pdf`への直接GETは実PDFではなく「Alternative format」という中間HTMLページを返す。実PDFへは追加のリンク解決が必要（実装時対応）。実データで「Canadian international merchandise trade」「Labour Force Survey」を確認 |
| ABS | 200・許可 | ✅ 142,310B HTML | HTML | 向こう6ヶ月分のみ公表との調査結果（年次config化には不十分な可能性） | `release-calendar/future-releases-calendar`。正式リリース名は「International Trade in Goods」と確認済み（§5-3） |
| ISM | 200・許可（robots.txt上は問題なし） | ⚠️ **実ページはCAPTCHA付きログインへリダイレクト** | ― | 製造業=毎月第1営業日、非製造業=第3営業日・米東部10:00が既定則 | `rob-report-calendar/`が`ecommerce.ismworld.org/SSO/Login.aspx`（reCAPTCHA）へ転送される。単純HTTPフェッチでは取得不可。年次固定日程（1st/3rd business day rule）で計算し、祝日ずれのみ別途確認する方式を推奨 |
| BOJ | 404→許可扱い | ✅ mpm_2026_schedule_pdf(284.6KB)・mpm_index(42KB) | PDF＋HTML | 毎年7月31日に翌年8回の会合日程を公表 | `mopo/mpmsche_minu/`配下。両ターゲットとも正常取得 |

### 5-1. 総括

- **7/9元が実データ取得まで確認**（RBA・Census・ONS・Stats NZ・Statistics Canada・ABS・BOJ）
- **ONSが最良**: 本格的な構造化JSON APIで、リリース日の訂正履歴まで追跡できる
- **Censusは想定以上に充実**: PDF年次スケジュールに加え、HTML・RSSの3系統で冗長性がある
- **BLS・ISMの2元は単純HTTPフェッチ不可**（BLSはインフラ側403、ISMはCAPTCHA）。§3の実装順どおり代替手段を別途確立する
- **Statistics CanadaのPDF URLは中間HTMLページに転送**される（直リンクでバイナリを取得できない）。実装時は中間ページから実PDFリンクを解決する1ステップを追加する

### 5-2. マナー遵守の記録

- 全アクセスはrobots.txt確認後のみ実施（HTTP 404は標準解釈どおり「制限なし」扱い、403等の取得失敗は慎重側に倒し対象パスをSKIP）
- 1ソースあたり最大3リクエスト（robots.txt＋対象1〜3ページ）、間隔1500ms
- 3回のrun（全9元→バグ修正後再実測→名称照合のためCensus/StatsNZ/StatCanのみ再実測）を通じて、同一パスへの重複アクセスはrobots.txtキャッシュにより抑制。総アクセス回数は9元合計で約35リクエスト程度（3回のrunの合算）

### 5-3. config/event-names.json 実データ照合結果（確認事項5・2への回答）

| 項目 | 結果 |
|---|---|
| US trade_balance | ✅ 確認・true化。Census実データ「U.S. International Trade in Goods and Services」「Advance U.S. International Trade in Goods」 |
| CA trade_balance | ✅ 確認・true化。Statistics Canada実データ「Canadian international merchandise trade」 |
| CA employment_situation | ✅ 確認・true化。Statistics Canada実データ「Labour Force Survey」 |
| **AU trade_balance** | ✅ **確認・true化（2026-08-14追加）**。ABS公式ページ確認の結果、正式名称は**「International Trade in Goods」**（月次・サービス収支は非含有）。2023年9月分以前の旧称「International Trade in Goods and Services, Australia」もmatchの部分文字列として引き続き一致する。四半期の「Balance of Payments and International Investment Position, Australia」は国際収支の包括統計で別リリースのため対象外と確認。既刊の日本語表記「貿易収支」はこの月次リリースに対応 |
| **NZ employment_situation** | ✅ **確認・true化（2026-08-14追加）**。Stats NZ公式ページ確認の結果、正式名称は**「Labour market statistics: {月} {年} quarter」**（例: 'Labour market statistics: June 2026 quarter'）。旧称「Household Labour Force Survey」は現在は調査手法名・別の狭いリリース（人口ベンチマーク値のみ）の名称であり、本体リリースのタイトルとしては使われていないためmatchから除外。四半期末から約5週間後に公表。既刊の日本語表記「雇用統計」はこのリリースに対応 |
| US employment_indicator (JOLTS) | ❌ 未確認（BLSブロックのため）。優先度Bソース確立後に確認 |
| US pmi_ism (ISM Services) | ❌ 未確認（ISMブロックのため）。ISM年次確認プロセス確立後に確認 |
| CN pmi_ism ×2・GB建設業PMI・CA Ivey・US ADP | ❌ 未確認（いずれも優先度Bソース未実装のため） |

AU・NZの2件は今回、実際の公式ページ見出し・リリース名を確認したうえで登録した（推測での登録は行っていない）。残り7件は優先度B実装時・ISM年次確認プロセス確立後に順次確認する。

### 5-4. BLS・ISMの代替手段（2026-08-14最終確定・しょうさん承認済み）

#### BLS → FRED採用（2026-08-14最終確定・PASS）

**方針**: UAを偽装してrobots.txt/WAFのブロックを回避することはしない（サイト側の拒否を偽装で回避しない、という本プロジェクトの一貫方針）。第一候補としてFRED（Federal Reserve Bank of St. Louis）の公式APIを検討した。

**事前に固定した合否基準（しょうさん指示）**: CPI(10)・PPI(46)・雇用統計(50)の3リリースすべてで、(a) 実行日から2ヶ月先までの未来日程を含む、(b) 既刊2週の実際の発表日（精度検証アンカー: CPI=2026-08-12・PPI=2026-08-13・雇用統計=2026-08-07）を含む、の両方を満たすことを合格条件とした。

**検証の経緯**: 1回目・2回目のActions runは`{"error_code":400,"error_message":"Bad Request. The value for variable api_key is not registered."}`で失敗（診断ログでスクリプト側の空白混入等は排除済み）。合否基準どおり一度はFAILと判定し、第二候補Census PFEIへの切替を設計・文書化した。その後しょうさんより「APIキーの貼り間違えだった」と判明し、GitHub Secretsのキーを正しい値に登録し直した上で3回目のライブ検証を実施。

**3回目（キー修正後）のライブ検証結果 → 全項目PASS**:

| リリース | 2ヶ月先カバー | 精度一致（既刊実績日） | 判定 |
|---|---|---|---|
| CPI (id=10) | true | true（2026-08-12を含む） | PASS |
| PPI (id=46) | true | true（2026-08-13を含む） | PASS |
| 雇用統計 Employment Situation (id=50) | true | true（2026-08-07を含む） | PASS |
| [参考・合否対象外] JOLTS (id=192) | true | - | 参考PASS（副産物） |

返却された日程（抜粋）: CPI=`["2026-07-14","2026-08-12","2026-09-11","2026-10-14","2026-11-10"]` / PPI=`["2026-07-15","2026-08-13","2026-09-10","2026-10-15","2026-11-13"]` / 雇用統計=`["2026-07-02","2026-08-07","2026-09-04","2026-10-02","2026-11-06"]` / JOLTS=`["2026-08-04","2026-09-01","2026-09-29","2026-11-03"]`

**→ 判定: PASS。FRED採用を確定する。JOLTSもrelease_id=192で日程取得可能なことを確認済みのため、BLS系4指標（CPI・PPI・雇用統計・JOLTS）すべてFREDでカバーする。**

**FRED採用設計**:
- (a) **日付**: FRED `GET /fred/release/dates?release_id=...&api_key=...`（release_id: CPI=10, PPI=46, Employment Situation=50, JOLTS=192）。JSON形式で直接取得でき、Census PFEI（PDF）のようなパーサー実装は不要
- (b) **発表時刻**: 指標別固定時刻を`config/official-sources.json`に保持（米CPI/PPI/雇用統計・JOLTS=08:30 ET が慣行値）し、`scripts/lib/tz-convert.js`でDST対応のJST換算を行う
- (c) **ドリフト検知**: 月曜FF事後突合（SPEC §3.3）で(a)(b)の組み合わせ結果とFF実データを突合し、相違があれば`discrepancy-report.json`に記録

**限界事項（SPEC/docsに明記が必要。しょうさん指示）**: FREDを含め公的機関の日付ソースは「日付のみ」を提供し、**発表時刻はconfig固定値に依存する**。この固定時刻が実際の発表時刻とズレた場合（稀だが発表元が慣行時刻を変更する可能性はゼロではない）、**日付ソース自体はエラーを検知できず、唯一の検知手段は月曜FF事後突合**（SPEC §3.3）である。月曜突合は「対象週が実際の当該週になった後」の事後検証のため、当該週の配信物には誤った停止目安が反映されたまま出てしまう可能性がある。この限界は許容している（HANDOFF §1検収基準・SPEC §3のフェールクローズ設計の範囲内）が、明示しておく。

**Census PFEIの扱い**: Phase 1実測（§5）で到達性・年次公表パターン（PDF、毎年9月頃に翌年分公表）は確認済みのため、調査結果は本ドキュメントに記録として残す。ただしBLS代替としてはFREDが採用されたため、PFEIは今回は実装しない。将来的に別用途（他省庁横断の日程確認等）が生じた場合の参考情報として保持する。

#### ISM → 年次スケジュールconfig型に統一（しょうさん承認済み）

BOJ・Census(PFEI)・Statistics Canadaと同じ「年次スケジュールconfig型」（SPEC §3.5）に位置付ける。ISM固有のドラフト生成規則を追加する:

1. **ルールによる年間ドラフト自動生成**: 製造業PMI=各月第1営業日、非製造業(Services)PMI=各月第3営業日、いずれも米東部時間10:00。祝日カレンダー（米連邦祝日）を考慮して「営業日」を計算し、`config/official-sources.json`のISMエントリに翌年分ドラフトを機械生成する
2. **人間による年1回の照合・確定**: ドラフト生成後、**しょうさんまたはClaude Codeが年1回、ISM公式の年間カレンダーページ（`ismworld.org/.../rob-report-calendar/`）を手動で閲覧し、ドラフトと突合・確定**する（自動スクレイピングはCAPTCHAのため不可なので、この工程のみ人手を挟む）。確定後の値を`config/official-sources.json`にコミットする
3. **残量監視**: 他の年次スケジュールconfig型と同じ仕組み（対象週+4週先までの日程が無ければWARN。SPEC §3.5・`docs/annual-schedule-maintenance.md`）で、次年分の手動確定を促す
4. **ドリフト検知**: 月曜FF事後突合で実際の発表日と確定済みドラフトを突合し、祝日ずれ等の見落としを検知する

## 6. `config/official-sources.json` 設計＋共通ハーネス実装（2026-08-14完了）

実測結果（§5）とFRED採用確定（§5-4）を反映し、以下を実装した。

**`config/official-sources.json`**: 発表元ごとのレジストリ。優先度A・9元（`us_bls_fred`=FRED経由・`au_rba`・`us_census`・`gb_ons`・`nz_statsnz`・`ca_statcan`・`au_abs`・`us_ism`・`jp_boj`）に加え、優先度B・6元＋米財務省を`status:"pending_recon"`のプレースホルダとして登録済み（未実測。task #11で実装）。type別のスキーマ:
- `date_api_fred`: FRED release_id・kind対応表
- `weekly_scrape`: robots.txt確認対象URL一覧
- `annual_schedule_config`: 確定済み年次日程（`schedule`配列。ISM・BOJは実データ未抽出のため現状は空配列＝`schedule_status:"pending_extraction"`/`"pending_manual_verification"`）

指標別の現地固定発表時刻（`announce_time_by_kind`）は、既刊29イベントのJST実績時刻を各発表元の現地タイムゾーンへ逆算し、公知の発表慣行と突合して設定した（実データでの最終照合はtask #9）。

**共通ハーネス**: `scripts/checkers/harness.mjs`（type別のチェック関数＋`runChecks()`オーケストレーション）と、純粋関数として分離した以下のライブラリ:
- `scripts/lib/fail-closed.js`: SPEC §3.4のOK/WARN/HOLD判定・§3.5の残量監視・定例欠落検知
- `scripts/lib/recurring-rules.js`: `recurring_checks`ルール文字列と対象週の突合
- `scripts/lib/robots.js`: robots.txt取得・パース・許可判定（`scripts/phase1/source-recon.mjs`から抽出・共通化）
- `scripts/lib/validate-official-sources.js`: config形状検証

単体テスト30件追加（fail-closed 12・robots 10・recurring-rules 5・harness 12・official-sources-config 4件、一部重複カウント含む。`npm test`で全70件PASS）。フェッチ・robots判定は`fetchImpl`/`robotsChecker`を引数注入する設計とし、実ネットワークなしでテスト可能にした。

**現状の既知の制約**: `weekly_scrape`型ソース（RBA・Census・ONS・Stats NZ・Statistics Canada・ABS）は、robots.txt確認とフェッチまでは実装済みだが、発表元別の実データ抽出ルール（HTML/JSON→候補イベント変換）は未実装。現状は取得成功時でも「抽出未実装」として明示的に失敗を返す設計とした（誤って「イベントなし」と判定するより安全なため）。この抽出ルール実装が次タスク（§3の3番目）。`workflows-draft/weekly.yml`は引き続き`.github/workflows/`へ移設していないため、この状態のハーネスが実運用に影響することはない。

`docs/annual-schedule-maintenance.md` の年次公表時期一覧にISMの手動確定プロセスを追加する。

## 7. task #9: 発表元別抽出ルール実装＋既刊2週捕捉テスト（2026-08-14実施）

### 7-1. fixture収集

開発サンドボックスはegressブロックのため直接フェッチできないため、`.phase1-trigger`の`collect_fixtures:true`でActions上に`scripts/phase1/collect-fixtures.mjs`を実行させ、weekly_scrape対象元7ページ＋BOJ 2ページを1回だけ取得し`test/fixtures/official-sources/`へコミットさせた（Actions run 31805663418）。以降の抽出ルール開発・テストはこのfixtureをオフラインで反復利用し、追加の実アクセスは行っていない（しょうさん指示・条件3）。

### 7-2. 判定基準（しょうさん指示・条件1）と結果

合否基準: 発表日時（JST変換後の時刻まで）・重要度が既刊と完全一致すること。日本語正規名は、event-names.json経由で解決するソース（Census・ABS・FRED・ISM）は完全一致まで検証。RBA・BOJは中銀命名テンプレート（officials.json解決・期間サフィックス付与）の組み立て自体がレンダラー実装（task #12）の責務のため、本タスクでは日時・重要度・kind分類の一致までを検証範囲とした（`test/ground-truth-capture.test.js`にその旨を明記）。

| ソース | 対象イベント | 判定 | 備考 |
|---|---|---|---|
| Census (`us_census`) | US trade_balance(8/4)・US retail_sales(8/14) | ✅ 日時・重要度・名称完全一致 | `scripts/checkers/extractors/census.js` |
| ABS (`au_abs`) | AU trade_balance(8/6) | ✅ 日時・重要度・名称完全一致 | `scripts/checkers/extractors/abs.js` |
| FRED (`us_bls_fred`) | US cpi×2・ppi×2・employment_situation・employment_indicator(JOLTS) | ✅ 日時・重要度・名称完全一致 | 既存のfred-verify.mjs実測結果をfixture化して再利用 |
| ISM (`us_ism`) | US pmi_ism 製造業(8/3)・非製造業(8/5) | ✅ 日時・重要度・名称完全一致 | ルール計算ドラフト（§7-4参照。人間確認は未実施） |
| RBA (`au_rba`) | AU policy_rate・press_conference・quarterly_report(8/11) | ✅ 日時・重要度・kind分類一致（名称組立はtask #12） | §7-3参照。weekly_scrapeからannual_schedule_config型へ再分類 |
| BOJ (`jp_boj`) | JP opinions_summary(8/10)・minutes_summary(8/5) | ✅ 日時・重要度・kind分類一致（名称組立はtask #12） | §7-3参照。抽出対象をPDFからHTML(mpm_index)へ変更 |
| ONS (`gb_ons`) | GB gdp(8/13) | ⚠️ 抽出ロジックは実装・構造確認済みだが既刊日での照合は不可 | §7-5参照（方式上の制約。本番運用には影響しない） |
| Stats NZ (`nz_statsnz`) | NZ employment_situation(8/5) | ❌ 抽出不可（構造的ブロッカー） | §7-5参照 |
| Statistics Canada (`ca_statcan`) | CA trade_balance(8/4)・employment_situation(8/7) | ❌ 抽出不可（構造的ブロッカー） | §7-5参照 |
| RBA (aph.gov.au) | AU testimony(8/14) | — 対象外 | RBAではなく豪州議会側の告知が必要。別ソース（未着手） |

優先度Aで担当する20イベント中、16イベントで日時・重要度の完全一致を確認（うち14イベントは名称も完全一致）。残り4イベント（GDP・NZ雇用統計・CA貿易収支・CA雇用統計）は構造的な制約により今回は照合できず、原因を§7-5に個別記録した（推測での合わせ込みは行っていない）。

### 7-3. 捕捉テストで発見・修正した不一致（しょうさん指示・条件1: 原因別報告）

テスト実装中に以下2件の実際の不一致を検出した。いずれも「抽出ミス」に分類され、その場で修正した（既刊側の誤りではない）。

1. **US retail_sales のevent-names.json未登録（抽出ミス）**: `config/event-names.json`のUS retail_salesエントリはForex Factory側の表記（`retail sales m/m`）のみを`match`に持ち、Census公式タイトル`Advance Monthly Sales for Retail and Food Services`と一致しなかった。実データを確認のうえ`match`へ`advance monthly sales for retail`を追加して修正した。
2. **US employment_indicator の重複束ね（抽出ミス）**: FREDのrelease_id=192（JOLTS）の日付が見つかった際、`event-names.json`のemployment_indicator kindに登録された2エントリ（JOLTS・ADP）を無条件で両方候補に含めてしまい、本来無関係なADP（優先度Bソース・別発表元）まで束ねてしまうバグを検出した。`config/official-sources.json`の`fred.releases[].match_hint`（既存の`"jolts"`値）でエントリを絞り込むよう`scripts/lib/resolve-candidate.js`を修正した。

### 7-4. RBA・BOJ・ISMの追加実装（fixtureの実データ精査で判明した設計改善）

- **RBA（`au_rba`）**: 実fixtureで`board-meeting-schedules.html`が単純なweekly_scrapeではなく、BOJと同様に**年間8会合分を1ページで丸ごと公表**していることを確認した（2027年分も一部掲載済み）。`scripts/checkers/extractors/rba.js`で抽出し、typeを`weekly_scrape`から`annual_schedule_config`へ再分類、2026年分をconfigへ投入した。四半期報告(quarterly_report)を伴う月はRBAの公知の運用（Feb/May/Aug/Nov）を仮定しているが、既刊で確認できたのは8月分のみのため、他3ヶ月は月曜FF事後突合での確認待ちとして明記した。
- **BOJ（`jp_boj`）**: 当初PDFからの抽出を想定していたが、`mpm_index.htm`（HTML）の方が構造的に安定して抽出できると判明したため対象をHTMLへ変更（`scripts/checkers/extractors/boj.js`）。2026年8回・2027年一部を含む全会合分をconfigへ投入した。
- **ISM（`us_ism`）**: `scripts/lib/us-federal-holidays.js`（米連邦祝日・振替ルール込み）＋`scripts/lib/ism-schedule.js`（第1/第3営業日ルール）でドラフト自動生成を実装。既刊ground truth（製造業=8/3・非製造業=8/5）と完全一致を確認した。2026年8月〜10月分をconfigへ投入済みだが、**しょうさんによる公式カレンダーページとの目視突合・確定はまだ**（`schedule_status: "pending_manual_verification"`）。

**ISM初回手動確認のお願い（2026-08-14）**: 以下のドラフト（機械計算）を、下記URLの公式カレンダーと突合・確認してください。

- 確認先URL: https://www.ismworld.org/supply-management-news-and-reports/reports/rob-report-calendar/
- ドラフト（直近3ヶ月分）:

| 月 | 製造業PMI（第1営業日） | 非製造業(Services)PMI（第3営業日） |
|---|---|---|
| 2026年8月 | 8/3(月) ✅既刊実績と一致 | 8/5(水) ✅既刊実績と一致 |
| 2026年9月 | 9/1(火) | 9/3(木) |
| 2026年10月 | 10/1(木) | 10/5(月) |

いずれも米東部時間10:00発表の想定。確認後、問題なければ`config/official-sources.json`の`us_ism.schedule_status`を`"confirmed"`へ更新する。

### 7-5. 構造的ブロッカー（今回は解消できなかった項目・follow-up）

- **Stats NZ（`nz_statsnz`）**: `release-calendar/`の静的HTMLはナビゲーションと副次表のみを含み、実際のリリース一覧はページ読み込み後にJavaScript/APIで動的描画される（SPA構造）。埋め込みデータに`"MonthRange":{"max":"2027-02","min":"2012-07"}`というヒントがあり裏側にAPIが存在する可能性が高いが、エンドポイントは未特定。実際のAPI調査を要するfollow-upとする。
- **Statistics Canada（`ca_statcan`）**: `cal1-eng.htm`は調査名・月のプルダウンを持つ検索フォームページであり、個別の発表日程は静的HTMLに含まれない（フォーム送信後にJS/AJAXで結果を描画する構造の可能性）。年次PDF（`n1/release-diffusion/{年}-eng.pdf`）も直リンクせず中間HTML着地ページに転送されるため直接取得は不可（§5で既知）。両経路とも実装保留とし、follow-upとする。
- **ONS（`gb_ons`）**: 抽出ロジック自体は実装・構造確認済み（`scripts/checkers/extractors/ons.js`）。ただし使用中のAPIクエリ（`release-type=type-upcoming`）は実行時点より未来の日程しか返さないため、既に過去となった既刊ground truth日（2026-08-13）との直接照合はできない。本番運用では対象週は常に未来のため実害はないが、念のため明記する。

いずれの未解消ソースも、`scripts/checkers/harness.mjs`の`checkWeeklyScrapeSource`は抽出ルール未登録として明示的にok:falseを返し、SPEC §3.4のフェールクローズ規則（見込みあり→HOLD／見込みなし→WARN／複数同時失敗→無条件HOLD）へ正しく接続することをテスト済み（`test/extractor-fail-closed.test.js`）。

### 7-6. テスト

`test/extractors.test.js`（実fixtureからの抽出単体テスト）・`test/resolve-candidate.test.js`（名称・重要度・JST変換の合成テスト）・`test/ground-truth-capture.test.js`（既刊2週の統合捕捉テスト・オフライン）・`test/extractor-fail-closed.test.js`（条件2: 構造変化時のフェールクローズ接続）・`test/us-federal-holidays.test.js`・`test/ism-schedule.test.js` を追加。`npm test`で112件全PASS。

## 8. task #11: 優先度B・7元の実測・実装（2026-08-14実施）

しょうさん指示（2026-08-14）により、Stats NZ・Statistics Canadaの追加調査（task #15）より優先度Bを先行。対処順は(a)API/RSS/ICS→(b)年次PDFカレンダー→(c)Playwrightレンダリングの順で検討した。

### 8-1. 実測結果一覧

| ID | 発表元 | 到達性 | 実装状況 | 既刊ground truth照合 |
|---|---|---|---|---|
| `us_treasury` | 米財務省（Fiscal Data API） | ✅ treasurydirect.gov本体はrobots.txt`Disallow:/`で全面ブロック。別ドメインのapi.fiscaldata.treasury.gov（upcoming_auctions）が到達可能 | ✅ 実装済み（`extractors/us-treasury.js`。対象週フィルタ方式） | 既刊に米国債入札の実例なし。実データ形式のみ確認 |
| `jp_mof` | 日本財務省（JGB入札） | ✅ 月別カレンダーページ到達可能（年次一括ではなく月次ローリング公表と判明） | ✅ 実装済み（`extractors/mof.js`） | ✅ 10年債(8/4)・30年債(8/6)とも日付完全一致（時刻は既刊どおり未公表） |
| `us_frb_speeches` | FRB理事講演 | ✅ RSS `/feeds/speeches.xml` 到達可能・標準RSS 2.0 | ✅ 日時抽出は実装済み（`extractors/frb-speeches.js`）。**人名・役職解決は未実装**（§8-2参照） | ✅ クック理事講演の日時（8/6 05:05 JST）が完全一致 |
| `ca_ivey` | Ivey PMI | ✅ FAQページに平文で年間発表日一覧が直接埋め込み | ✅ 実装済み（`extractors/ivey.js`）。annual_schedule_config型へ変更・確定 | ✅ 8/7の日時・重要度・名称すべて完全一致 |
| `cn_pmi` | S&P Global（RatingDog中国PMI） | ❌ pmi.spglobal.comはrobots.txt自体403でブロック。代替候補ratingdog.cnもSPA構造で静的取得不可 | 未実装 | — |
| `gb_construction_pmi` | S&P Global／CIPS（英建設業PMI） | ❌ pmi.spglobal.comは同上ブロック。代替候補cips.orgの候補URLは404 | 未実装 | — |
| `us_adp` | ADP Research Institute | ❌ React/ViteのSPAで静的HTMLに日程データを含まない | 未実装 | — |

4/7元（米財務省・日本財務省・FRB・Ivey）で実データ取得〜抽出まで到達し、既刊ground truthとの照合が可能な3元（MOF・FRB・Ivey）すべてで完全一致を確認した。残り3元（中国PMI・英建設業PMI・ADP）はStats NZ・Statistics Canada（task #15）と同種の構造的ブロッカーのため、task #16としてfollow-up登録した。

### 8-2. 未解決の課題（合わせ込みせず記録）

- **`config/officials.json`にFRB理事（議長以外）が未登録**（task #17）: RSSから講演者の姓（Cook等）は取得できるが、SPEC §4.2の「{人名}{役職}の発言」テンプレートを適用するには正式な人名・役職の解決が必要。Phase 0のofficials.json調査と同じ厳密な方式（公式サイト＋日本語金融メディア2ソース以上のクロスチェック）で追加調査する
- **JGB／米国債の命名テンプレート組立**: 抽出は`{date, tenorJa/securityTerm, kind:'bond_auction'}`までを返す設計とした。SPEC §4.2の国別分岐テンプレート（日本=「{年限}利付国債（{発行年月}債）の入札」・米国=「米{年限}債入札」）の適用はレンダラー実装（task #12）側で行う
- **MOF月別ページの動的URL生成**: `checkWeeklyScrapeSource`は現状static targetsのみ対応のため、対象週の月に応じてURL（例: `2608e.htm`→`2609e.htm`）を動的生成する配線が未実装（`access.month_url_pattern`にパターンのみ記録済み）
- **中国PMI・英建設業PMI・ADP**（task #16）: 3元ともAPI/RSSでは解決できず、(c)Playwrightレンダリング取得の検討が必要な可能性が高い

### 8-3. テスト

`test/extractors-ivey.test.js`・`test/extractors-mof-frb.test.js`・`test/extractors-us-treasury.test.js`を追加し、`test/ground-truth-capture.test.js`にIvey/MOF/FRBの既刊照合テストを追加。`npm test`で126件全PASS。

## 9. task #15: Stats NZ・Statistics Canadaの追加調査・解決（2026-08-14実施）

しょうさん指示（2026-08-14、task #12完了後）により、§7-5で構造的ブロッカーとして記録した2元を再調査した。優先順は(a)API/RSS/ICS→(b)年次・四半期のリリースカレンダーPDF→(c)Playwrightの順（前回同様）。

### 9-1. Statistics Canada（`ca_statcan`）: (b)年次PDFで解決

§7-5の記録「年次PDF（`n1/release-diffusion/{年}-eng.pdf`）は直リンクせず中間HTML着地ページに転送される」は**誤りだった**と判明した。2026-08-14の再実測で`https://www150.statcan.gc.ca/n1/release-diffusion/2026-eng.pdf`へ直接フェッチしたところ、HTTP 200・content-type `application/pdf`・リダイレクト無しで『2026-2027 release dates Major economic releases』というPDF本体（約159KB）が取得できた。`cal1-eng.htm`自身がこのPDFへのリンクを含んでいることも確認した（前回の判断はcal1-eng.htm自体の到達性テストと混同していた可能性が高い）。

PDFにはLabour Force Survey（雇用統計）・Canadian international merchandise trade（国際商品貿易）を含む主要経済指標の発表日・対象期間が2026年1月〜2027年3月分まで掲載されている。`pdf-parse`（テキスト抽出のみの軽量な1系。プロジェクト初のnpm依存）でテキスト化し、`scripts/checkers/extractors/statcan.js`で科目ごとの「発表日{対象期間}」連結行を正規表現で抽出する方式を実装した。既刊ground truth（CA国際商品貿易2026-08-04＝2026年6月分・CA雇用統計2026-08-07＝2026年7月分）と完全一致を確認し、`ca_statcan`のtypeを`weekly_scrape`から`annual_schedule_config`へ再分類、抽出結果（trade_balance15件・employment_situation15件）をconfigのscheduleへ投入した。

これにより週次本番パイプラインでのPDF再取得は不要になった（annual_schedule_config型は残量監視WARNのみでチェックする）。

### 9-2. Stats NZ（`nz_statsnz`）: (a)(b)は不可、Stats NZ自身の公式ページ埋め込みテキストで解決

open data API（`api.stats.govt.nz`）は2024-08-30に閉鎖済みと判明し(a)は不可。年次PDFカレンダーもWebSearch・実測で発見できず(b)も不可（§7-5記載のSPA構造の問題自体は変わらず）。

一方、各四半期の情報公開ページ（例: `labour-market-statistics-june-2026-quarter`）が本文に次回リリース予定日を埋め込み公表している（Stats NZ自身の公式コンテンツ、SilverStripe CMSのブロックデータとしてHTMLエンティティ＋JSON文字列の二重エスケープで属性値に格納）ことを発見し、これを抽出対象とする方式へ変更した。`scripts/checkers/extractors/nz-statsnz.js`で「Labour market statistics: {月} {年} quarter will be released on {date}.」というパターンを抽出する（「(income)」派生系列は「statistics: 」直後に「(」が来ないことで自然に除外される）。

ground truth検証: 現在の対象四半期（2026年6月期、`labour-market-statistics-june-2026-quarter`）のページは既に発表済みのため、自身の発表日は予告しない（次サイクルの2026年9月期分のみを予告）。そのため前四半期（2026年3月期）ページを別途取得して検証したところ、「Labour market statistics: June 2026 quarter will be released on 5 August 2026」という埋め込みテキストがあり、ground truth（`nz_labour_q2_20260805`）と完全一致した。

この方式は`config/official-sources.json`の`nz_statsnz.type`を`weekly_scrape`のまま維持し、`access.targets`が常に「直近に公表された四半期ページ」を指すよう**四半期ごとの手動URL更新**が必要（`docs/annual-schedule-maintenance.md`のStats NZ固有の手順を参照）。annual_schedule_config型のような残量監視の仕組みはまだ無いため、当面は定期確認が必要（follow-up）。

### 9-3. これで未解決5元のうち2元（Stats NZ・Statistics Canada）を解決

task #11終盤時点の未解決5元（Stats NZ・Statistics Canada・中国PMI・英建設業PMI・ADP）のうち、Stats NZ・Statistics Canadaの2元を解決した。残る3元（中国PMI・英建設業PMI・ADP、いずれも★★のみ）はtask #16のfollow-upとする。

`nz_statsnz`・`ca_statcan`がともに構造的失敗を返し続けていた状態（毎週2件同時失敗＝SPEC §3.4の無条件HOLDが必ず発動し、実装が完了するまで一度もOK配信できなかった問題）はこれで解消された。

### 9-4. テスト

`test/extractors-statcan.test.js`（実fixture=年次PDFからの抽出単体テスト）・`test/extractors-nz-statsnz.test.js`（実fixture=情報公開ページ2種からの抽出単体テスト）を追加。`test/ground-truth-capture.test.js`の該当テストを更新（旧: 両ソースとも抽出ルール未登録でok:false → 新: 実際の抽出結果を既刊ground truthと照合）。`npm test`で162件全PASS。
