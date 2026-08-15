'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildLedger, candidateToLedgerEvent, resolveRuleGeneratedName, computeBundleIds, makeEventId, minutesToJstIso } = require('../scripts/lib/build-ledger');
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

test('resolveRuleGeneratedName: bond_auction（tenorJa無し）・official_speech（US以外）は未対応でnullを返す', () => {
  assert.equal(resolveRuleGeneratedName({ kind: 'bond_auction', country: 'JP' }, officials), null, 'tenorJaが無いbond_auction');
  assert.equal(resolveRuleGeneratedName({ kind: 'official_speech', country: 'JP' }, officials), null, 'US以外のofficial_speech（役職ラベル未定義）');
});

test('resolveRuleGeneratedName: opinions_summary/minutes_summary（BOJ）はperiodJaがあれば会合開催日を含めて解決する', () => {
  assert.equal(
    resolveRuleGeneratedName({ kind: 'opinions_summary', country: 'JP', periodJa: '7月30・31日開催分' }, officials),
    '日銀金融政策決定会合における主な意見の公表（7月30・31日開催分）'
  );
  assert.equal(
    resolveRuleGeneratedName({ kind: 'minutes_summary', country: 'JP', periodJa: '2026年6月15日・16日開催分' }, officials),
    '金融政策決定会合議事要旨（2026年6月15日・16日開催分）'
  );
});

test('resolveRuleGeneratedName: opinions_summary/minutes_summary（BOJ）はperiodJa無しでも基底文言を返す（FALLBACK_KIND_LABELより優先）', () => {
  assert.equal(resolveRuleGeneratedName({ kind: 'opinions_summary', country: 'JP' }, officials), '日銀金融政策決定会合における主な意見の公表');
  assert.equal(resolveRuleGeneratedName({ kind: 'minutes_summary', country: 'JP' }, officials), '金融政策決定会合議事要旨');
});

test('resolveRuleGeneratedName: opinions_summary（SNB等JP以外）はBOJ固有テンプレート対象外でnullを返す', () => {
  assert.equal(resolveRuleGeneratedName({ kind: 'opinions_summary', country: 'CH' }, officials), null);
});

test('resolveRuleGeneratedName: bond_auction（tenorJaあり）は国別テンプレートで解決する', () => {
  assert.equal(
    resolveRuleGeneratedName({ kind: 'bond_auction', country: 'JP', date: '2026-08-04', tenorJa: '10年' }, officials),
    '10年利付国債（2026年8月債）の入札'
  );
  assert.equal(
    resolveRuleGeneratedName({ kind: 'bond_auction', country: 'US', date: '2026-08-19', tenorJa: '10年' }, officials),
    '米10年債入札'
  );
});

test('resolveRuleGeneratedName: official_speech（US）はspeakerLastNameの照合結果に関わらず役職ラベルは返す（未登録は役職のみ）', () => {
  assert.equal(resolveRuleGeneratedName({ kind: 'official_speech', country: 'US', speakerLastName: 'Cook' }, officials), 'FRB理事の発言');
  assert.equal(resolveRuleGeneratedName({ kind: 'official_speech', country: 'US', speakerLastName: null }, officials), 'FRB理事の発言');
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

// task #34: 発表枠の束ね（bundle_id）。しょうさん確定ルール2026-08-15
// 「同一国×同一source_id×同一日×発表時刻90分以内」を既刊2週の実例で検証する
function ledgerEvent(overrides) {
  return {
    event_id: overrides.event_id,
    country: overrides.country,
    source_id: overrides.source_id,
    date_jst: overrides.date_jst,
    datetime_jst: overrides.datetime_jst,
    bundle_id: null,
    ...overrides,
  };
}

test('computeBundleIds: RBA3件クラスタ（13:30政策金利+13:30四半期報告+14:30会見）が既刊どおり1束になる', () => {
  const events = [
    ledgerEvent({ event_id: 'au-policy_rate-2026-08-11', country: 'AU', source_id: 'au_rba', date_jst: '2026-08-11', datetime_jst: '2026-08-11T13:30:00+09:00' }),
    ledgerEvent({ event_id: 'au-quarterly_report-2026-08-11', country: 'AU', source_id: 'au_rba', date_jst: '2026-08-11', datetime_jst: '2026-08-11T13:30:00+09:00' }),
    ledgerEvent({ event_id: 'au-press_conference-2026-08-11', country: 'AU', source_id: 'au_rba', date_jst: '2026-08-11', datetime_jst: '2026-08-11T14:30:00+09:00' }),
  ];
  const result = computeBundleIds(events);
  const bundleIds = new Set(result.map((e) => e.bundle_id));
  assert.equal(bundleIds.size, 1, '3件とも同一bundle_idのはず');
  assert.notEqual([...bundleIds][0], null);
  assert.equal(result[0].bundle_id, 'au-policy_rate-2026-08-11', '先頭（最も早い時刻）のevent_idがbundle_idになる');
});

test('computeBundleIds: CPI+コアCPI（同日同時刻・同一source）が1束、PPI+コアPPIは別の束になる', () => {
  const events = [
    ledgerEvent({ event_id: 'us-cpi-2026-08-12', country: 'US', source_id: 'us_bls_fred', date_jst: '2026-08-12', datetime_jst: '2026-08-12T21:30:00+09:00' }),
    ledgerEvent({ event_id: 'us-cpi-2026-08-12-2', country: 'US', source_id: 'us_bls_fred', date_jst: '2026-08-12', datetime_jst: '2026-08-12T21:30:00+09:00' }),
    ledgerEvent({ event_id: 'us-ppi-2026-08-13', country: 'US', source_id: 'us_bls_fred', date_jst: '2026-08-13', datetime_jst: '2026-08-13T21:30:00+09:00' }),
    ledgerEvent({ event_id: 'us-ppi-2026-08-13-2', country: 'US', source_id: 'us_bls_fred', date_jst: '2026-08-13', datetime_jst: '2026-08-13T21:30:00+09:00' }),
  ];
  const result = computeBundleIds(events);
  const cpiIds = new Set(result.slice(0, 2).map((e) => e.bundle_id));
  const ppiIds = new Set(result.slice(2, 4).map((e) => e.bundle_id));
  assert.equal(cpiIds.size, 1);
  assert.equal(ppiIds.size, 1);
  assert.notDeepEqual(cpiIds, ppiIds, '日付が異なるCPIとPPIは別の束になるはず（同一日制約）');
});

test('computeBundleIds: 同一時刻でも国・sourceが異なれば束ねない（CA/US雇用統計、同日21:30）', () => {
  const events = [
    ledgerEvent({ event_id: 'ca-employment_situation-2026-08-07', country: 'CA', source_id: 'ca_statcan', date_jst: '2026-08-07', datetime_jst: '2026-08-07T21:30:00+09:00' }),
    ledgerEvent({ event_id: 'us-employment_situation-2026-08-07', country: 'US', source_id: 'us_bls_fred', date_jst: '2026-08-07', datetime_jst: '2026-08-07T21:30:00+09:00' }),
  ];
  const result = computeBundleIds(events);
  assert.equal(result[0].bundle_id, null);
  assert.equal(result[1].bundle_id, null);
});

test('computeBundleIds: 単独イベント（束ね相手なし）はbundle_id:null、時刻未公表イベントも対象外', () => {
  const events = [
    ledgerEvent({ event_id: 'jp-opinions_summary-2026-08-10', country: 'JP', source_id: 'jp_boj', date_jst: '2026-08-10', datetime_jst: '2026-08-10T08:50:00+09:00' }),
    ledgerEvent({ event_id: 'jp-bond_auction-2026-08-04', country: 'JP', source_id: 'jp_mof', date_jst: '2026-08-04', datetime_jst: null }),
  ];
  const result = computeBundleIds(events);
  assert.equal(result[0].bundle_id, null);
  assert.equal(result[1].bundle_id, null);
});

test('computeBundleIds: 90分を超える間隔は束ねない（91分ギャップ）、90分ちょうどは束ねる', () => {
  const exact90 = computeBundleIds([
    ledgerEvent({ event_id: 'a', country: 'AU', source_id: 'x', date_jst: '2026-08-11', datetime_jst: '2026-08-11T10:00:00+09:00' }),
    ledgerEvent({ event_id: 'b', country: 'AU', source_id: 'x', date_jst: '2026-08-11', datetime_jst: '2026-08-11T11:30:00+09:00' }),
  ]);
  assert.equal(exact90[0].bundle_id, 'a');
  assert.equal(exact90[1].bundle_id, 'a');

  const over90 = computeBundleIds([
    ledgerEvent({ event_id: 'a', country: 'AU', source_id: 'x', date_jst: '2026-08-11', datetime_jst: '2026-08-11T10:00:00+09:00' }),
    ledgerEvent({ event_id: 'b', country: 'AU', source_id: 'x', date_jst: '2026-08-11', datetime_jst: '2026-08-11T11:31:00+09:00' }),
  ]);
  assert.equal(over90[0].bundle_id, null);
  assert.equal(over90[1].bundle_id, null);
});

test('buildLedger: RBA3件クラスタがbuildLedger()経由でも同一bundle_idになる', () => {
  const report = syntheticReport({
    results: [
      {
        id: 'au_rba', ok: true, skipped: false,
        thisWeek: [
          { date: '2026-08-11', time: '13:30', kind: 'policy_rate', country: 'AU', importance: 3, displayName: 'RBA政策金利＆声明発表', sourceEvidence: 'test' },
          { date: '2026-08-11', time: '13:30', kind: 'quarterly_report', country: 'AU', importance: 3, displayName: 'RBA四半期金融政策報告', sourceEvidence: 'test' },
          { date: '2026-08-11', time: '14:30', kind: 'press_conference', country: 'AU', importance: 3, displayName: 'ブロックRBA総裁の記者会見', sourceEvidence: 'test' },
        ],
      },
    ],
  });
  const sourcesConfig = syntheticSourcesConfig();
  const candidates = report.results[0].thisWeek.map((c) => ({ ...c, sourceId: 'au_rba' }));
  const ledger = buildLedger({
    report, sourcesConfig, manualEventsConfig: { entries: [] }, candidates,
    expectedCoverageResult: { required: [], missing: [] }, recurringChecksStatus: [],
    pipelineVersion: 'test-pipeline-1', generatedAt: '2026-08-15T08:06:00+09:00',
  });
  const bundleIds = new Set(ledger.events.map((e) => e.bundle_id));
  assert.equal(bundleIds.size, 1);
  assert.notEqual([...bundleIds][0], null);
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
