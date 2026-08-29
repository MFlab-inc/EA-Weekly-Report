'use strict';
// BOE講演RSS抽出（scripts/checkers/extractors/boe-speeches.js、task #72）のテスト。
// fixtureはboe-speeches-recon一時ワークフロー（2026-08-29、GitHub Actions実ネットワーク）で
// 実測したhttps://www.bankofengland.co.uk/rss/speechesの実データ3件をそのまま収録している。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { extractBoeSpeeches } = require('../scripts/checkers/extractors/boe-speeches');
const { utcToJstParts } = require('../scripts/lib/tz-convert');
const { resolveOfficialBySurname } = require('../scripts/lib/naming');

const fx = (...p) => readFileSync(join(__dirname, 'fixtures', 'official-sources', ...p), 'utf8');
const officials = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'officials.json'), 'utf8')).officials;

test('extractBoeSpeeches: 実fixtureからground truth（Andrew Bailey講演、7/14 21:00 UTC+1=7/15 05:00 JST）を抽出できる', () => {
  const r = extractBoeSpeeches(fx('gb_boe_speeches', 'speeches_rss.xml'));
  assert.equal(r.ok, true);
  const bailey = r.items.find((i) => i.speakerLastName === 'Andrew Bailey');
  assert.ok(bailey, JSON.stringify(r.items));
  assert.equal(bailey.title, 'Growth and regulation - speech by Andrew Bailey');
  const jst = utcToJstParts(new Date(bailey.pubDateRaw));
  assert.equal(jst.date, '2026-07-15');
  assert.equal(jst.time, '05:00');
});

test('extractBoeSpeeches: 「speech by」以降をフルネームで抽出する（姓のみではない）', () => {
  const r = extractBoeSpeeches(fx('gb_boe_speeches', 'speeches_rss.xml'));
  assert.equal(r.ok, true);
  assert.ok(r.items.some((i) => i.speakerLastName === 'Andrew Bailey'));
  assert.ok(r.items.some((i) => i.speakerLastName === 'David Bailey'));
  assert.ok(r.items.some((i) => i.speakerLastName === 'Nathanaël Benjamin'));
});

test('extractBoeSpeeches: ダッシュの表記ゆれ（-と−）のいずれでも抽出できる', () => {
  const r = extractBoeSpeeches(fx('gb_boe_speeches', 'speeches_rss.xml'));
  const david = r.items.find((i) => i.speakerLastName === 'David Bailey');
  assert.ok(david, '区切り文字が−（マイナス記号）の行が抽出できていない');
  assert.equal(david.title, 'The role of research in Prudential Regulation − speech by David Bailey');
});

test('extractBoeSpeeches: item要素が無い、または全件が「speech by」形式でない入力は構造的失敗を返す', () => {
  const r = extractBoeSpeeches('<rss><channel><item><title>Some unrelated title</title><pubDate>Tue, 21 Jul 2026 11:00:00 +0100</pubDate></item></channel></rss>');
  assert.equal(r.ok, false);
});

// task #72の設計上の核心（しょうさん指摘の実測発見）: 姓のみ「Bailey」で抽出すると、
// officials.json記載の総裁「アンドリュー・ベイリー（Andrew Bailey）」とDavid Bailey（総裁とは別人）が
// 部分一致で混同され、Davidの講演が誤って総裁級★★★に昇格してしまう。フルネーム抽出により
// 両者が正しく区別されることを、実際のnaming.resolveOfficialBySurnameで検証する
test('resolveOfficialBySurname: フルネーム抽出によりAndrew BaileyとDavid Baileyが正しく区別される（task #72の核心）', () => {
  const andrew = resolveOfficialBySurname(officials, 'Andrew Bailey');
  assert.ok(andrew, 'Andrew Baileyがofficials.jsonのBOE総裁と一致しない');
  assert.equal(andrew.role_ja, 'BOE総裁');
  assert.equal(andrew.role_rank, 'governor');

  const david = resolveOfficialBySurname(officials, 'David Bailey');
  assert.equal(david, null, 'David Baileyが誤ってBOE総裁(Andrew Bailey)と一致してしまっている（姓のみ抽出のバグを再現している）');
});
