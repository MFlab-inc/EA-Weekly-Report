'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { extractNzNextRelease, parseDayMonthYear } = require('../scripts/checkers/extractors/nz-statsnz');

const fx = (name) => readFileSync(join(__dirname, 'fixtures', 'official-sources', 'nz_statsnz', name), 'utf8');

test('parseDayMonthYear: "5 August 2026"→"2026-08-05"', () => {
  assert.equal(parseDayMonthYear('5 August 2026'), '2026-08-05');
});

test('extractNzNextRelease: 前四半期（2026年3月期）ページの埋め込みテキストからground truth（nz_labour_q2=2026-08-05、2026年6月期）を抽出できる', () => {
  const html = fx('TEMP_ground_truth_validation_prior_quarter.html');
  const r = extractNzNextRelease(html);
  assert.equal(r.ok, true);
  assert.ok(r.releases.some((x) => x.quarterLabel === 'June 2026' && x.releaseDate === '2026-08-05'));
});

test('extractNzNextRelease: 直近リリースページ（2026年6月期）は次サイクル（2026年9月期）の予定日を抽出し、(income)派生系列は除外する', () => {
  const html = fx('latest_labour_market_release.html');
  const r = extractNzNextRelease(html);
  assert.equal(r.ok, true);
  assert.ok(r.releases.some((x) => x.quarterLabel === 'September 2026' && x.releaseDate === '2026-11-04'));
  assert.ok(!r.releases.some((x) => x.quarterLabel.includes('income')), '(income)派生系列は除外されるべき');
  assert.equal(r.releases.length, 1, '(income)系列を除いた通常のLabour market statisticsは1件のみのはず');
});

test('extractNzNextRelease: 次回リリース予定日の埋め込みが見つからない場合は構造的失敗を返す（フェールクローズ接続）', () => {
  const r = extractNzNextRelease('<html><body>no matching content</body></html>');
  assert.equal(r.ok, false);
  assert.deepEqual(r.releases, []);
});
