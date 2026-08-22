'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { countriesWithKind, missingCountriesInDict } = require('../scripts/lib/validate-naming-coverage');

test('countriesWithKind: active/draft_scheduleソースのみをkind別に集計する', () => {
  const sourcesConfig = {
    sources: [
      { country: 'US', status: 'active', kinds: ['policy_rate'] },
      { country: 'JP', status: 'active', kinds: ['policy_rate', 'cpi'] },
      { country: 'DE', status: 'pending_recon', kinds: ['policy_rate'] },
    ],
  };
  assert.deepEqual(countriesWithKind(sourcesConfig, 'policy_rate'), ['JP', 'US']);
});

test('missingCountriesInDict: 辞書に無い国を検出する', () => {
  assert.deepEqual(missingCountriesInDict(['JP', 'US', 'DE'], { JP: '日銀', US: 'FRB' }), ['DE']);
});

test('missingCountriesInDict: excludeCountriesで対象外にできる（BOJ専用テンプレートのJP等）', () => {
  assert.deepEqual(missingCountriesInDict(['JP', 'US'], { US: 'FOMC議事録' }, { excludeCountries: ['JP'] }), []);
});

// 以下、実config（official-sources.json + naming.js/build-ledger.jsの各辞書）に対する回帰ゲート。
// task #54のCURRENCY_BY_COUNTRY/COUNTRY_JA_BY_ISOと同じ考え方: 新しいpolicy_rate/quarterly_report/
// minutes_summary/official_speechソースを追加した際、対応する命名辞書への追加を忘れるとここで落ちる
const sourcesConfig = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'official-sources.json'), 'utf8'));

test('実config — policy_rate/quarterly_reportソース登録国が全てnaming.BANK_ABBR_BY_COUNTRYに登録されている', () => {
  const naming = require('../scripts/lib/naming');
  const required = [...new Set([...countriesWithKind(sourcesConfig, 'policy_rate'), ...countriesWithKind(sourcesConfig, 'quarterly_report')])];
  const missing = missingCountriesInDict(required, naming.BANK_ABBR_BY_COUNTRY);
  assert.deepEqual(missing, [], `BANK_ABBR_BY_COUNTRYに未登録の国がある（政策金利/四半期報告が汎用ラベルへ劣化する）: ${missing}`);
});

test('実config — minutes_summaryソース登録国（JP=BOJ専用テンプレート除く）が全てbuild-ledger.MINUTES_SUMMARY_NAME_BY_COUNTRYに登録されている', () => {
  const { MINUTES_SUMMARY_NAME_BY_COUNTRY } = require('../scripts/lib/build-ledger');
  const required = countriesWithKind(sourcesConfig, 'minutes_summary');
  const missing = missingCountriesInDict(required, MINUTES_SUMMARY_NAME_BY_COUNTRY, { excludeCountries: ['JP'] });
  assert.deepEqual(missing, [], `MINUTES_SUMMARY_NAME_BY_COUNTRYに未登録の国がある（議事要旨が汎用ラベルへ劣化する）: ${missing}`);
});

// JPは除外（2026-08-22、task #64・jp_boj_speeches新設）: BOJは副総裁・審議委員・理事等で話者ごとに
// 役職が異なるため、US（FRB理事で統一）のような国単位の固定ラベルが成立しない。resolveRuleGeneratedName
// はofficials.jsonで話者本人が特定できればその人物自身のrole_jaを使う設計のため、国単位辞書
// （OFFICIAL_SPEECH_ROLE_BY_COUNTRY）への登録は不要（未登録話者はFALLBACK_KIND_LABEL『要人発言』へ）
test('実config — official_speechソース登録国（JP=話者個別role_ja方式のため除く）が全てbuild-ledger.OFFICIAL_SPEECH_ROLE_BY_COUNTRYに登録されている', () => {
  const { OFFICIAL_SPEECH_ROLE_BY_COUNTRY } = require('../scripts/lib/build-ledger');
  const required = countriesWithKind(sourcesConfig, 'official_speech');
  const missing = missingCountriesInDict(required, OFFICIAL_SPEECH_ROLE_BY_COUNTRY, { excludeCountries: ['JP'] });
  assert.deepEqual(missing, [], `OFFICIAL_SPEECH_ROLE_BY_COUNTRYに未登録の国がある（要人発言が汎用ラベルへ劣化する）: ${missing}`);
});
