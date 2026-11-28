'use strict';
// 中国の法定祝日（国务院办公厅の年次通知）の判定。2026-11-28新設（しょうさん依頼: 中国RatingDog
// 製造業PMIの自動取得化）。春節・中秋節などは旧暦依存で、さらに调休（振替出勤）が政府の年次通知で
// 都度決まるため、us-federal-holidays.jsのような固定ルールでは計算できない。そのため
// gb-bank-holidays.jsと同じく静的JSON（config/cn-public-holidays.json、年1回手動更新）を読む方式にした。
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const CONFIG_PATH = join(__dirname, '..', '..', 'config', 'cn-public-holidays.json');

let cachedConfig = null;
function loadConfig() {
  if (!cachedConfig) {
    cachedConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  }
  return cachedConfig;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// 'YYYY-MM-DD'のstart〜end（両端含む）を1日ずつ展開する
function expandRange(start, end) {
  const out = [];
  const [ys, ms, ds] = start.split('-').map(Number);
  const cur = new Date(Date.UTC(ys, ms - 1, ds));
  const [ye, me, de] = end.split('-').map(Number);
  const last = Date.UTC(ye, me - 1, de);
  while (cur.getTime() <= last) {
    out.push(`${cur.getUTCFullYear()}-${pad2(cur.getUTCMonth() + 1)}-${pad2(cur.getUTCDate())}`);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

// 指定年の放假日（週末を含む連続休暇の全日、'YYYY-MM-DD'）を返す。データが無い年はnull
// （空配列と区別する: 「祝日が無い」のではなく「まだ通知が無い／未登録」なので、呼び出し側は
// 推測で埋めずにnullを返す＝フェールクローズにする）
function cnPublicHolidays(year) {
  const entry = loadConfig().years.find((y) => y.year === year);
  if (!entry) return null;
  return entry.holidays.flatMap((h) => expandRange(h.start, h.end));
}

// config/cn-public-holidays.jsonがカバーしている最終年
function cnPublicHolidaysMaxYear() {
  return Math.max(...loadConfig().years.map((y) => y.year));
}

module.exports = { cnPublicHolidays, cnPublicHolidaysMaxYear };
