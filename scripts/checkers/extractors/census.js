'use strict';
// 米国勢調査局（Census Bureau）calendar-listview.htmlの抽出ルール（SPEC §3.1・config/official-sources.json us_census）。
// 実データ構造（2026-08-14実測fixtureで確認）: <tr height="20"> 1件=1リリースの表。
//   <td><a href="...">タイトル</a></td>
//   <td sorttable_customkey="YYYYMMDDHHmm">Month D, YYYY</td>  ← 発表日時（現地時間・分単位まで確定）
//   <td>H:MM AM/PM</td>
//   <td>対象期間（例: June 2026）</td>
// sorttable_customkey が exact な年月日時分を持つため、これを正として使う（人間可読日付は照合用）。
const { addDays, parseYmd, formatYmd } = require('../../lib/dates');

const ROW_RE = /<tr height="20">([\s\S]*?)<\/tr>/g;
const TITLE_RE = /<a[^>]*>([^<]+)<\/a>/;
const CUSTOMKEY_RE = /sorttable_customkey="(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})"/;
const PERIOD_RE = /<td>([A-Za-z]+ \d{4})<\/td>/;

// 2026-10-12追加（しょうさん指摘、米小売売上高欠落インシデントの真因判明）: calendar-listview.html
// 自体が、ある時点で「翌年の予定表」へ切り替わる（実測: 2026-09-19時点のfixtureは2026年の
// 行を含んでいたが、2026-10-12時点のライブページは164行すべてが2027年の行で、2026年の行が
// 1件も無かった）。このロールオーバーは行数が0になるわけではないため、既存の
// 「rows.length===0＝構造的失敗」判定では検知できない。対象週の前後（4週前〜8週後）に
// 該当する行が1件も無い場合も、別の年を表示している疑いとして構造的失敗にする
const NEARBY_WINDOW_BEFORE_DAYS = 28; // 4週前
const NEARBY_WINDOW_AFTER_DAYS = 56; // 8週後

// html: calendar-listview.htmlの生テキスト
// targetWeek: { targetWeekStart, targetWeekEnd }（省略可。省略時は年ロールオーバー検知を行わない。
//   checkWeeklyScrapeSourceが渡すparseCtxの第2引数で受け取る）
// 戻り値: { ok: true, rows: [{ title, date:'YYYY-MM-DD', localTime:'HH:MM', period }] } または
//         { ok: false, reason } （テーブル行が1件も見つからない、または対象週近辺の行が1件も
//         無い＝別の年を表示している疑い。いずれもサイト構造変化系の構造的失敗）
function extractCensusCalendar(html, targetWeek) {
  const rows = [];
  let m;
  ROW_RE.lastIndex = 0;
  while ((m = ROW_RE.exec(html))) {
    const block = m[1];
    const titleM = TITLE_RE.exec(block);
    const keyM = CUSTOMKEY_RE.exec(block);
    if (!titleM || !keyM) continue;
    const [, y, mo, d, h, mi] = keyM;
    const periodM = PERIOD_RE.exec(block);
    rows.push({
      title: titleM[1].trim(),
      date: `${y}-${mo}-${d}`,
      localTime: `${h}:${mi}`,
      period: periodM ? periodM[1] : null,
    });
  }
  if (rows.length === 0) {
    return { ok: false, reason: 'calendar-listview.htmlのテーブル行(<tr height="20">)が1件も見つからない。サイト構造変化の疑い' };
  }
  if (targetWeek?.targetWeekStart && targetWeek?.targetWeekEnd) {
    const windowStart = formatYmd(addDays(parseYmd(targetWeek.targetWeekStart), -NEARBY_WINDOW_BEFORE_DAYS));
    const windowEnd = formatYmd(addDays(parseYmd(targetWeek.targetWeekEnd), NEARBY_WINDOW_AFTER_DAYS));
    const hasNearbyRow = rows.some((r) => r.date >= windowStart && r.date <= windowEnd);
    if (!hasNearbyRow) {
      const min = rows.reduce((a, r) => (a === null || r.date < a ? r.date : a), null);
      const max = rows.reduce((a, r) => (a === null || r.date > a ? r.date : a), null);
      return {
        ok: false,
        reason: `ページに対象週(${targetWeek.targetWeekStart}〜${targetWeek.targetWeekEnd})の4週前〜8週後(${windowStart}〜${windowEnd})に該当する行が1件も無い（実測: 全${rows.length}行の日付範囲は${min}〜${max}）。別の年を表示している疑い（2026-10-12実測: calendar-listview.htmlが2027年の予定表へ切り替わっており、2026年の行が0件だったことが原因と判明）`,
      };
    }
  }
  return { ok: true, rows };
}

module.exports = { extractCensusCalendar };
