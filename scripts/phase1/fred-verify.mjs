#!/usr/bin/env node
// FRED APIのライブ検証（BLS代替ソースとしての採用可否判定）。GitHub Actions上で
// secrets.FRED_API_KEY を環境変数FRED_API_KEY経由で受け取り実行する想定。
// FRED APIはキー発行制の公式プログラム的アクセス手段のため、通常のスクレイピングと異なり
// robots.txt確認は行わない（ToS: 120req/分・引用要件のみ。docs/phase1-official-sources.md §5-4）。
//
// 合否基準（しょうさん指示・2026-08-14で固定。事前に判定基準を確定してから実行する）:
//   合格 = CPI(10)・PPI(46)・雇用統計(50) の3リリースすべてで、
//     (a) 実行日から2ヶ月先までの未来日程が返る
//     (b) 既刊2週の実際の発表日（精度検証アンカー、下記GROUND_TRUTH）が返却データに含まれる
//   不合格 = 上記いずれかを満たさないリリースが1つでもあれば不合格。
//     不合格の場合はFREDに固執せず第二候補（Census PFEI）へ切り替える。
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = 'phase1-out';
const RAW_KEY = process.env.FRED_API_KEY || '';
const API_KEY = RAW_KEY.trim();
if (!API_KEY) {
  console.error('[FATAL] FRED_API_KEY が設定されていません（GitHub Secretsを確認）');
  process.exit(1);
}
console.log(`[DIAG] key length=${API_KEY.length} (trim前後で差分: ${RAW_KEY.length !== API_KEY.length}) 形式=${/^[a-z0-9]{32}$/.test(API_KEY) ? '32桁英数字(想定どおり)' : '想定外（32桁小文字英数字ではない）'}`);

// 精度検証アンカー: reference/sample-report_20260808.html（既刊2週）の実際の発表日。
// SPEC/expected-events.jsonのJST時刻から逆算した米東部時間の発表日（同日中の08:30 ET発表のため日付は同じ）。
const GATED_RELEASES = [
  { id: 10, kind: 'cpi', name: 'CPI', groundTruthDate: '2026-08-12', groundTruthNote: '既刊2026-08-10週: 消費者物価指数（CPI）21:30 JST=08:30 ET, 2026-08-12(水)' },
  { id: 46, kind: 'ppi', name: 'PPI', groundTruthDate: '2026-08-13', groundTruthNote: '既刊2026-08-10週: 生産者物価指数（PPI）21:30 JST=08:30 ET, 2026-08-13(木)' },
  { id: 50, kind: 'employment_situation', name: '雇用統計（Employment Situation）', groundTruthDate: '2026-08-07', groundTruthNote: '既刊2026-08-03週: 米国雇用統計 21:30 JST=08:30 ET, 2026-08-07(金)' },
];
const INFO_ONLY_RELEASES = [
  { id: 192, kind: 'employment_indicator', name: 'JOLTS', groundTruthDate: null },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = new Date();
const todayIso = today.toISOString().slice(0, 10);
const twoMonthsOut = new Date(today);
twoMonthsOut.setUTCMonth(twoMonthsOut.getUTCMonth() + 2);
const twoMonthsOutIso = twoMonthsOut.toISOString().slice(0, 10);
// 精度検証アンカー（8月上旬）を含められるよう、取得範囲は7月頭〜実行日+3ヶ月とする
const RANGE_START = '2026-07-01';
const rangeEnd = new Date(today);
rangeEnd.setUTCMonth(rangeEnd.getUTCMonth() + 3);
const RANGE_END = rangeEnd.toISOString().slice(0, 10);

async function fetchReleaseDates(releaseId) {
  const url = new URL('https://api.stlouisfed.org/fred/release/dates');
  url.searchParams.set('release_id', String(releaseId));
  url.searchParams.set('api_key', API_KEY);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('sort_order', 'asc');
  url.searchParams.set('realtime_start', RANGE_START);
  url.searchParams.set('realtime_end', RANGE_END);
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
  console.log(`##### FRED verify start ${new Date().toISOString()} #####`);
  console.log(`today=${todayIso} / 取得範囲=${RANGE_START}〜${RANGE_END} / 2ヶ月先=${twoMonthsOutIso}`);
  const report = { today: todayIso, twoMonthsOutIso, releases: [] };

  for (const rel of [...GATED_RELEASES, ...INFO_ONLY_RELEASES]) {
    console.log(`\n--- release_id=${rel.id} (${rel.name}) ${rel.groundTruthNote ? '[' + rel.groundTruthNote + ']' : ''} ---`);
    const r = await fetchReleaseDates(rel.id);
    if (!r.ok) {
      console.log(`[ERROR] HTTP ${r.status} (${r.ms}ms): ${r.raw}`);
      report.releases.push({ ...rel, ok: false, status: r.status, raw: r.raw });
      await sleep(600);
      continue;
    }
    const dates = (r.body?.release_dates || []).map((d) => d.date);
    const futureDates = dates.filter((d) => d > todayIso);
    const hasTwoMonthsCoverage = futureDates.some((d) => d >= twoMonthsOutIso) || (futureDates.length && futureDates[futureDates.length - 1] >= twoMonthsOutIso);
    const groundTruthFound = rel.groundTruthDate ? dates.includes(rel.groundTruthDate) : null;
    console.log(`HTTP ${r.status} (${r.ms}ms). 全${dates.length}件（未来${futureDates.length}件）`);
    console.log(`  全件: ${JSON.stringify(dates)}`);
    console.log(`  2ヶ月先(${twoMonthsOutIso})以降を含むか: ${hasTwoMonthsCoverage}`);
    if (rel.groundTruthDate) {
      console.log(`  精度検証: 既刊実績日 ${rel.groundTruthDate} が含まれるか: ${groundTruthFound}`);
    }
    report.releases.push({
      ...rel, ok: true, status: r.status,
      totalCount: dates.length, futureCount: futureDates.length,
      dates, hasTwoMonthsCoverage, groundTruthFound,
    });
    await sleep(600); // 120req/分の余裕を持って間隔をあける
  }

  writeFileSync(join(OUT_DIR, 'fred-verify-report.json'), JSON.stringify(report, null, 2));

  console.log('\n##### SUMMARY（合否対象: CPI・PPI・雇用統計） #####');
  const gated = report.releases.filter((r) => GATED_RELEASES.some((g) => g.id === r.id));
  let allPass = true;
  for (const r of gated) {
    const pass = r.ok && r.hasTwoMonthsCoverage && r.groundTruthFound;
    if (!pass) allPass = false;
    console.log(`${r.name}(id=${r.id}): ${r.ok ? `2ヶ月先カバー=${r.hasTwoMonthsCoverage} / 精度一致=${r.groundTruthFound}` : `ERROR ${r.status}`} => ${pass ? 'PASS' : 'FAIL'}`);
  }
  const info = report.releases.filter((r) => INFO_ONLY_RELEASES.some((g) => g.id === r.id));
  for (const r of info) {
    console.log(`[参考・合否対象外] ${r.name}(id=${r.id}): ${r.ok ? `2ヶ月先カバー=${r.hasTwoMonthsCoverage}` : `ERROR ${r.status}`}`);
  }

  console.log(`\n##### 最終判定: ${allPass ? 'PASS（FRED採用可）' : 'FAIL（第二候補=Census PFEIへ切替）'} #####`);
})();
