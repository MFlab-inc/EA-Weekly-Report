'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { extractCensusCalendar } = require('../scripts/checkers/extractors/census');
const { extractAbsCalendar } = require('../scripts/checkers/extractors/abs');
const { extractOnsReleases } = require('../scripts/checkers/extractors/ons');
const { extractRbaMeetings, buildRbaSchedule } = require('../scripts/checkers/extractors/rba');
const { extractBojSchedule } = require('../scripts/checkers/extractors/boj');

const FIXTURE_ROOT = join(__dirname, 'fixtures', 'official-sources');
const fx = (...p) => readFileSync(join(FIXTURE_ROOT, ...p), 'utf8');

// 実データfixture（2026-08-14実測、test/fixtures/official-sources/）を使ったオフライン抽出テスト。
// ground truth: reference/sample-report_20260808.html・scripts/phase0/expected-events.json

test('extractCensusCalendar: 実fixtureからground truth（貿易収支8/4・小売売上高8/14）を抽出できる', () => {
  const r = extractCensusCalendar(fx('us_census', 'calendar_listview.html'));
  assert.equal(r.ok, true);
  const trade = r.rows.find((row) => row.date === '2026-08-04' && /International Trade in Goods and Services/i.test(row.title));
  const retail = r.rows.find((row) => row.date === '2026-08-14' && /Advance Monthly Sales for Retail/i.test(row.title));
  assert.ok(trade, '貿易収支(8/4)が見つからない');
  assert.equal(trade.localTime, '08:30');
  assert.ok(retail, '小売売上高(8/14)が見つからない');
  assert.equal(retail.localTime, '08:30');
});

test('extractCensusCalendar: テーブル行が無い入力は構造的失敗を返す', () => {
  const r = extractCensusCalendar('<html><body>no table here</body></html>');
  assert.equal(r.ok, false);
  assert.match(r.reason, /構造変化/);
});

test('extractAbsCalendar: 実fixtureからground truth（貿易収支8/6 10:30 JST相当）を抽出できる', () => {
  const r = extractAbsCalendar(fx('au_abs', 'future_releases_calendar.html'));
  assert.equal(r.ok, true);
  const trade = r.rows.find((row) => row.title === 'International Trade in Goods' && row.utcInstant.startsWith('2026-08-06'));
  assert.ok(trade, '貿易収支(8/6)が見つからない');
  assert.equal(trade.utcInstant, '2026-08-06T01:30:00Z'); // JST 10:30
});

test('extractAbsCalendar: event-name要素が無い入力は構造的失敗を返す', () => {
  const r = extractAbsCalendar('<html><body>nothing</body></html>');
  assert.equal(r.ok, false);
});

test('extractOnsReleases: 実fixtureのJSONを正しくparseできる（GDP関連の未来日程を含む）', () => {
  const r = extractOnsReleases(fx('gb_ons', 'releases_api_upcoming_gdp.json'));
  assert.equal(r.ok, true);
  assert.ok(r.rows.length > 0);
  const gdpMonthly = r.rows.find((row) => /GDP monthly estimate, UK: July 2026$/.test(row.title));
  assert.ok(gdpMonthly, 'GDP monthly estimateが見つからない');
  assert.equal(gdpMonthly.utcInstant, '2026-09-11T06:00:00.000Z');
});

test('extractOnsReleases: releases配列が無いJSONは構造的失敗を返す', () => {
  const r = extractOnsReleases(JSON.stringify({ foo: 'bar' }));
  assert.equal(r.ok, false);
});

test('extractOnsReleases: 不正なJSONは構造的失敗を返す', () => {
  const r = extractOnsReleases('{not valid json');
  assert.equal(r.ok, false);
});

test('extractRbaMeetings + buildRbaSchedule: 実fixtureの2026年8月がground truth(2026-08-11)と一致する', () => {
  const r = extractRbaMeetings(fx('au_rba', 'board_meeting_schedule.html'));
  assert.equal(r.ok, true);
  const aug = r.meetings.find((m) => m.year === 2026 && m.month === 'August');
  assert.equal(aug.date, '2026-08-11');
  const schedule = buildRbaSchedule(r.meetings.filter((m) => m.year === 2026));
  assert.ok(schedule.some((e) => e.date === '2026-08-11' && e.kind === 'policy_rate'));
  assert.ok(schedule.some((e) => e.date === '2026-08-11' && e.kind === 'press_conference'));
  assert.ok(schedule.some((e) => e.date === '2026-08-11' && e.kind === 'quarterly_report'));
});

test('extractRbaMeetings: テーブルが無い入力は構造的失敗を返す', () => {
  const r = extractRbaMeetings('<html>no schedule table</html>');
  assert.equal(r.ok, false);
});

test('extractBojSchedule: 実fixtureからground truth（議事要旨8/5・主な意見8/10）を抽出できる', () => {
  const r = extractBojSchedule(fx('jp_boj', 'mpm_index.html'));
  assert.equal(r.ok, true);
  assert.ok(r.entries.some((e) => e.date === '2026-08-05' && e.kind === 'minutes_summary'));
  assert.ok(r.entries.some((e) => e.date === '2026-08-10' && e.kind === 'opinions_summary'));
});

test('extractBojSchedule: テーブルが無い入力は構造的失敗を返す', () => {
  const r = extractBojSchedule('<html>no table</html>');
  assert.equal(r.ok, false);
});
