'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { suppressRepeatRecurringWarnings, periodKeyForTargetWeek } = require('../scripts/lib/suppress-repeat-recurring-warnings.js');

const RECURRING_CHECKS = [
  { name: '豪州貿易収支（ABS）', rule: '毎月1日〜10日ごろ（前月または前々月分を公表。既刊実績: 9/3発表分）' },
  { name: 'ADP雇用統計', rule: '毎月1日〜7日ごろ（米雇用統計[第1金曜]の直前、水曜公表が通例）' },
  { name: '米新規失業保険申請件数', rule: '毎週木曜（祝日で水曜等にずれる週あり）' },
];

const TRADE_BALANCE_WARNING = '定例欠落: 「豪州貿易収支（ABS）」（毎月1日〜10日ごろ）が対象週に該当する見込みだが検出されなかった。WARN';
const ADP_WARNING = '定例欠落: 「ADP雇用統計」（毎月1日〜7日ごろ）が対象週に該当する見込みだが検出されなかった。WARN';
const JOBLESS_WARNING = '定例欠落: 「米新規失業保険申請件数」（毎週木曜）が対象週に該当する見込みだが検出されなかった。WARN';

// 実例: 2026-09-28(月)〜10-02(金)＝9月・10月をまたぐ週（trade_balanceの「1〜10日ごろ」は
// 週後半[10/1・10/2]で一致する＝10月分の発生）。次の対象週2026-10-05(月)〜10-09(金)は
// 10月内に収まる週で、同じ10月分の発生に対して重複判定され得る
const PREVIOUS_WEEK_END_CROSSING = '2026-10-02'; // 前週(9/28週)の金曜＝10月
const CURRENT_WEEK_END = '2026-10-09'; // 今週(10/5週)の金曜＝10月

test('periodKeyForTargetWeek: YYYY-MM部分を返す', () => {
  assert.equal(periodKeyForTargetWeek('2026-10-05'), '2026-10');
  assert.equal(periodKeyForTargetWeek('2026-10-12'), '2026-10');
  assert.equal(periodKeyForTargetWeek('2026-11-02'), '2026-11');
});

test('suppressRepeatRecurringWarnings: 前週found:true・同一周期なら抑制する（au_abs実例: 9/28週[月をまたぐ]で検出済み→10/5週は抑制）', () => {
  const previousLedger = {
    meta: { target_week_start: '2026-09-28', target_week_end: PREVIOUS_WEEK_END_CROSSING },
    coverage: { recurring_checks: [{ name: '豪州貿易収支（ABS）', applies_this_week: true, found: true }] },
  };
  const result = suppressRepeatRecurringWarnings([TRADE_BALANCE_WARNING], RECURRING_CHECKS, CURRENT_WEEK_END, previousLedger);
  assert.deepEqual(result, []);
});

test('suppressRepeatRecurringWarnings: 前週found:false（pending_recon等）なら抑制しない（本物の欠落を隠さない。しょうさん指摘の安全条件）', () => {
  const previousLedger = {
    meta: { target_week_start: '2026-09-28', target_week_end: PREVIOUS_WEEK_END_CROSSING },
    coverage: { recurring_checks: [{ name: 'ADP雇用統計', applies_this_week: true, found: false }] },
  };
  const result = suppressRepeatRecurringWarnings([ADP_WARNING], RECURRING_CHECKS, CURRENT_WEEK_END, previousLedger);
  assert.deepEqual(result, [ADP_WARNING]);
});

test('suppressRepeatRecurringWarnings: 今週が本当の発表週で検出に失敗した場合、前週WARN済みでも黙殺しない（しょうさん指摘シナリオそのもの）', () => {
  // 前週(9/28週)は発表前で正しくWARN（found:false）。今週(10/5週)が本当の発表週なのに
  // 何らかの理由で検出に失敗した場合、これは新規の本物の欠落であり抑制してはならない
  const previousLedger = {
    meta: { target_week_start: '2026-09-28', target_week_end: PREVIOUS_WEEK_END_CROSSING },
    coverage: { recurring_checks: [{ name: '豪州貿易収支（ABS）', applies_this_week: true, found: false }] },
  };
  const result = suppressRepeatRecurringWarnings([TRADE_BALANCE_WARNING], RECURRING_CHECKS, CURRENT_WEEK_END, previousLedger);
  assert.deepEqual(result, [TRADE_BALANCE_WARNING]);
});

test('suppressRepeatRecurringWarnings: 前週が別の周期（暦月不一致）なら抑制しない', () => {
  const previousLedger = {
    meta: { target_week_start: '2026-08-24', target_week_end: '2026-08-28' }, // 8月で完結する週
    coverage: { recurring_checks: [{ name: '豪州貿易収支（ABS）', applies_this_week: true, found: true }] },
  };
  // 前週の周期(2026-08)と今週の周期(2026-10)が異なるため、前週の検出は今週の判定に影響しない
  const result = suppressRepeatRecurringWarnings([TRADE_BALANCE_WARNING], RECURRING_CHECKS, CURRENT_WEEK_END, previousLedger);
  assert.deepEqual(result, [TRADE_BALANCE_WARNING]);
});

test('suppressRepeatRecurringWarnings: 「毎週」ルールは前週found:trueでも抑制しない（週ごとに独立した正当な発生のため）', () => {
  const previousLedger = {
    meta: { target_week_start: '2026-09-28', target_week_end: PREVIOUS_WEEK_END_CROSSING },
    coverage: { recurring_checks: [{ name: '米新規失業保険申請件数', applies_this_week: true, found: true }] },
  };
  const result = suppressRepeatRecurringWarnings([JOBLESS_WARNING], RECURRING_CHECKS, CURRENT_WEEK_END, previousLedger);
  assert.deepEqual(result, [JOBLESS_WARNING]);
});

test('suppressRepeatRecurringWarnings: previousLedgerが無ければ全件そのまま返す（安全側の既定動作）', () => {
  const result = suppressRepeatRecurringWarnings([TRADE_BALANCE_WARNING, ADP_WARNING], RECURRING_CHECKS, CURRENT_WEEK_END, null);
  assert.deepEqual(result, [TRADE_BALANCE_WARNING, ADP_WARNING]);
});

test('suppressRepeatRecurringWarnings: previousLedgerにcoverage.recurring_checksが無ければ全件そのまま返す', () => {
  const previousLedger = { meta: { target_week_start: '2026-09-28', target_week_end: PREVIOUS_WEEK_END_CROSSING } };
  const result = suppressRepeatRecurringWarnings([TRADE_BALANCE_WARNING], RECURRING_CHECKS, CURRENT_WEEK_END, previousLedger);
  assert.deepEqual(result, [TRADE_BALANCE_WARNING]);
});

test('suppressRepeatRecurringWarnings: 複数件のうち該当ルールのみ抑制し、他はそのまま残る', () => {
  const previousLedger = {
    meta: { target_week_start: '2026-09-28', target_week_end: PREVIOUS_WEEK_END_CROSSING },
    coverage: {
      recurring_checks: [
        { name: '豪州貿易収支（ABS）', applies_this_week: true, found: true },
        { name: 'ADP雇用統計', applies_this_week: true, found: false },
      ],
    },
  };
  const result = suppressRepeatRecurringWarnings([TRADE_BALANCE_WARNING, ADP_WARNING], RECURRING_CHECKS, CURRENT_WEEK_END, previousLedger);
  assert.deepEqual(result, [ADP_WARNING]);
});
