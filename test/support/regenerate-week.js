'use strict';
// 既刊2週（2026-08-03週・2026-08-10週）を「収集→台帳」の実データ経路で再生成する共有ヘルパー
// （test/regen-sample-weeks.test.js・test/render.test.jsが共用。2026-08-15新設）。
// 実アクセスは行わず、test/fixtures/official-sources/の実測fixtureをfetchモックで読み込む。
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const FIXTURE_ROOT = join(__dirname, '..', 'fixtures', 'official-sources');
const readFixture = (...p) => readFileSync(join(FIXTURE_ROOT, ...p), 'utf8');

const CONFIG_ROOT = join(__dirname, '..', '..', 'config');
const readConfig = (name) => JSON.parse(readFileSync(join(CONFIG_ROOT, name), 'utf8'));

const sourcesConfig = readConfig('official-sources.json');
const eventNames = readConfig('event-names.json').entries;
const importanceRules = readConfig('importance-rules.json');
const manualEventsConfig = readConfig('manual-events.json');
const officialsConfig = readConfig('officials.json');
const expectedCoverageConfig = readConfig('expected-coverage.json');

const ALLOW_ROBOTS = { isAllowed: async () => ({ allowed: true }) };

const FRED_FIXTURES = {
  10: readFixture('us_bls_fred', 'release_10_cpi.json'),
  46: readFixture('us_bls_fred', 'release_46_ppi.json'),
  50: readFixture('us_bls_fred', 'release_50_employment_situation.json'),
  192: readFixture('us_bls_fred', 'release_192_jolts.json'),
};

// 全対象ソースを1つのfetchImplで賄うマスターモック。annual_schedule_config型（au_rba・jp_boj・us_ism・
// ca_ivey・ca_statcan等）はfetchを行わないため対象外。nz_statsnzは本番targetsが「直近四半期ページ」
// （次サイクルを予告）を指すためground truthの捕捉には前四半期ページのfixtureへ差し替える
// （test/ground-truth-capture.test.jsと同じ既知の対応）
async function masterFetchImpl(url) {
  if (/release_id=(\d+)/.test(url)) {
    const id = /release_id=(\d+)/.exec(url)[1];
    return { ok: true, status: 200, json: async () => JSON.parse(FRED_FIXTURES[id]) };
  }
  if (url.includes('calendar-listview.html')) {
    return { ok: true, status: 200, text: async () => readFixture('us_census', 'calendar_listview.html') };
  }
  if (url.includes('future-releases-calendar')) {
    return { ok: true, status: 200, text: async () => readFixture('au_abs', 'future_releases_calendar.html') };
  }
  if (url.includes('2608e.htm')) {
    return { ok: true, status: 200, text: async () => readFixture('jp_mof', 'auction_calendar_2608.html') };
  }
  if (url.includes('feeds/speeches.xml')) {
    return { ok: true, status: 200, text: async () => readFixture('us_frb_speeches', 'speeches_rss.xml') };
  }
  if (url.includes('labour-market-statistics')) {
    return { ok: true, status: 200, text: async () => readFixture('nz_statsnz', 'TEMP_ground_truth_validation_prior_quarter.html') };
  }
  if (url.includes('search/releases')) {
    return { ok: true, status: 200, text: async () => readFixture('gb_ons', 'releases_api_upcoming_gdp.json') };
  }
  return { ok: false, status: 404 };
}

function targetWeekOf(startStr, endStr, dateStrs) {
  return { collectionDate: dateStrs[0], targetWeekStart: startStr, targetWeekEnd: endStr, dates: dateStrs.map((date) => ({ date })) };
}

const WEEK_20260803 = targetWeekOf('2026-08-03', '2026-08-07', ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07']);
const WEEK_20260810 = targetWeekOf('2026-08-10', '2026-08-14', ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']);

async function regenerateWeek(targetWeek) {
  const { collect } = await import('../../scripts/collect.mjs');
  const { buildLedgerFromCollectResult } = await import('../../scripts/build-ledger.mjs');
  const { validateLedger } = require('../../scripts/lib/validate-ledger');

  const collectResult = await collect({
    sourcesConfig, importanceRules, eventNames, manualEventsConfig, targetWeek,
    fetchImpl: masterFetchImpl, apiKey: 'dummy', robotsChecker: ALLOW_ROBOTS,
  });
  const ledger = buildLedgerFromCollectResult({
    collectResult, sourcesConfig, manualEventsConfig, officialsConfig, importanceRules,
    expectedCoverageConfig, generatedAt: '2026-08-15T08:06:00+09:00',
  });
  const check = validateLedger(ledger);
  assert.deepEqual(check.errors, [], `台帳スキーマ検証エラー（${targetWeek.targetWeekStart}週）`);
  assert.equal(check.ok, true);
  return ledger;
}

module.exports = {
  regenerateWeek,
  WEEK_20260803,
  WEEK_20260810,
  sourcesConfig,
  eventNames,
  importanceRules,
  manualEventsConfig,
  officialsConfig,
  expectedCoverageConfig,
};
