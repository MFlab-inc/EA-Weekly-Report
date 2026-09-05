'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildLedger, candidateToLedgerEvent, resolveRuleGeneratedName, resolveOfficialSpeechImportance, computeBundleIds, makeEventId, minutesToJstIso } = require('../scripts/lib/build-ledger');
const { validateLedger } = require('../scripts/lib/validate-ledger');

const officials = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'officials.json'), 'utf8')).officials;

test('minutesToJstIso: 正の分は当日、負の分は前日のISO日時になる', () => {
  assert.equal(minutesToJstIso('2026-08-18', 90), '2026-08-18T01:30:00+09:00');
  assert.equal(minutesToJstIso('2026-08-18', -30), '2026-08-17T23:30:00+09:00');
});

test('makeEventId: 同一country-kind-dateの衝突時は連番を付与する', () => {
  const used = new Set();
  const id1 = makeEventId({ country: 'US', kind: 'cpi', date: '2026-08-19' }, used);
  const id2 = makeEventId({ country: 'US', kind: 'cpi', date: '2026-08-19' }, used);
  assert.equal(id1, 'us-cpi-2026-08-19');
  assert.equal(id2, 'us-cpi-2026-08-19-2');
});

test('candidateToLedgerEvent: importance=3・時刻確定はhalt_windowを計算する', () => {
  const used = new Set();
  const candidate = {
    date: '2026-08-18', time: '13:30', kind: 'policy_rate', country: 'AU', importance: 3,
    displayName: 'RBA政策金利＆声明発表', sourceId: 'au_rba', sourceEvidence: 'ground truth一致確認済み',
    localDate: '2026-08-18', localTime: '14:30', tz: 'Australia/Sydney',
  };
  const ev = candidateToLedgerEvent(candidate, used);
  assert.equal(ev.event_id, 'au-policy_rate-2026-08-18');
  assert.equal(ev.datetime_jst, '2026-08-18T13:30:00+09:00');
  assert.equal(ev.time_status, 'published');
  assert.equal(ev.currency, 'AUD');
  assert.equal(ev.name_resolution, 'dictionary');
  assert.equal(ev.halt_window_start_jst, '2026-08-18T01:30:00+09:00');
  assert.equal(ev.halt_window_end_jst, '2026-08-18T09:30:00+09:00');
});

test('candidateToLedgerEvent: displayName未解決・officials未指定はFALLBACK_KIND_LABELを使いrule_generatedになる', () => {
  const used = new Set();
  const candidate = {
    date: '2026-08-18', time: '09:30', kind: 'press_conference', country: 'CH', importance: 3,
    displayName: null, sourceId: 'snb_policy_rate', sourceEvidence: 'SNB event-schedule抽出',
  };
  const ev = candidateToLedgerEvent(candidate, used);
  assert.equal(ev.name_ja, '記者会見');
  assert.equal(ev.name_resolution, 'rule_generated');
});

test('candidateToLedgerEvent: displayName未解決・officials指定時はnaming.jsの規則生成命名を使う（SPEC §4.2）', () => {
  const used = new Set();
  const rateCandidate = {
    date: '2026-08-18', time: '09:30', kind: 'policy_rate', country: 'CH', importance: 3,
    displayName: null, sourceId: 'snb_policy_rate', sourceEvidence: 'SNB event-schedule抽出',
  };
  const rateEv = candidateToLedgerEvent(rateCandidate, used, officials);
  assert.equal(rateEv.name_ja, 'SNB政策金利＆声明発表');
  assert.equal(rateEv.name_resolution, 'rule_generated');

  const pressCandidate = {
    date: '2026-08-18', time: '10:00', kind: 'press_conference', country: 'CH', importance: 3,
    displayName: null, sourceId: 'snb_policy_rate', sourceEvidence: 'SNB event-schedule抽出',
  };
  const pressEv = candidateToLedgerEvent(pressCandidate, used, officials);
  assert.equal(pressEv.name_ja, 'シュレーゲルSNB総裁の記者会見');
  assert.equal(pressEv.name_resolution, 'rule_generated');
});

// task #84（2026-08-30、しょうさん指摘: 8/31週監査でRBNZ・BOC総裁記者会見★★★の不検出を発見）。
// config/official-sources.jsonのrbnz_policy_rate/boc_policy_rateへpress_conference kindを追加した
// 回帰テスト。SNB同様officials.jsonの登録済み総裁（NZ=ブレマン、CA=マックレム）で解決できることを確認する
test('candidateToLedgerEvent: press_conference（NZ・CA）もofficials.json登録済み総裁で解決する（task #84）', () => {
  const used = new Set();
  const nzCandidate = {
    date: '2026-09-02', time: '12:00', kind: 'press_conference', country: 'NZ', importance: 3,
    displayName: null, sourceId: 'rbnz_policy_rate', sourceEvidence: 'RBNZ年次確定スケジュール',
  };
  const nzEv = candidateToLedgerEvent(nzCandidate, used, officials);
  assert.equal(nzEv.name_ja, 'ブレマンRBNZ総裁の記者会見');
  assert.equal(nzEv.name_resolution, 'rule_generated');

  const caCandidate = {
    date: '2026-09-02', time: '23:30', kind: 'press_conference', country: 'CA', importance: 3,
    displayName: null, sourceId: 'boc_policy_rate', sourceEvidence: 'BOC年次確定スケジュール',
  };
  const caEv = candidateToLedgerEvent(caCandidate, used, officials);
  assert.equal(caEv.name_ja, 'マックレムBOC総裁の記者会見');
  assert.equal(caEv.name_resolution, 'rule_generated');
});

test('resolveRuleGeneratedName: bond_auction（tenorJa無し）・official_speech（US以外）は未対応でnullを返す', () => {
  assert.equal(resolveRuleGeneratedName({ kind: 'bond_auction', country: 'JP' }, officials), null, 'tenorJaが無いbond_auction');
  assert.equal(resolveRuleGeneratedName({ kind: 'official_speech', country: 'JP' }, officials), null, 'US以外のofficial_speech（役職ラベル未定義）');
});

test('resolveRuleGeneratedName: opinions_summary/minutes_summary（BOJ）はperiodJaがあれば会合開催日を含めて解決する', () => {
  assert.equal(
    resolveRuleGeneratedName({ kind: 'opinions_summary', country: 'JP', periodJa: '7月30・31日開催分' }, officials),
    '日銀金融政策決定会合における主な意見の公表（7月30・31日開催分）'
  );
  assert.equal(
    resolveRuleGeneratedName({ kind: 'minutes_summary', country: 'JP', periodJa: '2026年6月15日・16日開催分' }, officials),
    '金融政策決定会合議事要旨（2026年6月15日・16日開催分）'
  );
});

test('resolveRuleGeneratedName: opinions_summary/minutes_summary（BOJ）はperiodJa無しでも基底文言を返す（FALLBACK_KIND_LABELより優先）', () => {
  assert.equal(resolveRuleGeneratedName({ kind: 'opinions_summary', country: 'JP' }, officials), '日銀金融政策決定会合における主な意見の公表');
  assert.equal(resolveRuleGeneratedName({ kind: 'minutes_summary', country: 'JP' }, officials), '金融政策決定会合議事要旨');
});

test('resolveRuleGeneratedName: opinions_summary（SNB等JP以外）はBOJ固有テンプレート対象外でnullを返す', () => {
  assert.equal(resolveRuleGeneratedName({ kind: 'opinions_summary', country: 'CH' }, officials), null);
});

test('resolveRuleGeneratedName: bond_auction（tenorJaあり）は国別テンプレートで解決する', () => {
  assert.equal(
    resolveRuleGeneratedName({ kind: 'bond_auction', country: 'JP', date: '2026-08-04', tenorJa: '10年' }, officials),
    '10年利付国債（2026年8月債）の入札'
  );
  assert.equal(
    resolveRuleGeneratedName({ kind: 'bond_auction', country: 'US', date: '2026-08-19', tenorJa: '10年' }, officials),
    '米10年債入札'
  );
});

test('resolveRuleGeneratedName: official_speech（US）は未登録話者なら役職ラベルのみ、登録済み話者なら本人名で返す', () => {
  // 「Cook」は2026-09-06（task #17）でofficials.jsonへ登録済みになったため、本人名で解決される
  assert.equal(resolveRuleGeneratedName({ kind: 'official_speech', country: 'US', speakerLastName: 'Cook' }, officials), 'クックFRB理事の発言');
  // 未登録話者（本ファイルに存在しない架空の姓）は役職のみのフォールバックのまま
  assert.equal(resolveRuleGeneratedName({ kind: 'official_speech', country: 'US', speakerLastName: 'NonexistentSurname' }, officials), 'FRB理事の発言');
  assert.equal(resolveRuleGeneratedName({ kind: 'official_speech', country: 'US', speakerLastName: null }, officials), 'FRB理事の発言');
});

// task #64（しょうさん指摘、Manus版8/24週突合）の回帰テスト: jp_boj_speeches新設に伴い、
// BOJの話者はofficials.json登録者本人のrole_ja（例:「日銀副総裁」）を使う設計へ変更した
// （US=OFFICIAL_SPEECH_ROLE_BY_COUNTRYの国単位固定ラベルとは異なる経路）
test('resolveRuleGeneratedName: official_speech（JP・officials.json登録済みの氷見野副総裁）は本人のrole_jaで解決する', () => {
  assert.equal(
    resolveRuleGeneratedName({ kind: 'official_speech', country: 'JP', speakerLastName: '氷見野' }, officials),
    '氷見野日銀副総裁の発言'
  );
});

// task #88（2026-08-30、しょうさん指摘: BOEの同姓問題を受けた横断監査でBOJのもう1名の
// 副総裁「内田」が未登録と判明したため登録した）の回帰テスト
test('resolveRuleGeneratedName: official_speech（JP・officials.json登録済みの内田副総裁）は本人のrole_jaで解決する', () => {
  assert.equal(
    resolveRuleGeneratedName({ kind: 'official_speech', country: 'JP', speakerLastName: '内田' }, officials),
    '内田日銀副総裁の発言'
  );
});

test('resolveRuleGeneratedName: official_speech（JP・未登録話者）はOFFICIAL_SPEECH_ROLE_BY_COUNTRYにJPが無いためnullを返す（FALLBACK_KIND_LABEL「要人発言」へ）', () => {
  // 「田村」は2026-09-06（task #17フォローアップ）でofficials.jsonへ登録済みになったため、
  // ここでは未登録話者の例として別の（本ファイル内に存在しない）姓「神山」を使う
  assert.equal(resolveRuleGeneratedName({ kind: 'official_speech', country: 'JP', speakerLastName: '神山' }, officials), null);
  assert.equal(resolveRuleGeneratedName({ kind: 'official_speech', country: 'JP', speakerLastName: null }, officials), null);
});

// task #17フォローアップ（2026-09-06、しょうさん指摘: BOJ政策委員会6審議委員の一括登録）の回帰テスト
test('resolveRuleGeneratedName: official_speech（JP・登録済みの6審議委員）は各人のrole_jaで解決する', () => {
  const cases = [
    ['高田', '高田日銀審議委員の発言'],
    ['田村', '田村日銀審議委員の発言'],
    ['小枝', '小枝日銀審議委員の発言'],
    ['増', '増日銀審議委員の発言'],
    ['浅田', '浅田日銀審議委員の発言'],
    ['佐藤', '佐藤日銀審議委員の発言'],
  ];
  for (const [speakerLastName, want] of cases) {
    assert.equal(resolveRuleGeneratedName({ kind: 'official_speech', country: 'JP', speakerLastName }, officials), want);
  }
});

// task #68（しょうさん指摘: 一律★★★は不採用、話者の格[role_rank]に応じて重要度を決める）の回帰テスト
test('resolveOfficialSpeechImportance: official_speech以外はcandidate.importanceをそのまま素通しする', () => {
  assert.deepEqual(resolveOfficialSpeechImportance({ kind: 'policy_rate', importance: 3 }, officials), { importance: 3, warning: null });
});

test('resolveOfficialSpeechImportance: governor（日銀総裁・植田）は★★★、warningは無い', () => {
  const r = resolveOfficialSpeechImportance({ kind: 'official_speech', country: 'JP', speakerLastName: '植田', date: '2026-08-27' }, officials);
  assert.deepEqual(r, { importance: 3, warning: null });
});

test('resolveOfficialSpeechImportance: deputy_governor（日銀副総裁・氷見野）は★★★、warningは無い', () => {
  const r = resolveOfficialSpeechImportance({ kind: 'official_speech', country: 'JP', speakerLastName: '氷見野', date: '2026-08-27' }, officials);
  assert.deepEqual(r, { importance: 3, warning: null });
});

test('resolveOfficialSpeechImportance: deputy_governor（日銀副総裁・内田）は★★★、warningは無い（task #88）', () => {
  const r = resolveOfficialSpeechImportance({ kind: 'official_speech', country: 'JP', speakerLastName: '内田', date: '2026-08-27' }, officials);
  assert.deepEqual(r, { importance: 3, warning: null });
});

test('resolveOfficialSpeechImportance: 未登録話者（神山理事等）は安全側で★★、warningを添える', () => {
  // 「田村」は2026-09-06（task #17フォローアップ）でofficials.jsonへ登録済みになったため、
  // ここでは未登録話者の例として別の姓「神山」を使う
  const r = resolveOfficialSpeechImportance({ kind: 'official_speech', country: 'JP', speakerLastName: '神山', date: '2026-08-27' }, officials);
  assert.equal(r.importance, 2);
  assert.ok(r.warning && r.warning.includes('神山'), 'warningに話者名を含むべき');
});

// task #17フォローアップ（2026-09-06）の回帰テスト: 6審議委員は全員board_member→★★・warningなし
test('resolveOfficialSpeechImportance: board_member（BOJ審議委員6名）は★★、warningは無い', () => {
  for (const speakerLastName of ['高田', '田村', '小枝', '増', '浅田', '佐藤']) {
    const r = resolveOfficialSpeechImportance({ kind: 'official_speech', country: 'JP', speakerLastName, date: '2026-09-10' }, officials);
    assert.deepEqual(r, { importance: 2, warning: null }, `speakerLastName=${speakerLastName}`);
  }
});

// task #17フォローアップ（しょうさん強調指摘）: 姓が一文字「増」の誤マッチ耐性の回帰テスト。
// naming.resolveOfficialBySurnameを前方一致(startsWith)へ是正したことで、他の登録者
// （植田・内田・氷見野・高田・田村・小枝・浅田・佐藤）のいずれのfull_nameも「増」で始まらず
// 誤マッチしないことを確認する。また「増」を含むが先頭ではない架空の姓（例:「小増」）や、
// 「増」を含む無関係な語（例:「増加」＝経済指標の説明文などに現れうる一般語）が
// 誤って「増一行」に解決されないことも確認する
test('resolveOfficialSpeechImportance/resolveRuleGeneratedName: 一文字姓「増」は増一行にのみ解決し、無関係な文字列には誤マッチしない（task #17フォローアップ）', () => {
  const r = resolveOfficialSpeechImportance({ kind: 'official_speech', country: 'JP', speakerLastName: '増', date: '2026-09-10' }, officials);
  assert.deepEqual(r, { importance: 2, warning: null });
  assert.equal(
    resolveRuleGeneratedName({ kind: 'official_speech', country: 'JP', speakerLastName: '増' }, officials),
    '増日銀審議委員の発言'
  );
  // 「増」を含むが前方一致しない候補は誰にも解決されない（安全側フォールバック）
  for (const speakerLastName of ['小増', '増加', '未増']) {
    assert.equal(
      resolveRuleGeneratedName({ kind: 'official_speech', country: 'JP', speakerLastName }, officials),
      null,
      `speakerLastName=${speakerLastName}は誰にも誤マッチしてはいけない`
    );
  }
});

test('resolveOfficialSpeechImportance: 話者未指定（speakerLastName null）も安全側で★★、warningを添える', () => {
  const r = resolveOfficialSpeechImportance({ kind: 'official_speech', country: 'US', speakerLastName: null, date: '2026-08-06' }, officials);
  assert.equal(r.importance, 2);
  assert.ok(r.warning && r.warning.includes('話者不明'));
});

test('resolveOfficialSpeechImportance: FRB議長（governor・Warsh、RSSタイトルは英語姓）は★★★', () => {
  const r = resolveOfficialSpeechImportance({ kind: 'official_speech', country: 'US', speakerLastName: 'Warsh', date: '2026-08-06' }, officials);
  assert.deepEqual(r, { importance: 3, warning: null });
});

test('resolveRuleGeneratedName: BANK_ABBR_BY_COUNTRY未収録の国はnullを返す', () => {
  assert.equal(resolveRuleGeneratedName({ kind: 'policy_rate', country: 'ZZ' }, officials), null);
});

test('candidateToLedgerEvent: 時刻未公表はtime_status=unpublished・halt_windowはnull', () => {
  const used = new Set();
  const candidate = {
    date: '2026-08-19', time: null, kind: 'testimony', country: 'AU', importance: 3,
    displayName: 'ブロックRBA総裁：下院経済委員会への出席', sourceId: 'manual', sourceEvidence: 'aph.gov.au確認',
  };
  const ev = candidateToLedgerEvent(candidate, used);
  assert.equal(ev.time_status, 'unpublished');
  assert.equal(ev.datetime_jst, null);
  assert.equal(ev.halt_window_start_jst, null);
  assert.equal(ev.halt_window_end_jst, null);
});

test('candidateToLedgerEvent: importance=2はhalt_windowを計算しない', () => {
  const used = new Set();
  const candidate = {
    date: '2026-08-19', time: '23:00', kind: 'employment_indicator', country: 'US', importance: 2,
    displayName: 'JOLTS求人件数', sourceId: 'us_bls_fred', sourceEvidence: 'FRED release_id=192',
  };
  const ev = candidateToLedgerEvent(candidate, used);
  assert.equal(ev.halt_window_start_jst, null);
  assert.equal(ev.halt_window_end_jst, null);
});

function syntheticReport(overrides = {}) {
  return {
    targetWeek: { start: '2026-08-17', end: '2026-08-21' },
    outcome: { status: 'OK', reasons: [] },
    residualWarnings: [],
    recurringMissingWarnings: [],
    results: [
      {
        id: 'au_rba', ok: true, skipped: false,
        thisWeek: [{ date: '2026-08-18', time: '13:30', kind: 'policy_rate', country: 'AU', importance: 3, displayName: 'RBA政策金利＆声明発表', rawTitle: 'Cash Rate', localDate: '2026-08-18', localTime: '14:30', tz: 'Australia/Sydney' }],
      },
    ],
    ...overrides,
  };
}

function syntheticSourcesConfig() {
  return {
    sources: [
      { id: 'au_rba', type: 'annual_schedule_config', access: { robots_check: true, targets: [{ url: 'https://www.rba.gov.au/schedules-events/board-meeting-schedules.html' }] } },
    ],
  };
}

test('buildLedger: 実データに近い合成入力からスキーマに合格する台帳を組み立てる', () => {
  const report = syntheticReport();
  const sourcesConfig = syntheticSourcesConfig();
  const manualEventsConfig = { entries: [] };
  const candidates = [
    { ...report.results[0].thisWeek[0], sourceId: 'au_rba', sourceEvidence: 'Cash Rate（ground truth一致確認済み）' },
  ];
  const expectedCoverageResult = { required: new Array(8).fill(0), missing: [] };
  const recurringChecksStatus = [{ name: '米雇用統計', applies_this_week: false, found: false }];

  const ledger = buildLedger({
    report, sourcesConfig, manualEventsConfig, candidates, expectedCoverageResult, recurringChecksStatus,
    pipelineVersion: 'test-pipeline-1', generatedAt: '2026-08-15T08:06:00+09:00',
  });

  const r = validateLedger(ledger);
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  assert.equal(ledger.meta.outcome, 'PUBLISH_READY');
  assert.equal(ledger.events.length, 1);
  assert.ok(ledger.sources.some((s) => s.source_id === 'manual'), '手動イベント用のmanualソースが常に追加される');
});

// 2026-08-29追加（しょうさん指摘: weekly.ymlの冪等ガードが「対象週ファイルの存在有無」だけを見て
// いたため、手動実行が先取り生成した週をコード修正後も永久にスキップしてしまう不具合があった）。
// meta.generated_from_commitはこの冪等判定の材料になるため、渡した値がそのままmetaに載ること、
// 未指定時はnullになる（旧形式の台帳・ローカル生成との後方互換）ことを確認する
test('buildLedger: generatedFromCommitを渡すとmeta.generated_from_commitに反映され、未指定時はnullになる', () => {
  const report = syntheticReport();
  const sourcesConfig = syntheticSourcesConfig();
  const base = {
    report, sourcesConfig, manualEventsConfig: { entries: [] },
    candidates: [{ ...report.results[0].thisWeek[0], sourceId: 'au_rba', sourceEvidence: 'Cash Rate（ground truth一致確認済み）' }],
    expectedCoverageResult: { required: new Array(8).fill(0), missing: [] },
    recurringChecksStatus: [], pipelineVersion: 'test-pipeline-1', generatedAt: '2026-08-15T08:06:00+09:00',
  };

  const withCommit = buildLedger({ ...base, generatedFromCommit: '03fcd77b3dcc62205fe446a0c8c7e9f91b206c2e' });
  assert.equal(withCommit.meta.generated_from_commit, '03fcd77b3dcc62205fe446a0c8c7e9f91b206c2e');
  assert.equal(validateLedger(withCommit).ok, true);

  const withoutCommit = buildLedger(base);
  assert.equal(withoutCommit.meta.generated_from_commit, null);
  assert.equal(validateLedger(withoutCommit).ok, true);
});

test('buildLedger: officialsConfigを渡すと規則生成命名（naming.js）がイベントへ反映される', () => {
  const report = syntheticReport({
    results: [
      {
        id: 'au_rba', ok: true, skipped: false,
        thisWeek: [{ date: '2026-08-18', time: '14:30', kind: 'press_conference', country: 'AU', importance: 3, displayName: null, rawTitle: 'Press Conference', localDate: '2026-08-18', localTime: '15:30', tz: 'Australia/Sydney' }],
      },
    ],
  });
  const sourcesConfig = syntheticSourcesConfig();
  const candidates = [
    { ...report.results[0].thisWeek[0], sourceId: 'au_rba', sourceEvidence: 'Press Conference（ground truth一致確認済み）' },
  ];
  const ledger = buildLedger({
    report, sourcesConfig, manualEventsConfig: { entries: [] }, officialsConfig: { officials },
    candidates, expectedCoverageResult: { required: new Array(8).fill(0), missing: [] },
    recurringChecksStatus: [], pipelineVersion: 'test-pipeline-1', generatedAt: '2026-08-15T08:06:00+09:00',
  });
  assert.equal(ledger.events[0].name_ja, 'ブロックRBA総裁の記者会見');
  assert.equal(ledger.events[0].name_resolution, 'rule_generated');
  const r = validateLedger(ledger);
  assert.equal(r.ok, true);
});

// task #34: 発表枠の束ね（bundle_id）。しょうさん確定ルール2026-08-15
// 「同一国×同一source_id×同一日×発表時刻90分以内」を既刊2週の実例で検証する
function ledgerEvent(overrides) {
  return {
    event_id: overrides.event_id,
    country: overrides.country,
    source_id: overrides.source_id,
    date_jst: overrides.date_jst,
    datetime_jst: overrides.datetime_jst,
    bundle_id: null,
    ...overrides,
  };
}

test('computeBundleIds: RBA3件クラスタ（13:30政策金利+13:30四半期報告+14:30会見）が既刊どおり1束になる', () => {
  const events = [
    ledgerEvent({ event_id: 'au-policy_rate-2026-08-11', country: 'AU', source_id: 'au_rba', date_jst: '2026-08-11', datetime_jst: '2026-08-11T13:30:00+09:00' }),
    ledgerEvent({ event_id: 'au-quarterly_report-2026-08-11', country: 'AU', source_id: 'au_rba', date_jst: '2026-08-11', datetime_jst: '2026-08-11T13:30:00+09:00' }),
    ledgerEvent({ event_id: 'au-press_conference-2026-08-11', country: 'AU', source_id: 'au_rba', date_jst: '2026-08-11', datetime_jst: '2026-08-11T14:30:00+09:00' }),
  ];
  const result = computeBundleIds(events);
  const bundleIds = new Set(result.map((e) => e.bundle_id));
  assert.equal(bundleIds.size, 1, '3件とも同一bundle_idのはず');
  assert.notEqual([...bundleIds][0], null);
  assert.equal(result[0].bundle_id, 'au-policy_rate-2026-08-11', '先頭（最も早い時刻）のevent_idがbundle_idになる');
});

test('computeBundleIds: CPI+コアCPI（同日同時刻・同一source）が1束、PPI+コアPPIは別の束になる', () => {
  const events = [
    ledgerEvent({ event_id: 'us-cpi-2026-08-12', country: 'US', source_id: 'us_bls_fred', date_jst: '2026-08-12', datetime_jst: '2026-08-12T21:30:00+09:00' }),
    ledgerEvent({ event_id: 'us-cpi-2026-08-12-2', country: 'US', source_id: 'us_bls_fred', date_jst: '2026-08-12', datetime_jst: '2026-08-12T21:30:00+09:00' }),
    ledgerEvent({ event_id: 'us-ppi-2026-08-13', country: 'US', source_id: 'us_bls_fred', date_jst: '2026-08-13', datetime_jst: '2026-08-13T21:30:00+09:00' }),
    ledgerEvent({ event_id: 'us-ppi-2026-08-13-2', country: 'US', source_id: 'us_bls_fred', date_jst: '2026-08-13', datetime_jst: '2026-08-13T21:30:00+09:00' }),
  ];
  const result = computeBundleIds(events);
  const cpiIds = new Set(result.slice(0, 2).map((e) => e.bundle_id));
  const ppiIds = new Set(result.slice(2, 4).map((e) => e.bundle_id));
  assert.equal(cpiIds.size, 1);
  assert.equal(ppiIds.size, 1);
  assert.notDeepEqual(cpiIds, ppiIds, '日付が異なるCPIとPPIは別の束になるはず（同一日制約）');
});

test('computeBundleIds: 同一時刻でも国・sourceが異なれば束ねない（CA/US雇用統計、同日21:30）', () => {
  const events = [
    ledgerEvent({ event_id: 'ca-employment_situation-2026-08-07', country: 'CA', source_id: 'ca_statcan', date_jst: '2026-08-07', datetime_jst: '2026-08-07T21:30:00+09:00' }),
    ledgerEvent({ event_id: 'us-employment_situation-2026-08-07', country: 'US', source_id: 'us_bls_fred', date_jst: '2026-08-07', datetime_jst: '2026-08-07T21:30:00+09:00' }),
  ];
  const result = computeBundleIds(events);
  assert.equal(result[0].bundle_id, null);
  assert.equal(result[1].bundle_id, null);
});

test('computeBundleIds: 単独イベント（束ね相手なし）はbundle_id:null、時刻未公表イベントも対象外', () => {
  const events = [
    ledgerEvent({ event_id: 'jp-opinions_summary-2026-08-10', country: 'JP', source_id: 'jp_boj', date_jst: '2026-08-10', datetime_jst: '2026-08-10T08:50:00+09:00' }),
    ledgerEvent({ event_id: 'jp-bond_auction-2026-08-04', country: 'JP', source_id: 'jp_mof', date_jst: '2026-08-04', datetime_jst: null }),
  ];
  const result = computeBundleIds(events);
  assert.equal(result[0].bundle_id, null);
  assert.equal(result[1].bundle_id, null);
});

test('computeBundleIds: 90分を超える間隔は束ねない（91分ギャップ）、90分ちょうどは束ねる', () => {
  const exact90 = computeBundleIds([
    ledgerEvent({ event_id: 'a', country: 'AU', source_id: 'x', date_jst: '2026-08-11', datetime_jst: '2026-08-11T10:00:00+09:00' }),
    ledgerEvent({ event_id: 'b', country: 'AU', source_id: 'x', date_jst: '2026-08-11', datetime_jst: '2026-08-11T11:30:00+09:00' }),
  ]);
  assert.equal(exact90[0].bundle_id, 'a');
  assert.equal(exact90[1].bundle_id, 'a');

  const over90 = computeBundleIds([
    ledgerEvent({ event_id: 'a', country: 'AU', source_id: 'x', date_jst: '2026-08-11', datetime_jst: '2026-08-11T10:00:00+09:00' }),
    ledgerEvent({ event_id: 'b', country: 'AU', source_id: 'x', date_jst: '2026-08-11', datetime_jst: '2026-08-11T11:31:00+09:00' }),
  ]);
  assert.equal(over90[0].bundle_id, null);
  assert.equal(over90[1].bundle_id, null);
});

test('buildLedger: RBA3件クラスタがbuildLedger()経由でも同一bundle_idになる', () => {
  const report = syntheticReport({
    results: [
      {
        id: 'au_rba', ok: true, skipped: false,
        thisWeek: [
          { date: '2026-08-11', time: '13:30', kind: 'policy_rate', country: 'AU', importance: 3, displayName: 'RBA政策金利＆声明発表', sourceEvidence: 'test' },
          { date: '2026-08-11', time: '13:30', kind: 'quarterly_report', country: 'AU', importance: 3, displayName: 'RBA四半期金融政策報告', sourceEvidence: 'test' },
          { date: '2026-08-11', time: '14:30', kind: 'press_conference', country: 'AU', importance: 3, displayName: 'ブロックRBA総裁の記者会見', sourceEvidence: 'test' },
        ],
      },
    ],
  });
  const sourcesConfig = syntheticSourcesConfig();
  const candidates = report.results[0].thisWeek.map((c) => ({ ...c, sourceId: 'au_rba' }));
  const ledger = buildLedger({
    report, sourcesConfig, manualEventsConfig: { entries: [] }, candidates,
    expectedCoverageResult: { required: [], missing: [] }, recurringChecksStatus: [],
    pipelineVersion: 'test-pipeline-1', generatedAt: '2026-08-15T08:06:00+09:00',
  });
  const bundleIds = new Set(ledger.events.map((e) => e.bundle_id));
  assert.equal(bundleIds.size, 1);
  assert.notEqual([...bundleIds][0], null);
  const r = validateLedger(ledger);
  assert.equal(r.ok, true);
});

test('buildLedger: report.outcome=HOLDのときledger.meta.outcome=HOLD・holdsが理由を含む', () => {
  const report = syntheticReport({ outcome: { status: 'HOLD', reasons: ['判定不能: 2件のソースが同時に失敗'] } });
  const sourcesConfig = syntheticSourcesConfig();
  const ledger = buildLedger({
    report, sourcesConfig, manualEventsConfig: { entries: [] }, candidates: [],
    expectedCoverageResult: { required: [], missing: [] }, recurringChecksStatus: [],
    pipelineVersion: 'test-pipeline-1', generatedAt: '2026-08-15T08:06:00+09:00',
  });
  assert.equal(ledger.meta.outcome, 'HOLD');
  assert.deepEqual(ledger.meta.holds, ['判定不能: 2件のソースが同時に失敗']);
  const r = validateLedger(ledger);
  assert.equal(r.ok, true);
});

// task #84（2026-08-30）: RBNZ・BOCのpress_conference追加時、schedule[]へのpolicy_rate/press_conference
// 追加漏れ（片方だけ日付を足し忘れる等）を今後の年次スケジュール更新時に検出するための実config監査。
// SNB/RBA/FRB/ECBは既存実装のため対象外（新規追加した2ソースの回帰防止が目的）
test('実config — boc_policy_rate/rbnz_policy_rateのpolicy_rate日程はすべてpress_conference日程を伴う（task #84）', () => {
  const sourcesConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'official-sources.json'), 'utf8'));
  for (const id of ['boc_policy_rate', 'rbnz_policy_rate']) {
    const source = sourcesConfig.sources.find((s) => s.id === id);
    const policyRateDates = new Set(source.schedule.filter((e) => e.kind === 'policy_rate').map((e) => e.date));
    const pressConferenceDates = new Set(source.schedule.filter((e) => e.kind === 'press_conference').map((e) => e.date));
    assert.deepEqual([...policyRateDates].sort(), [...pressConferenceDates].sort(), `${id}: policy_rateとpress_conferenceの日付集合が一致しない`);
    assert.ok(source.announce_time_by_kind.press_conference, `${id}: announce_time_by_kind.press_conferenceが未定義`);
  }
});
