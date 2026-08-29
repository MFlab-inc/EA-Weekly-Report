'use strict';
// 月末・四半期末・半期末の需給注意喚起ブロック（scripts/render/html-renderer.js monthEndNoticeHtml()）
// のテスト（task #82、しょうさん承認済み設計2026-08-29）。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { monthEndNoticeHtml } = require('../scripts/render/html-renderer');

const reportPolicy = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'report-policy.json'), 'utf8'));

test('monthEndNoticeHtml: monthEndNoticeがnullなら空文字を返す（該当週以外でブロックを出さない）', () => {
  assert.equal(monthEndNoticeHtml(null, reportPolicy), '');
});

test('monthEndNoticeHtml: month_end（それ以外の月）は「月末営業日」ラベルで描画する', () => {
  const notice = { date: '2026-10-30', month: 10, tier: 'month_end', weekday: '金', fixTimeJst: { time: '01:00' } };
  const html = monthEndNoticeHtml(notice, reportPolicy);
  assert.ok(html.includes('10月30日（金）は月末営業日です'), html);
  assert.ok(html.includes('翌01:00・日本時間'));
  assert.ok(html.includes('機関投資家のリバランス取引が集中しやすく'));
  assert.ok(!html.includes('日本の年度末'));
  assert.ok(!html.includes('中間決算期'));
  assert.ok(html.includes('data-ea-month-end-date="2026-10-30"'));
  assert.ok(html.includes('data-ea-month-end-tier="month_end"'));
  assert.ok(html.includes('これは経済指標の発表予定に基づく停止目安とは別の情報です'));
});

test('monthEndNoticeHtml: 6月・12月（quarter_end）は「四半期末営業日」ラベルで描画する', () => {
  const notice = { date: '2026-06-30', month: 6, tier: 'quarter_end', weekday: '火', fixTimeJst: { time: '00:00' } };
  const html = monthEndNoticeHtml(notice, reportPolicy);
  assert.ok(html.includes('6月30日（火）は四半期末営業日です'), html);
  assert.ok(html.includes('data-ea-month-end-tier="quarter_end"'));
});

test('monthEndNoticeHtml: 9月（half_end）は「半期末営業日」ラベル＋日本の中間決算期の文言を含む（しょうさん修正2）', () => {
  const notice = { date: '2026-09-30', month: 9, tier: 'half_end', weekday: '水', fixTimeJst: { time: '00:00' } };
  const html = monthEndNoticeHtml(notice, reportPolicy);
  assert.ok(html.includes('9月30日（水）は半期末営業日です'), html);
  assert.ok(html.includes('日本の中間決算期にあたり'));
  assert.ok(html.includes('data-ea-month-end-tier="half_end"'));
});

test('monthEndNoticeHtml: 3月（half_end）は日本の年度末の文言を含む（しょうさん修正2、9月とは文言が異なる）', () => {
  const notice = { date: '2027-03-31', month: 3, tier: 'half_end', weekday: '水', fixTimeJst: { time: '01:00' } };
  const html = monthEndNoticeHtml(notice, reportPolicy);
  assert.ok(html.includes('3月31日（水）は半期末営業日です'), html);
  assert.ok(html.includes('日本の年度末にあたり'));
  assert.ok(!html.includes('中間決算期'));
});

test('monthEndNoticeHtml: heading/bodyはesc()でHTMLエスケープされる', () => {
  // weekdayに万一HTML特殊文字が混入しても機械的にエスケープされることを確認する
  // （実運用ではweekdayJa()の固定文言のため発生しないが、esc()適用箇所の回帰を検知する）
  const notice = { date: '2026-10-30', month: 10, tier: 'month_end', weekday: '<script>', fixTimeJst: { time: '01:00' } };
  const html = monthEndNoticeHtml(notice, reportPolicy);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});
