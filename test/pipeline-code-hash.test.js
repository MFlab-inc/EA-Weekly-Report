'use strict';
// scripts/lib/pipeline-code-hash.js（task #92、2026-09-06、しょうさん指示: 冪等ガードの
// コミットSHA比較方式をこのハッシュ方式へ置き換え）の単体テスト。
//
// 冪等ガードには過去2つのバグがあった。このテストは両方の再発防止を直接検証する:
// (1) 過剰スキップ（2026-08-22発覚）: コードが変わったのに古い台帳の存在だけで
//     スキップし続けてしまう → 「scripts/・config/配下のファイルを変更するとハッシュが
//     変わる」ことをテストする
// (2) 過小スキップ（2026-09-05発覚）: コードが変わっていないのに、パイプライン自身の
//     コミット（data/・output/への書き込み）でHEADが進むだけで毎回再生成してしまう
//     → 「data/・output/相当の出力ディレクトリへの書き込みはハッシュに影響しない」ことを
//     テストする
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const os = require('node:os');
const { computePipelineCodeHash, PIPELINE_HASH_SCOPE_PATHS } = require('../scripts/lib/pipeline-code-hash.js');

// PIPELINE_HASH_SCOPE_PATHSに定義された対象範囲を持つ最小限のリポジトリ構造を一時ディレクトリに
// 作る（scripts/・config/配下に1ファイルずつ、package.json、.github/workflows/weekly.yml）。
// data/・output/・docs/・test/はスコープ外であることを確認するために作る
function makeFixtureRepo() {
  const root = mkdtempSync(join(os.tmpdir(), 'pipeline-hash-test-'));
  mkdirSync(join(root, 'scripts', 'lib'), { recursive: true });
  mkdirSync(join(root, 'config'), { recursive: true });
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  mkdirSync(join(root, 'data', 'ledger'), { recursive: true });
  mkdirSync(join(root, 'output'), { recursive: true });
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'lib', 'foo.js'), 'module.exports = 1;\n');
  writeFileSync(join(root, 'config', 'bar.json'), '{"a":1}\n');
  writeFileSync(join(root, 'package.json'), '{"name":"x","version":"0.0.1"}\n');
  writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
  writeFileSync(join(root, '.github', 'workflows', 'weekly.yml'), 'name: weekly-report\n');
  writeFileSync(join(root, 'docs', 'readme.md'), '# 対象外のはず\n');
  return root;
}

test('computePipelineCodeHash: 同一内容なら常に同一ハッシュ（決定論的）', () => {
  const root = makeFixtureRepo();
  try {
    const h1 = computePipelineCodeHash(root);
    const h2 = computePipelineCodeHash(root);
    assert.equal(h1, h2);
    assert.match(h1, /^[0-9a-f]{64}$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('computePipelineCodeHash: PIPELINE_HASH_SCOPE_PATHSはscripts/config/package.json等を含む', () => {
  assert.ok(PIPELINE_HASH_SCOPE_PATHS.includes('scripts'));
  assert.ok(PIPELINE_HASH_SCOPE_PATHS.includes('config'));
  assert.ok(PIPELINE_HASH_SCOPE_PATHS.includes('package.json'));
  assert.ok(PIPELINE_HASH_SCOPE_PATHS.includes('package-lock.json'));
  assert.ok(PIPELINE_HASH_SCOPE_PATHS.includes('.github/workflows/weekly.yml'));
});

// task #92のバグ(1): 過剰スキップの再発防止。scripts/またはconfig/配下のファイルを
// 変更すると、ハッシュが必ず変わる（=冪等チェックが「再生成すべき」と正しく判定できる）
test('computePipelineCodeHash: scripts/配下のファイル変更はハッシュを変える（過剰スキップ[8/22]の再発防止）', () => {
  const root = makeFixtureRepo();
  try {
    const before = computePipelineCodeHash(root);
    writeFileSync(join(root, 'scripts', 'lib', 'foo.js'), 'module.exports = 2;\n');
    const after = computePipelineCodeHash(root);
    assert.notEqual(before, after);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('computePipelineCodeHash: config/配下のファイル変更はハッシュを変える（過剰スキップ[8/22]の再発防止）', () => {
  const root = makeFixtureRepo();
  try {
    const before = computePipelineCodeHash(root);
    writeFileSync(join(root, 'config', 'bar.json'), '{"a":2}\n');
    const after = computePipelineCodeHash(root);
    assert.notEqual(before, after);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// task #92のバグ(2)そのものの再現テスト: 「本番cron→自身のコミットでHEAD前進→保険cron」の
// シーケンスを模する。本番cronのcommit outputsステップはdata/ledger/・output/配下に
// 新規ファイルを書き込むだけ（scripts/・config/は一切変更しない）。このときハッシュが
// 変わらないことを確認する＝保険cronは正しくスキップと判定できる
test('computePipelineCodeHash: 本番cron→保険cronのシーケンス再現: パイプラインの出力(data/・output/)への書き込みはハッシュに影響しない（過小スキップ[9/5]の再発防止）', () => {
  const root = makeFixtureRepo();
  try {
    // 本番cron: pipeline実行前のハッシュ（このハッシュがgenerated_from_code_hashとして台帳に記録される）
    const hashAtGeneration = computePipelineCodeHash(root);

    // 本番cronのcommit outputsステップに相当: data/ledger/・output/へ書き込み、HEADを進める
    // （このテストではgit commitそのものは行わないが、「コード変更を伴わないファイル追加」を
    // 模するには十分。実際のweekly.ymlでもこの2ディレクトリ以外はコミット対象にしていない）
    writeFileSync(join(root, 'data', 'ledger', '2026-09-14.json'), JSON.stringify({ meta: { generated_from_code_hash: hashAtGeneration } }));
    writeFileSync(join(root, 'output', 'ea-weekly-20260914.html'), '<div>dummy</div>');

    // 保険cron: 32分後に同じリポジトリ（HEADは本番cronの自己コミットで進んでいる想定）を
    // チェックアウトして再計算したハッシュ
    const hashAtInsuranceCron = computePipelineCodeHash(root);

    assert.equal(hashAtInsuranceCron, hashAtGeneration, '出力ディレクトリへの書き込みだけでハッシュが変わってはいけない（保険cronは必ずスキップと判定されるべき）');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('computePipelineCodeHash: docs/・data/・output/配下のファイルはスコープ外（変更してもハッシュ不変）', () => {
  const root = makeFixtureRepo();
  try {
    const before = computePipelineCodeHash(root);
    writeFileSync(join(root, 'docs', 'readme.md'), '# 変更後もスコープ外のはず\n');
    const after = computePipelineCodeHash(root);
    assert.equal(before, after);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('computePipelineCodeHash: .github/workflows/weekly.yml自体の変更もハッシュを変える', () => {
  const root = makeFixtureRepo();
  try {
    const before = computePipelineCodeHash(root);
    writeFileSync(join(root, '.github', 'workflows', 'weekly.yml'), 'name: weekly-report-changed\n');
    const after = computePipelineCodeHash(root);
    assert.notEqual(before, after);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('computePipelineCodeHash: 実リポジトリ（このプロジェクト自身）に対しても例外を投げずに実行できる', () => {
  const repoRoot = join(__dirname, '..');
  const hash = computePipelineCodeHash(repoRoot);
  assert.match(hash, /^[0-9a-f]{64}$/);
});
