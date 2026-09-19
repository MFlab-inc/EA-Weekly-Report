'use strict';
// BOC講演RSS抽出（scripts/checkers/extractors/boc-speeches.js、task #72）のテスト。
// fixtureはBOC公式speechesフィード（https://www.bankofcanada.ca/content_type/speeches/feed/）の
// 実測構造（2026-09-19、live fetch）を再現している。Macklem単独講演とRogers/Gravelle連名項目は
// 実測から得た実データそのまま。「告知/ウェブキャストのみ（cb:speech無し）」の重複itemと、
// 事前公表される将来講演item（マックレム総裁の2026-09-21ハリファックス講演。日時は
// config/manual-events.json[boc-speech-macklem-2026-09-21]の裏取りで確認済みの11:20 ET=
// 2026-09-21T15:20:00+00:00を用いた構成例）は、それぞれの抽出分岐を検証するための構成例。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { extractBocSpeeches } = require('../scripts/checkers/extractors/boc-speeches');
const { utcToJstParts } = require('../scripts/lib/tz-convert');
const { resolveOfficialBySurname } = require('../scripts/lib/naming');

const fx = (...p) => readFileSync(join(__dirname, 'fixtures', 'official-sources', ...p), 'utf8');
const officials = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'officials.json'), 'utf8')).officials;

test('extractBocSpeeches: LocatedAnnouncement（cb:speech）を持つitemのみを対象とし、告知専用の重複itemは除外する', () => {
  const r = extractBocSpeeches(fx('ca_boc_speeches', 'speeches_feed.xml'));
  assert.equal(r.ok, true);
  // fixtureは4item中3件がcb:speechを持つ（残り1件は「Speech: Halifax Partnership」という
  // cb:speech無しの告知専用重複item）
  assert.equal(r.items.length, 3);
  assert.ok(!r.items.some((i) => i.title === 'Speech: Halifax Partnership'));
});

test('extractBocSpeeches: マックレム総裁の講演（dc:date常時+00:00）を抽出しJST日時が正しい', () => {
  const r = extractBocSpeeches(fx('ca_boc_speeches', 'speeches_feed.xml'));
  const unveiling = r.items.find((i) => i.title === 'Unveiling of Vertical $20 Bank Note');
  assert.ok(unveiling, JSON.stringify(r.items));
  assert.equal(unveiling.speakerLastName, 'Tiff Macklem');
  const jst = utcToJstParts(new Date(unveiling.pubDateRaw));
  assert.equal(jst.date, '2026-09-03');
  assert.equal(jst.time, '22:20');
});

test('extractBocSpeeches: 事前公表される将来講演（9/21ハリファックス講演）も検出できる', () => {
  const r = extractBocSpeeches(fx('ca_boc_speeches', 'speeches_feed.xml'));
  const halifax = r.items.find((i) => i.title === 'Opening statement');
  assert.ok(halifax, JSON.stringify(r.items));
  const jst = utcToJstParts(new Date(halifax.pubDateRaw));
  assert.equal(jst.date, '2026-09-22');
  assert.equal(jst.time, '00:20');
});

test('extractBocSpeeches: 複数話者（cb:personが複数）の場合は先頭のみを採用する', () => {
  const r = extractBocSpeeches(fx('ca_boc_speeches', 'speeches_feed.xml'));
  const fsr = r.items.find((i) => i.title === 'Release of the Financial Stability Report');
  assert.ok(fsr, JSON.stringify(r.items));
  assert.equal(fsr.speakerLastName, 'Carolyn Rogers');
});

test('extractBocSpeeches: LocatedAnnouncementを持つitemが無い入力は構造的失敗を返す', () => {
  const r = extractBocSpeeches('<rdf:RDF><item><title>Some unrelated title</title><dc:date>2026-07-21T11:00:00+00:00</dc:date></item></rdf:RDF>');
  assert.equal(r.ok, false);
});

test('resolveOfficialBySurname: マックレム総裁がofficials.jsonのBOC総裁と正しく一致する', () => {
  const macklem = resolveOfficialBySurname(officials, 'Tiff Macklem', 'CA');
  assert.ok(macklem, 'Tiff Macklemがofficials.jsonのBOC総裁と一致しない');
  assert.equal(macklem.role_ja, 'BOC総裁');
  assert.equal(macklem.role_rank, 'governor');
});

test('resolveOfficialBySurname: ロジャース上級副総裁が正しくdeputy_governorとして一致する', () => {
  const rogers = resolveOfficialBySurname(officials, 'Carolyn Rogers', 'CA');
  assert.ok(rogers, 'Carolyn Rogersがofficials.jsonのBOC上級副総裁と一致しない');
  assert.equal(rogers.role_rank, 'deputy_governor');
});
