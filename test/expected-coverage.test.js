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
// missingが非空になりこのテストが落ちる（回帰検知）
test('validateExpectedCoverage: 実config — 8/8中銀すべてpolicy_rate担当ソースを充足している', () => {
  const sourcesConfig = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'official-sources.json'), 'utf8'));
  const officials = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'officials.json'), 'utf8'));
  const expectedCoverageConfig = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'expected-coverage.json'), 'utf8'));
  const r = validateExpectedCoverage(sourcesConfig, officials, expectedCoverageConfig);
  assert.equal(r.required.length, 8, 'officials.json登録中銀8行から導出される必須カバレッジは8件のはず');
  assert.equal(r.ok, true, '8/8中銀すべて充足しているはず（新規欠落の回帰検知）');
  assert.deepEqual(r.missing, []);
});
