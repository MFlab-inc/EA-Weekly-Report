'use strict';
// FRB事前公表カレンダー抽出（scripts/checkers/extractors/frb-calendar.js、task #94フォローアップ）
// のテスト。fixtureはFRB公式カレンダーページ（https://www.federalreserve.gov/newsevents/
// 2026-september.htm）の実測構造（2026-09-19、live fetch）をそのまま収録している（Speeches
// カテゴリの5件全て・FOMC Meetings・Statistical Releases・Otherの各カテゴリも実データそのまま）。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { extractFrbCalendar, parseFrbCalendarTime, normalizeFrbSpeakerName } = require('../scripts/checkers/extractors/frb-calendar');
const { resolveOfficialBySurname } = require('../scripts/lib/naming');

const fx = (...p) => readFileSync(join(__dirname, 'fixtures', 'official-sources', ...p), 'utf8');
const officials = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'officials.json'), 'utf8')).officials;

test('extractFrbCalendar: Speechesカテゴリの5件全てを抽出し、FOMC/統計指標/祝日の行は除外する', () => {
  const r = extractFrbCalendar(fx('us_frb_calendar', '2026-september.htm'));
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 5);
});

test('extractFrbCalendar: ジェファーソン副議長の講演（9/22 10:20am）を正しい日時・話者名で抽出する', () => {
  const r = extractFrbCalendar(fx('us_frb_calendar', '2026-september.htm'));
  const jefferson = r.items.find((i) => i.date === '2026-09-22');
  assert.ok(jefferson, JSON.stringify(r.items));
  assert.equal(jefferson.localTime, '10:20');
  assert.equal(jefferson.speakerLastName, 'Philip Jefferson');
});

test('extractFrbCalendar: 「Vice Chair for Supervision」役職タイトルとミドルイニシャルを正しく除去する（ボウマン副議長）', () => {
  const r = extractFrbCalendar(fx('us_frb_calendar', '2026-september.htm'));
  const bowman = r.items.find((i) => i.date === '2026-09-18');
  assert.ok(bowman, JSON.stringify(r.items));
  assert.equal(bowman.speakerLastName, 'Michelle Bowman');
});

test('extractFrbCalendar: Governor役職タイトルとミドルイニシャルを正しく除去する（バー理事・ウォラー理事）', () => {
  const r = extractFrbCalendar(fx('us_frb_calendar', '2026-september.htm'));
  const barrDates = r.items.filter((i) => i.speakerLastName === 'Michael Barr').map((i) => i.date).sort();
  assert.deepEqual(barrDates, ['2026-09-01', '2026-09-23']);
  const waller = r.items.find((i) => i.date === '2026-09-03');
  assert.equal(waller.speakerLastName, 'Christopher Waller');
});

// 2026-11-14追加（しょうさん指摘、ウォーシュFRB議長の実例で発覚）。実fixture
// （2026-september.htm）はウォーシュ議長就任前のデータのため、既存fixtureを変更せず
// 最小限の合成HTMLで「Speech - Chairman Kevin Warsh」行をextractFrbCalendar経由で
// 再現する（normalizeFrbSpeakerNameの単体テストだけでなく、ROW_RE抽出からの通し確認）
test('extractFrbCalendar: 「Chairman」表記の講演行（ウォーシュ議長）も正しい話者名で抽出する', () => {
  const html = [
    '<h4>November 2026</h4>',
    '<div class="col-xs-2"><p>2:00 p.m.</p></div>',
    '<div class="col-xs-7"><p>Speech - Chairman Kevin Warsh</p></div>',
    '<div class="col-xs-3"><p>17</p></div>',
  ].join('\n');
  const r = extractFrbCalendar(html);
  assert.equal(r.ok, true, JSON.stringify(r));
  const warsh = r.items.find((i) => i.date === '2026-11-17');
  assert.ok(warsh, JSON.stringify(r.items));
  assert.equal(warsh.localTime, '14:00');
  assert.equal(warsh.speakerLastName, 'Kevin Warsh');
});

test('extractFrbCalendar: 当該月にSpeechカテゴリの行が無くても（他カテゴリの行があれば）構造的失敗にはしない', () => {
  const r = extractFrbCalendar(fx('us_frb_calendar', '2026-october-no-speeches.htm'));
  assert.equal(r.ok, true);
  assert.deepEqual(r.items, []);
});

test('extractFrbCalendar: col-xs-2/7/3の3列構造の行が1件も無い入力は構造的失敗を返す', () => {
  const r = extractFrbCalendar('<div id="article"><h4 class="text-center">September 2026</h4><p>no rows here</p></div>');
  assert.equal(r.ok, false);
});

test('extractFrbCalendar: 月見出しが無い入力は構造的失敗を返す', () => {
  const r = extractFrbCalendar('<div id="article"><div class="col-xs-2"><p>10:00 a.m.</p></div><div class="col-xs-7"><p>Speech - Governor X</p></div><div class="col-xs-3"><p>1</p></div></div>');
  assert.equal(r.ok, false);
});

test('parseFrbCalendarTime: 午前・午後・正午・深夜の表記を24時間制へ変換する', () => {
  assert.equal(parseFrbCalendarTime('10:20 a.m.'), '10:20');
  assert.equal(parseFrbCalendarTime('2:30 p.m.'), '14:30');
  assert.equal(parseFrbCalendarTime('12:00 p.m.'), '12:00');
  assert.equal(parseFrbCalendarTime('12:00 a.m.'), '00:00');
});

test('normalizeFrbSpeakerName: 役職タイトル・ミドルイニシャルを除去する', () => {
  assert.equal(normalizeFrbSpeakerName('Vice Chair Philip N. Jefferson'), 'Philip Jefferson');
  assert.equal(normalizeFrbSpeakerName('Vice Chair for Supervision Michelle W. Bowman'), 'Michelle Bowman');
  assert.equal(normalizeFrbSpeakerName('Governor Michael S. Barr'), 'Michael Barr');
  assert.equal(normalizeFrbSpeakerName('Governor Christopher J. Waller'), 'Christopher Waller');
});

// 2026-11-14追加（しょうさん指摘、ウォーシュFRB議長の実例で発覚: 台帳us-official_speech-
// 2026-11-17がChairman表記未除去のため話者不明★★扱いになっていた）。旧実装は`^Chair\s+`
// （Chairの直後に空白）のみ対応していたため、空白無しで"man"が続く"Chairman"には
// マッチせず肩書きが残ってしまっていた
test('normalizeFrbSpeakerName: 議長職「Chairman」表記（空白を挟まず"Chair"に続く）も正しく除去する（ウォーシュ議長の実例）', () => {
  assert.equal(normalizeFrbSpeakerName('Chairman Kevin Warsh'), 'Kevin Warsh');
});

test('normalizeFrbSpeakerName: 「Vice Chairman」表記も正しく除去する', () => {
  assert.equal(normalizeFrbSpeakerName('Vice Chairman Philip N. Jefferson'), 'Philip Jefferson');
});

test('resolveOfficialBySurname: 正規化後の話者名がofficials.jsonの各FRB理事と正しく一致する', () => {
  assert.equal(resolveOfficialBySurname(officials, 'Philip Jefferson', 'US').role_rank, 'deputy_governor');
  assert.equal(resolveOfficialBySurname(officials, 'Michelle Bowman', 'US').role_rank, 'board_member');
  assert.equal(resolveOfficialBySurname(officials, 'Michael Barr', 'US').role_rank, 'board_member');
  assert.equal(resolveOfficialBySurname(officials, 'Christopher Waller', 'US').role_rank, 'board_member');
});

test('resolveOfficialBySurname: 正規化後の「Kevin Warsh」がofficials.json登録のFRB議長と正しく一致する（ウォーシュ議長の実例）', () => {
  const warsh = resolveOfficialBySurname(officials, 'Kevin Warsh', 'US');
  assert.ok(warsh, 'Kevin Warshが解決できない');
  assert.equal(warsh.role_rank, 'governor');
});
