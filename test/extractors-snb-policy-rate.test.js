'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { extractSnbEvents, classifyTitle } = require('../scripts/checkers/extractors/snb-policy-rate');

const fx = (...p) => readFileSync(join(__dirname, 'fixtures', 'official-sources', ...p), 'utf8');
const html = fx('snb_policy_rate', 'event_schedule.html');

// しょうさんが一次ソース（SNB公式Time scheduleページ）を直接目視確認して転記した日程（2026-08-15）。
// 実測fixtureから完全一致で抽出できることをground truthとして検証する
const EXPECTED_ASSESSMENT_DATES = ['2026-09-24', '2026-12-10', '2027-03-18', '2027-06-24', '2027-09-23', '2027-12-16'];
const EXPECTED_SUMMARY_DATES = ['2026-10-22', '2027-01-07', '2027-04-15', '2027-07-22', '2027-10-21'];

test('classifyTitle: press releaseはpolicy_rate、news conferenceはpress_conference、Summaryはopinions_summary', () => {
  assert.equal(classifyTitle('Monetary policy assessment of 24 September 2026 (press release)'), 'policy_rate');
  assert.equal(classifyTitle('Monetary policy assessment of 24 September 2026 (introductory remarks, news conference)'), 'press_conference');
  assert.equal(classifyTitle('Summary of monetary policy discussion'), 'opinions_summary');
  assert.equal(classifyTitle('Quarterly Bulletin 3/2026 (Report and SNB data portal)'), null);
});

test('extractSnbEvents: しょうさん転記のMonetary policy assessment 6回分と完全一致する', () => {
  const r = extractSnbEvents(html);
  assert.equal(r.ok, true);
  const policyRateDates = r.rows.filter((x) => x.kind === 'policy_rate').map((x) => x.date);
  assert.deepEqual(policyRateDates, EXPECTED_ASSESSMENT_DATES);
});

test('extractSnbEvents: press_conferenceはpolicy_rateと同日・全件抽出される', () => {
  const r = extractSnbEvents(html);
  const pressConfDates = r.rows.filter((x) => x.kind === 'press_conference').map((x) => x.date);
  assert.deepEqual(pressConfDates, EXPECTED_ASSESSMENT_DATES);
});

test('extractSnbEvents: しょうさん転記のSummary of monetary policy discussion 5回分を含む', () => {
  const r = extractSnbEvents(html);
  const summaryDates = r.rows.filter((x) => x.kind === 'opinions_summary').map((x) => x.date);
  for (const d of EXPECTED_SUMMARY_DATES) assert.ok(summaryDates.includes(d), `${d}が抽出結果に含まれない`);
});

test('extractSnbEvents: 発表時刻はpress release=09:30・news conference=10:00で全件一致する', () => {
  const r = extractSnbEvents(html);
  for (const row of r.rows.filter((x) => x.kind === 'policy_rate' || x.kind === 'opinions_summary')) {
    assert.equal(row.localTime, '09:30');
  }
  for (const row of r.rows.filter((x) => x.kind === 'press_conference')) {
    assert.equal(row.localTime, '10:00');
  }
});

test('extractSnbEvents: ページ末尾イベントのタイトルに静的フッター文言が混入しない', () => {
  const r = extractSnbEvents(html);
  const last = r.rows[r.rows.length - 1];
  assert.equal(last.title, 'Summary of monetary policy discussion');
  assert.ok(!last.title.includes('Calendar feeds'));
});

test('extractSnbEvents: 金融政策関連イベントが1件も無い入力は構造的失敗を返す', () => {
  const r = extractSnbEvents('<html><body>no events here</body></html>');
  assert.equal(r.ok, false);
});
