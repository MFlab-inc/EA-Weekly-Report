'use strict';
// scripts/check/mobile-layout-check.mjs のユニットテスト（task #13）。
// しょうさん指示の必須テスト「横スクロールが出る幅指定を入れる→HOLD」をカバーする。
// 実Chromiumを起動する統合テスト（ネットワークアクセスは無し。file://の読み込みのみ）。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');

async function loadCheck() {
  return import('../scripts/check/mobile-layout-check.mjs');
}

test('checkMobileLayout: 実際のレンダラー出力（output/ea-weekly-20260810.html）は5幅とも横スクロール無し', async () => {
  const { checkMobileLayout, summarizeResults, WIDTHS } = await loadCheck();
  const results = await checkMobileLayout(join(__dirname, '..', 'output', 'ea-weekly-20260810.html'));
  assert.equal(results.length, WIDTHS.length);
  const errors = summarizeResults(results);
  assert.deepEqual(errors, [], JSON.stringify(results));
});

test('必須ケース: 横スクロールが出る幅指定を入れる → HORIZONTAL_SCROLLでHOLD', async () => {
  const { checkMobileLayout, summarizeResults } = await loadCheck();
  const results = await checkMobileLayout(join(__dirname, 'fixtures', 'check', 'mobile_overflow.html'));
  const errors = summarizeResults(results);
  assert.ok(errors.length > 0, '900px固定幅要素がある場合、全幅で横スクロールが検出されるはず');
  assert.ok(errors.every((e) => e.startsWith('HORIZONTAL_SCROLL')));
  // 320〜414pxの全幅で発生するはず（900px固定要素はどの幅でもはみ出す）
  assert.equal(errors.length, results.length);
});
