#!/usr/bin/env node
// 台帳生成ステップ（collect→build-ledger→renderの2段目、task #13後継の実データ接続、
// しょうさん指示2026-08-15）。scripts/collect.mjsが書き出したphase1-out/collect-result.jsonと
// 各種configを読み込み、scripts/lib/build-ledger.jsのbuildLedger()（純粋関数・テスト済み）で
// 台帳を組み立て、data/ledger/YYYY-MM-DD.json（YYYY-MM-DD=対象週の月曜）として書き出す。
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { computeRecurringChecksStatus } from './checkers/harness.mjs';

const require = createRequire(import.meta.url);
const { buildLedger } = require('./lib/build-ledger.js');
const { validateLedger } = require('./lib/validate-ledger.js');
const { validateExpectedCoverage } = require('./lib/validate-expected-coverage.js');
const { nowJstIso } = require('./lib/tz-convert.js');

const PIPELINE_VERSION = `ea-weekly-report@${require('../package.json').version}`;

export function buildLedgerFromCollectResult({ collectResult, sourcesConfig, manualEventsConfig, officialsConfig, importanceRules, expectedCoverageConfig, generatedAt, generatedFromCommit }) {
  const { targetWeek, report, candidates } = collectResult;
  const recurringChecksStatus = computeRecurringChecksStatus(report.results, importanceRules, targetWeek);
  const expectedCoverageResult = validateExpectedCoverage(sourcesConfig, officialsConfig, expectedCoverageConfig);
  return buildLedger({
    report, sourcesConfig, manualEventsConfig, officialsConfig, candidates,
    expectedCoverageResult, recurringChecksStatus, pipelineVersion: PIPELINE_VERSION, generatedAt, generatedFromCommit,
  });
}

async function main() {
  const sourcesConfig = JSON.parse(readFileSync('config/official-sources.json', 'utf8'));
  const manualEventsConfig = JSON.parse(readFileSync('config/manual-events.json', 'utf8'));
  const officialsConfig = JSON.parse(readFileSync('config/officials.json', 'utf8'));
  const importanceRules = JSON.parse(readFileSync('config/importance-rules.json', 'utf8'));
  const expectedCoverageConfig = JSON.parse(readFileSync('config/expected-coverage.json', 'utf8'));
  const collectResult = JSON.parse(readFileSync(join('phase1-out', 'collect-result.json'), 'utf8'));

  const ledger = buildLedgerFromCollectResult({
    collectResult, sourcesConfig, manualEventsConfig, officialsConfig, importanceRules,
    expectedCoverageConfig, generatedAt: nowJstIso(), generatedFromCommit: process.env.GITHUB_SHA || null,
  });

  const check = validateLedger(ledger);
  if (!check.ok) {
    console.error('台帳スキーマ検証エラー:', check.errors);
    process.exitCode = 1;
    return;
  }

  mkdirSync('data/ledger', { recursive: true });
  const outPath = join('data', 'ledger', `${ledger.meta.target_week_start}.json`);
  writeFileSync(outPath, JSON.stringify(ledger, null, 2));
  console.log(`build-ledger完了: ${outPath} outcome=${ledger.meta.outcome} events=${ledger.events.length}件`);
  if (ledger.meta.outcome === 'HOLD') process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
