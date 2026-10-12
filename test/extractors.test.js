'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { extractCensusCalendar } = require('../scripts/checkers/extractors/census');
const { extractAbsCalendar } = require('../scripts/checkers/extractors/abs');
const { extractOnsReleases } = require('../scripts/checkers/extractors/ons');
const { extractRbaMeetings, buildRbaSchedule } = require('../scripts/checkers/extractors/rba');
const { extractBojSchedule, parseMpmDecisionDate } = require('../scripts/checkers/extractors/boj');

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

// 2026-10-12追加（しょうさん指摘、米小売売上高欠落インシデントの真因判明）: calendar-listview.html
// 自体が、ある時点で「翌年の予定表」へ切り替わる（2026-10-12実測: 164行全てが2027年の行で
// 2026年の行が0件だった）。行数は0ではないため既存の「0行＝構造的失敗」判定では検知できない。
// targetWeekを渡し、対象週の4週前〜8週後に該当する行が1件も無い場合に構造的失敗を返すことを確認する
test('extractCensusCalendar: 対象週から大きく外れた年のみの行はtargetWeek指定で構造的失敗（別の年を表示している疑い）を返す', () => {
  const html = fx('us_census', 'calendar_listview.html');
  // fixtureは2026年の行のみ（2026-01-08〜2026-12-27想定）。2026年から十分離れた2030年を
  // 対象週に指定することで「別の年を表示している」状態を再現する
  const targetWeek = { targetWeekStart: '2030-10-14', targetWeekEnd: '2030-10-18' };
  const r = extractCensusCalendar(html, targetWeek);
  assert.equal(r.ok, false);
  assert.match(r.reason, /別の年を表示している疑い/);
});

test('extractCensusCalendar: 対象週の4週前〜8週後に該当する行があればtargetWeek指定でもok:trueのまま', () => {
  const html = fx('us_census', 'calendar_listview.html');
  // fixtureの小売売上高(8/14)・貿易収支(8/4)を含む8/10週・8/3週なら正常
  const targetWeek = { targetWeekStart: '2026-08-10', targetWeekEnd: '2026-08-14' };
  const r = extractCensusCalendar(html, targetWeek);
  assert.equal(r.ok, true);
});

test('extractCensusCalendar: targetWeek省略時は年ロールオーバー検知を行わない（既存の2引数省略呼び出しとの後方互換）', () => {
  const html = fx('us_census', 'calendar_listview.html');
  const r = extractCensusCalendar(html);
  assert.equal(r.ok, true);
});

// 2026-10-12実測の生データ（calendar-listview.htmlが2027年の予定表のみになっていた状態）を
// 再現した回帰テスト。実際にこのインシデントで起きた状況そのものを固定フィクスチャとして残す
test('extractCensusCalendar: 実測した年ロールオーバー状態（2027年のみ164行）は対象週2026-10-12週で構造的失敗になる', () => {
  const rows2027 = [];
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0');
    rows2027.push(
      `<tr height="20"><td height="20"><a href="/retail">Advance Monthly Sales for Retail and Food Services</a></td><td sorttable_customkey="2027${mm}150830">2027</td><td>8:30 AM</td><td>2026</td></tr>`
    );
  }
  const html = rows2027.join('\n');
  const targetWeek = { targetWeekStart: '2026-10-12', targetWeekEnd: '2026-10-16' };
  const r = extractCensusCalendar(html, targetWeek);
  assert.equal(r.ok, false);
  assert.match(r.reason, /別の年を表示している疑い/);
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

// task #47（2026-08-15、8/17週フルパイプライン実ネットワーク検証で発見した実バグ）の回帰テスト:
// ONSは本体リリースと同一瞬間に付随的な「{タイトル} time series」リリースを別途返すため、
// フィルタしないと同一イベントが重複して抽出されてしまう（実際にレポート上でCPIが2件重複表示された）
test('extractOnsReleases: "{タイトル} time series"の付随リリースは本体と同一瞬間でも重複除外される（GDP fixture）', () => {
  const r = extractOnsReleases(fx('gb_ons', 'releases_api_upcoming_gdp.json'));
  assert.equal(r.ok, true);
  const timeSeriesRows = r.rows.filter((row) => / time series$/i.test(row.title));
  assert.equal(timeSeriesRows.length, 0, 'time series付随リリースが除外されていない');
  // 本体（"time series"接尾辞なし）は引き続き残ること
  assert.ok(r.rows.some((row) => row.title === 'GDP monthly estimate, UK: July 2026'));
  assert.ok(r.rows.some((row) => row.title === 'GDP quarterly national accounts, UK: April to June 2026'));
});

test('extractOnsReleases: CPI実fixture（task #47ライブ検証で実測）でも本体と"time series"付随リリースの重複が解消される', () => {
  const r = extractOnsReleases(fx('gb_ons', 'releases_api_upcoming_cpi.json'));
  assert.equal(r.ok, true);
  const cpiJuly = r.rows.filter((row) => /^Consumer price inflation, UK: July 2026/.test(row.title));
  assert.equal(cpiJuly.length, 1, '2026-08-19発表分のCPIが重複除外されず複数残っている');
  assert.equal(cpiJuly[0].title, 'Consumer price inflation, UK: July 2026');
  assert.equal(cpiJuly[0].utcInstant, '2026-08-19T06:00:00.000Z');
  // 別リリース（CPI(H) import intensity）はtitleがmatch対象外のため元々混入しない。ここではtime series
  // 除外の副作用でこちらまで消えていないことを確認する
  assert.ok(r.rows.some((row) => /^Contributions to the 12-month rate of CPI\(H\)/.test(row.title)));
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

// task #19（coverage-gap-2026-08-15.md）: 列[1]「Date of MPM」から政策金利決定発表日（会合2日目）を追加抽出
test('parseMpmDecisionDate: "Jan. 22 (Thurs.), 23 (Fri.)"→会合2日目の"2026-01-23"', () => {
  assert.equal(parseMpmDecisionDate('Jan. 22 (Thurs.), 23 (Fri.) [PDF 171KB]', 2026), '2026-01-23');
});

test('parseMpmDecisionDate: 改行混入セルも正規化して解析できる', () => {
  assert.equal(parseMpmDecisionDate('Mar. 17\n  (Wed.), 18 (Thurs.)', 2027), '2027-03-18');
});

test('extractBojSchedule: 実fixtureから2026・2027年とも年8回のpolicy_rateが抽出できる（既存opinions/minutesと会合回数一致）', () => {
  const r = extractBojSchedule(fx('jp_boj', 'mpm_index.html'));
  assert.equal(r.ok, true);
  for (const year of ['2026', '2027']) {
    const dates = r.entries.filter((e) => e.kind === 'policy_rate' && e.date.startsWith(year));
    assert.equal(dates.length, 8, `${year}年のpolicy_rate件数が想定と異なる: ${dates.length}`);
  }
  // 直近の既実施会合（2026-07-31、既存minutes_summary 2026-08-05の直前会合）が含まれることを確認
  assert.ok(r.entries.some((e) => e.date === '2026-07-31' && e.kind === 'policy_rate'));
});
