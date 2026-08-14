'use strict';
// 既刊2週（2026-08-03週・2026-08-10週、reference/sample-report_20260808.html）の
// ground truthに対する捕捉テスト（しょうさん指示・2026-08-14条件1）。
// 判定基準: 発表日時（JST換算後の時刻まで）・重要度が一致することを必須とする。
// 日本語正規名はevent-names.json経由（Census/ABS/FRED/ISM）は完全一致まで検証する。
// RBA/BOJは中銀命名テンプレート（SPEC §4.2、officials.json解決・期間サフィックス付与）が
// レンダラー実装（task #12）側の責務のため、本テストでは日時・重要度・kind分類の一致までを
// 検証範囲とする（名称アサーションはスコープ外である旨をコメントで明示）。
// 実アクセスは行わず、test/fixtures/official-sources/の実測fixtureをfetchモックで読み込む
// （しょうさん指示・条件3: オフライン反復可能に）。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const FIXTURE_ROOT = join(__dirname, 'fixtures', 'official-sources');
const readFixture = (...p) => readFileSync(join(FIXTURE_ROOT, ...p), 'utf8');

const sourcesConfig = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'official-sources.json'), 'utf8'));
const eventNames = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'event-names.json'), 'utf8')).entries;
const importanceRules = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'importance-rules.json'), 'utf8'));
const groundTruth = JSON.parse(readFileSync(join(__dirname, '..', 'scripts', 'phase0', 'expected-events.json'), 'utf8')).events;

const WEEK_20260803 = { targetWeekStart: '2026-08-03', targetWeekEnd: '2026-08-07', dates: ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'].map((date) => ({ date })) };
const WEEK_20260810 = { targetWeekStart: '2026-08-10', targetWeekEnd: '2026-08-14', dates: ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14'].map((date) => ({ date })) };

const ALLOW_ROBOTS = { isAllowed: async () => ({ allowed: true }) };

// Census/ABS向け: URLパターンでfixtureを返す簡易fetchモック
function fixtureFetch(map) {
  return async (url) => {
    const hit = Object.entries(map).find(([pattern]) => url.includes(pattern));
    if (!hit) return { ok: false, status: 404 };
    const [, body] = hit;
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
  };
}

function gt(id) {
  const e = groundTruth.find((x) => x.id === id);
  if (!e) throw new Error(`ground truth event not found: ${id}`);
  return e;
}

test('Census(us_census): 貿易収支(8/4)・小売売上高(8/14)が既刊と日時・重要度・名称とも完全一致', async () => {
  const { checkWeeklyScrapeSource } = await import('../scripts/checkers/harness.mjs');
  const censusHtml = readFixture('us_census', 'calendar_listview.html');
  const fetchImpl = fixtureFetch({ 'calendar-listview.html': censusHtml });
  const source = sourcesConfig.sources.find((s) => s.id === 'us_census');

  const r0804 = await checkWeeklyScrapeSource(source, WEEK_20260803, { fetchImpl, robotsChecker: ALLOW_ROBOTS, eventNames, importanceRules });
  const r0814 = await checkWeeklyScrapeSource(source, WEEK_20260810, { fetchImpl, robotsChecker: ALLOW_ROBOTS, eventNames, importanceRules });
  assert.equal(r0804.ok, true);
  assert.equal(r0814.ok, true);

  const trade = r0804.thisWeek.find((c) => c.kind === 'trade_balance');
  const gtTrade = gt('us_trade_20260804');
  assert.equal(trade.date, gtTrade.date);
  assert.equal(trade.time, gtTrade.time);
  assert.equal(trade.displayName, '貿易収支');
  assert.equal(trade.importance, gtTrade.stars);

  const retail = r0814.thisWeek.find((c) => c.kind === 'retail_sales');
  const gtRetail = gt('us-retail-sales-2026-08-14');
  assert.equal(retail.date, gtRetail.date);
  assert.equal(retail.time, gtRetail.time);
  assert.equal(retail.importance, gtRetail.stars);
});

test('ABS(au_abs): 貿易収支(8/6)が既刊と日時・重要度・名称とも完全一致', async () => {
  const { checkWeeklyScrapeSource } = await import('../scripts/checkers/harness.mjs');
  const absHtml = readFixture('au_abs', 'future_releases_calendar.html');
  const fetchImpl = fixtureFetch({ 'future-releases-calendar': absHtml });
  const source = sourcesConfig.sources.find((s) => s.id === 'au_abs');

  const r = await checkWeeklyScrapeSource(source, WEEK_20260803, { fetchImpl, robotsChecker: ALLOW_ROBOTS, eventNames, importanceRules });
  assert.equal(r.ok, true);
  const trade = r.thisWeek.find((c) => c.kind === 'trade_balance');
  const gtTrade = gt('au_trade_20260806');
  assert.ok(trade, 'AU trade_balanceが見つからない');
  assert.equal(trade.date, gtTrade.date);
  assert.equal(trade.time, gtTrade.time); // AU country_overridesにより★★★
  assert.equal(trade.importance, gtTrade.stars);
  assert.equal(trade.displayName, '貿易収支');
});

test('FRED(us_bls_fred): CPI/PPI/雇用統計/JOLTSの4件が既刊と日時・重要度・名称とも完全一致', async () => {
  const { checkFredSource } = await import('../scripts/checkers/harness.mjs');
  const source = sourcesConfig.sources.find((s) => s.id === 'us_bls_fred');
  const fixtures = {
    10: readFixture('us_bls_fred', 'release_10_cpi.json'),
    46: readFixture('us_bls_fred', 'release_46_ppi.json'),
    50: readFixture('us_bls_fred', 'release_50_employment_situation.json'),
    192: readFixture('us_bls_fred', 'release_192_jolts.json'),
  };
  const fetchImpl = async (url) => {
    const idM = /release_id=(\d+)/.exec(url);
    const body = fixtures[idM[1]];
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  };

  const r0804 = await checkFredSource(source, WEEK_20260803, { fetchImpl, apiKey: 'dummy', eventNames, importanceRules });
  const r0810 = await checkFredSource(source, WEEK_20260810, { fetchImpl, apiKey: 'dummy', eventNames, importanceRules });
  assert.equal(r0804.ok, true);
  assert.equal(r0810.ok, true);

  // CPI: 消費者物価指数（CPI）＋【コア】の2枚看板がともに8/12・21:30で束ねられる
  const gtCpi = gt('us-cpi-2026-08-12');
  const gtCoreCpi = gt('us-core-cpi-2026-08-12');
  const cpiCandidates = r0810.thisWeek.filter((c) => c.kind === 'cpi');
  assert.equal(cpiCandidates.length, 2);
  for (const c of cpiCandidates) {
    assert.equal(c.date, gtCpi.date);
    assert.equal(c.time, gtCpi.time);
    assert.equal(c.importance, gtCpi.stars);
  }
  assert.ok(cpiCandidates.some((c) => c.displayName === '消費者物価指数（CPI）'));
  assert.ok(cpiCandidates.some((c) => c.displayName === '消費者物価指数【コア】'));

  // PPI: 同様に2枚看板・8/13・21:30
  const gtPpi = gt('us-ppi-2026-08-13');
  const ppiCandidates = r0810.thisWeek.filter((c) => c.kind === 'ppi');
  assert.equal(ppiCandidates.length, 2);
  for (const c of ppiCandidates) {
    assert.equal(c.date, gtPpi.date);
    assert.equal(c.time, gtPpi.time);
    assert.equal(c.importance, gtPpi.stars);
  }

  // 雇用統計: 8/7・21:30（8/3週）
  const gtNfp = gt('us_employment_situation_20260807');
  const nfpCandidates = r0804.thisWeek.filter((c) => c.kind === 'employment_situation');
  assert.equal(nfpCandidates.length, 1);
  assert.equal(nfpCandidates[0].date, gtNfp.date);
  assert.equal(nfpCandidates[0].time, gtNfp.time);
  assert.equal(nfpCandidates[0].importance, gtNfp.stars);

  // JOLTS: 8/4・23:00（8/3週）
  const gtJolts = gt('us_jolts_20260804');
  const joltsCandidates = r0804.thisWeek.filter((c) => c.kind === 'employment_indicator');
  assert.equal(joltsCandidates.length, 1);
  assert.equal(joltsCandidates[0].date, gtJolts.date);
  assert.equal(joltsCandidates[0].time, gtJolts.time);
});

test('ISM(us_ism, annual_schedule_config): 製造業(8/3)・非製造業(8/5)が既刊と日時・重要度とも完全一致', async () => {
  const { checkAnnualScheduleSource } = await import('../scripts/checkers/harness.mjs');
  const { resolveCandidateEvent } = require('../scripts/lib/resolve-candidate');
  const source = sourcesConfig.sources.find((s) => s.id === 'us_ism');

  const r = await checkAnnualScheduleSource(source, WEEK_20260803);
  assert.equal(r.ok, true);
  assert.equal(r.matchedEntries.length, 2);

  const mfgEntry = r.matchedEntries.find((e) => e.subtype === 'manufacturing');
  const svcEntry = r.matchedEntries.find((e) => e.subtype === 'services');
  const tz = source.announce_time_by_kind.pmi_ism.tz;
  const localTime = source.announce_time_by_kind.pmi_ism.local_time;

  const mfgCandidate = resolveCandidateEvent(
    { title: 'ISM Manufacturing PMI', date: mfgEntry.date, localTime },
    { country: 'US', kind: 'pmi_ism', tz, eventNames, importanceRules }
  );
  const svcCandidate = resolveCandidateEvent(
    { title: 'ISM Services PMI', date: svcEntry.date, localTime },
    { country: 'US', kind: 'pmi_ism', tz, eventNames, importanceRules }
  );

  const gtMfg = gt('us_ism_mfg_20260803');
  const gtSvc = gt('us_ism_services_20260805');
  assert.equal(mfgCandidate.ok, true);
  assert.equal(mfgCandidate.date, gtMfg.date);
  assert.equal(mfgCandidate.time, gtMfg.time);
  assert.equal(mfgCandidate.importance, gtMfg.stars);
  assert.equal(mfgCandidate.displayName, 'ISM製造業景況指数');

  assert.equal(svcCandidate.ok, true);
  assert.equal(svcCandidate.date, gtSvc.date);
  assert.equal(svcCandidate.time, gtSvc.time);
  assert.equal(svcCandidate.importance, gtSvc.stars);
  assert.equal(svcCandidate.displayName, 'ISM非製造業景況指数');
});

test('RBA(au_rba, annual_schedule_config): 政策金利・記者会見・四半期報告(8/11)が既刊と日時・重要度・kind分類とも一致（名称テンプレート組立はtask #12スコープ）', async () => {
  const { checkAnnualScheduleSource } = await import('../scripts/checkers/harness.mjs');
  const { resolveImportance } = require('../scripts/lib/importance');
  const { zonedWallTimeToJst } = require('../scripts/lib/tz-convert');
  const source = sourcesConfig.sources.find((s) => s.id === 'au_rba');

  const r = await checkAnnualScheduleSource(source, WEEK_20260810);
  assert.equal(r.ok, true);
  assert.deepEqual(new Set(r.foundKinds), new Set(['policy_rate', 'press_conference', 'quarterly_report']));

  const checks = [
    { kind: 'policy_rate', gtId: 'au-rba-rate-2026-08-11' },
    { kind: 'press_conference', gtId: 'au-rba-press-2026-08-11' },
    { kind: 'quarterly_report', gtId: 'au-rba-smp-2026-08-11' },
  ];
  for (const { kind, gtId } of checks) {
    const entry = r.matchedEntries.find((e) => e.kind === kind);
    const timeCfg = source.announce_time_by_kind[kind];
    const [y, mo, d] = entry.date.split('-').map(Number);
    const [h, mi] = timeCfg.local_time.split(':').map(Number);
    const jst = zonedWallTimeToJst(y, mo, d, h, mi, timeCfg.tz);
    const g = gt(gtId);
    assert.equal(jst.date, g.date, `${kind}: 日付不一致`);
    assert.equal(jst.time, g.time, `${kind}: 時刻不一致`);
    assert.equal(resolveImportance(kind, 'AU', importanceRules), g.stars, `${kind}: 重要度不一致`);
  }
});

test('BOJ(jp_boj, annual_schedule_config): 主な意見(8/10)・議事要旨(8/5)が既刊と日時・重要度・kind分類とも一致（名称テンプレート組立はtask #12スコープ）', async () => {
  const { checkAnnualScheduleSource } = await import('../scripts/checkers/harness.mjs');
  const { resolveImportance } = require('../scripts/lib/importance');
  const source = sourcesConfig.sources.find((s) => s.id === 'jp_boj');

  const r0803 = await checkAnnualScheduleSource(source, WEEK_20260803);
  const r0810 = await checkAnnualScheduleSource(source, WEEK_20260810);

  const minutesEntry = r0803.matchedEntries.find((e) => e.kind === 'minutes_summary');
  const gtMinutes = gt('jp_boj_minutes_20260805');
  assert.ok(minutesEntry, '議事要旨(8/5)が見つからない');
  assert.equal(minutesEntry.date, gtMinutes.date);
  assert.equal(source.announce_time_by_kind.minutes_summary.local_time, gtMinutes.time); // BOJはJST直接（tz変換不要）
  assert.equal(resolveImportance('minutes_summary', 'JP', importanceRules), gtMinutes.stars);

  const opinionsEntry = r0810.matchedEntries.find((e) => e.kind === 'opinions_summary');
  const gtOpinions = gt('jp-boj-summary-2026-08-10');
  assert.ok(opinionsEntry, '主な意見(8/10)が見つからない');
  assert.equal(opinionsEntry.date, gtOpinions.date);
  assert.equal(source.announce_time_by_kind.opinions_summary.local_time, gtOpinions.time);
  assert.equal(resolveImportance('opinions_summary', 'JP', importanceRules), gtOpinions.stars);
});

test('nz_statsnz・ca_statcanは抽出ルール未登録のため既刊週でも明示的にok:falseを返す（構造的ブロッカーの記録。fixtureはSPA描画/検索フォームで日程を含まないため意図的に空スタブを使う）', async () => {
  const { checkWeeklyScrapeSource } = await import('../scripts/checkers/harness.mjs');
  const nzSource = sourcesConfig.sources.find((s) => s.id === 'nz_statsnz');
  const caSource = sourcesConfig.sources.find((s) => s.id === 'ca_statcan');
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => '<html>stub</html>' });

  const rNz = await checkWeeklyScrapeSource(nzSource, WEEK_20260803, { fetchImpl, robotsChecker: ALLOW_ROBOTS, eventNames, importanceRules });
  const rCa = await checkWeeklyScrapeSource(caSource, WEEK_20260803, { fetchImpl, robotsChecker: ALLOW_ROBOTS, eventNames, importanceRules });
  assert.equal(rNz.ok, false);
  assert.match(rNz.reason, /抽出ルール未実装/);
  assert.equal(rCa.ok, false);
  assert.match(rCa.reason, /抽出ルール未実装/);
});
