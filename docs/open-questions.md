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
