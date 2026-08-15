'use strict';
// 観測モード実行スクリプト（scripts/phase1/observation-run.mjs）の合成データ検証。
// 実アクセスはActions上の本番実行（2026-08-15 08:06 JST予定）でのみ行うため、
// ここでは合成report（runChecks()の戻り値と同じ形）で組み立てロジックのみを検証する。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const realEventNames = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'event-names.json'), 'utf8')).entries;
const realSourcesConfig = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'official-sources.json'), 'utf8'));

test('annualEntryToCandidate: announce_time_by_kindのlocal_time+tzからJST時刻を正しく変換する', async () => {
  const { annualEntryToCandidate } = await import('../scripts/phase1/observation-run.mjs');
  const source = {
    id: 'au_rba',
    country: 'AU',
    announce_time_by_kind: { policy_rate: { local_time: '14:30', tz: 'Australia/Sydney' } },
  };
  const importanceRules = { importance_by_kind: { policy_rate: 3 } };
  const c = annualEntryToCandidate({ date: '2026-08-11', kind: 'policy_rate' }, source, importanceRules);
  assert.equal(c.date, '2026-08-11');
  assert.equal(c.time, '13:30'); // AEST(UTC+10)夏時間なし 14:30→JST 13:30
  assert.equal(c.importance, 3);
  assert.equal(c.sourceId, 'au_rba');
});

test('annualEntryToCandidate: announce_time_by_kindが無いkindはtime:nullで返す（構造的に想定されるケース）', async () => {
  const { annualEntryToCandidate } = await import('../scripts/phase1/observation-run.mjs');
  const source = { id: 'x', country: 'XX', announce_time_by_kind: {} };
  const c = annualEntryToCandidate({ date: '2026-08-11', kind: 'unknown_kind' }, source, {});
  assert.equal(c.time, null);
  assert.equal(c.timeNote, 'announce_time_by_kind未設定');
});

test('annualEntryToCandidate: displayNameはnull（naming.js統合はscripts/lib/build-ledger.jsのresolveRuleGeneratedName側の責務）', async () => {
  const { annualEntryToCandidate } = await import('../scripts/phase1/observation-run.mjs');
  const source = {
    id: 'au_rba',
    country: 'AU',
    announce_time_by_kind: { policy_rate: { local_time: '14:30', tz: 'Australia/Sydney' } },
  };
  const c = annualEntryToCandidate({ date: '2026-08-11', kind: 'policy_rate' }, source, { importance_by_kind: { policy_rate: 3 } });
  assert.equal(c.displayName, null);
});

test('annualEntryToCandidate: jp_bojのopinions_summary/minutes_summaryはsource.scheduleからperiodJaを算出する（既刊2週と一致）', async () => {
  const { annualEntryToCandidate } = await import('../scripts/phase1/observation-run.mjs');
  const source = {
    id: 'jp_boj',
    country: 'JP',
    name_ja: '日本銀行（BOJ）',
    announce_time_by_kind: {
      opinions_summary: { local_time: '08:50', tz: 'Asia/Tokyo' },
      minutes_summary: { local_time: '08:50', tz: 'Asia/Tokyo' },
      policy_rate: { local_time: '12:00', tz: 'Asia/Tokyo' },
    },
    schedule: [
      { date: '2026-06-16', kind: 'policy_rate' },
      { date: '2026-07-31', kind: 'policy_rate' },
      { date: '2026-08-05', kind: 'minutes_summary' },
      { date: '2026-08-10', kind: 'opinions_summary' },
      { date: '2026-09-18', kind: 'policy_rate' },
    ],
  };
  const importanceRules = { importance_by_kind: { opinions_summary: 3, minutes_summary: 2 } };

  const opinions = annualEntryToCandidate({ date: '2026-08-10', kind: 'opinions_summary' }, source, importanceRules);
  assert.equal(opinions.periodJa, '7月30・31日開催分');

  const minutes = annualEntryToCandidate({ date: '2026-08-05', kind: 'minutes_summary' }, source, importanceRules);
  assert.equal(minutes.periodJa, '2026年6月15日・16日開催分');
});

test('annualEntryToCandidate: jp_boj以外・opinions/minutes以外のkindはperiodJa:null', async () => {
  const { annualEntryToCandidate } = await import('../scripts/phase1/observation-run.mjs');
  const rbaSource = { id: 'au_rba', country: 'AU', announce_time_by_kind: {}, schedule: [] };
  const c1 = annualEntryToCandidate({ date: '2026-08-11', kind: 'policy_rate' }, rbaSource, {});
  assert.equal(c1.periodJa, null);

  const bojSource = { id: 'jp_boj', country: 'JP', announce_time_by_kind: {}, schedule: [] };
  const c2 = annualEntryToCandidate({ date: '2026-08-11', kind: 'policy_rate' }, bojSource, {});
  assert.equal(c2.periodJa, null);
});

test('buildObservationSummary: thisWeek由来とmatchedEntries由来の候補を統合し、★★★のみ停止窓を計算する', async () => {
  const { buildObservationSummary } = await import('../scripts/phase1/observation-run.mjs');
  const report = {
    targetWeek: { start: '2026-08-17', end: '2026-08-21' },
    outcome: { status: 'OK' },
    residualWarnings: [],
    recurringMissingWarnings: [],
    results: [
      {
        id: 'us_bls_fred',
        ok: true,
        thisWeek: [
          { date: '2026-08-19', time: '21:30', kind: 'cpi', country: 'US', importance: 3, displayName: '消費者物価指数（CPI）' },
        ],
      },
      {
        id: 'au_rba',
        ok: true,
        matchedEntries: [{ date: '2026-08-18', kind: 'policy_rate' }],
      },
      { id: 'nz_statsnz', ok: false, skipped: false, reason: 'テスト用失敗' },
      { id: 'cn_pmi', skipped: true, reason: 'pending_recon' },
    ],
  };
  const sourcesConfig = {
    sources: [
      { id: 'au_rba', country: 'AU', announce_time_by_kind: { policy_rate: { local_time: '14:30', tz: 'Australia/Sydney' } } },
    ],
  };
  const importanceRules = { importance_by_kind: { policy_rate: 3 } };

  const summary = buildObservationSummary(report, sourcesConfig, importanceRules);
  assert.equal(summary.candidateCount, 2);
  assert.equal(summary.star3Count, 2);
  assert.equal(summary.star3TimedCount, 2);
  assert.ok(summary.haltByDate['2026-08-19']);
  assert.ok(summary.haltByDate['2026-08-18']);
  assert.equal(summary.haltByDate['2026-08-19'].windowCount, 1);
  // CPI 21:30 -> 停止開始目安 09:30-17:30（4〜12時間前）
  assert.equal(summary.haltByDate['2026-08-19'].windows[0].displayStart, '09:30');
  assert.equal(summary.haltByDate['2026-08-19'].windows[0].displayEnd, '17:30');
  // skippedは候補に含まれない
  assert.ok(!summary.candidates.some((c) => c.sourceId === 'cn_pmi'));
});

test('buildObservationSummary: manualEventsConfigの対象週内entriesを他ソースと同列の候補として取り込む', async () => {
  const { buildObservationSummary } = await import('../scripts/phase1/observation-run.mjs');
  const report = {
    targetWeek: { start: '2026-08-17', end: '2026-08-21' },
    outcome: { status: 'OK' },
    residualWarnings: [],
    recurringMissingWarnings: [],
    results: [],
  };
  const manualEventsConfig = {
    entries: [
      {
        id: 'rba-testimony-2026-08',
        date: '2026-08-18',
        local_time: '08:30',
        tz: 'Australia/Sydney',
        country: 'AU',
        kind: 'testimony',
        display_name: 'ブロックRBA総裁：下院経済委員会への出席',
        importance: 3,
        source_note: 'aph.gov.au確認',
        registered_by: 'しょうさん',
        registered_at: '2026-08-15',
      },
      {
        id: 'out-of-week',
        date: '2026-09-01',
        local_time: '08:30',
        tz: 'Australia/Sydney',
        country: 'AU',
        kind: 'testimony',
        display_name: '対象週外イベント（含まれてはいけない）',
        importance: 3,
        source_note: 'test',
        registered_by: 'test',
        registered_at: '2026-08-15',
      },
    ],
  };
  const summary = buildObservationSummary(report, { sources: [] }, {}, manualEventsConfig);
  assert.equal(summary.candidateCount, 1);
  assert.equal(summary.candidates[0].sourceId, 'manual');
  assert.equal(summary.candidates[0].displayName, 'ブロックRBA総裁：下院経済委員会への出席');
  assert.ok(!summary.candidates.some((c) => c.displayName?.includes('含まれてはいけない')));
});

// task #38実ネットワーク検証（しょうさん指摘2026-08-15）の回帰テスト: ca_statcanは登録済み
// ソースだったがCPI・GDPがkind未登録のため名称解決できなかった（8/17週のCA CPI=8/17発表分が
// まさにその欠損事例）。config/official-sources.json・config/event-names.jsonの実データを使い、
// annualEntryToCandidate経由でCA CPI/GDPの名称が正しく解決されることを確認する
test('annualEntryToCandidate: CA CPI/GDP(月次)が実configから名称解決できる（8/17週の欠損事例の回帰テスト）', async () => {
  const { annualEntryToCandidate } = await import('../scripts/phase1/observation-run.mjs');
  const source = realSourcesConfig.sources.find((s) => s.id === 'ca_statcan');
  const importanceRules = { importance_by_kind: { cpi: 3, gdp: 3 } };

  const cpiCandidate = annualEntryToCandidate({ date: '2026-08-17', kind: 'cpi' }, source, importanceRules, realEventNames);
  assert.equal(cpiCandidate.displayName, '消費者物価指数（CPI）');
  assert.equal(cpiCandidate.time, '21:30'); // 08:30 America/Toronto(EDT, UTC-4) → JST

  const gdpCandidate = annualEntryToCandidate({ date: '2026-08-28', kind: 'gdp' }, source, importanceRules, realEventNames);
  assert.equal(gdpCandidate.displayName, '国内総生産（GDP）');
});

// task #41-1（しょうさん承認済み国×kindマトリクス）の回帰テスト: FOMC議事録・RBA議事要旨を
// 既存の中銀ソース（新規フェッチ不要・会合日程から固定オフセットで算出）へ追加した。
// 2026-07-29のFOMC会合→米東部時間2026-08-19 14:00の議事録公表は、まさに8/17週の欠損事例
// （しょうさん指摘）そのもの（JST変換すると日付繰り上がりで2026-08-20 03:00になる。下記参照）。
// minutes_summaryはSPEC §4.2の規則生成kindのため、displayNameの解決はannualEntryToCandidate
// （resolveAnnualDictionaryName経由）ではなくresolveRuleGeneratedName（scripts/lib/build-ledger.js）
// の責務（RULE_GENERATED_KINDSにより常にnullを返す。36行目「displayNameはnull」テスト参照）。
// 2026-08-15: 当初annualEntryToCandidate側でdisplayNameを検証する誤ったテストを書いており
// （resolveAnnualDictionaryNameがminutes_summaryを解決しないため失敗）、責務どおりに修正した際、
// c.dateの期待値も誤り（JST日付繰り上がりを考慮していなかった）と判明したため合わせて修正した
test('annualEntryToCandidate + resolveRuleGeneratedName: FOMC議事録（US minutes_summary）が実configから正しく組み立てられる（8/17週の欠損事例の回帰テスト）', async () => {
  const { annualEntryToCandidate } = await import('../scripts/phase1/observation-run.mjs');
  const { resolveRuleGeneratedName } = require('../scripts/lib/build-ledger');
  const source = realSourcesConfig.sources.find((s) => s.id === 'us_frb_policy_rate');
  const importanceRules = { importance_by_kind: { minutes_summary: 2 }, country_overrides: [{ kind: 'minutes_summary', country: 'US', importance: 3 }] };
  const entry = source.schedule.find((e) => e.kind === 'minutes_summary' && e.date === '2026-08-19');
  assert.ok(entry, '2026-08-19のFOMC議事録scheduleエントリが見つからない');
  const c = annualEntryToCandidate(entry, source, importanceRules, realEventNames);
  assert.equal(c.displayName, null); // rule_generated kindのためresolveAnnualDictionaryNameは対象外
  assert.equal(c.time, '03:00'); // 14:00 ET(EDT, UTC-4、8月はサマータイム中) → 翌日03:00 JST
  assert.equal(c.date, '2026-08-20'); // JST変換で日付が繰り上がる（8/17週内・木曜のまま）
  assert.equal(c.importance, 3); // country_overrides（US/minutes_summary）で★★★
  assert.equal(resolveRuleGeneratedName({ kind: c.kind, country: c.country }, null), 'FOMC議事録');
});

test('annualEntryToCandidate + resolveRuleGeneratedName: RBA議事要旨（AU minutes_summary）が実configから正しく組み立てられる', async () => {
  const { annualEntryToCandidate } = await import('../scripts/phase1/observation-run.mjs');
  const { resolveRuleGeneratedName } = require('../scripts/lib/build-ledger');
  const source = realSourcesConfig.sources.find((s) => s.id === 'au_rba');
  const importanceRules = { importance_by_kind: { minutes_summary: 2 } };
  const entry = source.schedule.find((e) => e.kind === 'minutes_summary' && e.date === '2026-08-25');
  assert.ok(entry, '2026-08-25のRBA議事要旨scheduleエントリが見つからない（8/11会合の2週間後）');
  const c = annualEntryToCandidate(entry, source, importanceRules, realEventNames);
  assert.equal(c.displayName, null); // rule_generated kindのためresolveAnnualDictionaryNameは対象外
  assert.equal(c.importance, 2); // country_overrides無し（既定の★★のまま）
  assert.equal(resolveRuleGeneratedName({ kind: c.kind, country: c.country }, null), 'RBA議事要旨');
});

// task #41-1完了分の回帰テスト: ECB Accounts of the monetary policy meeting・BOC Summary of
// Governing Council Deliberationsは、FOMC/RBAと異なり固定オフセット計算ではなく各中銀が単発
// 告知する実日付をWebSearch経由で個別収録した（config/official-sources.jsonの該当notes参照）。
// ここでは収録した実日付の1件が正しく解決されることを確認する
test('annualEntryToCandidate + resolveRuleGeneratedName: ECB議事要旨（EU minutes_summary）が実configから正しく組み立てられる', async () => {
  const { annualEntryToCandidate } = await import('../scripts/phase1/observation-run.mjs');
  const { resolveRuleGeneratedName } = require('../scripts/lib/build-ledger');
  const source = realSourcesConfig.sources.find((s) => s.id === 'ecb_policy_rate');
  const importanceRules = { importance_by_kind: { minutes_summary: 2 } };
  const entry = source.schedule.find((e) => e.kind === 'minutes_summary' && e.date === '2026-08-27');
  assert.ok(entry, '2026-08-27のECB Accounts scheduleエントリが見つからない（accounts索引ページのnext release表記で確認済み）');
  const c = annualEntryToCandidate(entry, source, importanceRules, realEventNames);
  assert.equal(c.displayName, null); // rule_generated kindのためresolveAnnualDictionaryNameは対象外
  assert.equal(c.time, null); // announce_time_by_kind.minutes_summary未設定（公表時刻がWebSearchで確認できなかったため推測値を入れていない）
  assert.equal(resolveRuleGeneratedName({ kind: c.kind, country: c.country }, null), 'ECB議事要旨');
});

test('annualEntryToCandidate + resolveRuleGeneratedName: BOC議事要旨（CA minutes_summary）が実configから正しく組み立てられる', async () => {
  const { annualEntryToCandidate } = await import('../scripts/phase1/observation-run.mjs');
  const { resolveRuleGeneratedName } = require('../scripts/lib/build-ledger');
  const source = realSourcesConfig.sources.find((s) => s.id === 'boc_policy_rate');
  const importanceRules = { importance_by_kind: { minutes_summary: 2 } };
  const entry = source.schedule.find((e) => e.kind === 'minutes_summary' && e.date === '2026-09-16');
  assert.ok(entry, '2026-09-16のBOC Summary scheduleエントリが見つからない（2026-09-02決定分）');
  const c = annualEntryToCandidate(entry, source, importanceRules, realEventNames);
  assert.equal(c.displayName, null); // rule_generated kindのためresolveAnnualDictionaryNameは対象外
  assert.equal(c.time, '02:30'); // 13:30 ET(EDT, UTC-4) → 翌日02:30 JST
  assert.equal(c.date, '2026-09-17'); // JST変換で日付が繰り上がる
  assert.equal(resolveRuleGeneratedName({ kind: c.kind, country: c.country }, null), 'BOC議事要旨');
});

test('renderText: outcome・候補一覧・停止目安を含むテキストを生成する（例外を投げない）', async () => {
  const { buildObservationSummary, renderText } = await import('../scripts/phase1/observation-run.mjs');
  const report = {
    targetWeek: { start: '2026-08-17', end: '2026-08-21' },
    outcome: { status: 'HOLD', reason: 'テスト理由' },
    residualWarnings: [{ id: 'us_ism', reason: 'テストWARN' }],
    recurringMissingWarnings: ['定例欠落テスト'],
    results: [{ id: 'x', skipped: true, reason: 'テスト' }],
  };
  const summary = buildObservationSummary(report, { sources: [] }, {});
  const text = renderText(summary);
  assert.match(text, /HOLD/);
  assert.match(text, /テストWARN/);
  assert.match(text, /定例欠落テスト/);
  assert.match(text, /対象週に時刻判明済みの★★★候補なし/);
});
