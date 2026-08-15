'use strict';
// 英国（England and Wales区分）銀行休業日の判定。task #53（2026-08-15、しょうさん承認済み規則）:
// EU/GB/DEフラッシュPMI（S&P Global）の「月末5営業日前」規則は、営業日から週末に加えてこの
// 祝日も除外して初めて過去24ヶ月（2024年通年＋2025-08〜2026-07）中23ヶ月で厳密一致する
// （残り1ヶ月＝12月は別枠の意図的例外。scripts/lib/flash-pmi-schedule.js参照）。
// 戴冠式・国葬・ジュビリー等の一回限りの祝日はus-federal-holidays.jsのような固定振替ルールでは
// 算出不能（政府が都度決定するため）なので、config/gb-bank-holidays.json（GOV.UK公式
// bank-holidays.json、静的JSON、年1回手動更新）を読む方式にした。
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const CONFIG_PATH = join(__dirname, '..', '..', 'config', 'gb-bank-holidays.json');

let cachedConfig = null;
function loadConfig() {
  if (!cachedConfig) {
    cachedConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  }
  return cachedConfig;
}

// 指定年（およびその前後1年、月末またぎの計算で隣接年の祝日が要るため呼び出し側が必要な年を渡す）の
// England and Wales銀行休業日一覧（'YYYY-MM-DD'）を返す
function gbBankHolidays(year) {
  const cfg = loadConfig();
  return cfg.events.filter((e) => e.date.startsWith(String(year))).map((e) => e.date);
}

// config/gb-bank-holidays.jsonがカバーしている最終年を返す（残量監視・テスト用）
function gbBankHolidaysMaxYear() {
  const cfg = loadConfig();
  let max = 0;
  for (const e of cfg.events) {
    const y = Number(e.date.slice(0, 4));
    if (y > max) max = y;
  }
  return max;
}

function dayOfWeek(ymdStr) {
  const [y, m, d] = ymdStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
}

function isGbBusinessDay(ymdStr, holidaySet) {
  const dow = dayOfWeek(ymdStr);
  if (dow === 0 || dow === 6) return false;
  return !holidaySet.has(ymdStr);
}

module.exports = { gbBankHolidays, gbBankHolidaysMaxYear, isGbBusinessDay };
