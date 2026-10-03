#!/usr/bin/env node
// 任意の対象週（または任意の「生成日」からの自動算出）に対してcollect→build-ledger→render→gateの
// 全パイプラインを試験実行する（しょうさん指摘、2026-10-03: 10/5週のHOLDインシデントを受け、
// 「初めて迎える日付パターン」の週を実際の到来前に検証したい）。
//
// data/ledger/・output/配下の本番パスには一切書き込まない（--out-dirで指定したスクラッチ領域
// [既定: phase1-out/dry-run/、既にgitignore済み]にのみ書き込む）ため、本番にコミットされる
// 心配なく安全に試験実行できる。
//
// --now <YYYY-MM-DD> を指定すると、その日付を「生成日（土曜想定）」として対象週を自動算出する
// （scripts/lib/dates.jsのgetTargetWeekをそのまま使う。実際の土曜cronが動く状況を最も忠実に
// 再現できるため、--target-week-startより推奨）。作成日（createdDateJa）もこの日付から算出した
// 実際の値を使う（render.mjsのautoCreatedDateJaと同じロジック）ため、年またぎ等の実際の挙動を
// そのまま再現できる。
//
// --target-week-start <YYYY-MM-DD> を直接指定することもできる（--nowは省略時、今日の日付を
// 使った作成日になる点に注意）。
//
// 実ネットワークへアクセスする（config/official-sources.jsonの実ソースへ実アクセス）ため、
// サンドボックス環境によっては一部ソースがブロックされ得る（本プロジェクトの既存の注意点と
// 同じ。本番相当の検証はGitHub Actions実ネットワーク環境で行うこと）。
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { getTargetWeek, parseYmd, addDays, weekdayJa, formatYmd, formatMd } from '../lib/dates.js';
import { collect } from '../collect.mjs';
import { createRobotsChecker } from '../lib/robots.js';
import { USER_AGENT } from '../phase1/observation-run.mjs';
import { buildLedgerFromCollectResult } from '../build-ledger.mjs';
import { runGateChecks, decideGateOutcome } from './gate.mjs';
import { autoHeroSummary, autoHeroPills } from '../render.mjs';

// render.mjs/build-ledger.mjs/gate.mjsはESM（importで直接読み込む）。以下はCJS（'use strict'）
// のためcreateRequireで読み込む
const require = createRequire(import.meta.url);
const { validateLedger } = require('../lib/validate-ledger.js');
const { computePipelineCodeHash } = require('../lib/pipeline-code-hash.js');
const { nowJstIso } = require('../lib/tz-convert.js');
const { ledgerToWeekInput } = require('../render/ledger-to-week-input.js');
const { buildReportData } = require('../render/build-report-data.js');
const { renderReportHtml } = require('../render/html-renderer.js');
const { checkEventVolume } = require('../lib/validate-event-volume.js');
const { checkEventVolumeTrend } = require('../lib/validate-event-volume-trend.js');

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];
function autoCreatedDateJa(now) {
  const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const d = new Date(jstMs);
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WEEKDAY_JA[d.getUTCDay()]}）`;
}

function parseArgs(argv) {
  const opts = { now: null, targetWeekStart: null, outDir: join('phase1-out', 'dry-run') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--now') opts.now = argv[++i];
    else if (argv[i] === '--target-week-start') opts.targetWeekStart = argv[++i];
    else if (argv[i] === '--out-dir') opts.outDir = argv[++i];
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.now && !opts.targetWeekStart) {
    console.error('使い方: node dry-run-week.mjs --now <YYYY-MM-DD>  または  --target-week-start <YYYY-MM-DD>  [--out-dir <path>]');
    process.exitCode = 2;
    return;
  }

  const simulatedNow = opts.now ? new Date(`${opts.now}T00:00:00Z`) : null;
  let targetWeek;
  if (opts.targetWeekStart) {
    // --target-week-start指定時はgetTargetWeekの「次の月曜」算出ロジックを経由せず、
    // 指定された週をそのまま使う（scripts/lib/dates.jsの既存ヘルパーのみで組み立てる）
    const monday = parseYmd(opts.targetWeekStart);
    const dates = [];
    for (let i = 0; i < 5; i++) {
      const d = addDays(monday, i);
      dates.push({ date: formatYmd(d), md: formatMd(d), weekday: weekdayJa(d) });
    }
    targetWeek = {
      collectionDate: opts.now || formatYmd(addDays(monday, -2)),
      targetWeekStart: opts.targetWeekStart,
      targetWeekEnd: dates[4].date,
      dates,
    };
  } else {
    targetWeek = getTargetWeek(simulatedNow);
  }

  const nowForNarrative = simulatedNow || parseYmd(targetWeek.targetWeekStart);

  console.log(`[dry-run-week] 対象週=${targetWeek.targetWeekStart}〜${targetWeek.targetWeekEnd}（シミュレート生成日=${opts.now || '(target-week-start直接指定、作成日はtarget-week-start基準)'}）`);

  const sourcesConfig = JSON.parse(readFileSync('config/official-sources.json', 'utf8'));
  const importanceRules = JSON.parse(readFileSync('config/importance-rules.json', 'utf8'));
  const eventNames = JSON.parse(readFileSync('config/event-names.json', 'utf8')).entries;
  const manualEventsConfig = JSON.parse(readFileSync('config/manual-events.json', 'utf8'));
  const officialsConfig = JSON.parse(readFileSync('config/officials.json', 'utf8'));
  const expectedCoverageConfig = JSON.parse(readFileSync('config/expected-coverage.json', 'utf8'));
  const reportPolicy = JSON.parse(readFileSync('config/report-policy.json', 'utf8'));
  const btcGuide = JSON.parse(readFileSync('config/btc-weekend-guide.json', 'utf8'));
  const eventComments = JSON.parse(readFileSync('config/event-comments.json', 'utf8'));
  const volumeCheckPolicy = JSON.parse(readFileSync('config/volume-check-policy.json', 'utf8'));
  const robotsChecker = createRobotsChecker({ userAgent: USER_AGENT });

  const collectResult = await collect({
    sourcesConfig, importanceRules, eventNames, manualEventsConfig, targetWeek,
    fetchImpl: fetch, apiKey: process.env.FRED_API_KEY, robotsChecker,
  });
  console.log(`[dry-run-week] collect: 候補${collectResult.candidates.length}件 outcome=${collectResult.report.outcome.status}`);

  // 定例欠落WARN抑制（scripts/lib/suppress-repeat-recurring-warnings.js）の動作も本番同様に
  // 再現するため、実際のdata/ledger/配下の前週台帳（本番の既存データ）があれば読み込んで渡す
  const previousWeekStart = formatYmd(addDays(parseYmd(targetWeek.targetWeekStart), -7));
  const previousLedgerPath = join('data', 'ledger', `${previousWeekStart}.json`);
  const previousLedger = existsSync(previousLedgerPath) ? JSON.parse(readFileSync(previousLedgerPath, 'utf8')) : null;

  const ledger = buildLedgerFromCollectResult({
    collectResult, sourcesConfig, manualEventsConfig, officialsConfig, importanceRules, expectedCoverageConfig,
    generatedAt: nowJstIso(nowForNarrative), generatedFromCommit: 'dry-run', generatedFromCodeHash: computePipelineCodeHash(),
    previousLedger,
  });
  const ledgerCheck = validateLedger(ledger);
  console.log(`[dry-run-week] build-ledger: outcome=${ledger.meta.outcome} events=${ledger.events.length}件 schema_ok=${ledgerCheck.ok}`);

  mkdirSync(opts.outDir, { recursive: true });
  const ledgerPath = join(opts.outDir, `ledger-${targetWeek.targetWeekStart}.json`);
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));

  const narrative = {
    reportMeta: `ea-weekly-${targetWeek.targetWeekStart.replace(/-/g, '')}`,
    createdDateJa: autoCreatedDateJa(nowForNarrative),
    heroSummary: null,
    heroPills: null,
  };
  narrative.heroSummary = autoHeroSummary(ledger, reportPolicy);
  narrative.heroPills = autoHeroPills(ledger, reportPolicy);

  const weekInput = ledgerToWeekInput(ledger, narrative, eventComments);
  const reportData = buildReportData(weekInput);
  const html = renderReportHtml(reportData, { reportPolicy, btcGuide });
  const htmlPath = join(opts.outDir, `ea-weekly-${targetWeek.targetWeekStart.replace(/-/g, '')}.html`);
  writeFileSync(htmlPath, html);
  console.log(`[dry-run-week] render: ${htmlPath} (${html.length} bytes) 作成日=${narrative.createdDateJa}`);

  const checks = await runGateChecks({ ledger, html, reportPolicy, btcGuide, skipLinkReachability: true, mobileHtmlPath: htmlPath });
  const volumeCheck = checkEventVolume(ledger, volumeCheckPolicy);
  const trendCheck = checkEventVolumeTrend(volumeCheck.displayedCount, volumeCheck.star3Count, [], volumeCheckPolicy.historical_median_check);
  const decision = decideGateOutcome(checks, volumeCheck, { trendCheck });

  console.log(`[dry-run-week] gate判定: ${decision}`);
  for (const c of checks) {
    console.log(`  - ${c.name}: ERROR=${c.errors.length} WARNING=${c.warnings.length}`);
    for (const e of c.errors) console.log(`      ERROR: ${e}`);
  }
  console.log(`  - volume_check: 掲載対象=${volumeCheck.displayedCount}件 / ★★★=${volumeCheck.star3Count}件`);

  const resultPath = join(opts.outDir, `gate-result-${targetWeek.targetWeekStart}.json`);
  writeFileSync(resultPath, JSON.stringify({ decision, checks, volume_check: volumeCheck, volume_trend_check: trendCheck }, null, 2));

  if (decision === 'HOLD') process.exitCode = 1;
}

main().catch((e) => {
  console.error('[dry-run-week] FATAL:', e);
  process.exitCode = 1;
});
