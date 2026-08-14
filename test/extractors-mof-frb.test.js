'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { extractMofAuctions, tenorToJa } = require('../scripts/checkers/extractors/mof');
const { extractFrbSpeeches } = require('../scripts/checkers/extractors/frb-speeches');
const { utcToJstParts } = require('../scripts/lib/tz-convert');

const fx = (...p) => readFileSync(join(__dirname, 'fixtures', 'official-sources', ...p), 'utf8');

test('tenorToJa: "10-year"→"10年"、非対応表記はnull', () => {
  assert.equal(tenorToJa('10-year'), '10年');
  assert.equal(tenorToJa('30-year'), '30年');
  assert.equal(tenorToJa('Treasury Discount Bills (6-month)'), null);
});

test('extractMofAuctions: 実fixtureからground truth（10年債8/4・30年債8/6）を抽出できる', () => {
  const r = extractMofAuctions(fx('jp_mof', 'auction_calendar_2608.html'));
  assert.equal(r.ok, true);
  assert.ok(r.rows.some((x) => x.date === '2026-08-04' && x.tenorJa === '10年'));
  assert.ok(r.rows.some((x) => x.date === '2026-08-06' && x.tenorJa === '30年'));
});

test('extractMofAuctions: 入札行が無い入力は構造的失敗を返す', () => {
  const r = extractMofAuctions('<html><body>no table</body></html>');
  assert.equal(r.ok, false);
});

test('extractFrbSpeeches: 実fixtureからground truth（Cook, 8/6 05:05 JST）を抽出できる', () => {
  const r = extractFrbSpeeches(fx('us_frb_speeches', 'speeches_rss.xml'));
  assert.equal(r.ok, true);
  const cook = r.items.find((i) => i.title.startsWith('Cook, Outlook for the U.S. and Alaskan Economies'));
  assert.ok(cook);
  assert.equal(cook.speakerLastName, 'Cook');
  const jst = utcToJstParts(new Date(cook.pubDateRaw));
  assert.equal(jst.date, '2026-08-06');
  assert.equal(jst.time, '05:05');
});

test('extractFrbSpeeches: item要素が無い入力は構造的失敗を返す', () => {
  const r = extractFrbSpeeches('<rss><channel></channel></rss>');
  assert.equal(r.ok, false);
});
