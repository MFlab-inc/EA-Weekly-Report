'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { extractUsTreasuryAuctions, termToJa } = require('../scripts/checkers/extractors/us-treasury');

const fx = (...p) => readFileSync(join(__dirname, 'fixtures', 'official-sources', ...p), 'utf8');

test('termToJa: "20-Year"→"20年"、月混在表記はnull', () => {
  assert.equal(termToJa('20-Year'), '20年');
  assert.equal(termToJa('29-Year 6-Month'), null);
  assert.equal(termToJa('26-Week'), null);
});

test('extractUsTreasuryAuctions: 実fixtureから対象週内の年限国債のみを抽出できる', () => {
  const json = fx('us_treasury', 'fiscaldata_upcoming_auctions.json');
  const r = extractUsTreasuryAuctions(json, '2026-08-17', '2026-08-21');
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].date, '2026-08-19');
  assert.equal(r.rows[0].tenorJa, '20年');
});

test('extractUsTreasuryAuctions: 対象週外は除外される', () => {
  const json = fx('us_treasury', 'fiscaldata_upcoming_auctions.json');
  const r = extractUsTreasuryAuctions(json, '2099-01-01', '2099-01-07');
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 0);
});

test('extractUsTreasuryAuctions: data配列が無いJSONは構造的失敗を返す', () => {
  const r = extractUsTreasuryAuctions(JSON.stringify({ foo: 'bar' }), '2026-01-01', '2026-01-07');
  assert.equal(r.ok, false);
});
