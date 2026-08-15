'use strict';
// 米国勢調査局（Census Bureau）calendar-listview.htmlの抽出ルール（SPEC §3.1・config/official-sources.json us_census）。
// 実データ構造（2026-08-14実測fixtureで確認）: <tr height="20"> 1件=1リリースの表。
//   <td><a href="...">タイトル</a></td>
//   <td sorttable_customkey="YYYYMMDDHHmm">Month D, YYYY</td>  ← 発表日時（現地時間・分単位まで確定）
//   <td>H:MM AM/PM</td>
//   <td>対象期間（例: June 2026）</td>
// sorttable_customkey が exact な年月日時分を持つため、これを正として使う（人間可読日付は照合用）。
const ROW_RE = /<tr height="20">([\s\S]*?)<\/tr>/g;
const TITLE_RE = /<a[^>]*>([^<]+)<\/a>/;
const CUSTOMKEY_RE = /sorttable_customkey="(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})"/;
const PERIOD_RE = /<td>([A-Za-z]+ \d{4})<\/td>/;

// html: calendar-listview.htmlの生テキスト
// 戻り値: { ok: true, rows: [{ title, date:'YYYY-MM-DD', localTime:'HH:MM', period }] } または
//         { ok: false, reason } （テーブル行が1件も見つからない＝構造変化の疑い）
function extractCensusCalendar(html) {
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
  return { ok: true, rows };
}

module.exports = { extractCensusCalendar };
