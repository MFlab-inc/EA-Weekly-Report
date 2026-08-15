import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isExpectedThisWeek, decideRunOutcome, checkResidualMonitoring, checkRecurringMissing } from '../scripts/lib/fail-closed.js';

test('isExpectedThisWeek: いずれのシグナルもfalseならfalse', () => {
  assert.equal(isExpectedThisWeek({}), false);
  assert.equal(isExpectedThisWeek({ annualConfigHasTargetWeek: false, recurringCheckMatches: false, ffHintPresent: false }), false);
});

test('isExpectedThisWeek: いずれか1つでもtrueならtrue', () => {
  assert.equal(isExpectedThisWeek({ annualConfigHasTargetWeek: true }), true);
  assert.equal(isExpectedThisWeek({ recurringCheckMatches: true }), true);
  assert.equal(isExpectedThisWeek({ ffHintPresent: true }), true);
});

test('decideRunOutcome: 失敗ゼロならOK', () => {
  assert.deepEqual(decideRunOutcome([]), { status: 'OK', reasons: [] });
});

test('decideRunOutcome: 単一失敗・見込みありならHOLD', () => {
  const r = decideRunOutcome([{ sourceId: 'us_bls_fred', expected: true }]);
  assert.equal(r.status, 'HOLD');
  assert.match(r.reasons[0], /見込みあり/);
});

test('decideRunOutcome: 単一失敗・見込みなしならWARN', () => {
  const r = decideRunOutcome([{ sourceId: 'au_abs', expected: false }]);
  assert.equal(r.status, 'WARN');
  assert.match(r.reasons[0], /見込みなし/);
});

test('decideRunOutcome: 複数同時失敗は見込み判定に関わらず無条件HOLD', () => {
  const r = decideRunOutcome([
    { sourceId: 'a', expected: false },
    { sourceId: 'b', expected: false },
  ]);
  assert.equal(r.status, 'HOLD');
  assert.match(r.reasons[0], /判定不能/);
});

test('checkResidualMonitoring: 対象週+4週先までに日程があればok', () => {
  const r = checkResidualMonitoring(['2026-09-01', '2026-10-01'], '2026-08-10', 4);
  assert.equal(r.ok, true);
});

test('checkResidualMonitoring: 対象週+4週先までに日程が無ければWARN', () => {
  const r = checkResidualMonitoring(['2027-01-01'], '2026-08-10', 4);
  assert.equal(r.ok, false);
  assert.match(r.warn, /年次スケジュールconfig/);
});

test('checkResidualMonitoring: スケジュール空配列も未カバー扱い', () => {
  const r = checkResidualMonitoring([], '2026-08-10', 4);
  assert.equal(r.ok, false);
});

test('checkRecurringMissing: 該当週なのに未検出ならWARN文言を返す', () => {
  const rules = [{ name: '米CPI', rule: '毎月中旬', action: '対象週に該当し得るのに不在ならWARN' }];
  const warnings = checkRecurringMissing(
    rules,
    { label: 'week' },
    () => true,
    () => false
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /定例欠落/);
  assert.match(warnings[0], /米CPI/);
});

test('checkRecurringMissing: 検出済みなら警告なし', () => {
  const rules = [{ name: '米CPI', rule: '毎月中旬', action: '...' }];
  const warnings = checkRecurringMissing(rules, {}, () => true, () => true);
  assert.equal(warnings.length, 0);
});

test('checkRecurringMissing: 対象週に該当しないルールは無視', () => {
  const rules = [{ name: '米CPI', rule: '毎月中旬', action: '...' }];
  const warnings = checkRecurringMissing(rules, {}, () => false, () => false);
  assert.equal(warnings.length, 0);
});
