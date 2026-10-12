'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const REAL_EVENT_NAMES = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'event-names.json'), 'utf8')).entries;

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

// task #89/#90（2026-09-06、しょうさん指摘: 米新規失業保険申請件数[毎週]・ミシガン大学消費者
// 信頼感指数が完全に未実装で恒常的に欠落していたと発覚）の回帰テスト。実configのus_bls_fredを
// そのまま使い、release_id=180（jobless_claims）・release_id=91（sentiment）が正しく
// resolveKindCandidates経由でdisplayName/importanceまで解決されることを確認する
test('checkFredSource: 実config（us_bls_fred）のjobless_claims/sentimentが対象週内で正しく解決される（task #89/#90）', async () => {
  const officialSources = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'official-sources.json'), 'utf8'));
  const importanceRules = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'importance-rules.json'), 'utf8'));
  const usBlsFred = officialSources.sources.find((s) => s.id === 'us_bls_fred');
  assert.ok(usBlsFred, 'us_bls_fredがconfigに存在するはず');

  const { checkFredSource } = await loadHarness();
  const fetchImpl = async (url) => {
    const releaseId = new URL(url).searchParams.get('release_id');
    const datesByRelease = {
      // jobless_claimsは毎週木曜。対象週(2026-09-07〜09-11)内の9/10（木）を1件だけ含める
      180: ['2026-08-27', '2026-09-03', '2026-09-10', '2026-09-17'],
      // sentimentは月2回（速報値・確定値）。対象週内には確定値の1件のみが該当する想定で作る
      91: ['2026-08-14', '2026-08-29', '2026-09-11'],
    };
    return { ok: true, json: async () => ({ release_dates: (datesByRelease[releaseId] || []).map((date) => ({ date })) }) };
  };
  const targetWeek = {
    targetWeekStart: '2026-09-07',
    targetWeekEnd: '2026-09-11',
    dates: [
      { date: '2026-09-07' }, { date: '2026-09-08' }, { date: '2026-09-09' }, { date: '2026-09-10' }, { date: '2026-09-11' },
    ],
  };
  const r = await checkFredSource(usBlsFred, targetWeek, { fetchImpl, apiKey: 'dummy', eventNames: REAL_EVENT_NAMES, importanceRules });
  assert.equal(r.ok, true);
  assert.ok(r.foundKinds.includes('jobless_claims'), 'jobless_claimsが対象週内で見つかるはず');
  assert.ok(r.foundKinds.includes('sentiment'), 'sentimentが対象週内で見つかるはず');

  const claims = r.thisWeek.find((c) => c.kind === 'jobless_claims');
  assert.ok(claims, 'jobless_claimsのcandidateが無い');
  assert.equal(claims.displayName, '新規失業保険申請件数');
  assert.equal(claims.importance, 2);
  assert.equal(claims.date, '2026-09-10');

  const sentiment = r.thisWeek.find((c) => c.kind === 'sentiment');
  assert.ok(sentiment, 'sentimentのcandidateが無い');
  assert.equal(sentiment.displayName, 'ミシガン大学消費者信頼感指数');
  assert.equal(sentiment.importance, 2);
});

// task #93（2026-09-06、しょうさん指示: 「公表リリース全量の差分監査」）の単体テスト
test('checkFredCatalogAudit: catalog_audit_source_idsが無いソースは常にnewReleases:[]', async () => {
  const { checkFredCatalogAudit } = await loadHarness();
  const r = await checkFredCatalogAudit({ fred: { releases: [] } }, { fetchImpl: async () => { throw new Error('呼ばれてはいけない'); }, apiKey: 'dummy' });
  assert.deepEqual(r.newReleases, []);
});

test('checkFredCatalogAudit: apiKey未設定はfetchせずnewReleases:[]', async () => {
  const { checkFredCatalogAudit } = await loadHarness();
  const source = { fred: { releases: [], catalog_audit_source_ids: [22] } };
  const r = await checkFredCatalogAudit(source, { fetchImpl: async () => { throw new Error('呼ばれてはいけない'); }, apiKey: '' });
  assert.deepEqual(r.newReleases, []);
});

test('checkFredCatalogAudit: 登録済みrelease_idはnewReleasesに含めない', async () => {
  const { checkFredCatalogAudit } = await loadHarness();
  const source = { fred: { releases: [{ release_id: 10 }], catalog_audit_source_ids: [22] } };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ releases: [{ id: 10, name: 'Consumer Price Index' }] }) });
  const r = await checkFredCatalogAudit(source, { fetchImpl, apiKey: 'dummy' });
  assert.deepEqual(r.newReleases, []);
});

test('checkFredCatalogAudit: 未登録のrelease_idはnewReleasesに含める（複数source_idをまとめて監査）', async () => {
  const { checkFredCatalogAudit } = await loadHarness();
  const source = { fred: { releases: [{ release_id: 10 }], catalog_audit_source_ids: [22, 18] } };
  const fetchImpl = async (url) => {
    const sourceId = new URL(url).searchParams.get('source_id');
    if (sourceId === '22') return { ok: true, json: async () => ({ releases: [{ id: 10, name: 'CPI' }, { id: 999, name: 'Brand New BLS Release' }] }) };
    return { ok: true, json: async () => ({ releases: [{ id: 888, name: 'Brand New BEA Release' }] }) };
  };
  const r = await checkFredCatalogAudit(source, { fetchImpl, apiKey: 'dummy' });
  assert.equal(r.newReleases.length, 2);
  assert.ok(r.newReleases.some((n) => n.releaseId === 999 && n.sourceId === 22 && n.name === 'Brand New BLS Release'));
  assert.ok(r.newReleases.some((n) => n.releaseId === 888 && n.sourceId === 18 && n.name === 'Brand New BEA Release'));
});

// 2026-09-06追加（実運用初回runで発覚・即日是正）: 除外リスト無しで実行したところ、BLS・BEAの
// 全リリース39件が『未登録』としてWARN化され、本来の情報が埋もれた。除外リストで意図的に
// 対象外としたrelease_idはnewReleasesに含めないことを確認する
test('checkFredCatalogAudit: catalog_audit_excluded_release_idsに含まれるrelease_idはnewReleasesに含めない', async () => {
  const { checkFredCatalogAudit } = await loadHarness();
  const source = {
    fred: {
      releases: [{ release_id: 10 }],
      catalog_audit_source_ids: [22],
      catalog_audit_excluded_release_ids: [11, 47],
    },
  };
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      releases: [
        { id: 10, name: 'CPI' },
        { id: 11, name: 'Employment Cost Index' },
        { id: 47, name: 'Productivity and Costs' },
        { id: 999, name: 'Genuinely New Release' },
      ],
    }),
  });
  const r = await checkFredCatalogAudit(source, { fetchImpl, apiKey: 'dummy' });
  assert.deepEqual(r.newReleases.map((n) => n.releaseId), [999]);
});

// 実configのcatalog_audit_excluded_release_idsが最新のBLS/BEAカタログをそのまま反映していれば
// newReleasesは空になるはず（実運用初回runで実際に検出した39件をそのまま登録した回帰テスト）
test('checkFredCatalogAudit: 実config（us_bls_fred）は実運用で検出済みの39件を全て除外リストに含む', async () => {
  const officialSources = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'official-sources.json'), 'utf8'));
  const usBlsFred = officialSources.sources.find((s) => s.id === 'us_bls_fred');
  const { checkFredCatalogAudit } = await loadHarness();
  const knownReleaseIdsFromFirstRun = [11, 47, 107, 112, 113, 116, 188, 201, 202, 203, 204, 230, 308, 332, 334, 345, 353, 357, 362, 384, 446, 454, 479, 490, 49, 51, 93, 110, 140, 175, 281, 286, 331, 356, 359, 360, 391, 397, 403];
  const fetchImpl = async (url) => {
    const sourceId = new URL(url).searchParams.get('source_id');
    const ids = sourceId === '22'
      ? [10, 46, 50, 192, 180, ...knownReleaseIdsFromFirstRun.slice(0, 24)]
      : [53, 54, ...knownReleaseIdsFromFirstRun.slice(24)];
    return { ok: true, json: async () => ({ releases: ids.map((id) => ({ id, name: `release ${id}` })) }) };
  };
  const r = await checkFredCatalogAudit(usBlsFred, { fetchImpl, apiKey: 'dummy' });
  assert.deepEqual(r.newReleases, [], JSON.stringify(r.newReleases));
});

test('checkFredCatalogAudit: fetch失敗・HTTPエラー・JSON parse失敗はrun全体を巻き込まず静かにスキップする', async () => {
  const { checkFredCatalogAudit } = await loadHarness();
  const source = { fred: { releases: [], catalog_audit_source_ids: [22, 18, 1] } };
  const fetchImpl = async (url) => {
    const sourceId = new URL(url).searchParams.get('source_id');
    if (sourceId === '22') throw new Error('network error');
    if (sourceId === '18') return { ok: false, status: 500 };
    return { ok: true, json: async () => { throw new Error('invalid json'); } };
  };
  const r = await checkFredCatalogAudit(source, { fetchImpl, apiKey: 'dummy' });
  assert.deepEqual(r.newReleases, []);
});

// task #93: runChecks()経由での結線確認。実configのus_bls_fred（catalog_audit_source_ids設定済み）が
// meta.warningsへ反映される経路（report.catalogAuditWarnings）まで通ることを確認する
test('runChecks: catalog_audit_source_ids設定済みソースの未登録リリースがcatalogAuditWarningsへ反映される', async () => {
  const officialSources = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'official-sources.json'), 'utf8'));
  const importanceRules = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'importance-rules.json'), 'utf8'));
  const { runChecks } = await loadHarness();
  const targetWeek = {
    targetWeekStart: '2026-09-07',
    targetWeekEnd: '2026-09-11',
    dates: [{ date: '2026-09-07' }, { date: '2026-09-08' }, { date: '2026-09-09' }, { date: '2026-09-10' }, { date: '2026-09-11' }],
    collectionDate: '2026-09-05',
  };
  // us_bls_fred以外の全ソースはfetchを避けるため、pending_recon以外はskip扱いにできないので
  // 単純に「release_id/source_idを含まないURLは全て404」とし、us_bls_fredのcheckFredSource自体は
  // release_dates:[]（今週は何も無い）、catalog_audit_source_idsの照会にだけ新規リリースを混ぜる
  const fetchImpl = async (url) => {
    if (url.includes('source_id=22')) return { ok: true, json: async () => ({ releases: [{ id: 99999, name: 'Brand New Indicator' }] }) };
    if (url.includes('release_id=')) return { ok: true, json: async () => ({ release_dates: [] }) };
    return { ok: false, status: 404 };
  };
  const report = await runChecks({
    sourcesConfig: officialSources, importanceRules, eventNames: REAL_EVENT_NAMES, targetWeek,
    fetchImpl, apiKey: 'dummy', robotsChecker: { isAllowed: async () => ({ allowed: true }) },
  });
  assert.ok(
    report.catalogAuditWarnings.some((w) => w.includes('Brand New Indicator') && w.includes('99999')),
    JSON.stringify(report.catalogAuditWarnings)
  );
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
  // tenorJaがresolveCandidateEvent経由で候補まで引き継がれることの確認（2026-08-15配線。
  // scripts/lib/build-ledger.jsのresolveRuleGeneratedName()がSPEC §4.2の国債入札命名で使う）
  const row10y = r.thisWeek.find((c) => c.date === '2026-08-04');
  assert.equal(row10y.tenorJa, '10年');
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
  // tenorJaの引き継ぎ確認（2026-08-15配線。jp_mofと同様）
  const auction = r.thisWeek.find((c) => c.date === '2026-08-19');
  assert.equal(auction.tenorJa, '20年');
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
  // speakerLastNameの引き継ぎ確認（2026-08-15配線。scripts/lib/build-ledger.jsの
  // resolveRuleGeneratedName()がnaming.resolveOfficialBySurnameで照合を試みる）
  assert.equal(cook.speakerLastName, 'Cook');
});

// us_frb_calendar（task #94フォローアップ、2026-09-19新設）: us_frb_speechesが講演実施後にしか
// 追加されない構造的限界を補う事前検出用ソース。月別動的URL生成（jp_mofと同じ設計）＋
// 翌月分クロスマンス先読みが正しく機能することを確認する
test('checkWeeklyScrapeSource: us_frb_calendar は対象週の月＋翌月分の2URLをフェッチし、東部時間からJSTへ正しく変換する', async () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { checkWeeklyScrapeSource } = await loadHarness();
  const html = readFileSync(join(__dirname, 'fixtures', 'official-sources', 'us_frb_calendar', '2026-september.htm'), 'utf8');
  const noSpeechHtml = readFileSync(join(__dirname, 'fixtures', 'official-sources', 'us_frb_calendar', '2026-october-no-speeches.htm'), 'utf8');
  const source = {
    id: 'us_frb_calendar',
    country: 'US',
    kinds: ['official_speech'],
    access: { robots_check: true, provides_exact_time: true, month_url_pattern: 'https://www.federalreserve.gov/newsevents/{YEAR}-{MONTH_NAME}.htm' },
    announce_time_by_kind: { official_speech: { tz: 'America/New_York' } },
  };
  const robotsChecker = { isAllowed: async () => ({ allowed: true }) };
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(url);
    if (url.endsWith('2026-september.htm')) return { ok: true, status: 200, text: async () => html };
    if (url.endsWith('2026-october.htm')) return { ok: true, status: 200, text: async () => noSpeechHtml };
    return { ok: false, status: 404 };
  };
  const targetWeek = { targetWeekStart: '2026-09-21', targetWeekEnd: '2026-09-27' };
  const r = await checkWeeklyScrapeSource(source, targetWeek, { fetchImpl, robotsChecker, eventNames: [] });
  assert.deepEqual(requestedUrls.sort(), [
    'https://www.federalreserve.gov/newsevents/2026-october.htm',
    'https://www.federalreserve.gov/newsevents/2026-september.htm',
  ]);
  assert.equal(r.ok, true);
  // ジェファーソン副議長講演（9/22 10:20 a.m. ET=EDT）がJST 23:20として解決されることを確認
  // （config/manual-events.jsonのfrb-speech-jefferson-2026-09-22エントリと同じ実時刻）
  const jefferson = r.thisWeek.find((c) => c.speakerLastName === 'Philip Jefferson');
  assert.ok(jefferson, JSON.stringify(r.thisWeek));
  assert.equal(jefferson.date, '2026-09-22');
  assert.equal(jefferson.time, '23:20');
});

test('checkWeeklyScrapeSource: us_frb_calendar は月またぎ週で開始月・終了月・翌月の3URLをフェッチする', async () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { checkWeeklyScrapeSource } = await loadHarness();
  const html = readFileSync(join(__dirname, 'fixtures', 'official-sources', 'us_frb_calendar', '2026-september.htm'), 'utf8');
  const source = {
    id: 'us_frb_calendar',
    country: 'US',
    kinds: ['official_speech'],
    access: { robots_check: true, provides_exact_time: true, month_url_pattern: 'https://www.federalreserve.gov/newsevents/{YEAR}-{MONTH_NAME}.htm' },
    announce_time_by_kind: { official_speech: { tz: 'America/New_York' } },
  };
  const robotsChecker = { isAllowed: async () => ({ allowed: true }) };
  const requestedUrls = [];
  // マージ機構自体の検証が目的のため、3URLとも同一fixture（9月分）を返す
  const fetchImpl = async (url) => {
    requestedUrls.push(url);
    return { ok: true, status: 200, text: async () => html };
  };
  const targetWeek = { targetWeekStart: '2026-08-31', targetWeekEnd: '2026-09-06' };
  const r = await checkWeeklyScrapeSource(source, targetWeek, { fetchImpl, robotsChecker, eventNames: [] });
  assert.deepEqual(requestedUrls.sort(), [
    'https://www.federalreserve.gov/newsevents/2026-august.htm',
    'https://www.federalreserve.gov/newsevents/2026-october.htm',
    'https://www.federalreserve.gov/newsevents/2026-september.htm',
  ].sort());
  assert.equal(r.ok, true);
});

test('checkWeeklyScrapeSource: us_frb_calendar は当該月にSpeechが無くても（他カテゴリの行があれば）フェールクローズしない', async () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { checkWeeklyScrapeSource } = await loadHarness();
  const noSpeechHtml = readFileSync(join(__dirname, 'fixtures', 'official-sources', 'us_frb_calendar', '2026-october-no-speeches.htm'), 'utf8');
  const source = {
    id: 'us_frb_calendar',
    country: 'US',
    kinds: ['official_speech'],
    access: { robots_check: true, provides_exact_time: true, month_url_pattern: 'https://www.federalreserve.gov/newsevents/{YEAR}-{MONTH_NAME}.htm' },
    announce_time_by_kind: { official_speech: { tz: 'America/New_York' } },
  };
  const robotsChecker = { isAllowed: async () => ({ allowed: true }) };
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => noSpeechHtml });
  const targetWeek = { targetWeekStart: '2026-10-05', targetWeekEnd: '2026-10-11' };
  const r = await checkWeeklyScrapeSource(source, targetWeek, { fetchImpl, robotsChecker, eventNames: [] });
  assert.equal(r.ok, true);
  assert.equal(r.thisWeek.length, 0);
});

// gb_ons（ONS releases API）は release-type=type-upcoming 固定のため、過去週（既刊2週含む）の
// 照合はAPIの構造上不可能（config/official-sources.jsonのgb_ons notes・docs/annual-schedule-
// maintenance.md参照）。しょうさん指示2026-08-15: 「upcoming専用だから照合できない」を恒久的な
// 検証免除にはせず、現行の実キャプチャ済みfixture（2026-08-14/15取得）に含まれる直近の実在リリース
// で抽出ロジック自体を回帰テストする。当該リリース「GDP monthly estimate, UK: July 2026」の
// タイトル形式（'GDP monthly estimate, UK: {Month} {Year}'）はWebSearchでons.gov.uk実在の
// ブリテンシリーズ（例: gdpmonthlyestimateukapril2026等の実URL）と一致することを確認済み
// （2026-08-15）。なお既刊ground truthの実イベント種別は「GDP first quarterly estimate」（四半期）
// でありこのfixtureの「monthly estimate」とは別シリーズ。抽出関数（extractOnsReleases）が
// 実データのJSON構造を正しくパースできることの確認が目的（辞書照合の訂正確認は
// test/match-event-name.test.js が別途担う）。
// 2026-09-06追記（task #91、しょうさん指摘: 9/7週の突合でこの月次GDPが不検出だった）: 当時は
// 「月次GDPを新たに追跡対象へ加える設計判断は本タスクの範囲外」としていたが、実際にこの release が
// 9/7週の対象週内（2026-09-11）に該当したことでevent-names.json未登録による欠落が実際に発生した。
// GB/gdpにsubtype:"monthly"のmatchエントリを追加したため、以下でfindEventNameが正しく解決することも
// あわせて確認する
test('ONS(gb_ons): 実キャプチャ済みfixture（release-type=type-upcoming）から実在の未来リリースを正しく抽出する（過去週照合不可の代替としての回帰テスト）', () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { extractOnsReleases } = require('../scripts/checkers/extractors/ons.js');
  const { findEventName } = require('../scripts/lib/match-event-name.js');
  const json = readFileSync(join(__dirname, 'fixtures', 'official-sources', 'gb_ons', 'releases_api_upcoming_gdp.json'), 'utf8');
  const r = extractOnsReleases(json);
  assert.equal(r.ok, true);
  const monthly = r.rows.find((row) => row.title === 'GDP monthly estimate, UK: July 2026');
  assert.ok(monthly, 'GDP monthly estimate, UK: July 2026が抽出されるはず');
  assert.equal(monthly.utcInstant, '2026-09-11T06:00:00.000Z');
  assert.equal(monthly.cancelled, false);

  const nameEntry = findEventName(REAL_EVENT_NAMES, 'GB', 'gdp', monthly.title);
  assert.ok(nameEntry, 'task #91是正後は月次GDPもevent-names.jsonで解決できるはず');
  assert.equal(nameEntry.display_name, '月次GDP');
  // 四半期版のエントリと誤って混同されないことも確認
  const quarterly = findEventName(REAL_EVENT_NAMES, 'GB', 'gdp', 'GDP first quarterly estimate, UK: April to June 2026');
  assert.equal(quarterly.display_name, 'GDP【速報値】');
});

function snbSource() {
  return {
    id: 'snb_policy_rate',
    country: 'CH',
    kinds: ['policy_rate', 'press_conference', 'opinions_summary'],
    access: { robots_check: true, targets: [{ label: 'event_schedule', url: 'https://www.snb.ch/en/services-events/digital-services/event-schedule' }] },
    announce_time_by_kind: {
      policy_rate: { local_time: '09:30', tz: 'Europe/Zurich' },
      press_conference: { local_time: '10:00', tz: 'Europe/Zurich' },
      opinions_summary: { local_time: '09:30', tz: 'Europe/Zurich' },
    },
  };
}

test('checkWeeklyScrapeSource: snb_policy_rate（row.kind確定型）は実fixtureから対象週のMonetary policy assessmentを抽出する', async () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { checkWeeklyScrapeSource } = await loadHarness();
  const html = readFileSync(join(__dirname, 'fixtures', 'official-sources', 'snb_policy_rate', 'event_schedule.html'), 'utf8');
  const robotsChecker = { isAllowed: async () => ({ allowed: true }) };
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => html });
  // ground truth: しょうさん転記の2026-09-24分（Monetary policy assessment）
  const targetWeek = { targetWeekStart: '2026-09-21', targetWeekEnd: '2026-09-27' };
  const r = await checkWeeklyScrapeSource(snbSource(), targetWeek, { fetchImpl, robotsChecker, eventNames: [] });
  assert.equal(r.ok, true);
  assert.equal(r.unregistered.length, 0, `event-names.json未登録WARNが出てはいけない: ${JSON.stringify(r.unregistered)}`);
  assert.deepEqual([...r.foundKinds].sort(), ['policy_rate', 'press_conference']);
  const policyRate = r.thisWeek.find((c) => c.kind === 'policy_rate');
  const pressConf = r.thisWeek.find((c) => c.kind === 'press_conference');
  assert.equal(policyRate.date, '2026-09-24');
  assert.equal(policyRate.time, '16:30'); // Europe/Zurich 09:30 CEST(UTC+2) → JST 16:30
  assert.equal(pressConf.time, '17:00'); // 10:00 CEST → JST 17:00
  assert.ok(r.thisWeek.every((c) => c.displayName === null), 'ruleGenerated行はdisplayName未解決のはず');
});

test('checkWeeklyScrapeSource: snb_policy_rate は金融政策関連イベントが1件も無い応答を構造的失敗として返す（フェールクローズ接続）', async () => {
  const { checkWeeklyScrapeSource } = await loadHarness();
  const robotsChecker = { isAllowed: async () => ({ allowed: true }) };
  // サイト構造変化・想定外パターンを模擬（Monetary policy assessment等のパターンを含まない応答）
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => '<html><body>Page redesigned, no events listed here.</body></html>' });
  const targetWeek = { targetWeekStart: '2026-09-21', targetWeekEnd: '2026-09-27' };
  const r = await checkWeeklyScrapeSource(snbSource(), targetWeek, { fetchImpl, robotsChecker, eventNames: [] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /抽出失敗（構造変化の疑い）/);
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

// pending_reconソース（中国PMI・英建設業PMI・ADP等、task #16）はhttps://...の実装が無いため
// skipped扱いとなりfailuresに計上されない＝HOLDにはならないが、担当sourceIdを指定した
// recurring_checksエントリにより「定例欠落」WARNとして可視化される（しょうさん指示2026-08-15）。
// 対象週は2026-08-03週（day 3〜7、rule「1日〜7日ごろ」に該当）を使う
const EARLY_MONTH_WEEK = {
  collectionDate: '2026-08-01',
  targetWeekStart: '2026-08-03',
  targetWeekEnd: '2026-08-07',
  dates: [
    { date: '2026-08-03', md: '8/3', weekday: '月' },
    { date: '2026-08-04', md: '8/4', weekday: '火' },
    { date: '2026-08-05', md: '8/5', weekday: '水' },
    { date: '2026-08-06', md: '8/6', weekday: '木' },
    { date: '2026-08-07', md: '8/7', weekday: '金' },
  ],
};

test('runChecks: pending_reconソースの欠落はHOLDにせずrecurring_checks経由でWARN可視化する', async () => {
  const { runChecks } = await loadHarness();
  const sourcesConfig = {
    sources: [{ id: 'cn_pmi', status: 'pending_recon', country: 'CN', kinds: ['pmi_ism'], type: 'weekly_scrape', recurring_check_refs: ['中国PMI'] }],
  };
  const importanceRules = { recurring_checks: [{ name: '中国PMI', rule: '毎月1日〜7日ごろ', action: 'WARN' }] };
  const report = await runChecks({ sourcesConfig, importanceRules, targetWeek: EARLY_MONTH_WEEK });
  assert.equal(report.outcome.status, 'OK', 'pending_reconはskipped扱いでfailuresに計上されないためHOLDにはならない');
  assert.equal(report.recurringMissingWarnings.length, 1);
  assert.match(report.recurringMissingWarnings[0], /中国PMI/);
});

test('computeRecurringChecksStatus: 全ルールのapplies_this_week/foundを返す（recurringMissingWarningsと同じ照合ロジック）', async () => {
  const { runChecks, computeRecurringChecksStatus } = await loadHarness();
  const sourcesConfig = {
    sources: [{ id: 'cn_pmi', status: 'pending_recon', country: 'CN', kinds: ['pmi_ism'], type: 'weekly_scrape', recurring_check_refs: ['中国PMI'] }],
  };
  const importanceRules = {
    recurring_checks: [
      { name: '中国PMI', rule: '毎月1日〜7日ごろ', action: 'WARN' },
      { name: '米CPI', rule: '毎月10日〜16日ごろ', action: 'WARN' },
    ],
  };
  const report = await runChecks({ sourcesConfig, importanceRules, targetWeek: EARLY_MONTH_WEEK });
  const status = computeRecurringChecksStatus(report.results, importanceRules, EARLY_MONTH_WEEK);
  assert.deepEqual(status, [
    { name: '中国PMI', applies_this_week: true, found: false },
    { name: '米CPI', applies_this_week: false, found: false },
  ]);
});

test('runChecks: sourceId指定のrecurring_checksは同一kindの別ソース成功では消えない（誤った充足判定の防止）', async () => {
  const { runChecks } = await loadHarness();
  const sourcesConfig = {
    sources: [
      { id: 'cn_pmi', status: 'pending_recon', country: 'CN', kinds: ['pmi_ism'], type: 'weekly_scrape', recurring_check_refs: ['中国PMI'] },
      {
        id: 'us_ism', status: 'active', country: 'US', kinds: ['pmi_ism'], type: 'annual_schedule_config',
        schedule: [{ date: '2026-08-03', kind: 'pmi_ism' }],
      },
    ],
  };
  const importanceRules = { recurring_checks: [{ name: '中国PMI', rule: '毎月1日〜7日ごろ', action: 'WARN' }] };
  const report = await runChecks({ sourcesConfig, importanceRules, targetWeek: EARLY_MONTH_WEEK });
  // us_ismが同じkind=pmi_ismを対象週内に見つけていても、中国PMI（cn_pmi限定）のWARNは消えない
  assert.equal(report.recurringMissingWarnings.length, 1);
  assert.match(report.recurringMissingWarnings[0], /中国PMI/);
});

// task #87（2026-08-30、しょうさん指摘）: au_absはstatus=activeで抽出ルールも実装済みだが、
// future-releases-calendarの掲載horizonが直近1ヶ月強のみのため、対象発表日がhorizon外だと
// weekly_scrapeが「抽出成功・該当行なし」（ok:true・foundKinds:[]）を返し、cn_pmi等の
// pending_reconケースとは異なり従来は無警告のまま検出漏れになっていた。sourceId指定の
// recurring_checksでこれを可視化できることを確認する（対象週=2026-08-31週、GDPの月×日範囲に該当）
test('runChecks: au_absがhorizon外でGDP/貿易収支を検出できない週はrecurring_checks経由でWARN可視化する（task #87）', async () => {
  const { runChecks } = await loadHarness();
  // GDP/trade_balance以外の無関係な行のみを含む、抽出自体は成功するfuture-releases-calendar
  const html = `<div><strong class="event-name">Consumer Price Index, Australia</strong><time datetime="2026-08-26T01:30:00Z"></time></div>`;
  const sourcesConfig = {
    sources: [
      {
        id: 'au_abs', status: 'active', country: 'AU', kinds: ['cpi', 'gdp', 'trade_balance'], type: 'weekly_scrape',
        access: { targets: [{ label: 'future_releases_calendar', url: 'https://example.invalid/abs' }] },
        recurring_check_refs: [],
      },
    ],
  };
  const importanceRules = {
    recurring_checks: [
      { name: '豪州GDP（ABS）', rule: '3月・6月・9月・12月の1日〜5日ごろ', action: 'WARN' },
      { name: '豪州貿易収支（ABS）', rule: '毎月1日〜10日ごろ', action: 'WARN' },
    ],
  };
  const targetWeek = {
    collectionDate: '2026-08-29', targetWeekStart: '2026-08-31', targetWeekEnd: '2026-09-04',
    dates: [
      { date: '2026-08-31', md: '8/31', weekday: '月' }, { date: '2026-09-01', md: '9/1', weekday: '火' },
      { date: '2026-09-02', md: '9/2', weekday: '水' }, { date: '2026-09-03', md: '9/3', weekday: '木' },
      { date: '2026-09-04', md: '9/4', weekday: '金' },
    ],
  };
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => html });
  const report = await runChecks({ sourcesConfig, importanceRules, targetWeek, fetchImpl, eventNames: REAL_EVENT_NAMES });
  assert.equal(report.outcome.status, 'OK', 'au_abs自体はok:trueのためHOLDにはならない');
  assert.equal(report.recurringMissingWarnings.length, 2);
  assert.ok(report.recurringMissingWarnings.some((w) => w.includes('豪州GDP（ABS）')));
  assert.ok(report.recurringMissingWarnings.some((w) => w.includes('豪州貿易収支（ABS）')));
});

test('runChecks: au_absが対象月・対象日範囲でGDPを検出できた週はWARNが出ない（task #87の偽陽性防止）', async () => {
  const { runChecks } = await loadHarness();
  const html = `<div><strong class="event-name">Australian National Accounts: National Income, Expenditure and Product</strong><time datetime="2026-09-02T01:30:00Z"></time></div>`;
  const sourcesConfig = {
    sources: [
      {
        id: 'au_abs', status: 'active', country: 'AU', kinds: ['gdp'], type: 'weekly_scrape',
        access: { targets: [{ label: 'future_releases_calendar', url: 'https://example.invalid/abs' }] },
        recurring_check_refs: [],
      },
    ],
  };
  const importanceRules = {
    recurring_checks: [{ name: '豪州GDP（ABS）', rule: '3月・6月・9月・12月の1日〜5日ごろ', action: 'WARN' }],
  };
  const targetWeek = {
    collectionDate: '2026-08-29', targetWeekStart: '2026-08-31', targetWeekEnd: '2026-09-04',
    dates: [
      { date: '2026-08-31', md: '8/31', weekday: '月' }, { date: '2026-09-01', md: '9/1', weekday: '火' },
      { date: '2026-09-02', md: '9/2', weekday: '水' }, { date: '2026-09-03', md: '9/3', weekday: '木' },
      { date: '2026-09-04', md: '9/4', weekday: '金' },
    ],
  };
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => html });
  const report = await runChecks({ sourcesConfig, importanceRules, targetWeek, fetchImpl, eventNames: REAL_EVENT_NAMES });
  assert.equal(report.recurringMissingWarnings.length, 0, JSON.stringify(report.recurringMissingWarnings));
});

// 2026-09-19追加（しょうさん指摘: PR #28マージ後のフォローアップ確認事項2）。task #87の
// 2つのend-to-endテスト（756行目・784行目）は9月週のみを対象としていたため、次回の豪州GDP本体
// 発表（2026年12月）でも同じ経路が機能するかは「9月で動くなら12月も動くはず」という推測に
// 留まっていた。matchキーワード自体は月に依存しない文字列一致のため理屈上は問題ないはずだが、
// 実際に12月の日付・実タイトルで動作確認する（推測ではなく実測に置き換える）
test('runChecks: 12月週でも「Australian National Accounts: National Income, Expenditure and Product」がGDPとして検出できWARNが出ない（次回発表・2026年12月分の先取り確認）', async () => {
  const { runChecks } = await loadHarness();
  const html = `<div><strong class="event-name">Australian National Accounts: National Income, Expenditure and Product</strong><time datetime="2026-12-02T01:30:00Z"></time></div>`;
  const sourcesConfig = {
    sources: [
      {
        id: 'au_abs', status: 'active', country: 'AU', kinds: ['gdp'], type: 'weekly_scrape',
        access: { targets: [{ label: 'future_releases_calendar', url: 'https://example.invalid/abs' }] },
        recurring_check_refs: [],
      },
    ],
  };
  const importanceRules = {
    recurring_checks: [{ name: '豪州GDP（ABS）', rule: '3月・6月・9月・12月の1日〜5日ごろ', action: 'WARN' }],
  };
  const targetWeek = {
    collectionDate: '2026-11-28', targetWeekStart: '2026-11-30', targetWeekEnd: '2026-12-04',
    dates: [
      { date: '2026-11-30', md: '11/30', weekday: '月' }, { date: '2026-12-01', md: '12/1', weekday: '火' },
      { date: '2026-12-02', md: '12/2', weekday: '水' }, { date: '2026-12-03', md: '12/3', weekday: '木' },
      { date: '2026-12-04', md: '12/4', weekday: '金' },
    ],
  };
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => html });
  const report = await runChecks({ sourcesConfig, importanceRules, targetWeek, fetchImpl, eventNames: REAL_EVENT_NAMES });
  assert.equal(report.recurringMissingWarnings.length, 0, JSON.stringify(report.recurringMissingWarnings));
});

// 12月週でau_absがGDPを検出できなかった場合（horizon外・サイト構造変化等）は、9月週と同じく
// recurring_checks経由でWARNが引き続き発火することを確認する（取りこぼし時のフェールセーフ）
test('runChecks: 12月週でau_absがGDPを検出できない場合はrecurring_checks経由でWARNが引き続き発火する', async () => {
  const { runChecks } = await loadHarness();
  const html = `<div><strong class="event-name">Consumer Price Index, Australia</strong><time datetime="2026-11-25T01:30:00Z"></time></div>`;
  const sourcesConfig = {
    sources: [
      {
        id: 'au_abs', status: 'active', country: 'AU', kinds: ['cpi', 'gdp'], type: 'weekly_scrape',
        access: { targets: [{ label: 'future_releases_calendar', url: 'https://example.invalid/abs' }] },
        recurring_check_refs: [],
      },
    ],
  };
  const importanceRules = {
    recurring_checks: [{ name: '豪州GDP（ABS）', rule: '3月・6月・9月・12月の1日〜5日ごろ', action: 'WARN' }],
  };
  const targetWeek = {
    collectionDate: '2026-11-28', targetWeekStart: '2026-11-30', targetWeekEnd: '2026-12-04',
    dates: [
      { date: '2026-11-30', md: '11/30', weekday: '月' }, { date: '2026-12-01', md: '12/1', weekday: '火' },
      { date: '2026-12-02', md: '12/2', weekday: '水' }, { date: '2026-12-03', md: '12/3', weekday: '木' },
      { date: '2026-12-04', md: '12/4', weekday: '金' },
    ],
  };
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => html });
  const report = await runChecks({ sourcesConfig, importanceRules, targetWeek, fetchImpl, eventNames: REAL_EVENT_NAMES });
  assert.equal(report.recurringMissingWarnings.length, 1);
  assert.ok(report.recurringMissingWarnings.some((w) => w.includes('豪州GDP（ABS）')));
});

// 2026-10-12追加（しょうさん指摘の実インシデント回帰テスト、同日改訂）: 10/12週の米小売売上高欠落
// インシデントを受け、retail_salesの担当をus_census（weekly_scrape）からus_census_retail_sales
// （annual_schedule_config、Census公式の年間発表予定）へ切り替えた。us_census.kindsから
// retail_salesを除外したため、calendar-listview.htmlに「Advance Monthly Sales for Retail and
// Food Services」行が載っていても、us_census側は（trade_balance以外として）無視することを確認する
// （2ソースが同じ候補を重複生成しないことの回帰テスト）
test('checkWeeklyScrapeSource: us_censusはkindsからretail_salesが外れているため、該当行が載っていても分類しない（us_census_retail_sales新設に伴う重複防止の回帰テスト）', async () => {
  const { checkWeeklyScrapeSource } = await loadHarness();
  const html = `<tr height="20"><td height="20"><a href="/retail">Advance Monthly Sales for Retail and Food Services</a></td><td sorttable_customkey="202610150830">October 15, 2026</td><td>8:30 AM</td><td>September 2026</td></tr><tr height="20"><td height="20"><a href="/foreign-trade/">U.S. International Trade in Goods and Services</a></td><td sorttable_customkey="202610060830">October 6, 2026</td><td>8:30 AM</td><td>August 2026</td></tr>`;
  const source = {
    id: 'us_census', status: 'active', country: 'US', kinds: ['trade_balance'], type: 'weekly_scrape',
    access: { targets: [{ label: 'calendar_listview', url: 'https://example.invalid/census' }] },
    announce_time_by_kind: { trade_balance: { local_time: '08:30', tz: 'America/New_York' } },
  };
  const targetWeek = { targetWeekStart: '2026-10-12', targetWeekEnd: '2026-10-16' };
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => html });
  const result = await checkWeeklyScrapeSource(source, targetWeek, { fetchImpl, eventNames: REAL_EVENT_NAMES });
  assert.equal(result.ok, true);
  assert.equal(result.rawRowCount, 2, 'ページ全体の行数は2件（retail_sales行も含む）として正しく記録される');
  assert.equal(result.thisWeek.length, 0, 'retail_sales行はkinds未登録のため無関係な行として無視される（trade_balanceは対象週に該当日が無い）');
});

// us_census_retail_sales（annual_schedule_config）がscheduleに登録済みの日付を対象週内に持つ場合、
// recurring_checks（schedule_source_id方式）はWARNを出さないことを確認する
test('runChecks: us_census_retail_salesのscheduleに対象週内の日付があればrecurring_checks経由でWARNが出ない', async () => {
  const { runChecks } = await loadHarness();
  const sourcesConfig = {
    sources: [
      {
        id: 'us_census_retail_sales', status: 'active', country: 'US', kinds: ['retail_sales'], type: 'annual_schedule_config',
        announce_time_by_kind: { retail_sales: { local_time: '08:30', tz: 'America/New_York' } },
        schedule: [{ date: '2026-10-15', kind: 'retail_sales', note: '2026年9月分' }],
      },
    ],
  };
  const importanceRules = {
    recurring_checks: [{ name: '米小売売上高', schedule_source_id: 'us_census_retail_sales', rule: 'scheduleの日付に基づく', action: 'WARN' }],
  };
  const targetWeek = {
    collectionDate: '2026-10-10', targetWeekStart: '2026-10-12', targetWeekEnd: '2026-10-16',
    dates: [
      { date: '2026-10-12', md: '10/12', weekday: '月' }, { date: '2026-10-13', md: '10/13', weekday: '火' },
      { date: '2026-10-14', md: '10/14', weekday: '水' }, { date: '2026-10-15', md: '10/15', weekday: '木' },
      { date: '2026-10-16', md: '10/16', weekday: '金' },
    ],
  };
  const report = await runChecks({ sourcesConfig, importanceRules, targetWeek, eventNames: REAL_EVENT_NAMES });
  assert.equal(report.recurringMissingWarnings.length, 0, JSON.stringify(report.recurringMissingWarnings));
});

// 2026-10-12改訂（しょうさん指摘: 「毎月中旬」の粗い日範囲ヒューリスティックでは実際の発表日の
// 変動[1/14・2/10・3/6・4/1・4/21等]に対して3月・4月等で判定漏れが生じていた）。schedule_source_id
// 方式では「scheduleに対象週内の日付がそもそも無い週」はapplies_this_week自体がfalseになるため、
// 旧方式のような判定漏れ（該当月なのに検出されない）が起きないことを、12月分（未公表のため
// scheduleに未登録）を例に確認する
test('runChecks: us_census_retail_salesのscheduleに対象週内の日付が無い週（例: 12月分未公表）はrecurring_checks自体が該当しないためWARNが出ない', async () => {
  const { runChecks } = await loadHarness();
  const sourcesConfig = {
    sources: [
      {
        id: 'us_census_retail_sales', status: 'active', country: 'US', kinds: ['retail_sales'], type: 'annual_schedule_config',
        announce_time_by_kind: { retail_sales: { local_time: '08:30', tz: 'America/New_York' } },
        // 2026年12月分は未公表のため収録していない想定（しょうさん指示: 推測で埋めない）
        schedule: [{ date: '2026-11-17', kind: 'retail_sales', note: '2026年10月分' }],
      },
    ],
  };
  const importanceRules = {
    recurring_checks: [{ name: '米小売売上高', schedule_source_id: 'us_census_retail_sales', rule: 'scheduleの日付に基づく', action: 'WARN' }],
  };
  const targetWeek = {
    collectionDate: '2026-12-26', targetWeekStart: '2026-12-28', targetWeekEnd: '2027-01-01',
    dates: [
      { date: '2026-12-28', md: '12/28', weekday: '月' }, { date: '2026-12-29', md: '12/29', weekday: '火' },
      { date: '2026-12-30', md: '12/30', weekday: '水' }, { date: '2026-12-31', md: '12/31', weekday: '木' },
      { date: '2027-01-01', md: '1/1', weekday: '金' },
    ],
  };
  const report = await runChecks({ sourcesConfig, importanceRules, targetWeek, eventNames: REAL_EVENT_NAMES });
  assert.equal(report.recurringMissingWarnings.length, 0, JSON.stringify(report.recurringMissingWarnings));
  const status = (await loadHarness()).computeRecurringChecksStatus(report.results, importanceRules, targetWeek, sourcesConfig);
  assert.equal(status[0].applies_this_week, false, '12月分はscheduleに無いためapplies_this_week自体がfalseになる（旧「毎月中旬」方式のような判定漏れではなく、そもそも該当しない週として扱われる）');
});

// 2026-10-12追加（しょうさん指摘: calendar-listview.htmlの年ロールオーバーによりtrade_balanceも
// us_census_trade_balance（annual_schedule_config）へ切り替えた）。米小売売上高と同じ
// schedule_source_id方式のrecurring_checkが正しく機能することを確認する
test('runChecks: us_census_trade_balanceのscheduleに対象週内の日付があればrecurring_checks経由でWARNが出ない', async () => {
  const { runChecks } = await loadHarness();
  const sourcesConfig = {
    sources: [
      {
        id: 'us_census_trade_balance', status: 'active', country: 'US', kinds: ['trade_balance'], type: 'annual_schedule_config',
        announce_time_by_kind: { trade_balance: { local_time: '08:30', tz: 'America/New_York' } },
        schedule: [{ date: '2027-01-07', kind: 'trade_balance', note: '2026年11月分' }],
      },
    ],
  };
  const importanceRules = {
    recurring_checks: [{ name: '米貿易収支', schedule_source_id: 'us_census_trade_balance', rule: 'scheduleの日付に基づく', action: 'WARN' }],
  };
  const targetWeek = {
    collectionDate: '2027-01-02', targetWeekStart: '2027-01-04', targetWeekEnd: '2027-01-08',
    dates: [
      { date: '2027-01-04', md: '1/4', weekday: '月' }, { date: '2027-01-05', md: '1/5', weekday: '火' },
      { date: '2027-01-06', md: '1/6', weekday: '水' }, { date: '2027-01-07', md: '1/7', weekday: '木' },
      { date: '2027-01-08', md: '1/8', weekday: '金' },
    ],
  };
  const report = await runChecks({ sourcesConfig, importanceRules, targetWeek, eventNames: REAL_EVENT_NAMES });
  assert.equal(report.recurringMissingWarnings.length, 0, JSON.stringify(report.recurringMissingWarnings));
});

test('runChecks: us_census_trade_balanceのscheduleに対象週内の日付が無い週（例: 2027年11月分未公表）はWARNが出ない', async () => {
  const { runChecks } = await loadHarness();
  const sourcesConfig = {
    sources: [
      {
        id: 'us_census_trade_balance', status: 'active', country: 'US', kinds: ['trade_balance'], type: 'annual_schedule_config',
        announce_time_by_kind: { trade_balance: { local_time: '08:30', tz: 'America/New_York' } },
        // 2027年11月分・12月分はTBDのため収録していない想定（しょうさん指示: 推測で埋めない）
        schedule: [{ date: '2027-10-06', kind: 'trade_balance', note: '2027年8月分' }],
      },
    ],
  };
  const importanceRules = {
    recurring_checks: [{ name: '米貿易収支', schedule_source_id: 'us_census_trade_balance', rule: 'scheduleの日付に基づく', action: 'WARN' }],
  };
  const targetWeek = {
    collectionDate: '2027-11-29', targetWeekStart: '2027-12-01', targetWeekEnd: '2027-12-05',
    dates: [
      { date: '2027-12-01', md: '12/1', weekday: '月' }, { date: '2027-12-02', md: '12/2', weekday: '火' },
      { date: '2027-12-03', md: '12/3', weekday: '水' }, { date: '2027-12-04', md: '12/4', weekday: '木' },
      { date: '2027-12-05', md: '12/5', weekday: '金' },
    ],
  };
  const report = await runChecks({ sourcesConfig, importanceRules, targetWeek, eventNames: REAL_EVENT_NAMES });
  assert.equal(report.recurringMissingWarnings.length, 0, JSON.stringify(report.recurringMissingWarnings));
});

// 2026-10-12追加（しょうさん指摘）: calendar-listview.htmlはCensusの全経済指標の予定一覧
// であり、ページ全体で1行も解析できない状況は通常ありえない（サイト構造変化の疑い）。
// extractCensusCalendar自体は既に「<tr height="20">行が1件も解析できない＝ok:false」を
// 実装済みだが、この構造的失敗がcheckWeeklyScrapeSource経由でも正しくHOLD/WARNへ
// 接続されることをgb_boe_calendarの抽出0件ルールと同じ考え方の回帰テストとして確認する
test('runChecks: us_censusがページ全体で1行も解析できない場合は構造的失敗（ok:false）としてHOLD/WARNへ接続する（gb_boe_calendarの抽出0件ルールと同じ考え方）', async () => {
  const { runChecks } = await loadHarness();
  // <tr height="20">自体が1件も存在しない（サイト構造変化を想定）
  const html = '<html><body>no rows here</body></html>';
  const sourcesConfig = {
    sources: [
      {
        id: 'us_census', status: 'active', country: 'US', kinds: [], structural_health_sentinel: true, type: 'weekly_scrape',
        access: { targets: [{ label: 'calendar_listview', url: 'https://example.invalid/census' }] },
        recurring_check_refs: [],
      },
    ],
  };
  const importanceRules = { recurring_checks: [] };
  const targetWeek = {
    collectionDate: '2026-10-10', targetWeekStart: '2026-10-12', targetWeekEnd: '2026-10-16',
    dates: [
      { date: '2026-10-12', md: '10/12', weekday: '月' }, { date: '2026-10-13', md: '10/13', weekday: '火' },
      { date: '2026-10-14', md: '10/14', weekday: '水' }, { date: '2026-10-15', md: '10/15', weekday: '木' },
      { date: '2026-10-16', md: '10/16', weekday: '金' },
    ],
  };
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => html });
  const report = await runChecks({ sourcesConfig, importanceRules, targetWeek, fetchImpl, eventNames: REAL_EVENT_NAMES });
  const usCensusResult = report.results.find((r) => r.id === 'us_census');
  assert.equal(usCensusResult.ok, false);
  assert.match(usCensusResult.reason, /構造変化の疑い/);
  assert.ok(report.failures.some((f) => f.sourceId === 'us_census'));
});

// 2026-10-12追加（しょうさん指摘、実インシデントの真因の回帰テスト）: calendar-listview.html
// 自体が別の年（2027年）の予定表へ切り替わっていた実測状態（census-recon-year-rollover-
// 2026-10-12.mjs参照。164行全てが2027年、2026年の行は0件）を再現し、checkWeeklyScrapeSource
// 経由でも構造的失敗（ok:false）として検知されることを確認する
test('runChecks: us_censusのページが別の年（2027年）のみを表示している場合も構造的失敗として検知する（実インシデントの真因の回帰テスト）', async () => {
  const { runChecks } = await loadHarness();
  const rows2027 = Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, '0');
    return `<tr height="20"><td height="20"><a href="/retail">Advance Monthly Sales for Retail and Food Services</a></td><td sorttable_customkey="2027${mm}150830">2027</td><td>8:30 AM</td><td>2026</td></tr>`;
  }).join('\n');
  const sourcesConfig = {
    sources: [
      {
        id: 'us_census', status: 'active', country: 'US', kinds: [], structural_health_sentinel: true, type: 'weekly_scrape',
        access: { targets: [{ label: 'calendar_listview', url: 'https://example.invalid/census' }] },
        recurring_check_refs: [],
      },
    ],
  };
  const importanceRules = { recurring_checks: [] };
  const targetWeek = {
    collectionDate: '2026-10-10', targetWeekStart: '2026-10-12', targetWeekEnd: '2026-10-16',
    dates: [
      { date: '2026-10-12', md: '10/12', weekday: '月' }, { date: '2026-10-13', md: '10/13', weekday: '火' },
      { date: '2026-10-14', md: '10/14', weekday: '水' }, { date: '2026-10-15', md: '10/15', weekday: '木' },
      { date: '2026-10-16', md: '10/16', weekday: '金' },
    ],
  };
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => rows2027 });
  const report = await runChecks({ sourcesConfig, importanceRules, targetWeek, fetchImpl, eventNames: REAL_EVENT_NAMES });
  const usCensusResult = report.results.find((r) => r.id === 'us_census');
  assert.equal(usCensusResult.ok, false);
  assert.match(usCensusResult.reason, /別の年を表示している疑い/);
  // kinds:[]のためisExpectedThisWeekはfalseになり、単独失敗ならWARNに留まる（HOLDにしない）
  assert.equal(report.outcome.status, 'WARN');
});

// 2026-09-19追加（しょうさん指摘、9/21週監査で発覚した実バグの回帰テスト）: au_absの
// future-releases-calendarに「Australian National Accounts: Finance and Wealth」
// （家計・法人の資産・負債＝国富統計。GDPとは別のABSリリース）が掲載されている場合、
// classifyRowKind経由でgdp kindに誤分類されないことをcheckWeeklyScrapeSource（実データ経路）で
// 確認する。event-names.jsonのAU/gdp matchを修正するまでは、この行もgdp候補として
// 誤って抽出されていた（au-gdp-2026-09-24として実際に発生した事例）
test('checkWeeklyScrapeSource: 「Australian National Accounts: Finance and Wealth」（別リリース）はgdpに誤分類されない（9/21週監査の回帰テスト）', async () => {
  const { checkWeeklyScrapeSource } = await loadHarness();
  const html = `<div><strong class="event-name">Australian National Accounts: Finance and Wealth</strong><time datetime="2026-09-24T01:30:00Z"></time></div>`;
  const source = {
    id: 'au_abs', status: 'active', country: 'AU', kinds: ['gdp'], type: 'weekly_scrape',
    access: { targets: [{ label: 'future_releases_calendar', url: 'https://example.invalid/abs' }] },
    announce_time_by_kind: { gdp: { local_time: '11:30', tz: 'Australia/Sydney' } },
  };
  const targetWeek = {
    collectionDate: '2026-09-19', targetWeekStart: '2026-09-21', targetWeekEnd: '2026-09-25',
    dates: [
      { date: '2026-09-21', md: '9/21', weekday: '月' }, { date: '2026-09-22', md: '9/22', weekday: '火' },
      { date: '2026-09-23', md: '9/23', weekday: '水' }, { date: '2026-09-24', md: '9/24', weekday: '木' },
      { date: '2026-09-25', md: '9/25', weekday: '金' },
    ],
  };
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => html });
  const result = await checkWeeklyScrapeSource(source, targetWeek, { fetchImpl, eventNames: REAL_EVENT_NAMES });
  assert.equal(result.ok, true);
  assert.deepEqual(result.thisWeek, [], 'Finance and WealthがGDP候補として抽出されてはならない');
  assert.deepEqual(result.foundKinds, []);
  // しょうさん指摘（PR #28マージ後のフォローアップ確認事項1）: 未分類（掲載対象外）のFinance and
  // Wealthが、resolveCandidateEvent失敗によるunregisteredWARN等の形で別途ノイズを出さないことも
  // 確認する。classifyRowKindがnullを返した行はresolveCandidateEventに到達する前にスキップされる
  // 設計（harness.mjsのcheckWeeklyScrapeSource参照）のため、unregisteredは空のままになるはず
  assert.deepEqual(result.unregistered, [], 'kind不一致の行はunregistered等のWARN経路にも一切乗らないはず');
});

// 2026-10-03追加（しょうさん指摘: 9/28週で2026-10-01発表の貿易収支『International Trade in
// Goods, August 2026』が未検出だった、取りこぼしの再発防止用回帰テスト）。真因はfuture-releases-
// calendar（デフォルトページ）の掲載horizonが変動すること（キーワード不一致ではない。GitHub
// Actions実測で確認済み）。対策としてau_absをbuildTargets方式（月指定URL）へ変更した。
// このテストは次回該当分（2026-11-05発表、対象週2026-11-02）を題材に、(a)対象週の月に応じた
// 正しいURLが構築されること、(b)デフォルトページには載っていない（horizon外を模した）状況でも
// 月指定ページから正しく検出できることの両方を確認する
test('checkWeeklyScrapeSource: au_absは対象週の月指定URL（/future-releases-calendar/YYYYMM）から貿易収支を検出する（2026-11-05分、9/28週取りこぼしの回帰テスト）', async () => {
  const { checkWeeklyScrapeSource } = await loadHarness();
  const source = {
    id: 'au_abs', status: 'active', country: 'AU', kinds: ['trade_balance'], type: 'weekly_scrape',
    access: {
      robots_check: true,
      month_url_pattern: 'https://www.abs.gov.au/release-calendar/future-releases-calendar/{YEAR}{MONTH}',
      targets: [{ label: 'future_releases_calendar', url: 'https://www.abs.gov.au/release-calendar/future-releases-calendar' }],
    },
    announce_time_by_kind: { trade_balance: { local_time: '11:30', tz: 'Australia/Sydney' } },
  };
  const robotsChecker = { isAllowed: async () => ({ allowed: true }) };
  // デフォルトページはhorizon不足で10月分の無関係イベントしか載っていない状況を模す
  // （9/28週取りこぼし時の実際の状況）。月指定ページ（/202611）のみに11/5の貿易収支を含める
  const defaultPageHtml = '<div><strong class="event-name">Consumer Price Index, Australia</strong><time datetime="2026-10-28T00:30:00Z"></time></div>';
  const novemberPageHtml = `
    <div><strong class="event-name">Monthly Household Spending Indicator</strong><time datetime="2026-11-04T00:30:00Z"></time></div>
    <div><strong class="event-name">International Trade in Goods</strong><time datetime="2026-11-05T00:30:00Z"></time></div>
  `;
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(url);
    if (url.endsWith('/202611')) return { ok: true, status: 200, text: async () => novemberPageHtml };
    if (url === 'https://www.abs.gov.au/release-calendar/future-releases-calendar') return { ok: true, status: 200, text: async () => defaultPageHtml };
    return { ok: false, status: 404 };
  };
  const targetWeek = { targetWeekStart: '2026-11-02', targetWeekEnd: '2026-11-06' };
  const r = await checkWeeklyScrapeSource(source, targetWeek, { fetchImpl, robotsChecker, eventNames: REAL_EVENT_NAMES });
  // buildAbsMonthTargetsが対象週の月（2026-11）のみを対象にし、デフォルトページは叩かないはず
  assert.deepEqual(requestedUrls, ['https://www.abs.gov.au/release-calendar/future-releases-calendar/202611']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.foundKinds, ['trade_balance']);
  const tradeBalance = r.thisWeek.find((c) => c.kind === 'trade_balance');
  assert.ok(tradeBalance, 'International Trade in Goods（2026-11-05）がtrade_balanceとして検出されるはず');
  assert.equal(tradeBalance.date, '2026-11-05');
  assert.equal(tradeBalance.time, '09:30'); // 11:30 AEST(UTC+10、夏時間なし) → JST 09:30
});

test('checkWeeklyScrapeSource: au_absは月またぎ週で両月の月指定ページをフェッチし結果をマージする', async () => {
  const { checkWeeklyScrapeSource } = await loadHarness();
  const source = {
    id: 'au_abs', status: 'active', country: 'AU', kinds: ['trade_balance'], type: 'weekly_scrape',
    access: {
      robots_check: true,
      month_url_pattern: 'https://www.abs.gov.au/release-calendar/future-releases-calendar/{YEAR}{MONTH}',
    },
    announce_time_by_kind: { trade_balance: { local_time: '11:30', tz: 'Australia/Sydney' } },
  };
  const robotsChecker = { isAllowed: async () => ({ allowed: true }) };
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(url);
    return { ok: true, status: 200, text: async () => '<div><strong class="event-name">International Trade in Goods</strong><time datetime="2026-12-03T00:30:00Z"></time></div>' };
  };
  // 2026-11-30(月)〜2026-12-04(金): 11月・12月をまたぐ週
  const targetWeek = { targetWeekStart: '2026-11-30', targetWeekEnd: '2026-12-04' };
  const r = await checkWeeklyScrapeSource(source, targetWeek, { fetchImpl, robotsChecker, eventNames: REAL_EVENT_NAMES });
  assert.deepEqual(requestedUrls.sort(), [
    'https://www.abs.gov.au/release-calendar/future-releases-calendar/202611',
    'https://www.abs.gov.au/release-calendar/future-releases-calendar/202612',
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.allCandidatesCount, 2, '同一fixtureを2ページ分解析するため1件×2ページ=2件になるはず');
});

// 2026-10-11新設（しょうさん指摘で発覚した実バグの回帰テスト）: gb_boe_calendarのtoRow
// マッピングがtimeAmbiguous/ambiguousTimeRawをrowからtoRowの戻り値へ渡し忘れており、
// extractBoeCalendar側でフラグを立てても実パイプライン（checkWeeklyScrapeSource経由）では
// 一切伝わらない状態になっていた（scripts/checkers/extractors/boe-calendar.jsの単体テストや
// resolveCandidateEvent単体テストはtoRowを経由しないため、この配線漏れを検出できなかった）。
// 実fixture＋実WEEKLY_SCRAPE_EXTRACTORS登録（toRow含む）を経由して、確定イベント・
// 時刻未確定イベントの両方が最終candidateまで正しく伝わることを確認する
test('checkWeeklyScrapeSource: gb_boe_calendarはtoRow経由でもtimeAmbiguous/ambiguousTimeRawが最終candidateまで伝わる（toRow配線漏れの回帰テスト）', async () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { checkWeeklyScrapeSource } = await loadHarness();
  const html = readFileSync(join(__dirname, 'fixtures', 'official-sources', 'gb_boe_calendar', 'upcoming-events.html'), 'utf8');
  const source = {
    id: 'gb_boe_calendar', status: 'active', country: 'GB', kinds: ['official_speech'], type: 'weekly_scrape',
    access: { robots_check: true, provides_exact_time: true, targets: [{ label: 'upcoming_events', url: 'https://www.bankofengland.co.uk/events/upcoming-events' }] },
    announce_time_by_kind: { official_speech: { tz: 'Europe/London' } },
  };
  const robotsChecker = { isAllowed: async () => ({ allowed: true }) };
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => html });
  const targetWeek = { targetWeekStart: '2026-09-28', targetWeekEnd: '2026-10-02' };
  const r = await checkWeeklyScrapeSource(source, targetWeek, { fetchImpl, robotsChecker, eventNames: [] });
  assert.equal(r.ok, true);

  // Dave Ramsden（説明文に「Bank of England, London」）: タイムゾーン表記は無いが
  // ルール2で時刻確定になるはず。toRow配線漏れがあると候補自体がok:falseで脱落していた
  const ramsden = r.thisWeek.find((c) => c.speakerLastName === 'Dave Ramsden');
  assert.ok(ramsden, JSON.stringify(r.thisWeek));
  assert.equal(ramsden.time, '19:00'); // 11:00 BST(UTC+1、9月) = 10:00 UTC → 19:00 JST
  assert.equal(ramsden.timeAmbiguous, false);

  // Catherine L Mann（9/29、McKinselパネル、説明文に地名無し）: ルール3で時刻未確定になり、
  // candidate.time:null・timeAmbiguous:true・ambiguousTimeRaw:'4pm'がtoRow経由でも
  // 保持されているはず（修正前はtoRowがこれらのフィールドを渡していなかった）
  const mann = r.thisWeek.find((c) => c.speakerLastName === 'Catherine L Mann' && c.date === '2026-09-29');
  assert.ok(mann, JSON.stringify(r.thisWeek));
  assert.equal(mann.time, null);
  assert.equal(mann.timeAmbiguous, true);
  assert.equal(mann.ambiguousTimeRaw, '4pm');
});

// 2026-10-11新設（しょうさん指示: 対象週の金曜(JST)市場クローズ前にかかる発表の取りこぼし対策。
// Katharine Braddick副総裁の実例＝BOE予定ページ上は金曜21:00 BSTの発表だが、JST変換すると
// 翌日(土)05:00になり、対象週（月〜金・JST）の素朴な判定では丸ごと除外されていた）。
// checkWeeklyScrapeSource（gb_boe_calendarの実extractor経由）で、金曜のNY市場クローズ
// （17:00 ET）のJST換算時刻（この週はEDTのため土06:00）より前の候補が、isWeekendSpillover:trueの
// フラグ付きでthisWeekへ含まれることを確認する
test('checkWeeklyScrapeSource: 金曜(JST)市場クローズ前にかかる候補（Braddick副総裁の実例と同型）はisWeekendSpillover:trueで対象週へ含まれる', async () => {
  const { checkWeeklyScrapeSource } = await loadHarness();
  const html = [
    '<title>Upcoming events - w/b 19 October 2026 and 26 October 2026</title>',
    '<div class="page-content">',
    '<h3>Friday 23 October</h3>',
    '<p>Katharine Braddick: <a href="/speech">Speech at a conference, London</a> (9pm BST)</p>',
    '</div>',
    '<h2>Upcoming key publications</h2>',
  ].join('\n');
  const source = {
    id: 'gb_boe_calendar', status: 'active', country: 'GB', kinds: ['official_speech'], type: 'weekly_scrape',
    access: { robots_check: true, provides_exact_time: true, targets: [{ label: 'upcoming_events', url: 'https://www.bankofengland.co.uk/events/upcoming-events' }] },
    announce_time_by_kind: { official_speech: { tz: 'Europe/London' } },
  };
  const robotsChecker = { isAllowed: async () => ({ allowed: true }) };
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => html });
  const targetWeek = { targetWeekStart: '2026-10-19', targetWeekEnd: '2026-10-23' };
  const r = await checkWeeklyScrapeSource(source, targetWeek, { fetchImpl, robotsChecker, eventNames: [] });
  assert.equal(r.ok, true);
  const braddick = r.thisWeek.find((c) => c.speakerLastName === 'Katharine Braddick');
  assert.ok(braddick, JSON.stringify(r.thisWeek));
  assert.equal(braddick.date, '2026-10-24'); // JST変換後は土曜
  assert.equal(braddick.time, '05:00'); // 21:00 BST(UTC+1) → 20:00 UTC → 05:00 JST(翌日)
  assert.equal(braddick.isWeekendSpillover, true);
});

test('checkWeeklyScrapeSource: NY金17:00換算のカットオフより後（土曜日中）の候補は週末スピルオーバーに含めない', () => {
  // カットオフ後（この週はJST土06:00以降）の候補は対象週外として除外されることを、
  // isWithinWeekの拡張条件を直接検証する（土曜09:00は06:00カットオフより後）
  const targetWeek = { targetWeekStart: '2026-10-19', targetWeekEnd: '2026-10-23' };
  const { isWithinWeek } = require('../scripts/lib/dates.js');
  const { weekendSpilloverCutoffJst } = require('../scripts/lib/tz-convert.js');
  const cutoff = weekendSpilloverCutoffJst(targetWeek.targetWeekEnd);
  assert.equal(cutoff.date, '2026-10-24');
  assert.equal(cutoff.time, '06:00');
  const candidateDate = '2026-10-24';
  const candidateTime = '09:00'; // カットオフ(06:00)より後
  const withinExtended = isWithinWeek(candidateDate, targetWeek.targetWeekStart, targetWeek.targetWeekEnd)
    || (candidateDate === cutoff.date && candidateTime <= cutoff.time);
  assert.equal(withinExtended, false);
});

test('checkWeeklyScrapeSource: 時刻未確定(timeAmbiguous)の候補は週末スピルオーバーの対象に含めない（推測で含めない）', async () => {
  const { checkWeeklyScrapeSource } = await loadHarness();
  // BOEの予定ページに土曜の見出しが載る想定の合成fixture。タイムゾーン表記・英国内の手がかりが
  // 無いため時刻未確定（candidate.time===null）になる。週末スピルオーバーの条件（c.time &&
  // c.date===cutoff.date && c.time<=cutoff.time）はtimeが無いと成立しないため、推測で時刻を
  // 補って含めることはしない（対象週(月〜金)にも週末スピルオーバーにも入らず除外される）
  const html = [
    '<title>Upcoming events - w/b 19 October 2026 and 26 October 2026</title>',
    '<div class="page-content">',
    '<h3>Saturday 24 October</h3>',
    '<p>Someone Else: <a href="/speech">Panellist at an overseas conference</a> (11pm)</p>',
    '</div>',
    '<h2>Upcoming key publications</h2>',
  ].join('\n');
  const source = {
    id: 'gb_boe_calendar', status: 'active', country: 'GB', kinds: ['official_speech'], type: 'weekly_scrape',
    access: { robots_check: true, provides_exact_time: true, targets: [{ label: 'upcoming_events', url: 'https://www.bankofengland.co.uk/events/upcoming-events' }] },
    announce_time_by_kind: { official_speech: { tz: 'Europe/London' } },
  };
  const robotsChecker = { isAllowed: async () => ({ allowed: true }) };
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => html });
  const targetWeek = { targetWeekStart: '2026-10-19', targetWeekEnd: '2026-10-23' };
  const r = await checkWeeklyScrapeSource(source, targetWeek, { fetchImpl, robotsChecker, eventNames: [] });
  assert.equal(r.ok, true);
  assert.ok(!r.thisWeek.some((c) => c.speakerLastName === 'Someone Else'), JSON.stringify(r.thisWeek));
});
