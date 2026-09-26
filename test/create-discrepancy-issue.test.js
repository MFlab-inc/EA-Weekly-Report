'use strict';
// scripts/check/create-discrepancy-issue.mjs（相違検出時のGitHub Issue自動作成、しょうさん指示
// 2026-09-26）の純粋関数（buildIssueBody・findExistingIssue）を検証する。GitHub APIへの
// 実通信は行わない（ネットワークアクセスはmain()のgh()のみに閉じ込めてあり、テスト対象外）
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('buildIssueBody: 時刻相違・欠落疑い・未認識kindの3セクションと注意書き・マーカーを含む本文を組み立てる', async () => {
  const { buildIssueBody } = await import('../scripts/check/create-discrepancy-issue.mjs');
  const report = {
    generated_at: '2026-09-22T00:00:00.000Z',
    target_week_start: '2026-09-21',
    discrepancy_count: 1,
    discrepancies: [
      {
        date_jst: '2026-09-24', name_ja: 'BOC総裁講演', country: 'CA',
        ledger_time_jst: '00:20', ff_time_jst_candidates: ['13:00'], ff_titles: ['BOC Gov Macklem Speaks'],
      },
    ],
    missing_high_impact_ff_events: [
      {
        jst_date: '2026-09-24', jst_time: '21:30', currency: 'USD', title: 'Core Durable Goods Orders m/m',
        matched_kinds: ['industrial_production'], applicable_countries: ['US'],
      },
    ],
    unrecognized_high_impact_ff_events: [
      { jst_date: '2026-09-25', jst_time: '09:00', currency: 'JPY', title: 'Some Unmodeled Release' },
    ],
  };
  const body = buildIssueBody(report, '2026-09-21', 'https://github.com/MFlab-inc/EA-Weekly-Report/actions/runs/123');

  assert.match(body, /### 時刻相違（1件）/);
  assert.match(body, /BOC総裁講演.*台帳=00:20 JST \/ FF=13:00 JST/);
  assert.match(body, /### 台帳に対応イベントが見つからない高インパクトFFイベント（1件）/);
  assert.match(body, /Core Durable Goods Orders m\/m/);
  assert.match(body, /### 参考: kind未認識の高インパクトFFイベント（1件、対応不要）/);
  assert.match(body, /Some Unmodeled Release/);
  assert.match(body, /FF（ForexFactory）は補助的な参考情報であり/);
  assert.match(body, /実行ログ: https:\/\/github\.com\/MFlab-inc\/EA-Weekly-Report\/actions\/runs\/123/);
  assert.match(body, /<!-- ff-cross-check:2026-09-21 -->/);
});

test('buildIssueBody: discrepancies/missing/unrecognizedがいずれも空なら各セクションを出力しない', async () => {
  const { buildIssueBody } = await import('../scripts/check/create-discrepancy-issue.mjs');
  const report = { discrepancies: [], missing_high_impact_ff_events: [], unrecognized_high_impact_ff_events: [] };
  const body = buildIssueBody(report, '2026-09-21', null);
  assert.doesNotMatch(body, /### 時刻相違/);
  assert.doesNotMatch(body, /### 台帳に対応イベントが見つからない/);
  assert.doesNotMatch(body, /### 参考: kind未認識/);
  assert.doesNotMatch(body, /実行ログ/);
  assert.match(body, /<!-- ff-cross-check:2026-09-21 -->/);
});

test('findExistingIssue: 対象週のマーカーを本文に含むopen issueを見つける', async () => {
  const { findExistingIssue } = await import('../scripts/check/create-discrepancy-issue.mjs');
  const openIssues = [
    { number: 10, body: 'ある別件のissue' },
    { number: 11, body: '本文...\n<!-- ff-cross-check:2026-09-21 -->' },
  ];
  const found = findExistingIssue(openIssues, '2026-09-21');
  assert.equal(found?.number, 11);
});

test('findExistingIssue: 一致するマーカーが無ければnullを返す（別週のマーカーとは一致しない）', async () => {
  const { findExistingIssue } = await import('../scripts/check/create-discrepancy-issue.mjs');
  const openIssues = [{ number: 12, body: '<!-- ff-cross-check:2026-09-14 -->' }];
  assert.equal(findExistingIssue(openIssues, '2026-09-21'), null);
});

test('findExistingIssue: open issueが0件ならnullを返す', async () => {
  const { findExistingIssue } = await import('../scripts/check/create-discrepancy-issue.mjs');
  assert.equal(findExistingIssue([], '2026-09-21'), null);
});
