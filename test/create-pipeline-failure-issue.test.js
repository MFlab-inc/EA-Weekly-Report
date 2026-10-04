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

// 2026-10-03追加（しょうさん指摘item3続き: 12/28週[年末年始]の生成までに手動公開経路が必要）
test('isPureVolumeReviewRequired: 監査エラー無し・REVIEW_REQUIREDならtrue', async () => {
  const { isPureVolumeReviewRequired } = await import('../scripts/check/create-pipeline-failure-issue.mjs');
  const gateResult = { decision: 'REVIEW_REQUIRED', checks: [{ name: 'ledger_schema', errors: [], warnings: [] }] };
  assert.equal(isPureVolumeReviewRequired(gateResult), true);
});

test('isPureVolumeReviewRequired: decisionがHOLDならfalse（監査エラーがある週は対象外）', async () => {
  const { isPureVolumeReviewRequired } = await import('../scripts/check/create-pipeline-failure-issue.mjs');
  const gateResult = { decision: 'HOLD', checks: [{ name: 'ledger_html_audit', errors: ['test'], warnings: [] }] };
  assert.equal(isPureVolumeReviewRequired(gateResult), false);
});

test('isPureVolumeReviewRequired: REVIEW_REQUIREDでも何らかの検査にerrorsがあればfalse（念のための防御）', async () => {
  const { isPureVolumeReviewRequired } = await import('../scripts/check/create-pipeline-failure-issue.mjs');
  const gateResult = { decision: 'REVIEW_REQUIRED', checks: [{ name: 'ledger_html_audit', errors: ['test'], warnings: [] }] };
  assert.equal(isPureVolumeReviewRequired(gateResult), false);
});

test('isPureVolumeReviewRequired: gateResultが無ければfalse', async () => {
  const { isPureVolumeReviewRequired } = await import('../scripts/check/create-pipeline-failure-issue.mjs');
  assert.equal(isPureVolumeReviewRequired(null), false);
});

test('buildIssueBody: 件数下限のみのREVIEW_REQUIREDは確認後に公開する手順（acknowledge_low_volume）を案内する', async () => {
  const { buildIssueBody } = await import('../scripts/check/create-pipeline-failure-issue.mjs');
  const gateResult = {
    decision: 'REVIEW_REQUIRED',
    checks: [{ name: 'ledger_schema', errors: [], warnings: [] }],
    volume_check: { displayedCount: 3, star3Count: 2, belowThreshold: true, reasons: ['掲載対象イベントが下限(4件)未満'] },
  };
  const body = buildIssueBody({ week: '2026-12-28', gateResult, ledgerExists: true, runUrl: null, repo: 'MFlab-inc/EA-Weekly-Report' });

  assert.match(body, /### 確認後に公開する手順/);
  assert.match(body, /output\/review\/ea-weekly-20261228\.html/);
  assert.match(body, /https:\/\/raw\.githubusercontent\.com\/MFlab-inc\/EA-Weekly-Report\/main\/output\/review\/ea-weekly-20261228\.html/);
  assert.match(body, /https:\/\/htmlpreview\.github\.io\/\?https:\/\/raw\.githubusercontent\.com/);
  assert.match(body, /acknowledge_low_volume/);
  assert.match(body, /weekly-report/);
  // 監査エラーがあるHOLDはこの手順では絶対に公開されない旨の注意書きも含める
  assert.match(body, /HOLDの週は、この手順では絶対に公開されません/);
  // 従来のforce_regenerate一般案内は出さない（確認後公開の手順に置き換わるため）
  assert.doesNotMatch(body, /force_regenerate: true/);
});

test('buildIssueBody: repo未指定でも確認後に公開する手順自体は出る（raw URLは相対パスにフォールバック）', async () => {
  const { buildIssueBody } = await import('../scripts/check/create-pipeline-failure-issue.mjs');
  const gateResult = {
    decision: 'REVIEW_REQUIRED',
    checks: [{ name: 'ledger_schema', errors: [], warnings: [] }],
    volume_check: { displayedCount: 3, star3Count: 2, belowThreshold: true, reasons: ['test'] },
  };
  const body = buildIssueBody({ week: '2026-12-28', gateResult, ledgerExists: true, runUrl: null });
  assert.match(body, /### 確認後に公開する手順/);
  assert.doesNotMatch(body, /htmlpreview\.github\.io/);
});

test('buildIssueBody: HOLD（監査エラーあり）は確認後に公開する手順を案内しない。従来どおりforce_regenerate案内のまま', async () => {
  const { buildIssueBody } = await import('../scripts/check/create-pipeline-failure-issue.mjs');
  const gateResult = {
    decision: 'HOLD',
    checks: [{ name: 'ledger_html_audit', errors: ['DATE_OUT_OF_TARGET_WEEK: test'], warnings: [] }],
    volume_check: { displayedCount: 3, star3Count: 0, belowThreshold: true, reasons: ['test'] },
  };
  const body = buildIssueBody({ week: '2026-12-28', gateResult, ledgerExists: true, runUrl: null, repo: 'MFlab-inc/EA-Weekly-Report' });
  assert.doesNotMatch(body, /### 確認後に公開する手順/);
  assert.doesNotMatch(body, /acknowledge_low_volume/);
  assert.match(body, /force_regenerate: true/);
});
