'use strict';
// BOE事前公表カレンダー抽出（scripts/checkers/extractors/boe-calendar.js、しょうさん指示
// 2026-09-26）のテスト。fixtureはBOE公式イベントページ（https://www.bankofengland.co.uk/
// events/upcoming-events）の実測構造（2026-09-26、live fetch）をそのまま収録している
// （<title>の宣言ウィンドウ・2週分の全予定・<br /><br />同居行・装飾<p><span>見出し・
// 時刻併記で曖昧な行を含む）。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const {
  extractBoeCalendar,
  parseDeclaredWindow,
  parseBoeCalendarTime,
  buildWindowDates,
} = require('../scripts/checkers/extractors/boe-calendar');
const { resolveOfficialBySurname } = require('../scripts/lib/naming');

const fx = () => readFileSync(join(__dirname, 'fixtures', 'official-sources', 'gb_boe_calendar', 'upcoming-events.html'), 'utf8');
const officials = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'officials.json'), 'utf8')).officials;

test('extractBoeCalendar: 2週間分（w/b 9/28・10/5）の全予定（実測14件）から曖昧な時刻併記の1件を除いた13件を抽出する（タイムゾーン表記が無い項目も時刻未確定として件数には含まれる）', () => {
  const r = extractBoeCalendar(fx(), { targetWeek: { targetWeekStart: '2026-09-28' } });
  assert.equal(r.ok, true);
  // 実測14件のうち、Sasha Millsの10/7分（"Speech at 9.40am, Panel at 10am"で時刻が一意に
  // 決まらない）は掲載しない設計のため13件
  assert.equal(r.items.length, 13);
});

// 2026-10-10追記（しょうさん指摘）: このfixture（2026-09-26実測）はBOEがまだタイムゾーンを
// 一切明記していなかった時期のものであり、全項目がタイムゾーン表記無し＝時刻未確定になる
test('extractBoeCalendar: 通常の<h3>見出し配下の1件（ダブス・ラムズデン理事、9/28 11am）はタイムゾーン表記が無いため時刻未確定として抽出する', () => {
  const r = extractBoeCalendar(fx(), { targetWeek: { targetWeekStart: '2026-09-28' } });
  const ramsden = r.items.find((i) => i.speakerLastName === 'Dave Ramsden');
  assert.ok(ramsden, JSON.stringify(r.items));
  assert.equal(ramsden.date, '2026-09-28');
  assert.equal(ramsden.localTime, null);
  assert.equal(ramsden.timeAmbiguous, true);
  assert.equal(ramsden.ambiguousTimeRaw, '11am');
});

test('extractBoeCalendar: 装飾<p><span>形式の日付見出し（Tuesday 29 September、<h3>ではない）配下の予定も正しい日付に紐づける（タイムゾーン表記無しのため時刻未確定）', () => {
  const r = extractBoeCalendar(fx(), { targetWeek: { targetWeekStart: '2026-09-28' } });
  const mann = r.items.find((i) => i.speakerLastName === 'Catherine L Mann' && i.ambiguousTimeRaw === '4pm');
  assert.ok(mann, JSON.stringify(r.items));
  assert.equal(mann.date, '2026-09-29');
  assert.equal(mann.localTime, null);
  assert.equal(mann.timeAmbiguous, true);
});

test('extractBoeCalendar: 1つの<p>に<br /><br />で同居する2人分（Catherine L Mann・Alan Taylor）を別々の予定として抽出する（タイムゾーン表記無しのため時刻未確定）', () => {
  const r = extractBoeCalendar(fx(), { targetWeek: { targetWeekStart: '2026-09-28' } });
  const taylor = r.items.find((i) => i.speakerLastName === 'Alan Taylor');
  assert.ok(taylor, JSON.stringify(r.items));
  assert.equal(taylor.date, '2026-09-29');
  assert.equal(taylor.localTime, null);
  assert.equal(taylor.timeAmbiguous, true);
  assert.equal(taylor.ambiguousTimeRaw, '4.30pm');
});

test('extractBoeCalendar: 説明文後半の無関係な時刻表記（"text to be released on Thursday 1 October at 10am"の10am）を誤って拾わず、最初の括弧内の時刻（11.25am）のみを採用する（タイムゾーン表記無しのため時刻未確定）', () => {
  const r = extractBoeCalendar(fx(), { targetWeek: { targetWeekStart: '2026-09-28' } });
  const benjamin = r.items.find((i) => i.speakerLastName === 'Nathanael Benjamin');
  assert.ok(benjamin, JSON.stringify(r.items));
  assert.equal(benjamin.date, '2026-09-30');
  assert.equal(benjamin.localTime, null);
  assert.equal(benjamin.timeAmbiguous, true);
  assert.equal(benjamin.ambiguousTimeRaw, '11.25am'); // 後半の無関係な"10am"ではなく最初の括弧内の時刻
});

// 2026-10-10追加（しょうさん指摘: BOEの予定ページで、海外会場での発言にBST等のタイムゾーンを
// 明記する運用が確認できた一方、明記が無い項目はロンドン時間として推測変換されていた）
test('extractBoeCalendar: 括弧内に「BST」の明記がある項目は時刻確定として扱う（バンコクIMF年次総会関連の実例と同型）', () => {
  const html = [
    '<title>Upcoming events - w/b 12 October 2026 and 19 October 2026</title>',
    '<div class="page-content">',
    '<h3>Monday 12 October</h3>',
    '<p>Sarah Breeden: <a href="/speech">Panel on tokenization</a> (10.30am BST)</p>',
    '<p>Catherine L Mann: <a href="/speech">Panellist at the 68th NABE Annual Meeting</a>, (1.50pm)</p>',
    '</div>',
    '<h2>Upcoming key publications</h2>',
  ].join('\n');
  const r = extractBoeCalendar(html, { targetWeek: { targetWeekStart: '2026-10-12' } });
  assert.equal(r.ok, true);

  const breeden = r.items.find((i) => i.speakerLastName === 'Sarah Breeden');
  assert.ok(breeden, JSON.stringify(r.items));
  assert.equal(breeden.localTime, '10:30');
  assert.equal(breeden.timeAmbiguous, undefined);

  // Catherine L Mann（NABE年次総会＝米クリーブランド）はBST等の明記が無いため時刻未確定
  const mann = r.items.find((i) => i.speakerLastName === 'Catherine L Mann');
  assert.ok(mann, JSON.stringify(r.items));
  assert.equal(mann.localTime, null);
  assert.equal(mann.timeAmbiguous, true);
  assert.equal(mann.ambiguousTimeRaw, '1.50pm');
});

test('extractBoeCalendar: 括弧内の「GMT」の明記も時刻確定として扱う（冬時間の場合の表記想定）', () => {
  const html = [
    '<title>Upcoming events - w/b 12 October 2026 and 19 October 2026</title>',
    '<div class="page-content">',
    '<h3>Monday 12 October</h3>',
    '<p>Huw Pill: <a href="/speech">Citi Roundtable at IMF</a> (7am GMT)</p>',
    '</div>',
    '<h2>Upcoming key publications</h2>',
  ].join('\n');
  const r = extractBoeCalendar(html, { targetWeek: { targetWeekStart: '2026-10-12' } });
  assert.equal(r.ok, true);
  const pill = r.items.find((i) => i.speakerLastName === 'Huw Pill');
  assert.ok(pill, JSON.stringify(r.items));
  assert.equal(pill.localTime, '07:00');
  assert.equal(pill.timeAmbiguous, undefined);
});

test('extractBoeCalendar: 1件の予定に時刻が2つ併記され一意に決まらない行（Sasha Mills「Speech at 9.40am, Panel at 10am」）は推測で補わず掲載しない', () => {
  const r = extractBoeCalendar(fx(), { targetWeek: { targetWeekStart: '2026-09-28' } });
  const oct7 = r.items.filter((i) => i.date === '2026-10-07');
  assert.deepEqual(oct7, []);
});

test('extractBoeCalendar: 話者名を伴わない告知行（Financial Policy Committee Recordへのリンクのみ）は掲載対象外', () => {
  const r = extractBoeCalendar(fx(), { targetWeek: { targetWeekStart: '2026-09-28' } });
  assert.ok(!r.items.some((i) => /Financial Policy Committee Record/.test(i.title)));
});

test('extractBoeCalendar: BOE以外の登壇者（Phil Evans、ISDAフォーラムの同日パネリスト）も機械的に抽出する（是非の判定はbuild-ledger.js側の既存フォールバックに委ねる設計。タイムゾーン表記無しのため時刻未確定）', () => {
  const r = extractBoeCalendar(fx(), { targetWeek: { targetWeekStart: '2026-09-28' } });
  const evans = r.items.find((i) => i.speakerLastName === 'Phil Evans');
  assert.ok(evans, JSON.stringify(r.items));
  assert.equal(evans.date, '2026-09-30');
  assert.equal(evans.localTime, null);
  assert.equal(evans.timeAmbiguous, true);
  assert.equal(evans.ambiguousTimeRaw, '2.50pm');
});

test('extractBoeCalendar: 対象週（targetWeek.targetWeekStart）が2週目（10/5）でも正しく抽出できる', () => {
  const r = extractBoeCalendar(fx(), { targetWeek: { targetWeekStart: '2026-10-05' } });
  assert.equal(r.ok, true);
  assert.ok(r.items.some((i) => i.speakerLastName === 'Manuel Sales' && i.date === '2026-10-05'));
  assert.ok(r.items.some((i) => i.speakerLastName === 'Clare Lombardelli' && i.date === '2026-10-08'));
});

test('extractBoeCalendar: 対象週がページの表示ウィンドウ（今週+翌週）に含まれない場合は構造的失敗として扱う（前提が崩れたときに気づける仕組み）', () => {
  const r = extractBoeCalendar(fx(), { targetWeek: { targetWeekStart: '2026-10-12' } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /表示ウィンドウ.*対象週.*含んでいない/);
});

// しょうさん指示（2026-09-27）: このページは通常必ず何らかの予定が掲載されているため、
// HTTP取得は成功したが話者行を1件も抽出できない場合は構造的失敗として扱う（サイト構造変化を
// 見逃さないため）。曜日見出しは見つかるが、話者行のパターン（{フルネーム}: {説明}({時刻})）
// 自体が変わり1件もマッチしないケースを再現する
test('extractBoeCalendar: 曜日見出しは見つかるが話者行が1件も抽出できない場合は構造的失敗を返す（HTTP取得成功でも0件は失敗扱い）', () => {
  const html = [
    '<title>Upcoming events - w/b 28 September 2026 and 5 October 2026</title>',
    '<div class="page-content">',
    '<h3>Monday 28 September</h3>',
    '<p>Some unrelated announcement with no speaker colon pattern at all</p>',
    '</div>',
    '<h2>Upcoming key publications</h2>',
  ].join('\n');
  const r = extractBoeCalendar(html);
  assert.equal(r.ok, false);
  assert.match(r.reason, /話者行を1件も抽出できなかった/);
});

test('extractBoeCalendar: <title>から表示ウィンドウを読み取れない入力は構造的失敗を返す', () => {
  const r = extractBoeCalendar('<html><title>no window here</title><div class="page-content"></div><h2>Upcoming key publications</h2></html>');
  assert.equal(r.ok, false);
  assert.match(r.reason, /表示ウィンドウ/);
});

test('extractBoeCalendar: イベント一覧の開始/終了マーカーが見つからない入力は構造的失敗を返す', () => {
  const r = extractBoeCalendar('<title>Upcoming events - w/b 28 September 2026 and 5 October 2026</title>');
  assert.equal(r.ok, false);
  assert.match(r.reason, /開始\/終了マーカー/);
});

test('extractBoeCalendar: 曜日見出しが1件も無い入力は構造的失敗を返す', () => {
  const html = '<title>Upcoming events - w/b 28 September 2026 and 5 October 2026</title><div class="page-content"><p>Andrew Bailey: Speech (9am)</p></div><h2>Upcoming key publications</h2>';
  const r = extractBoeCalendar(html);
  assert.equal(r.ok, false);
  assert.match(r.reason, /曜日見出し/);
});

test('parseDeclaredWindow: <title>のw/b表記から2つの週の月曜日を読み取る', () => {
  const html = '<title>Upcoming events - w/b 28 September 2026 and 5 October 2026 | Bank of England</title>';
  assert.deepEqual(parseDeclaredWindow(html), { monday1: '2026-09-28', monday2: '2026-10-05' });
});

test('buildWindowDates: 月曜日から14日分（2週間）の連続した日付を作る', () => {
  const dates = buildWindowDates('2026-09-28');
  assert.equal(dates.length, 14);
  assert.equal(dates[0], '2026-09-28');
  assert.equal(dates[13], '2026-10-11');
});

test('parseBoeCalendarTime: ドット区切り・整数のam/pm表記を24時間制へ変換する', () => {
  assert.equal(parseBoeCalendarTime('9am'), '09:00');
  assert.equal(parseBoeCalendarTime('11.25am'), '11:25');
  assert.equal(parseBoeCalendarTime('2.50pm'), '14:50');
  assert.equal(parseBoeCalendarTime('12am'), '00:00');
  assert.equal(parseBoeCalendarTime('12pm'), '12:00');
});

test('resolveOfficialBySurname: フルネーム抽出によりAndrew Baileyがofficials.json登録の総裁と一致する', () => {
  const bailey = resolveOfficialBySurname(officials, 'Andrew Bailey', 'GB');
  assert.ok(bailey);
  assert.equal(bailey.role_rank, 'governor');
});

test('resolveOfficialBySurname: officials.json未登録の話者（Executive Director級のNathanael Benjamin等）はnullを返す（安全側フォールバックの対象）', () => {
  assert.equal(resolveOfficialBySurname(officials, 'Nathanael Benjamin', 'GB'), null);
});
