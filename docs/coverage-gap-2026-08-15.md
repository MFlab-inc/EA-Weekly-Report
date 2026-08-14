# カバレッジ欠損の実測結果（2026-08-15）

しょうさん指摘（2026-08-15、観測モード結果への応答）に基づく実測。「候補0件＝対象週にたまたま★★★が少ない」という解釈を撤回し、レジストリが既刊2週（29イベント）から逆算構築されているために構造的に検出できないイベント種別がある、という仮説を実データで検証した。

## 実測方法

対象週（2026-08-17〜2026-08-21）はFFにまだ公開されていなかった（`ff_calendar_nextweek.json`が404、`ff_calendar_thisweek.json`は依然2026-08-10〜08-15週のまま。これ自体がtask #2「FF週境界」の土曜早朝時点の実測データでもある）。そのため代替として現在公開中の週（2026-08-10〜08-15、74件）を使い、`scripts/phase1/coverage-gap-check.mjs`でFFイベントの国別分布と`config/official-sources.json`の国別追跡kind一覧を突き合わせた。

**判明した副次バグ**: 初回実行でFFの`country`フィールド（通貨コード: USD/AUD等）と`official-sources.json`の`country`フィールド（ISO国コード: US/AU等）の対応を取らずに突き合わせていたため、「全イベントに追跡ソース無し」という誤った結果が出た。変換表を追加して修正済み（自己発見・修正）。

## 結論: 「政策金利（policy_rate）」kindがRBA以外すべて未カバー

既刊29イベントのground truthを確認したところ、`policy_rate`kindを持つイベントは**RBAの1件のみ**（`au-rba-rate-2026-08-11`）だった。これは「たまたま」ではなく、**既刊2週間にRBA以外の中央銀行の会合が1件も含まれていなかった**ことによる。`config/official-sources.json`は既刊イベントから逆算構築されているため、他の中銀の政策金利発表を担当するソースが**一つも登録されていない**。

`config/officials.json`には9役職（日銀総裁・FRB議長・RBA総裁・ECB総裁・BOE総裁・BOC総裁・RBNZ総裁・SNB総裁・米財務長官）の現職者が確認済みで記録されているにもかかわらず、このうち政策金利発表を担当するソースが存在するのは**RBAのみ**である。

| 中銀 | 総裁（officials.json） | 政策金利担当ソース | 状態 |
|---|---|---|---|
| RBA（豪州） | ブロック | `au_rba`（annual_schedule_config） | ✅ 追跡済み |
| FRB（米国） | ウォーシュ | なし | ❌ **未追跡**（us_bls_fred/us_treasury/us_frb_speechesのいずれもFOMC発表そのものは対象外。frb_speechesは理事講演のみ） |
| 日銀（日本） | 植田 | なし | ❌ **未追跡**（`jp_boj`は`opinions_summary`「主な意見」・`minutes_summary`「議事要旨」のみ担当。いずれも会合本体の後日公表文書で、会合当日の政策金利発表そのものは別kindとして未登録） |
| ECB（ユーロ圏） | ラガルド | なし | ❌ **未追跡**（official-sources.jsonにユーロ圏の国コードを持つソースが一つもない） |
| BOE（英国） | ベイリー | なし | ❌ **未追跡**（`gb_ons`はGDPのみ担当） |
| BOC（カナダ） | マックレム | なし | ❌ **未追跡**（`ca_statcan`/`ca_ivey`は雇用統計・貿易収支・PMIのみ担当） |
| RBNZ（NZ） | ブレマン | なし | ❌ **未追跡**（`nz_statsnz`は雇用統計のみ担当） |
| SNB（スイス） | シュレーゲル | なし | ❌ **未追跡**（**official-sources.jsonにスイスの国コード(CH)を持つソースが一つもない**。実測でCHFイベント「PPI m/m」も追跡ソース無しと確認） |

## 実測週（8/10〜8/15）で確認した具体例

- 8/11 13:30 [AUD] "Cash Rate" / "RBA Rate Statement" → `policy_rate(au_rba)` ✅ 追跡済み
- 8/11 14:30 [AUD] "RBA Press Conference" → `press_conference(au_rba)` ✅ 追跡済み
- 8/13 15:30 [CHF] "PPI m/m" → **追跡ソース無し**（スイスは国として一切カバーされていない）
- EUR建てイベント（独・仏CPI、ユーロ圏GDP・貿易収支等）→ **ユーロ圏の追跡ソースが存在しない**（ECBはもちろん、ユーロ圏統計局[Eurostat]も未登録）

（実測週にはFRB・BOJ・ECB・BOE・BOC・RBNZ・SNBいずれの政策会合も含まれていなかったため、これらのkindが「検出されない」という形で問題が顕在化することは実測週では確認できなかったが、担当ソース自体が存在しないため、該当週が来れば確実に見過ごされる）

## 影響範囲

`importance_by_kind`で`policy_rate`は★★★（importance=3）指定であり、SPEC上「停止スケジュールの主役」に該当する。8中銀中7中銀分の政策金利発表が、発生する週には**一切検出されずに完全に欠落する**（担当ソースが存在しないため、フェールクローズのHOLD/WARNすら発動しない — 「検出すべき対象」としてシステムに認識されていないため）。これはtask #18（RBA証言）・旧nz_statsnz/ca_statcan（担当ソースはあるが抽出失敗）よりも深刻な欠損パターンである。

## 必要な追加ソース候補（未実測・次のステップ）

| 中銀 | 候補ソース | 備考 |
|---|---|---|
| FRB | federalreserve.gov（FOMC calendar/statements） | 米国は他kindで実績多数。同ドメイン内の別ページのため到達性は良好な見込み |
| 日銀 | boj.or.jp（既存の`mpm_index.htm`を再利用） | **低コストで対応可能と判明**: `scripts/checkers/extractors/boj.js`のソースコードを確認したところ、抽出対象テーブルの列[1]「Date of MPM」（会合当日そのものの日付）を`(未使用)`として意図的にスキップしていた（当時は`opinions_summary`/`minutes_summary`のみが対象だったため）。新規ソース開拓は不要で、この列を`policy_rate` kindとして追加抽出するだけで済む。発表時刻（`announce_time_by_kind`）の実測のみ別途必要 |
| ECB | ecb.europa.eu（Governing Council meeting calendar） | ユーロ圏という「国」概念がconfigのcountryフィールド設計と馴染むか要検討 |
| BOE | bankofengland.co.uk（MPC calendar） | 未実測 |
| BOC | bankofcanada.ca（interest rate announcement dates） | 未実測 |
| RBNZ | rbnz.govt.nz（OCR announcement dates） | 未実測 |
| SNB | snb.ch（monetary policy assessment dates） | 未実測 |

## 米CPI定例欠落WARNの誤検知について（あわせて確認）

`config/importance-rules.json`の「米CPI」recurring_check（旧ルール「毎月中旬」＝10〜19日）が、実際の発表日（既刊実績8/12）より広い範囲を含んでいたため、対象外の8/17週で誤ってWARNが発火する可能性があった。日範囲を明示できる記法（「N日〜M日」）を`scripts/lib/recurring-rules.js`に追加し、ルールを「毎月10日〜16日ごろ」へ修正済み（`test/recurring-rules.test.js`にテスト追加、全170テスト成功）。
