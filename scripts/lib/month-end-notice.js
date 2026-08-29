'use strict';
// 月末・四半期末・半期末の需給要因に関する注意喚起（task #82、しょうさん指示2026-08-29）。
// 対象週にロンドン市場基準の月末営業日が含まれるかを判定する純粋関数。外部ソースの実行時
// 取得は不要（config/gb-bank-holidays.json、GOV.UK公式データを既存のgb-bank-holidays.js/
// flash-pmi-schedule.jsと同じ形で静的に参照する）。
//
// 判定規則（しょうさん承認2026-08-29、初期案から2点修正済み）:
// - 月末営業日 = ロンドン市場（England and Wales区分）基準の当該月最終営業日。
//   暦上の最終日から、週末とEngland and Wales銀行休業日（GOV.UK公式bank-holidays.json）を
//   除いて遡る。ロンドンフィックス（WM/Reuters 4pm Fix）はロンドン市場で行われるため、
//   同市場が休みの日はフィックス自体が前営業日に移る（しょうさん指摘・修正1）
// - 3月・9月の月末営業日 → 半期末（最強）。日本の会計年度は4月始まりのため、3月末は年度末・
//   9月末は中間決算期にあたり、本邦機関投資家のリバランス規模が年間でも特に大きくなりやすい
//   （しょうさん指摘・修正2。読者が日本のEAユーザーである点を踏まえた基準）
// - 6月・12月の月末営業日 → 四半期末
// - それ以外 → 月末
//
// ロンドンフィックスは16:00 London時間で固定。tz-convert.jsのzonedWallTimeToJst()が
// Europe/LondonのIANA夏時間/冬時間を自動判定するため、BST/GMTの個別分岐は書かない
// （EU HICP時刻是正時と同じ方針）。16:00 Londonへ日本時間(UTC+9、DST無し)を足すと
// 常に24:00または25:00相当＝翌日0時台になるため、「翌」は常に成立する（分岐不要）。
//
// フェールクローズ: config/gb-bank-holidays.jsonの祝日データが対象週+1年分まで
// カバーしていない場合、不正確な判定で注意喚起を出すより「出さない」方を選ぶ
// （flash-pmi-schedule.js同様、この祝日configは年1回の手動更新が前提のため）。
const { gbBankHolidays, gbBankHolidaysMaxYear, isGbBusinessDay } = require('./gb-bank-holidays');
const { zonedWallTimeToJst } = require('./tz-convert');

const LONDON_FIX_HOUR = 16;

function pad2(n) {
  return String(n).padStart(2, '0');
}
function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function holidaySetForYear(y) {
  return new Set([...gbBankHolidays(y - 1), ...gbBankHolidays(y), ...gbBankHolidays(y + 1)]);
}

// 指定年月のロンドン市場基準・月末営業日（'YYYY-MM-DD'）を返す。祝日データのカバー不足時はnull
function monthEndBusinessDay(y, m) {
  if (gbBankHolidaysMaxYear() < y + 1) return null;
  const holidaySet = holidaySetForYear(y);
  const dim = daysInMonth(y, m);
  for (let d = dim; d >= 1; d--) {
    const ymd = `${y}-${pad2(m)}-${pad2(d)}`;
    if (isGbBusinessDay(ymd, holidaySet)) return ymd;
  }
  return null; // 理論上到達しない（月に1つも営業日が無いことはあり得ない）
}

// 月番号(1-12) → 内部識別子（データ属性・分岐用。表示文言はconfig/report-policy.json側で管理）
function tierForMonth(m) {
  if (m === 3 || m === 9) return 'half_end';
  if (m === 6 || m === 12) return 'quarter_end';
  return 'month_end';
}

// targetWeekStart/targetWeekEnd（'YYYY-MM-DD'）を受け取り、対象週にロンドン市場の月末営業日が
// 含まれていれば{date, month, tier, fixTimeJst:{date,time}}を返す。含まれなければnull。
// 週は月をまたいでも最大2ヶ月分のため、開始月・終了月の両方を候補として調べれば十分
// （1つの月末は1度しか発生せず、5日間の週が同時に2つの月末を含むことは構造上あり得ない）
function detectMonthEndNotice(targetWeekStart, targetWeekEnd) {
  const startY = Number(targetWeekStart.slice(0, 4));
  const startM = Number(targetWeekStart.slice(5, 7));
  const endY = Number(targetWeekEnd.slice(0, 4));
  const endM = Number(targetWeekEnd.slice(5, 7));

  const candidateMonths = startY === endY && startM === endM ? [[startY, startM]] : [[startY, startM], [endY, endM]];
  for (const [y, m] of candidateMonths) {
    const date = monthEndBusinessDay(y, m);
    if (date && date >= targetWeekStart && date <= targetWeekEnd) {
      const [dy, dm, dd] = date.split('-').map(Number);
      const fixTimeJst = zonedWallTimeToJst(dy, dm, dd, LONDON_FIX_HOUR, 0, 'Europe/London');
      return { date, month: m, tier: tierForMonth(m), fixTimeJst };
    }
  }
  return null;
}

module.exports = { monthEndBusinessDay, tierForMonth, detectMonthEndNotice };
