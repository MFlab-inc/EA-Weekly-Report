'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  usFinalMfgPmiDraftForMonth,
  cnRatingDogMfgPmiDraftForMonth,
  finalMfgPmiDraftRange,
} = require('../scripts/lib/final-mfg-pmi-schedule');
const { cnPublicHolidays, cnPublicHolidaysMaxYear } = require('../scripts/lib/cn-public-holidays');

// 2026-11-28確認（WebSearch研究agentが報道各社の記事日付・URLタイムスタンプ・S&P Global発表文の
// エンバーゴ表記から確認、全件confidence=high）。キー=発表が行われる月初の年月、値=実際の発表日
// （前月分のデータ）。米国2026-03のみ根拠がやや弱い（S&P Global発表文のエンバーゴ表記の検索断片のみ）
const US_VERIFIED_ACTUALS = {
  '2024-01': '2024-01-02', '2024-02': '2024-02-01', '2024-03': '2024-03-01', '2024-04': '2024-04-01',
  '2024-05': '2024-05-01', '2024-06': '2024-06-03', '2024-07': '2024-07-01', '2024-08': '2024-08-01',
  '2024-09': '2024-09-03', // 9/2はLabor Day
  '2024-10': '2024-10-01', '2024-11': '2024-11-01', '2024-12': '2024-12-02',
  '2025-01': '2025-01-02', '2025-02': '2025-02-03', '2025-03': '2025-03-03', '2025-04': '2025-04-01',
  '2025-05': '2025-05-01', '2025-06': '2025-06-02', '2025-07': '2025-07-01', '2025-08': '2025-08-01',
  '2025-09': '2025-09-02', // 9/1はLabor Day
  '2025-10': '2025-10-01', '2025-11': '2025-11-03', '2025-12': '2025-12-01',
  '2026-01': '2026-01-02', '2026-02': '2026-02-02', '2026-03': '2026-03-02', '2026-04': '2026-04-01',
  '2026-05': '2026-05-01', '2026-06': '2026-06-01', '2026-07': '2026-07-01', '2026-08': '2026-08-03',
  '2026-09': '2026-09-01', '2026-10': '2026-10-01', '2026-11': '2026-11-02',
};

const CN_VERIFIED_ACTUALS = {
  '2024-01': '2024-01-02', '2024-02': '2024-02-01', '2024-03': '2024-03-01', '2024-04': '2024-04-01',
  '2024-05': '2024-04-30', // 劳动节前倒し
  '2024-06': '2024-06-03', '2024-07': '2024-07-01', '2024-08': '2024-08-01',
  '2024-09': '2024-09-02', // 米国(9/3)と違い、中国はLabor Dayの影響を受けない
  '2024-10': '2024-09-30', // 国庆节前倒し
  '2024-11': '2024-11-01', '2024-12': '2024-12-02',
  '2025-01': '2025-01-02', // 2025年の元旦休みは1/1のみ
  '2025-02': '2025-02-03', // 春节休暇中（1/28〜2/4）でもそのまま発表 → 規則ではnull
  '2025-03': '2025-03-03', '2025-04': '2025-04-01',
  '2025-05': '2025-04-30', // 劳动节前倒し
  '2025-06': '2025-06-03', // 端午节（5/31〜6/2）明けに後ろ倒し → 規則ではnull
  '2025-07': '2025-07-01', '2025-08': '2025-08-01', '2025-09': '2025-09-01',
  '2025-10': '2025-09-30', // 国庆节前倒し
  '2025-11': '2025-11-03', '2025-12': '2025-12-01',
  '2026-01': '2025-12-31', // 元旦休暇（1/1〜1/3）前に前倒し → 規則ではnull
  '2026-02': '2026-02-02',
  '2026-03': '2026-03-04', // 規則外（候補日3/2、理由不明）
  '2026-04': '2026-04-01',
  '2026-05': '2026-04-30', // 劳动节前倒し
  '2026-06': '2026-06-01', '2026-07': '2026-07-01', '2026-08': '2026-08-03', '2026-09': '2026-09-01',
  '2026-10': '2026-09-30', // 国庆节前倒し
  '2026-11': '2026-11-02',
};

// 規則で決めない（nullを返す）月と、規則と実績がずれた月
const CN_NULL_MONTHS = new Set(['2025-02', '2025-06', '2026-01']);
const CN_KNOWN_EXCEPTIONS = new Set(['2026-03']);

function ymOf(key) {
  return key.split('-').map(Number);
}

test('usFinalMfgPmiDraftForMonth: 検証済み実績35ヶ月すべてと厳密一致する（月の第1米営業日）', () => {
  assert.equal(Object.keys(US_VERIFIED_ACTUALS).length, 35);
  for (const [ym, actual] of Object.entries(US_VERIFIED_ACTUALS)) {
    const [y, m] = ymOf(ym);
    assert.equal(usFinalMfgPmiDraftForMonth(y, m), actual, `${ym}`);
  }
});

test('cnRatingDogMfgPmiDraftForMonth: null月・既知の例外を除く31ヶ月すべてと厳密一致する', () => {
  assert.equal(Object.keys(CN_VERIFIED_ACTUALS).length, 35);
  let matched = 0;
  for (const [ym, actual] of Object.entries(CN_VERIFIED_ACTUALS)) {
    if (CN_NULL_MONTHS.has(ym) || CN_KNOWN_EXCEPTIONS.has(ym)) continue;
    const [y, m] = ymOf(ym);
    assert.equal(cnRatingDogMfgPmiDraftForMonth(y, m), actual, `${ym}`);
    matched++;
  }
  assert.equal(matched, 31);
});

test('cnRatingDogMfgPmiDraftForMonth: 実績がばらばらだった祝日重なり月（元旦・春节・端午节）はnullを返す', () => {
  for (const ym of CN_NULL_MONTHS) {
    const [y, m] = ymOf(ym);
    assert.equal(cnRatingDogMfgPmiDraftForMonth(y, m), null, `${ym}`);
  }
});

test('cnRatingDogMfgPmiDraftForMonth: 既知の例外2026年3月は規則上3/2になる（実績3/4とずれることを明示的に記録）', () => {
  assert.equal(cnRatingDogMfgPmiDraftForMonth(2026, 3), '2026-03-02');
  assert.notEqual(cnRatingDogMfgPmiDraftForMonth(2026, 3), CN_VERIFIED_ACTUALS['2026-03']);
});

test('cnRatingDogMfgPmiDraftForMonth: 祝日データの無い年はnull（推測で埋めない）', () => {
  const next = cnPublicHolidaysMaxYear() + 1;
  assert.equal(cnPublicHolidays(next), null);
  for (let m = 1; m <= 12; m++) {
    assert.equal(cnRatingDogMfgPmiDraftForMonth(next, m), null);
  }
});

test('2027年ドラフト: 米国・中国ともに想定どおりの日付になる（config/official-sources.jsonへ転記した値）', () => {
  const draft = finalMfgPmiDraftRange(2027, 1, 12);
  const us = draft.map((e) => e.us);
  const cn = draft.map((e) => e.cn);
  assert.deepEqual(us, [
    '2027-01-04', '2027-02-01', '2027-03-01', '2027-04-01', '2027-05-03', '2027-06-01',
    '2027-07-01', '2027-08-02', '2027-09-01', '2027-10-01', '2027-11-01', '2027-12-01',
  ]);
  assert.deepEqual(cn, [
    '2027-01-04', // 元旦休暇は1/1〜1/3（金〜日）で、候補日1/4（月）は祝日ではない
    '2027-02-01', '2027-03-01', '2027-04-01',
    '2027-04-30', // 5/1（土）〜5/5が劳动节 → 候補日5/3も祝日 → 4/30（金）に前倒し
    '2027-06-01', '2027-07-01', '2027-08-02', '2027-09-01',
    '2027-09-30', // 国庆节（10/1〜10/7）前倒し
    '2027-11-01', '2027-12-01',
  ]);
});

test('config/official-sources.json: us_sp_final_mfg_pmi・cn_pmiのscheduleが規則の計算結果と一致する', () => {
  const sources = require('../config/official-sources.json').sources;
  const usSrc = sources.find((s) => s.id === 'us_sp_final_mfg_pmi');
  const cnSrc = sources.find((s) => s.id === 'cn_pmi');
  for (const e of usSrc.schedule) {
    const [y, m] = ymOf(e.date);
    assert.equal(usFinalMfgPmiDraftForMonth(y, m), e.date, `us ${e.date}`);
  }
  for (const e of cnSrc.schedule) {
    // 4/30・9/30は翌月（5月・10月）の発表回
    let [y, m] = ymOf(e.date);
    if (Number(e.date.slice(8)) >= 25) m += 1;
    if (m > 12) { m = 1; y += 1; }
    assert.equal(cnRatingDogMfgPmiDraftForMonth(y, m), e.date, `cn ${e.date}`);
  }
});
