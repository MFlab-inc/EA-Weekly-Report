#!/usr/bin/env node
// 収集ステップ（collect→build-ledger→renderの1段目、task #13後継の実データ接続、
// しょうさん指示2026-08-15）。config/official-sources.jsonの実ソースへ実アクセスし
// （本番運用のみ。npm testはfetchImplモックで代替する既存の単体テストが担う）、対象週の
// 候補イベント一覧をphase1-out/collect-result.jsonへ書き出す。scripts/build-ledger.mjsが読み込んで
// 台帳を生成する。候補の組み立て自体はscripts/phase1/observation-run.mjsのbuildObservationSummary
// （既存・テスト済み）をそのまま再利用し、ロジックを重複させない。
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTargetWeek } from './lib/dates.js';
import { runChecks } from './checkers/harness.mjs';
import { createRobotsChecker } from './lib/robots.js';
import { buildObservationSummary, USER_AGENT } from './phase1/observation-run.mjs';

export async function collect({ sourcesConfig, importanceRules, eventNames, manualEventsConfig, targetWeek, fetchImpl = fetch, apiKey, robotsChecker }) {
  const report = await runChecks({ sourcesConfig, importanceRules, eventNames, targetWeek, fetchImpl, apiKey, robotsChecker });
  const summary = buildObservationSummary(report, sourcesConfig, importanceRules, manualEventsConfig, eventNames);
  return { targetWeek, report, candidates: summary.candidates };
}

async function main() {
  const sourcesConfig = JSON.parse(readFileSync('config/official-sources.json', 'utf8'));
  const importanceRules = JSON.parse(readFileSync('config/importance-rules.json', 'utf8'));
  const eventNames = JSON.parse(readFileSync('config/event-names.json', 'utf8')).entries;
  const manualEventsConfig = JSON.parse(readFileSync('config/manual-events.json', 'utf8'));
  const targetWeek = getTargetWeek();
  const robotsChecker = createRobotsChecker({ userAgent: USER_AGENT });

  const result = await collect({
    sourcesConfig, importanceRules, eventNames, manualEventsConfig, targetWeek,
    fetchImpl: fetch, apiKey: process.env.FRED_API_KEY, robotsChecker,
  });

  mkdirSync('phase1-out', { recursive: true });
  writeFileSync(join('phase1-out', 'collect-result.json'), JSON.stringify(result, null, 2));
  console.log(`collect完了: 対象週=${targetWeek.targetWeekStart}〜${targetWeek.targetWeekEnd} 候補${result.candidates.length}件 outcome=${result.report.outcome.status}`);
  if (result.report.outcome.status === 'HOLD') process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
