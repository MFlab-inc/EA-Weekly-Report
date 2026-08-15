'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { validateOfficialSources } = require('../scripts/lib/validate-official-sources');

function loadConfig() {
  return JSON.parse(readFileSync(require('node:path').join(__dirname, '..', 'config', 'official-sources.json'), 'utf8'));
}

test('config/official-sources.json はスキーマ検証をパスする', () => {
  const config = loadConfig();
  const errors = validateOfficialSources(config);
  assert.deepEqual(errors, []);
});

test('config/official-sources.json の優先度A・9元がstatus=active/draft_scheduleで登録されている', () => {
  const config = loadConfig();
  const priorityA = ['us_bls_fred', 'au_rba', 'us_census', 'gb_ons', 'nz_statsnz', 'ca_statcan', 'au_abs', 'us_ism', 'jp_boj'];
  for (const id of priorityA) {
    const s = config.sources.find((x) => x.id === id);
    assert.ok(s, `優先度Aソース ${id} が見つからない`);
    assert.notEqual(s.status, 'pending_recon', `優先度Aソース ${id} はpending_reconであってはならない`);
  }
});

test('validateOfficialSources: sourcesが配列でなければエラーを返す', () => {
  assert.deepEqual(validateOfficialSources({}), ['sources配列が存在しません']);
});

test('validateOfficialSources: id重複を検出する', () => {
  const errors = validateOfficialSources({
    sources: [
      { id: 'x', name_ja: 'X', status: 'active', type: 'weekly_scrape', kinds: ['gdp'], access: { targets: [] }, announce_time_by_kind: {} },
      { id: 'x', name_ja: 'X2', status: 'pending_recon', type: 'weekly_scrape', kinds: ['gdp'], access: { targets: [] }, announce_time_by_kind: {} },
    ],
  });
  assert.ok(errors.some((e) => e.includes('id重複')));
});

test('validateOfficialSources: date_api_fredにfred.releasesが無ければエラー', () => {
  const errors = validateOfficialSources({
    sources: [{ id: 'x', name_ja: 'X', status: 'active', type: 'date_api_fred', kinds: ['cpi'] }],
  });
  assert.ok(errors.some((e) => e.includes('fred.releases')));
});
