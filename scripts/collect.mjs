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
  // 2026-11-07追記（11/9週パイプライン失敗対応、しょうさん指摘: ワークフローログからは
  // outcome=HOLD/WARNの理由が一切わからず、原因調査のたびにローカル環境での再現が必要だった）。
  // outcome.reasons（WARN/HOLDの判定理由）とfailures（個別ソースの失敗一覧）をActionsログへ
  // そのまま出力し、ログだけで原因を特定できるようにする。OK時は出力なし（ログを肥大化させない）
  if (result.report.outcome.status !== 'OK') {
    for (const reason of result.report.outcome.reasons) console.log(`  outcome理由: ${reason}`);
    for (const f of result.report.failures) console.log(`  failure: ${f.sourceId} (expected=${f.expected}) ${f.reason}`);
  }
  // 2026-11-16追加（BOEの表示ウィンドウ直前の見出し読み飛ばし対応）: 構造的失敗ではない
  // 情報WARN（meta.warningsにも合流するextractorWarnings）もログへ出す
  for (const w of result.report.extractorWarnings || []) console.log(`  extractor情報WARN: ${w}`);
  if (result.report.outcome.status === 'HOLD') process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
