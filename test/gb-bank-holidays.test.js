'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { gbBankHolidays, gbBankHolidaysMaxYear, isGbBusinessDay } = require('../scripts/lib/gb-bank-holidays');

test('gbBankHolidays: 2026年のEngland and Wales祝日一覧をGOV.UK公式データどおりに返す', () => {
  const holidays = gbBankHolidays(2026);
  assert.ok(holidays.includes('2026-01-01')); // New Year's Day
  assert.ok(holidays.includes('2026-04-03')); // Good Friday
  assert.ok(holidays.includes('2026-04-06')); // Easter Monday
  assert.ok(holidays.includes('2026-05-04')); // Early May bank holiday
  assert.ok(holidays.includes('2026-05-25')); // Spring bank holiday
  assert.ok(holidays.includes('2026-08-31')); // Summer bank holiday
  assert.ok(holidays.includes('2026-12-25'));
  assert.ok(holidays.includes('2026-12-28')); // Boxing Day振替（12/26が土曜のため）
});

test('gbBankHolidays: 週末の固定祝日は振替日を含む（2021年クリスマス、12/25が土曜）', () => {
  const holidays = gbBankHolidays(2021);
  assert.ok(holidays.includes('2021-12-27')); // Christmas Day振替
  assert.ok(holidays.includes('2021-12-28')); // Boxing Day振替
  assert.ok(!holidays.includes('2021-12-25'));
});

test('gbBankHolidaysMaxYear: config/gb-bank-holidays.jsonの最終カバー年を返す', () => {
  const maxYear = gbBankHolidaysMaxYear();
  assert.ok(maxYear >= 2027, `最終カバー年が${maxYear}年では残量監視の余裕が乏しい`);
});

test('isGbBusinessDay: 週末は営業日ではない', () => {
  const holidaySet = new Set(gbBankHolidays(2026));
  assert.equal(isGbBusinessDay('2026-08-15', holidaySet), false); // 土曜
  assert.equal(isGbBusinessDay('2026-08-16', holidaySet), false); // 日曜
});

test('isGbBusinessDay: 銀行休業日は営業日ではない', () => {
  const holidaySet = new Set(gbBankHolidays(2026));
  assert.equal(isGbBusinessDay('2026-08-31', holidaySet), false); // Summer bank holiday
});

test('isGbBusinessDay: 平日かつ祝日でなければ営業日', () => {
  const holidaySet = new Set(gbBankHolidays(2026));
  assert.equal(isGbBusinessDay('2026-08-17', holidaySet), true); // 月曜・祝日でない
});
