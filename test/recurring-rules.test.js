import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesRecurringRule } from '../scripts/lib/recurring-rules.js';

test('matchesRecurringRule: 「第1金曜」ルールは月初の金曜を含む週でtrue', () => {
  // 2026-08-07は金曜（月初1週目）
  const rule = { rule: '毎月第1金曜（祝日ずれあり）' };
  assert.equal(matchesRecurringRule(rule, ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07']), true);
});

test('matchesRecurringRule: 「第1金曜」ルールは第2週の金曜を含む週ではfalse', () => {
  const rule = { rule: '毎月第1金曜（祝日ずれあり）' };
  assert.equal(matchesRecurringRule(rule, ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']), false);
});

test('matchesRecurringRule: 「中旬」ルールは10〜19日を含む週でtrue', () => {
  const rule = { rule: '毎月中旬' };
  assert.equal(matchesRecurringRule(rule, ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']), true);
});

test('matchesRecurringRule: 「中旬」ルールは月末週でfalse', () => {
  const rule = { rule: '毎月中旬' };
  assert.equal(matchesRecurringRule(rule, ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28']), false);
});

test('matchesRecurringRule: 未知のルール文字列はfalse（例外を投げない）', () => {
  const rule = { rule: '未定義のルール' };
  assert.equal(matchesRecurringRule(rule, ['2026-08-10']), false);
});
