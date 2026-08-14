'use strict';
// 観測モード実行スクリプト（scripts/phase1/observation-run.mjs）の合成データ検証。
// 実アクセスはActions上の本番実行（2026-08-15 08:06 JST予定）でのみ行うため、
// ここでは合成report（runChecks()の戻り値と同じ形）で組み立てロジックのみを検証する。
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('annualEntryToCandidate: announce_time_by_kindのlocal_time+tzからJST時刻を正しく変換する', async () => {
  const { annualEntryToCandidate } = await import('../scripts/phase1/observation-run.mjs');
  const source = {
    id: 'au_rba',
    country: 'AU',
    announce_time_by_kind: { policy_rate: { local_time: '14:30', tz: 'Australia/Sydney' } },
  };
  const importanceRules = { importance_by_kind: { policy_rate: 3 } };
  const c = annualEntryToCandidate({ date: '2026-08-11', kind: 'policy_rate' }, source, importanceRules);
  assert.equal(c.date, '2026-08-11');
  assert.equal(c.time, '13:30'); // AEST(UTC+10)夏時間なし 14:30→JST 13:30
  assert.equal(c.importance, 3);
  assert.equal(c.sourceId, 'au_rba');
});

test('annualEntryToCandidate: announce_time_by_kindが無いkindはtime:nullで返す（構造的に想定されるケース）', async () => {
  const { annualEntryToCandidate } = await import('../scripts/phase1/observation-run.mjs');
  const source = { id: 'x', country: 'XX', announce_time_by_kind: {} };
  const c = annualEntryToCandidate({ date: '2026-08-11', kind: 'unknown_kind' }, source, {});
  assert.equal(c.time, null);
  assert.equal(c.timeNote, 'announce_time_by_kind未設定');
});

test('buildObservationSummary: thisWeek由来とmatchedEntries由来の候補を統合し、★★★のみ停止窓を計算する', async () => {
  const { buildObservationSummary } = await import('../scripts/phase1/observation-run.mjs');
  const report = {
    targetWeek: { start: '2026-08-17', end: '2026-08-21' },
    outcome: { status: 'OK' },
    residualWarnings: [],
    recurringMissingWarnings: [],
    results: [
      {
        id: 'us_bls_fred',
        ok: true,
        thisWeek: [
          { date: '2026-08-19', time: '21:30', kind: 'cpi', country: 'US', importance: 3, displayName: '消費者物価指数（CPI）' },
        ],
      },
      {
        id: 'au_rba',
        ok: true,
        matchedEntries: [{ date: '2026-08-18', kind: 'policy_rate' }],
      },
      { id: 'nz_statsnz', ok: false, skipped: false, reason: 'テスト用失敗' },
      { id: 'cn_pmi', skipped: true, reason: 'pending_recon' },
    ],
  };
  const sourcesConfig = {
    sources: [
      { id: 'au_rba', country: 'AU', announce_time_by_kind: { policy_rate: { local_time: '14:30', tz: 'Australia/Sydney' } } },
    ],
  };
  const importanceRules = { importance_by_kind: { policy_rate: 3 } };

  const summary = buildObservationSummary(report, sourcesConfig, importanceRules);
  assert.equal(summary.candidateCount, 2);
  assert.equal(summary.star3Count, 2);
  assert.equal(summary.star3TimedCount, 2);
  assert.ok(summary.haltByDate['2026-08-19']);
  assert.ok(summary.haltByDate['2026-08-18']);
  assert.equal(summary.haltByDate['2026-08-19'].windowCount, 1);
  // CPI 21:30 -> 停止開始目安 09:30-17:30（4〜12時間前）
  assert.equal(summary.haltByDate['2026-08-19'].windows[0].displayStart, '09:30');
  assert.equal(summary.haltByDate['2026-08-19'].windows[0].displayEnd, '17:30');
  // skippedは候補に含まれない
  assert.ok(!summary.candidates.some((c) => c.sourceId === 'cn_pmi'));
});

test('renderText: outcome・候補一覧・停止目安を含むテキストを生成する（例外を投げない）', async () => {
  const { buildObservationSummary, renderText } = await import('../scripts/phase1/observation-run.mjs');
  const report = {
    targetWeek: { start: '2026-08-17', end: '2026-08-21' },
    outcome: { status: 'HOLD', reason: 'テスト理由' },
    residualWarnings: [{ id: 'us_ism', reason: 'テストWARN' }],
    recurringMissingWarnings: ['定例欠落テスト'],
    results: [{ id: 'x', skipped: true, reason: 'テスト' }],
  };
  const summary = buildObservationSummary(report, { sources: [] }, {});
  const text = renderText(summary);
  assert.match(text, /HOLD/);
  assert.match(text, /テストWARN/);
  assert.match(text, /定例欠落テスト/);
  assert.match(text, /対象週に時刻判明済みの★★★候補なし/);
});
