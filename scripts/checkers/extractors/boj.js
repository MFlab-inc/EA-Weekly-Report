'use strict';
// 日本銀行（BOJ）mpm_index.htmlの抽出ルール（config/official-sources.json jp_boj）。
// 実データ構造（2026-08-14実測fixtureで確認）: 年ごとの<table>（<caption>Table : {年}</caption>）に
// 「Date of MPM / Outlook Report / Summary of Opinions / MPM Minutes」列を持つ<tbody><tr>群がある。
// 各セルは <a href="...">Mon. D (Day.), [YYYY] [PDF ...]</a> または確定前は "Mon. D (Day.)" のプレーンテキスト、
// 未定は "-"。「Summary of Opinions」「MPM Minutes」列の日付を抽出する（Outlook Reportは対象外＝
// SPEC上のkind未定義のため）。年またぎ表記（例: "Jan. 27 (Wed.), 2027"）にも対応する。
// 本ソースはPDFよりHTML(mpm_index.htm)の方が構造的に安定して抽出しやすいため、こちらを正とする。
const MONTH_ABBR = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, June: 6, Jun: 6,
  July: 7, Jul: 7, Aug: 8, Sept: 9, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

// cellText: 例 "Aug. 5 (Wed.) [PDF 313KB]" や "Jan. 27 (Wed.), 2027" や "-"
// defaultYear: セル内に年表記が無い場合に使う年（テーブルの<caption>由来）
function parseCellDate(cellText, defaultYear) {
  const text = cellText.replace(/\s+/g, ' ').trim();
  if (!text || text === '-') return null;
  const m = /^([A-Za-z]+)\.?\s+(\d{1,2})\s*\([A-Za-z]+\.?\)(?:,\s*(\d{4}))?/.exec(text);
  if (!m) return null;
  const monthNum = MONTH_ABBR[m[1]];
  if (!monthNum) return null;
  const day = Number(m[2]);
  const year = m[3] ? Number(m[3]) : defaultYear;
  return `${year}-${pad2(monthNum)}-${pad2(day)}`;
}

// html: mpm_index.htmlの生テキスト
// 戻り値: { ok: true, entries: [{ date, kind: 'opinions_summary'|'minutes_summary' }] } または { ok: false, reason }
function extractBojSchedule(html) {
  const entries = [];
  const tableRe = /<table>\s*<caption class="non-caption">Table\s*:\s*(\d{4})<\/caption>([\s\S]*?)<\/table>/g;
  let tableM;
  while ((tableM = tableRe.exec(html))) {
    const captionYear = Number(tableM[1]);
    const body = tableM[2];
    const rowRe = /<tr>\s*<td>(?:<a[^>]*>)?([^<]+?)(?:<\/a>)?<\/td>\s*<td>(?:<a[^>]*>)?([^<]*?)(?:<\/a>)?<\/td>\s*<td>(?:<a[^>]*>)?([^<]*?)(?:<\/a>)?<\/td>\s*<td>(?:<a[^>]*>)?([^<]*?)(?:<\/a>)?<\/td>\s*<\/tr>/g;
    let rowM;
    while ((rowM = rowRe.exec(body))) {
      // 列: [1]=Date of MPM(未使用) [2]=Outlook Report(未使用) [3]=Summary of Opinions [4]=MPM Minutes
      const opinionsDate = parseCellDate(rowM[3], captionYear);
      const minutesDate = parseCellDate(rowM[4], captionYear);
      if (opinionsDate) entries.push({ date: opinionsDate, kind: 'opinions_summary' });
      if (minutesDate) entries.push({ date: minutesDate, kind: 'minutes_summary' });
    }
  }
  if (entries.length === 0) {
    return { ok: false, reason: 'mpm_index.htmlのRelease Scheduleテーブル行が1件も見つからない。サイト構造変化の疑い' };
  }
  return { ok: true, entries };
}

module.exports = { extractBojSchedule };
