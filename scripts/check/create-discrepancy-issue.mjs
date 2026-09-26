#!/usr/bin/env node
// SPEC §3.3「月曜事後突合」で相違・欠落が検出された際、GitHub Issueを自動作成する
// （しょうさん指示、2026-09-26。9/21週の突合run失敗が「失敗」という形でしかしょうさんへ
// 気づかれず、discrepancy-report.jsonの中身を見るには手動でActionsログを掘る必要があった
// ことへの対策）。weekly.ymlのmonday-ff-cross-checkジョブが失敗した直後、
// if: failure() ステップから呼び出される想定。
//
// 同一対象週（discrepancy-report.jsonのtarget_week_start）につき1件のみ作成する。
// 判定方法: 作成するIssue本文に <!-- ff-cross-check:{week} --> というマーカーを埋め込み、
// labels=ff-discrepancyのopen issueを検索してこのマーカーを含むものが既にあればスキップする
// （タイトル文字列一致ではなくマーカー一致にしたのは、タイトルの言い回しを将来変更しても
// 既存Issueとの対応関係が壊れないようにするため）。
import { existsSync, readFileSync } from 'node:fs';

const LABEL = 'ff-discrepancy';

function marker(week) {
  return `<!-- ff-cross-check:${week} -->`;
}

// report: ff-cross-check.mjsが出力するdiscrepancy-report.jsonの中身
function buildIssueBody(report, week, runUrl) {
  const lines = [];
  lines.push('## FF月曜事後突合: 相違・欠落の検出');
  lines.push('');
  lines.push(`対象週（月曜始まり）: ${week}`);
  lines.push('');

  if (report.discrepancies?.length > 0) {
    lines.push(`### 時刻相違（${report.discrepancies.length}件）`);
    lines.push('台帳の発表時刻とFFの発表時刻が一致しません。');
    lines.push('');
    for (const d of report.discrepancies) {
      lines.push(
        `- **${d.date_jst} [${d.country}] ${d.name_ja}**: 台帳=${d.ledger_time_jst} JST / FF=${d.ff_time_jst_candidates.join(', ')} JST（FFタイトル: "${d.ff_titles.join('", "')}"）`
      );
    }
    lines.push('');
  }

  if (report.missing_high_impact_ff_events?.length > 0) {
    lines.push(`### 台帳に対応イベントが見つからない高インパクトFFイベント（${report.missing_high_impact_ff_events.length}件）`);
    lines.push('FFがHighと分類しているイベントについて、対応する台帳イベントが同日に1件も見つかりませんでした。');
    lines.push('');
    for (const m of report.missing_high_impact_ff_events) {
      lines.push(
        `- ${m.jst_date} ${m.jst_time} JST [${m.currency}] "${m.title}"（kind候補: ${m.matched_kinds.join(', ')} / 対象国候補: ${m.applicable_countries.join(', ')}）`
      );
    }
    lines.push('');
  }

  if (report.unrecognized_high_impact_ff_events?.length > 0) {
    lines.push(`### 参考: kind未認識の高インパクトFFイベント（${report.unrecognized_high_impact_ff_events.length}件、対応不要）`);
    lines.push('このプロジェクトがモデル化しているkindのどれにも一致しない表記のため、欠落の可能性は低いと考えられます（参考情報）。');
    lines.push('');
    for (const u of report.unrecognized_high_impact_ff_events) {
      lines.push(`- ${u.jst_date} ${u.jst_time} JST [${u.currency}] "${u.title}"`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(
    '⚠️ FF（ForexFactory）は補助的な参考情報であり、一次情報源ではありません。表記揺れ・時刻の丸め・同一通貨の別イベントとの誤マッチ等により、実際には問題ないケースを含み得ます。対応の要否は必ず公式一次ソースで確認してください。'
  );
  if (runUrl) {
    lines.push('');
    lines.push(`実行ログ: ${runUrl}`);
  }
  lines.push('');
  lines.push(marker(week));
  return lines.join('\n');
}

// openIssues: GitHub REST API GET /issues の結果配列
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
  const reportPath = process.argv[2] ?? 'discrepancy-report.json';
  if (!existsSync(reportPath)) {
    console.log(`${reportPath} が存在しません（相違なし、または本チェック以外の要因での失敗）。Issue作成をスキップします。`);
    return;
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const week = report.target_week_start;
  if (!week) {
    console.error('discrepancy-report.jsonにtarget_week_startがありません。Issue作成をスキップします。');
    process.exitCode = 1;
    return;
  }
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPOSITORY) {
    console.error('GITHUB_TOKEN/GITHUB_REPOSITORYが未設定です。Issue作成をスキップします。');
    process.exitCode = 1;
    return;
  }

  const openIssues = await gh(`/issues?state=open&labels=${encodeURIComponent(LABEL)}&per_page=100`);
  const existing = findExistingIssue(openIssues, week);
  if (existing) {
    console.log(`対象週${week}の相違Issueは既に存在します（#${existing.number}）。重複作成をスキップします。`);
    return;
  }

  const serverUrl = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
  const runId = process.env.GITHUB_RUN_ID;
  const runUrl = runId ? `${serverUrl}/${process.env.GITHUB_REPOSITORY}/actions/runs/${runId}` : null;

  const body = buildIssueBody(report, week, runUrl);
  const title = `[FF事後突合] ${week}週: 相違・欠落あり`;
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
