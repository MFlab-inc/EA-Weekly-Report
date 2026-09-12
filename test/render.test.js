'use strict';
// scripts/render.mjs（台帳→HTML生成CLI）のheroSummary/heroPills自動生成ルール
// （しょうさん確定仕様2026-08-15）を検証する。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { regenerateWeek, WEEK_20260803, WEEK_20260810 } = require('./support/regenerate-week');

const reportPolicy = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'report-policy.json'), 'utf8'));
const importanceRules = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'importance-rules.json'), 'utf8'));

// task #94フォローアップ（2026-09-12、しょうさん指摘）: 「優先度リストに載っていないkindが
// 自動的に最下位（その他）に落ちる」という設計は、pmi_ismがしばらく見落とされていたのと同じ
// 見落としを今後kind追加のたびに再発させる弱さがある。config/importance-rules.jsonの
// importance_by_kindに定義済みの全kindが、hero_kind_priority（優先順位に入れる）か
// hero_kind_priority_acknowledged_other（その他のままで問題ないと明示的に確認済み）の
// いずれかに載っていることをCIで強制する（config/expected-coverage.jsonの国×kind検査と
// 同じ「黙って抜け落ちさせない」思想）。新規kind追加時にこのテストが落ちれば、
// hero_kind_priorityへの追加要否を都度検討したことになる
test('hero_kind_priority完全性チェック: importance-rules.jsonの全kindがhero_kind_priorityかhero_kind_priority_acknowledged_otherに載っている', () => {
  const definedKinds = Object.keys(importanceRules.importance_by_kind).filter((k) => !k.startsWith('_'));
  const priorityKinds = new Set(reportPolicy.hero_kind_priority || []);
  const acknowledgedOtherKinds = new Set(reportPolicy.hero_kind_priority_acknowledged_other || []);
  const unaccounted = definedKinds.filter((k) => !priorityKinds.has(k) && !acknowledgedOtherKinds.has(k));
  assert.deepEqual(
    unaccounted,
    [],
    `新規kindがhero_kind_priority/hero_kind_priority_acknowledged_otherのいずれにも未登録です: ${unaccounted.join(', ')}。` +
      'config/report-policy.jsonへ、優先順位に入れるか、その他のままでよい理由を明記してacknowledged_otherへ追加してください'
  );
  // 逆方向（設定ミス・削除漏れの検出）: 両リストに載っているkindはimportance_by_kindに実在すること
  const definedKindSet = new Set(definedKinds);
  const staleInPriority = (reportPolicy.hero_kind_priority || []).filter((k) => !definedKindSet.has(k));
  const staleInAcknowledged = (reportPolicy.hero_kind_priority_acknowledged_other || []).filter((k) => !definedKindSet.has(k));
  assert.deepEqual(staleInPriority, [], `hero_kind_priorityにimportance-rules.jsonに存在しないkindがあります: ${staleInPriority.join(', ')}`);
  assert.deepEqual(staleInAcknowledged, [], `hero_kind_priority_acknowledged_otherにimportance-rules.jsonに存在しないkindがあります: ${staleInAcknowledged.join(', ')}`);
});

function ledgerEvent(overrides) {
  return { country: 'US', kind: 'cpi', importance: 3, name_ja: 'test', date_jst: '2026-08-12', datetime_jst: '2026-08-12T21:30:00+09:00', ...overrides };
}

test('autoHeroSummary: ★★★を国+kindで重複除去し、発生順に最大4件を「、」連結＋「を確認する週」', async () => {
  const { autoHeroSummary } = await import('../scripts/render.mjs');
  const ledger = {
    events: [
      ledgerEvent({ country: 'AU', kind: 'policy_rate', name_ja: 'RBA政策金利＆声明発表', datetime_jst: '2026-08-11T13:30:00+09:00' }),
      // 同一country+kindの重複（CPI・コアCPI）は1件扱い（先に出現した方の名称を採用）
      ledgerEvent({ country: 'US', kind: 'cpi', name_ja: '消費者物価指数（CPI）', datetime_jst: '2026-08-12T21:30:00+09:00' }),
      ledgerEvent({ country: 'US', kind: 'cpi', name_ja: '消費者物価指数【コア】', datetime_jst: '2026-08-12T21:30:00+09:00' }),
      ledgerEvent({ country: 'US', kind: 'ppi', name_ja: '生産者物価指数（PPI）', datetime_jst: '2026-08-13T21:30:00+09:00' }),
      ledgerEvent({ country: 'AU', kind: 'testimony', name_ja: 'ブロックRBA総裁：下院経済委員会への出席', datetime_jst: '2026-08-14T08:30:00+09:00' }),
      ledgerEvent({ country: 'US', kind: 'retail_sales', name_ja: '小売売上高＆【除自動車】', datetime_jst: '2026-08-14T21:30:00+09:00' }),
      ledgerEvent({ country: 'US', kind: 'importance2', importance: 2, name_ja: '対象外（importance=2）' }),
    ],
  };
  const summary = autoHeroSummary(ledger, reportPolicy);
  // 2026-08-29修正: name_jaが中銀略称（RBA）で始まる場合は国名前置を省く（しょうさん指摘、
  // heroDisplayName参照）。ただし「ブロックRBA総裁：下院経済委員会への出席」はRBAで始まって
  // いない（総裁の姓が先頭）ため、この行は引き続き国名前置が付く。
  // 2026-09-12修正（task #94フォローアップ、しょうさんが7kindの優先順位を確定）:
  // policy_rate(0) < testimony(2) < cpi(6) < ppi(10) < retail_sales(12)の順になり、
  // testimonyがretail_salesを押し出して3位に入る
  assert.equal(summary, 'RBA政策金利＆声明発表、豪州ブロックRBA総裁：下院経済委員会への出席、米国消費者物価指数（CPI）、米国生産者物価指数（PPI）を確認する週');
});

// task #41-3（2026-08-15）で発覚した実バグの回帰テスト: `(a.datetime_jst || '').localeCompare(...)`
// だと空文字列が実時刻より辞書順で前に来るため、時刻未公表の★★★イベント（例: eurostat_gdpの
// EU GDP【速報値】。公表時刻がWebSearchで確認できず未設定のためdatetime_jst:null）が週内最速の
// 発表であるかのように1位表示されてしまっていた。autoHeroPillsと同様にdatetime_jstが無いイベントは
// 対象外とすることで修正した
test('autoHeroSummary: datetime_jst未公表（null）の★★★イベントは対象外になる（時刻不明を先頭表示しない）', async () => {
  const { autoHeroSummary } = await import('../scripts/render.mjs');
  const ledger = {
    events: [
      ledgerEvent({ country: 'EU', kind: 'gdp', name_ja: 'GDP【速報値】', datetime_jst: null, date_jst: '2026-08-14' }),
      ledgerEvent({ country: 'JP', kind: 'opinions_summary', name_ja: '日銀金融政策決定会合における主な意見の公表', datetime_jst: '2026-08-10T08:50:00+09:00' }),
      ledgerEvent({ country: 'AU', kind: 'policy_rate', name_ja: 'RBA政策金利＆声明発表', datetime_jst: '2026-08-11T13:30:00+09:00' }),
    ],
  };
  const summary = autoHeroSummary(ledger, reportPolicy);
  // 2026-08-29修正: 「日銀...」「RBA...」いずれもname_jaが中銀略称で始まるため国名前置を省く。
  // 2026-09-12修正（task #94）: opinions_summaryはhero_kind_priorityに無く「その他」（rank9）、
  // policy_rateはrank0のため、時系列では日銀（8/10）がRBA（8/11）より早くても優先度でRBAが先に来る
  assert.equal(summary, 'RBA政策金利＆声明発表、日銀金融政策決定会合における主な意見の公表を確認する週');
  assert.doesNotMatch(summary, /^(EU)?GDP【速報値】/, 'datetime_jst:nullのイベントが先頭に来てはならない');
});

test('autoHeroSummary: ★★★が0件のときはreportPolicy.hero_summary_no_star3_text', async () => {
  const { autoHeroSummary } = await import('../scripts/render.mjs');
  assert.equal(autoHeroSummary({ events: [] }, reportPolicy), reportPolicy.hero_summary_no_star3_text);
  assert.equal(reportPolicy.hero_summary_no_star3_text, '最重要イベントの予定はない週');
});

test('autoHeroPills: ★★★を日付順に最大3件、「{表示名} {M/D}」形式', async () => {
  const { autoHeroPills } = await import('../scripts/render.mjs');
  const ledger = {
    events: [
      ledgerEvent({ name_ja: '小売売上高＆【除自動車】', datetime_jst: '2026-08-14T21:30:00+09:00', date_jst: '2026-08-14' }),
      ledgerEvent({ name_ja: 'RBA政策金利＆声明発表', datetime_jst: '2026-08-11T13:30:00+09:00', date_jst: '2026-08-11' }),
      ledgerEvent({ name_ja: '消費者物価指数（CPI）', datetime_jst: '2026-08-12T21:30:00+09:00', date_jst: '2026-08-12' }),
      ledgerEvent({ name_ja: '生産者物価指数（PPI）', datetime_jst: '2026-08-13T21:30:00+09:00', date_jst: '2026-08-13' }),
      ledgerEvent({ name_ja: '時刻未公表イベント', datetime_jst: null, importance: 3 }),
    ],
  };
  const pills = autoHeroPills(ledger, reportPolicy);
  assert.deepEqual(pills, ['米国RBA政策金利＆声明発表 8/11', '米国消費者物価指数（CPI） 8/12', '米国生産者物価指数（PPI） 8/13']);
});

// task #47（2026-08-15、しょうさん監査指摘）: 表示名だけでは同一kind・別国のイベント
// （例: カナダCPIと英国CPI）が区別できず「消費者物価指数（CPI）、消費者物価指数（CPI）」のように
// 重複して見える実バグが8/17週の実ネットワーク検証で発覚した。国名前置により解消されることを確認する
test('autoHeroSummary/autoHeroPills: 同一kind・別国のイベント（CA CPIとGB CPI）が国名前置で区別できる', async () => {
  const { autoHeroSummary, autoHeroPills } = await import('../scripts/render.mjs');
  const ledger = {
    events: [
      ledgerEvent({ country: 'CA', kind: 'cpi', name_ja: '消費者物価指数（CPI）', datetime_jst: '2026-08-17T21:30:00+09:00', date_jst: '2026-08-17' }),
      ledgerEvent({ country: 'GB', kind: 'cpi', name_ja: '消費者物価指数（CPI）', datetime_jst: '2026-08-19T15:00:00+09:00', date_jst: '2026-08-19' }),
    ],
  };
  const summary = autoHeroSummary(ledger, reportPolicy);
  assert.equal(summary, 'カナダ消費者物価指数（CPI）、英国消費者物価指数（CPI）を確認する週');
  const pills = autoHeroPills(ledger, reportPolicy);
  assert.deepEqual(pills, ['カナダ消費者物価指数（CPI） 8/17', '英国消費者物価指数（CPI） 8/19']);
});

// 2026-08-29追加（しょうさん指摘: 8/31週の実出力で「NZRBNZ政策金利＆声明発表」
// 「カナダBOC政策金利＆声明発表」のように国名前置と中銀略称が重複表示されていた）。
// name_jaが中銀略称（naming.BANK_ABBR_BY_COUNTRY）で始まる場合のみ国名前置を省き、
// 中銀略称が名称の先頭以外に現れる場合や中銀と無関係な名称では引き続き国名前置が付くことを確認する
test('autoHeroSummary/autoHeroPills: name_jaが中銀略称で始まる場合は国名前置を省く（先頭一致のみ）', async () => {
  const { autoHeroSummary, autoHeroPills } = await import('../scripts/render.mjs');
  const ledger = {
    events: [
      ledgerEvent({ country: 'NZ', kind: 'policy_rate', name_ja: 'RBNZ政策金利＆声明発表', datetime_jst: '2026-09-02T11:00:00+09:00', date_jst: '2026-09-02' }),
      ledgerEvent({ country: 'CA', kind: 'policy_rate', name_ja: 'BOC政策金利＆声明発表', datetime_jst: '2026-09-02T22:45:00+09:00', date_jst: '2026-09-02' }),
      // countryはNZだが名称がRBNZで始まっていない（総裁の姓が先頭）ケース: 国名前置は残る
      ledgerEvent({ country: 'NZ', kind: 'testimony', name_ja: 'なんとかRBNZ総裁の議会証言', datetime_jst: '2026-09-03T10:00:00+09:00', date_jst: '2026-09-03' }),
    ],
  };
  const summary = autoHeroSummary(ledger, reportPolicy);
  assert.equal(summary, 'RBNZ政策金利＆声明発表、BOC政策金利＆声明発表、NZなんとかRBNZ総裁の議会証言を確認する週');
  const pills = autoHeroPills(ledger, reportPolicy);
  assert.deepEqual(pills, ['RBNZ政策金利＆声明発表 9/2', 'BOC政策金利＆声明発表 9/2', 'NZなんとかRBNZ総裁の議会証言 9/3']);
});

test('buildNarrative: overrideが無ければ自動生成、overrideがあればそちらを優先', async () => {
  const { buildNarrative } = await import('../scripts/render.mjs');
  const ledger = { meta: { target_week_start: '2026-08-17' }, events: [ledgerEvent({ country: 'AU', kind: 'policy_rate', name_ja: 'RBA政策金利＆声明発表' })] };
  const auto = buildNarrative(ledger, reportPolicy, null, new Date('2026-08-15T00:00:00Z'));
  assert.equal(auto.reportMeta, 'ea-weekly-20260817');
  assert.match(auto.heroSummary, /RBA政策金利＆声明発表を確認する週/);

  const overridden = buildNarrative(ledger, reportPolicy, { heroSummary: '手動指定の要約', heroPills: ['手動ピル'] }, new Date('2026-08-15T00:00:00Z'));
  assert.equal(overridden.heroSummary, '手動指定の要約');
  assert.deepEqual(overridden.heroPills, ['手動ピル']);
});

// しょうさん指示2026-08-15: 既刊2週にこのルールを適用し、既刊の文言と大きく乖離しないことを確認する。
// 乖離する場合は理由を報告すること（既刊が編集で短縮している等）。
// 結論（本テスト実行結果・完了報告で詳述）: 両週とも大きく乖離する。理由は既刊が「複数kindを1つの
// 主体テーマへ要約する」追加編集を行っている点（例:「RBA政策判断」はpolicy_rate/quarterly_report/
// press_conferenceの3kindを1フレーズへ要約、「米CPI・PPI」はcpi/ppiの2kindを1フレーズへ要約）のに対し、
// 本ルールはcountry+kindの完全一致でのみ重複除去するため、上記のような複数kind横断の要約は行わない
// （しょうさんの指定ルールどおりの実装であり、バグではない）。
//
// 2026-09-12再確認（task #94、選定順を重要度優先へ変更した際の再適用）:
// - 0810週: 当初（7kind確定前）はRBA関連3kindが上位を占めていたが、しょうさんが7kindの優先順位を
//   確定した結果（testimonyをpress_conferenceの直後=rank2へ）、AU testimony（豪州総裁の下院経済
//   委員会証言、8/14）がRBA四半期金融政策報告（quarterly_report、rank5）・米CPI（cpi、rank6）を
//   押し出して3位に入るようになった。既刊「RBA政策判断、米CPI・PPI、...」とは構成が異なるが、
//   これはしょうさんが「testimonyは会見と同格」と明示的に判断した結果であり、選定ルールどおりの
//   挙動（バグではない）
// - 0803週: pmi_ism追加（rank11）により米国ISM製造業景況指数がsummaryの4件目に復帰した（雇用統計
//   3ヶ国の後）。pillsは上位3件がNZ/US/CA雇用統計（employment_situation、rank8）で埋まるため
//   pmi_ismは圏外のまま。既刊「ISM製造業・非製造業、NZ雇用統計、...」（ISMが先頭）とは順序が
//   異なるが、4件中に含まれる状態まで乖離は縮小した
test('既刊2週へのルール適用結果（実データ経路・既刊文言との比較記録）', async () => {
  const { autoHeroSummary, autoHeroPills } = await import('../scripts/render.mjs');

  const ledger0810 = await regenerateWeek(WEEK_20260810);
  const summary0810 = autoHeroSummary(ledger0810, reportPolicy);
  const pills0810 = autoHeroPills(ledger0810, reportPolicy);
  // 既刊: 'RBA政策判断、米CPI・PPI、英国GDP、米小売売上高を確認する週'
  // 本ルール適用結果（アサーションで固定し、将来の変更を検知できるようにする）。国名前置はtask #47で追加。
  // 2026-08-29修正: 「日銀...」「RBA...」はname_jaが中銀略称で始まるため国名前置を省く（しょうさん指摘）。
  // 「ブロックRBA総裁の記者会見」はRBAで始まっていないため引き続き「豪州」が付く。
  // 2026-09-12修正（task #94フォローアップ、しょうさんが7kindの優先順位を確定）:
  // policy_rate(0) < press_conference(1) < testimony(2) < opinions_summary(4) < quarterly_report(5) < cpi(6)
  // の順になり、AU testimony（8/14）がquarterly_report・cpiを押し出して3位に入った
  assert.equal(summary0810, 'RBA政策金利＆声明発表、豪州ブロックRBA総裁の記者会見、豪州ブロックRBA総裁：下院経済委員会への出席、日銀金融政策決定会合における主な意見の公表（7月30・31日開催分）を確認する週');
  // 既刊: ['RBA政策金利 8/11', '米CPI 8/12', '米小売売上高 8/14']
  assert.deepEqual(pills0810, ['RBA政策金利＆声明発表 8/11', '豪州ブロックRBA総裁の記者会見 8/11', '豪州ブロックRBA総裁：下院経済委員会への出席 8/14']);

  const ledger0803 = await regenerateWeek(WEEK_20260803);
  const summary0803 = autoHeroSummary(ledger0803, reportPolicy);
  const pills0803 = autoHeroPills(ledger0803, reportPolicy);
  // 既刊: 'ISM製造業・非製造業、NZ雇用統計、豪州貿易収支、カナダ・米雇用統計を確認する週'
  // 2026-08-15追記（task #50/51、しょうさんのManus突合指摘の一括監査で発覚）: au_absにretail_sales
  // （Monthly Household Spending Indicator）を追加したところ、8/4発表分（8/3週内）が新たに検出され
  // 日付順で上位に入るようになったため、以下のアサーションを実際の出力へ更新した（AU retail_salesが
  // 4件目の米国雇用統計を押し出した。これは同種の「登録済みソースのkind取りこぼし」バグが8/3週にも
  // サイレントに存在していたことの副次的な確認でもある）。
  // 2026-09-12修正（task #94）: employment_situation（rank5）がtrade_balance・retail_sales（rank8）
  // より優先されるため豪州貿易収支はhero圏外のままだが、pmi_ism追加（rank7）により
  // 米国ISM製造業景況指数がsummaryの4件目に復帰した（上記コメントブロック参照）
  assert.equal(summary0803, 'NZ雇用統計、米国雇用統計：非農業部門雇用者数・失業率・平均時給、カナダ雇用統計、米国ISM製造業景況指数を確認する週');
  // 既刊: ['ISM製造業 8/3', 'NZ雇用統計 8/5', '米雇用統計 8/7']
  assert.deepEqual(pills0803, ['NZ雇用統計 8/5', '米国雇用統計：非農業部門雇用者数・失業率・平均時給 8/7', 'カナダ雇用統計 8/7']);
});
