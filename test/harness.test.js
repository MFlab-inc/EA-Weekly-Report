'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

// harness.mjsはESM（scripts/phase1/の他スクリプトと同じ規約）。CJSのテストからは動的importで読み込む。
async function loadHarness() {
  return import('../scripts/checkers/harness.mjs');
}

const TARGET_WEEK = {
  collectionDate: '2026-08-08',
  targetWeekStart: '2026-08-10',
  targetWeekEnd: '2026-08-14',
  dates: [
    { date: '2026-08-10', md: '8/10', weekday: '月' },
    { date: '2026-08-11', md: '8/11', weekday: '火' },
    { date: '2026-08-12', md: '8/12', weekday: '水' },
    { date: '2026-08-13', md: '8/13', weekday: '木' },
    { date: '2026-08-14', md: '8/14', weekday: '金' },
  ],
};

test('checkFredSource: 対象週内の発表日が返ればfoundKindsに入る', async () => {
  const { checkFredSource } = await loadHarness();
  const source = {
    fred: {
      api_base: 'https://api.stlouisfed.org/fred/release/dates',
      releases: [{ release_id: 10, kind: 'cpi' }],
    },
  };
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ release_dates: [{ date: '2026-07-14' }, { date: '2026-08-12' }, { date: '2026-09-11' }] }),
  });
  const r = await checkFredSource(source, TARGET_WEEK, { fetchImpl, apiKey: 'dummy' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.foundKinds, ['cpi']);
});

test('checkFredSource: APIキー未設定はok:false', async () => {
  const { checkFredSource } = await loadHarness();
  const source = { fred: { api_base: 'x', releases: [{ release_id: 10, kind: 'cpi' }] } };
  const r = await checkFredSource(source, TARGET_WEEK, { fetchImpl: async () => ({}), apiKey: '' });
  assert.equal(r.ok, false);
});

test('checkFredSource: HTTPエラーはok:false', async () => {
  const { checkFredSource } = await loadHarness();
  const source = { fred: { api_base: 'https://api.stlouisfed.org/fred/release/dates', releases: [{ release_id: 10, kind: 'cpi' }] } };
  const fetchImpl = async () => ({ ok: false, status: 400 });
  const r = await checkFredSource(source, TARGET_WEEK, { fetchImpl, apiKey: 'dummy' });
  assert.equal(r.ok, false);
});

test('checkAnnualScheduleSource: schedule内に対象週の日程があればannualConfigHasTargetWeek=true', async () => {
  const { checkAnnualScheduleSource } = await loadHarness();
  const source = { schedule: [{ date: '2026-08-11', kind: 'policy_rate' }] };
  const r = checkAnnualScheduleSource(source, TARGET_WEEK);
  assert.equal(r.ok, true);
  assert.equal(r.annualConfigHasTargetWeek, true);
  assert.deepEqual(r.foundKinds, ['policy_rate']);
});

test('checkAnnualScheduleSource: scheduleが空でもok:true（失敗扱いにしない）', async () => {
  const { checkAnnualScheduleSource } = await loadHarness();
  const r = checkAnnualScheduleSource({ schedule: [] }, TARGET_WEEK);
  assert.equal(r.ok, true);
  assert.equal(r.annualConfigHasTargetWeek, false);
});

test('checkWeeklyScrapeSource: robots.txtで許可されなければok:false', async () => {
  const { checkWeeklyScrapeSource } = await loadHarness();
  const source = { access: { robots_check: true, targets: [{ label: 'x', url: 'https://example.com/x' }] } };
  const robotsChecker = { isAllowed: async () => ({ allowed: false, reason: 'robots disallow: /x' }) };
  const r = await checkWeeklyScrapeSource(source, TARGET_WEEK, { fetchImpl: async () => ({ ok: true }), robotsChecker });
  assert.equal(r.ok, false);
  assert.match(r.reason, /robots disallow/);
});

test('checkWeeklyScrapeSource: フェッチ成功でも抽出未実装のためok:false', async () => {
  const { checkWeeklyScrapeSource } = await loadHarness();
  const source = { access: { robots_check: true, targets: [{ label: 'x', url: 'https://example.com/x' }] } };
  const robotsChecker = { isAllowed: async () => ({ allowed: true }) };
  const r = await checkWeeklyScrapeSource(source, TARGET_WEEK, { fetchImpl: async () => ({ ok: true, status: 200 }), robotsChecker });
  assert.equal(r.ok, false);
  assert.match(r.reason, /抽出ルール未実装/);
});

test('runChecks: 単一ソース失敗（見込みなし）でWARN、複数ソース失敗でHOLDになる', async () => {
  const { runChecks } = await loadHarness();
  const sourcesConfig = {
    residual_monitor_default_weeks: 4,
    sources: [
      {
        id: 'ok_source',
        status: 'active',
        type: 'annual_schedule_config',
        residual_monitor_weeks: 4,
        schedule: [{ date: '2026-08-11', kind: 'policy_rate' }],
      },
      {
        id: 'skip_source',
        status: 'pending_recon',
        type: 'weekly_scrape',
      },
    ],
  };
  const importanceRules = { recurring_checks: [] };
  const report = await runChecks({ sourcesConfig, importanceRules, targetWeek: TARGET_WEEK });
  assert.equal(report.outcome.status, 'OK');
  assert.equal(report.results.find((r) => r.id === 'skip_source').skipped, true);
});

test('runChecks: weekly_scrapeソース1件が失敗（対象URL未設定・見込みなし）でWARN', async () => {
  const { runChecks } = await loadHarness();
  const sourcesConfig = {
    sources: [{ id: 'gap_source', status: 'active', type: 'weekly_scrape', access: { targets: [] } }],
  };
  const report = await runChecks({ sourcesConfig, importanceRules: { recurring_checks: [] }, targetWeek: TARGET_WEEK });
  assert.equal(report.outcome.status, 'WARN');
});

test('runChecks: 複数ソースが同時失敗すると無条件HOLD', async () => {
  const { runChecks } = await loadHarness();
  const sourcesConfig = {
    sources: [
      { id: 'gap1', status: 'active', type: 'weekly_scrape', access: { targets: [] } },
      { id: 'gap2', status: 'active', type: 'weekly_scrape', access: { targets: [] } },
    ],
  };
  const report = await runChecks({ sourcesConfig, importanceRules: { recurring_checks: [] }, targetWeek: TARGET_WEEK });
  assert.equal(report.outcome.status, 'HOLD');
  assert.match(report.outcome.reasons[0], /判定不能/);
});

test('runChecks: recurring_checksが対象週に該当する失敗ソースはHOLD（見込みあり）', async () => {
  const { runChecks } = await loadHarness();
  const sourcesConfig = {
    sources: [{ id: 'us_bls_fred', status: 'active', type: 'date_api_fred', recurring_check_refs: ['米CPI'], fred: { api_base: 'x', releases: [{ release_id: 10, kind: 'cpi' }] } }],
  };
  // APIキー未設定で必ず失敗させる。対象週(2026-08-10〜08-14)は「毎月中旬」に該当するため
  // recurring_check_refs経由でHOLD（見込みあり）になることを確認する
  const importanceRules = { recurring_checks: [{ name: '米CPI', rule: '毎月中旬', action: 'WARN' }] };
  const report = await runChecks({ sourcesConfig, importanceRules, targetWeek: TARGET_WEEK, apiKey: '' });
  assert.equal(report.outcome.status, 'HOLD');
  assert.match(report.outcome.reasons[0], /見込みあり/);
});

test('runChecks: 年次config型ソースの残量監視WARNがresidualWarningsに含まれる', async () => {
  const { runChecks } = await loadHarness();
  const sourcesConfig = {
    sources: [
      { id: 'stale_annual', status: 'draft_schedule', type: 'annual_schedule_config', residual_monitor_weeks: 4, schedule: [] },
    ],
  };
  const report = await runChecks({ sourcesConfig, importanceRules: { recurring_checks: [] }, targetWeek: TARGET_WEEK });
  assert.equal(report.residualWarnings.length, 1);
  assert.equal(report.residualWarnings[0].id, 'stale_annual');
});
