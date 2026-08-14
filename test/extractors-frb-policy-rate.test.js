'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { extractFrbPolicyRateSchedule } = require('../scripts/checkers/extractors/frb-policy-rate');

const fx = (...p) => readFileSync(join(__dirname, 'fixtures', 'official-sources', ...p), 'utf8');
const html = fx('us_frb_policy_rate', 'fomc_calendars.html');

// フィクスチャ取得時点（2026-08-15、docs/phase1-official-sources.md参照）を基準に、
// しょうさん承認の検証基準（1〜2件の既実施会合＋年間回数の一致）で判定する
const FETCHED_AT = '2026-08-15';

test('extractFrbPolicyRateSchedule: 直近の既実施会合（2026-07-29）がpolicy_rate/press_conferenceとして抽出される', () => {
  const r = extractFrbPolicyRateSchedule(html);
  assert.equal(r.ok, true);
  assert.ok(r.entries.some((e) => e.date === '2026-07-29' && e.kind === 'policy_rate'));
  assert.ok(r.entries.some((e) => e.date === '2026-07-29' && e.kind === 'press_conference'));
});

test('extractFrbPolicyRateSchedule: 次回会合（2026-09-16）はフィクスチャ取得日より未来', () => {
  const r = extractFrbPolicyRateSchedule(html);
  const next = r.entries
    .filter((e) => e.kind === 'policy_rate' && e.date > FETCHED_AT)
    .map((e) => e.date)
    .sort()[0];
  assert.equal(next, '2026-09-16');
});

test('extractFrbPolicyRateSchedule: 2026年通年でpolicy_rateが8回（FOMC公表回数と一致）', () => {
  const r = extractFrbPolicyRateSchedule(html);
  const dates2026 = [...new Set(r.entries.filter((e) => e.kind === 'policy_rate' && e.date.startsWith('2026')).map((e) => e.date))];
  assert.equal(dates2026.length, 8);
});

test('extractFrbPolicyRateSchedule: quarterly_report（SEP公表会合）は年4回（3/6/9/12月）のみ', () => {
  const r = extractFrbPolicyRateSchedule(html);
  const qr2026 = r.entries.filter((e) => e.kind === 'quarterly_report' && e.date.startsWith('2026'));
  assert.equal(qr2026.length, 4);
  for (const e of qr2026) {
    const month = Number(e.date.slice(5, 7));
    assert.ok([3, 6, 9, 12].includes(month), `想定外の月にquarterly_report: ${e.date}`);
  }
});

test('extractFrbPolicyRateSchedule: 年別panel見出しが無い入力は構造的失敗を返す', () => {
  const r = extractFrbPolicyRateSchedule('<html><body>no panels</body></html>');
  assert.equal(r.ok, false);
});
