'use strict';
// FRB（連邦公開市場委員会=FOMC）政策金利カレンダーの抽出（task #19）。
// fomccalendars.htmは年ごとのpanel（<h4><a id="...">{年} FOMC Meetings</a></h4>）に
// month+date-rangeのmeeting blockを持つ。決定発表日は各会合の最終日
// （例:"27-28"→28日。月をまたぐ会合は既存の実データでは確認されていない）。
// FRBは2019年以降、全会合後に記者会見を実施する運用のため、ページの
// 「Press Conference」リンク有無には頼らない（未来会合はリンク自体が空プレースホルダで
// 埋まっており、ページから検出できないため）。policy_rate・press_conferenceの両kindを
// 常に付与する。"*"は「Summary of Economic Projections」該当会合（四半期報告相当）を示す。
const MONTHS = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

function extractFrbPolicyRateSchedule(html) {
  const panels = [...html.matchAll(/<h4><a id="\d+">(\d{4}) FOMC Meetings<\/a><\/h4>/g)];
  if (panels.length === 0) {
    return { ok: false, reason: '年別panel見出しが見つからない。サイト構造変化の疑い' };
  }
  const entries = [];
  for (let i = 0; i < panels.length; i++) {
    const year = Number(panels[i][1]);
    const start = panels[i].index;
    const end = i + 1 < panels.length ? panels[i + 1].index : html.length;
    const section = html.slice(start, end);
    const blocks = section.split(/(?=<div class="(?:fomc-meeting--shaded )?row fomc-meeting")/);
    for (const block of blocks.slice(1)) {
      const monthM = /fomc-meeting__month[^>]*><strong>([A-Za-z]+)<\/strong>/.exec(block);
      const dateM = /fomc-meeting__date[^>]*>([^<]+)<\/div>/.exec(block);
      if (!monthM || !dateM) continue;
      const month = MONTHS[monthM[1]];
      if (!month) continue;
      const dateText = dateM[1].trim();
      const isSep = dateText.includes('*');
      const dayMatch = /(\d{1,2})(?:-(\d{1,2}))?/.exec(dateText);
      if (!dayMatch) continue;
      const lastDay = Number(dayMatch[2] || dayMatch[1]);
      const date = `${year}-${pad2(month)}-${pad2(lastDay)}`;
      entries.push({ date, kind: 'policy_rate' });
      entries.push({ date, kind: 'press_conference' });
      if (isSep) entries.push({ date, kind: 'quarterly_report', note: 'Summary of Economic Projections公表会合' });
    }
  }
  if (entries.length === 0) {
    return { ok: false, reason: '会合日が1件も抽出できない。サイト構造変化の疑い' };
  }
  return { ok: true, entries };
}

module.exports = { extractFrbPolicyRateSchedule };
