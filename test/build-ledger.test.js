'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildLedger, candidateToLedgerEvent, resolveRuleGeneratedName, makeEventId, minutesToJstIso } = require('../scripts/lib/build-ledger');
const { validateLedger } = require('../scripts/lib/validate-ledger');

const officials = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'officials.json'), 'utf8')).officials;

test('minutesToJstIso: 正の分は当日、負の分は前日のISO日時になる', () => {
  assert.equal(minutesToJstIso('2026-08-18', 90), '2026-08-18T01:30:00+09:00');
  assert.equal(minutesToJstIso('2026-08-18', -30), '2026-08-17T23:30:00+09:00');
});

test('makeEventId: 同一country-kind-dateの衝突時は連番を付与する', () => {
  const used = new Set();
  const id1 = makeEventId({ country: 'US', kind: 'cpi', date: '2026-08-19' }, used);
  const id2 = makeEventId({ country: 'US', kind: 'cpi', date: '2026-08-19' }, used);
  assert.equal(id1, 'us-cpi-2026-08-19');
  assert.equal(id2, 'us-cpi-2026-08-19-2');
});

test('candidateToLedgerEvent: importance=3・時刻確定はhalt_windowを計算する', () => {
  const used = new Set();
  const candidate = {
    date: '2026-08-18', time: '13:30', kind: 'policy_rate', country: 'AU', importance: 3,
    displayName: 'RBA政策金利＆声明発表', sourceId: 'au_rba', sourceEvidence: 'ground truth一致確認済み',
    localDate: '2026-08-18', localTime: '14:30', tz: 'Australia/Sydney',
  };
  const ev = candidateToLedgerEvent(candidate, used);
  assert.equal(ev.event_id, 'au-policy_rate-2026-08-18');
  assert.equal(ev.datetime_jst, '2026-08-18T13:30:00+09:00');
  assert.equal(ev.time_status, 'published');
  assert.equal(ev.currency, 'AUD');
  assert.equal(ev.name_resolution, 'dictionary');
  assert.equal(ev.halt_window_start_jst, '2026-08-18T01:30:00+09:00');
  assert.equal(ev.halt_window_end_jst, '2026-08-18T09:30:00+09:00');
});

test('candidateToLedgerEvent: displayName未解決・officials未指定はFALLBACK_KIND_LABELを使いrule_generatedになる', () => {
  const used = new Set();
  const candidate = {
    date: '2026-08-18', time: '09:30', kind: 'press_conference', country: 'CH', importance: 3,
    displayName: null, sourceId: 'snb_policy_rate', sourceEvidence: 'SNB event-schedule抽出',
  };
  const ev = candidateToLedgerEvent(candidate, used);
  assert.equal(ev.name_ja, '記者会見');
  assert.equal(ev.name_resolution, 'rule_generated');
});

test('candidateToLedgerEvent: displayName未解決・officials指定時はnaming.jsの規則生成命名を使う（SPEC §4.2）', () => {
  const used = new Set();
  const rateCandidate = {
    date: '2026-08-18', time: '09:30', kind: 'policy_rate', country: 'CH', importance: 3,
    displayName: null, sourceId: 'snb_policy_rate', sourceEvidence: 'SNB event-schedule抽出',
  };
  const rateEv = candidateToLedgerEvent(rateCandidate, used, officials);
  assert.equal(rateEv.name_ja, 'SNB政策金利＆声明発表');
  assert.equal(rateEv.name_resolution, 'rule_generated');

  const pressCandidate = {
    date: '2026-08-18', time: '10:00', kind: 'press_conference', country: 'CH', importance: 3,
    displayName: null, sourceId: 'snb_policy_rate', sourceEvidence: 'SNB event-schedule抽出',
  };
  const pressEv = candidateToLedgerEvent(pressCandidate, used, officials);
  assert.equal(pressEv.name_ja, 'シュレーゲルSNB総裁の記者会見');
  assert.equal(pressEv.name_resolution, 'rule_generated');
});

test('resolveRuleGeneratedName: opinions_summary/minutes_summary/official_speech/bond_auctionは未対応でnullを返す（要文脈情報が候補パイプライン未実装のため。docs/ledger-schema.md参照）', () => {
  const unsupportedKinds = ['opinions_summary', 'minutes_summary', 'official_speech', 'bond_auction'];
  for (const kind of unsupportedKinds) {
    assert.equal(resolveRuleGeneratedName({ kind, country: 'JP' }, officials), null, `kind=${kind}`);
  }
});

test('resolveRuleGeneratedName: BANK_ABBR_BY_COUNTRY未収録の国はnullを返す', () => {
  assert.equal(resolveRuleGeneratedName({ kind: 'policy_rate', country: 'ZZ' }, officials), null);
});

test('candidateToLedgerEvent: 時刻未公表はtime_status=unpublished・halt_windowはnull', () => {
  const used = new Set();
  const candidate = {
    date: '2026-08-19', time: null, kind: 'testimony', country: 'AU', importance: 3,
    displayName: 'ブロックRBA総裁：下院経済委員会への出席', sourceId: 'manual', sourceEvidence: 'aph.gov.au確認',
  };
  const ev = candidateToLedgerEvent(candidate, used);
  assert.equal(ev.time_status, 'unpublished');
  assert.equal(ev.datetime_jst, null);
  assert.equal(ev.halt_window_start_jst, null);
  assert.equal(ev.halt_window_end_jst, null);
});

test('candidateToLedgerEvent: importance=2はhalt_windowを計算しない', () => {
  const used = new Set();
  const candidate = {
    date: '2026-08-19', time: '23:00', kind: 'employment_indicator', country: 'US', importance: 2,
    displayName: 'JOLTS求人件数', sourceId: 'us_bls_fred', sourceEvidence: 'FRED release_id=192',
  };
  const ev = candidateToLedgerEvent(candidate, used);
  assert.equal(ev.halt_window_start_jst, null);
  assert.equal(ev.halt_window_end_jst, null);
});

function syntheticReport(overrides = {}) {
  return {
    targetWeek: { start: '2026-08-17', end: '2026-08-21' },
    outcome: { status: 'OK', reasons: [] },
    residualWarnings: [],
    recurringMissingWarnings: [],
    results: [
      {
        id: 'au_rba', ok: true, skipped: false,
        thisWeek: [{ date: '2026-08-18', time: '13:30', kind: 'policy_rate', country: 'AU', importance: 3, displayName: 'RBA政策金利＆声明発表', rawTitle: 'Cash Rate', localDate: '2026-08-18', localTime: '14:30', tz: 'Australia/Sydney' }],
      },
    ],
    ...overrides,
  };
}

function syntheticSourcesConfig() {
  return {
    sources: [
      { id: 'au_rba', type: 'annual_schedule_config', access: { robots_check: true, targets: [{ url: 'https://www.rba.gov.au/schedules-events/board-meeting-schedules.html' }] } },
    ],
  };
}

test('buildLedger: 実データに近い合成入力からスキーマに合格する台帳を組み立てる', () => {
  const report = syntheticReport();
  const sourcesConfig = syntheticSourcesConfig();
  const manualEventsConfig = { entries: [] };
  const candidates = [
    { ...report.results[0].thisWeek[0], sourceId: 'au_rba', sourceEvidence: 'Cash Rate（ground truth一致確認済み）' },
  ];
  const expectedCoverageResult = { required: new Array(8).fill(0), missing: [] };
  const recurringChecksStatus = [{ name: '米雇用統計', applies_this_week: false, found: false }];

  const ledger = buildLedger({
    report, sourcesConfig, manualEventsConfig, candidates, expectedCoverageResult, recurringChecksStatus,
    pipelineVersion: 'test-pipeline-1', generatedAt: '2026-08-15T08:06:00+09:00',
  });

  const r = validateLedger(ledger);
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  assert.equal(ledger.meta.outcome, 'PUBLISH_READY');
  assert.equal(ledger.events.length, 1);
  assert.ok(ledger.sources.some((s) => s.source_id === 'manual'), '手動イベント用のmanualソースが常に追加される');
});

test('buildLedger: officialsConfigを渡すと規則生成命名（naming.js）がイベントへ反映される', () => {
  const report = syntheticReport({
    results: [
      {
        id: 'au_rba', ok: true, skipped: false,
        thisWeek: [{ date: '2026-08-18', time: '14:30', kind: 'press_conference', country: 'AU', importance: 3, displayName: null, rawTitle: 'Press Conference', localDate: '2026-08-18', localTime: '15:30', tz: 'Australia/Sydney' }],
      },
    ],
  });
  const sourcesConfig = syntheticSourcesConfig();
  const candidates = [
    { ...report.results[0].thisWeek[0], sourceId: 'au_rba', sourceEvidence: 'Press Conference（ground truth一致確認済み）' },
  ];
  const ledger = buildLedger({
    report, sourcesConfig, manualEventsConfig: { entries: [] }, officialsConfig: { officials },
    candidates, expectedCoverageResult: { required: new Array(8).fill(0), missing: [] },
    recurringChecksStatus: [], pipelineVersion: 'test-pipeline-1', generatedAt: '2026-08-15T08:06:00+09:00',
  });
  assert.equal(ledger.events[0].name_ja, 'ブロックRBA総裁の記者会見');
  assert.equal(ledger.events[0].name_resolution, 'rule_generated');
  const r = validateLedger(ledger);
  assert.equal(r.ok, true);
});

test('buildLedger: report.outcome=HOLDのときledger.meta.outcome=HOLD・holdsが理由を含む', () => {
  const report = syntheticReport({ outcome: { status: 'HOLD', reasons: ['判定不能: 2件のソースが同時に失敗'] } });
  const sourcesConfig = syntheticSourcesConfig();
  const ledger = buildLedger({
    report, sourcesConfig, manualEventsConfig: { entries: [] }, candidates: [],
    expectedCoverageResult: { required: [], missing: [] }, recurringChecksStatus: [],
    pipelineVersion: 'test-pipeline-1', generatedAt: '2026-08-15T08:06:00+09:00',
  });
  assert.equal(ledger.meta.outcome, 'HOLD');
  assert.deepEqual(ledger.meta.holds, ['判定不能: 2件のソースが同時に失敗']);
  const r = validateLedger(ledger);
  assert.equal(r.ok, true);
});
