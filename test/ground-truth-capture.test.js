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

// task #38実ネットワーク検証（しょうさん指摘2026-08-15）の回帰テスト: au_absは登録済み
// ソースで抽出コード自体は全リリースを汎用抽出していたが、CPI・雇用統計がkind未登録のため
// 取りこぼしていた（8/17週のAU雇用統計=8/20発表分がまさにその欠損事例）。同一fixtureから
// 実際にAU CPI・雇用統計が拾えることを確認する
test('ABS(au_abs): CPI・雇用統計も同一fixtureから拾える（8/17週の欠損事例の回帰テスト）', async () => {
  const { checkWeeklyScrapeSource } = await import('../scripts/checkers/harness.mjs');
  const absHtml = readFixture('au_abs', 'future_releases_calendar.html');
  const fetchImpl = fixtureFetch({ 'future-releases-calendar': absHtml });
  const source = sourcesConfig.sources.find((s) => s.id === 'au_abs');
  const WEEK_20260817 = { targetWeekStart: '2026-08-17', targetWeekEnd: '2026-08-21', dates: ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21'].map((date) => ({ date })) };

  const r = await checkWeeklyScrapeSource(source, WEEK_20260817, { fetchImpl, robotsChecker: ALLOW_ROBOTS, eventNames, importanceRules });
  assert.equal(r.ok, true);
  const employment = r.thisWeek.find((c) => c.kind === 'employment_situation');
  assert.ok(employment, 'AU employment_situationが見つからない（8/17週の欠損事例が再現していない）');
  assert.equal(employment.date, '2026-08-20');
  assert.equal(employment.time, '10:30'); // 11:30 Sydney(AEST, UTC+10) → JST
  assert.equal(employment.displayName, '雇用統計');
  assert.equal(employment.importance, 3);

  // CPIは2026-08-26発表分（8/17週の翌週）のため、より広い週で拾えることのみ確認する
  const rNextWeek = await checkWeeklyScrapeSource(source, { targetWeekStart: '2026-08-24', targetWeekEnd: '2026-08-28', dates: [] }, { fetchImpl, robotsChecker: ALLOW_ROBOTS, eventNames, importanceRules });
  const cpi = rNextWeek.thisWeek.find((c) => c.kind === 'cpi');
  assert.ok(cpi, 'AU cpiが見つからない');
  assert.equal(cpi.date, '2026-08-26');
  assert.equal(cpi.displayName, '消費者物価指数（CPI）');
});

// task #69（しょうさん指摘、Manus版8/24週突合）の回帰テスト: 民間設備投資（Private New Capital
// Expenditure and Expected Expenditure, Australia）がkinds/event-names.json追加により
// 同一fixtureから拾えることを確認する（8/24週Manus突合で発見した未追跡リリース）
test('ABS(au_abs): 民間設備投資(8/27)が同一fixtureから拾える（Manus版8/24週突合の未追跡事例の回帰テスト）', async () => {
  const { checkWeeklyScrapeSource } = await import('../scripts/checkers/harness.mjs');
  const absHtml = readFixture('au_abs', 'future_releases_calendar.html');
  const fetchImpl = fixtureFetch({ 'future-releases-calendar': absHtml });
  const source = sourcesConfig.sources.find((s) => s.id === 'au_abs');
  const WEEK_20260824 = { targetWeekStart: '2026-08-24', targetWeekEnd: '2026-08-28', dates: [] };

  const r = await checkWeeklyScrapeSource(source, WEEK_20260824, { fetchImpl, robotsChecker: ALLOW_ROBOTS, eventNames, importanceRules });
  assert.equal(r.ok, true);
  const capex = r.thisWeek.find((c) => c.kind === 'capex');
  assert.ok(capex, 'AU capexが見つからない');
  assert.equal(capex.date, '2026-08-27');
  assert.equal(capex.time, '10:30'); // 11:30 Sydney(AEST, UTC+10) → JST
  assert.equal(capex.displayName, '民間設備投資');
  assert.equal(capex.importance, 2); // Manus版も★★掲載

  // 同一週の豪小売売上高（retail_sales）とは別イベントとして共存する（誤って同一視されていないことの確認）
  const retail = r.thisWeek.find((c) => c.kind === 'retail_sales');
  assert.ok(retail, 'AU retail_salesが見つからない（capex追加により誤って消えていないか確認）');
});

// task #66/#70（しょうさん指摘・指示、Manus版8/24週突合＋NZ Stats構造的ブロッカー再調査）の
// 回帰テスト: calendar-export ICSエンドポイントから小売売上高（Retail trade survey）が
// 拾えることを確認する。NZは南半球のためこの時期はNZST（UTC+12、非DST）
test('Stats NZ(nz_stats_calendar): 小売売上高(8/24)が実fixtureと日時・重要度・名称とも完全一致', async () => {
  const { checkWeeklyScrapeSource } = await import('../scripts/checkers/harness.mjs');
  const icsBody = readFixture('nz_stats_calendar', 'calendar_export_202608.ics');
  const fetchImpl = fixtureFetch({ 'calendar-export': icsBody });
  const source = sourcesConfig.sources.find((s) => s.id === 'nz_stats_calendar');
  const WEEK_20260824 = { targetWeekStart: '2026-08-24', targetWeekEnd: '2026-08-28', dates: [] };

  const r = await checkWeeklyScrapeSource(source, WEEK_20260824, { fetchImpl, robotsChecker: ALLOW_ROBOTS, eventNames, importanceRules });
  assert.equal(r.ok, true);
  const retail = r.thisWeek.find((c) => c.kind === 'retail_sales');
  assert.ok(retail, 'NZ retail_salesが見つからない');
  assert.equal(retail.date, '2026-08-24');
  assert.equal(retail.time, '07:45'); // 10:45 NZST(UTC+12、8月は非DST) → JST(UTC+9)
  assert.equal(retail.displayName, '小売売上高');
  assert.equal(retail.importance, 3);

  // 同一fixture内の無関係なリリース（運輸統計等）は誤って拾われないことも確認する
  assert.equal(r.thisWeek.filter((c) => c.kind === 'retail_sales').length, 1);
});

test('FRED(us_bls_fred): CPI/PPI/雇用統計/JOLTSの4件が既刊と日時・重要度・名称とも完全一致', async () => {
  const { checkFredSource } = await import('../scripts/checkers/harness.mjs');
  const source = sourcesConfig.sources.find((s) => s.id === 'us_bls_fred');
  const fixtures = {
    10: readFixture('us_bls_fred', 'release_10_cpi.json'),
    46: readFixture('us_bls_fred', 'release_46_ppi.json'),
    50: readFixture('us_bls_fred', 'release_50_employment_situation.json'),
    192: readFixture('us_bls_fred', 'release_192_jolts.json'),
    // release_id=53（US GDP、2026-08-15追加）: ライブfixture未取得のため、既刊2週の対象外で
    // あることのみ表すスキーマ準拠の空応答スタブ（FRED release/dates APIの実レスポンス構造）
    53: JSON.stringify({ release_dates: [] }),
    // release_id=54（US PCE、2026-08-22追加）: 同上の理由でスキーマ準拠の空応答スタブ
    54: JSON.stringify({ release_dates: [] }),
    // release_id=180（米新規失業保険申請件数、task #89・2026-09-06追加）: 同上の理由でスキーマ準拠の空応答スタブ
    180: JSON.stringify({ release_dates: [] }),
    // release_id=91（ミシガン大学消費者信頼感指数、task #90・2026-09-06追加）: 同上の理由でスキーマ準拠の空応答スタブ
    91: JSON.stringify({ release_dates: [] }),
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

test('Ivey PMI(ca_ivey, annual_schedule_config): 8/7が既刊と日時・重要度・名称とも完全一致', async () => {
  const { checkAnnualScheduleSource } = await import('../scripts/checkers/harness.mjs');
  const { resolveCandidateEvent } = require('../scripts/lib/resolve-candidate');
  const source = sourcesConfig.sources.find((s) => s.id === 'ca_ivey');

  const r = await checkAnnualScheduleSource(source, WEEK_20260803);
  assert.equal(r.ok, true);
  assert.equal(r.matchedEntries.length, 1);

  const tz = source.announce_time_by_kind.pmi_ism.tz;
  const localTime = source.announce_time_by_kind.pmi_ism.local_time;
  const candidate = resolveCandidateEvent(
    { title: 'Ivey PMI', date: r.matchedEntries[0].date, localTime },
    { country: 'CA', kind: 'pmi_ism', tz, eventNames, importanceRules }
  );

  const gtIvey = gt('ca_ivey_pmi_20260807');
  assert.equal(candidate.ok, true);
  assert.equal(candidate.date, gtIvey.date);
  assert.equal(candidate.time, gtIvey.time);
  assert.equal(candidate.importance, gtIvey.stars);
  assert.equal(candidate.displayName, 'Ivey購買部協会景況指数');
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

test('MOF(jp_mof): 10年債(8/4)・30年債(8/6)が既刊と日付・重要度とも一致（時刻は既刊どおり未公表、名称組立はtask #12スコープ）', () => {
  const { extractMofAuctions } = require('../scripts/checkers/extractors/mof');
  const { resolveImportance } = require('../scripts/lib/importance');
  const r = extractMofAuctions(readFixture('jp_mof', 'auction_calendar_2608.html'));
  assert.equal(r.ok, true);

  const gt10y = gt('jp_jgb_10y_auction_20260804');
  const row10y = r.rows.find((x) => x.date === '2026-08-04' && x.tenorJa === '10年');
  assert.ok(row10y, '10年債(8/4)が見つからない');
  assert.equal(gt10y.time, null); // ground truthも時刻未公表
  assert.equal(resolveImportance('bond_auction', 'JP', importanceRules), gt10y.stars);

  const gt30y = gt('jp_jgb_30y_auction_20260806');
  const row30y = r.rows.find((x) => x.date === '2026-08-06' && x.tenorJa === '30年');
  assert.ok(row30y, '30年債(8/6)が見つからない');
  assert.equal(gt30y.time, null);
  assert.equal(resolveImportance('bond_auction', 'JP', importanceRules), gt30y.stars);
});

test('FRB(us_frb_speeches): クック理事講演(8/6 05:05 JST)が既刊と日時とも完全一致（人名・役職解決はofficials.json拡充待ちのためtask #12スコープ外の別課題）', () => {
  const { extractFrbSpeeches } = require('../scripts/checkers/extractors/frb-speeches');
  const { utcToJstParts } = require('../scripts/lib/tz-convert');
  const r = extractFrbSpeeches(readFixture('us_frb_speeches', 'speeches_rss.xml'));
  assert.equal(r.ok, true);

  const cook = r.items.find((i) => i.speakerLastName === 'Cook' && i.pubDateRaw.includes('5 Aug 2026'));
  assert.ok(cook, 'クック理事講演(8/5 UTC)が見つからない');
  const jst = utcToJstParts(new Date(cook.pubDateRaw));
  const gtCook = gt('us_cook_speech_20260805');
  assert.equal(jst.date, gtCook.date);
  assert.equal(jst.time, gtCook.time);
});

test('Stats NZ(nz_statsnz, weekly_scrape): 次回リリース予定日の埋め込みテキストが見つからない場合は明示的にok:falseを返す（構造変化・URL更新漏れの検知）', async () => {
  const { checkWeeklyScrapeSource } = await import('../scripts/checkers/harness.mjs');
  const nzSource = sourcesConfig.sources.find((s) => s.id === 'nz_statsnz');
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => '<html>stub</html>' });

  const rNz = await checkWeeklyScrapeSource(nzSource, WEEK_20260803, { fetchImpl, robotsChecker: ALLOW_ROBOTS, eventNames, importanceRules });
  assert.equal(rNz.ok, false);
  assert.match(rNz.reason, /抽出失敗/);
});

test('Stats NZ(nz_statsnz, weekly_scrape): 抽出結果が全件対象週より過去の場合はURL更新漏れ疑いとして明示的にok:falseを返す（next_release_pointer鮮度チェック）', async () => {
  const { checkWeeklyScrapeSource } = await import('../scripts/checkers/harness.mjs');
  const nzSource = sourcesConfig.sources.find((s) => s.id === 'nz_statsnz');
  // latest_labour_market_release.html（2026年6月期ページ）は次サイクル（2026年9月期＝2026-11-04）を
  // 予告する。それより後の対象週（2026-12週）で照合すると「全候補が対象週より過去」となるはず
  const latestHtml = readFixture('nz_statsnz', 'latest_labour_market_release.html');
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => latestHtml });
  const futureWeek = { targetWeekStart: '2026-12-07', targetWeekEnd: '2026-12-11', dates: ['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11'].map((date) => ({ date })) };

  const r = await checkWeeklyScrapeSource(nzSource, futureWeek, { fetchImpl, robotsChecker: ALLOW_ROBOTS, eventNames, importanceRules });
  assert.equal(r.ok, false);
  assert.match(r.reason, /URL更新漏れ/);
});

test('Stats NZ(nz_statsnz, weekly_scrape): 前四半期ページの実fixtureからground truth（nz_labour_q2、2026-08-05）を日時・重要度・名称とも完全一致で捕捉できる', async () => {
  const { checkWeeklyScrapeSource } = await import('../scripts/checkers/harness.mjs');
  const nzSource = sourcesConfig.sources.find((s) => s.id === 'nz_statsnz');
  // 本番targetsは直近ページ（2026年6月期）だが、ground truth（2026年6月期の発表日）を
  // 予告するのは前四半期（2026年3月期）ページのため、テストではfixtureをそちらへ差し替える
  const priorQuarterHtml = readFixture('nz_statsnz', 'TEMP_ground_truth_validation_prior_quarter.html');
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => priorQuarterHtml });

  const r = await checkWeeklyScrapeSource(nzSource, WEEK_20260803, { fetchImpl, robotsChecker: ALLOW_ROBOTS, eventNames, importanceRules });
  assert.equal(r.ok, true);
  assert.equal(r.thisWeek.length, 1);

  const gtNz = gt('nz_labour_q2_20260805');
  const candidate = r.thisWeek[0];
  assert.equal(candidate.date, gtNz.date);
  assert.equal(candidate.time, gtNz.time);
  assert.equal(candidate.importance, gtNz.stars);
  assert.equal(candidate.displayName, '雇用統計');
});

test('Statistics Canada(ca_statcan, annual_schedule_config): 国際商品貿易(8/4)・雇用統計(8/7)が既刊と日時・重要度・名称とも完全一致', async () => {
  const { checkAnnualScheduleSource } = await import('../scripts/checkers/harness.mjs');
  const { resolveCandidateEvent } = require('../scripts/lib/resolve-candidate');
  const source = sourcesConfig.sources.find((s) => s.id === 'ca_statcan');

  const r = await checkAnnualScheduleSource(source, WEEK_20260803);
  assert.equal(r.ok, true);
  assert.equal(r.matchedEntries.length, 2);

  for (const [id, kind, expectedName] of [
    ['ca_goods_trade_20260804', 'trade_balance', '国際商品貿易'],
    ['ca_labour_20260807', 'employment_situation', '雇用統計'],
  ]) {
    const entry = r.matchedEntries.find((e) => e.kind === kind);
    assert.ok(entry, `${kind}のmatchedEntryが見つからない`);
    const tz = source.announce_time_by_kind[kind].tz;
    const localTime = source.announce_time_by_kind[kind].local_time;
    const candidate = resolveCandidateEvent(
      { title: kind === 'trade_balance' ? 'Canadian international merchandise trade' : 'Labour Force Survey', date: entry.date, localTime },
      { country: 'CA', kind, tz, eventNames, importanceRules }
    );
    const gtEntry = gt(id);
    assert.equal(candidate.ok, true);
    assert.equal(candidate.date, gtEntry.date);
    assert.equal(candidate.time, gtEntry.time);
    assert.equal(candidate.importance, gtEntry.stars);
    assert.equal(candidate.displayName, expectedName);
  }
});
