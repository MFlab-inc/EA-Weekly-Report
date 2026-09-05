'use strict';
// scripts/lib/event-volume-history.js（task #93、2026-09-06）の単体テスト。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const os = require('node:os');
const { median, loadHistoricalCounts } = require('../scripts/lib/event-volume-history.js');

test('median: 偶数・奇数個数とも正しく計算する', () => {
  assert.equal(median([1, 3, 5]), 3);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
  assert.equal(median([7]), 7);
});

function makeLedgerFixture(events) {
  return { events };
}

test('loadHistoricalCounts: data/ledger/配下の台帳から掲載対象(importance 2or3)・★★★件数を集計する', () => {
  const dir = mkdtempSync(join(os.tmpdir(), 'ledger-history-test-'));
  try {
    writeFileSync(
      join(dir, '2026-08-24.json'),
      JSON.stringify(makeLedgerFixture([{ importance: 3 }, { importance: 2 }, { importance: 0 }]))
    );
    writeFileSync(join(dir, '2026-08-31.json'), JSON.stringify(makeLedgerFixture([{ importance: 3 }, { importance: 3 }])));
    const counts = loadHistoricalCounts(dir, null);
    counts.sort((a, b) => a.target_week_start.localeCompare(b.target_week_start));
    assert.deepEqual(counts, [
      { target_week_start: '2026-08-24', displayed_count: 2, star3_count: 1 },
      { target_week_start: '2026-08-31', displayed_count: 2, star3_count: 2 },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadHistoricalCounts: excludeWeekStartで指定した対象週自身は実績から除外する', () => {
  const dir = mkdtempSync(join(os.tmpdir(), 'ledger-history-test-'));
  try {
    writeFileSync(join(dir, '2026-08-24.json'), JSON.stringify(makeLedgerFixture([{ importance: 3 }])));
    writeFileSync(join(dir, '2026-09-07.json'), JSON.stringify(makeLedgerFixture([{ importance: 3 }])));
    const counts = loadHistoricalCounts(dir, '2026-09-07');
    assert.equal(counts.length, 1);
    assert.equal(counts[0].target_week_start, '2026-08-24');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadHistoricalCounts: 存在しないディレクトリは空配列を返す（例外を投げない）', () => {
  assert.deepEqual(loadHistoricalCounts('/nonexistent/path/xyz', null), []);
});

test('loadHistoricalCounts: 壊れたJSONファイルは無視して残りを集計する', () => {
  const dir = mkdtempSync(join(os.tmpdir(), 'ledger-history-test-'));
  try {
    writeFileSync(join(dir, '2026-08-24.json'), '{ this is not valid json');
    writeFileSync(join(dir, '2026-08-31.json'), JSON.stringify(makeLedgerFixture([{ importance: 2 }])));
    const counts = loadHistoricalCounts(dir, null);
    assert.equal(counts.length, 1);
    assert.equal(counts[0].target_week_start, '2026-08-31');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
