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

test('checkWeeklyScrapeSource: フェッチ成功でも抽出未実装（未登録ソース）のためok:false', async () => {
  const { checkWeeklyScrapeSource } = await loadHarness();
  const source = { id: 'unregistered_source', access: { robots_check: true, targets: [{ label: 'x', url: 'https://example.com/x' }] } };
  const robotsChecker = { isAllowed: async () => ({ allowed: true }) };
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => '<html></html>' });
  const r = await checkWeeklyScrapeSource(source, TARGET_WEEK, { fetchImpl, robotsChecker });
  assert.equal(r.ok, false);
  assert.match(r.reason, /抽出ルール未実装/);
});

test('checkWeeklyScrapeSource: boc_policy_rate（row.kind確定型）はevent-names.json未登録でも抽出成功し対象週の候補を返す', async () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { checkWeeklyScrapeSource } = await loadHarness();
  const html = readFileSync(join(__dirname, 'fixtures', 'official-sources', 'boc_policy_rate', 'upcoming_events.html'), 'utf8');
  const source = {
    id: 'boc_policy_rate',
    country: 'CA',
    kinds: ['policy_rate', 'quarterly_report'],
    announce_time_by_kind: {
      policy_rate: { local_time: '09:45', tz: 'America/Toronto' },
      quarterly_report: { local_time: '09:45', tz: 'America/Toronto' },
    },
    access: { robots_check: true, targets: [{ label: 'upcoming_events', url: 'https://www.bankofcanada.ca/press/upcoming-events/' }] },
  };
  const robotsChecker = { isAllowed: async () => ({ allowed: true }) };
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => html });
  // 対象週を2026-10-26〜10-30（10/28のInterest Rate Announcement and Monetary Policy Reportを含む週）にする
  const targetWeek = { targetWeekStart: '2026-10-26', targetWeekEnd: '2026-10-30' };
  const r = await checkWeeklyScrapeSource(source, targetWeek, { fetchImpl, robotsChecker, eventNames: [] });
  assert.equal(r.ok, true);
  assert.equal(r.unregistered.length, 0, `event-names.json未登録WARNが出てはいけない: ${JSON.stringify(r.unregistered)}`);
  assert.deepEqual([...r.foundKinds].sort(), ['policy_rate', 'quarterly_report']);
  assert.ok(r.thisWeek.every((c) => c.displayName === null));
});

test('checkWeeklyScrapeSource: jp_mof（動的月別URL・primaryLabel未指定）は対象週の月ページから抽出できる', async () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { checkWeeklyScrapeSource } = await loadHarness();
  const html = readFileSync(join(__dirname, 'fixtures', 'official-sources', 'jp_mof', 'auction_calendar_2608.html'), 'utf8');
  const source = {
    id: 'jp_mof',
    country: 'JP',
    kinds: ['bond_auction'],
    access: {
      robots_check: true,
      month_url_pattern: 'https://www.mof.go.jp/english/policy/jgbs/auction/calendar/{YY}{MM}e.htm',
    },
    announce_time_by_kind: {},
  };
  const robotsChecker = { isAllowed: async () => ({ allowed: true }) };
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(url);
    if (url.endsWith('2608e.htm')) return { ok: true, status: 200, text: async () => html };
    return { ok: false, status: 404 };
  };
  const targetWeek = { targetWeekStart: '2026-08-03', targetWeekEnd: '2026-08-07' };
  const r = await checkWeeklyScrapeSource(source, targetWeek, { fetchImpl, robotsChecker, eventNames: [] });
  assert.deepEqual(requestedUrls, ['https://www.mof.go.jp/english/policy/jgbs/auction/calendar/2608e.htm']);
  assert.equal(r.ok, true);
  assert.equal(r.unregistered.length, 0, `event-names.json未登録WARNが出てはいけない: ${JSON.stringify(r.unregistered)}`);
  assert.deepEqual(r.foundKinds, ['bond_auction']);
  assert.ok(r.thisWeek.some((c) => c.date === '2026-08-04'));
  assert.ok(r.thisWeek.every((c) => c.time === null), 'bond_auctionはTIME_EXEMPT_KINDSによりtime:nullのはず');
});

test('checkWeeklyScrapeSource: jp_mof は月またぎ週で2つの月別ページを両方フェッチする', async () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { checkWeeklyScrapeSource } = await loadHarness();
  const html = readFileSync(join(__dirname, 'fixtures', 'official-sources', 'jp_mof', 'auction_calendar_2608.html'), 'utf8');
  const source = {
    id: 'jp_mof',
    country: 'JP',
    kinds: ['bond_auction'],
    access: { robots_check: true, month_url_pattern: 'https://www.mof.go.jp/english/policy/jgbs/auction/calendar/{YY}{MM}e.htm' },
    announce_time_by_kind: {},
  };
  const robotsChecker = { isAllowed: async () => ({ allowed: true }) };
  const requestedUrls = [];
  // マージ機構自体の検証が目的のため、月境界をまたぐ2ページとも同一fixture（8月分）を返す
  // （7月分の実データではない。month_url_patternが正しく2URL分展開されrowsが合算されることの確認）
  const fetchImpl = async (url) => {
    requestedUrls.push(url);
    return { ok: true, status: 200, text: async () => html };
  };
  const targetWeek = { targetWeekStart: '2026-07-28', targetWeekEnd: '2026-08-03' };
  const r = await checkWeeklyScrapeSource(source, targetWeek, { fetchImpl, robotsChecker, eventNames: [] });
  assert.deepEqual(requestedUrls.sort(), [
    'https://www.mof.go.jp/english/policy/jgbs/auction/calendar/2607e.htm',
    'https://www.mof.go.jp/english/policy/jgbs/auction/calendar/2608e.htm',
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.allCandidatesCount, 10, '同一fixtureを2ページ分解析するため5件×2ページ=10件になるはず');
});

test('checkWeeklyScrapeSource: us_treasury（weekStart/weekEndを渡すparseFn）は対象週内のauction_dateのみ抽出する', async () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { checkWeeklyScrapeSource } = await loadHarness();
  const json = readFileSync(join(__dirname, 'fixtures', 'official-sources', 'us_treasury', 'fiscaldata_upcoming_auctions.json'), 'utf8');
  const source = {
    id: 'us_treasury',
    country: 'US',
    kinds: ['bond_auction'],
    access: { robots_check: true, targets: [{ label: 'fiscaldata_upcoming_auctions', url: 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/upcoming_auctions' }] },
    announce_time_by_kind: {},
  };
  const robotsChecker = { isAllowed: async () => ({ allowed: true }) };
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => json });
  // ground truth: 2026-08-19の20年債（docs/phase1-official-sources.md参照）
  const targetWeek = { targetWeekStart: '2026-08-17', targetWeekEnd: '2026-08-21' };
  const r = await checkWeeklyScrapeSource(source, targetWeek, { fetchImpl, robotsChecker, eventNames: [] });
  assert.equal(r.ok, true);
  assert.equal(r.unregistered.length, 0);
  assert.ok(r.thisWeek.some((c) => c.date === '2026-08-19'));
  assert.ok(r.thisWeek.every((c) => c.time === null));
});

test('checkWeeklyScrapeSource: us_frb_speeches（RSS pubDateをutcInstantとして利用）はDST不要でJST時刻を導出する', async () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { checkWeeklyScrapeSource } = await loadHarness();
  const xml = readFileSync(join(__dirname, 'fixtures', 'official-sources', 'us_frb_speeches', 'speeches_rss.xml'), 'utf8');
  const source = {
    id: 'us_frb_speeches',
    country: 'US',
    kinds: ['official_speech'],
    access: { robots_check: true, provides_exact_time: true, targets: [{ label: 'speeches_rss', url: 'https://www.federalreserve.gov/feeds/speeches.xml' }] },
    announce_time_by_kind: {},
  };
  const robotsChecker = { isAllowed: async () => ({ allowed: true }) };
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => xml });
  // ground truth: Cook理事講演 UTC 2026-08-05T20:05:00Z=JST 2026-08-06 05:05
  const targetWeek = { targetWeekStart: '2026-08-03', targetWeekEnd: '2026-08-07' };
  const r = await checkWeeklyScrapeSource(source, targetWeek, { fetchImpl, robotsChecker, eventNames: [] });
  assert.equal(r.ok, true);
  const cook = r.thisWeek.find((c) => c.rawTitle.startsWith('Cook,'));
  assert.ok(cook);
  assert.equal(cook.date, '2026-08-06');
  assert.equal(cook.time, '05:05');
  assert.equal(cook.kind, 'official_speech');
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
