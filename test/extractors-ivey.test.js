'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { extractIveySchedule } = require('../scripts/checkers/extractors/ivey');

const fx = (...p) => readFileSync(join(__dirname, 'fixtures', 'official-sources', ...p), 'utf8');

test('extractIveySchedule: 実fixtureからground truth（8/7）を含む2026年通年12件を抽出できる', () => {
  const r = extractIveySchedule(fx('ca_ivey', 'faq.html'));
  assert.equal(r.ok, true);
  assert.equal(r.year, 2026);
  assert.equal(r.schedule.length, 12);
  assert.ok(r.schedule.some((e) => e.date === '2026-08-07' && e.kind === 'pmi_ism'));
});

test('extractIveySchedule: 文言が無い入力は構造的失敗を返す', () => {
  const r = extractIveySchedule('<html><body>no schedule text</body></html>');
  assert.equal(r.ok, false);
  assert.match(r.reason, /見つからない/);
});
