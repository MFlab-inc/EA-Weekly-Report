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
const { candidatesForTargetWeek } = require('../lib/manual-events.js');
const { resolveBojMeetingRange } = require('../lib/boj-meeting-schedule.js');
const naming = require('../lib/naming.js');

export const USER_AGENT = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; observation-mode)';

// jp_boj（日銀）のopinions_summary/minutes_summaryは、会合開催日レンジ（periodJa）を
// scripts/lib/naming.jsの規則生成命名テンプレート（bojOpinionsName/bojMinutesName）が必要とする。
// 同ソースのscheduleに含まれるpolicy_rate日程から、BOJの公表運用（主な意見=直近会合・
// 議事要旨=1つ前の会合。scripts/lib/boj-meeting-schedule.js参照）に基づき機械的に導出する。
// jp_bojはtz=Asia/Tokyoのためentry.date（現地日付）がそのままJST日付として扱える。
// 該当する会合が見つからない場合はnull（呼び出し側=build-ledger.jsのnaming.js統合は
// periodJa無しでも基底文言[年月日なし]へフォールバックする）
function resolveBojPeriodJa(entry, source) {
  if (source.id !== 'jp_boj') return null;
  if (entry.kind !== 'opinions_summary' && entry.kind !== 'minutes_summary') return null;
  const policyRateDates = (source.schedule || []).filter((e) => e.kind === 'policy_rate').map((e) => e.date);
  const indexFromMostRecent = entry.kind === 'opinions_summary' ? 0 : 1;
  const range = resolveBojMeetingRange(policyRateDates, entry.date, indexFromMostRecent);
  if (!range) return null;
  return entry.kind === 'opinions_summary'
    ? naming.formatOpinionsPeriod(range.meetingStart, range.meetingEnd)
    : naming.formatMinutesPeriod(range.meetingStart, range.meetingEnd);
}

// SPEC §4.2の規則生成命名kind一覧（scripts/lib/build-ledger.jsのresolveRuleGeneratedNameが担当する
// kind群と一致させる）。これ以外のkind（pmi_ism・trade_balance・employment_situation等、
// config/event-names.json辞書照合対象）はresolveAnnualDictionaryNameで解決する
const RULE_GENERATED_KINDS = new Set([
  'policy_rate', 'press_conference', 'testimony', 'opinions_summary',
  'minutes_summary', 'quarterly_report', 'official_speech', 'bond_auction',
]);

// annual_schedule_config型のschedule entry（{date, kind, subtype?, note?}）には抽出元の生テキストが
// 無いため、resolveCandidateEventのようなキーワード部分一致（config/event-names.jsonのmatch）は
// 使えない。country×kindでevent-names.jsonエントリが一意に決まる場合はそのまま使い、複数候補がある
// 場合（例: US pmi_ism=ISM製造業/非製造業の2エントリ）はentry.subtypeで絞り込む
// （2026-08-15新設。displayNameを常にnullで返す設計[task #27]にした結果、annual_schedule_config由来の
// 辞書照合kindの名称が一切解決されなくなっていたための修正）
function resolveAnnualDictionaryName(entry, source, eventNames) {
  if (RULE_GENERATED_KINDS.has(entry.kind)) return null; // naming.js側（build-ledger.js）の担当
  const candidates = (eventNames || []).filter((e) => e.country === source.country && e.kind === entry.kind);
  if (candidates.length === 1) return candidates[0].display_name;
  if (candidates.length > 1 && entry.subtype) {
    // 現状ISM（us_ism）のみがsubtypeを持つ。match keywordの先頭が「kind種別+subtype」で
    // 始まるものを選ぶ（部分一致だと「non-manufacturing」が「manufacturing」を誤って含んでしまうため
    // startsWithで位置まで見る）
    const hit = candidates.find((e) => (e.match || []).some((k) => k.toLowerCase().startsWith(`ism ${entry.subtype}`)));
    if (hit) return hit.display_name;
  }
  return null;
}

// annual_schedule_config型のmatchedEntries（{date, kind, note?}）を、他ソース由来のthisWeek
// 候補と同じ形（date/time/kind/country/importance/displayName）へ変換する。
// SPEC §4.2の規則生成命名kind（policy_rate等）は解決しない（scripts/lib/build-ledger.jsの
// resolveRuleGeneratedName()がnaming.js経由で解決する。displayName:nullのままにしておくことで
// そちらへ処理を委ねる）。辞書照合kindはresolveAnnualDictionaryName（上記）で解決する
export function annualEntryToCandidate(entry, source, importanceRules, eventNames) {
  const at = source.announce_time_by_kind?.[entry.kind];
  const base = {
    date: entry.date,
    kind: entry.kind,
    country: source.country,
    importance: resolveImportance(entry.kind, source.country, importanceRules),
    displayName: resolveAnnualDictionaryName(entry, source, eventNames),
    periodJa: resolveBojPeriodJa(entry, source),
    sourceId: source.id,
    note: entry.note,
    // 台帳のsource_evidence用: 年次確定スケジュールのnoteが無ければ確定記録自体を根拠として使う
    sourceEvidence: entry.note || `${source.name_ja} 年次確定スケジュール（confirmed_at=${source.confirmed_at || '未確定'}, confirmed_by=${source.confirmed_by || '未確定'}）`,
    localDate: entry.date,
    localTime: at?.local_time || null,
    tz: at?.tz || null,
  };
  if (!at) return { ...base, time: null, timeNote: 'announce_time_by_kind未設定' };
  const [y, mo, d] = entry.date.split('-').map(Number);
  const [h, mi] = at.local_time.split(':').map(Number);
  const jst = zonedWallTimeToJst(y, mo, d, h, mi, at.tz);
  return { ...base, date: jst.date, time: jst.time };
}

// report（runChecks()の戻り値）から候補イベントの統合一覧・★★★の停止目安（簡易版）を組み立てる。
// manualEventsConfig（config/manual-events.json）を渡すと、対象週に該当する手動登録イベント
// （RBA証言等の突発イベント。scripts/lib/manual-events.js）も他ソースと同列の候補として取り込む。
// eventNames（config/event-names.json.entries）はannual_schedule_config由来の辞書照合kind
// （pmi_ism等）の名称解決に使う（省略可。省略時はresolveAnnualDictionaryNameが常にnullを返す）
export function buildObservationSummary(report, sourcesConfig, importanceRules, manualEventsConfig, eventNames) {
  const candidates = [];
  for (const r of report.results) {
    if (r.skipped) continue;
    if (Array.isArray(r.thisWeek)) {
      for (const c of r.thisWeek) candidates.push({ ...c, sourceId: r.id });
    }
    if (Array.isArray(r.matchedEntries)) {
      const source = sourcesConfig.sources.find((s) => s.id === r.id);
      for (const e of r.matchedEntries) candidates.push(annualEntryToCandidate(e, source, importanceRules, eventNames));
    }
  }
  if (manualEventsConfig) {
    candidates.push(...candidatesForTargetWeek(manualEventsConfig, report.targetWeek.start, report.targetWeek.end));
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
  const manualEventsConfig = JSON.parse(readFileSync('config/manual-events.json', 'utf8'));
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

  const summary = buildObservationSummary(report, sourcesConfig, importanceRules, manualEventsConfig, eventNames);

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
