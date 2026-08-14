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
2. **`config/official-sources.json` 設計＋共通ハーネス実装**（次のタスク）: 実測結果をもとにURL・抽出ルール・kindマッピングのスキーマを確定し、`scripts/checkers/`の共通取得・パース基盤を実装。BLS・ISMは代替手段（§5-4）を組み込む
3. **優先度A（A2・A3・A4・A5・A6・A7・A9の7元）の実装＋既刊2週での照合テスト**: 到達確認済みの7元を先行実装し、★★★のうちBLS担当分を除く大半の捕捉を確認
4. **BLS・ISMの代替手段確立**: BLSはUser-Agent変更等の追加調査またはiCalフィード（bls.ics）の別経路確認、ISMは年次固定日程（1st/3rd business day rule）方式で回避。この2元が埋まった時点で★★★13件・100%捕捉が完成
5. **優先度B（B1a・B1b〜B6）のサイト実測→実装**: 残り8件（★★）＋将来運用のB1aを回収し検収基準1（29/29件）を満たす
6. **`config/event-names.json`の実データ照合の残り**: US employment_indicator(JOLTS)・US pmi_ism(ISM Services)・AU trade_balance・NZ employment_situationの4件が未照合（§5-5参照）。B系実装時・BLS/ISM代替確立時に併せて確認
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
| ABS | 200・許可 | ✅ 142,310B HTML | HTML | 向こう6ヶ月分のみ公表との調査結果（年次config化には不十分な可能性） | `release-calendar/future-releases-calendar`。到達は確認したが今回の名称検索語ではAU trade_balanceの実表記は未特定 |
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

### 5-3. config/event-names.json 実データ照合結果（確認事項5への回答）

| 項目 | 結果 |
|---|---|
| US trade_balance | ✅ 確認・true化。Census実データ「U.S. International Trade in Goods and Services」「Advance U.S. International Trade in Goods」 |
| CA trade_balance | ✅ 確認・true化。Statistics Canada実データ「Canadian international merchandise trade」 |
| CA employment_situation | ✅ 確認・true化。Statistics Canada実データ「Labour Force Survey」 |
| US employment_indicator (JOLTS) | ❌ 未確認（BLSブロックのため）。代替経路確立後に確認 |
| US pmi_ism (ISM Services) | ❌ 未確認（ISMブロックのため）。代替経路確立後に確認 |
| AU trade_balance | ❌ 未確認。ABSは到達確認済みだが今回の検索語では本文中に実表記が見つからず。ABS個別の名称検索が必要 |
| NZ employment_situation | ❌ 未確認。Stats NZは到達確認済みだが今回の検索語では本文中に実表記が見つからず。ページ構造の精査が必要 |

残り4件はPhase 1実装（優先度B・BLS/ISM代替手段確立）と合わせて確認する（§3手順6）。

### 5-4. BLS・ISMの代替手段（検討事項）

- **BLS**: robots.txt自体が403。本番Actionsランナーは実測時と同じAzure IPレンジのため、同じ制限を受ける可能性が高い。対応候補: (a) 実ブラウザに近いUser-Agent/ヘッダーでの再試行、(b) `bls.ics`（iCalフィード）が別ドメイン/別経路で配信されていないか調査、(c) 上記いずれも不可の場合はBLS担当イベント（CPI・PPI・雇用統計・JOLTS）をPFEI（Census経由の政府横断スケジュール、実データ取得済み）で代替できないか検討——PFEIはBLS発表分の日程も含む政府横断スケジュールのため、発表元表記は変わるが日程取得の代替になり得る
- **ISM**: robots.txtは許可だが実ページがCAPTCHA。年次固定日程（製造業=毎月第1営業日、非製造業=第3営業日、米東部10:00、祝日ずれのみ例外）を`config/official-sources.json`に組み込み、日々のスクレイピングを行わない方式を採用する。祝日ずれの検知は限定的な頻度（年数回）でのアクセスに抑えられる
