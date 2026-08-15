'use strict';
// しょうさん指示2026-08-14条件2: 抽出結果がゼロ件／想定パターンに一致しない場合の振る舞いを、
// 承認済みのフェールクローズ規則（SPEC §3.4）に確実に接続することの確認。
// 実装済み抽出ルール（Census/ABS/ONS）を対象に、サイト構造が変わって抽出できなくなった状況を
// 模したダミーHTML/JSONを与え、(1) checkWeeklyScrapeSourceがok:falseを返すこと、
// (2) runChecks()の最終判定（decideRunOutcome）がSPEC §3.4どおりにHOLD/WARNへ正しく接続することを確認する。
const { test } = require('node:test');
const assert = require('node:assert/strict');

const TARGET_WEEK = {
  targetWeekStart: '2026-08-10',
  targetWeekEnd: '2026-08-14',
  dates: [
    { date: '2026-08-10' }, { date: '2026-08-11' }, { date: '2026-08-12' }, { date: '2026-08-13' }, { date: '2026-08-14' },
  ],
};
const ALLOW_ROBOTS = { isAllowed: async () => ({ allowed: true }) };

test('checkWeeklyScrapeSource(us_census): サイト構造変化で行が抽出できない場合はok:falseかつ構造変化と明示する', async () => {
  const { checkWeeklyScrapeSource } = await import('../scripts/checkers/harness.mjs');
  const source = {
    id: 'us_census',
    country: 'US',
    kinds: ['retail_sales', 'trade_balance'],
    access: { robots_check: true, targets: [{ label: 'calendar_listview', url: 'https://www.census.gov/economic-indicators/calendar-listview.html' }] },
    announce_time_by_kind: { retail_sales: { local_time: '08:30', tz: 'America/New_York' } },
  };
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => '<html><body>リニューアルされたページ（テーブル構造なし）</body></html>' });
  const r = await checkWeeklyScrapeSource(source, TARGET_WEEK, { fetchImpl, robotsChecker: ALLOW_ROBOTS, eventNames: [], importanceRules: {} });
  assert.equal(r.ok, false);
  assert.match(r.reason, /構造変化/);
});

test('checkWeeklyScrapeSource(au_abs): event-name要素が消えた場合もok:falseで構造変化を明示する', async () => {
  const { checkWeeklyScrapeSource } = await import('../scripts/checkers/harness.mjs');
  const source = {
    id: 'au_abs',
    country: 'AU',
    kinds: ['trade_balance'],
    access: { robots_check: true, targets: [{ label: 'future_releases_calendar', url: 'https://www.abs.gov.au/release-calendar/future-releases-calendar' }] },
    announce_time_by_kind: { trade_balance: { local_time: '11:30', tz: 'Australia/Sydney' } },
  };
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => '<html><body>no calendar markup</body></html>' });
  const r = await checkWeeklyScrapeSource(source, TARGET_WEEK, { fetchImpl, robotsChecker: ALLOW_ROBOTS, eventNames: [], importanceRules: {} });
  assert.equal(r.ok, false);
  assert.match(r.reason, /構造変化/);
});

test('checkWeeklyScrapeSource(gb_ons): releases配列が消えたJSON応答もok:falseで構造変化を明示する', async () => {
  const { checkWeeklyScrapeSource } = await import('../scripts/checkers/harness.mjs');
  const source = {
    id: 'gb_ons',
    country: 'GB',
    kinds: ['gdp'],
    access: { robots_check: true, targets: [{ label: 'releases_api_upcoming_gdp', url: 'https://api.beta.ons.gov.uk/v1/search/releases?release-type=type-upcoming&query=GDP' }] },
    announce_time_by_kind: { gdp: { local_time: '07:00', tz: 'Europe/London' } },
  };
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ error: 'schema changed' }) });
  const r = await checkWeeklyScrapeSource(source, TARGET_WEEK, { fetchImpl, robotsChecker: ALLOW_ROBOTS, eventNames: [], importanceRules: {} });
  assert.equal(r.ok, false);
  assert.match(r.reason, /構造変化/);
});

test('runChecks: 実装済み抽出ルールを持つソース1件のみが構造変化で失敗した場合、見込みシグナルが無ければWARNに正しく接続する', async () => {
  const { runChecks } = await loadHarness();
  const sourcesConfig = {
    sources: [
      {
        id: 'au_abs', status: 'active', type: 'weekly_scrape', country: 'AU', kinds: ['trade_balance'],
        access: { robots_check: true, targets: [{ label: 'future_releases_calendar', url: 'https://www.abs.gov.au/release-calendar/future-releases-calendar' }] },
        announce_time_by_kind: { trade_balance: { local_time: '11:30', tz: 'Australia/Sydney' } },
        recurring_check_refs: [],
      },
    ],
  };
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => '<html><body>broken</body></html>' });
  const report = await runChecks({ sourcesConfig, importanceRules: { recurring_checks: [] }, eventNames: [], targetWeek: TARGET_WEEK, fetchImpl, robotsChecker: ALLOW_ROBOTS });
  assert.equal(report.results[0].ok, false);
  assert.equal(report.outcome.status, 'WARN');
});

async function loadHarness() {
  return import('../scripts/checkers/harness.mjs');
}
