#!/usr/bin/env node
// FRED APIのライブ検証（BLS代替ソースとしての採用可否判定）。GitHub Actions上で
// secrets.FRED_API_KEY を環境変数FRED_API_KEY経由で受け取り実行する想定。
// 確認事項: releases/dates系エンドポイントが未来（未発表）の日付を返すか。
// FRED APIはキー発行制の公式プログラム的アクセス手段のため、通常のスクレイピングと異なり
// robots.txt確認は行わない（ToS: 120req/分・引用要件のみ。docs/phase1-official-sources.md §5-4）。
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = 'phase1-out';
const API_KEY = process.env.FRED_API_KEY;
if (!API_KEY) {
  console.error('[FATAL] FRED_API_KEY が設定されていません（GitHub Secretsを確認）');
  process.exit(1);
}

const RELEASES = [
  { id: 10, kind: 'cpi', name: 'CPI' },
  { id: 46, kind: 'ppi', name: 'PPI' },
  { id: 50, kind: 'employment_situation', name: '雇用統計（Employment Situation）' },
  { id: 192, kind: 'employment_indicator', name: 'JOLTS' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const todayIso = new Date().toISOString().slice(0, 10);

async function fetchReleaseDates(releaseId) {
  const url = new URL('https://api.stlouisfed.org/fred/release/dates');
  url.searchParams.set('release_id', String(releaseId));
  url.searchParams.set('api_key', API_KEY);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('sort_order', 'asc');
  url.searchParams.set('realtime_start', todayIso);
  url.searchParams.set('realtime_end', '2027-12-31');
  url.searchParams.set('include_release_dates_with_no_data', 'true');
  const started = Date.now();
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(20000) });
  const ms = Date.now() - started;
  const bodyText = await res.text();
  let body;
  try { body = JSON.parse(bodyText); } catch { body = null; }
  return { status: res.status, ok: res.ok, ms, body, raw: bodyText.slice(0, 500) };
}

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`##### FRED verify start ${new Date().toISOString()} (today=${todayIso}) #####`);
  const report = { today: todayIso, releases: [] };

  for (const rel of RELEASES) {
    console.log(`\n--- release_id=${rel.id} (${rel.name}) ---`);
    const r = await fetchReleaseDates(rel.id);
    if (!r.ok) {
      console.log(`[ERROR] HTTP ${r.status} (${r.ms}ms): ${r.raw}`);
      report.releases.push({ ...rel, ok: false, status: r.status, raw: r.raw });
      await sleep(600);
      continue;
    }
    const dates = (r.body?.release_dates || []).map((d) => d.date);
    const futureDates = dates.filter((d) => d > todayIso);
    console.log(`HTTP ${r.status} (${r.ms}ms). ${dates.length}件取得。うち未来日程 ${futureDates.length}件`);
    console.log(`  全件: ${JSON.stringify(dates)}`);
    console.log(`  未来日程（今日=${todayIso}より後）: ${JSON.stringify(futureDates.slice(0, 8))}`);
    report.releases.push({
      ...rel, ok: true, status: r.status,
      totalCount: dates.length, futureCount: futureDates.length,
      futureDates: futureDates.slice(0, 8),
    });
    await sleep(600); // 120req/分の余裕を持って間隔をあける
  }

  writeFileSync(join(OUT_DIR, 'fred-verify-report.json'), JSON.stringify(report, null, 2));
  console.log('\n##### SUMMARY #####');
  for (const r of report.releases) {
    console.log(`${r.name}(id=${r.id}): ${r.ok ? `future=${r.futureCount}件` : `ERROR ${r.status}`}`);
  }
  const allHaveFuture = report.releases.every((r) => r.ok && r.futureCount > 0);
  console.log(`\n結論: releases/datesは未来日程を${allHaveFuture ? '返す（採用可）' : '返さない、または一部欠落（要個別確認）'}`);
})();
