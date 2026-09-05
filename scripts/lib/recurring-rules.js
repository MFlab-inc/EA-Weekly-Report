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
  // "10日〜16日"のような日範囲ルール（"中旬"より精密な指定。しょうさん指摘2026-08-15:
  // 「中旬」の10〜19日は実際の発表日（例: 米CPIは概ね10〜15日、既刊実績は8/12）より広すぎ、
  // 対象外の週（例: 8/17〜21）で誤検知するため、日範囲を明示できるこの記法を優先する）
  const dayRangeMatch = text.match(/(\d{1,2})日[〜~](\d{1,2})日/);
  // 月列挙と日範囲の両方を含むルール（例: "3月・6月・9月・12月の1日〜5日ごろ"、task #87の
  // 豪州GDP/貿易収支向け）は、四半期末等の特定の月かつその月内の特定の日範囲、というAND条件として
  // 扱う（しょうさん指摘: ABSの掲載horizonが直近1ヶ月強のみのため、対象月×対象日の両方を
  // 満たす週でのみWARNしたい。片方だけの既存ルールとは意味が異なるため、両方存在する場合のみ
  // AND判定へ切り替える。既存ルール[月のみ／日範囲のみ]の挙動は変えない）
  if (monthMatches.length > 0 && dayRangeMatch) {
    const startDay = Number(dayRangeMatch[1]);
    const endDay = Number(dayRangeMatch[2]);
    return dates.some((d) => monthMatches.includes(d.getUTCMonth() + 1) && d.getUTCDate() >= startDay && d.getUTCDate() <= endDay);
  }
  if (monthMatches.length > 0) {
    return dates.some((d) => monthMatches.includes(d.getUTCMonth() + 1));
  }
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
  // "毎週"（例: 米新規失業保険申請件数、task #89）は祝日でずれる週はあっても対象週の判定自体は
  // 常にtrue（曜日を問わずどの週にも該当する）。祝日でその週自体が発表されない場合の欠落は
  // 「該当見込みだが検出なし」のWARNとして許容する（しょうさん方針: 見落とし防止を優先し、
  // 稀な誤検知[祝日で本当に発表が無かった週のWARN]は許容する）
  if (text.includes('毎週')) {
    return true;
  }
  return false;
}

function toDate(d) {
  if (d instanceof Date) return d;
  return new Date(`${d}T00:00:00Z`);
}

module.exports = { matchesRecurringRule };
