'use strict';
// 豪州準備銀行（RBA）board-meeting-schedules.htmlの抽出ルール（config/official-sources.json au_rba）。
// 実データ構造（2026-08-14実測fixtureで確認）: 年ごとに<caption>Board meeting schedules {年}</caption>を
// 持つ<table>があり、月ごとの<tr>に「Monetary Policy Board」列（例: "10&ndash;11 August"=2日間の会合、
// 決定発表は最終日）がある。会合が無い月は<th colspan="3">{月}</th>のみの行。
// 本ソースは年1回丸ごと公表される「年次スケジュールconfig型」（SPEC §3.5）のため、この抽出結果を
// config/official-sources.jsonのscheduleへ手動反映する運用とする（週次の自動再取得は行わない）。
const MONTH_NUM = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

// html: board-meeting-schedules.htmlの生テキスト
// 戻り値: { ok: true, meetings: [{ year, month, lastDay, date:'YYYY-MM-DD' }] } または { ok: false, reason }
function extractRbaMeetings(html) {
  const meetings = [];
  const captionRe = /<caption class="no-wrap">\s*Board meeting schedules (\d{4})\s*<\/caption>([\s\S]*?)<\/table>/g;
  let capM;
  while ((capM = captionRe.exec(html))) {
    const year = Number(capM[1]);
    const tableBody = capM[2];
    const rowRe = /<th scope="row">([A-Za-z]+)<\/th>\s*<td>([^<]*)<\/td>/g;
    let rowM;
    while ((rowM = rowRe.exec(tableBody))) {
      const month = rowM[1];
      const cell = rowM[2].replace(/&ndash;/g, '-').trim();
      if (!cell || !MONTH_NUM[month]) continue;
      const dayM = /(?:\d+-)?(\d+)\s+[A-Za-z]+/.exec(cell);
      if (!dayM) continue;
      const lastDay = Number(dayM[1]);
      meetings.push({ year, month, lastDay, date: `${year}-${pad2(MONTH_NUM[month])}-${pad2(lastDay)}` });
    }
  }
  if (meetings.length === 0) {
    return { ok: false, reason: 'board-meeting-schedules.htmlのMonetary Policy Board行が1件も見つからない。サイト構造変化の疑い' };
  }
  return { ok: true, meetings };
}

// meetings: extractRbaMeetings()のmeetings配列。smpMonths: 四半期報告(Statement on Monetary Policy)を
// 伴う月名（既定=公知のRBA運用: February/May/August/November。既刊ground truthはAugustのみ確認済みのため、
// 他3ヶ月は月曜FF事後突合での確認が必要という前提を呼び出し側のnotesに明記すること）
function buildRbaSchedule(meetings, smpMonths = ['February', 'May', 'August', 'November']) {
  const smpSet = new Set(smpMonths);
  const entries = [];
  for (const m of meetings) {
    entries.push({ date: m.date, kind: 'policy_rate' });
    entries.push({ date: m.date, kind: 'press_conference' });
    if (smpSet.has(m.month)) {
      entries.push({ date: m.date, kind: 'quarterly_report' });
    }
  }
  return entries;
}

module.exports = { extractRbaMeetings, buildRbaSchedule };
