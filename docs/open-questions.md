# open-questions — しょうさんへの確認事項

記載ルール: SPECで判断できない事項のみ記録（HANDOFF §7）。回答をもらった項目は「決定」欄に記入し、SPEC/configへ反映後クローズする。

---

## 【2026-08-14 追記】Phase 1優先度A実測完了・5点確認事項への回答反映

- **Q1（既刊イベントの国債入札）**: 既刊29イベントはすべて日本JGB入札。米国債入札は既刊には無いが実運用では発生するカテゴリのため、優先度Bに米財務省（TreasuryDirect）を追加した。詳細は `docs/phase1-official-sources.md` §0
- **Q2（年次スケジュールconfigの残量監視）**: SPEC §3.5に反映済み（対象週+4週先までの日程がconfigに無ければWARN）。運用手順は `docs/annual-schedule-maintenance.md`
- **Q3（フェールクローズの精緻化）**: SPEC §3.4に反映済み（発生見込みの有無で分岐、複数ソース同時失敗は無条件HOLD）
- **Q4（実測時のマナー）**: robots.txt確認を先取得・解析するActionsスクリプトで実施。9元中2元（BLS・ISM）がrobots.txt自体のブロックまたは実ページのCAPTCHAで到達不可と判明。代替経路は `docs/phase1-official-sources.md` §5-4に記載
- **Q5（event-names.jsonの照合）**: 実データ照合を実施。US trade_balance・CA trade_balance・CA employment_situationの3件をtrue化。残り4件（JOLTS・ISM Services・AU trade_balance・NZ employment_situation）はBLS/ISMブロックとABS/StatsNZ個別調査待ちのため未確認（`docs/phase1-official-sources.md` §5-3）

---

## 【2026-08-14 上位決定】みんかぶFXを収集ソースとして恒久不使用

しょうさん決定: みんかぶへの許諾問い合わせは行わない。みんかぶは収集ソースとして恒久不使用とする。

反映内容（すべて実施済み）:
1. みんかぶアダプタは実装しない（設計上の差し替え口は空実装で残す）。取得済みキャッシュ（Actions artifact）は開発時の構造参照のみに使い、コミット物・成果物には一切含めない
2. `show_prev_forecast=false` を恒久デフォルトに変更（SPEC §7・`config/report-policy.json`）。前回値・市場予想はリンク誘導方式で確定
3. 統計指標の検出も公式ソース収集を本則に変更（SPEC §3全面改訂）。Forex Factoryは存在・時刻の突合＋月曜事後突合用途に後退
4. 統計指標の日本語名は新設 `config/event-names.json`（英名→日本語正規名辞書）で対応。未登録イベントはWARN＋掲載除外（推測命名禁止）。既刊2週と旧命名ポリシーからseed
5. 重要度はみんかぶ★写像を廃止し、校正済みの自前ルール（event kind × country）を唯一の重要度源に昇格（`config/importance-rules.json` 改訂）
6. 公式チェッカーの実装前に「対象発表元の最小リスト・実装順」を提案 → 本メッセージの回答として提示（`docs/phase1-official-sources.md`）

この決定により、旧Q1・Q3・Q4は下記のとおり内容が置き換わる形でクローズする。

---

## Q1（旧: FF翌週分不可時の本則）→ 決定・クローズ

- **決定**: 承認。土曜実測でFF翌週分が取得不可と確定した場合、統計・発言系ともに公式ソースチェッカーを本則とする（上位決定3に統合）
- **月曜事後突合**: 採用。仕様確定:
  - FF thisweek（月曜時点では対象週分を指す）と配信済み台帳（`data/ledger/`）を突合
  - 相違ゼロ→静かに成功（ログのみ）
  - 相違あり→`discrepancy-report.json`（イベント名・掲載時刻→正時刻の訂正リスト）を出力してrun失敗＋通知。しょうさんがWordPress掲載済み記事を手動訂正できる形式
  - cron分は人気分（0・5の倍数・15・30・45）を回避。FFレート制限（5分2req）を月曜run含め順守
- **土曜実測でFF翌週分が取得できた場合**: FFを検出補助に復帰させてよい（実測優先）
- SPEC §3.2・§3.3に反映済み

## Q2（重要度の仮置き2件）→ 決定・クローズ

- **豪貿易収支（AU trade balance）=★★★**: 恒常ルールとして採用（既刊踏襲・AUD系EAの運用実態に合致）
- **FOMC議事録=★★★**: 日銀「主な意見」と同じクラス（opinions_summary）として統一
- いずれも `config/importance-rules.json` に「運用実測で降格可」のコメント付きで反映済み

## Q3（data/cacheへのみんかぶ生データコミット保留）→ 決定・クローズ（恒久化）

- **決定**: 承認・恒久化。みんかぶ由来のデータ（生HTML・数値とも）はコミット物すべて（ledger・output・preview）に含めない。Actions artifact内のみで扱う
- SPEC §3.6に反映済み

## Q4（許諾待ち期間のPhase 1進め方）→ 上位決定により置き換え・クローズ

- 許諾問い合わせ自体を行わないため、この論点は解消。みんかぶへの実アクセスは今後も行わない

## Q5（FFレート制限を踏まえた本番取得設計）→ 決定・クローズ

- **決定**: 承認。週1回取得・リトライは5分以上間隔・キャッシュ優先・失敗時HOLDで実装

---

## 残オープン項目

### O1. FF週境界の実測 → 決定・クローズ（2026-08-17）

木曜・土曜08:06 JST（本番想定時刻）・日曜08:02 JST・月曜08:02 JSTの4回の自動計測が完了（`docs/phase0-findings.md` 項目2）。**結論**: `ff_calendar_thisweek.json`の週境界切替は日曜夜〜月曜早朝JST（`Last-Modified`ヘッダから月曜07:42 JST以前と特定）に発生し、本番実行時刻（土曜08:06 JST）には対象週（翌週月〜金）の情報は構造的に取得できない。SPEC §3.2/§3.4の記述（公式チェッカー本則・FFは月曜事後突合用途）はこの実測結果と整合しており変更不要。月曜事後突合（SPEC §3.3）は月曜朝の時点でthisweekが対象週分を指すことが確認できたため設計どおり機能する（task #39で実データ突合を実施し動作確認済み）。

### O3. RBNZ発表時刻14:00 NZTの一次ソース直接照合 → 決定・クローズ（2026-08-15）

- **決定**: 承認。しょうさんが直近のMPSページ（2026年5月分）を直接確認したが、公式ページ本文に時刻表記自体が
  無いことを確認（Claude Codeの実測＝robots.txt 403で照合不可、という結果と整合）。RBNZは公式ページ本文に
  発表時刻を明記しない運用と判断し、14:00 NZ時間（複数の第三者ソースで裏付け済み）を慣行値として採用する
- **反映**: `config/official-sources.json`のrbnz_policy_rate.announce_time_by_kind.policy_rate.noteに
  「時刻は慣行値・公式ページ本文に明記なし・第三者複数ソースで裏付け」である旨を明記済み
- **検知経路**: 初回発生週（2026年9/2週）は土曜配信→月曜のFF事後突合run（Q1・SPEC §3.3）がRBNZの実際の
  発表時刻をFFフィードと照合するため、万一14:00と異なる場合は発表2日前（月曜）の時点で自動検知される
  （discrepancy-report.json経由）。これを本項目のクローズ根拠とする

### O4. 「既刊・Manus版は正解データではない」の実例確認 → 決定・クローズ（2026-08-30）

8/31週のManus版突合（しょうさん実施）で、EU HICP速報値の発表時刻についてManus版は22:00 JST（15:00 CET相当）と表示し、各イベントに「🟢確認済み 一次情報」のマークを付けていたことが判明した。しかし運用者（しょうさん）による実測確認の結果、正しい時刻は18:00 JST（11:00 CET/CEST）であり、Manus版の表示・マーク双方が誤りだった（`config/official-sources.json`のeurostat_hicp.announce_time_by_kind.cpi.note参照。ECBのstatscalページ記載の15:00 CETは季節調整値専用の公表時刻であり、市場が反応するEurostat自身のflash estimateとは別物だったことが根本原因）。

- **結論**: 一次情報確認済みという表示（Manus版の「🟢確認済み 一次情報」マーク）があっても誤りは混入し得る。既刊レポート・Manus版は自動版の正解データ（ground truth）として扱わない、という以前からの運用方針（`docs/validate-scripts-guide.md`「既刊レポートの位置づけ」参照）は、この実例により裏付けられた
- **反映**: 突合作業は今後も「両者を独立に一次情報で検証し、相違があれば都度どちらが正しいか個別に確認する」方式を継続する。Manus版と一致すること自体を正しさの根拠にしない
- 本件では自動版（本システム）がManus版の誤りを検出する側になった初の実例として記録する

### O5. 月末注意喚起（task #82）: 英国銀行休業日を考慮した判定が実例で効いた

しょうさん指示（2026-08-29、修正1）: 月末営業日の判定に週末だけでなく英国（England and Wales）銀行休業日（`config/gb-bank-holidays.json`、GOV.UK公式データ）も除外するよう修正した。実装後、この修正が実例で効くケースが直ちに見つかった:

- **2026-08-31（月）自体が英国銀行休業日（August Bank Holiday）**。ロンドンフィックス（WM/Reuters 4pm Fix）はロンドン市場で行われるため、同市場が休みのこの日はフィックス自体が前営業日へ移る。週末のみを考慮する設計であれば、8/31は平日のため「8月の月末営業日」と誤って判定され、実際には市場が開いていない日を基準にした誤った注意喚起が8/31週のレポートに出力されていたことになる
- 正しい8月の月末営業日は前週の**2026-08-28（金）**であり、`detectMonthEndNotice('2026-08-31','2026-09-04')`は`null`を返す（8/31週には注意喚起が出ない、が正しい挙動）。しょうさん自身が当初「8/31週が実例として使える」としていた想定も、この祝日考慮によって覆った（実装完了後に判明し、しょうさんへ報告済み）
- **教訓**: 「週末だけを除外すれば足りる」という直感的な設計は、月末が祝日と重なる月（既に2026年だけでも8月がこれに該当）で実際に誤作動する。月末営業日を扱う機能は、対象市場（本件はロンドン）の祝日カレンダーを必ず参照する必要がある。既存のGB祝日データ活用（flash-PMI実装、task #53）と同じ教訓が月末注意喚起でも再確認された形

**反映**: `scripts/lib/month-end-notice.js`のmonthEndBusinessDay()に実装済み（`gbBankHolidaysMaxYear() < y+1`でフェールクローズ）。回帰テストは`test/month-end-notice.test.js`の「2026年8月は8/31が英国銀行休業日のため8/28（金）になる」で固定化済み

### O6. official_speechの姓ベース照合に国スコープが無かった構造的欠陥 → 修正・クローズ（2026-08-30）

しょうさん指摘: BOEのAndrew Bailey（総裁）/David Bailey（別人のExecutive Director）が同一フィードに混在していた実例（task #72）を受け、officials.jsonの姓ベース照合を使っている箇所を横断監査した。

- **発覚した欠陥**: `scripts/lib/naming.js`の`resolveOfficialBySurname(officials, surnameEn)`は、countryを一切考慮せず`officials.json`の全件から`full_name`部分一致で検索していた。呼び出し元`scripts/lib/build-ledger.js`の2箇所（`resolveOfficialSpeechImportance`・`resolveRuleGeneratedName`）とも`candidate.country`を渡していなかった。実際に確認したところ、`candidateToLedgerEvent`で country=US・speakerLastName="Bailey" という（架空の）候補を通すと、国を問わず英国総裁のfull_name「アンドリュー・ベイリー（Andrew Bailey）」に部分一致し、誤って「BOE総裁」として★★★に解決されることを実証した。BOEの同姓別人問題（Andrew/David、同一国内）よりも広い、**任意の国をまたいだ姓の偶然一致**という構造的な脆弱性だった
- **FRB・BOJ個別の実データ調査**（WebSearch）: FRB現行理事会（Warsh・Jefferson・Bowman・Barr・Cook・Waller）、BOJ政策委員会（総裁植田・副総裁内田/氷見野・審議委員田村/高田/浅田/佐藤ほか、2026年3月・6月に一部交代）とも、現時点で登録済み総裁の姓と偶然衝突する実在の同僚は確認できなかった（内田副総裁が未登録である点は別途の登録漏れとして留意）。ただし偶然衝突が無いことは将来にわたる保証にはならないため、country引数を必須化する修正を優先した
- **修正**: `resolveOfficialBySurname`にcountry引数を追加（未指定時はフェールクローズで一致なし）。build-ledger.jsの2呼び出し箇所を`candidate.country`を渡すよう修正。既存テスト（test/naming.test.js・test/extractors-boe-speeches.test.js）の直接呼び出し箇所も country引数付きに更新し、cross-country誤認識の回帰テストを追加
- **反映**: `docs/`本項目・`scripts/lib/naming.js`のコメントに経緯を記録済み。修正後、`candidateToLedgerEvent`で同じ架空シナリオ（US・Bailey）を再検証し、正しく汎用フォールバック（「FRB理事の発言」）へ落ちることを確認した

### O2. 公式ソースチェッカーの未実装期間中の掲載除外範囲

`docs/phase1-official-sources.md` の実装順に従い、優先度Bのソース（財務省JGB入札・FRB理事講演・S&P Global系PMI・ADP・Ivey）が未実装の間、該当イベントは掲載除外＋WARN運用となる（SPEC §3.4）。検収基準1（既刊2週100%捕捉）は全ソース実装完了時点で満たす。実装完了までの中間状態をどう扱うか（並行運用開始のタイミングに影響）は、優先度Bソースの実装完了後に改めて相談する。

### O7. 米新規失業保険申請件数・ミシガン大学消費者信頼感指数が完全未実装だった → 修正・クローズ（2026-09-06）

9/7週の突合（しょうさん実施）で、毎週木曜発表の米新規失業保険申請件数（Initial Jobless Claims）が8/24週・9/7週いずれもManus版には存在するのに本システムには一度も登録されていなかったと判明した。

- **発覚した欠陥の性質**: 中国PMI・英建設業PMI・ADP雇用統計（task #16）のような「担当ソースがpending_reconで恒常的にWARNが出る」既知の欠落とは異なり、jobless_claimsはkind自体がconfig/event-names.json・config/importance-rules.jsonのいずれにも一切登録されていない**完全な未実装**であり、WARNすら出ずに無警告で欠落していた点が発見を遅らせた
- **横断確認**（task #90、しょうさん指示「毎週発生するのに毎週漏れている類のイベントが他にないか確認してください」）: 同様の完全未実装が無いか確認した結果、米ミシガン大学消費者信頼感指数（月2回発表、速報値・確定値）も同じ理由で未登録だったと判明。これ以外の恒常的な週次イベントは確認できなかった
- **修正**: 両指標ともFRED経由（jobless_claims=release_id 180、sentiment=release_id 91、いずれもWebSearchで複数独立ページによりrelease_idを確認）でus_bls_fredに追加。jobless_claimsはrecurring_checks（`matchesRecurringRule`に「毎週」キーワード分岐を新設）でも監視し、以後同種の欠落が再発してもWARNで即座に可視化されるようにした。ミシガン大学消費者信頼感指数は速報値/確定値の呼称の出し分けは今回実装せず、表示名は「ミシガン大学消費者信頼感指数」の1本に統一した（必要なら別途対応）
- **あわせて発覚**: 英国月次GDP（ONS「GDP monthly estimate, UK」、通常11日前後発表）も9/7週で不検出だった。原因はGB/gdpのmatchキーワードが四半期速報版（「GDP first quarterly estimate」）のみで、月次版のタイトル文言と一致していなかったため（config/official-sources.jsonのgb_onsソースnotesが2026-08-15時点で実タイトルの存在自体は記録していたにもかかわらず、対応するmatchキーワードの追加が漏れていた）。CA/gdpと同じ「月次・四半期の2エントリ共存」方式でmatchキーワードを追加して解消した
- **反映**: config/official-sources.json（us_bls_fred releases・announce_time_by_kind）・config/event-names.json（US/jobless_claims・US/sentiment・GB/gdp月次版）・config/importance-rules.json（jobless_claims=★★・recurring_checks）・scripts/lib/recurring-rules.js（「毎週」分岐）を更新。test/harness.test.js・test/recurring-rules.test.jsに実configベースの回帰テストを追加

### O8. FRB理事（議長以外）の登録とBOJ審議委員6名の登録 → 実装・クローズ（2026-09-06）

task #17（FRB理事の登録）としょうさんの追加指摘（BOJ政策委員会の審議委員6名も登録）をあわせて実施した。

- **BOJ側**: 高田創・田村直樹・小枝淳子・増一行・浅田統一郎・佐藤綾野の6名をofficials.jsonへ登録（role_rank=board_member=★★）。boj.or.jp公式ドメインの個人別bioページ＋日本経済新聞等の複数報道で就任日・役職名を確認
- **「増」一文字姓の安全性**: しょうさん強調指摘を受け、`naming.js`の`resolveOfficialBySurname`を全面的に見直した。従来は日本語表記・英語併記表記の区別なく`.includes()`（文字列中間一致）で照合していたため、一文字姓「増」が万一無関係な文字列（例:「増加」等の一般語や他の登録者名の一部）に誤マッチする理論上のリスクがあった。日本語表記（丸括弧の英語併記が無いもの）は姓が必ず名前の先頭に来る表記慣行を利用し、前方一致（`.startsWith()`）へ厳格化した（英語併記表記は従来どおり中間一致を維持。両者は丸括弧の有無で振り分ける）。test/build-ledger.test.jsに「増加」「小増」等の非該当文字列が誤マッチしないことを確認する回帰テストを追加
- **実データでの表記形式確認**: しょうさん指示どおり、9/5の実本番run（GitHub Actions実ネットワーク経由）で実際にBOJ公式ページから抽出された文字列を確認したところ、増審議委員の講演は「増」という姓のみ（フルネーム「増一行」は表示されない）であることが確認できた。これはWebSearchで確認した他の審議委員（高田審議委員・田村審議委員等、いずれも姓のみ表記）の実例とも整合する
- **FRB側**: ジェファーソン（副議長）・ボウマン（副議長・金融監督担当）・バー・クック・ウォラーの5名を登録。federalreserve.gov公式bio・Congress.gov CRS Reportで確認。role_rankは当初「FOMCの議決権保有者は全員対等」という理屈でgovernor（★★★）とする案を検討したが、test/regen-sample-weeks.test.jsの既刊ground truth（scripts/phase0/expected-events.json、2026-08-06のクック理事講演の実績importance=2）と矛盾することがテスト実行で判明し、実測データを優先してboard_member（★★）へ修正した。地区連銀総裁の講演はus_frb_speeches（FRB理事講演RSSのみ）では検出されないため、今回は理事会メンバーのみを優先登録した（地区連銀総裁は今後、実際に講演が検出される経路ができた時点で追加）
- **付随して発覚**: クック理事は2025年8月にトランプ大統領が解任を発表し係争となった経緯があるが、2026年時点の複数の独立ソース（Congress.gov CRS Report・Brookings）で引き続き現職理事として扱われているため解任は不成立と判断し登録した。今後の係争の帰趨によっては見直しが必要（要継続監視）
- **反映**: config/officials.json・scripts/lib/naming.js・test/naming.test.js・test/build-ledger.test.jsを更新。既刊ground truthベースのregen-sample-weeks.test.js・render.test.jsも、Cook理事が登録済みになったことに伴う名称・heroSummary選出結果の変化を反映して更新した

### O9. 冪等ガードの3度目の是正: コミットSHA比較からパイプラインコードハッシュ比較へ → 修正・クローズ（2026-09-06）

O6・8/22・9/5と、冪等ガードは実は3回目の是正である（task #92）。しょうさん指摘: 「実害が無かったのは32分でソースデータが変わらなかったという偶然によるもので、設計目的（二重生成防止）が機能していない状態は放置できない」。

- **旧方式（generated_from_commit＝github.sha比較）の構造的な欠陥**: 本番cron（08:06 JST）は自身のチェックアウト時点のSHAを台帳に記録してからdata/・output/をコミットするため、その時点でHEADが進む。32分後の保険cron（08:41 JST）は進んだ後のHEADをチェックアウトするため、「記録済みSHA（本番cronのチェックアウト時点）≠現在のHEAD（本番cron自身のコミットで進んだ後）」が構造的に毎回成立してしまい、コードが一切変わっていなくても保険cronが必ず再生成していた
- **是正方針**: 「コミットSHAが変わったか」ではなく「パイプラインの出力に影響しうるファイル群の内容が変わったか」を直接判定する。新設した`scripts/lib/pipeline-code-hash.js`が`scripts/`・`config/`・`package.json`・`package-lock.json`・`.github/workflows/weekly.yml`のみを対象にSHA-256ハッシュを計算し、台帳meta.generated_from_code_hashに記録。この対象範囲自体が「何が変わったら再生成すべきか」の判断基準になるため、`docs/ledger-schema.md`に明記した。data/・output/（パイプライン自身の書き込み先）は意図的に対象外とし、これにより本番cron自身のコミットがハッシュに影響しなくなる
- **回帰テスト**: `test/pipeline-code-hash.test.js`に、(1) scripts/・config/配下の変更でハッシュが変わること（8/22の過剰スキップ再発防止）、(2) 「本番cron→自身のコミットでHEAD前進→保険cron」のシーケンスを模した、data/・output/への書き込みだけではハッシュが変わらないこと（9/5の過小スキップ再発防止）の両方を直接検証するテストを追加した
- **生成元コミット自体の記録は継続**: generated_from_commitは冪等判定には使わなくなったが、「どのコミットが実際に生成したか」を追跡する記録用フィールドとして引き続き残す
- **実運用での確認**: 9/12（土）の本番cron→保険cronの連続実行で、保険cronが正しくスキップと判定されることを確認する予定（しょうさんへ別途報告）

### O10. Manus突合廃止に伴う欠落検知強化の3点 → 実装・クローズ（2026-09-06）

しょうさん指示: Manus突合（並行運用の比較対象）廃止後、9/7週突合で発覚した一連の完全欠落系バグ（BOJ月境界バグ・RBNZ/BOC記者会見・米新規失業保険申請件数・英月次GDP等）を独立に検出できる仕組みが実質的に無くなるため、3点の強化を実装した（task #93）。

1. **FF突合の欠落検出への拡張**（`scripts/lib/ff-cross-check.js`の`findMissingHighImpactFfEvents`）: 従来の月曜事後突合は「台帳→FF」の一方向（時刻の相違検出）のみだった。逆方向「FF→台帳」（FFでimpact=Highに分類されるイベントに対応する台帳イベントが1件も無いものを検出）を追加した。FF側のimpact値をそのまま重要度に採用しない設計方針（docs/phase0-findings.md項目3）は維持しつつ、粗い一致判定（存在有無のみ）にのみHigh impactを使うことでMedium/Low由来のノイズを避けた。通貨がEU/DEのように複数国にまたがる場合は既存のmatchesCountryQualifierを逆方向にも転用して振り分ける。KIND_KEYWORDSにjobless_claimsも追加し、今回発覚したclassのバグを再現するテストで直接検証した
2. **公表リリース全量の差分監査**（`scripts/checkers/harness.mjs`の`checkFredCatalogAudit`）: 個々のrelease_idの日程ではなく、発表元（FRED上のsource_id）が現在公表している全リリース一覧そのものを取得し、config/official-sources.jsonに未登録のrelease_idが無いか照合する。このプロジェクトで実際に発生した欠落（CPI/PPI/雇用統計/GDP/PCE/新規失業保険申請件数）は全てFRED経由（BLS=source_id 22、BEA=source_id 18）だったため、まずこの2元をスコープとした。ミシガン大学消費者信頼感指数（University of Michigan、別の発表元）や、ONS・ABS・BOJ等の非FREDソースへの拡張は、発表元ごとに同等の「全量一覧」APIの有無・形式が異なるため今回は対象外（将来必要になれば個別に設計する）。run自体は失敗させない情報提供のみのWARNとした（fetch失敗等はこの監査自体を静かに諦め、本編のパイプラインを巻き込まない設計）
3. **掲載件数の推移監視**（`scripts/lib/event-volume-history.js`・`scripts/lib/validate-event-volume-trend.js`）: 2026-08-15の設計メモ（config/volume-check-policy.jsonのhistorical_median_check、当時はenabled:false）を実装・有効化した。既存の絶対下限チェック（min_displayed_events等）は固定基準のため「通常10件前後の週が急に5件になった」という相対的な劣化を捉えられない。新しい履歴ファイルは持たず、既存のdata/ledger/配下の過去台帳そのものを実績データソースとして中央値を計算し、当該週の件数が中央値の50%未満ならREVIEW_REQUIRED対象に加える。実績データが少ないうち（min_history_weeks=4未満）は誤検知を避けるため自動的にスキップする（2026-09-06時点の実績は3週分のため、9/14週生成時点ではまだ発動せず9/21週から発動する見込み）
- **反映**: `gate.mjs`のdecideGateOutcomeにtrendCheckパラメータを追加（volumeCheckとOR条件でREVIEW_REQUIRED判定、acknowledgeLowVolumeで両方まとめてオーバーライド可能）。関連する全モジュールに単体テストを追加
