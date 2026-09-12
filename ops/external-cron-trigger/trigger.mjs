#!/usr/bin/env node
'use strict';
// 複数リポジトリの土曜cron遅延対策（docs/cron-trigger-reliability-proposal.md参照）。
//
// GitHub Actionsのscheduleトリガーは、GitHub側の負荷次第で数十分〜数時間発火が遅れることがある
// （EA-Weekly-Reportでの実測: 過去最大約5時間。しょうさんのEA-Risk-Monitorでは「実行の大半が
// drop」との報告もあり、特定リポジトリ固有の問題ではなくGitHub Actions全体の既知の制約）。
//
// 本ツールはVPSのタスクスケジューラから毎分（または短い間隔で）起動され、targets.jsonに登録された
// 各リポジトリのworkflow_dispatchを、GitHub側のscheduleとは独立に直接叩く。対象リポジトリの
// workflow.yml自体は無変更（workflow_dispatchは元々存在するトリガー）。GitHub側のschedule cronは
// そのままフォールバックとして残す設計のため、本ツールが失敗してもGitHub側のcronが保険になる。
//
// 【設計方針: 複数リポジトリへの展開を最初から想定】
// - 起動対象はtargets.json（このディレクトリ内）で管理する。対象を増やす場合は
//   このファイルへ1エントリ追記するだけでよく、本スクリプト自体の変更は不要
//   （ただしPAT側の「Repository access」設定には新しいリポジトリを追加する必要がある。
//   docs/cron-trigger-reliability-proposal.md「PATの運用方針」参照）
// - スクリプト本体は対象ごとに複製せず、この1本がtargets.jsonを読んで全対象を処理する
// - 実際の展開はEA-Weekly-Report 1本から段階的に行う（しょうさん方針）。targets.jsonには
//   現時点でEA-Weekly-Reportのみを登録している
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGETS_PATH = process.env.TARGETS_FILE || join(__dirname, 'targets.json');
const STATE_PATH = process.env.STATE_FILE || join(__dirname, 'state.json');
const DEFAULT_PAT_ENV_VAR = 'EXTERNAL_TRIGGER_PAT';

// cronの各フィールドは `*`（全許可）または カンマ区切りの整数リストのみサポートする
// （範囲[-]・ステップ[/]記法は非対応）。週1回起動＋数分のリトライ窓という用途には
// カンマ区切りリストで十分なため、意図的にシンプルに保つ（対象repo側のweekly.yml等が使う
// GitHub Actions cron書式のフィールド数・意味とは揃えつつ、パーサ自体は独自の簡易実装）
export function parseCronField(field) {
  if (field === '*') return null; // null = ワイルドカード
  return field.split(',').map((s) => Number(s.trim()));
}

export function matchesCronField(field, value) {
  const allowed = parseCronField(field);
  return allowed === null || allowed.includes(value);
}

// cronExpr: 'minute hour day-of-month month day-of-week' の5フィールド（day-of-weekは
// 0=日曜〜6=土曜。GitHub Actionsのschedule cronと同じ意味）
export function matchesCron(cronExpr, parts) {
  const fields = cronExpr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`cron式は5フィールド必要です（minute hour day-of-month month day-of-week）: "${cronExpr}"`);
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  return (
    matchesCronField(minute, parts.minute) &&
    matchesCronField(hour, parts.hour) &&
    matchesCronField(dayOfMonth, parts.dayOfMonth) &&
    matchesCronField(month, parts.month) &&
    matchesCronField(dayOfWeek, parts.dayOfWeek)
  );
}

// 指定タイムゾーンでの現在時刻をcron比較に必要なフィールドへ分解する。Node組み込みのIntlのみで
// 完結させ、外部ライブラリ（moment-timezone等）への依存を避ける（VPS側にnpm installを
// 要求しないため。targets.jsonの各対象が異なるタイムゾーンでも正しく扱える）
export function partsInTimezone(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    minute: 'numeric',
    hour: 'numeric',
    hourCycle: 'h23',
    day: 'numeric',
    month: 'numeric',
    weekday: 'short',
  });
  const byType = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const WEEKDAY_TO_NUM = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    minute: Number(byType.minute),
    hour: Number(byType.hour),
    dayOfMonth: Number(byType.day),
    month: Number(byType.month),
    dayOfWeek: WEEKDAY_TO_NUM[byType.weekday],
  };
}

// 指定タイムゾーンでの「今日」を表すキー（YYYY-MM-DD）。重複起動の排除粒度は「1日1回」とする
// （週次カデンスの対象しか想定しないため。cronのminuteフィールドにカンマ区切りで複数分
// [例: "5,6,7,8,9"] を指定しておけば、最初の成功分でstateが記録され、以降の分は
// このキーで自動的にスキップされる＝簡易的なリトライ窓として機能する）
export function dayKey(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

// targets.jsonの1エントリに必須のフィールド。pat_env_varは省略可（省略時はDEFAULT_PAT_ENV_VARを使う）
const REQUIRED_TARGET_FIELDS = ['id', 'repo', 'workflow', 'ref', 'cron', 'timezone', 'enabled'];

export function loadTargets(path = TARGETS_PATH) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  for (const t of raw) {
    const missing = REQUIRED_TARGET_FIELDS.filter((k) => !(k in t));
    if (missing.length > 0) {
      throw new Error(`targets.jsonのエントリに必須フィールドがありません(${missing.join(', ')}): ${JSON.stringify(t)}`);
    }
  }
  return raw;
}

export function loadState(path = STATE_PATH) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function saveState(state, path = STATE_PATH) {
  writeFileSync(path, JSON.stringify(state, null, 2));
}

// 現時点で発火すべきターゲット一覧を返す（enabled=trueかつcron一致かつ本日未発火のもの）。
// 純粋関数（今日の日付・stateを引数で受け取る）としてテスト容易性を確保している
export function dueTargets(targets, now, state) {
  const due = [];
  for (const t of targets) {
    if (!t.enabled) continue;
    const parts = partsInTimezone(now, t.timezone);
    if (!matchesCron(t.cron, parts)) continue;
    const key = dayKey(now, t.timezone);
    if (state[t.id] === key) continue; // 本日は既に発火成功済み
    due.push({ target: t, dayKey: key });
  }
  return due;
}

export async function dispatchWorkflow(target, patEnvVar, fetchImpl = fetch) {
  const token = process.env[patEnvVar];
  if (!token) throw new Error(`環境変数${patEnvVar}が設定されていません（${target.id}用のPAT）`);
  const url = `https://api.github.com/repos/${target.repo}/actions/workflows/${target.workflow}/dispatches`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ ref: target.ref }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${target.id}のworkflow_dispatchが失敗しました: HTTP ${res.status} ${body}`);
  }
}

async function main() {
  const targets = loadTargets();
  const state = loadState();
  const now = new Date();
  const due = dueTargets(targets, now, state);
  for (const { target, dayKey: key } of due) {
    try {
      await dispatchWorkflow(target, target.pat_env_var || DEFAULT_PAT_ENV_VAR);
      state[target.id] = key;
      console.log(`[${new Date().toISOString()}] 起動成功: ${target.id} (${target.repo}/${target.workflow})`);
    } catch (err) {
      // 失敗時はstateを更新しない＝リトライ窓（cronのminuteフィールドに複数分指定していれば）
      // 内の次回起動で再試行される
      console.error(`[${new Date().toISOString()}] 起動失敗: ${target.id}: ${err.message}`);
    }
  }
  saveState(state);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
