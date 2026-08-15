'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeHaltWindow, unionIntervals, formatMinutes } = require('../scripts/lib/halt-schedule');

// SPEC §5 単体テスト必須ケース。ground truthはtemplates/design-mock_v1.2.html
// （2026-08-10週の実例。停止窓は手計算済みのサンプルデータ）と突き合わせて検証する。

test('08:50月曜（週明け特例）— 窓が日曜に跨る場合の特別文言', () => {
  // 8/10(月) 08:50 日銀「主な意見」。design-mock: 停止開始目安 00:00–04:50
  // （前日 日曜20:50〜を含むため、週明けの取引開始時点からの停止が目安）
  const w = computeHaltWindow({ date: '2026-08-10', firstTime: '08:50' });
  assert.equal(w.displayStart, '00:00');
  assert.equal(w.displayEnd, '04:50');
  assert.equal(w.crossesPreviousDay, true);
  assert.equal(w.previousDayLabel, '日');
  assert.equal(w.rawPreviousDayStart, '20:50');
  assert.equal(w.isMondayWeekendCross, true);
  assert.match(w.annotation, /前日 日曜20:50〜を含む/);
  assert.match(w.annotation, /週明けの取引開始時点からの停止が目安/);
});

test('13:30+14:30枠（束ね）— 枠内最初の時刻を基準に計算、再開は最後の時刻から', () => {
  // 8/11(火) RBA政策金利(13:30)＋声明(13:30)＋総裁会見(14:30)を1枠として束ねる
  // design-mock: 停止開始目安 01:30–09:30（再開確認は記者会見の終了後から）
  const w = computeHaltWindow({ date: '2026-08-11', firstTime: '13:30', lastTime: '14:30' });
  assert.equal(w.displayStart, '01:30');
  assert.equal(w.displayEnd, '09:30');
  assert.equal(w.crossesPreviousDay, false);
  assert.equal(w.resumeAfter, '14:30');
});

test('同日2枠の和集合 — 重なる窓は1本のバーにマージされる（テキストは枠別に正確な時刻を保持）', () => {
  // 8/13(木) 英GDP(15:00→03:00-11:00) と 米PPI(21:30→09:30-17:30)。窓が重なるため和集合は1区間
  const gdp = computeHaltWindow({ date: '2026-08-13', firstTime: '15:00' });
  const ppi = computeHaltWindow({ date: '2026-08-13', firstTime: '21:30' });
  assert.equal(gdp.displayStart, '03:00');
  assert.equal(gdp.displayEnd, '11:00');
  assert.equal(ppi.displayStart, '09:30');
  assert.equal(ppi.displayEnd, '17:30');

  const merged = unionIntervals([
    { start: gdp.displayStartMin, end: gdp.displayEndMin },
    { start: ppi.displayStartMin, end: ppi.displayEndMin },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(formatMinutes(merged[0].start), '03:00');
  assert.equal(formatMinutes(merged[0].end), '17:30');
});

test('同日2枠だが重ならない場合 — 和集合は2区間のまま（8/14金の例）', () => {
  // 8/14(金) RBA証言(08:30→前日跨ぎclamp 00:00-04:30) と 米小売売上高(21:30→09:30-17:30)は重ならない
  const testimony = computeHaltWindow({ date: '2026-08-14', firstTime: '08:30' });
  const retail = computeHaltWindow({ date: '2026-08-14', firstTime: '21:30' });
  assert.equal(testimony.displayStart, '00:00');
  assert.equal(testimony.displayEnd, '04:30');
  assert.equal(testimony.crossesPreviousDay, true);
  assert.equal(testimony.previousDayLabel, '木');
  assert.equal(testimony.rawPreviousDayStart, '20:30');
  assert.equal(testimony.isMondayWeekendCross, false, '木曜への跨ぎは週明け特例ではない');
  assert.match(testimony.annotation, /前日 木曜20:30〜を含む/);
  assert.doesNotMatch(testimony.annotation, /週明け/);

  const merged = unionIntervals([
    { start: testimony.displayStartMin, end: testimony.displayEndMin },
    { start: retail.displayStartMin, end: retail.displayEndMin },
  ]);
  assert.equal(merged.length, 2, '重ならない窓は別区間のまま');
});

test('21:30通常 — 前日跨ぎなし・注記なし', () => {
  // 8/12(水) 米CPI 21:30。design-mock: 停止開始目安 09:30–17:30（注記なし）
  const w = computeHaltWindow({ date: '2026-08-12', firstTime: '21:30' });
  assert.equal(w.displayStart, '09:30');
  assert.equal(w.displayEnd, '17:30');
  assert.equal(w.crossesPreviousDay, false);
  assert.equal(w.annotation, null);
});

test('未定除外 — 時刻未公表イベントはfirstTime必須のためこの関数を呼ばない設計。誤呼び出しは例外', () => {
  assert.throws(() => computeHaltWindow({ date: '2026-08-04', firstTime: null }));
  assert.throws(() => computeHaltWindow({ date: '2026-08-04', firstTime: undefined }));
});

test('窓の分丸め（HH:MM維持・丸めなし）— 端数分がそのまま保持される', () => {
  const w = computeHaltWindow({ date: '2026-08-12', firstTime: '13:37' });
  assert.equal(w.displayStart, '01:37');
  assert.equal(w.displayEnd, '09:37');
});

test('unionIntervals: 境界が接する区間もマージされる', () => {
  const merged = unionIntervals([
    { start: 100, end: 200 },
    { start: 200, end: 300 },
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0], { start: 100, end: 300 });
});

test('unionIntervals: 入力順序に依存しない', () => {
  const merged = unionIntervals([
    { start: 570, end: 1050 },
    { start: 180, end: 660 },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].start, 180);
  assert.equal(merged[0].end, 1050);
});

// task #47実バグ修正（2026-08-15、しょうさん指摘: 8/17週フルパイプライン実ネットワーク検証で
// FOMC議事録8/20(木)03:00発表分の停止窓が丸ごと前日8/19(水)に収まり、修正前は
// 「停止開始目安 00:00–23:00（前日 水曜15:00〜を含む）」という23時間停止の誤表示になっていた）。
// entirelyPreviousDayフラグとprevious-day基準の時刻・分値が正しく計算されることを検証する
test('entirelyPreviousDay: 03:00発表（FOMC議事録の実例、木曜）— 窓が丸ごと前日に収まる', () => {
  const w = computeHaltWindow({ date: '2026-08-20', firstTime: '03:00' });
  assert.equal(w.entirelyPreviousDay, true);
  assert.equal(w.crossesPreviousDay, true);
  assert.equal(w.previousDayLabel, '水');
  assert.equal(w.isMondayWeekendCross, false);
  assert.equal(w.rawPreviousDayStart, '15:00');
  assert.equal(w.rawPreviousDayEnd, '23:00');
  assert.equal(w.previousDayBarStartMin, 900); // 15:00
  assert.equal(w.previousDayBarEndMin, 1380); // 23:00
  assert.match(w.annotation, /前日 水曜15:00〜23:00/);
  assert.doesNotMatch(w.annotation, /週明け/);
  // displayStart/displayEndは当日クランプ値のままだが（後方互換のため残す）、
  // 呼び出し側（build-report-data.js・html-renderer.js）はentirelyPreviousDayを見て
  // これらの値を使わず前日の実時刻を使うことでバグを回避する（renderer.test.js参照）
  assert.equal(w.displayStart, '00:00');
  assert.equal(w.displayEnd, '23:00');
});

test('entirelyPreviousDay: 02:00発表（水曜、火曜へ跨る）', () => {
  const w = computeHaltWindow({ date: '2026-08-19', firstTime: '02:00' });
  assert.equal(w.entirelyPreviousDay, true);
  assert.equal(w.previousDayLabel, '火');
  assert.equal(w.rawPreviousDayStart, '14:00');
  assert.equal(w.rawPreviousDayEnd, '22:00');
  assert.equal(w.previousDayBarStartMin, 840);
  assert.equal(w.previousDayBarEndMin, 1320);
});

test('entirelyPreviousDay: 月曜00:30発表（日曜へ跨る、週明け特例）', () => {
  const w = computeHaltWindow({ date: '2026-08-17', firstTime: '00:30' });
  assert.equal(w.entirelyPreviousDay, true);
  assert.equal(w.previousDayLabel, '日');
  assert.equal(w.isMondayWeekendCross, true);
  assert.equal(w.rawPreviousDayStart, '12:30');
  assert.equal(w.rawPreviousDayEnd, '20:30');
  assert.equal(w.previousDayBarStartMin, 750);
  assert.equal(w.previousDayBarEndMin, 1230);
  assert.match(w.annotation, /前日 日曜12:30〜20:30/);
  assert.match(w.annotation, /週明けの取引開始時点からの停止が目安/);
});

test('entirelyPreviousDay: 境界値04:00は窓の終わりがちょうど当日0時（entirelyPreviousDay扱い）', () => {
  const w = computeHaltWindow({ date: '2026-08-20', firstTime: '04:00' });
  assert.equal(w.endMin, 0);
  assert.equal(w.entirelyPreviousDay, true);
});

test('entirelyPreviousDay: 境界値04:01は窓が1分だけ当日にかかる（entirelyPreviousDayではない、既存の部分跨ぎ扱い）', () => {
  const w = computeHaltWindow({ date: '2026-08-20', firstTime: '04:01' });
  assert.equal(w.endMin, 1);
  assert.equal(w.entirelyPreviousDay, false);
  assert.equal(w.crossesPreviousDay, true);
  assert.equal(w.displayEnd, '00:01');
});

test('formatMinutes: 負数・24時超のラップ', () => {
  assert.equal(formatMinutes(-190), '20:50');
  assert.equal(formatMinutes(-1), '23:59');
  assert.equal(formatMinutes(0), '00:00');
  assert.equal(formatMinutes(1439), '23:59');
  assert.equal(formatMinutes(1440), '00:00');
});
