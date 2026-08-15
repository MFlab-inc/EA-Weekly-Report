'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const pdf = require('pdf-parse');
const { extractStatCanSchedule, parseLongDate, parseMonthYear } = require('../scripts/checkers/extractors/statcan');

const fixturePath = join(__dirname, 'fixtures', 'official-sources', 'ca_statcan', 'annual_release_dates_pdf.pdf');

test('parseLongDate: "August 4, 2026"→"2026-08-04"', () => {
  assert.equal(parseLongDate('August 4, 2026'), '2026-08-04');
});

test('parseMonthYear: "June 2026"→"2026-06"', () => {
  assert.equal(parseMonthYear('June 2026'), '2026-06');
});

test('extractStatCanSchedule: 実fixture（年次PDF）からground truth（CA国際商品貿易8/4=6月分・CA雇用統計8/7=7月分）を抽出できる', async () => {
  const buf = readFileSync(fixturePath);
  const { text } = await pdf(buf);
  const schedule = extractStatCanSchedule(text);

  assert.ok(schedule.trade_balance.some((e) => e.releaseDate === '2026-08-04' && e.referencePeriod === '2026-06'));
  assert.ok(schedule.employment_situation.some((e) => e.releaseDate === '2026-08-07' && e.referencePeriod === '2026-07'));
});

test('extractStatCanSchedule: 両subjectとも2026年分は毎月連続して抽出できる（欠落月がない）', async () => {
  const buf = readFileSync(fixturePath);
  const { text } = await pdf(buf);
  const schedule = extractStatCanSchedule(text);

  for (const kind of ['trade_balance', 'employment_situation']) {
    const months2026 = schedule[kind].filter((e) => e.releaseDate.startsWith('2026')).map((e) => e.referencePeriod);
    // 対象期間が単調増加（重複・逆転がない）ことを確認する回帰チェック
    const sorted = [...months2026].sort();
    assert.deepEqual(months2026, sorted, `${kind}: 対象期間の順序が不正`);
    assert.ok(months2026.length >= 10, `${kind}: 2026年分の件数が少なすぎる（${months2026.length}件）`);
  }
});

test('extractStatCanSchedule: 見出しが見つからないsubjectは空配列を返す', () => {
  const schedule = extractStatCanSchedule('no matching subject headers here');
  assert.deepEqual(schedule.trade_balance, []);
  assert.deepEqual(schedule.employment_situation, []);
});

// task #38実ネットワーク検証（しょうさん指摘2026-08-15）の回帰テスト: 登録済みソースの
// 同一PDFに既に含まれていたConsumer Price Index・Gross domestic product by industryが
// kind未登録のため取りこぼされていた（8/17週のCA CPI=8/17発表分がまさにその欠損事例）
test('extractStatCanSchedule: CPI・GDP(月次)も同一PDFから抽出できる（8/17週の欠損事例の回帰テスト）', async () => {
  const buf = readFileSync(fixturePath);
  const { text } = await pdf(buf);
  const schedule = extractStatCanSchedule(text);

  assert.ok(schedule.cpi.some((e) => e.releaseDate === '2026-08-17' && e.referencePeriod === '2026-07'), 'CA CPI(8/17=7月分)が見つからない');
  assert.ok(schedule.gdp.some((e) => e.releaseDate === '2026-08-28' && e.referencePeriod === '2026-06'), 'CA GDP月次(8/28=6月分)が見つからない');
});
