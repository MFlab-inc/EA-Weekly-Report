'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { deriveRequiredCoverage, isCovered, validateExpectedCoverage } = require('../scripts/lib/validate-expected-coverage');

const EXPECTED_COVERAGE_RULE = {
  derived_rules: [
    { name: '中銀のpolicy_rate担当ソース必須', officials_role_type: 'central_bank_governor', required_kind: 'policy_rate' },
  ],
  additional_required: [],
};

test('deriveRequiredCoverage: role_type=central_bank_governorの役職からcountry×kindを導出する（財務省等の非中銀役職は除外）', () => {
  const officials = {
    officials: [
      { role_ja: '日銀総裁', role_type: 'central_bank_governor', country: 'JP' },
      { role_ja: '米財務長官', role_type: 'finance_ministry', country: 'US' },
    ],
  };
  const required = deriveRequiredCoverage(officials, EXPECTED_COVERAGE_RULE);
  assert.deepEqual(required.map((r) => `${r.country}:${r.kind}`), ['JP:policy_rate']);
});

test('deriveRequiredCoverage: countryが未設定の役職は導出対象外', () => {
  const officials = { officials: [{ role_ja: '設定漏れ役職', role_type: 'central_bank_governor' }] };
  assert.deepEqual(deriveRequiredCoverage(officials, EXPECTED_COVERAGE_RULE), []);
});

test('isCovered: active/draft_scheduleのソースは充足とみなす', () => {
  const sourcesConfig = { sources: [{ country: 'JP', kinds: ['policy_rate'], status: 'active' }] };
  assert.equal(isCovered(sourcesConfig, 'JP', 'policy_rate'), true);
});

test('isCovered: pending_reconのソースは充足とみなさない（実行時runChecksでskipされ実質何もチェックしないため）', () => {
  const sourcesConfig = { sources: [{ country: 'NZ', kinds: ['policy_rate'], status: 'pending_recon' }] };
  assert.equal(isCovered(sourcesConfig, 'NZ', 'policy_rate'), false);
});

test('isCovered: country一致でもkindが無ければ充足とみなさない', () => {
  const sourcesConfig = { sources: [{ country: 'JP', kinds: ['opinions_summary'], status: 'active' }] };
  assert.equal(isCovered(sourcesConfig, 'JP', 'policy_rate'), false);
});

test('validateExpectedCoverage: 全件充足ならok:true・missing:[]', () => {
  const officials = { officials: [{ role_ja: '日銀総裁', role_type: 'central_bank_governor', country: 'JP' }] };
  const sourcesConfig = { sources: [{ country: 'JP', kinds: ['policy_rate'], status: 'active' }] };
  const r = validateExpectedCoverage(sourcesConfig, officials, EXPECTED_COVERAGE_RULE);
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
});

test('validateExpectedCoverage: 未充足があればok:false・missingに列挙される', () => {
  const officials = {
    officials: [
      { role_ja: '日銀総裁', role_type: 'central_bank_governor', country: 'JP' },
      { role_ja: 'RBNZ総裁', role_type: 'central_bank_governor', country: 'NZ' },
    ],
  };
  const sourcesConfig = { sources: [{ country: 'JP', kinds: ['policy_rate'], status: 'active' }] };
  const r = validateExpectedCoverage(sourcesConfig, officials, EXPECTED_COVERAGE_RULE);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing.map((m) => m.country), ['NZ']);
});

// 実configに対する回帰ゲート。2026-08-15: しょうさんが一次ソースを直接確認しRBNZ（annual_schedule_config・
// schedule確定）・SNB（weekly_scrape・event-scheduleページの平文リスト抽出）の担当ソースが解決したため、
// 8/8中銀すべてがactive/draft_scheduleのpolicy_rate担当ソースを持つ状態になった（期待カバレッジCIグリーン化。
// docs/annual-schedule-maintenance.md参照）。以後、新たな中銀の担当ソースが意図せず欠落した場合は
// missingが非空になりこのテストが落ちる（回帰検知）。derived_rules（policy_rate）のみを対象にし、
// 下記の国×kindマトリクス（additional_required）とは独立に検証する
test('validateExpectedCoverage: 実config — 8/8中銀すべてpolicy_rate担当ソースを充足している', () => {
  const sourcesConfig = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'official-sources.json'), 'utf8'));
  const officials = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'officials.json'), 'utf8'));
  const expectedCoverageConfig = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'expected-coverage.json'), 'utf8'));
  const derivedOnlyConfig = { ...expectedCoverageConfig, additional_required: [] };
  const r = validateExpectedCoverage(sourcesConfig, officials, derivedOnlyConfig);
  assert.equal(r.required.length, 8, 'officials.json登録中銀8行から導出される必須カバレッジは8件のはず');
  assert.equal(r.ok, true, '8/8中銀すべて充足しているはず（新規欠落の回帰検知）');
  assert.deepEqual(r.missing, []);
});

// task #38（実ネットワーク検証、しょうさん指摘2026-08-15）の是正: 中銀policy_rate以外の
// 定例統計発表元がexpected-coverageで一切検査されておらず、対象週の主要イベントが軒並み
// 欠落してもPUBLISH_READYが出てしまう「サイレント欠落」があった。国×kindの必須マトリクスを
// config/expected-coverage.jsonのadditional_requiredへ追加し（しょうさん承認2026-08-15）、
// 担当ソースが無い組み合わせをコミット時点（npm test）で検出できるようにした。
//
// 【スナップショット方式（しょうさん承認2026-08-15）】CIを恒常的に赤くすると他の本物の
// 失敗が埋もれるため、現在の既知の欠損リストを明示的に列挙する方式を採用。この方式でも
// 「想定外の新規欠落」「既存カバレッジの後退」は即座に検知できる（missingがこの配列と
// 一致しなくなるため）。以下の各行は「なぜ未対応か・担当予定ソース・task #41内の着手順」を
// 併記し、放置された欠損と作業待ちの欠損を区別できるようにしている。
//
// 【task #41完了条件（しょうさん指示2026-08-15）】task #41が完了しstillMissingが空になったら、
// 以下のassert.deepEqualを`assert.deepEqual(r.missing, [])`の厳格版へ切り替えること
test('validateExpectedCoverage: 実config — 国×kind必須マトリクス（しょうさん承認2026-08-15）の充足状況', () => {
  const sourcesConfig = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'official-sources.json'), 'utf8'));
  const officials = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'officials.json'), 'utf8'));
  const expectedCoverageConfig = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'expected-coverage.json'), 'utf8'));
  const r = validateExpectedCoverage(sourcesConfig, officials, expectedCoverageConfig);
  const stillMissing = r.missing.map((m) => `${m.country}:${m.kind}`).sort();
  const expectedStillMissing = [
    // --- task #41-1（中銀議事要旨4件。既存ソースへの追記で対応可能。着手順1・最優先） ---
    'US:minutes_summary', // FOMC議事録。既存us_frb_policy_rateへ追記（会合終了+21日固定オフセット）
    'EU:minutes_summary', // ECB Accounts of the monetary policy meeting。既存ecb_policy_rateへ追記（次回日程を事前明示）
    'AU:minutes_summary', // RBA議事要旨。既存au_rbaへ追記（会合2週間後固定オフセット）
    'CA:minutes_summary', // BOC Summary of Governing Council Deliberations。既存boc_policy_rateへ追記（BOCが翌年分日程を毎年8月に事前公表）
    // --- task #41-2（日本3件。新規annual_schedule_config候補として調査済み。着手順2） ---
    'JP:cpi', // 総務省統計局。固定ルール（19日を含む週の金曜08:30）
    'JP:gdp', // 内閣府/ESRI。stat-schedule.htmlでFY2026全4四半期の日程確認済み
    'JP:trade_balance', // 財務省税関。calend.htmで年次スケジュール確認済み
    // --- task #41-3（Eurostat・フラッシュPMI。着手順3） ---
    'EU:cpi', // ユーロ圏HICP。Eurostat release-calendar ICSフィード（tier a、calendar_EN.ics）
    'EU:gdp', // Eurostat。ICSフィードで対応可能
    'EU:pmi_ism', // フラッシュPMI（HCOB/S&P Global）
    'GB:pmi_ism', // フラッシュPMI（製造業/サービス業）。現行gb_construction_pmiは建設業PMIのみで対象外、別ソース必要
    // --- task #41-4（NZ・AU GDP・CN 3件。着手順4・最後） ---
    'NZ:cpi', // 未調査。Stats NZの担当ページ実測が必要
    'NZ:gdp', // 未調査。同上
    'AU:gdp', // ABS実fixture窓に未出現。ABS正式名『Australian National Accounts』のライブ確認待ち
    'CN:industrial_production', // NBS（国家統計局）担当。新設kind、新規ソース未実装
    'CN:retail_sales', // NBS担当。新規ソース未実装
    'CN:gdp', // NBS担当（四半期GDP）。新規ソース未実装
  ].sort();
  assert.deepEqual(
    stillMissing,
    expectedStillMissing,
    'task #41の進捗と食い違う場合は、このリストを実際のmissingへ更新すること（新規に閉じた項目を削除・想定外の新規欠落があれば要調査）。全件解消したらassert.deepEqual(r.missing, [])の厳格版へ切り替えること（task #41完了条件）'
  );
});
