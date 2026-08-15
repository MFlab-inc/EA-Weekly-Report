'use strict';
// BOE（Monetary Policy Committee）政策金利カレンダーの抽出（task #19）。
// upcoming_mpc_dates.htmlは<h2>{年} confirmed/provisional dates</h2>に続く<table>に
// <tr><td>Thursday 5 February</td><td>...</td></tr>という行を持つ（年は見出し由来、
// セル自体には年が無い）。&nbsp;混入・曜日プレフィックスに対応する。

const MONTHS = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

function extractBoePolicyRateSchedule(html) {
  const headingRe = /<h2>(\d{4}) (?:confirmed|provisional) dates<\/h2>\s*<table>([\s\S]*?)<\/table>/g;
  const entries = [];
  let headingM;
  while ((headingM = headingRe.exec(html)) !== null) {
    const year = Number(headingM[1]);
    const tableBody = headingM[2];
    const rowRe = /<tr>\s*<td>([^<]+)<\/td>/g;
    let rowM;
    while ((rowM = rowRe.exec(tableBody)) !== null) {
      const cellText = rowM[1].replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      const m = /^(?:[A-Za-z]+)\s+(\d{1,2})\s+([A-Za-z]+)$/.exec(cellText);
      if (!m) continue;
      const day = Number(m[1]);
      const month = MONTHS[m[2]];
      if (!month) continue;
      const date = `${year}-${pad2(month)}-${pad2(day)}`;
      entries.push({ date, kind: 'policy_rate' });
    }
  }
  if (entries.length === 0) {
    return { ok: false, reason: '年別見出し（confirmed/provisional dates）配下のtable行が1件も見つからない。サイト構造変化の疑い' };
  }
  return { ok: true, entries };
}

module.exports = { extractBoePolicyRateSchedule };
