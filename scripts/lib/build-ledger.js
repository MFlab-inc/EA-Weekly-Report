'use strict';
// 根拠台帳（data/ledger/YYYY-MM-DD.json）の生成（task #13、しょうさん指示2026-08-15で新設）。
// scripts/checkers/harness.mjsのrunChecks()結果＋config/manual-events.jsonの候補を、
// scripts/lib/validate-ledger.jsのスキーマへ変換する。
// 「1イベント＝1レコード、出典を必ず持つ」の一点に絞った設計（旧Manusスキーマは継承しない。
// docs/ledger-schema.md参照）。
const { parseYmd, addDays, formatYmd } = require('./dates');
const { computeHaltWindow } = require('./halt-schedule');

// ISO国コード→通貨コード（レンダラー用のconfig/country-currency-map.jsonは日本語国名キーのため
// 台帳用に別途保持する。台帳のcountryはISOコードで統一するため）
const CURRENCY_BY_COUNTRY = {
  JP: 'JPY', US: 'USD', GB: 'GBP', AU: 'AUD', EU: 'EUR',
  NZ: 'NZD', CA: 'CAD', CH: 'CHF', CN: 'CNY',
};

// 表示名が未解決（辞書照合を経由しないSPEC §4.2の規則生成kind）の場合の暫定日本語ラベル。
// naming.jsによる正式な命名テンプレート（「{人名}{役職}の記者会見」等）統合までの暫定措置
// （name_resolution="rule_generated"として明示するため、これが最終形ではないことは台帳上も分かる）
const FALLBACK_KIND_LABEL = {
  policy_rate: '政策金利発表',
  press_conference: '記者会見',
  testimony: '議会証言',
  opinions_summary: '金融政策の議論の概要',
  minutes_summary: '議事要旨',
  quarterly_report: '四半期報告',
  official_speech: '要人発言',
  bond_auction: '国債入札',
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

// 分（負数・1440以上も許容、halt-schedule.jsのstartMin/endMinと同じ規約）を、
// baseDate（'YYYY-MM-DD'）起点のJST ISO日時（+09:00）へ変換する
function minutesToJstIso(baseDate, minutes) {
  const dayOffset = Math.floor(minutes / 1440);
  const minuteOfDay = ((minutes % 1440) + 1440) % 1440;
  const date = formatYmd(addDays(parseYmd(baseDate), dayOffset));
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  return `${date}T${pad2(h)}:${pad2(m)}:00+09:00`;
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function makeEventId(candidate, usedIds) {
  const base = `${(candidate.country || 'xx').toLowerCase()}-${candidate.kind}-${candidate.date}`;
  let id = base;
  let n = 2;
  while (usedIds.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  usedIds.add(id);
  return id;
}

// 1件の候補（resolveCandidateEvent/annualEntryToCandidate/manualEntryToCandidateいずれかの出力。
// date/time/kind/country/importance/displayName/sourceId/sourceEvidence/localDate/localTime/tz
// を持つ共通形）を台帳イベントへ変換する。importance未設定・0（非掲載）は呼び出し側でフィルタ済みの前提
function candidateToLedgerEvent(candidate, usedIds) {
  const timeStatus = candidate.time ? 'published' : 'unpublished';
  const datetimeJst = candidate.time ? `${candidate.date}T${candidate.time}:00+09:00` : null;
  const nameJa = candidate.displayName || FALLBACK_KIND_LABEL[candidate.kind] || `[${candidate.kind}]`;

  let haltStart = null;
  let haltEnd = null;
  if (candidate.importance === 3 && timeStatus === 'published') {
    const w = computeHaltWindow({ date: candidate.date, firstTime: candidate.time });
    haltStart = minutesToJstIso(candidate.date, w.startMin);
    haltEnd = minutesToJstIso(candidate.date, w.endMin);
  }

  return {
    event_id: makeEventId(candidate, usedIds),
    date_local: candidate.localDate || candidate.date,
    time_local: candidate.localTime || null,
    tz: candidate.tz || null,
    date_jst: candidate.date,
    datetime_jst: datetimeJst,
    time_status: timeStatus,
    country: candidate.country,
    currency: CURRENCY_BY_COUNTRY[candidate.country] || candidate.country,
    kind: candidate.kind,
    name_ja: nameJa,
    importance: candidate.importance,
    source_id: candidate.sourceId,
    source_evidence: candidate.sourceEvidence || candidate.rawTitle || candidate.note || '',
    name_resolution: candidate.displayName ? 'dictionary' : 'rule_generated',
    halt_window_start_jst: haltStart,
    halt_window_end_jst: haltEnd,
    bundle_id: null,
  };
}

// report.results（runChecks()の戻り値）から{country,kind,importance,...}候補一覧を集める。
// annualEntryToCandidateはscripts/phase1/observation-run.mjs（ESM）にあるため、呼び出し側から
// 変換済み候補配列として渡す設計にする（build-ledger.js自体はCJSに保つ。他scripts/lib/*.jsと同じ規約）
function buildSourcesSection(report, sourcesConfig, generatedAt) {
  const sources = [];
  for (const r of report.results) {
    const source = sourcesConfig.sources.find((s) => s.id === r.id);
    const url = source?.access?.targets?.[0]?.url || source?.access?.manual_verify_url || source?.fred?.api_base || null;
    let failClosedDecision = 'OK';
    if (r.skipped) failClosedDecision = 'SKIPPED';
    else if (!r.ok) failClosedDecision = report.outcome.status === 'HOLD' ? 'HOLD' : 'WARN';
    sources.push({
      source_id: r.id,
      type: source?.type || 'weekly_scrape',
      fetched_at: generatedAt,
      url: url || 'unknown',
      ok: r.skipped ? true : Boolean(r.ok),
      http_status: null,
      extractor_result_count: (r.thisWeek?.length ?? r.matchedEntries?.length ?? 0),
      robots_checked: Boolean(source?.access?.robots_check),
      fail_closed_decision: failClosedDecision,
    });
  }
  return sources;
}

// candidates: buildObservationSummary()と同じ形の候補配列（manual含む）。importance 0/nullは
// 呼び出し側で除外済みの前提（0=非掲載は台帳に載せない、というスキーマ規約のため）
function buildEventsSection(candidates) {
  const usedIds = new Set();
  return candidates.map((c) => candidateToLedgerEvent(c, usedIds));
}

function buildManualSourceEntry(manualEventsConfig, targetWeekStart, targetWeekEnd, generatedAt) {
  const count = (manualEventsConfig?.entries || []).filter((e) => e.date >= targetWeekStart && e.date <= targetWeekEnd).length;
  return {
    source_id: 'manual',
    type: 'manual',
    fetched_at: generatedAt,
    url: 'config/manual-events.json',
    ok: true,
    http_status: null,
    extractor_result_count: count,
    robots_checked: false,
    fail_closed_decision: 'OK',
  };
}

// meta.warnings/holdsの文字列一覧を組み立てる
function buildMetaMessages(report) {
  const warnings = [];
  const holds = [];
  if (report.outcome.status === 'WARN') warnings.push(...(report.outcome.reasons || []));
  if (report.outcome.status === 'HOLD') holds.push(...(report.outcome.reasons || []));
  warnings.push(...(report.residualWarnings || []).map((w) => `残量監視WARN: ${w.id} — ${w.warn}`));
  warnings.push(...(report.recurringMissingWarnings || []));
  return { warnings, holds };
}

// メインの組み立て関数。
// candidates: 対象週の全候補（manual含む・importance 0/null除外済み）
// recurringChecksStatus: [{name, applies_this_week, found}]（呼び出し側でimportanceRules.recurring_checks
//   とmatchesRecurringRule/report.resultsのfoundKindsから組み立てる。ESM依存関数を含むため
//   build-ledger.js自体には持たせず、呼び出し側[scripts/phase1/以下]で計算して渡す）
function buildLedger({
  report,
  sourcesConfig,
  manualEventsConfig,
  candidates,
  expectedCoverageResult,
  recurringChecksStatus,
  pipelineVersion,
  generatedAt,
}) {
  const { warnings, holds } = buildMetaMessages(report);
  const outcome = report.outcome.status === 'HOLD' ? 'HOLD' : 'PUBLISH_READY';

  const sources = buildSourcesSection(report, sourcesConfig, generatedAt);
  sources.push(buildManualSourceEntry(manualEventsConfig, report.targetWeek.start, report.targetWeek.end, generatedAt));

  const events = buildEventsSection(candidates);

  return {
    meta: {
      schema_version: '1.0',
      generated_at: generatedAt,
      target_week_start: report.targetWeek.start,
      target_week_end: report.targetWeek.end,
      pipeline_version: pipelineVersion,
      outcome,
      warnings,
      holds,
    },
    sources,
    events,
    coverage: {
      expected_coverage: {
        required: expectedCoverageResult.required.length,
        missing: expectedCoverageResult.missing,
      },
      recurring_checks: recurringChecksStatus || [],
    },
  };
}

module.exports = {
  buildLedger,
  candidateToLedgerEvent,
  makeEventId,
  minutesToJstIso,
  CURRENCY_BY_COUNTRY,
  FALLBACK_KIND_LABEL,
};
