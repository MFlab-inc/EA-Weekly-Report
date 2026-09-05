'use strict';
// パイプラインの「コード」がその生成物に対して変わったかどうかを判定するためのハッシュ計算
// （task #92、2026-09-06、しょうさん指示: 冪等ガードをコミットSHA比較からこの方式へ移行）。
//
// 背景（冪等ガードの2つの既知バグ、いずれも同じ根本原因＝「コミットSHAは実際の出力ロジックの
// 変化と1対1対応しない」ことに起因する）:
// (1) 過剰スキップ（2026-08-22発覚・0bb5eb9で是正）: 手動実行が対象週を先取り生成した後、
//     コードを何度修正してmainへマージしても、生成時に記録されたコミットSHAと現在のHEADが
//     一致しないだけで「差分あり」と誤判定してしまう…はずが、実際は逆に「ファイルの存在有無」
//     だけで判定していた最初の実装が「ファイルがある限り永久スキップ」してしまっていた欠陥。
// (2) 過小スキップ（2026-09-05発覚）: (1)の修正でgenerated_from_commit（github.sha）と
//     現在のHEADの比較方式に直したが、この方式には「パイプライン自身のcommit outputsステップが
//     data/・output/を書き換えてHEADを進める」という副作用がある。本番cron（08:06 JST）が
//     生成→コミットしてHEADを進めた直後に保険cron（08:41 JST）が同じ週を再チェックすると、
//     台帳に記録されたgenerated_from_commit（本番cronのチェックアウト時点のSHA）と、保険cronの
//     チェックアウト時点のHEAD（本番cronの自己コミットで既に進んでいる）が必ず不一致になり、
//     コードが一切変わっていなくても毎回再生成してしまっていた。
//
// 解決方針: 「コミットSHAが変わったか」ではなく「パイプラインの出力に影響しうるファイル群の
// 内容が変わったか」を直接判定する。data/・output/（パイプラインが書き込む側）を除外し、
// パイプラインが読み込む側（scripts/・config/・依存関係定義・ワークフロー定義自体）だけを
// 対象にハッシュ化する。この対象範囲はPIPELINE_HASH_SCOPE_PATHSとして明示的にエクスポートし、
// 「何が変わったら再生成すべきか」の判断基準そのものとして扱う（docs/ledger-schema.md参照）。
const { createHash } = require('node:crypto');
const { readFileSync, readdirSync, statSync } = require('node:fs');
const { join, relative, sep } = require('node:path');

// ハッシュ対象の範囲（repoRootからの相対パス）。ここに無いパス（data/・output/・docs/・test/・
// reference/・templates/・HANDOFF.md・SPEC.md等）が変わっても再生成のトリガーにはしない
// （出力結果やドキュメント・テストはパイプラインの挙動そのものを変えないため）。
// - scripts/: 抽出・命名・重要度判定・レンダリングの実装コード全体
// - config/: officials/official-sources/event-names/importance-rules/manual-events等、
//   出力内容を直接左右する設定データ全体
// - package.json・package-lock.json: 依存ライブラリのバージョン変更も出力に影響しうる
// - .github/workflows/weekly.yml: パイプライン自体の定義（このファイル自身の冪等チェック
//   ロジックが変わった場合も「コードが変わった」とみなし再生成すべきため含める）
const PIPELINE_HASH_SCOPE_PATHS = [
  'scripts',
  'config',
  'package.json',
  'package-lock.json',
  '.github/workflows/weekly.yml',
];

function listFilesRecursive(absPath) {
  const st = statSync(absPath, { throwIfNoEntry: false });
  if (!st) return [];
  if (st.isFile()) return [absPath];
  if (!st.isDirectory()) return [];
  const out = [];
  for (const entry of readdirSync(absPath, { withFileTypes: true })) {
    const childAbs = join(absPath, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(childAbs));
    else if (entry.isFile()) out.push(childAbs);
  }
  return out;
}

// repoRoot: リポジトリルートの絶対パス（省略時process.cwd()。weekly.ymlはcheckout直後の
// リポジトリルートで実行するためこれで足りる）
// 戻り値: 64文字のSHA-256 16進文字列。対象範囲のファイル群のパス+内容のみに依存し、
// git commit・タイムスタンプ・実行環境には依存しない（同一内容なら常に同一値）
function computePipelineCodeHash(repoRoot = process.cwd()) {
  const manifestLines = [];
  for (const scopePath of PIPELINE_HASH_SCOPE_PATHS) {
    const absScopePath = join(repoRoot, scopePath);
    for (const absFile of listFilesRecursive(absScopePath)) {
      const relPath = relative(repoRoot, absFile).split(sep).join('/');
      const content = readFileSync(absFile);
      const fileHash = createHash('sha256').update(content).digest('hex');
      manifestLines.push(`${relPath}:${fileHash}`);
    }
  }
  manifestLines.sort();
  return createHash('sha256').update(manifestLines.join('\n')).digest('hex');
}

module.exports = { computePipelineCodeHash, PIPELINE_HASH_SCOPE_PATHS };
