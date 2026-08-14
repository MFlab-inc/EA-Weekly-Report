'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { extractEcbPolicyRateSchedule, parseEcbDate } = require('../scripts/checkers/extractors/ecb-policy-rate');

const fx = (...p) => readFileSync(join(__dirname, 'fixtures', 'official-sources', ...p), 'utf8');
const html = fx('ecb_policy_rate', 'gc_calendar.html');

// フィクスチャ取得時点（2026-08-15）の直近実測: 2026年分は既に過ぎた回がページから落ちており
// （decisionページと異なりgc_calendarは将来分主体の掲載）、既実施会合の抽出検証はできない。
// しょうさん承認の検証基準（b）: 次回会合が未来であること＋年間回数が公表回数(8)と一致することで判定する
const FETCHED_AT = '2026-08-15';

test('parseEcbDate: "10/09/2026"→"2026-09-10"', () => {
  assert.equal(parseEcbDate('10/09/2026'), '2026-09-10');
});

test('extractEcbPolicyRateSchedule: 次回会合（2026-09-10）はフィクスチャ取得日より未来', () => {
  const r = extractEcbPolicyRateSchedule(html);
  assert.equal(r.ok, true);
  const next = r.entries
    .filter((e) => e.kind === 'policy_rate' && e.date > FETCHED_AT)
    .map((e) => e.date)
    .sort()[0];
  assert.equal(next, '2026-09-10');
});

test('extractEcbPolicyRateSchedule: 2027年通年でpolicy_rateが8回（ECB公表回数と一致）', () => {
  const r = extractEcbPolicyRateSchedule(html);
  const dates2027 = [...new Set(r.entries.filter((e) => e.kind === 'policy_rate' && e.date.startsWith('2027')).map((e) => e.date))];
  assert.equal(dates2027.length, 8);
});

test('extractEcbPolicyRateSchedule: policy_rateの各日にpress_conferenceが対で存在する', () => {
  const r = extractEcbPolicyRateSchedule(html);
  const rateDates = r.entries.filter((e) => e.kind === 'policy_rate').map((e) => e.date);
  const pcDates = new Set(r.entries.filter((e) => e.kind === 'press_conference').map((e) => e.date));
  for (const d of rateDates) assert.ok(pcDates.has(d), `press_conferenceが対応していない: ${d}`);
});

test('extractEcbPolicyRateSchedule: 金融政策会合（Day2）が1件も無い入力は構造的失敗を返す', () => {
  const r = extractEcbPolicyRateSchedule('<dl><dt>01/01/2026</dt><dd>General Council meeting<br></dd></dl>');
  assert.equal(r.ok, false);
});
