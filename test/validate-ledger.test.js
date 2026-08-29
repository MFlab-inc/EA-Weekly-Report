'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateLedger } = require('../scripts/lib/validate-ledger');

function baseLedger() {
  return {
    meta: {
      schema_version: '1.0',
      generated_at: '2026-08-15T08:06:00+09:00',
      target_week_start: '2026-08-17',
      target_week_end: '2026-08-21',
      pipeline_version: 'weekly-2026-08-15',
      outcome: 'PUBLISH_READY',
      warnings: [],
      holds: [],
    },
    sources: [
      {
        source_id: 'au_rba',
        type: 'annual_schedule_config',
        fetched_at: '2026-08-15T08:00:00+09:00',
        url: 'https://www.rba.gov.au/schedules-events/board-meeting-schedules.html',
        ok: true,
        http_status: null,
        extractor_result_count: 1,
        robots_checked: true,
        fail_closed_decision: 'OK',
      },
      {
        source_id: 'manual',
        type: 'manual',
        fetched_at: '2026-08-15T08:00:00+09:00',
        url: 'config/manual-events.json',
        ok: true,
        http_status: null,
        extractor_result_count: 1,
        robots_checked: false,
        fail_closed_decision: 'OK',
      },
    ],
    events: [
      {
        event_id: 'au-rba-rate-2026-08-18',
        date_local: '2026-08-18',
        time_local: '14:30',
        tz: 'Australia/Sydney',
        date_jst: '2026-08-18',
        datetime_jst: '2026-08-18T13:30:00+09:00',
        time_status: 'published',
        country: 'AU',
        currency: 'AUD',
        kind: 'policy_rate',
        name_ja: 'RBA政策金利＆声明発表',
        importance: 3,
        source_id: 'au_rba',
        source_evidence: 'ground truth au-rba-rate-2026-08-11と一致確認済み',
        name_resolution: 'rule_generated',
        halt_window_start_jst: '2026-08-18T01:30:00+09:00',
        halt_window_end_jst: '2026-08-18T09:30:00+09:00',
        bundle_id: 'au-rba-2026-08-18',
      },
      {
        event_id: 'rba-testimony-2026-08-19',
        date_local: '2026-08-19',
        time_local: null,
        tz: null,
        date_jst: '2026-08-19',
        datetime_jst: null,
        time_status: 'unpublished',
        country: 'AU',
        currency: 'AUD',
        kind: 'testimony',
        name_ja: 'ブロックRBA総裁：下院経済委員会への出席',
        importance: 3,
        source_id: 'manual',
        source_evidence: 'aph.gov.au 2026-08-10確認',
        name_resolution: 'dictionary',
        halt_window_start_jst: null,
        halt_window_end_jst: null,
        bundle_id: null,
      },
    ],
    coverage: {
      expected_coverage: { required: 8, missing: [] },
      recurring_checks: [{ name: '米雇用統計', applies_this_week: false, found: false }],
    },
  };
}

test('validateLedger: 妥当な台帳はエラー無し', () => {
  const r = validateLedger(baseLedger());
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});

test('validateLedger: 台帳がオブジェクトでなければエラー', () => {
  assert.equal(validateLedger(null).ok, false);
  assert.equal(validateLedger([]).ok, false);
});

// 2026-08-29追加: meta.generated_from_commitは任意項目（未設定・null=旧形式の台帳やローカル生成、
// 文字列=weekly.ymlの冪等ガードが比較に使うコミットSHA）。文字列・null・未設定はエラーにならず、
// それ以外の型（数値等の設定ミス）だけを検出することを確認する
test('validateLedger: meta.generated_from_commitは文字列・null・未設定を許可し、それ以外の型はエラー', () => {
  const withString = baseLedger();
  withString.meta.generated_from_commit = '03fcd77b3dcc62205fe446a0c8c7e9f91b206c2e';
  assert.equal(validateLedger(withString).ok, true);

  const withNull = baseLedger();
  withNull.meta.generated_from_commit = null;
  assert.equal(validateLedger(withNull).ok, true);

  const withoutField = baseLedger();
  delete withoutField.meta.generated_from_commit;
  assert.equal(validateLedger(withoutField).ok, true);

  const withNumber = baseLedger();
  withNumber.meta.generated_from_commit = 12345;
  const r = validateLedger(withNumber);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('generated_from_commit')));
});

test('validateLedger: source_evidenceが空ならエラー（台帳生成時点でHOLDの根拠）', () => {
  const ledger = baseLedger();
  ledger.events[0].source_evidence = '';
  const r = validateLedger(ledger);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('source_evidence')));
});

test('validateLedger: eventのsource_idがsources[]に無ければエラー', () => {
  const ledger = baseLedger();
  ledger.events[0].source_id = 'unknown_source';
  const r = validateLedger(ledger);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('sources[]に存在しないID')));
});

test('validateLedger: event_idの重複を検出する', () => {
  const ledger = baseLedger();
  ledger.events[1].event_id = ledger.events[0].event_id;
  const r = validateLedger(ledger);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('重複')));
});

test('validateLedger: source_idの重複を検出する', () => {
  const ledger = baseLedger();
  ledger.sources[1].source_id = ledger.sources[0].source_id;
  const r = validateLedger(ledger);
  assert.equal(r.ok, false);
});

test('validateLedger: importanceが0/1はエラー（2/3のみ許可）', () => {
  const ledger = baseLedger();
  ledger.events[0].importance = 1;
  assert.equal(validateLedger(ledger).ok, false);
});

test('validateLedger: time_status=publishedなのにdatetime_jstがnullはエラー', () => {
  const ledger = baseLedger();
  ledger.events[0].datetime_jst = null;
  assert.equal(validateLedger(ledger).ok, false);
});

test('validateLedger: time_status=unpublishedなのにdatetime_jstが非nullはエラー', () => {
  const ledger = baseLedger();
  ledger.events[1].datetime_jst = '2026-08-19T00:00:00+09:00';
  assert.equal(validateLedger(ledger).ok, false);
});

test('validateLedger: importance=3・時刻確定なのにhalt_windowが無ければエラー', () => {
  const ledger = baseLedger();
  ledger.events[0].halt_window_start_jst = null;
  assert.equal(validateLedger(ledger).ok, false);
});

test('validateLedger: importance=2にhalt_windowが設定されていればエラー', () => {
  const ledger = baseLedger();
  ledger.events[0].importance = 2;
  // halt_window_start/endはimportance=3専用のため、importance=2のまま残すと矛盾になる
  assert.equal(validateLedger(ledger).ok, false);
});

test('validateLedger: meta.outcome=HOLDなのにholdsが空ならエラー', () => {
  const ledger = baseLedger();
  ledger.meta.outcome = 'HOLD';
  assert.equal(validateLedger(ledger).ok, false);
});

test('validateLedger: meta.outcome=PUBLISH_READYなのにholdsが非空ならエラー', () => {
  const ledger = baseLedger();
  ledger.meta.holds = ['何かの理由'];
  assert.equal(validateLedger(ledger).ok, false);
});

test('validateLedger: target_week_endがtarget_week_startより前ならエラー', () => {
  const ledger = baseLedger();
  ledger.meta.target_week_end = '2026-08-10';
  assert.equal(validateLedger(ledger).ok, false);
});

test('validateLedger: time_local/tzは片方だけnullだとエラー', () => {
  const ledger = baseLedger();
  ledger.events[0].tz = null;
  assert.equal(validateLedger(ledger).ok, false);
});

test('validateLedger: coverage.expected_coverageが無ければエラー', () => {
  const ledger = baseLedger();
  delete ledger.coverage.expected_coverage;
  assert.equal(validateLedger(ledger).ok, false);
});
