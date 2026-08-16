#!/usr/bin/env node
// SPEC §3.3「月曜事後突合」のCLI（task #39、2026-08-17実データで初回実行・動作確認済み）。
// 対象週が実際の当該週になった月曜朝に実行する想定。ff_calendar_thisweek.json（この時点では
// 対象週分を指す。task #2実測で確認済み）と配信済み台帳（data/ledger/<week>.json）を突き合わせ、
// 相違があれば discrepancy-report.json を出力してrunを失敗させる（相違ゼロなら静かに成功）。
// FFへのアクセスはthisweek 1リクエストのみ（レート制限順守。SPEC §3.2）。
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { crossCheck } = require('../lib/ff-cross-check.js');

const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; ff-cross-check)';
const THISWEEK_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

function jstDateTime(isoStr) {
  const d = new Date(isoStr);
  if (isNaN(d)) return null;
  const jst = new Date(d.getTime() + 9 * 3600 * 1000);
  return { date: jst.toISOString().slice(0, 10), time: jst.toISOString().slice(11, 16) };
}

async function fetchFfThisWeek(fetchImpl = fetch) {
  const res = await fetchImpl(THISWEEK_URL, {
    headers: { 'User-Agent': UA, Accept: 'application/json,*/*;q=0.8' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`ff_calendar_thisweek.json取得失敗: HTTP ${res.status}`);
  const raw = JSON.parse(await res.text());
  const events = [];
  for (const e of raw) {
    const jst = jstDateTime(e.date);
    if (!jst) continue;
    events.push({ jstDate: jst.date, jstTime: jst.time, currency: e.country, title: e.title });
  }
  return events;
}

function ledgerToCrossCheckEvents(ledger) {
  return ledger.events.map((e) => ({
    eventId: e.event_id,
    nameJa: e.name_ja,
    country: e.country,
    kind: e.kind,
    dateJst: e.date_jst,
    datetimeJst: e.datetime_jst,
    timeStatus: e.time_status,
  }));
}

async function main() {
  const ledgerPath = process.argv[2];
  if (!ledgerPath) {
    console.error('使い方: node ff-cross-check.mjs <ledger-json-path> [--result <discrepancy-report-path>]');
    process.exitCode = 2;
    return;
  }
  const resultIdx = process.argv.indexOf('--result');
  const resultPath = resultIdx >= 0 ? process.argv[resultIdx + 1] : 'discrepancy-report.json';

  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  const ledgerEvents = ledgerToCrossCheckEvents(ledger);
  const ffEvents = await fetchFfThisWeek();
  const result = crossCheck(ledgerEvents, ffEvents);

  console.log(`月曜事後突合: 台帳${ledgerEvents.length}件中、時刻確定${result.matched.length + result.discrepancies.length}件をFFと突合`);
  console.log(`  一致: ${result.matched.length}件 / 相違: ${result.discrepancies.length}件 / FF未収録（比較対象外）: ${result.notFoundInFf.length}件`);

  if (result.discrepancies.length === 0) {
    console.log('相違ゼロ。正常終了。');
    return;
  }

  const report = {
    generated_at: new Date().toISOString(),
    target_week_start: ledger.meta?.target_week_start ?? null,
    discrepancy_count: result.discrepancies.length,
    discrepancies: result.discrepancies,
  };
  writeFileSync(resultPath, JSON.stringify(report, null, 2));
  console.log(`相違あり。${resultPath} を出力しました:`);
  for (const d of result.discrepancies) {
    console.log(`  - ${d.date_jst} [${d.country}] ${d.name_ja}: 台帳=${d.ledger_time_jst} JST / FF=${d.ff_time_jst_candidates.join(',')} JST ("${d.ff_titles.join('", "')}")`);
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error('FATAL:', e);
    process.exitCode = 1;
  });
}

export { fetchFfThisWeek, ledgerToCrossCheckEvents };
