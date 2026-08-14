'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { usFederalHolidays, isUsBusinessDay } = require('../scripts/lib/us-federal-holidays');

test('usFederalHolidays: 2026年の固定日祝日（振替なし）が正しい', () => {
  const holidays = usFederalHolidays(2026);
  assert.ok(holidays.includes('2026-12-25')); // Christmas (金曜日、振替なし)
});

test('usFederalHolidays: 土曜日の固定祝日は前金曜へ振替', () => {
  // 2026-07-04(Independence Day)は土曜日のため前日07-03(金)へ振替
  const holidays = usFederalHolidays(2026);
  assert.ok(!holidays.includes('2026-07-04'));
  assert.ok(holidays.includes('2026-07-03'));
});

test('usFederalHolidays: 平日の固定祝日は振替なし', () => {
  // 2026-11-11(Veterans Day)は水曜日のため振替なし
  const holidays = usFederalHolidays(2026);
  assert.ok(holidays.includes('2026-11-11'));
});

test('usFederalHolidays: 第N月曜ルール（労働者の日=9月第1月曜）', () => {
  const holidays = usFederalHolidays(2026);
  assert.ok(holidays.includes('2026-09-07')); // 2026-09-07は月曜（9月第1月曜）
});

test('usFederalHolidays: 感謝祭（11月第4木曜）', () => {
  const holidays = usFederalHolidays(2026);
  assert.ok(holidays.includes('2026-11-26'));
});

test('isUsBusinessDay: 土日は営業日でない', () => {
  const holidays = new Set(usFederalHolidays(2026));
  assert.equal(isUsBusinessDay('2026-08-15', holidays), false); // 土曜
  assert.equal(isUsBusinessDay('2026-08-16', holidays), false); // 日曜
});

test('isUsBusinessDay: 祝日は営業日でない', () => {
  const holidays = new Set(usFederalHolidays(2026));
  assert.equal(isUsBusinessDay('2026-09-07', holidays), false); // Labor Day
});

test('isUsBusinessDay: 平日かつ祝日でなければ営業日', () => {
  const holidays = new Set(usFederalHolidays(2026));
  assert.equal(isUsBusinessDay('2026-08-03', holidays), true); // 月曜・祝日なし
});
