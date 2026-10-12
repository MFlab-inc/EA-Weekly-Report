#!/usr/bin/env node
// 米小売売上高PR #46フォローアップ（しょうさん指示2026-10-12）の調査用一時スクリプト。
// 監査記録として残す（.github/workflows/census-recon.ymlは調査完了後に削除する運用、
// committees-events-recon等の既存の一時recon方針を踏襲）。
//
// 目的:
// 1. calendar-listview.htmlの現在のライブ状態を取得し、(a)ページ全体で解析できる行数、
//    (b) 2026-10-15のAdvance Monthly Sales for Retail and Food Services行の有無、
//    (c) retail_sales/trade_balanceに該当する全行（年間予定config登録の参考）を確認する。
//    2026-10-10の生成時点で「ページは読めたが該当行が無かった」のか「ページ自体が
//    読めていなかった」のかを切り分ける直接の証拠にはならない（取得は現在時点のみ）が、
//    現在の掲載状況から推測材料を得る。
// 2. retail/release_schedule.html（Census公式の年間発表予定）を取得し、今後の
//    annual_schedule_config登録のための生テキストを残す。
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extractCensusCalendar } = require('../checkers/extractors/census.js');

const OUT_DIR = 'phase1-out/census-recon';

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const result = { fetchedAt: new Date().toISOString() };

  // --- 1. calendar-listview.html ---
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
        result.calendarListview.rawRowCount = parsed.rows.length;
        result.calendarListview.oct15RetailSalesRow = parsed.rows.find(
          (r) => r.date === '2026-10-15' && /retail/i.test(r.title)
        ) || null;
        result.calendarListview.retailSalesRows = parsed.rows.filter((r) => /advance monthly sales for retail/i.test(r.title));
        result.calendarListview.tradeBalanceRows = parsed.rows.filter((r) => /international trade in goods/i.test(r.title));
        result.calendarListview.allDatesRange = {
          min: parsed.rows.reduce((a, r) => (a === null || r.date < a ? r.date : a), null),
          max: parsed.rows.reduce((a, r) => (a === null || r.date > a ? r.date : a), null),
        };
      }
    }
  } catch (e) {
    result.calendarListview = { error: String(e?.message || e) };
  }

  // --- 2. retail/release_schedule.html（公式年間発表予定） ---
  try {
    const res = await fetch('https://www.census.gov/retail/release_schedule.html');
    result.releaseSchedule = { httpStatus: res.status, ok: res.ok };
    if (res.ok) {
      const html = await res.text();
      writeFileSync(`${OUT_DIR}/release-schedule.html`, html);
      result.releaseSchedule.byteLength = html.length;
      // artifactダウンロードがこの実行環境から到達できないホスト（Azure Blob Storage）経由のため、
      // ジョブログ（stdout）からも内容を読めるよう、タグを除去した本文テキストを残す
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .join('\n');
      writeFileSync(`${OUT_DIR}/release-schedule.txt`, text);
      result.releaseSchedule.text = text;
    }
  } catch (e) {
    result.releaseSchedule = { error: String(e?.message || e) };
  }

  writeFileSync(`${OUT_DIR}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main();
