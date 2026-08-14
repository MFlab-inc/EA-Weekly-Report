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

test('matchesRecurringRule: 「2月・8月」のような月列挙ルールは対象月内の週すべてでtrue（RBA証言等・担当ソース未定義の年数回イベント向け）', () => {
  const rule = { rule: '毎年2月・8月（開催日は豪州議会日程による）' };
  assert.equal(matchesRecurringRule(rule, ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']), true);
  assert.equal(matchesRecurringRule(rule, ['2026-02-02', '2026-02-03', '2026-02-04', '2026-02-05', '2026-02-06']), true);
});

test('matchesRecurringRule: 「2月・8月」ルールは対象外の月ではfalse', () => {
  const rule = { rule: '毎年2月・8月（開催日は豪州議会日程による）' };
  assert.equal(matchesRecurringRule(rule, ['2026-05-04', '2026-05-05', '2026-05-06', '2026-05-07', '2026-05-08']), false);
});

// しょうさん指摘（2026-08-15）: 「中旬」(10〜19日)は米CPIの実際の発表日（既刊実績8/12）より
// 広すぎ、8/17週（対象外のはず）で誤って定例欠落WARNが発火した。日範囲を明示できる記法を追加
test('matchesRecurringRule: 「10日〜16日」ルールは範囲内の週でtrue、範囲外（8/17週）ではfalse', () => {
  const rule = { rule: '毎月10日〜16日ごろ（祝日ずれあり。既刊実績: 8/12）' };
  assert.equal(matchesRecurringRule(rule, ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']), true);
  assert.equal(matchesRecurringRule(rule, ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21']), false);
});
