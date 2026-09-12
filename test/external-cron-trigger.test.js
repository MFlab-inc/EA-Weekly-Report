'use strict';
// ops/external-cron-trigger/trigger.mjs（GitHub Actionsのcron発火遅延対策として複数リポジトリへ
// 展開可能な設計にした外部トリガーツール、task #94フォローアップ3）のcron式マッチング・
// タイムゾーン変換・重複起動排除ロジックを検証する。ネットワーク呼び出し（dispatchWorkflow）は
// fetchImplモックで検証し、実際にGitHub APIを叩くテストは含まない。
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('parseCronField/matchesCronField: ワイルドカード・カンマ区切りリストを解釈する', async () => {
  const { parseCronField, matchesCronField } = await import('../ops/external-cron-trigger/trigger.mjs');
  assert.equal(parseCronField('*'), null);
  assert.deepEqual(parseCronField('5'), [5]);
  assert.deepEqual(parseCronField('5,6,7'), [5, 6, 7]);
  assert.equal(matchesCronField('*', 42), true);
  assert.equal(matchesCronField('5,6,7', 6), true);
  assert.equal(matchesCronField('5,6,7', 8), false);
});

test('matchesCron: 5フィールド全て一致した場合のみtrue、フィールド数が違えば例外', async () => {
  const { matchesCron } = await import('../ops/external-cron-trigger/trigger.mjs');
  const parts = { minute: 6, hour: 8, dayOfMonth: 12, month: 9, dayOfWeek: 6 };
  assert.equal(matchesCron('6 8 * * 6', parts), true);
  assert.equal(matchesCron('5,6,7,8,9 8 * * 6', parts), true);
  assert.equal(matchesCron('6 9 * * 6', parts), false, '時が不一致ならfalse');
  assert.equal(matchesCron('6 8 * * 0', parts), false, '曜日が不一致ならfalse');
  assert.throws(() => matchesCron('6 8 * *', parts), /5フィールド必要/);
});

// 2026-09-11T23:06:00Z = 2026-09-12 08:06 JST（土曜）。EA-Weekly-Reportのprimary cron予定
// 時刻と同じ実在の日時を使い、実際の運用シナリオに即した検証にする
test('partsInTimezone: UTC時刻を指定タイムゾーンのcron比較用フィールドへ正しく分解する', async () => {
  const { partsInTimezone } = await import('../ops/external-cron-trigger/trigger.mjs');
  const parts = partsInTimezone(new Date('2026-09-11T23:06:00Z'), 'Asia/Tokyo');
  assert.deepEqual(parts, { minute: 6, hour: 8, dayOfMonth: 12, month: 9, dayOfWeek: 6 });
});

test('dayKey: 指定タイムゾーンでの日付（YYYY-MM-DD）を返す。UTC日付が異なっていてもタイムゾーン変換後の日付になる', async () => {
  const { dayKey } = await import('../ops/external-cron-trigger/trigger.mjs');
  // UTC上は9/11だがJSTでは既に9/12
  assert.equal(dayKey(new Date('2026-09-11T23:06:00Z'), 'Asia/Tokyo'), '2026-09-12');
});

test('dueTargets: enabled=falseの対象は除外される', async () => {
  const { dueTargets } = await import('../ops/external-cron-trigger/trigger.mjs');
  const targets = [
    { id: 'a', repo: 'x/y', workflow: 'w.yml', ref: 'main', cron: '6 8 * * 6', timezone: 'Asia/Tokyo', enabled: false },
  ];
  const due = dueTargets(targets, new Date('2026-09-11T23:06:00Z'), {});
  assert.deepEqual(due, []);
});

test('dueTargets: cronが一致しない対象は除外される', async () => {
  const { dueTargets } = await import('../ops/external-cron-trigger/trigger.mjs');
  const targets = [
    { id: 'a', repo: 'x/y', workflow: 'w.yml', ref: 'main', cron: '0 9 * * 6', timezone: 'Asia/Tokyo', enabled: true },
  ];
  const due = dueTargets(targets, new Date('2026-09-11T23:06:00Z'), {});
  assert.deepEqual(due, []);
});

test('dueTargets: cron一致・enabled・未発火なら対象になる', async () => {
  const { dueTargets } = await import('../ops/external-cron-trigger/trigger.mjs');
  const targets = [
    { id: 'a', repo: 'x/y', workflow: 'w.yml', ref: 'main', cron: '5,6,7,8,9 8 * * 6', timezone: 'Asia/Tokyo', enabled: true },
  ];
  const now = new Date('2026-09-11T23:06:00Z');
  const due = dueTargets(targets, now, {});
  assert.equal(due.length, 1);
  assert.equal(due[0].target.id, 'a');
  assert.equal(due[0].dayKey, '2026-09-12');
});

// リトライ窓の要（本文参照）: 同日内で既に発火成功済み（state[id]===本日のdayKey）なら、
// cronフィールドが引き続き一致していても再度発火対象にはしない
test('dueTargets: 本日既に発火成功済み（stateに記録済み）なら重複して発火対象にしない', async () => {
  const { dueTargets } = await import('../ops/external-cron-trigger/trigger.mjs');
  const targets = [
    { id: 'a', repo: 'x/y', workflow: 'w.yml', ref: 'main', cron: '5,6,7,8,9 8 * * 6', timezone: 'Asia/Tokyo', enabled: true },
  ];
  const now = new Date('2026-09-11T23:07:00Z'); // 08:07 JST、まだリトライ窓内
  const state = { a: '2026-09-12' }; // 08:05 JSTで既に発火成功済みという想定
  const due = dueTargets(targets, now, state);
  assert.deepEqual(due, []);
});

test('dueTargets: 前回発火が別の日のstateなら、本日分は改めて発火対象になる（週替わりの正常系）', async () => {
  const { dueTargets } = await import('../ops/external-cron-trigger/trigger.mjs');
  const targets = [
    { id: 'a', repo: 'x/y', workflow: 'w.yml', ref: 'main', cron: '5,6,7,8,9 8 * * 6', timezone: 'Asia/Tokyo', enabled: true },
  ];
  const now = new Date('2026-09-11T23:06:00Z'); // 9/12（土）
  const state = { a: '2026-09-05' }; // 先週の土曜に発火済み
  const due = dueTargets(targets, now, state);
  assert.equal(due.length, 1);
});

test('loadTargets: 必須フィールドが欠けているエントリがあれば例外を投げる', async () => {
  const { loadTargets } = await import('../ops/external-cron-trigger/trigger.mjs');
  const { writeFileSync, unlinkSync } = require('node:fs');
  const path = require('node:path').join(__dirname, '__tmp_targets_invalid.json');
  writeFileSync(path, JSON.stringify([{ id: 'a', repo: 'x/y' }]));
  try {
    assert.throws(() => loadTargets(path), /必須フィールドがありません/);
  } finally {
    unlinkSync(path);
  }
});

test('loadTargets: 実ファイル（targets.json）が正しくパースでき、EA-Weekly-Report分が登録されている', async () => {
  const { loadTargets } = await import('../ops/external-cron-trigger/trigger.mjs');
  const path = require('node:path').join(__dirname, '..', 'ops', 'external-cron-trigger', 'targets.json');
  const targets = loadTargets(path);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].id, 'ea-weekly-report');
  assert.equal(targets[0].repo, 'MFlab-inc/EA-Weekly-Report');
  assert.equal(targets[0].enabled, true);
});

test('dispatchWorkflow: fetchImplへ正しいURL・ヘッダー・bodyを渡し、PAT未設定なら事前に例外を投げる', async () => {
  const { dispatchWorkflow } = await import('../ops/external-cron-trigger/trigger.mjs');
  const target = { id: 'a', repo: 'MFlab-inc/EA-Weekly-Report', workflow: 'weekly.yml', ref: 'main' };

  delete process.env.TEST_PAT_ENV_VAR;
  await assert.rejects(() => dispatchWorkflow(target, 'TEST_PAT_ENV_VAR'), /環境変数TEST_PAT_ENV_VARが設定されていません/);

  process.env.TEST_PAT_ENV_VAR = 'dummy-token';
  let capturedUrl;
  let capturedOptions;
  const fetchImpl = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return { ok: true };
  };
  await dispatchWorkflow(target, 'TEST_PAT_ENV_VAR', fetchImpl);
  assert.equal(capturedUrl, 'https://api.github.com/repos/MFlab-inc/EA-Weekly-Report/actions/workflows/weekly.yml/dispatches');
  assert.equal(capturedOptions.method, 'POST');
  assert.equal(capturedOptions.headers.Authorization, 'Bearer dummy-token');
  assert.deepEqual(JSON.parse(capturedOptions.body), { ref: 'main' });
  delete process.env.TEST_PAT_ENV_VAR;
});

test('dispatchWorkflow: HTTPエラー応答なら例外を投げる', async () => {
  const { dispatchWorkflow } = await import('../ops/external-cron-trigger/trigger.mjs');
  const target = { id: 'a', repo: 'MFlab-inc/EA-Weekly-Report', workflow: 'weekly.yml', ref: 'main' };
  process.env.TEST_PAT_ENV_VAR_2 = 'dummy-token';
  const fetchImpl = async () => ({ ok: false, status: 403, text: async () => 'Forbidden' });
  await assert.rejects(() => dispatchWorkflow(target, 'TEST_PAT_ENV_VAR_2', fetchImpl), /HTTP 403/);
  delete process.env.TEST_PAT_ENV_VAR_2;
});
