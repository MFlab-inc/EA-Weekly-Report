'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { extractBocPolicyRateSchedule, parseBocDate } = require('../scripts/checkers/extractors/boc-policy-rate');

const fx = (...p) => readFileSync(join(__dirname, 'fixtures', 'official-sources', ...p), 'utf8');
const html = fx('boc_policy_rate', 'upcoming_events.html');

// upcoming-events/はローリング約4ヶ月先までの催事一覧（年次一括公表ではない）ため、
// このフィクスチャに既実施会合は含まれない。しょうさん承認の検証基準（b）:
// 次回会合が未来であること＋会合間隔が公表回数(年8回=約6〜8週間隔)と整合することで判定する
const FETCHED_AT = '2026-08-15';

test('parseBocDate: "September 2, 2026"→"2026-09-02"', () => {
  assert.equal(parseBocDate('September 2, 2026'), '2026-09-02');
});

test('extractBocPolicyRateSchedule: 「Interest Rate Announcement」のみ抽出し他の催事（祝日・調査公表等）は除外する', () => {
  const r = extractBocPolicyRateSchedule(html);
  assert.equal(r.ok, true);
  const dates = r.rows.filter((x) => x.kind === 'policy_rate').map((x) => x.date);
  assert.deepEqual(dates, ['2026-09-02', '2026-10-28', '2026-12-09']);
});

test('extractBocPolicyRateSchedule: 次回会合（2026-09-02）はフィクスチャ取得日より未来、会合間隔が約8週間隔', () => {
  const r = extractBocPolicyRateSchedule(html);
  const dates = r.rows.filter((x) => x.kind === 'policy_rate').map((x) => x.date).sort();
  assert.ok(dates[0] > FETCHED_AT);
  const days = (a, b) => (new Date(b) - new Date(a)) / 86400000;
  for (let i = 1; i < dates.length; i++) {
    const gap = days(dates[i - 1], dates[i]);
    assert.ok(gap >= 35 && gap <= 60, `会合間隔が年8回ペース(5〜8週間)から外れている: ${dates[i - 1]}→${dates[i]} (${gap}日)`);
  }
});

test('extractBocPolicyRateSchedule: 「...and Monetary Policy Report」を伴う回はquarterly_reportも付与する', () => {
  const r = extractBocPolicyRateSchedule(html);
  const oct28 = r.rows.filter((x) => x.date === '2026-10-28');
  assert.deepEqual(oct28.map((x) => x.kind).sort(), ['policy_rate', 'quarterly_report']);
  const sep2 = r.rows.filter((x) => x.date === '2026-09-02');
  assert.deepEqual(sep2.map((x) => x.kind), ['policy_rate']);
});

test('extractBocPolicyRateSchedule: 発表時刻09:45(ET)がすべての行で抽出される', () => {
  const r = extractBocPolicyRateSchedule(html);
  for (const row of r.rows) assert.equal(row.localTime, '09:45');
});

test('extractBocPolicyRateSchedule: 「Interest Rate Announcement」催事が無い入力は構造的失敗を返す', () => {
  const r = extractBocPolicyRateSchedule('<html><body>no articles</body></html>');
  assert.equal(r.ok, false);
});
