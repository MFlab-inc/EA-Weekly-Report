'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { flashPmiDraftForMonth, flashPmiDraftRange } = require('../scripts/lib/flash-pmi-schedule');

// task #53（2026-08-15、しょうさん承認済み規則）: 3経路（WebSearch研究agent×3・GOV.UK公式
// データでの機械計算）で突合した2024年通年＋2025年8月〜2026年7月の実績日（S&P Global/HCOB
// Flash Manufacturing PMI、DE/EU/GB共通の同一暦日）。12月は意図的な前倒し例外のため対象外
const VERIFIED_ACTUALS = {
  '2024-01': '2024-01-24',
  '2024-02': '2024-02-22',
  '2024-03': '2024-03-21', // Good Friday(2024-03-29)前倒しの実質テスト
  '2024-04': '2024-04-23', // Easter Monday(2024-04-01)は月初のため月末側に影響なし
  '2024-05': '2024-05-23', // Early May(5/6)+Spring Bank Holiday(5/27)の2祝日月
  '2024-06': '2024-06-21',
  '2024-07': '2024-07-24',
  '2024-08': '2024-08-22', // Summer Bank Holiday(8/26)
  '2024-09': '2024-09-23',
  '2024-10': '2024-10-24',
  '2024-11': '2024-11-22',
  '2025-08': '2025-08-21', // Summer Bank Holiday(8/25)
  '2025-09': '2025-09-23',
  '2025-10': '2025-10-24',
  '2025-11': '2025-11-21',
  '2026-01': '2026-01-23',
  '2026-02': '2026-02-20',
  '2026-03': '2026-03-24',
  '2026-04': '2026-04-23',
  '2026-05': '2026-05-21', // Spring Bank Holiday(5/25)
  '2026-06': '2026-06-23',
  '2026-07': '2026-07-24',
};

test('flashPmiDraftForMonth: 検証済み実績24ヶ月中22ヶ月（12月2件を除く全月）と厳密一致する', () => {
  for (const [ym, actual] of Object.entries(VERIFIED_ACTUALS)) {
    const [y, m] = ym.split('-').map(Number);
    const predicted = flashPmiDraftForMonth(y, m);
    assert.equal(predicted, actual, `${ym}: 予測${predicted} != 実績${actual}`);
  }
});

test('flashPmiDraftForMonth: 12月は規則性が無いため常にnull（手動確定が必要）', () => {
  assert.equal(flashPmiDraftForMonth(2024, 12), null);
  assert.equal(flashPmiDraftForMonth(2025, 12), null);
  assert.equal(flashPmiDraftForMonth(2026, 12), null);
});

test('flashPmiDraftForMonth: Good Fridayが月末営業日算入に影響する2024年3月を正しく前倒しする', () => {
  // 2024-03-29(Good Friday)を除外しないと2024-03-22(誤)になる。除外して2024-03-21(正)
  assert.equal(flashPmiDraftForMonth(2024, 3), '2024-03-21');
});

test('flashPmiDraftForMonth: 2祝日月（Early May+Spring Bank Holiday）の2024年5月を正しく処理する', () => {
  assert.equal(flashPmiDraftForMonth(2024, 5), '2024-05-23');
});

test('flashPmiDraftRange: 12月をスキップしつつ連続して返す', () => {
  const draft = flashPmiDraftRange(2026, 11, 3); // 11月・12月・1月
  const months = draft.map((e) => `${e.year}-${String(e.month).padStart(2, '0')}`);
  assert.ok(months.includes('2026-11'));
  assert.ok(!months.includes('2026-12')); // 12月は規則なしのためスキップ
  assert.ok(months.includes('2027-01'));
});

test('flashPmiDraftRange: 年またぎでも連続して計算できる', () => {
  const draft = flashPmiDraftRange(2027, 11, 3);
  assert.ok(draft.some((e) => e.date.startsWith('2027-11')));
  assert.ok(draft.some((e) => e.date.startsWith('2028-01')));
});
