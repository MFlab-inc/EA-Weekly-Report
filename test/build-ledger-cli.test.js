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

// 2026-10-03追加（しょうさん指摘item4: 定例欠落WARN誤報の抑制）。
// scripts/lib/suppress-repeat-recurring-warnings.jsの配線がbuildLedgerFromCollectResult経由で
// 実際にledger.meta.warningsへ反映されることを確認する（単体テストはsuppress-repeat-
// recurring-warnings.test.jsで別途実施済み。ここでは配線自体の確認が目的）
test('buildLedgerFromCollectResult: previousLedgerを渡すと同一周期・前週found:trueの定例欠落WARNがledger.meta.warningsから抑制される', async () => {
  const { buildLedgerFromCollectResult } = await import('../scripts/build-ledger.mjs');
  const sourcesConfig = { sources: [] };
  const manualEventsConfig = { entries: [] };
  const officialsConfig = { officials: [] };
  const expectedCoverageConfig = { derived_rules: [] };
  const importanceRules = {
    recurring_checks: [{ name: '豪州貿易収支（ABS）', rule: '毎月1日〜10日ごろ', action: 'WARN' }],
  };
  const targetWeek = { targetWeekStart: '2026-10-05', targetWeekEnd: '2026-10-09', dates: [{ date: '2026-10-05' }] };
  const collectResult = {
    targetWeek,
    report: {
      targetWeek: { start: '2026-10-05', end: '2026-10-09' },
      outcome: { status: 'OK', reasons: [] },
      residualWarnings: [],
      recurringMissingWarnings: ['定例欠落: 「豪州貿易収支（ABS）」（毎月1日〜10日ごろ）が対象週に該当する見込みだが検出されなかった。WARN'],
      results: [],
    },
    candidates: [],
  };
  // 前週(9/28週、月をまたぐ)で既に検出済み（found:true）
  const previousLedger = {
    meta: { target_week_start: '2026-09-28', target_week_end: '2026-10-02' },
    coverage: { recurring_checks: [{ name: '豪州貿易収支（ABS）', applies_this_week: true, found: true }] },
  };

  const ledger = buildLedgerFromCollectResult({
    collectResult, sourcesConfig, manualEventsConfig, officialsConfig, importanceRules, expectedCoverageConfig,
    generatedAt: '2026-10-05T08:06:00+09:00', previousLedger,
  });

  assert.ok(!ledger.meta.warnings.some((w) => w.includes('豪州貿易収支（ABS）')), `抑制されるはずのWARNが残っている: ${JSON.stringify(ledger.meta.warnings)}`);
  // coverage.recurring_checks自体は抑制の影響を受けず、今週の生の検出結果（found:false）を
  // 正直に記録し続ける（翌週以降の抑制判定の入力として正しく機能するため）
  const status = ledger.coverage.recurring_checks.find((s) => s.name === '豪州貿易収支（ABS）');
  assert.equal(status.found, false);
});

test('buildLedgerFromCollectResult: previousLedger未指定時は定例欠落WARNを抑制せず従来どおり出す（安全側の既定動作）', async () => {
  const { buildLedgerFromCollectResult } = await import('../scripts/build-ledger.mjs');
  const sourcesConfig = { sources: [] };
  const manualEventsConfig = { entries: [] };
  const officialsConfig = { officials: [] };
  const expectedCoverageConfig = { derived_rules: [] };
  const importanceRules = {
    recurring_checks: [{ name: '豪州貿易収支（ABS）', rule: '毎月1日〜10日ごろ', action: 'WARN' }],
  };
  const targetWeek = { targetWeekStart: '2026-10-05', targetWeekEnd: '2026-10-09', dates: [{ date: '2026-10-05' }] };
  const warningText = '定例欠落: 「豪州貿易収支（ABS）」（毎月1日〜10日ごろ）が対象週に該当する見込みだが検出されなかった。WARN';
  const collectResult = {
    targetWeek,
    report: {
      targetWeek: { start: '2026-10-05', end: '2026-10-09' },
      outcome: { status: 'OK', reasons: [] },
      residualWarnings: [],
      recurringMissingWarnings: [warningText],
      results: [],
    },
    candidates: [],
  };

  const ledger = buildLedgerFromCollectResult({
    collectResult, sourcesConfig, manualEventsConfig, officialsConfig, importanceRules, expectedCoverageConfig,
    generatedAt: '2026-10-05T08:06:00+09:00',
  });

  assert.ok(ledger.meta.warnings.includes(warningText));
});
