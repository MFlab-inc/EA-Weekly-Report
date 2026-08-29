import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { matchesRecurringRule } from '../scripts/lib/recurring-rules.js';

const require = createRequire(import.meta.url);

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

// task #87（2026-08-30、しょうさん指摘: au_absのhorizon制約によるGDP/貿易収支の欠落）。
// 月列挙と日範囲の両方を含むルールはAND条件（対象月かつ対象日範囲）として判定する
test('matchesRecurringRule: 月列挙+日範囲の組み合わせルールは対象月×対象日範囲の両方を満たす週のみtrue（AND判定）', () => {
  const rule = { rule: '3月・6月・9月・12月の1日〜5日ごろ（四半期末2ヶ月強後の第1水曜が通例）' };
  // 9月かつ1〜5日を含む週（対象週の一部が該当日範囲に入っていればtrue）
  assert.equal(matchesRecurringRule(rule, ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']), true);
  // 対象月（9月）だが日範囲（1〜5日）を含まない週はfalse（月のみルールなら誤ってtrueになっていたはず）
  assert.equal(matchesRecurringRule(rule, ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']), false);
  // 対象日範囲（1〜5日）だが対象月（例: 8月）でない週はfalse（日範囲のみルールなら誤ってtrueになっていたはず）
  assert.equal(matchesRecurringRule(rule, ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07']), false);
});

test('matchesRecurringRule: 「毎月1日〜10日ごろ」（月列挙なし・日範囲のみ）は従来どおり月に関係なくtrue', () => {
  const rule = { rule: '毎月1日〜10日ごろ（前々月分を公表。既刊実績: 9/3発表分）' };
  assert.equal(matchesRecurringRule(rule, ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']), true);
  assert.equal(matchesRecurringRule(rule, ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']), true);
  assert.equal(matchesRecurringRule(rule, ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']), false);
});

// 実config回帰テスト（task #87）: ルール文中の説明的な注記（「既刊実績: ...」等）に
// 「N月」という文字列がうっかり混入すると、汎用パーサーがそれを月列挙条件と誤認識し、
// 日範囲のみのはずのルールがAND判定に変わって意図せず対象月が絞られてしまう
// （実際にこの回帰を実装中に踏んだ。修正前は「7月分」という注記のせいで
// 「豪州貿易収支（ABS）」ルールが7月以外の週で誤ってfalseになっていた）
test('実config — 「豪州GDP（ABS）」「豪州貿易収支（ABS）」ルールが意図どおりの条件で判定される（task #87）', () => {
  const importanceRules = require('../config/importance-rules.json');
  const gdpRule = importanceRules.recurring_checks.find((r) => r.name === '豪州GDP（ABS）');
  const tradeBalanceRule = importanceRules.recurring_checks.find((r) => r.name === '豪州貿易収支（ABS）');
  assert.ok(gdpRule && tradeBalanceRule, 'recurring_checksにtask #87の2件が登録されていない');

  // GDP: 9月1日〜5日を含む週はtrue、9月でも日範囲外の週・9月以外の1〜5日を含む週はfalse
  assert.equal(matchesRecurringRule(gdpRule, ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']), true);
  assert.equal(matchesRecurringRule(gdpRule, ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']), false);
  assert.equal(matchesRecurringRule(gdpRule, ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07']), false);

  // 貿易収支: 月に関係なく1〜10日を含む週はtrue（説明文中の「発表分」等が誤って月条件化していないこと）
  assert.equal(matchesRecurringRule(tradeBalanceRule, ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']), true);
  assert.equal(matchesRecurringRule(tradeBalanceRule, ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05']), true);
  assert.equal(matchesRecurringRule(tradeBalanceRule, ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']), false);
});
