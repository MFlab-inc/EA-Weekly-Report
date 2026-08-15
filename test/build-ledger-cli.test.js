'use strict';
// scripts/build-ledger.mjs（トップレベルCLI、scripts/lib/build-ledger.jsの薄いオーケストレーション層）の
// buildLedgerFromCollectResult()を検証する。scripts/lib/build-ledger.test.jsはbuildLedger()自体
// （純粋関数）を対象とし、こちらはcollect-result.json形→buildLedger()呼び出しの配線を対象とする
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('buildLedgerFromCollectResult: collect-result.json形からcandidatesと期待カバレッジ・定例欠落を集約した台帳を組み立てる', async () => {
  const { buildLedgerFromCollectResult } = await import('../scripts/build-ledger.mjs');
  const officials = [
    { role_ja: 'RBA総裁', role_type: 'central_bank_governor', country: 'AU', name_ja: 'ブロック', verified: true, full_name: 'ミシェル・ブロック（Michele Bullock）' },
  ];
  const officialsConfig = { officials };
  const sourcesConfig = {
    sources: [{ id: 'au_rba', country: 'AU', type: 'annual_schedule_config', kinds: ['policy_rate'], status: 'active' }],
  };
  const manualEventsConfig = { entries: [] };
  const expectedCoverageConfig = { derived_rules: [{ name: '中銀policy_rate必須', officials_role_type: 'central_bank_governor', required_kind: 'policy_rate' }] };
  const importanceRules = { recurring_checks: [] };
  const targetWeek = { targetWeekStart: '2026-08-17', targetWeekEnd: '2026-08-21', dates: [{ date: '2026-08-18' }] };
  const collectResult = {
    targetWeek,
    report: {
      targetWeek: { start: '2026-08-17', end: '2026-08-21' },
      outcome: { status: 'OK', reasons: [] },
      residualWarnings: [], recurringMissingWarnings: [],
      results: [{ id: 'au_rba', ok: true, skipped: false, matchedEntries: [{ date: '2026-08-18', kind: 'policy_rate' }] }],
    },
    candidates: [
      { date: '2026-08-18', time: '13:30', kind: 'policy_rate', country: 'AU', importance: 3, displayName: null, sourceId: 'au_rba', sourceEvidence: 'test', localDate: '2026-08-18', localTime: '14:30', tz: 'Australia/Sydney' },
    ],
  };

  const ledger = buildLedgerFromCollectResult({
    collectResult, sourcesConfig, manualEventsConfig, officialsConfig, importanceRules, expectedCoverageConfig,
    generatedAt: '2026-08-15T08:06:00Z',
  });

  assert.equal(ledger.meta.outcome, 'PUBLISH_READY');
  assert.equal(ledger.events.length, 1);
  // officialsConfigが渡っているため、displayName未解決でもnaming.js経由でRBA政策金利名が解決される
  assert.equal(ledger.events[0].name_ja, 'RBA政策金利＆声明発表');
  // AU/policy_rateはau_rbaでカバー済みのためmissingは空
  assert.equal(ledger.coverage.expected_coverage.missing.length, 0);
});
