#!/usr/bin/env node
// 土曜（本番・保険）cronのpipelineステップが失敗した際、GitHub Issueを自動作成する
// （しょうさん指摘、2026-10-03。10/5週の本番・保険cron両方がHOLDで失敗したが通知の仕組みが
// 無く、しょうさんが昼に自ら確認するまで誰も気づけなかったインシデントへの対策）。
// 既存のmonday-ff-cross-check用create-discrepancy-issue.mjsと同じ設計（マーカーで同一週の
// 重複作成を防ぐ）を踏襲する。weekly.ymlのbuildジョブの最後、if: failure() ステップから
// 呼び出される想定。
//
// 「どのステップで失敗したか」は、pipelineステップ内の各node実行（collect→build-ledger→
// render→gate、bash -eのため途中で止まる）が残すファイルの有無から推定する:
//   - gate-result.json が存在する → gate.mjsまで到達した（HOLD/REVIEW_REQUIREDで停止、または
//     想定通り完了後に後続のcommit outputsが別要因で失敗）。中身の決定・各検査のエラーを報告する
//   - 無いが data/ledger/<week>.json が存在する → renderまたはgateの実行中にクラッシュ
//   - どちらも無い → collectまたはbuild-ledgerの段階で失敗（ネットワーク広域障害・例外等）
import { existsSync, readFileSync } from 'node:fs';

const LABEL = 'weekly-pipeline-failure';

function marker(week) {
  return `<!-- weekly-pipeline-failure:${week} -->`;
}

function buildIssueBody({ week, gateResult, ledgerExists, runUrl }) {
  const lines = [];
  lines.push('## 週次レポート生成パイプラインの失敗');
  lines.push('');
  lines.push(`対象週（月曜始まり）: ${week}`);
  lines.push('');

  if (gateResult) {
    lines.push(`### gate判定: ${gateResult.decision}`);
    lines.push('');
    const errorChecks = (gateResult.checks || []).filter((c) => (c.errors || []).length > 0);
    if (errorChecks.length > 0) {
      lines.push('検出されたエラー:');
      lines.push('');
      for (const c of errorChecks) {
        for (const e of c.errors) lines.push(`- **[${c.name}]** ${e}`);
      }
      lines.push('');
    }
    if (gateResult.volume_check?.belowThreshold) {
      lines.push(`- **[volume_check]** 掲載対象=${gateResult.volume_check.displayedCount}件 / ★★★=${gateResult.volume_check.star3Count}件（${(gateResult.volume_check.reasons || []).join('、')}）`);
      lines.push('');
    }
  } else if (ledgerExists) {
    lines.push('### 失敗箇所: render または gate の実行中');
    lines.push('');
    lines.push(`台帳（data/ledger/${week}.json）は生成されましたが、gate-result.jsonが見つかりませんでした。renderまたはgate.mjsの実行中に例外で停止した可能性があります。詳細は実行ログを確認してください。`);
    lines.push('');
  } else {
    lines.push('### 失敗箇所: collect または build-ledger の実行中');
    lines.push('');
    lines.push('台帳ファイル自体が生成されていません。collect.mjs（外部ソースへの実アクセス）またはbuild-ledger.mjsの段階で失敗した可能性があります（ネットワーク広域障害・例外等）。詳細は実行ログを確認してください。');
    lines.push('');
  }

  lines.push('---');
  lines.push('この週のレポートはまだ生成・配信されていません。対応方法:');
  lines.push('- 原因を解消し、`workflow_dispatch`（`force_regenerate: true`）で再生成してください');
  lines.push('- 保険cron（土曜08:41 JST）がこの後に控えている場合、自動的に再試行されます（冪等チェックによりコードが変わっていなければ同じ原因で再度失敗する可能性が高い点に注意）');
  if (runUrl) {
    lines.push('');
    lines.push(`実行ログ: ${runUrl}`);
  }
  lines.push('');
  lines.push(marker(week));
  return lines.join('\n');
}

function findExistingIssue(openIssues, week) {
  const m = marker(week);
  return openIssues.find((issue) => typeof issue.body === 'string' && issue.body.includes(m)) ?? null;
}

async function gh(path, opts = {}) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(opts.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub API ${opts.method ?? 'GET'} ${path} 失敗: HTTP ${res.status} ${body}`);
  }
  return res.status === 204 ? null : res.json();
}

async function main() {
  const week = process.argv[2];
  if (!week) {
    console.error('使い方: node create-pipeline-failure-issue.mjs <target_week_start YYYY-MM-DD> [gate-result.json path]');
    process.exitCode = 1;
    return;
  }
  const gateResultPath = process.argv[3] ?? 'gate-result.json';
  const gateResult = existsSync(gateResultPath) ? JSON.parse(readFileSync(gateResultPath, 'utf8')) : null;
  const ledgerExists = existsSync(`data/ledger/${week}.json`);

  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPOSITORY) {
    console.error('GITHUB_TOKEN/GITHUB_REPOSITORYが未設定です。Issue作成をスキップします。');
    process.exitCode = 1;
    return;
  }

  const openIssues = await gh(`/issues?state=open&labels=${encodeURIComponent(LABEL)}&per_page=100`);
  const existing = findExistingIssue(openIssues, week);
  if (existing) {
    console.log(`対象週${week}の失敗Issueは既に存在します（#${existing.number}）。重複作成をスキップします。`);
    return;
  }

  const serverUrl = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
  const runId = process.env.GITHUB_RUN_ID;
  const runUrl = runId ? `${serverUrl}/${process.env.GITHUB_REPOSITORY}/actions/runs/${runId}` : null;

  const body = buildIssueBody({ week, gateResult, ledgerExists, runUrl });
  const title = `[週次レポート生成失敗] ${week}週`;
  const created = await gh('/issues', {
    method: 'POST',
    body: JSON.stringify({ title, body, labels: [LABEL] }),
  });
  console.log(`Issueを作成しました: #${created.number} ${created.html_url}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error('FATAL:', e);
    process.exitCode = 1;
  });
}

export { buildIssueBody, findExistingIssue, marker };
