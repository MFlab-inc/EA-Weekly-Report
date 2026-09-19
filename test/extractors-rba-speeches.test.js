'use strict';
// RBA講演RSS抽出（scripts/checkers/extractors/rba-speeches.js、task #72）のテスト。
// fixtureはRBA公式講演フィード（https://www.rba.gov.au/rss/rss-cb-speeches.xml）の実測構造
// （2026-09-19、live fetch）をそのまま収録している（フィードは常に直近1件のみを掲載する設計の
// ため、実測でも1itemしか得られていない）。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { extractRbaSpeeches } = require('../scripts/checkers/extractors/rba-speeches');
const { utcToJstParts } = require('../scripts/lib/tz-convert');
const { resolveOfficialBySurname } = require('../scripts/lib/naming');

const fx = (...p) => readFileSync(join(__dirname, 'fixtures', 'official-sources', ...p), 'utf8');
const officials = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'officials.json'), 'utf8')).officials;

test('extractRbaSpeeches: ブロック総裁の下院経済委員会証言（構造化フィールドcb:nameAsWritten）を抽出できる', () => {
  const r = extractRbaSpeeches(fx('au_rba_speeches', 'speeches_rss.xml'));
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 1);
  const bullock = r.items[0];
  assert.equal(bullock.speakerLastName, 'Michele Bullock');
  assert.equal(bullock.title, 'Testimony Opening Statement to the House of Representatives Standing Committee on Economics');
});

test('extractRbaSpeeches: dc:date（明示的UTCオフセット付きISO8601）からJST日時を正しく導出する', () => {
  const r = extractRbaSpeeches(fx('au_rba_speeches', 'speeches_rss.xml'));
  const jst = utcToJstParts(new Date(r.items[0].pubDateRaw));
  // 2026-09-18T09:30:00+10:00 = 2026-09-17T23:30:00Z = 2026-09-18T08:30 JST
  assert.equal(jst.date, '2026-09-18');
  assert.equal(jst.time, '08:30');
});

test('extractRbaSpeeches: cb:nameAsWrittenを持つitemが無い入力は構造的失敗を返す', () => {
  const r = extractRbaSpeeches('<rdf:RDF><item><title>Some unrelated title</title><dc:date>2026-07-21T11:00:00+10:00</dc:date></item></rdf:RDF>');
  assert.equal(r.ok, false);
});

test('resolveOfficialBySurname: ブロック総裁がofficials.jsonのRBA総裁と正しく一致する', () => {
  const bullock = resolveOfficialBySurname(officials, 'Michele Bullock', 'AU');
  assert.ok(bullock, 'Michele Bullockがofficials.jsonのRBA総裁と一致しない');
  assert.equal(bullock.role_ja, 'RBA総裁');
  assert.equal(bullock.role_rank, 'governor');
});

test('resolveOfficialBySurname: ハウザー副総裁が正しくdeputy_governorとして一致する', () => {
  const hauser = resolveOfficialBySurname(officials, 'Andrew Hauser', 'AU');
  assert.ok(hauser, 'Andrew Hauserがofficials.jsonのRBA副総裁と一致しない');
  assert.equal(hauser.role_rank, 'deputy_governor');
});
