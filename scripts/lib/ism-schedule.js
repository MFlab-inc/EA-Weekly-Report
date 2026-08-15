'use strict';
// ISM年次スケジュールのドラフト自動生成（SPEC §3.5・docs/phase1-official-sources.md §5-4）。
// ISM公式サイトはCAPTCHAのため自動スクレイピング不可のため、ルール計算によるドラフトを
// 生成し、しょうさんまたはClaude Codeが年1回、公式カレンダーページと目視突合・確定する運用とする。
// ルール: 製造業PMI=毎月第1営業日、非製造業(Services)PMI=毎月第3営業日、いずれも米東部時間10:00。
// 「営業日」は土日＋米連邦祝日（振替済み）を除いた日。
const { usFederalHolidays, isUsBusinessDay } = require('./us-federal-holidays');

function pad2(n) {
  return String(n).padStart(2, '0');
}
function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// 指定年月の営業日一覧（'YYYY-MM-DD'昇順）を返す
function businessDaysOfMonth(y, m) {
  const holidaySet = new Set([...usFederalHolidays(y), ...usFederalHolidays(y - 1), ...usFederalHolidays(y + 1)]);
  const out = [];
  for (let d = 1; d <= daysInMonth(y, m); d++) {
    const ymd = `${y}-${pad2(m)}-${pad2(d)}`;
    if (isUsBusinessDay(ymd, holidaySet)) out.push(ymd);
  }
  return out;
}

// 指定年月のISMドラフト（製造業=第1営業日、非製造業=第3営業日）を返す
function ismDraftForMonth(y, m) {
  const bdays = businessDaysOfMonth(y, m);
  return [
    { kind: 'pmi_ism', subtype: 'manufacturing', date: bdays[0] || null },
    { kind: 'pmi_ism', subtype: 'services', date: bdays[2] || null },
  ].filter((e) => e.date);
}

// startYear/startMonthからmonthCountヶ月分のドラフトをまとめて返す（例: 直近2ヶ月分）
function ismDraftRange(startYear, startMonth, monthCount) {
  const out = [];
  let y = startYear;
  let m = startMonth;
  for (let i = 0; i < monthCount; i++) {
    out.push(...ismDraftForMonth(y, m));
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

module.exports = { businessDaysOfMonth, ismDraftForMonth, ismDraftRange };
