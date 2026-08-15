'use strict';
// Ivey PMI（iveypmi.uwo.ca/faq/）の抽出ルール（config/official-sources.json ca_ivey）。
// 実データ構造（2026-08-14実測fixtureで確認）: FAQページ本文に平文で
// 「Index Release Dates in {年} are: January 7, February 6, ..., December 4」という
// 年間発表日一覧が直接埋め込まれている（ISMのような自動取得ブロックなし）。
const MONTH_NUM = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

// html: faq.htmlの生テキスト
// 戻り値: { ok: true, schedule: [{date:'YYYY-MM-DD', kind:'pmi_ism'}], year } または { ok: false, reason }
function extractIveySchedule(html) {
  const m = /Index Release Dates in (\d{4}) are:\s*(?:<\/strong>)?\s*([^<]+)/.exec(html);
  if (!m) {
    return { ok: false, reason: 'FAQページに年間発表日一覧の文言（"Index Release Dates in {年} are:"）が見つからない。サイト構造変化の疑い' };
  }
  const year = Number(m[1]);
  const items = m[2].split(',').map((s) => s.trim()).filter(Boolean);
  const schedule = [];
  for (const item of items) {
    const dm = /^([A-Za-z]+)\s+(\d{1,2})/.exec(item);
    if (!dm) continue;
    const monthNum = MONTH_NUM[dm[1]];
    if (!monthNum) continue;
    schedule.push({ date: `${year}-${pad2(monthNum)}-${pad2(Number(dm[2]))}`, kind: 'pmi_ism' });
  }
  if (schedule.length === 0) {
    return { ok: false, reason: '発表日一覧の文言は見つかったが日付を1件も抽出できなかった。表記形式の変化の疑い' };
  }
  return { ok: true, year, schedule };
}

module.exports = { extractIveySchedule };
