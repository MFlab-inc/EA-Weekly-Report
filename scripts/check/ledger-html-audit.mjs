#!/usr/bin/env node
// 台帳×HTML突合検査（task #13、しょうさん指示2026-08-15「台帳×HTML突合検査（1対1対応・属性整合）— JSで実装可」）。
// 新設のdata/ledger/*.jsonスキーマ（scripts/lib/validate-ledger.js）とレンダラー出力HTML
// （templates/design-mock_v1.2.html準拠のv4属性契約: ルートはreport-meta/layout-version/
// target-start/section-count/reader-time-term/halt-guidance、イベントカードはevent-id/
// event-importanceのみ）を突合する。旧validate_report.py・validate_daily_event_layout.pyの
// 実質的な後継（禁止タグ・禁止語等はscripts/check/policy-lint.mjsの担当に分離済み）。
// 「台帳にないイベントがHTMLに出る／HTMLに出ないイベントが台帳にある」の両方向を必ず検出する。
import { readFileSync } from 'node:fs';
import { argv, exit } from 'node:process';

const WEEKDAYS_JA = ['月', '火', '水', '木', '金', '土', '日'];
const EXPECTED_LAYOUT_VERSION = 'ea-only-v4';
const EXPECTED_SECTION_COUNT = '4';
const EXPECTED_READER_TIME_TERM = '日本時間';
const EXPECTED_HALT_GUIDANCE = 'pre4to12h';
// (?<!年): 「YYYY年M月D日（曜）」形式（作成日等）は別途チェックするため、年が直前に無い表記のみ対象とする
const MD_WEEKDAY_RE = /(?<!年)(\d{1,2})月(\d{1,2})日[（(]([月火水木金土日])[）)]/g;
const ROOT_ATTR_RE = /<div\b[^>]*\bdata-ea-report-meta="([^"]*)"[^>]*>/;
const DATE_GROUP_RE = /<div\b[^>]*class="ea-date-group"[^>]*\bdata-ea-date="(\d{4}-\d{2}-\d{2})"[^>]*\bdata-ea-date-event-count="(\d+)"[^>]*>([\s\S]*?)(?=<div\b[^>]*class="ea-date-group"|<!-- ▼|$)/g;
const EVENT_CARD_RE = /<div\b[^>]*class="ea-event-card"[^>]*\bdata-ea-event-id="([^"]*)"[^>]*\bdata-ea-event-importance="([^"]*)"[^>]*>/g;

function attrValue(tagHtml, attr) {
  const m = new RegExp(`\\bdata-ea-${attr}="([^"]*)"`).exec(tagHtml);
  return m ? m[1] : null;
}

// dateStrは既にJSTカレンダー日付の文字列（'YYYY-MM-DD'）のため、UTC正午基準で解釈すれば
// タイムゾーンのずれなく曜日を求められる（日付境界のDST等は関係しない単純な文字列演算）
function weekdayJaOf(dateStr) {
  const dow = new Date(`${dateStr}T12:00:00Z`).getUTCDay(); // 0=日..6=土
  return dow === 0 ? '日' : WEEKDAYS_JA[dow - 1];
}

function addDaysToYmd(ymd, days) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function auditRootMeta(html, ledger) {
  const errors = [];
  const rootMatch = ROOT_ATTR_RE.exec(html);
  if (!rootMatch) {
    errors.push('ROOT_META_MISSING: data-ea-report-meta属性を持つルート要素がありません');
    return errors;
  }
  const rootTagEnd = html.indexOf('>', rootMatch.index);
  const rootTag = html.slice(rootMatch.index, rootTagEnd + 1);
  const expectedReportMeta = `ea-weekly-${ledger.meta.target_week_start.replace(/-/g, '')}`;
  if (rootMatch[1] !== expectedReportMeta) {
    errors.push(`ROOT_REPORT_META_MISMATCH: data-ea-report-metaが期待値と一致しません（期待: ${expectedReportMeta} / 実際: ${rootMatch[1]}）`);
  }
  if (attrValue(rootTag, 'layout-version') !== EXPECTED_LAYOUT_VERSION) errors.push(`LAYOUT_VERSION_MISMATCH: data-ea-layout-versionは${EXPECTED_LAYOUT_VERSION}である必要があります`);
  if (attrValue(rootTag, 'target-start') !== ledger.meta.target_week_start) errors.push('ROOT_TARGET_START_MISMATCH: data-ea-target-startが台帳のtarget_week_startと一致しません');
  if (attrValue(rootTag, 'section-count') !== EXPECTED_SECTION_COUNT) errors.push(`SECTION_COUNT_MISMATCH: data-ea-section-countは${EXPECTED_SECTION_COUNT}である必要があります`);
  if (attrValue(rootTag, 'reader-time-term') !== EXPECTED_READER_TIME_TERM) errors.push(`READER_TIME_TERM_MISMATCH: data-ea-reader-time-termは「${EXPECTED_READER_TIME_TERM}」である必要があります`);
  if (attrValue(rootTag, 'halt-guidance') !== EXPECTED_HALT_GUIDANCE) errors.push(`HALT_GUIDANCE_MISMATCH: data-ea-halt-guidanceは${EXPECTED_HALT_GUIDANCE}である必要があります`);
  return errors;
}

// 台帳の「対象週の注目イベント」掲載対象（importance 2または3）を抽出する
export function expectedDisplayEvents(ledger) {
  return (ledger.events || []).filter((e) => e.importance === 2 || e.importance === 3);
}

export function auditEventSets(html, ledger) {
  const errors = [];
  const expected = expectedDisplayEvents(ledger);
  const expectedById = new Map(expected.map((e) => [e.event_id, e]));
  const expectedIds = new Set(expectedById.keys());

  const foundIds = new Set();
  const foundImportanceById = new Map();
  let m;
  const cardRe = new RegExp(EVENT_CARD_RE);
  while ((m = cardRe.exec(html)) !== null) {
    foundIds.add(m[1]);
    foundImportanceById.set(m[1], m[2]);
  }

  const missing = [...expectedIds].filter((id) => !foundIds.has(id)).sort();
  const unknown = [...foundIds].filter((id) => !expectedIds.has(id)).sort();
  if (missing.length) errors.push(`HTML_EVENT_MISSING: HTMLに未掲載の台帳イベントがあります: ${missing.join(', ')}`);
  if (unknown.length) errors.push(`HTML_EVENT_UNKNOWN: HTMLに台帳未登録のイベントがあります: ${unknown.join(', ')}`);

  for (const [id, importance] of foundImportanceById) {
    const expectedEvent = expectedById.get(id);
    if (expectedEvent && importance !== String(expectedEvent.importance)) {
      errors.push(`EVENT_IMPORTANCE_MISMATCH: ${id} の重要度がHTML(${importance})と台帳(${expectedEvent.importance})で一致しません`);
    }
  }
  return errors;
}

// 対象週5日分（月〜金）の日付一覧。SPEC §6.3「日別カード×5」により、レンダラー
// （scripts/render/ledger-to-week-input.jsのbuildDays()）はイベントが1件も無い日も
// 空の日付グループ（data-ea-date-event-count="0"）として出力する。この関数はbuildDays()と
// 同じ生成規則（target_week_start起点の5日）で「HTMLに存在すべき日付グループ集合」を求める
// （task #38実ネットワーク検証2026-08-15で発見: 以前はイベントがある日付のみを期待値としており、
// 全日程にイベントが無い週で常にDATE_GROUP_UNEXPECTED/EXTRAの誤検知が起きていた）
function expectedWeekDates(ledger) {
  const dates = [];
  let d = ledger.meta.target_week_start;
  for (let i = 0; i < 5; i++) {
    dates.push(d);
    d = addDaysToYmd(d, 1);
  }
  return dates;
}

export function auditDateGroups(html, ledger) {
  const errors = [];
  const expected = expectedDisplayEvents(ledger);
  const expectedByDate = new Map();
  for (const e of expected) {
    if (!expectedByDate.has(e.date_jst)) expectedByDate.set(e.date_jst, []);
    expectedByDate.get(e.date_jst).push(e);
  }
  const weekDates = expectedWeekDates(ledger);

  const groupDates = [];
  let m;
  const groupRe = new RegExp(DATE_GROUP_RE);
  while ((m = groupRe.exec(html)) !== null) {
    const [, groupDate, countAttr, body] = m;
    groupDates.push(groupDate);
    const cardIds = [...body.matchAll(new RegExp(EVENT_CARD_RE))].map((c) => c[1]);
    if (Number(countAttr) !== cardIds.length) {
      errors.push(`DATE_GROUP_COUNT_MISMATCH: ${groupDate} のdata-ea-date-event-count(${countAttr})が実カード数(${cardIds.length})と不一致です`);
    }
    if (!weekDates.includes(groupDate)) {
      errors.push(`DATE_GROUP_UNEXPECTED: 対象週5日に含まれない日付グループがあります: ${groupDate}`);
      continue;
    }
    const expectedIdsForDate = new Set((expectedByDate.get(groupDate) || []).map((e) => e.event_id));
    for (const id of cardIds) {
      if (!expectedIdsForDate.has(id)) {
        errors.push(`DATE_GROUP_EVENT_DATE_MISMATCH: ${id} の日付グループ(${groupDate})が台帳のdate_jstと一致しません`);
      }
    }
  }

  if (JSON.stringify(groupDates) !== JSON.stringify([...groupDates].sort())) {
    errors.push('DATE_GROUP_ORDER: 日付グループがJST日付昇順ではありません');
  }
  const missingDates = weekDates.filter((d) => !groupDates.includes(d));
  const extraDates = groupDates.filter((d) => !weekDates.includes(d));
  if (missingDates.length) errors.push(`DATE_GROUP_MISSING: 対象週の日付がHTMLの日付グループにありません: ${missingDates.join(', ')}`);
  if (extraDates.length) errors.push(`DATE_GROUP_EXTRA: HTMLに対象週外の日付グループがあります: ${extraDates.join(', ')}`);
  return errors;
}

export function auditTargetWeekDates(html, ledger) {
  const errors = [];
  const start = ledger.meta.target_week_start;
  const end = ledger.meta.target_week_end;
  const expected = new Map();
  for (let d = start; d <= end && expected.size <= 14; d = addDaysToYmd(d, 1)) {
    expected.set(d, weekdayJaOf(d));
  }

  const text = html.replace(/<[^>]+>/g, ' ');
  for (const m of text.matchAll(new RegExp(MD_WEEKDAY_RE))) {
    const [full, month, day, weekday] = m;
    // 期待日付集合の年から実日付を復元して照合する
    const year = Number(start.slice(0, 4));
    const candidate1 = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const candidate2 = `${year + 1}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const key = expected.has(candidate1) ? candidate1 : expected.has(candidate2) ? candidate2 : null;
    if (!key) {
      errors.push(`DATE_OUT_OF_TARGET_WEEK: 対象週外の日付がHTMLに含まれています: ${full}`);
      continue;
    }
    if (expected.get(key) !== weekday) {
      errors.push(`WEEKDAY_MISMATCH: 曜日が不一致です: ${full}。正しくは${expected.get(key)}曜日です`);
    }
  }
  return errors;
}

export function auditLedgerHtml(html, ledger) {
  return [
    ...auditRootMeta(html, ledger),
    ...auditEventSets(html, ledger),
    ...auditDateGroups(html, ledger),
    ...auditTargetWeekDates(html, ledger),
  ];
}

async function main() {
  const [htmlPath, ledgerPath] = argv.slice(2);
  if (!htmlPath || !ledgerPath) {
    console.error('使い方: node ledger-html-audit.mjs <html> <ledger.json>');
    exit(2);
  }
  const html = readFileSync(htmlPath, 'utf8');
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  const errors = auditLedgerHtml(html, ledger);
  for (const e of errors) console.log(`ERROR [${e.split(':')[0]}] ${e}`);
  const status = errors.length ? '配信保留' : '配信可';
  console.log(`判定: ${status}`);
  console.log(`ERROR: ${errors.length} / WARNING: 0`);
  exit(errors.length ? 2 : 0);
}

if (import.meta.url === `file://${argv[1]}`) {
  main();
}
