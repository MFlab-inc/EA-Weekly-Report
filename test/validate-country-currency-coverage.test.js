'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { collectRegistryCountries, validateCountryCurrencyCoverage } = require('../scripts/lib/validate-country-currency-coverage');

test('collectRegistryCountries: sources[].countryから重複無しの国コード一覧を導出する', () => {
  const sourcesConfig = { sources: [{ country: 'JP' }, { country: 'US' }, { country: 'JP' }] };
  assert.deepEqual(collectRegistryCountries(sourcesConfig), ['JP', 'US']);
});

test('validateCountryCurrencyCoverage: 両dictに正しく登録済みならok:true', () => {
  const sourcesConfig = { sources: [{ country: 'JP' }] };
  const r = validateCountryCurrencyCoverage(sourcesConfig, { JP: '日本' }, { JP: 'JPY' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
});

test('validateCountryCurrencyCoverage: 国名ピル辞書に未登録ならmissingJa:trueで検出する', () => {
  const sourcesConfig = { sources: [{ country: 'DE' }] };
  const r = validateCountryCurrencyCoverage(sourcesConfig, {}, { DE: 'EUR' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, [{ country: 'DE', missingJa: true, missingCurrency: false, rawCodeLeak: false }]);
});

test('validateCountryCurrencyCoverage: 通貨コード辞書に未登録ならmissingCurrency:trueで検出する（task #54のDE事故そのもの: 両方未登録のケース）', () => {
  const sourcesConfig = { sources: [{ country: 'DE' }] };
  const r = validateCountryCurrencyCoverage(sourcesConfig, {}, {});
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, [{ country: 'DE', missingJa: true, missingCurrency: true, rawCodeLeak: false }]);
});

// キー自体は登録されているが値が生のISOコードのまま（誤って{DE: 'DE'}のように登録してしまった場合）
// missingJaチェックだけでは見逃す事故パターン。countryJaOfのフォールバックと結果的に同じ表示になる
test('validateCountryCurrencyCoverage: 国名ピル辞書の値が生のISOコードと同一ならrawCodeLeak:trueで検出する', () => {
  const sourcesConfig = { sources: [{ country: 'DE' }] };
  const r = validateCountryCurrencyCoverage(sourcesConfig, { DE: 'DE' }, { DE: 'EUR' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, [{ country: 'DE', missingJa: false, missingCurrency: false, rawCodeLeak: true }]);
});

test('validateCountryCurrencyCoverage: NZのみ値が"NZ"のままでも許容される（既刊実例の意図的な非日本語化）', () => {
  const sourcesConfig = { sources: [{ country: 'NZ' }] };
  const r = validateCountryCurrencyCoverage(sourcesConfig, { NZ: 'NZ' }, { NZ: 'NZD' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
});

// task #54（2026-08-15、しょうさん指摘: DE国追加時にCOUNTRY_JA_BY_ISO/CURRENCY_BY_COUNTRYへの
// 追加漏れで国名ピル・通貨ピルが「DEDE」と二重表示された）の回帰ゲート。以後、新規国を
// official-sources.jsonへ追加した際にこの2つの並行dictへの追加を忘れるとこのテストが落ちる
test('validateCountryCurrencyCoverage: 実config — official-sources.json登場国が全てCOUNTRY_JA_BY_ISO/CURRENCY_BY_COUNTRYに正しく登録されている', () => {
  const sourcesConfig = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'official-sources.json'), 'utf8'));
  const { COUNTRY_JA_BY_ISO } = require('../scripts/render/ledger-to-week-input.js');
  const { CURRENCY_BY_COUNTRY } = require('../scripts/lib/build-ledger.js');
  const r = validateCountryCurrencyCoverage(sourcesConfig, COUNTRY_JA_BY_ISO, CURRENCY_BY_COUNTRY);
  assert.equal(r.ok, true, `未登録または生コードのままの国がある（国名ピル・通貨ピルが漏れる）: ${JSON.stringify(r.missing)}`);
  assert.deepEqual(r.missing, []);
});
