'use strict';
// 米連邦祝日（振替ルール込み）の計算。ISM年次スケジュールドラフト生成（scripts/lib/ism-schedule.js）の
// 「営業日」判定に使う。固定日の祝日が土曜なら前金曜、日曜なら翌月曜に振り替える（連邦政府の慣行）。
// 対象はNode組み込みのDateのみ（UTC基準の疑似日付として扱う。時刻計算は行わないため
// タイムゾーン変換は不要＝scripts/lib/tz-convert.jsとは独立したモジュール）。

function pad2(n) {
  return String(n).padStart(2, '0');
}
function ymd(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}
function dateUTC(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d));
}
function dayOfWeek(y, m, d) {
  return dateUTC(y, m, d).getUTCDay(); // 0=Sun..6=Sat
}

// 固定日の祝日を振替ルール込みで観測日に変換する
function observedFixedDate(y, m, d) {
  const dow = dayOfWeek(y, m, d);
  if (dow === 6) return addDaysYmd(y, m, d, -1); // 土曜→前金曜
  if (dow === 0) return addDaysYmd(y, m, d, 1); // 日曜→翌月曜
  return ymd(y, m, d);
}

function addDaysYmd(y, m, d, days) {
  const dt = new Date(dateUTC(y, m, d).getTime() + days * 86400000);
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

// 月内の「第N月曜」等を求める（weekday: 0=Sun..6=Sat, n=1始まり）
function nthWeekdayOfMonth(y, m, weekday, n) {
  let count = 0;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let d = 1; d <= daysInMonth; d++) {
    if (dayOfWeek(y, m, d) === weekday) {
      count++;
      if (count === n) return ymd(y, m, d);
    }
  }
  return null;
}

// 月内の「最終月曜」等を求める
function lastWeekdayOfMonth(y, m, weekday) {
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let d = daysInMonth; d >= 1; d--) {
    if (dayOfWeek(y, m, d) === weekday) return ymd(y, m, d);
  }
  return null;
}

// 指定年の米連邦祝日一覧（観測日・振替済み）を返す
function usFederalHolidays(year) {
  const MON = 1;
  const THU = 4;
  return [
    observedFixedDate(year, 1, 1), // New Year's Day
    nthWeekdayOfMonth(year, 1, MON, 3), // MLK Day
    nthWeekdayOfMonth(year, 2, MON, 3), // Washington's Birthday
    lastWeekdayOfMonth(year, 5, MON), // Memorial Day
    observedFixedDate(year, 6, 19), // Juneteenth
    observedFixedDate(year, 7, 4), // Independence Day
    nthWeekdayOfMonth(year, 9, MON, 1), // Labor Day
    nthWeekdayOfMonth(year, 10, MON, 2), // Columbus Day
    observedFixedDate(year, 11, 11), // Veterans Day
    nthWeekdayOfMonth(year, 11, THU, 4), // Thanksgiving
    observedFixedDate(year, 12, 25), // Christmas Day
  ];
}

function isUsBusinessDay(ymdStr, holidaySet) {
  const [y, m, d] = ymdStr.split('-').map(Number);
  const dow = dayOfWeek(y, m, d);
  if (dow === 0 || dow === 6) return false;
  return !holidaySet.has(ymdStr);
}

module.exports = { usFederalHolidays, isUsBusinessDay, nthWeekdayOfMonth, lastWeekdayOfMonth };
