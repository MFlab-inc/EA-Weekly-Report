'use strict';
// config/importance-rules.json の recurring_checks ルール文字列を対象週の日付群と突合する。
// ルールは人間が記述する短い日本語文なので、汎用パーサーではなくキーワード一致で判定する
// （ルールが増えたらこのファイルにキーワード分岐を追加する。過度な一般化はしない）。

function matchesRecurringRule(rule, targetWeekDates) {
  const text = (rule && rule.rule) || '';
  const dates = (targetWeekDates || []).map(toDate);
  // "2月・8月"のような月列挙ルール（担当ソース未定義の年2回イベント向け。例: RBA総裁の
  // 議会証言）。日付までは特定できないため月内の全週でWARNが出る（粒度が粗い点は既知の限界）
  const monthMatches = [...text.matchAll(/(\d{1,2})月/g)].map((m) => Number(m[1]));
  if (monthMatches.length > 0) {
    return dates.some((d) => monthMatches.includes(d.getUTCMonth() + 1));
  }
  // "10日〜16日"のような日範囲ルール（"中旬"より精密な指定。しょうさん指摘2026-08-15:
  // 「中旬」の10〜19日は実際の発表日（例: 米CPIは概ね10〜15日、既刊実績は8/12）より広すぎ、
  // 対象外の週（例: 8/17〜21）で誤検知するため、日範囲を明示できるこの記法を優先する）
  const dayRangeMatch = text.match(/(\d{1,2})日[〜~](\d{1,2})日/);
  if (dayRangeMatch) {
    const startDay = Number(dayRangeMatch[1]);
    const endDay = Number(dayRangeMatch[2]);
    return dates.some((d) => d.getUTCDate() >= startDay && d.getUTCDate() <= endDay);
  }
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
