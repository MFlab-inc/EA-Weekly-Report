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

// 実configに対する回帰ゲート。task #19（2026-08-15）時点でRBA/BOJ/FRB/ECB/BOE/BOCの6中銀は
// active/draft_scheduleのpolicy_rate担当ソースを持つ。RBNZ/SNBはRBNZと同じ「人間が年1回、
// 公式ページを目視して確定する」手入力方式（annual_schedule_config）での解決待ちのため
// pending_reconのまま（しょうさんへの確認待ち。docs/annual-schedule-maintenance.md参照）。
// この2件は既知のギャップとして明示的にassertする＝新たな中銀の担当ソースが意図せず欠落した場合は
// missingに想定外の国コードが増えてこのテストが落ちる（回帰検知）。RBNZ/SNBが解決されたら
// このテストの期待値を更新すること（その変更自体が「カバレッジ表がGREENになった」ことの記録になる）
test('validateExpectedCoverage: 実config — 6/8中銀は充足、既知のギャップ（RBNZ・SNB）のみ残っている', () => {
  const sourcesConfig = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'official-sources.json'), 'utf8'));
  const officials = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'officials.json'), 'utf8'));
  const expectedCoverageConfig = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'expected-coverage.json'), 'utf8'));
  const r = validateExpectedCoverage(sourcesConfig, officials, expectedCoverageConfig);
  assert.equal(r.required.length, 8, 'officials.json登録中銀8行から導出される必須カバレッジは8件のはず');
  assert.deepEqual(r.missing.map((m) => m.country).sort(), ['CH', 'NZ'], 'RBNZ(NZ)・SNB(CH)以外は全てカバレッジ充足しているはず（新規欠落の回帰検知）');
});
