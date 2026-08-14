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
// 2026-08-14: weekly_scrapeソースのうちus_census/au_abs/gb_onsは発表元別の抽出ルールを実装済み
// （scripts/checkers/extractors/・実データfixtureで既刊ground truthと一致確認済み。docs/phase1-official-sources.md参照）。
// nz_statsnz/ca_statcanは実測の結果、静的HTML取得だけでは日程一覧を抽出できないことが判明した
// （SPAのJS描画・検索フォームのAJAX結果のため）。この2元は EXTRACTORS未登録のまま=「抽出ルール未実装」で
// 明示的にok:falseを返す（フェールクローズ設計により、抽出ロジックが無い状態で誤って「イベントなし」を
// 返すことはしない）。実運用cron（weekly.yml）にはtask #12までworkflows-draft/から移設しないため、
// 現時点でこのハーネスがHOLDを返しても実配信には影響しない。
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTargetWeek, formatYmd, parseYmd, addDays } from '../lib/dates.js';
import { decideRunOutcome, isExpectedThisWeek, checkResidualMonitoring, checkRecurringMissing } from '../lib/fail-closed.js';
import { matchesRecurringRule } from '../lib/recurring-rules.js';
import { createRobotsChecker } from '../lib/robots.js';
import { resolveCandidateEvent, resolveKindCandidates } from '../lib/resolve-candidate.js';
import { extractCensusCalendar } from './extractors/census.js';
import { extractAbsCalendar } from './extractors/abs.js';
import { extractOnsReleases } from './extractors/ons.js';
import { extractNzNextRelease } from './extractors/nz-statsnz.js';

export const USER_AGENT = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; checker-harness)';

// recurring_checks の名称→担当kindの対応（config/importance-rules.json）。
// ルールが増えたらここに追記する
const RECURRING_CHECK_KIND = {
  米雇用統計: 'employment_situation',
  米CPI: 'cpi',
  // RBA総裁下院経済委員会証言（testimony）は担当ソース未定義（task #18）のため、
  // このWARNは恒常的に出続ける想定。しょうさんが手動でその週の実施有無を確認する運用
  RBA総裁下院経済委員会証言: 'testimony',
};

// weekly_scrapeソースごとの抽出関数レジストリ。source.idで引く。
// primaryLabel: source.access.targetsのうち抽出に使うfetch結果のlabel
// parseFn: 生テキスト → { ok, rows } （rows内の各行を toRow() で共通行形式へ変換）
// toRow: 抽出結果の1行 → { title, date?, localTime?, utcInstant? }（resolveCandidateEventの入力形）
const WEEKLY_SCRAPE_EXTRACTORS = {
  us_census: {
    primaryLabel: 'calendar_listview',
    parseFn: extractCensusCalendar,
    toRow: (r) => ({ title: r.title, date: r.date, localTime: r.localTime }),
  },
  au_abs: {
    primaryLabel: 'future_releases_calendar',
    parseFn: extractAbsCalendar,
    toRow: (r) => ({ title: r.title, utcInstant: r.utcInstant }),
  },
  gb_ons: {
    primaryLabel: 'releases_api_upcoming_gdp',
    parseFn: extractOnsReleases,
    toRow: (r) => ({ title: r.title, utcInstant: r.utcInstant }),
  },
  // titleは固定文字列（このソースはLabour market statistics専用の抽出のため、汎用カレンダーの
  // ような複数系列スクレイプではない）。localTimeはconfig/official-sources.jsonの
  // nz_statsnz.announce_time_by_kind.employment_situation.local_timeと同じ値を保つこと
  nz_statsnz: {
    primaryLabel: 'latest_labour_market_release',
    parseFn: extractNzNextRelease,
    toRow: (r) => ({ title: 'Labour market statistics', date: r.releaseDate, localTime: '10:45' }),
  },
};

function isWithinWeek(dateStr, weekStartStr, weekEndStr) {
  return dateStr >= weekStartStr && dateStr <= weekEndStr;
}

export async function checkFredSource(source, targetWeek, { fetchImpl = fetch, apiKey, eventNames = [], importanceRules } = {}) {
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
    let thisWeekCandidates = [];
    if (foundDate) {
      const timeCfg = source.announce_time_by_kind?.[rel.kind];
      thisWeekCandidates = resolveKindCandidates(foundDate, {
        country: source.country,
        kind: rel.kind,
        tz: timeCfg?.tz,
        localTime: timeCfg?.local_time,
        matchHint: rel.match_hint,
        eventNames,
        importanceRules,
      });
    }
    releaseResults.push({ kind: rel.kind, releaseId: rel.release_id, ok: true, foundDate, thisWeekCandidates });
  }
  const ok = releaseResults.every((r) => r.ok);
  const foundKinds = releaseResults.filter((r) => r.foundDate).map((r) => r.kind);
  const thisWeek = releaseResults.flatMap((r) => r.thisWeekCandidates || []).filter((c) => c.ok);
  // recurringCheckMatchesはrunChecks()側でmatchesRecurringRule（実際の対象週日付に基づく判定）が
  // 一元的に計算する。ここでは未設定（false）にしておく（二重計算・不整合を避けるため）
  return { ok, releaseResults, foundKinds, thisWeek, annualConfigHasTargetWeek: false, recurringCheckMatches: false, reason: ok ? undefined : 'FREDリリース取得の一部が失敗' };
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

// 生のタイトル文字列を、source.kindsのうちevent-names.jsonのmatchキーワードに一致する
// kindへ分類する。どのkindにも一致しなければnull（このソースが追跡していない無関係な行として無視する）
function classifyRowKind(row, source, eventNames) {
  for (const kind of source.kinds || []) {
    const entry = (eventNames || []).find(
      (e) => e.country === source.country && e.kind === kind && (e.match || []).some((k) => row.title.toLowerCase().includes(k.toLowerCase()))
    );
    if (entry) return kind;
  }
  return null;
}

// weekly_scrape型: robots.txt確認→フェッチ→（登録済みなら）発表元別の抽出処理。
// 抽出ルール未登録のソースは明示的に「抽出ルール未実装」の失敗を返す
// （フェールクローズ設計。誤って「イベントなし」を返さない）。
// nz_statsnzは2026-08-14にextractors/nz-statsnz.jsで登録済み（次回リリース予定日の
// 埋め込みテキストを抽出。access.targetsは直近公表ページを指す必要があり四半期ごとの
// 手動更新が必要 — next_release_maintenance参照）。ca_statcanは同日の再実測で年次PDFが
// 直接取得可能と判明しannual_schedule_config型へ再分類済み（本関数の対象外）
export async function checkWeeklyScrapeSource(source, targetWeek, { fetchImpl = fetch, robotsChecker, eventNames = [], importanceRules } = {}) {
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
      const body = res?.ok ? await res.text() : null;
      fetched.push({ label: t.label, ok: Boolean(res?.ok), status: res?.status, body });
    } catch (e) {
      fetched.push({ label: t.label, ok: false, reason: String(e?.message || e) });
    }
  }
  const anyFetchOk = fetched.some((f) => f.ok);
  if (!anyFetchOk) {
    return {
      ok: false,
      reason: `全対象URLの取得に失敗: ${fetched.map((f) => f.reason || f.status).join(' / ')}`,
      fetched: fetched.map(({ body, ...rest }) => rest),
      annualConfigHasTargetWeek: false,
      recurringCheckMatches: false,
      foundKinds: [],
    };
  }

  const extractor = WEEKLY_SCRAPE_EXTRACTORS[source.id];
  if (!extractor) {
    return {
      ok: false,
      reason: '抽出ルール未実装（発表元別の抽出処理が未登録。docs/phase1-official-sources.md参照）',
      fetched: fetched.map(({ body, ...rest }) => rest),
      annualConfigHasTargetWeek: false,
      recurringCheckMatches: false,
      foundKinds: [],
    };
  }

  const primary = fetched.find((f) => f.label === extractor.primaryLabel);
  if (!primary?.ok || !primary.body) {
    return {
      ok: false,
      reason: `抽出対象(${extractor.primaryLabel})の取得に失敗`,
      fetched: fetched.map(({ body, ...rest }) => rest),
      annualConfigHasTargetWeek: false,
      recurringCheckMatches: false,
      foundKinds: [],
    };
  }

  const parsed = extractor.parseFn(primary.body);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: `抽出失敗（構造変化の疑い）: ${parsed.reason}`,
      fetched: fetched.map(({ body, ...rest }) => rest),
      annualConfigHasTargetWeek: false,
      recurringCheckMatches: false,
      foundKinds: [],
    };
  }

  const rawRows = (parsed.rows || parsed.meetings || parsed.entries || parsed.releases || []).map(extractor.toRow);
  const candidates = [];
  const unregistered = [];
  for (const row of rawRows) {
    const kind = classifyRowKind(row, source, eventNames);
    if (!kind) continue; // このソースが追跡していない無関係な行
    const tz = source.announce_time_by_kind?.[kind]?.tz;
    const candidate = resolveCandidateEvent(row, { country: source.country, kind, tz, eventNames, importanceRules });
    if (!candidate.ok) {
      unregistered.push(candidate.reason);
      continue;
    }
    candidates.push(candidate);
  }

  // access.next_release_pointer: true のソース（例: nz_statsnz）向けの鮮度チェック。
  // 「直近に公表されたページ」を指すURLを四半期ごとに手動更新する運用のため、
  // 抽出結果（次回リリース予定日）が全件すでに対象週より過去＝URL更新漏れの疑いとして
  // 構造的失敗を返す（フェールクローズ規則へ接続。docs/annual-schedule-maintenance.md参照）
  if (source.access?.next_release_pointer && candidates.length > 0 && candidates.every((c) => c.date < targetWeek.targetWeekStart)) {
    return {
      ok: false,
      reason: `抽出結果（次回リリース予定日）がすべて対象週より過去（最新候補: ${candidates[candidates.length - 1].date}）。access.targetsのURL更新漏れの疑い（next_release_maintenance参照）`,
      fetched: fetched.map(({ body, ...rest }) => rest),
      annualConfigHasTargetWeek: false,
      recurringCheckMatches: false,
      foundKinds: [],
    };
  }

  const thisWeek = candidates.filter((c) => isWithinWeek(c.date, targetWeek.targetWeekStart, targetWeek.targetWeekEnd));

  return {
    ok: true,
    fetched: fetched.map(({ body, ...rest }) => rest),
    allCandidatesCount: candidates.length,
    thisWeek,
    unregistered,
    foundKinds: [...new Set(thisWeek.map((c) => c.kind))],
    annualConfigHasTargetWeek: false,
    recurringCheckMatches: false,
  };
}

export async function runChecks({ sourcesConfig, importanceRules, eventNames, targetWeek, fetchImpl = fetch, apiKey, robotsChecker } = {}) {
  const results = [];
  for (const source of sourcesConfig.sources) {
    if (source.status === 'pending_recon') {
      results.push({ id: source.id, skipped: true, reason: 'pending_recon（優先度B・task #11で実測予定）' });
      continue;
    }
    let result;
    if (source.type === 'date_api_fred') {
      result = await checkFredSource(source, targetWeek, { fetchImpl, apiKey, eventNames, importanceRules });
    } else if (source.type === 'annual_schedule_config') {
      result = checkAnnualScheduleSource(source, targetWeek);
    } else {
      result = await checkWeeklyScrapeSource(source, targetWeek, { fetchImpl, robotsChecker, eventNames, importanceRules });
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
  const eventNames = JSON.parse(readFileSync('config/event-names.json', 'utf8')).entries;
  const targetWeek = getTargetWeek();
  const robotsChecker = createRobotsChecker({ userAgent: USER_AGENT });
  const report = await runChecks({
    sourcesConfig,
    importanceRules,
    eventNames,
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
