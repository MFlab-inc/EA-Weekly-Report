'use strict';
// 既刊2週（2026-08-03週・2026-08-10週）を「収集→台帳→レンダー」の実データ経路で再生成し、
// 既刊ground truthと比較する回帰テスト（task #13後継、しょうさん指示2026-08-15）。
//
// 実アクセスは行わず、test/fixtures/official-sources/の実測fixtureをfetchモックで読み込む
// （test/ground-truth-capture.test.jsと同じ方式）。
//
// 判定基準（しょうさん指示2026-08-15で修正）: 既刊output/*.htmlとのバイト一致ではなく、
// 比較可能な部分集合（既知の差分3分類に属さないイベント）で日時・重要度・名称が一致すること。
// 既知の差分3分類:
//   (a) task #16未実装の3ソース4イベント（中国PMI×2・英建設業PMI・ADP、いずれも抽出未実装＝
//       status pending_recon）
//   (b) 発表枠の束ね未実装（RBA 3件クラスタ・CPI 2件クラスタ・PPI 2件クラスタは各々1枠に束ねず
//       個別windowとして扱う。task #34で別途対応）
//   (c) gb_ons（英GDP）はAPIがrelease-type=type-upcoming固定のため過去週を再現できない
//       （official-sources.jsonのgb_ons notes参照。抽出ロジック自体はtest/harness.test.jsの
//       ONS(gb_ons)テストで別途、未来日程に対して検証済み）
// 上記いずれにも属さない差分が1件でもあれば、レンダラー変更による回帰である
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const FIXTURE_ROOT = join(__dirname, 'fixtures', 'official-sources');
const readFixture = (...p) => readFileSync(join(FIXTURE_ROOT, ...p), 'utf8');

const sourcesConfig = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'official-sources.json'), 'utf8'));
const eventNames = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'event-names.json'), 'utf8')).entries;
const importanceRules = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'importance-rules.json'), 'utf8'));
const manualEventsConfig = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'manual-events.json'), 'utf8'));
const officialsConfig = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'officials.json'), 'utf8'));
const expectedCoverageConfig = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'expected-coverage.json'), 'utf8'));
const eventComments = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'event-comments.json'), 'utf8'));
const reportPolicy = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'report-policy.json'), 'utf8'));
const btcGuide = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'btc-weekend-guide.json'), 'utf8'));
// scripts/phase0/expected-events.jsonのkindフィールドはPhase 0当時の旧kind taxonomy
// （例: employment_situation/employment_indicatorの分割前）のまま更新されておらず信頼できないため
// （jp-boj-summary-2026-08-10も本来opinions_summaryだがminutes_summaryのまま等）、
// 本テストの突合はkindを使わずdate/time/stars/name_ja/country_jaのみで行う
const groundTruth = JSON.parse(readFileSync(join(__dirname, '..', 'scripts', 'phase0', 'expected-events.json'), 'utf8')).events;

const ALLOW_ROBOTS = { isAllowed: async () => ({ allowed: true }) };

// 既知の差分(a): task #16未実装3ソースの4イベント
const KNOWN_GAP_A_IDS = new Set(['cn_ratingdog_mfg_pmi_20260803', 'cn_ratingdog_services_pmi_20260805', 'us_adp_20260805', 'uk_construction_pmi_20260806']);
// 既知の差分(c): gb_ons（英GDP）はAPI仕様上、過去週を再現不可
const KNOWN_GAP_C_IDS = new Set(['uk-gdp-2026-08-13']);
// 束ね未実装(b)の対象（RBA3件・CPI2件・PPI2件）はevent自体は捕捉されるためKNOWN_GAP扱いはしない
// （windowGroupsの粒度のみ既刊と異なる。本テストはイベント一覧の一致を見るためここでは対象外扱い不要）

// 既知の差分(d)（新規発見・2026-08-15）: scripts/phase0/expected-events.jsonのname_jaは
// reference/sample-report_20260808.htmlの生テキストをそのまま転記したもので、2026-08-03週
// （旧・aria-level="4"見出し形式）は国名・対象期間をイベント名の文字列に直接埋め込んでいた
// （例:「カナダ・国際商品貿易（2026年6月）」）。しかし実際に採用されたv4レンダラー（design-mock_v1.2.html・
// task #12）は国名を別要素（国ピル）として表示し、辞書照合（config/event-names.json）のdisplay_nameには
// 対象期間を含めない設計（event-names.jsonの_comment「display_nameは対象期間を含まない基底形」を参照）。
// これはscripts/render/week-data-20260803.js（実際にレンダリングされた入力・手動キュレーション済み）の
// displayName値と照合して確認した（例: ca_goods_trade_20260804のdisplayNameは'国際商品貿易'であって
// 'カナダ・国際商品貿易（2026年6月）'ではない）。よって本テストの正解データは、辞書解決kindについては
// event-names.jsonのdisplay_name（=week-data-*.jsの実値）を使い、expected-events.jsonの完全文字列は
// 使わない。us_cook_speech_20260805のみ別理由（verified:falseロールオンリー方針、既存判断）で上書きする
const NAME_OVERRIDE = {
  us_ism_mfg_20260803: 'ISM製造業景況指数',
  ca_goods_trade_20260804: '国際商品貿易',
  us_trade_20260804: '貿易収支',
  us_jolts_20260804: 'JOLTS求人・離職動向調査',
  nz_labour_q2_20260805: '雇用統計',
  us_ism_services_20260805: 'ISM非製造業景況指数',
  au_trade_20260806: '貿易収支',
  ca_labour_20260807: '雇用統計',
  us_employment_situation_20260807: '雇用統計：非農業部門雇用者数・失業率・平均時給',
  ca_ivey_pmi_20260807: 'Ivey購買部協会景況指数',
  // official_speech: Cook理事はofficials.json未登録（task #17）のため、SPEC §4.2の
  // 「verified:falseは役職のみ」規則どおり役職のみで命名する（既存の週データ・naming.test.jsと同じ判断）
  us_cook_speech_20260805: 'FRB理事の発言',
};

function expectedNameOf(g) {
  return NAME_OVERRIDE[g.id] || g.name_ja;
}

function fixtureFetch(map) {
  return async (url) => {
    const hit = Object.entries(map).find(([pattern]) => url.includes(pattern));
    if (!hit) return { ok: false, status: 404 };
    const [, body] = hit;
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
  };
}

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
    const body = readFixture('us_census', 'calendar_listview.html');
    return { ok: true, status: 200, text: async () => body };
  }
  if (url.includes('future-releases-calendar')) {
    const body = readFixture('au_abs', 'future_releases_calendar.html');
    return { ok: true, status: 200, text: async () => body };
  }
  if (url.includes('2608e.htm')) {
    const body = readFixture('jp_mof', 'auction_calendar_2608.html');
    return { ok: true, status: 200, text: async () => body };
  }
  if (url.includes('feeds/speeches.xml')) {
    const body = readFixture('us_frb_speeches', 'speeches_rss.xml');
    return { ok: true, status: 200, text: async () => body };
  }
  if (url.includes('labour-market-statistics')) {
    const body = readFixture('nz_statsnz', 'TEMP_ground_truth_validation_prior_quarter.html');
    return { ok: true, status: 200, text: async () => body };
  }
  if (url.includes('search/releases')) {
    const body = readFixture('gb_ons', 'releases_api_upcoming_gdp.json');
    return { ok: true, status: 200, text: async () => body };
  }
  return { ok: false, status: 404 };
}

function targetWeekOf(startStr, endStr, dateStrs) {
  return { collectionDate: dateStrs[0], targetWeekStart: startStr, targetWeekEnd: endStr, dates: dateStrs.map((date) => ({ date })) };
}

const WEEK_20260803 = targetWeekOf('2026-08-03', '2026-08-07', ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07']);
const WEEK_20260810 = targetWeekOf('2026-08-10', '2026-08-14', ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']);

async function regenerateWeek(targetWeek) {
  const { collect } = await import('../scripts/collect.mjs');
  const { buildLedgerFromCollectResult } = await import('../scripts/build-ledger.mjs');
  const { validateLedger } = require('../scripts/lib/validate-ledger');

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

function findGtByDateName(ledgerEvent) {
  return groundTruth.find((g) => g.date === ledgerEvent.date_jst && g.name_ja === ledgerEvent.name_ja);
}

test('既刊2週の実データ経路再生成: 2026-08-03週', async () => {
  const ledger = await regenerateWeek(WEEK_20260803);
  const weekGt = groundTruth.filter((g) => g.week === '2026-08-03');
  const capturableGt = weekGt.filter((g) => !KNOWN_GAP_A_IDS.has(g.id) && !KNOWN_GAP_C_IDS.has(g.id));

  for (const g of capturableGt) {
    const expectedName = expectedNameOf(g);
    const ev = ledger.events.find((e) => e.date_jst === g.date && e.name_ja === expectedName);
    assert.ok(ev, `捕捉できていないイベント: ${g.id} (期待名="${expectedName}")`);
    assert.equal(ev.importance, g.stars, `重要度不一致: ${g.id}`);
    if (g.time) assert.equal(ev.datetime_jst?.slice(11, 16), g.time, `時刻不一致: ${g.id}`);
    else assert.equal(ev.datetime_jst, null, `時刻未公表のはず: ${g.id}`);
  }

  // 既知の差分(a): task #16未実装3ソースのうち週内対象（中国PMI×2・ADP）は正しく不在（黙って誤った値を
  // 出すのではなく、まさにその欠落自体が既知のギャップであることの確認）
  for (const gapId of ['cn_ratingdog_mfg_pmi_20260803', 'cn_ratingdog_services_pmi_20260805', 'us_adp_20260805']) {
    const g = groundTruth.find((x) => x.id === gapId);
    const found = ledger.events.some((e) => e.date_jst === g.date && e.name_ja === expectedNameOf(g));
    assert.equal(found, false, `既知のギャップのはずが捕捉されている: ${gapId}（config/official-sources.jsonのstatusが変わった？）`);
  }
  const gUk = groundTruth.find((x) => x.id === 'uk_construction_pmi_20260806');
  assert.equal(ledger.events.some((e) => e.date_jst === gUk.date && e.name_ja === expectedNameOf(gUk)), false, '既知のギャップのはずが捕捉されている: uk_construction_pmi_20260806');
});

test('既刊2週の実データ経路再生成: 2026-08-10週（naming.js規則生成命名の実配線確認）', async () => {
  const ledger = await regenerateWeek(WEEK_20260810);
  const weekGt = groundTruth.filter((g) => g.week === '2026-08-10');
  const capturableGt = weekGt.filter((g) => !KNOWN_GAP_A_IDS.has(g.id) && !KNOWN_GAP_C_IDS.has(g.id));

  for (const g of capturableGt) {
    const expectedName = expectedNameOf(g);
    const ev = ledger.events.find((e) => e.date_jst === g.date && e.name_ja === expectedName);
    assert.ok(ev, `捕捉できていないイベント: ${g.id} (期待名="${expectedName}")`);
    assert.equal(ev.importance, g.stars, `重要度不一致: ${g.id}`);
    assert.equal(ev.datetime_jst?.slice(11, 16), g.time, `時刻不一致: ${g.id}`);
    // 規則生成命名（naming.js、この一連のタスクで新設・配線）で解決されたことの確認
    // （name_resolution='dictionary'のcandidate.displayName直接指定ではなく、
    // resolveRuleGeneratedName経由であることを明示的に確認する）
    if (['au-rba-rate-2026-08-11', 'au-rba-smp-2026-08-11', 'au-rba-press-2026-08-11', 'jp-boj-summary-2026-08-10'].includes(g.id)) {
      assert.equal(ev.name_resolution, 'rule_generated', `規則生成命名で解決されるはず: ${g.id}`);
    }
  }

  // 既知の差分(c): gb_ons（英GDP）は正しく不在（API仕様上の制約。official-sources.jsonのgb_ons notes参照）
  const gGdp = groundTruth.find((x) => x.id === 'uk-gdp-2026-08-13');
  assert.equal(ledger.events.some((e) => e.date_jst === gGdp.date && e.name_ja === expectedNameOf(gGdp)), false, 'gb_onsのAPI仕様上、既知のギャップのはず（捕捉されていたら要再調査）');
});

test('既刊2週の実データ経路再生成→レンダリングまで通し、HTMLを生成できる（既知の差分レビュー用）', async () => {
  const { ledgerToWeekInput } = require('../scripts/render/ledger-to-week-input');
  const { buildReportData } = require('../scripts/render/build-report-data');
  const { renderReportHtml } = require('../scripts/render/html-renderer');

  // 生成HTMLはコミット対象外のスクラッチ出力（レビュー用）。存在しない/書き込み不可な環境では
  // 後続のtry/catchで黙って諦める（CI等ではスクラッチディレクトリが無いこともあるため）
  const outDir = process.env.EA_REGEN_OUTPUT_DIR || join(require('node:os').tmpdir(), 'ea-weekly-regen-output');
  const results = [];
  for (const [targetWeek, narrative] of [
    [WEEK_20260803, { reportMeta: 'ea-weekly-20260803', createdDateJa: '2026年8月1日（土）', heroSummary: 'ISM製造業・非製造業、NZ雇用統計、豪州貿易収支、カナダ・米雇用統計を確認する週', heroPills: ['ISM製造業 8/3', 'NZ雇用統計 8/5', '米雇用統計 8/7'] }],
    [WEEK_20260810, { reportMeta: 'ea-weekly-20260810', createdDateJa: '2026年8月8日（土）', heroSummary: 'RBA政策判断、米CPI・PPI、英国GDP、米小売売上高を確認する週', heroPills: ['RBA政策金利 8/11', '米CPI 8/12', '米小売売上高 8/14'] }],
  ]) {
    const ledger = await regenerateWeek(targetWeek);
    const weekInput = ledgerToWeekInput(ledger, narrative, eventComments);
    const reportData = buildReportData(weekInput);
    const html = renderReportHtml(reportData, { reportPolicy, btcGuide });
    assert.ok(html.length > 1000, 'HTMLが生成されるはず');
    results.push({ targetWeekStart: targetWeek.targetWeekStart, html });
  }

  try {
    mkdirSync(outDir, { recursive: true });
    for (const r of results) writeFileSync(join(outDir, `ea-weekly-${r.targetWeekStart.replace(/-/g, '')}.regen.html`), r.html);
  } catch {
    // scratch出力の保存に失敗しても（読み取り専用環境等）テスト自体は成立させる
  }
});
