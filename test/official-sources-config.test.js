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

// task #49（2026-08-15、しょうさん指示の残量監視WARN切り分け）の回帰テスト:
// jp_boj・boe_policy_rate・eurostat_gdpは会合/発表間隔が既定のresidual_monitor_weeks(4週)より
// 長いため、日程データが将来まで確定していても対象週によっては必ず（誤って）WARNが出ていた。
// residual_monitor_weeksを実際の最大間隔以上に引き上げたが、将来schedule[]が更新されて
// 最大間隔がさらに伸びた場合に再びこの問題が起きうる。「設定値が実データの最大間隔を
// 常にカバーしている」ことをここで継続的に保証する
test('残量監視WARNのしきい値調整（task #49）: jp_boj/boe_policy_rate/eurostat_gdpのresidual_monitor_weeksは実scheduleの最大間隔をカバーしている', () => {
  const config = loadConfig();
  for (const id of ['jp_boj', 'boe_policy_rate', 'eurostat_gdp']) {
    const s = config.sources.find((x) => x.id === id);
    assert.ok(s, `${id} が見つからない`);
    const dates = [...new Set((s.schedule || []).map((e) => e.date))].sort();
    let maxGapDays = 0;
    for (let i = 1; i < dates.length; i++) {
      const gap = (new Date(dates[i]) - new Date(dates[i - 1])) / 86400000;
      if (gap > maxGapDays) maxGapDays = gap;
    }
    const coveredDays = s.residual_monitor_weeks * 7;
    assert.ok(
      coveredDays >= maxGapDays,
      `${id}: residual_monitor_weeks=${s.residual_monitor_weeks}週(${coveredDays}日)が実scheduleの最大間隔${maxGapDays}日をカバーしていない`
    );
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
