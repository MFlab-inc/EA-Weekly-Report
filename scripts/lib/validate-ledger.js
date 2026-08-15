'use strict';
// 根拠台帳（data/ledger/YYYY-MM-DD.json）のスキーマ検証（task #13、しょうさん指示2026-08-15で新設）。
// 旧Manusスキーマ（reference/fx-ea-report-auditor-skill/references/verification-schema.md）は
// 継承しない。継承するのは「1イベント＝1レコード、出典を必ず持つ」という設計思想のみ。
// 目的は「掲載した各イベントの根拠を後から追跡できること」の一点に絞る。
const SCHEMA_VERSION = '1.0';
const SOURCE_TYPES = new Set(['date_api_fred', 'weekly_scrape', 'annual_schedule_config', 'manual']);
const OUTCOMES = new Set(['PUBLISH_READY', 'HOLD']);
const FAIL_CLOSED_DECISIONS = new Set(['OK', 'WARN', 'HOLD', 'SKIPPED']);
const NAME_RESOLUTIONS = new Set(['dictionary', 'rule_generated']);
const TIME_STATUSES = new Set(['published', 'unpublished']);
const IMPORTANCE_VALUES = new Set([2, 3]);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function validateMeta(meta, errors) {
  if (typeof meta !== 'object' || meta === null) {
    errors.push('meta: オブジェクトが必要です');
    return;
  }
  if (meta.schema_version !== SCHEMA_VERSION) errors.push(`meta.schema_version: "${SCHEMA_VERSION}"である必要があります`);
  if (!ISO_DATETIME_OFFSET_RE.test(meta.generated_at || '')) errors.push('meta.generated_at: オフセット付きISO日時が必要です');
  if (!ISO_DATE_RE.test(meta.target_week_start || '')) errors.push('meta.target_week_start: YYYY-MM-DD形式が必要です');
  if (!ISO_DATE_RE.test(meta.target_week_end || '')) errors.push('meta.target_week_end: YYYY-MM-DD形式が必要です');
  if (ISO_DATE_RE.test(meta.target_week_start || '') && ISO_DATE_RE.test(meta.target_week_end || '') && meta.target_week_end < meta.target_week_start) {
    errors.push('meta.target_week_end: target_week_start以後である必要があります');
  }
  if (!isNonEmptyString(meta.pipeline_version)) errors.push('meta.pipeline_version: 空でない文字列が必要です');
  if (!OUTCOMES.has(meta.outcome)) errors.push(`meta.outcome: ${[...OUTCOMES].join('|')}のいずれかが必要です`);
  if (!Array.isArray(meta.warnings)) errors.push('meta.warnings: 配列が必要です');
  if (!Array.isArray(meta.holds)) errors.push('meta.holds: 配列が必要です');
  if (meta.outcome === 'HOLD' && Array.isArray(meta.holds) && meta.holds.length === 0) {
    errors.push('meta.outcome=HOLDのときmeta.holdsは1件以上必要です（HOLDの理由が無い）');
  }
  if (meta.outcome === 'PUBLISH_READY' && Array.isArray(meta.holds) && meta.holds.length > 0) {
    errors.push('meta.outcome=PUBLISH_READYのときmeta.holdsは空である必要があります');
  }
}

function validateSource(source, index, errors, seenIds) {
  const tag = `sources[${index}]`;
  if (typeof source !== 'object' || source === null) {
    errors.push(`${tag}: オブジェクトが必要です`);
    return;
  }
  if (!isNonEmptyString(source.source_id)) errors.push(`${tag}.source_id: 空でない文字列が必要です`);
  else {
    if (seenIds.has(source.source_id)) errors.push(`${tag}.source_id: 重複しています: ${source.source_id}`);
    seenIds.add(source.source_id);
  }
  if (!SOURCE_TYPES.has(source.type)) errors.push(`${tag}.type: ${[...SOURCE_TYPES].join('|')}のいずれかが必要です`);
  if (!ISO_DATETIME_OFFSET_RE.test(source.fetched_at || '')) errors.push(`${tag}.fetched_at: オフセット付きISO日時が必要です`);
  if (!isNonEmptyString(source.url)) errors.push(`${tag}.url: 空でない文字列が必要です（manual型はconfig/manual-events.json等の論理パスでよい）`);
  if (typeof source.ok !== 'boolean') errors.push(`${tag}.ok: 真偽値が必要です`);
  if (source.http_status !== null && typeof source.http_status !== 'number') errors.push(`${tag}.http_status: 数値またはnullが必要です`);
  if (typeof source.extractor_result_count !== 'number' || source.extractor_result_count < 0) {
    errors.push(`${tag}.extractor_result_count: 0以上の数値が必要です`);
  }
  if (typeof source.robots_checked !== 'boolean') errors.push(`${tag}.robots_checked: 真偽値が必要です`);
  if (!FAIL_CLOSED_DECISIONS.has(source.fail_closed_decision)) {
    errors.push(`${tag}.fail_closed_decision: ${[...FAIL_CLOSED_DECISIONS].join('|')}のいずれかが必要です`);
  }
}

function validateEvent(event, index, errors, seenIds, sourceIds) {
  const tag = `events[${index}]`;
  if (typeof event !== 'object' || event === null) {
    errors.push(`${tag}: オブジェクトが必要です`);
    return null;
  }
  if (!isNonEmptyString(event.event_id)) errors.push(`${tag}.event_id: 空でない文字列が必要です`);
  else {
    if (seenIds.has(event.event_id)) errors.push(`${tag}.event_id: 重複しています: ${event.event_id}`);
    seenIds.add(event.event_id);
  }
  if (!ISO_DATE_RE.test(event.date_local || '')) errors.push(`${tag}.date_local: YYYY-MM-DD形式が必要です`);
  if (event.time_local !== null && !HHMM_RE.test(event.time_local || '')) errors.push(`${tag}.time_local: HH:MM形式またはnullが必要です`);
  if (event.tz !== null && !isNonEmptyString(event.tz)) errors.push(`${tag}.tz: 空でない文字列またはnullが必要です`);
  if ((event.time_local === null) !== (event.tz === null)) errors.push(`${tag}: time_localとtzは両方nullか両方非nullである必要があります`);
  if (!ISO_DATE_RE.test(event.date_jst || '')) errors.push(`${tag}.date_jst: YYYY-MM-DD形式が必要です`);
  if (event.datetime_jst !== null && !ISO_DATETIME_OFFSET_RE.test(event.datetime_jst || '')) {
    errors.push(`${tag}.datetime_jst: オフセット付きISO日時またはnullが必要です`);
  }
  if (!TIME_STATUSES.has(event.time_status)) errors.push(`${tag}.time_status: ${[...TIME_STATUSES].join('|')}のいずれかが必要です`);
  if (event.time_status === 'published' && event.datetime_jst === null) {
    errors.push(`${tag}: time_status=publishedのときdatetime_jstは必須です`);
  }
  if (event.time_status === 'unpublished' && event.datetime_jst !== null) {
    errors.push(`${tag}: time_status=unpublishedのときdatetime_jstはnullである必要があります`);
  }
  if (!isNonEmptyString(event.country)) errors.push(`${tag}.country: 空でない文字列が必要です`);
  if (!isNonEmptyString(event.currency)) errors.push(`${tag}.currency: 空でない文字列が必要です`);
  if (!isNonEmptyString(event.kind)) errors.push(`${tag}.kind: 空でない文字列が必要です`);
  if (!isNonEmptyString(event.name_ja)) errors.push(`${tag}.name_ja: 空でない文字列が必要です`);
  if (!IMPORTANCE_VALUES.has(event.importance)) errors.push(`${tag}.importance: 2または3が必要です（0=非掲載は台帳に載せない）`);
  if (!isNonEmptyString(event.source_id)) errors.push(`${tag}.source_id: 空でない文字列が必要です`);
  else if (!sourceIds.has(event.source_id)) errors.push(`${tag}.source_id: sources[]に存在しないIDです: ${event.source_id}`);
  if (!isNonEmptyString(event.source_evidence)) {
    errors.push(`${tag}.source_evidence: 空でない文字列が必須です（空の場合は台帳生成時点でHOLD）`);
  }
  if (!NAME_RESOLUTIONS.has(event.name_resolution)) {
    errors.push(`${tag}.name_resolution: ${[...NAME_RESOLUTIONS].join('|')}のいずれかが必要です`);
  }
  if (event.importance === 3 && event.time_status === 'published') {
    if (!ISO_DATETIME_OFFSET_RE.test(event.halt_window_start_jst || '')) errors.push(`${tag}.halt_window_start_jst: importance=3・時刻確定時は必須です`);
    if (!ISO_DATETIME_OFFSET_RE.test(event.halt_window_end_jst || '')) errors.push(`${tag}.halt_window_end_jst: importance=3・時刻確定時は必須です`);
  } else if (event.halt_window_start_jst !== null || event.halt_window_end_jst !== null) {
    errors.push(`${tag}: importance=2または時刻未公表の場合、halt_window_start_jst/halt_window_end_jstはnullである必要があります`);
  }
  if (event.bundle_id !== null && event.bundle_id !== undefined && !isNonEmptyString(event.bundle_id)) {
    errors.push(`${tag}.bundle_id: 空でない文字列またはnullが必要です`);
  }
  return event.event_id;
}

function validateCoverage(coverage, errors) {
  if (typeof coverage !== 'object' || coverage === null) {
    errors.push('coverage: オブジェクトが必要です');
    return;
  }
  const ec = coverage.expected_coverage;
  if (typeof ec !== 'object' || ec === null) {
    errors.push('coverage.expected_coverage: オブジェクトが必要です');
  } else {
    if (typeof ec.required !== 'number' || ec.required < 0) errors.push('coverage.expected_coverage.required: 0以上の数値が必要です');
    if (!Array.isArray(ec.missing)) errors.push('coverage.expected_coverage.missing: 配列が必要です');
  }
  if (!Array.isArray(coverage.recurring_checks)) {
    errors.push('coverage.recurring_checks: 配列が必要です');
  } else {
    coverage.recurring_checks.forEach((rc, i) => {
      if (typeof rc !== 'object' || rc === null || !isNonEmptyString(rc.name)) {
        errors.push(`coverage.recurring_checks[${i}].name: 空でない文字列が必要です`);
      }
      if (typeof rc.applies_this_week !== 'boolean') errors.push(`coverage.recurring_checks[${i}].applies_this_week: 真偽値が必要です`);
      if (typeof rc.found !== 'boolean') errors.push(`coverage.recurring_checks[${i}].found: 真偽値が必要です`);
    });
  }
}

// 戻り値: { ok, errors }
function validateLedger(ledger) {
  const errors = [];
  if (typeof ledger !== 'object' || ledger === null) {
    return { ok: false, errors: ['台帳のルートはオブジェクトである必要があります'] };
  }
  validateMeta(ledger.meta, errors);

  const sourceIds = new Set();
  if (!Array.isArray(ledger.sources)) {
    errors.push('sources: 配列が必要です');
  } else {
    const seen = new Set();
    ledger.sources.forEach((s, i) => validateSource(s, i, errors, seen));
    ledger.sources.forEach((s) => { if (isNonEmptyString(s?.source_id)) sourceIds.add(s.source_id); });
  }

  if (!Array.isArray(ledger.events)) {
    errors.push('events: 配列が必要です');
  } else {
    const seenEventIds = new Set();
    ledger.events.forEach((e, i) => validateEvent(e, i, errors, seenEventIds, sourceIds));
  }

  validateCoverage(ledger.coverage, errors);

  return { ok: errors.length === 0, errors };
}

module.exports = { validateLedger, SCHEMA_VERSION, SOURCE_TYPES, OUTCOMES, FAIL_CLOSED_DECISIONS, NAME_RESOLUTIONS, TIME_STATUSES, IMPORTANCE_VALUES, ISO_DATETIME_OFFSET_RE };
