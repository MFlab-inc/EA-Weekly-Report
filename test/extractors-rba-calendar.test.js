'use strict';
// RBA事前公表予定表抽出（scripts/checkers/extractors/rba-calendar.js、2026-09-27新設）のテスト。
// fixtureはRBA公式予定表ページ（https://www.rba.gov.au/coming-up/index.html）の実測構造
// （2026-09-27、live fetch）をそのまま収録している（Speech/Fireside Chat/Panel Participation/
// Appearance各type・記者会見[event-type-media-conference]・議事録公表・出版物告知を含む
// 2026年9月〜2027年12月分の実データそのまま。AEST→AEDT切替[2026-10-04]をまたぐ）。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  extractRbaCalendar,
  parseDatetimeAttr,
  parseOffsetMinutes,
  expectedOffsetFromAbbrText,
  extractSpeakerName,
} = require('../scripts/checkers/extractors/rba-calendar');

const fx = () => readFileSync(join(__dirname, 'fixtures', 'official-sources', 'au_rba_calendar', 'coming-up.html'), 'utf8');

test('extractRbaCalendar: event-category-speechesの実測7件（Speech/Fireside Chat/Panel Participation/Appearance）を抽出する', () => {
  const r = extractRbaCalendar(fx());
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 7);
});

test('extractRbaCalendar: 政策決定後の記者会見（event-type-media-conference、ブロック総裁）は除外する', () => {
  const r = extractRbaCalendar(fx());
  assert.ok(!r.items.some((i) => /Monetary Policy Decision$/.test(i.title)), JSON.stringify(r.items));
});

test('extractRbaCalendar: 議事録公表・出版物告知（event-category-speechesではない行）は除外する', () => {
  const r = extractRbaCalendar(fx());
  assert.ok(!r.items.some((i) => /Minutes of the|Financial Stability Review|Chart Pack/.test(i.title)), JSON.stringify(r.items));
});

test('extractRbaCalendar: ハウザー副総裁の講演（11/5 17:35 AEDT）をUTC instantで正しく抽出する', () => {
  const r = extractRbaCalendar(fx());
  const speech = r.items.find((i) => i.title.includes('Sir Leslie Melville Lecture'));
  assert.ok(speech, JSON.stringify(r.items));
  assert.equal(speech.utcInstant, '2026-11-05T06:35:00.000Z'); // 17:35 AEDT(+11:00) = 06:35 UTC
  assert.equal(speech.speakerLastName, 'Andrew Hauser');
});

test('extractRbaCalendar: "Appearance by"（カンマ無しで"at"へ続く言い回し）からも話者名を抽出する', () => {
  const r = extractRbaCalendar(fx());
  const appearance = r.items.find((i) => i.title.startsWith('Appearance by'));
  assert.ok(appearance, JSON.stringify(r.items));
  assert.equal(appearance.speakerLastName, 'Andrew Hauser');
});

test('extractRbaCalendar: "Fireside Chat with"／"Panel Participation by"からも話者名を抽出する', () => {
  const r = extractRbaCalendar(fx());
  const kent = r.items.find((i) => i.title.startsWith('Fireside Chat with Christopher Kent'));
  const jones = r.items.find((i) => i.title.startsWith('Panel Participation by Brad Jones'));
  assert.ok(kent, JSON.stringify(r.items));
  assert.ok(jones, JSON.stringify(r.items));
  assert.equal(kent.speakerLastName, 'Christopher Kent');
  assert.equal(jones.speakerLastName, 'Brad Jones');
});

test('extractRbaCalendar: event-category-speechesの<article>が1件も無い入力は構造的失敗を返す', () => {
  const html = '<html><article class="item event-category-statistics"><h4 itemprop="headline">Chart Pack</h4></article></html>';
  const r = extractRbaCalendar(html);
  assert.equal(r.ok, false);
  assert.match(r.reason, /event-category-speechesの<article>要素が1件も見つからない/);
});

test('extractRbaCalendar: <article>要素はあるが見出し・時刻を1件も抽出できない場合は構造的失敗を返す（HTTP取得成功でも0件は失敗扱い）', () => {
  const html = '<article class="item event-category-speeches event-type-speech"><div class="content"><p>見出しタグが変わってしまった行</p></div></article>';
  const r = extractRbaCalendar(html);
  assert.equal(r.ok, false);
  assert.match(r.reason, /見出し・時刻を1件も抽出できなかった/);
});

// しょうさん指摘（2026-09-27）: 「時刻は AEST/AEDT の別を正しく判定して」への対応。
// datetime属性のオフセットとテキスト表記の略称（AEST/AEDT）が矛盾する場合は構造的失敗とする
test('extractRbaCalendar: datetime属性のオフセットとテキスト表記の略称（AEST/AEDT）が矛盾する場合は構造的失敗を返す', () => {
  const html = [
    '<article class="item event-category-speeches event-type-speech" itemscope itemtype="https://schema.org/NewsArticle">',
    '<h4 class="heading" itemprop="headline">Speech by Test Person, Governor, at Test Venue</h4>',
    '<time class="datetime" itemprop="datePublished" datetime="2026-11-05T17:35+10:00">',
    '<span class="time">5.35 pm AEDT</span></time>', // +10:00なのにテキストはAEDT（本来+11:00のはず）
    '</article>',
  ].join('\n');
  const r = extractRbaCalendar(html);
  assert.equal(r.ok, false);
  assert.match(r.reason, /オフセットが矛盾している/);
});

// AEST/AEDTの実際の切替日（2026年は10/4）とは無関係な想定外オフセット（+09:00等）が
// 使われた場合、Australia/Sydneyの実際のDST規則と一致せず検出できることを確認する
// （テキスト表記自体が無い場合でも、tz-convert.js側の実測突合で検出する）
test('extractRbaCalendar: Australia/Sydneyの実際のDST規則と一致しないオフセットは構造的失敗を返す（テキスト表記が無い場合でもtz-convert.js突合で検出）', () => {
  const html = [
    '<article class="item event-category-speeches event-type-speech" itemscope itemtype="https://schema.org/NewsArticle">',
    '<h4 class="heading" itemprop="headline">Speech by Test Person, Governor, at Test Venue</h4>',
    '<time class="datetime" itemprop="datePublished" datetime="2026-11-05T17:35+09:00">',
    '<span class="date">5 November 2026</span></time>',
    '</article>',
  ].join('\n');
  const r = extractRbaCalendar(html);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Australia\/Sydneyの実際のDST規則.*一致しない/);
});

// しょうさん指摘: 「夏時間の切替をまたぐ週のテストを含めること」への対応。2026年の切替日は
// 10/4（日）で、fixture自体がこの前後を含む実データのため、切替前（AEST）・切替後（AEDT）の
// 双方を合成データで明示的に検証する
test('extractRbaCalendar: AEST/AEDT切替週（2026-10-04前後）の両側を正しくUTC変換する', () => {
  const html = [
    '<article class="item event-category-speeches event-type-speech" itemscope itemtype="https://schema.org/NewsArticle">',
    '<h4 class="heading" itemprop="headline">Speech by Person One, Governor, at Venue A</h4>',
    '<time class="datetime" itemprop="datePublished" datetime="2026-10-01T11:30+10:00">', // 切替前（AEST、+10:00）
    '<span class="time">11.30 am AEST</span></time>',
    '</article>',
    '<article class="item event-category-speeches event-type-speech" itemscope itemtype="https://schema.org/NewsArticle">',
    '<h4 class="heading" itemprop="headline">Speech by Person Two, Governor, at Venue B</h4>',
    '<time class="datetime" itemprop="datePublished" datetime="2026-10-13T11:30+11:00">', // 切替後（AEDT、+11:00）
    '<span class="time">11.30 am AEDT</span></time>',
    '</article>',
  ].join('\n');
  const r = extractRbaCalendar(html);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].utcInstant, '2026-10-01T01:30:00.000Z'); // AEST: 11:30-10h
  assert.equal(r.items[1].utcInstant, '2026-10-13T00:30:00.000Z'); // AEDT: 11:30-11h
});

test('parseDatetimeAttr: 秒あり/なし・コロン省略オフセットのいずれも解析できる', () => {
  assert.equal(parseDatetimeAttr('2026-11-05T17:35+11:00').offsetMin, 660);
  assert.equal(parseDatetimeAttr('2026-11-03T14:30:00+11:00').offsetMin, 660);
  assert.equal(parseDatetimeAttr('2026-11-05T17:35+1100').offsetMin, 660);
});

test('parseOffsetMinutes: +10:00→600分、+11:00→660分、Z→0分', () => {
  assert.equal(parseOffsetMinutes('+10:00'), 600);
  assert.equal(parseOffsetMinutes('+11:00'), 660);
  assert.equal(parseOffsetMinutes('Z'), 0);
});

test('expectedOffsetFromAbbrText: AEST→600分、AEDT→660分、どちらも無ければnull', () => {
  assert.equal(expectedOffsetFromAbbrText('11.30 am AEST'), 600);
  assert.equal(expectedOffsetFromAbbrText('5.35 pm AEDT'), 660);
  assert.equal(expectedOffsetFromAbbrText('11.30 am'), null);
});

test('extractSpeakerName: "by"/"with"直後・カンマまたは" at "手前までを話者名として抽出する', () => {
  assert.equal(extractSpeakerName('Speech by Andrew Hauser, Deputy Governor, at the Lecture'), 'Andrew Hauser');
  assert.equal(extractSpeakerName('Appearance by Andrew Hauser, Deputy Governor at Conference'), 'Andrew Hauser');
  assert.equal(extractSpeakerName('Fireside Chat with Christopher Kent, Assistant Governor, at Conference'), 'Christopher Kent');
  assert.equal(extractSpeakerName('Monetary Policy Board Meeting'), null);
});
