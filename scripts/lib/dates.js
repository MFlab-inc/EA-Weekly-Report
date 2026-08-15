'use strict';
// 対象週の日付計算（JST基準）。SPEC §2: 「実行日（土曜）の翌月曜〜金曜」。
// reference/ea-weekly-report-skill/scripts/get_next_week_dates.py の規則を踏襲:
// 常に「今日を含まない直近の月曜」を返す（今日が月曜でも今週は対象にしない）。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_JA = ['', '月', '火', '水', '木', '金', '土', '日']; // index: ISO weekday 1..7

function pad2(n) {
  return String(n).padStart(2, '0');
}

// 実時刻(Date)のJSTカレンダー日を、UTC深夜基準の疑似Dateとして返す。
// 以降の日数計算はこの疑似Date同士の加減算のみで行う（DSTがないJSTでは厳密に正しい）。
function jstCalendarDate(date) {
  const jstMs = date.getTime() + JST_OFFSET_MS;
  const d = new Date(jstMs);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(pseudoDate, days) {
  return new Date(pseudoDate.getTime() + days * DAY_MS);
}

// ISO weekday: 月=1 .. 日=7
function isoWeekdayOf(pseudoDate) {
  const dow = pseudoDate.getUTCDay(); // 0=Sun..6=Sat
  return dow === 0 ? 7 : dow;
}

function weekdayJa(pseudoDate) {
  return WEEKDAY_JA[isoWeekdayOf(pseudoDate)];
}

function formatYmd(pseudoDate) {
  return `${pseudoDate.getUTCFullYear()}-${pad2(pseudoDate.getUTCMonth() + 1)}-${pad2(pseudoDate.getUTCDate())}`;
}

function formatMd(pseudoDate) {
  return `${pseudoDate.getUTCMonth() + 1}/${pseudoDate.getUTCDate()}`;
}

function parseYmd(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// now: 実行時刻のDate（UTC内部表現。通常はActions実行時のnew Date()）
// 戻り値: 対象週（月〜金）の5日分の日付情報＋収集日
function getTargetWeek(now = new Date()) {
  const today = jstCalendarDate(now);
  const iso = isoWeekdayOf(today);
  const daysToNextMonday = 8 - iso; // 1..7。今日が月曜でも7（来週の月曜）になる
  const monday = addDays(today, daysToNextMonday);
  const dates = [];
  for (let i = 0; i < 5; i++) {
    const d = addDays(monday, i);
    dates.push({ date: formatYmd(d), md: formatMd(d), weekday: weekdayJa(d) });
  }
  return {
    collectionDate: formatYmd(today),
    targetWeekStart: formatYmd(monday),
    targetWeekEnd: formatYmd(addDays(monday, 4)),
    dates,
  };
}

module.exports = {
  getTargetWeek,
  jstCalendarDate,
  addDays,
  isoWeekdayOf,
  weekdayJa,
  formatYmd,
  formatMd,
  parseYmd,
};
