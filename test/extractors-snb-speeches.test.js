'use strict';
// SNB講演専用RSS抽出（scripts/checkers/extractors/snb-speeches.js、task #72）のテスト。
// fixtureはSNB公式講演RSS（https://www.snb.ch/public/rss/en/speeches）の実測構造
// （2026-09-19、live fetch）をそのまま収録している（マルタン副議長単独講演・
// シュレーゲル議長/マルタン副議長/チュディン委員の連名講演・Bank Council委員[Governing Board外]の
// 発言の3itemは実データそのまま）。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { extractSnbSpeeches } = require('../scripts/checkers/extractors/snb-speeches');
const { utcToJstParts } = require('../scripts/lib/tz-convert');
const { resolveOfficialBySurname } = require('../scripts/lib/naming');

const fx = (...p) => readFileSync(join(__dirname, 'fixtures', 'official-sources', ...p), 'utf8');
const officials = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'officials.json'), 'utf8')).officials;

test('extractSnbSpeeches: Governing Board以外の話者（Bank Council委員）を含むitemは除外する', () => {
  const r = extractSnbSpeeches(fx('snb_speeches', 'speeches_rss.xml'));
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 2);
  assert.ok(!r.items.some((i) => i.speakerLastName === 'Barbara Janom Steiner'));
});

test('extractSnbSpeeches: マルタン副議長の単独講演を抽出しUTC(Z)固定のJST換算が正しい', () => {
  const r = extractSnbSpeeches(fx('snb_speeches', 'speeches_rss.xml'));
  const martin = r.items.find((i) => i.speakerLastName === 'Antoine Martin');
  assert.ok(martin, JSON.stringify(r.items));
  const jst = utcToJstParts(new Date(martin.pubDateRaw));
  assert.equal(jst.date, '2026-08-27');
  assert.equal(jst.time, '01:15');
});

test('extractSnbSpeeches: 複数話者（" / "区切りの並行リスト）の場合は先頭のみを採用する', () => {
  const r = extractSnbSpeeches(fx('snb_speeches', 'speeches_rss.xml'));
  const joint = r.items.find((i) => i.title.includes('Introductory remarks by the Governing Board'));
  assert.ok(joint, JSON.stringify(r.items));
  assert.equal(joint.speakerLastName, 'Martin Schlegel');
});

test('extractSnbSpeeches: Governing Board話者のcb:speechを持つitemが無い入力は構造的失敗を返す', () => {
  const r = extractSnbSpeeches('<rss><channel><item><title>Unrelated</title><cb:occurrenceDate>2026-07-21T11:00:00Z</cb:occurrenceDate></item></channel></rss>');
  assert.equal(r.ok, false);
});

test('resolveOfficialBySurname: シュレーゲル議長がofficials.jsonのSNB総裁と正しく一致する', () => {
  const schlegel = resolveOfficialBySurname(officials, 'Martin Schlegel', 'CH');
  assert.ok(schlegel, 'Martin Schlegelがofficials.jsonのSNB総裁と一致しない');
  assert.equal(schlegel.role_ja, 'SNB総裁');
  assert.equal(schlegel.role_rank, 'governor');
});

test('resolveOfficialBySurname: マルタン副議長が正しくdeputy_governorとして一致する', () => {
  const martin = resolveOfficialBySurname(officials, 'Antoine Martin', 'CH');
  assert.ok(martin, 'Antoine Martinがofficials.jsonのSNB副議長と一致しない');
  assert.equal(martin.role_rank, 'deputy_governor');
});
