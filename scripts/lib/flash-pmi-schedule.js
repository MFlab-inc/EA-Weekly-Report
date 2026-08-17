'use strict';
// EU/GB/DEフラッシュPMI（S&P Global/HCOB Flash Manufacturing & Services PMI）の年次スケジュール
// ドラフト自動生成。task #53（2026-08-15、しょうさん承認済み規則）:
//
//   規則: 月末から5営業日前。営業日は週末＋England and Wales銀行休業日（GOV.UK公式データ、
//   config/gb-bank-holidays.json）を除外。
//
// 検証: 独立した3経路（WebSearch研究agent×3・GOV.UK公式データでの機械計算×2年分）で
// 2024年通年＋2025年8月〜2026年7月の直近24ヶ月を突合し、23/24ヶ月で厳密一致。
// DE/EU/GBの3ヶ国は毎月同一暦日に発表される（S&P Globalが単一カレンダーで運用している
// ことが示唆される。データはEngland and Wales祝日で説明できるため「英国基準」と定式化）。
//
// 唯一の例外は12月: クリスマス休暇を避けるため意図的に大きく前倒しされる（2024-12-16・
// 2025-12-16と過去2年とも同日）。この前倒し幅には上記規則のような機械的パターンが
// 見出せなかったため、12月は自動生成せずnullを返す（呼び出し側が別途、過去実績や
// 年次手動確認で確定させる。docs/annual-schedule-maintenance.md参照）。
//
// ISM（scripts/lib/ism-schedule.js）と同じ設計: このモジュールはオフラインでドラフトを
// 生成するためのものであり、ランタイムのharness.mjsからは呼ばれない
// （config/official-sources.jsonのschedule配列に人間が値を書き写し、年1回目視確認する運用）。
const { gbBankHolidays, isGbBusinessDay } = require('./gb-bank-holidays');

function pad2(n) {
  return String(n).padStart(2, '0');
}
function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// 指定日の翌日から月末まで（両端の扱い: 指定日は含まない・月末は含む）の営業日数
function gbBusinessDaysBeforeMonthEnd(y, m, d, holidaySet) {
  const dim = daysInMonth(y, m);
  let count = 0;
  for (let dd = d + 1; dd <= dim; dd++) {
    if (isGbBusinessDay(`${y}-${pad2(m)}-${pad2(dd)}`, holidaySet)) count++;
  }
  return count;
}

// 指定年月における「月末からn英国営業日前」の日付を返す（無ければnull）。
// 「d翌日〜月末の営業日数」は週末・祝日の直前で足踏み（同じ値が連続）するため、
// d自身も営業日であることを条件に含めないと、週末側の日付を誤って返してしまう
// （例: 金曜が正解の月でも、直後の土日は「金曜と同じ足踏み値」を持つため判定に必要）
function nthGbBusinessDayBeforeMonthEnd(y, m, n, holidaySet) {
  const dim = daysInMonth(y, m);
  for (let d = dim; d >= 1; d--) {
    const ymd = `${y}-${pad2(m)}-${pad2(d)}`;
    if (!isGbBusinessDay(ymd, holidaySet)) continue;
    if (gbBusinessDaysBeforeMonthEnd(y, m, d, holidaySet) === n) {
      return ymd;
    }
  }
  return null;
}

// 指定年のEngland and Wales銀行休業日セット（月末またぎの計算に備え前後1年分も含める）
function holidaySetForYear(y) {
  return new Set([...gbBankHolidays(y - 1), ...gbBankHolidays(y), ...gbBankHolidays(y + 1)]);
}

// 指定年月のフラッシュPMIドラフト日を返す。12月はnull（手動確定が必要、規則性なし）
function flashPmiDraftForMonth(y, m) {
  if (m === 12) return null;
  const holidaySet = holidaySetForYear(y);
  return nthGbBusinessDayBeforeMonthEnd(y, m, 5, holidaySet);
}

// startYear/startMonthからmonthCountヶ月分のドラフトをまとめて返す（12月はskip）
function flashPmiDraftRange(startYear, startMonth, monthCount) {
  const out = [];
  let y = startYear;
  let m = startMonth;
  for (let i = 0; i < monthCount; i++) {
    const date = flashPmiDraftForMonth(y, m);
    if (date) out.push({ year: y, month: m, date });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

module.exports = {
  gbBusinessDaysBeforeMonthEnd,
  nthGbBusinessDayBeforeMonthEnd,
  flashPmiDraftForMonth,
  flashPmiDraftRange,
};
