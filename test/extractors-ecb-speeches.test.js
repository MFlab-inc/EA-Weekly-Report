'use strict';
// ECB講演抽出（scripts/checkers/extractors/ecb-speeches.js、task #72）のテスト。
// fixtureはECB統合フィード（https://www.ecb.europa.eu/rss/press.html）の実測構造
// （2026-09-19、live fetch）をそのまま収録している（ラガルド総裁・チポローネ専務理事・
// シュナーベル専務理事の3件の講演itemは実データそのまま）。加えて「/press/key/」以外の
// パス（記者会見・プレスリリース）を絞り込みで除外できることを検証するための構成例
// （Vujčić副総裁との連名記者会見item・プレスリリースitem）を末尾に追加している。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { extractEcbSpeeches } = require('../scripts/checkers/extractors/ecb-speeches');
const { utcToJstParts } = require('../scripts/lib/tz-convert');
const { resolveOfficialBySurname } = require('../scripts/lib/naming');

const fx = (...p) => readFileSync(join(__dirname, 'fixtures', 'official-sources', ...p), 'utf8');
const officials = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'officials.json'), 'utf8')).officials;

test('extractEcbSpeeches: /press/key/以外（記者会見・プレスリリース）は除外し、講演itemのみ抽出する', () => {
  const r = extractEcbSpeeches(fx('ecb_speeches', 'press_rss.xml'));
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 3);
});

test('extractEcbSpeeches: 「話者: 講演タイトル」形式を先頭のコロンのみで分割する（講演タイトル自体のコロンは保持）', () => {
  const r = extractEcbSpeeches(fx('ecb_speeches', 'press_rss.xml'));
  const lagarde = r.items.find((i) => i.speakerLastName === 'Christine Lagarde');
  assert.ok(lagarde, JSON.stringify(r.items));
  assert.equal(lagarde.title, 'A new age of capital: growth, sovereignty and AI');
});

test('extractEcbSpeeches: pubDate（RFC822・明示的UTCオフセット付き）からJST日時を正しく導出する', () => {
  const r = extractEcbSpeeches(fx('ecb_speeches', 'press_rss.xml'));
  const lagarde = r.items.find((i) => i.speakerLastName === 'Christine Lagarde');
  const jst = utcToJstParts(new Date(lagarde.pubDateRaw));
  // Mon, 14 Sep 2026 17:15:00 +0200 = 15:15 UTC = 翌00:15 JST
  assert.equal(jst.date, '2026-09-15');
  assert.equal(jst.time, '00:15');
});

test('extractEcbSpeeches: /press/key/を含むitemが無い入力は構造的失敗を返す', () => {
  const r = extractEcbSpeeches('<rss><channel><item><title>ECB press release</title><link>https://www.ecb.europa.eu/press/pr/date/2026/html/ecb.pr260909.en.html</link><pubDate>Wed, 09 Sep 2026 10:00:00 +0200</pubDate></item></channel></rss>');
  assert.equal(r.ok, false);
});

test('resolveOfficialBySurname: ラガルド総裁がofficials.jsonのECB総裁と正しく一致する', () => {
  const lagarde = resolveOfficialBySurname(officials, 'Christine Lagarde', 'EU');
  assert.ok(lagarde, 'Christine Lagardeがofficials.jsonのECB総裁と一致しない');
  assert.equal(lagarde.role_ja, 'ECB総裁');
  assert.equal(lagarde.role_rank, 'governor');
});

test('resolveOfficialBySurname: ヴイチッチ副総裁が正しくdeputy_governorとして一致する', () => {
  const vujcic = resolveOfficialBySurname(officials, 'Boris Vujčić', 'EU');
  assert.ok(vujcic, 'Boris Vujčićがofficials.jsonのECB副総裁と一致しない');
  assert.equal(vujcic.role_rank, 'deputy_governor');
});
