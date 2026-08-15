'use strict';
// scripts/check/gate.mjs の統合テスト（task #13）。
// PUBLISH_READY/HOLDの集約判定と、しょうさん指示の必須テスト（意図的に壊したデータでHOLDになる
// ことの実証）のうち台帳スキーマ由来のケース（出典を空にする）をここでカバーする。
// mobile_layoutはPlaywright起動のため既定でスキップ（test/mobile-layout-check.test.jsで別途担保）。
const { test } = require('node:test');
const assert = require('node:assert/strict');

async function loadGate() {
  return import('../scripts/check/gate.mjs');
}

function baseLedger() {
  return {
    meta: {
      schema_version: '1.0',
      generated_at: '2026-08-15T08:06:00+09:00',
      target_week_start: '2026-08-17',
      target_week_end: '2026-08-21',
      pipeline_version: 'test-pipeline-1',
      outcome: 'PUBLISH_READY',
      warnings: [],
      holds: [],
    },
    sources: [
      { source_id: 'au_rba', type: 'annual_schedule_config', fetched_at: '2026-08-15T08:00:00+09:00', url: 'https://www.rba.gov.au/schedules-events/board-meeting-schedules.html', ok: true, http_status: null, extractor_result_count: 1, robots_checked: true, fail_closed_decision: 'OK' },
      { source_id: 'manual', type: 'manual', fetched_at: '2026-08-15T08:00:00+09:00', url: 'config/manual-events.json', ok: true, http_status: null, extractor_result_count: 0, robots_checked: false, fail_closed_decision: 'OK' },
    ],
    events: [
      {
        event_id: 'au-rba-rate-2026-08-18', date_local: '2026-08-18', time_local: '14:30', tz: 'Australia/Sydney',
        date_jst: '2026-08-18', datetime_jst: '2026-08-18T13:30:00+09:00', time_status: 'published',
        country: 'AU', currency: 'AUD', kind: 'policy_rate', name_ja: 'RBA政策金利＆声明発表', importance: 3,
        source_id: 'au_rba', source_evidence: 'ground truth一致確認済み', name_resolution: 'dictionary',
        halt_window_start_jst: '2026-08-18T01:30:00+09:00', halt_window_end_jst: '2026-08-18T09:30:00+09:00', bundle_id: null,
      },
    ],
    coverage: { expected_coverage: { required: 8, missing: [] }, recurring_checks: [] },
  };
}

// SPEC §6.3「日別カード×5」・task #38実ネットワーク検証2026-08-15で発見: 実レンダラーは
// イベントが1件も無い日（8/17・8/19〜8/21）も空の日付グループとして出力するため、
// ledger-html-audit.mjsのauditDateGroups()もそれを期待値とする。フィクスチャは5グループ全てを含める
function baseHtml() {
  return `<div data-ea-report-meta="ea-weekly-20260817" data-ea-layout-version="ea-only-v4" data-ea-target-start="2026-08-17" data-ea-section-count="4" data-ea-reader-time-term="日本時間" data-ea-halt-guidance="pre4to12h">
  <div>対象週（日本時間） 8月17日（月）〜 8月21日（金）</div>
  <div class="ea-date-group" data-ea-date="2026-08-17" data-ea-date-event-count="0">
    <div>8月17日（月）</div>
  </div>
  <div class="ea-date-group" data-ea-date="2026-08-18" data-ea-date-event-count="1">
    <div>8月18日（火）</div>
    <div class="ea-event-card" data-ea-event-id="au-rba-rate-2026-08-18" data-ea-event-importance="3">RBA政策金利＆声明発表</div>
  </div>
  <div class="ea-date-group" data-ea-date="2026-08-19" data-ea-date-event-count="0">
    <div>8月19日（水）</div>
  </div>
  <div class="ea-date-group" data-ea-date="2026-08-20" data-ea-date-event-count="0">
    <div>8月20日（木）</div>
  </div>
  <div class="ea-date-group" data-ea-date="2026-08-21" data-ea-date-event-count="0">
    <div>8月21日（金）</div>
  </div>
  <div style="text-align:left;">
    テスト用免責文言テスト用出典文言
  </div>
</div>`;
}

const REPORT_POLICY = { forbidden_reader_terms: ['JST', '仮想通貨'], forbidden_sections: ['市況サマリー'], footer_disclaimer: 'テスト用免責文言', footer_source_statement: 'テスト用出典文言' };
const BTC_GUIDE = { allowed_domains: ['coinpost.jp'] };

test('runGateChecks: 妥当な組み合わせは全チェックPUBLISH_READY相当（エラー無し）', async () => {
  const { runGateChecks } = await loadGate();
  const checks = await runGateChecks({
    ledger: baseLedger(), html: baseHtml(), reportPolicy: REPORT_POLICY, btcGuide: BTC_GUIDE,
    skipMobile: true, skipLinkReachability: true,
  });
  const allErrors = checks.flatMap((c) => c.errors);
  assert.deepEqual(allErrors, [], JSON.stringify(checks, null, 2));
});

test('必須ケース: 出典（source_evidence）を空にする → ledger_schemaでHOLD', async () => {
  const { runGateChecks } = await loadGate();
  const ledger = baseLedger();
  ledger.events[0].source_evidence = '';
  const checks = await runGateChecks({
    ledger, html: baseHtml(), reportPolicy: REPORT_POLICY, btcGuide: BTC_GUIDE,
    skipMobile: true, skipLinkReachability: true,
  });
  const schemaCheck = checks.find((c) => c.name === 'ledger_schema');
  assert.ok(schemaCheck.errors.some((e) => e.includes('source_evidence')));
  assert.ok(checks.some((c) => c.errors.length > 0));
});

test('meta.outcome=HOLD（収集段の鮮度検証/フェールクローズ由来）はledger_outcomeでHOLDを伝播する', async () => {
  const { runGateChecks } = await loadGate();
  const ledger = baseLedger();
  ledger.meta.outcome = 'HOLD';
  ledger.meta.holds = ['判定不能: 2件のソースが同時に失敗'];
  const checks = await runGateChecks({
    ledger, html: baseHtml(), reportPolicy: REPORT_POLICY, btcGuide: BTC_GUIDE,
    skipMobile: true, skipLinkReachability: true,
  });
  const outcomeCheck = checks.find((c) => c.name === 'ledger_outcome');
  assert.ok(outcomeCheck.errors.some((e) => e.includes('判定不能')));
});

test('禁止語混入・許可外ドメインリンクはpolicy_lintでHOLD', async () => {
  const { runGateChecks } = await loadGate();
  const html = baseHtml().replace('8月18日（火）', '8月18日（火） JST').replace(
    '</div>\n</div>',
    '<a href="https://not-allowlisted.test/">リンク</a></div>\n</div>'
  );
  const checks = await runGateChecks({
    ledger: baseLedger(), html, reportPolicy: REPORT_POLICY, btcGuide: BTC_GUIDE,
    skipMobile: true, skipLinkReachability: true,
  });
  const lintCheck = checks.find((c) => c.name === 'policy_lint');
  assert.ok(lintCheck.errors.some((e) => e.includes('FORBIDDEN_READER_TERM')));
  assert.ok(lintCheck.errors.some((e) => e.includes('LINK_DOMAIN_NOT_ALLOWLISTED')));
});
