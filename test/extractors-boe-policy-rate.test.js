'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { extractBoePolicyRateSchedule } = require('../scripts/checkers/extractors/boe-policy-rate');

const fx = (...p) => readFileSync(join(__dirname, 'fixtures', 'official-sources', ...p), 'utf8');
const html = fx('boe_policy_rate', 'upcoming_mpc_dates.html');

// フィクスチャ取得時点（2026-08-15）基準。BOEのconfirmed datesページは年始めからの全件を
// 通年掲載する構造のため、既実施会合（2026-07-30）の存在確認ができる（検証基準a）
const FETCHED_AT = '2026-08-15';

test('extractBoePolicyRateSchedule: 直近の既実施会合（2026-07-30）が抽出される', () => {
  const r = extractBoePolicyRateSchedule(html);
  assert.equal(r.ok, true);
  assert.ok(r.entries.some((e) => e.date === '2026-07-30' && e.kind === 'policy_rate'));
});

test('extractBoePolicyRateSchedule: 次回会合（2026-09-17）はフィクスチャ取得日より未来', () => {
  const r = extractBoePolicyRateSchedule(html);
  const next = r.entries.map((e) => e.date).filter((d) => d > FETCHED_AT).sort()[0];
  assert.equal(next, '2026-09-17');
});

test('extractBoePolicyRateSchedule: 2026年・2027年ともpolicy_rateが8回（BOE公表回数と一致）', () => {
  const r = extractBoePolicyRateSchedule(html);
  for (const year of ['2026', '2027']) {
    const dates = r.entries.filter((e) => e.date.startsWith(year)).map((e) => e.date);
    assert.equal(dates.length, 8, `${year}年の件数が想定と異なる: ${dates.length}`);
  }
});

test('extractBoePolicyRateSchedule: 年別見出し・table行が無い入力は構造的失敗を返す', () => {
  const r = extractBoePolicyRateSchedule('<html><body>no table</body></html>');
  assert.equal(r.ok, false);
});
