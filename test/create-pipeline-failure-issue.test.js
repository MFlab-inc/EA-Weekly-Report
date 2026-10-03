'use strict';
// scripts/check/create-pipeline-failure-issue.mjs（土曜cronのpipeline失敗時のGitHub Issue
// 自動作成、しょうさん指摘2026-10-03: 10/5週の本番・保険cron両方がHOLDで失敗したが通知が無かった）
// の純粋関数（buildIssueBody・findExistingIssue）を検証する。GitHub APIへの実通信は行わない
// （ネットワークアクセスはmain()のgh()のみに閉じ込めてあり、テスト対象外）
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('buildIssueBody: gate-result.jsonがある場合、決定・各検査のエラーを本文に含める（10/5週の実インシデント再現）', async () => {
  const { buildIssueBody } = await import('../scripts/check/create-pipeline-failure-issue.mjs');
  const gateResult = {
    decision: 'HOLD',
    checks: [
      { name: 'ledger_schema', errors: [], warnings: [] },
      { name: 'ledger_html_audit', errors: ['DATE_OUT_OF_TARGET_WEEK: 対象週外の日付がHTMLに含まれています: 0月3日（土）'], warnings: [] },
    ],
    volume_check: { displayedCount: 17, star3Count: 5, belowThreshold: false },
  };
  const body = buildIssueBody({ week: '2026-10-05', gateResult, ledgerExists: true, runUrl: 'https://github.com/MFlab-inc/EA-Weekly-Report/actions/runs/123' });

  assert.match(body, /対象週（月曜始まり）: 2026-10-05/);
  assert.match(body, /### gate判定: HOLD/);
  assert.match(body, /\*\*\[ledger_html_audit\]\*\* DATE_OUT_OF_TARGET_WEEK/);
  assert.match(body, /実行ログ: https:\/\/github\.com\/MFlab-inc\/EA-Weekly-Report\/actions\/runs\/123/);
  assert.match(body, /<!-- weekly-pipeline-failure:2026-10-05 -->/);
});

test('buildIssueBody: 件数下限チェック抵触（REVIEW_REQUIRED）のvolume_check詳細も含める', async () => {
  const { buildIssueBody } = await import('../scripts/check/create-pipeline-failure-issue.mjs');
  const gateResult = {
    decision: 'REVIEW_REQUIRED',
    checks: [{ name: 'ledger_schema', errors: [], warnings: [] }],
    volume_check: { displayedCount: 2, star3Count: 0, belowThreshold: true, reasons: ['★★★が0件'] },
  };
  const body = buildIssueBody({ week: '2026-10-05', gateResult, ledgerExists: true, runUrl: null });
  assert.match(body, /### gate判定: REVIEW_REQUIRED/);
  assert.match(body, /\*\*\[volume_check\]\*\* 掲載対象=2件 \/ ★★★=0件（★★★が0件）/);
});

test('buildIssueBody: gate-result.jsonが無いが台帳はある場合、render/gateでの失敗と推定する', async () => {
  const { buildIssueBody } = await import('../scripts/check/create-pipeline-failure-issue.mjs');
  const body = buildIssueBody({ week: '2026-10-05', gateResult: null, ledgerExists: true, runUrl: null });
  assert.match(body, /### 失敗箇所: render または gate の実行中/);
  assert.match(body, /<!-- weekly-pipeline-failure:2026-10-05 -->/);
});

test('buildIssueBody: 台帳も無い場合、collect/build-ledgerでの失敗と推定する', async () => {
  const { buildIssueBody } = await import('../scripts/check/create-pipeline-failure-issue.mjs');
  const body = buildIssueBody({ week: '2026-10-05', gateResult: null, ledgerExists: false, runUrl: null });
  assert.match(body, /### 失敗箇所: collect または build-ledger の実行中/);
});

test('findExistingIssue: 対象週のマーカーを本文に含むopen issueを見つける', async () => {
  const { findExistingIssue } = await import('../scripts/check/create-pipeline-failure-issue.mjs');
  const openIssues = [
    { number: 20, body: 'ある別件のissue' },
    { number: 21, body: '本文...\n<!-- weekly-pipeline-failure:2026-10-05 -->' },
  ];
  assert.equal(findExistingIssue(openIssues, '2026-10-05')?.number, 21);
});

test('findExistingIssue: 一致するマーカーが無ければnullを返す（別週のマーカーとは一致しない）', async () => {
  const { findExistingIssue } = await import('../scripts/check/create-pipeline-failure-issue.mjs');
  const openIssues = [{ number: 22, body: '<!-- weekly-pipeline-failure:2026-09-28 -->' }];
  assert.equal(findExistingIssue(openIssues, '2026-10-05'), null);
});

test('findExistingIssue: open issueが0件ならnullを返す', async () => {
  const { findExistingIssue } = await import('../scripts/check/create-pipeline-failure-issue.mjs');
  assert.equal(findExistingIssue([], '2026-10-05'), null);
});
