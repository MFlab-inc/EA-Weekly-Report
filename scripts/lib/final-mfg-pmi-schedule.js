'use strict';
// S&P Global系の月初「製造業PMI（確報・本体）」の年次スケジュールドラフト自動生成。
// 2026-11-28新設（しょうさん依頼「自動で拾う仕組みづくりをおねがい！」）。対象は次の2系列:
//
//   (1) 米S&P Global製造業PMI【確報値】（us_sp_final_mfg_pmi、09:45 ET）
//   (2) 中国RatingDog(旧財新)製造業PMI（cn_pmi、09:45 北京時間）
//
// 一次情報源（pmi.spglobal.comの発表カレンダー）はrobots.txt自体がHTTP 403でGitHub Actionsからも
// 到達不可（us_flash_pmi・cn_pmiのnotes参照）。そのため、フラッシュPMI（flash-pmi-schedule.js）と
// 同じく「過去実績で検証した規則からドラフトを計算し、config/official-sources.jsonのschedule配列へ
// 書き写す」方式とする。このモジュールはランタイムのharness.mjsからは呼ばれない。
//
// 検証データ（2024-01〜2026-11の35ヶ月×2系列、WebSearch研究agentが報道各社の記事日付・URLの
// タイムスタンプ・S&P Global発表文のエンバーゴ表記から確認、全件confidence=high）は
// test/final-mfg-pmi-schedule.test.jsのVERIFIED_ACTUALSに残している。
const { businessDaysOfMonth } = require('./ism-schedule');
const { cnPublicHolidays } = require('./cn-public-holidays');

function pad2(n) {
  return String(n).padStart(2, '0');
}
function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function dayOfWeek(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
}

// (1) 米国: 月の第1営業日（土日＋米連邦祝日を除く）。35/35ヶ月で一致（ISM製造業と同日）。
// 例: 2024-09は9/2がLabor Dayのため9/3、2026-01は1/1が元日のため1/2
function usFinalMfgPmiDraftForMonth(y, m) {
  return businessDaysOfMonth(y, m)[0] || null;
}

// (2) 中国: 指定年月(y, m)の月初に行われる発表（＝前月分）の日付を返す。
//
//   a. 候補日 = 月の最初の平日（月〜金。1月は全世界共通の休日である1/1を除く）。S&P Globalの
//      各国製造業PMIは同じ日にそろって出るのが基本で、中国もこの日に出る
//   b. 候補日が中国の法定祝日でなければ、候補日がそのまま発表日
//   c. 候補日が祝日で、かつ5月（劳动节）・10月（国庆节）なら、前月の最終平日（祝日除く）に
//      前倒し（2024〜2026年の3年×2回、計6回すべて4/30・9/30に前倒しされた）
//   d. それ以外の祝日（元旦・春节・端午节など）に候補日が重なる場合はnull（自動では決めない）。
//      過去の実績が前倒し（2025-12-31）・後ろ倒し（2025-06-03）・祝日中でもそのまま（2025-02-03）
//      とばらばらで、規則が作れないため。人が発表カレンダーで確認して登録する
//   e. 祝日データ（config/cn-public-holidays.json）が無い年もnull（推測で埋めない）
//
// 既知の例外: 2026年3月は候補日3/2（月）に対して実際は3/4（水）だった（理由不明。S&P Global
// 発表文のエンバーゴ表記で確認済み）。同種のずれが再発しうるため、土曜監査で外部カレンダーと
// 突合する運用は変えない
function cnRatingDogMfgPmiDraftForMonth(y, m) {
  const holidays = cnPublicHolidays(y);
  if (!holidays) return null;
  const holidaySet = new Set(holidays);

  let candidate = null;
  for (let d = 1; d <= 7; d++) {
    const dow = dayOfWeek(y, m, d);
    if (dow === 0 || dow === 6) continue;
    if (m === 1 && d === 1) continue;
    candidate = `${y}-${pad2(m)}-${pad2(d)}`;
    break;
  }
  if (!holidaySet.has(candidate)) return candidate;
  if (m !== 5 && m !== 10) return null;

  const pm = m - 1; // 5月→4月、10月→9月（いずれも同年）
  for (let d = daysInMonth(y, pm); d >= 1; d--) {
    const dow = dayOfWeek(y, pm, d);
    const ymd = `${y}-${pad2(pm)}-${pad2(d)}`;
    if (dow !== 0 && dow !== 6 && !holidaySet.has(ymd)) return ymd;
  }
  return null;
}

// startYear/startMonthからmonthCountヶ月分のドラフトをまとめて返す。
// null（自動で決めない月）は date:null のまま残し、呼び出し側が「要確認の月」として扱えるようにする
function finalMfgPmiDraftRange(startYear, startMonth, monthCount) {
  const out = [];
  let y = startYear;
  let m = startMonth;
  for (let i = 0; i < monthCount; i++) {
    out.push({
      year: y,
      month: m,
      us: usFinalMfgPmiDraftForMonth(y, m),
      cn: cnRatingDogMfgPmiDraftForMonth(y, m),
    });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

module.exports = { usFinalMfgPmiDraftForMonth, cnRatingDogMfgPmiDraftForMonth, finalMfgPmiDraftRange };
