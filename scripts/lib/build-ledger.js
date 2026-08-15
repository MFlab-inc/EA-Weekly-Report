'use strict';
// 根拠台帳（data/ledger/YYYY-MM-DD.json）の生成（task #13、しょうさん指示2026-08-15で新設）。
// scripts/checkers/harness.mjsのrunChecks()結果＋config/manual-events.jsonの候補を、
// scripts/lib/validate-ledger.jsのスキーマへ変換する。
// 「1イベント＝1レコード、出典を必ず持つ」の一点に絞った設計（旧Manusスキーマは継承しない。
// docs/ledger-schema.md参照）。
const { parseYmd, addDays, formatYmd } = require('./dates');
const { computeHaltWindow } = require('./halt-schedule');
const naming = require('./naming');

// ISO国コード→通貨コード（レンダラー用のconfig/country-currency-map.jsonは日本語国名キーのため
// 台帳用に別途保持する。台帳のcountryはISOコードで統一するため）
const CURRENCY_BY_COUNTRY = {
  JP: 'JPY', US: 'USD', GB: 'GBP', AU: 'AUD', EU: 'EUR',
  NZ: 'NZD', CA: 'CAD', CH: 'CHF', CN: 'CNY',
};

// 表示名が未解決（辞書照合を経由しないSPEC §4.2の規則生成kind）の場合の暫定日本語ラベル。
// resolveRuleGeneratedName()（下記）が対応できないkind向けの最終フォールバック
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

// 国債入札のissueYearMonthJa（発行年月、例「2026年8月」）。発表元記載の発行月そのものではなく、
// 既刊ground truth2件（jp_jgb_10y_auction_20260804・jp_jgb_30y_auction_20260806）で
// 入札日=発行月が一致することを確認済みの近似として、候補date（=入札日）の年月から導出する
// （docs/ledger-schema.md参照）
function issueYearMonthJaFromDate(dateStr) {
  const [y, m] = dateStr.split('-');
  return `${y}年${Number(m)}月`;
}

// official_speech（要人発言）の役職ラベル。country単位で1つに決め打ちできる情報源のみ登録する
// （2026-08-15時点、情報源はus_frb_speeches[FRB理事講演RSS]のみ）
const OFFICIAL_SPEECH_ROLE_BY_COUNTRY = {
  US: 'FRB理事',
};

// SPEC §4.2の規則生成命名テンプレート（scripts/lib/naming.js）による解決を試みる。
// - policy_rate/quarterly_report: candidate.country（naming.BANK_ABBR_BY_COUNTRY）のみで解決可能
// - press_conference: officials（country×role_type=central_bank_governor）で解決可能
// - opinions_summary/minutes_summary: BOJ（country=JP）限定。candidate.periodJa
//   （scripts/phase1/observation-run.mjsのresolveBojPeriodJaが算出）が無くても年月日なしの
//   基底文言を返す（FALLBACK_KIND_LABELの汎用ラベルより情報量が多いため常に優先する）。
//   SNB等JP以外のopinions_summaryはBOJ固有の文言のため対象外（FALLBACK_KIND_LABELへ）
// - bond_auction: candidate.tenorJa（mof.js/us-treasury.jsが抽出）が無ければ対象外。
//   country=JP/USのみテンプレートが定義されている（SPEC §4.2）
// - official_speech: candidate.speakerLastNameをofficials.jsonと照合（naming.resolveOfficialBySurname）。
//   不一致（未登録・未指定とも）でもnaming.speechNameがverified:falseと同じ扱いで役職のみを返す。
//   2026-08-15時点officials.jsonにFRB理事個人（議長以外）は未登録（task #17）のため実運用では
//   常に役職のみになる
// - testimony: manual-events.json由来の候補は常にcandidate.displayNameを持つため、
//   本関数を経由する前にcandidateToLedgerEvent側で優先採用される（対象外）
function resolveRuleGeneratedName(candidate, officials) {
  if (candidate.kind === 'policy_rate' || candidate.kind === 'quarterly_report') {
    const bankAbbr = naming.BANK_ABBR_BY_COUNTRY[candidate.country];
    if (!bankAbbr) return null;
    return candidate.kind === 'policy_rate' ? naming.policyRateName(bankAbbr) : naming.quarterlyReportName(bankAbbr);
  }
  if (candidate.kind === 'press_conference') {
    const official = naming.resolveGovernor(officials, candidate.country);
    return official ? naming.pressConferenceName(official, official.role_ja) : null;
  }
  if (candidate.kind === 'opinions_summary' && candidate.country === 'JP') {
    return naming.bojOpinionsName(candidate.periodJa);
  }
  if (candidate.kind === 'minutes_summary' && candidate.country === 'JP') {
    return naming.bojMinutesName(candidate.periodJa);
  }
  if (candidate.kind === 'bond_auction' && candidate.tenorJa) {
    const issueYearMonthJa = issueYearMonthJaFromDate(candidate.date);
    if (candidate.country === 'JP') return naming.bondAuctionNameJp(candidate.tenorJa, issueYearMonthJa);
    if (candidate.country === 'US') return naming.bondAuctionNameUs(candidate.tenorJa);
    return null;
  }
  if (candidate.kind === 'official_speech') {
    const roleJa = OFFICIAL_SPEECH_ROLE_BY_COUNTRY[candidate.country];
    if (!roleJa) return null;
    const official = naming.resolveOfficialBySurname(officials, candidate.speakerLastName);
    return naming.speechName(official, roleJa);
  }
  return null;
}

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
// を持つ共通形）を台帳イベントへ変換する。importance未設定・0（非掲載）は呼び出し側でフィルタ済みの前提。
// officials: config/officials.jsonのofficials配列（省略可。省略時はresolveRuleGeneratedNameが
// 常にnullを返しFALLBACK_KIND_LABELへ落ちる＝既存呼び出し元との後方互換を保つ）
function candidateToLedgerEvent(candidate, usedIds, officials) {
  const timeStatus = candidate.time ? 'published' : 'unpublished';
  const datetimeJst = candidate.time ? `${candidate.date}T${candidate.time}:00+09:00` : null;
  const nameJa = candidate.displayName
    || resolveRuleGeneratedName(candidate, officials)
    || FALLBACK_KIND_LABEL[candidate.kind]
    || `[${candidate.kind}]`;

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
function buildEventsSection(candidates, officials) {
  const usedIds = new Set();
  return candidates.map((c) => candidateToLedgerEvent(c, usedIds, officials));
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
// officialsConfig: config/officials.jsonのパース済みオブジェクト（省略可。SPEC §4.2の規則生成命名
//   テンプレートのうちpolicy_rate/quarterly_report/press_conferenceの解決に使う。省略時はこれらも
//   FALLBACK_KIND_LABELへフォールバックする）
// recurringChecksStatus: [{name, applies_this_week, found}]（呼び出し側でimportanceRules.recurring_checks
//   とmatchesRecurringRule/report.resultsのfoundKindsから組み立てる。ESM依存関数を含むため
//   build-ledger.js自体には持たせず、呼び出し側[scripts/phase1/以下]で計算して渡す）
function buildLedger({
  report,
  sourcesConfig,
  manualEventsConfig,
  officialsConfig,
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

  const events = buildEventsSection(candidates, officialsConfig?.officials);

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
  resolveRuleGeneratedName,
  makeEventId,
  minutesToJstIso,
  CURRENCY_BY_COUNTRY,
  FALLBACK_KIND_LABEL,
};
