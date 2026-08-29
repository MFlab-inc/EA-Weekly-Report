'use strict';
// scripts/lib/month-end-notice.js のユニットテスト（task #82）。
// しょうさん修正指示2点（英国銀行休業日考慮／3・9月=半期末・6・12月=四半期末）が
// 正しく実装されているかを実データ（config/gb-bank-holidays.json）で検証する。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { monthEndBusinessDay, tierForMonth, detectMonthEndNotice } = require('../scripts/lib/month-end-notice');

test('monthEndBusinessDay: 2026年8月は8/31が英国銀行休業日（August Bank Holiday）のため8/28（金）になる', () => {
  assert.equal(monthEndBusinessDay(2026, 8), '2026-08-28');
});

test('monthEndBusinessDay: 2026年10月は10/31が土曜のため10/30（金）になる', () => {
  assert.equal(monthEndBusinessDay(2026, 10), '2026-10-30');
});

test('monthEndBusinessDay: 2026年6月は6/30がそのまま平日（火）で祝日も無いため6/30になる', () => {
  assert.equal(monthEndBusinessDay(2026, 6), '2026-06-30');
});

test('monthEndBusinessDay: 2026年9月は9/30がそのまま平日（水）で祝日も無いため9/30になる', () => {
  assert.equal(monthEndBusinessDay(2026, 9), '2026-09-30');
});

test('monthEndBusinessDay: 2026年12月は12/31がそのまま平日（木）で祝日も無いため12/31になる', () => {
  assert.equal(monthEndBusinessDay(2026, 12), '2026-12-31');
});

test('monthEndBusinessDay: 祝日データが対象年+1年分までカバーされていない場合はnull（フェールクローズ）', () => {
  // config/gb-bank-holidays.jsonのmaxYearを超える遠い未来の年を指定する
  assert.equal(monthEndBusinessDay(2099, 8), null);
});

test('tierForMonth: 3月・9月は半期末（half_end、しょうさん修正2＝日本の年度末・中間決算期基準）', () => {
  assert.equal(tierForMonth(3), 'half_end');
  assert.equal(tierForMonth(9), 'half_end');
});

test('tierForMonth: 6月・12月は四半期末（quarter_end）', () => {
  assert.equal(tierForMonth(6), 'quarter_end');
  assert.equal(tierForMonth(12), 'quarter_end');
});

test('tierForMonth: それ以外の月は月末（month_end）', () => {
  for (const m of [1, 2, 4, 5, 7, 8, 10, 11]) {
    assert.equal(tierForMonth(m), 'month_end');
  }
});

test('detectMonthEndNotice: 2026-08-31週（月〜金=8/31〜9/4）は月末営業日(8/28)が前週のためnull', () => {
  // しょうさん指摘の修正1（英国銀行休業日考慮）適用後の重要な帰結: 2026-08-31は
  // それ自体が英国銀行休業日のため、8月の月末営業日は前週の8/28（金）になり、
  // 8/31週には月末注意喚起が出ない（旧設計＝週末のみ考慮では8/31を検出していた）
  assert.equal(detectMonthEndNotice('2026-08-31', '2026-09-04'), null);
});

test('detectMonthEndNotice: 2026-08-24週（月〜金=8/24〜8/28）は8/28が月末営業日のためmonth_endで検出', () => {
  const notice = detectMonthEndNotice('2026-08-24', '2026-08-28');
  assert.equal(notice.date, '2026-08-28');
  assert.equal(notice.month, 8);
  assert.equal(notice.tier, 'month_end');
  assert.equal(notice.fixTimeJst.time, '00:00');
  assert.equal(notice.fixTimeJst.date, '2026-08-29');
});

test('detectMonthEndNotice: 2026-10-26週（月〜金=10/26〜10/30）は10/30が月末営業日のためmonth_endで検出', () => {
  const notice = detectMonthEndNotice('2026-10-26', '2026-10-30');
  assert.equal(notice.date, '2026-10-30');
  assert.equal(notice.tier, 'month_end');
  // 10/30時点でロンドンはGMT（BST終了後）のため16:00 GMT=UTC+0=翌01:00 JST
  assert.equal(notice.fixTimeJst.time, '01:00');
  assert.equal(notice.fixTimeJst.date, '2026-10-31');
});

test('detectMonthEndNotice: 2026-06-29週（月〜金=6/29〜7/3、月またぎ）は6/30が四半期末として検出される', () => {
  const notice = detectMonthEndNotice('2026-06-29', '2026-07-03');
  assert.equal(notice.date, '2026-06-30');
  assert.equal(notice.month, 6);
  assert.equal(notice.tier, 'quarter_end');
  assert.equal(notice.fixTimeJst.time, '00:00');
});

test('detectMonthEndNotice: 2026-09-28週（月〜金=9/28〜10/2、月またぎ）は9/30が半期末として検出される', () => {
  const notice = detectMonthEndNotice('2026-09-28', '2026-10-02');
  assert.equal(notice.date, '2026-09-30');
  assert.equal(notice.month, 9);
  assert.equal(notice.tier, 'half_end');
});

test('detectMonthEndNotice: 月末を含まない週はnull', () => {
  assert.equal(detectMonthEndNotice('2026-08-17', '2026-08-21'), null);
});
