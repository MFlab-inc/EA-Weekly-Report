#!/usr/bin/env node
// PR #47フォローアップ（しょうさん指示2026-10-12）の調査用一時スクリプト。
// 監査記録として残す（.github/workflows/census-recon.ymlは調査完了後に削除する運用、
// committees-events-recon等の既存の一時recon方針を踏襲）。
//
// 背景: 前回の調査（census-recon-2026-10-12.mjs）でcalendar-listview.htmlの現在のライブ状態が
// 2027年の日付のみ（2027-01-04〜2027-12-27）になっていることを発見した。しょうさん指摘により
// 「実行環境の実時刻が2026年を過ぎている」という当初の誤った説明を訂正し、「calendar-listview.html
// 自体が10月に入って翌年の予定表へ切り替わった」という、より妥当な仮説を検証する。
//
// 目的:
// 1. calendar-listview.htmlの現在の164行について、年ごとの件数・全体の最小/最大日付を確認する
//    （2026年の行が1件も無いかどうかを確認する）
// 2. foreign-trade/reference/release_schedule.html（Census公式の貿易統計年間発表予定）を取得し、
//    us_census_trade_balance（annual_schedule_config）登録のための生テキストを残す
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extractCensusCalendar } = require('../checkers/extractors/census.js');

const OUT_DIR = 'phase1-out/census-recon-year-rollover';

function stripHtmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const result = { fetchedAt: new Date().toISOString() };

  // --- 1. calendar-listview.html の年別内訳 ---
  try {
    const res = await fetch('https://www.census.gov/economic-indicators/calendar-listview.html');
    result.calendarListview = { httpStatus: res.status, ok: res.ok };
    if (res.ok) {
      const html = await res.text();
      writeFileSync(`${OUT_DIR}/calendar-listview.html`, html);
      const parsed = extractCensusCalendar(html);
      result.calendarListview.extractOk = parsed.ok;
      result.calendarListview.reason = parsed.reason || null;
      if (parsed.ok) {
        const byYear = {};
        for (const r of parsed.rows) {
          const y = r.date.slice(0, 4);
          byYear[y] = (byYear[y] || 0) + 1;
        }
        result.calendarListview.rawRowCount = parsed.rows.length;
        result.calendarListview.countByYear = byYear;
        result.calendarListview.allDatesRange = {
          min: parsed.rows.reduce((a, r) => (a === null || r.date < a ? r.date : a), null),
          max: parsed.rows.reduce((a, r) => (a === null || r.date > a ? r.date : a), null),
        };
        // 2026年の行があれば、タイトル・日付を全件残す（存在するかどうかの直接証拠）
        result.calendarListview.rows2026 = parsed.rows.filter((r) => r.date.startsWith('2026-'));
      }
    }
  } catch (e) {
    result.calendarListview = { error: String(e?.message || e) };
  }

  // --- 2. foreign-trade/reference/release_schedule.html（公式貿易統計年間発表予定） ---
  try {
    const res = await fetch('https://www.census.gov/foreign-trade/reference/release_schedule.html');
    result.tradeReleaseSchedule = { httpStatus: res.status, ok: res.ok };
    if (res.ok) {
      const html = await res.text();
      writeFileSync(`${OUT_DIR}/trade-release-schedule.html`, html);
      result.tradeReleaseSchedule.byteLength = html.length;
      const text = stripHtmlToText(html);
      writeFileSync(`${OUT_DIR}/trade-release-schedule.txt`, text);
      result.tradeReleaseSchedule.text = text;
    }
  } catch (e) {
    result.tradeReleaseSchedule = { error: String(e?.message || e) };
  }

  writeFileSync(`${OUT_DIR}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main();
