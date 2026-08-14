#!/usr/bin/env node
// 観測モード実行（2026-08-15、しょうさん指示）。実際の対象週（getTargetWeek()が計算する
// 実行時点の翌週。土曜08:06に実行すれば8/17週になる）に対して、既存のharness.mjs
// （runChecks）を本物のconfig・実アクセスで実行し、候補イベント一覧＋★★★の停止目安
// （簡易・自動導出版）をJSON/テキストで出力する。
//
// スコープ（しょうさん指示の優先順1・2に対応。3のレンダラー統合・HTML生成は今回対象外）:
// - annual_schedule_config由来の候補（RBA・BOJ・ISM等）は表示名が未解決（SPEC §4.2の
//   規則生成命名はtask #12のレンダラー側の責務のため、[kind]のプレースホルダのみ）
// - 同日複数★★★イベントの停止窓の束ね（例: RBA政策金利＋SOMP＋会見を1窓にする等）は
//   行わず、distinct(date,time)ごとに1窓として計算する簡易版
//
// output/へのコミットは行わない。phase1-out/はgitignore対象でActions artifactにのみ保存する。
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runChecks } from '../checkers/harness.mjs';
import { getTargetWeek } from '../lib/dates.js';
import { createRobotsChecker } from '../lib/robots.js';

const require = createRequire(import.meta.url);
const { computeHaltWindow, unionIntervals } = require('../lib/halt-schedule.js');
const { zonedWallTimeToJst } = require('../lib/tz-convert.js');
const { resolveImportance } = require('../lib/importance.js');

export const USER_AGENT = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; observation-mode)';

// annual_schedule_config型のmatchedEntries（{date, kind, note?}）を、他ソース由来のthisWeek
// 候補と同じ形（date/time/kind/country/importance/displayName）へ変換する。
// 表示名は解決しない（naming.js統合はtask #12のレンダラー側スコープ）
export function annualEntryToCandidate(entry, source, importanceRules) {
  const at = source.announce_time_by_kind?.[entry.kind];
  const base = {
    date: entry.date,
    kind: entry.kind,
    country: source.country,
    importance: resolveImportance(entry.kind, source.country, importanceRules),
    displayName: `[${entry.kind}]（名称未解決・task #12の命名ロジック統合待ち）`,
    sourceId: source.id,
    note: entry.note,
  };
  if (!at) return { ...base, time: null, timeNote: 'announce_time_by_kind未設定' };
  const [y, mo, d] = entry.date.split('-').map(Number);
  const [h, mi] = at.local_time.split(':').map(Number);
  const jst = zonedWallTimeToJst(y, mo, d, h, mi, at.tz);
  return { ...base, date: jst.date, time: jst.time };
}

// report（runChecks()の戻り値）から候補イベントの統合一覧・★★★の停止目安（簡易版）を組み立てる
export function buildObservationSummary(report, sourcesConfig, importanceRules) {
  const candidates = [];
  for (const r of report.results) {
    if (r.skipped) continue;
    if (Array.isArray(r.thisWeek)) {
      for (const c of r.thisWeek) candidates.push({ ...c, sourceId: r.id });
    }
    if (Array.isArray(r.matchedEntries)) {
      const source = sourcesConfig.sources.find((s) => s.id === r.id);
      for (const e of r.matchedEntries) candidates.push(annualEntryToCandidate(e, source, importanceRules));
    }
  }
  candidates.sort((a, b) => `${a.date}${a.time || ''}`.localeCompare(`${b.date}${b.time || ''}`));

  const star3 = candidates.filter((c) => c.importance === 3);
  const star3Timed = star3.filter((c) => c.time);

  const windowsByDate = {};
  for (const c of star3Timed) {
    windowsByDate[c.date] = windowsByDate[c.date] || [];
    if (!windowsByDate[c.date].some((w) => w.time === c.time)) windowsByDate[c.date].push({ time: c.time });
  }
  const haltByDate = {};
  for (const [date, windows] of Object.entries(windowsByDate)) {
    const computed = windows.map((w) => computeHaltWindow({ date, firstTime: w.time, lastTime: w.time }));
    const bars = unionIntervals(computed.map((w) => ({ start: w.displayStartMin, end: w.displayEndMin })));
    haltByDate[date] = { windowCount: computed.length, windows: computed, bars };
  }

  return {
    mode: 'observation',
    scopeNote:
      'task #12のレンダラー（手動グルーピング・命名テンプレート）を経由しない自動導出の簡易版。' +
      '同一日時の複数イベントの束ね（例: RBA政策金利＋SOMP＋会見を1窓にする等）は行わず、' +
      'distinct(date,time)ごとに1窓として計算している。annual_schedule_config由来の候補は表示名が未解決（[kind]のみ）。',
    targetWeek: report.targetWeek,
    outcome: report.outcome,
    sourceResults: report.results.map((r) => ({
      id: r.id,
      ok: r.ok,
      skipped: r.skipped,
      reason: r.reason,
      foundKinds: r.foundKinds,
      thisWeekCount: r.thisWeek?.length,
      matchedEntriesCount: r.matchedEntries?.length,
    })),
    residualWarnings: report.residualWarnings,
    recurringMissingWarnings: report.recurringMissingWarnings,
    candidateCount: candidates.length,
    star3Count: star3.length,
    star3TimedCount: star3Timed.length,
    candidates,
    haltByDate,
  };
}

export function renderText(summary) {
  const lines = [];
  lines.push(`# 観測モード実行結果（${summary.targetWeek.start} 〜 ${summary.targetWeek.end}）`);
  lines.push(`outcome: ${summary.outcome.status}${summary.outcome.reason ? ` (${summary.outcome.reason})` : ''}`);
  lines.push('');
  lines.push('## ソース別結果');
  for (const r of summary.sourceResults) {
    if (r.skipped) {
      lines.push(`- ${r.id}: SKIPPED (${r.reason})`);
      continue;
    }
    const countPart = r.thisWeekCount != null ? `thisWeek=${r.thisWeekCount}` : `matchedEntries=${r.matchedEntriesCount ?? 0}`;
    lines.push(`- ${r.id}: ok=${r.ok} ${countPart}${r.reason ? ` reason=${r.reason}` : ''}`);
  }
  lines.push('');
  lines.push(`## 候補イベント一覧（全${summary.candidateCount}件、うち★★★=${summary.star3Count}件・時刻判明${summary.star3TimedCount}件）`);
  for (const c of summary.candidates) {
    lines.push(`- ${c.date} ${c.time || '(時刻未定)'} ★${c.importance ?? '?'} [${c.sourceId}] ${c.displayName || c.kind}`);
  }
  lines.push('');
  lines.push('## 停止目安（簡易版・日別）');
  for (const [date, h] of Object.entries(summary.haltByDate)) {
    lines.push(`- ${date}: 窓${h.windowCount}件`);
    for (const w of h.windows) {
      lines.push(`    停止開始目安 ${w.displayStart}–${w.displayEnd}${w.annotation ? `（${w.annotation}）` : ''}`);
    }
  }
  if (Object.keys(summary.haltByDate).length === 0) lines.push('（対象週に時刻判明済みの★★★候補なし）');
  lines.push('');
  if (summary.residualWarnings?.length) {
    lines.push('## 残量監視WARN');
    for (const w of summary.residualWarnings) lines.push(`- ${JSON.stringify(w)}`);
  }
  if (summary.recurringMissingWarnings?.length) {
    lines.push('## 定例欠落WARN');
    for (const w of summary.recurringMissingWarnings) lines.push(`- ${w}`);
  }
  lines.push('');
  lines.push(`(注) ${summary.scopeNote}`);
  return lines.join('\n');
}

async function main() {
  const sourcesConfig = JSON.parse(readFileSync('config/official-sources.json', 'utf8'));
  const importanceRules = JSON.parse(readFileSync('config/importance-rules.json', 'utf8'));
  const eventNames = JSON.parse(readFileSync('config/event-names.json', 'utf8')).entries;
  const targetWeek = getTargetWeek();
  const robotsChecker = createRobotsChecker({ userAgent: USER_AGENT });

  console.log(`観測モード開始 ${new Date().toISOString()} / 対象週=${targetWeek.targetWeekStart}〜${targetWeek.targetWeekEnd}`);

  const report = await runChecks({
    sourcesConfig,
    importanceRules,
    eventNames,
    targetWeek,
    fetchImpl: fetch,
    apiKey: process.env.FRED_API_KEY,
    robotsChecker,
  });

  const summary = buildObservationSummary(report, sourcesConfig, importanceRules);

  mkdirSync('phase1-out', { recursive: true });
  writeFileSync('phase1-out/observation-summary.json', JSON.stringify(summary, null, 2));
  writeFileSync('phase1-out/observation-report-raw.json', JSON.stringify(report, null, 2));
  const text = renderText(summary);
  writeFileSync('phase1-out/observation-summary.txt', text);
  console.log(text);
  console.log(`観測モード終了 ${new Date().toISOString()}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
