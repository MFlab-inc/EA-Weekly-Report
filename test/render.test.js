'use strict';
// scripts/render.mjs（台帳→HTML生成CLI）のheroSummary/heroPills自動生成ルール
// （しょうさん確定仕様2026-08-15）を検証する。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { regenerateWeek, WEEK_20260803, WEEK_20260810 } = require('./support/regenerate-week');

const reportPolicy = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'report-policy.json'), 'utf8'));

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
  assert.equal(summary, 'RBA政策金利＆声明発表、消費者物価指数（CPI）、生産者物価指数（PPI）、ブロックRBA総裁：下院経済委員会への出席を確認する週');
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
  const pills = autoHeroPills(ledger);
  assert.deepEqual(pills, ['RBA政策金利＆声明発表 8/11', '消費者物価指数（CPI） 8/12', '生産者物価指数（PPI） 8/13']);
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
// （しょうさんの指定ルールどおりの実装であり、バグではない）
test('既刊2週へのルール適用結果（実データ経路・既刊文言との比較記録）', async () => {
  const { autoHeroSummary, autoHeroPills } = await import('../scripts/render.mjs');

  const ledger0810 = await regenerateWeek(WEEK_20260810);
  const summary0810 = autoHeroSummary(ledger0810, reportPolicy);
  const pills0810 = autoHeroPills(ledger0810);
  // 既刊: 'RBA政策判断、米CPI・PPI、英国GDP、米小売売上高を確認する週'
  // 本ルール適用結果（アサーションで固定し、将来の変更を検知できるようにする）
  assert.equal(summary0810, '日銀金融政策決定会合における主な意見の公表（7月30・31日開催分）、RBA政策金利＆声明発表、RBA四半期金融政策報告、ブロックRBA総裁の記者会見を確認する週');
  // 既刊: ['RBA政策金利 8/11', '米CPI 8/12', '米小売売上高 8/14']
  assert.deepEqual(pills0810, ['日銀金融政策決定会合における主な意見の公表（7月30・31日開催分） 8/10', 'RBA政策金利＆声明発表 8/11', 'RBA四半期金融政策報告 8/11']);

  const ledger0803 = await regenerateWeek(WEEK_20260803);
  const summary0803 = autoHeroSummary(ledger0803, reportPolicy);
  const pills0803 = autoHeroPills(ledger0803);
  // 既刊: 'ISM製造業・非製造業、NZ雇用統計、豪州貿易収支、カナダ・米雇用統計を確認する週'
  // US/employment_situation（8/7 21:30・米雇用統計）とCA/employment_situation（同時刻・カナダ雇用統計）が
  // 同時刻タイのため、候補配列内での出現順（US側が先。official-sources.jsonのsources配列順に由来）が
  // 安定ソートで保持され、4件目はUSが採用されCAは対象外になった
  assert.equal(summary0803, 'ISM製造業景況指数、雇用統計、貿易収支、雇用統計：非農業部門雇用者数・失業率・平均時給を確認する週');
  // 既刊: ['ISM製造業 8/3', 'NZ雇用統計 8/5', '米雇用統計 8/7']
  assert.deepEqual(pills0803, ['ISM製造業景況指数 8/3', '雇用統計 8/5', 'ISM非製造業景況指数 8/5']);
});
