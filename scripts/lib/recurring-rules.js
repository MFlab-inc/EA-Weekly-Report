'use strict';
// config/importance-rules.json の recurring_checks ルール文字列を対象週の日付群と突合する。
// ルールは人間が記述する短い日本語文なので、汎用パーサーではなくキーワード一致で判定する
// （ルールが増えたらこのファイルにキーワード分岐を追加する。過度な一般化はしない）。

function matchesRecurringRule(rule, targetWeekDates) {
  const text = (rule && rule.rule) || '';
  const dates = (targetWeekDates || []).map(toDate);
  if (text.includes('第1金曜')) {
    return dates.some((d) => d.getUTCDay() === 5 && d.getUTCDate() <= 7);
  }
  if (text.includes('中旬')) {
    return dates.some((d) => d.getUTCDate() >= 10 && d.getUTCDate() <= 19);
  }
  return false;
}

function toDate(d) {
  if (d instanceof Date) return d;
  return new Date(`${d}T00:00:00Z`);
}

module.exports = { matchesRecurringRule };
