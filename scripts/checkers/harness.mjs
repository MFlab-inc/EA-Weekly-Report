#!/usr/bin/env node
// 公式ソースチェッカー共通ハーネス（SPEC §3.1・§3.4・§3.5）。
// config/official-sources.json を読み込み、type別に対象週の候補イベントを照合し、
// 失敗があればフェールクローズ判定（scripts/lib/fail-closed.js）でOK/WARN/HOLDを決める。
//
// I/O（fetch・ファイル書き込み）とロジックを分離してある: runChecks()以下は
// fetchImpl・robotsCheckerを引数で受け取る純粋寄りの関数のため、テストではfetchを
// モックして実ネットワークなしに検証できる。main()のみが実際のconfig読み込み・fetch・
// ファイル書き込みを行うCLIエントリ。
//
// 現状（2026-08-14）: weekly_scrapeソースの実データ抽出ルールは未実装（task #9で実装）。
// そのためweekly_scrapeソースはfetch自体が成功しても「抽出未実装」でok:falseを返す。
// これは意図的な挙動（フェールクローズ設計により、抽出ロジックが無い状態で誤った
// 「イベントなし」を返すよりは、明示的に未実装として扱う）。実運用cron（weekly.yml）には
// task #12までworkflows-draft/から移設しないため、現時点でこのハーネスがHOLDを返しても
// 実配信には影響しない。
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTargetWeek, formatYmd, parseYmd, addDays } from '../lib/dates.js';
import { decideRunOutcome, isExpectedThisWeek, checkResidualMonitoring, checkRecurringMissing } from '../lib/fail-closed.js';
import { matchesRecurringRule } from '../lib/recurring-rules.js';
import { createRobotsChecker } from '../lib/robots.js';

export const USER_AGENT = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; checker-harness)';

// recurring_checks の名称→担当kindの対応。現状2件のみ（config/importance-rules.json）。
// ルールが増えたらここに追記する
const RECURRING_CHECK_KIND = {
  米雇用統計: 'employment_situation',
  米CPI: 'cpi',
};

function isWithinWeek(dateStr, weekStartStr, weekEndStr) {
  return dateStr >= weekStartStr && dateStr <= weekEndStr;
}

export async function checkFredSource(source, targetWeek, { fetchImpl = fetch, apiKey } = {}) {
  // targetWeek.targetWeekStart/targetWeekEnd は既に 'YYYY-MM-DD' 文字列（scripts/lib/dates.js）。
  // 日付演算にはparseYmd（文字列→疑似Date）とaddDaysを使う（.getTime()は文字列には無い）
  const weekStart = targetWeek.targetWeekStart;
  const weekEnd = targetWeek.targetWeekEnd;
  const rangeStart = formatYmd(addDays(parseYmd(weekStart), -30));
  const rangeEnd = formatYmd(addDays(parseYmd(weekEnd), 30));
  if (!apiKey) {
    return { ok: false, reason: 'FRED_API_KEY未設定', annualConfigHasTargetWeek: false, recurringCheckMatches: false, foundKinds: [] };
  }
  const releaseResults = [];
  for (const rel of source.fred.releases) {
    const url = new URL(source.fred.api_base);
    url.searchParams.set('release_id', String(rel.release_id));
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('file_type', 'json');
    url.searchParams.set('sort_order', 'asc');
    url.searchParams.set('realtime_start', rangeStart);
    url.searchParams.set('realtime_end', rangeEnd);
    url.searchParams.set('include_release_dates_with_no_data', 'true');
    let res;
    try {
      res = await fetchImpl(url.toString());
    } catch (e) {
      releaseResults.push({ kind: rel.kind, releaseId: rel.release_id, ok: false, error: String(e?.message || e) });
      continue;
    }
    if (!res.ok) {
      releaseResults.push({ kind: rel.kind, releaseId: rel.release_id, ok: false, error: `HTTP ${res.status}` });
      continue;
    }
    const body = await res.json();
    const dates = (body?.release_dates || []).map((d) => d.date);
    const foundDate = dates.find((d) => isWithinWeek(d, weekStart, weekEnd)) || null;
    releaseResults.push({ kind: rel.kind, releaseId: rel.release_id, ok: true, foundDate });
  }
  const ok = releaseResults.every((r) => r.ok);
  const foundKinds = releaseResults.filter((r) => r.foundDate).map((r) => r.kind);
  // recurringCheckMatchesはrunChecks()側でmatchesRecurringRule（実際の対象週日付に基づく判定）が
  // 一元的に計算する。ここでは未設定（false）にしておく（二重計算・不整合を避けるため）
  return { ok, releaseResults, foundKinds, annualConfigHasTargetWeek: false, recurringCheckMatches: false, reason: ok ? undefined : 'FREDリリース取得の一部が失敗' };
}

// annual_schedule_config型は週次のfetchを行わない（年次で確定済みのscheduleを照合するのみ）ため、
// 「失敗」の概念自体がない。okは常にtrue。対象週の該当有無・残量監視は別途返す
export function checkAnnualScheduleSource(source, targetWeek) {
  const weekStart = targetWeek.targetWeekStart;
  const weekEnd = targetWeek.targetWeekEnd;
  const schedule = source.schedule || [];
  const matched = schedule.filter((e) => isWithinWeek(e.date, weekStart, weekEnd));
  return {
    ok: true,
    annualConfigHasTargetWeek: matched.length > 0,
    recurringCheckMatches: false,
    foundKinds: [...new Set(matched.map((e) => e.kind))],
    matchedEntries: matched,
  };
}

// weekly_scrape型: robots.txt確認→フェッチのみ実施。実データからの日程抽出ルールは
// task #9で発表元ごとに実装するため、現状は「抽出未実装」で明示的に失敗を返す
export async function checkWeeklyScrapeSource(source, targetWeek, { fetchImpl = fetch, robotsChecker } = {}) {
  const targets = source.access?.targets || [];
  if (targets.length === 0) {
    return { ok: false, reason: '対象URL未設定（recon未実施）', annualConfigHasTargetWeek: false, recurringCheckMatches: false, foundKinds: [] };
  }
  const fetched = [];
  for (const t of targets) {
    if (source.access?.robots_check && robotsChecker) {
      const verdict = await robotsChecker.isAllowed(t.url);
      if (!verdict.allowed) {
        fetched.push({ label: t.label, ok: false, reason: verdict.reason });
        continue;
      }
    }
    try {
      const res = await fetchImpl(t.url);
      fetched.push({ label: t.label, ok: Boolean(res?.ok), status: res?.status });
    } catch (e) {
      fetched.push({ label: t.label, ok: false, reason: String(e?.message || e) });
    }
  }
  const anyFetchOk = fetched.some((f) => f.ok);
  return {
    ok: false,
    reason: anyFetchOk
      ? '抽出ルール未実装（task #9で発表元別の抽出処理を追加する）'
      : `全対象URLの取得に失敗: ${fetched.map((f) => f.reason || f.status).join(' / ')}`,
    fetched,
    annualConfigHasTargetWeek: false,
    recurringCheckMatches: false,
    foundKinds: [],
  };
}

export async function runChecks({ sourcesConfig, importanceRules, targetWeek, fetchImpl = fetch, apiKey, robotsChecker } = {}) {
  const results = [];
  for (const source of sourcesConfig.sources) {
    if (source.status === 'pending_recon') {
      results.push({ id: source.id, skipped: true, reason: 'pending_recon（優先度B・task #11で実測予定）' });
      continue;
    }
    let result;
    if (source.type === 'date_api_fred') {
      result = await checkFredSource(source, targetWeek, { fetchImpl, apiKey });
    } else if (source.type === 'annual_schedule_config') {
      result = checkAnnualScheduleSource(source, targetWeek);
    } else {
      result = await checkWeeklyScrapeSource(source, targetWeek, { fetchImpl, robotsChecker });
    }
    const recurringCheckMatches = (source.recurring_check_refs || []).some((name) => {
      const rule = (importanceRules?.recurring_checks || []).find((r) => r.name === name);
      return rule && matchesRecurringRule(rule, targetWeek.dates.map((d) => d.date));
    });
    results.push({ id: source.id, ...result, recurringCheckMatches: result.recurringCheckMatches || recurringCheckMatches });
  }

  const failures = results
    .filter((r) => !r.skipped && !r.ok)
    .map((r) => ({
      sourceId: r.id,
      expected: isExpectedThisWeek({
        annualConfigHasTargetWeek: r.annualConfigHasTargetWeek,
        recurringCheckMatches: r.recurringCheckMatches,
        ffHintPresent: false,
      }),
    }));

  const outcome = decideRunOutcome(failures);

  const residualWarnings = sourcesConfig.sources
    .filter((s) => s.type === 'annual_schedule_config')
    .map((s) => ({
      id: s.id,
      ...checkResidualMonitoring(
        (s.schedule || []).map((e) => e.date),
        targetWeek.targetWeekStart,
        s.residual_monitor_weeks || sourcesConfig.residual_monitor_default_weeks || 4
      ),
    }))
    .filter((r) => !r.ok);

  const recurringMissingWarnings = checkRecurringMissing(
    importanceRules?.recurring_checks,
    targetWeek,
    (rule) => matchesRecurringRule(rule, targetWeek.dates.map((d) => d.date)),
    (rule) => {
      const kind = RECURRING_CHECK_KIND[rule.name];
      return results.some((r) => r.foundKinds?.includes(kind));
    }
  );

  return {
    targetWeek: { start: targetWeek.targetWeekStart, end: targetWeek.targetWeekEnd },
    results,
    failures,
    outcome,
    residualWarnings,
    recurringMissingWarnings,
  };
}

async function main() {
  const sourcesConfig = JSON.parse(readFileSync('config/official-sources.json', 'utf8'));
  const importanceRules = JSON.parse(readFileSync('config/importance-rules.json', 'utf8'));
  const targetWeek = getTargetWeek();
  const robotsChecker = createRobotsChecker({ userAgent: USER_AGENT });
  const report = await runChecks({
    sourcesConfig,
    importanceRules,
    targetWeek,
    fetchImpl: fetch,
    apiKey: process.env.FRED_API_KEY,
    robotsChecker,
  });
  mkdirSync('phase1-out', { recursive: true });
  writeFileSync(join('phase1-out', 'official-sources-check-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.outcome.status === 'HOLD') process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
