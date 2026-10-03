'use strict';
// scripts/check/gate.mjs の統合テスト（task #13）。
// PUBLISH_READY/HOLDの集約判定と、しょうさん指示の必須テスト（意図的に壊したデータでHOLDになる
// ことの実証）のうち台帳スキーマ由来のケース（出典を空にする）をここでカバーする。
// mobile_layoutはPlaywright起動のため既定でスキップ（test/mobile-layout-check.test.jsで別途担保）。
const { test } = require('node:test');
const assert = require('node:assert/strict');

async function loadGate() {
  return import('../scripts/check/gate.mjs');
}

function baseLedger() {
  return {
    meta: {
      schema_version: '1.0',
      generated_at: '2026-08-15T08:06:00+09:00',
      target_week_start: '2026-08-17',
      target_week_end: '2026-08-21',
      pipeline_version: 'test-pipeline-1',
      outcome: 'PUBLISH_READY',
      warnings: [],
      holds: [],
    },
    sources: [
      { source_id: 'au_rba', type: 'annual_schedule_config', fetched_at: '2026-08-15T08:00:00+09:00', url: 'https://www.rba.gov.au/schedules-events/board-meeting-schedules.html', ok: true, http_status: null, extractor_result_count: 1, robots_checked: true, fail_closed_decision: 'OK' },
      { source_id: 'manual', type: 'manual', fetched_at: '2026-08-15T08:00:00+09:00', url: 'config/manual-events.json', ok: true, http_status: null, extractor_result_count: 0, robots_checked: false, fail_closed_decision: 'OK' },
    ],
    events: [
      {
        event_id: 'au-rba-rate-2026-08-18', date_local: '2026-08-18', time_local: '14:30', tz: 'Australia/Sydney',
        date_jst: '2026-08-18', datetime_jst: '2026-08-18T13:30:00+09:00', time_status: 'published',
        country: 'AU', currency: 'AUD', kind: 'policy_rate', name_ja: 'RBA政策金利＆声明発表', importance: 3,
        source_id: 'au_rba', source_evidence: 'ground truth一致確認済み', name_resolution: 'dictionary',
        halt_window_start_jst: '2026-08-18T01:30:00+09:00', halt_window_end_jst: '2026-08-18T09:30:00+09:00', bundle_id: null,
      },
    ],
    coverage: { expected_coverage: { required: 8, missing: [] }, recurring_checks: [] },
  };
}

// SPEC §6.3「日別カード×5」・task #38実ネットワーク検証2026-08-15で発見: 実レンダラーは
// イベントが1件も無い日（8/17・8/19〜8/21）も空の日付グループとして出力するため、
// ledger-html-audit.mjsのauditDateGroups()もそれを期待値とする。フィクスチャは5グループ全てを含める
function baseHtml() {
  return `<div data-ea-report-meta="ea-weekly-20260817" data-ea-layout-version="ea-only-v4" data-ea-target-start="2026-08-17" data-ea-section-count="4" data-ea-reader-time-term="日本時間" data-ea-halt-guidance="pre4to12h">
  <div>対象週（日本時間） 8月17日（月）〜 8月21日（金）</div>
  <div class="ea-date-group" data-ea-date="2026-08-17" data-ea-date-event-count="0">
    <div>8月17日（月）</div>
  </div>
  <div class="ea-date-group" data-ea-date="2026-08-18" data-ea-date-event-count="1">
    <div>8月18日（火）</div>
    <div class="ea-event-card" data-ea-event-id="au-rba-rate-2026-08-18" data-ea-event-importance="3">RBA政策金利＆声明発表</div>
  </div>
  <div class="ea-date-group" data-ea-date="2026-08-19" data-ea-date-event-count="0">
    <div>8月19日（水）</div>
  </div>
  <div class="ea-date-group" data-ea-date="2026-08-20" data-ea-date-event-count="0">
    <div>8月20日（木）</div>
  </div>
  <div class="ea-date-group" data-ea-date="2026-08-21" data-ea-date-event-count="0">
    <div>8月21日（金）</div>
  </div>
  <div style="text-align:left;">
    テスト用免責文言テスト用出典文言
  </div>
</div>`;
}

const REPORT_POLICY = { forbidden_reader_terms: ['JST', '仮想通貨'], forbidden_sections: ['市況サマリー'], footer_disclaimer: 'テスト用免責文言', footer_source_statement: 'テスト用出典文言' };
const BTC_GUIDE = { allowed_domains: ['coinpost.jp'] };

test('runGateChecks: 妥当な組み合わせは全チェックPUBLISH_READY相当（エラー無し）', async () => {
  const { runGateChecks } = await loadGate();
  const checks = await runGateChecks({
    ledger: baseLedger(), html: baseHtml(), reportPolicy: REPORT_POLICY, btcGuide: BTC_GUIDE,
    skipMobile: true, skipLinkReachability: true,
  });
  const allErrors = checks.flatMap((c) => c.errors);
  assert.deepEqual(allErrors, [], JSON.stringify(checks, null, 2));
});

test('必須ケース: 出典（source_evidence）を空にする → ledger_schemaでHOLD', async () => {
  const { runGateChecks } = await loadGate();
  const ledger = baseLedger();
  ledger.events[0].source_evidence = '';
  const checks = await runGateChecks({
    ledger, html: baseHtml(), reportPolicy: REPORT_POLICY, btcGuide: BTC_GUIDE,
    skipMobile: true, skipLinkReachability: true,
  });
  const schemaCheck = checks.find((c) => c.name === 'ledger_schema');
  assert.ok(schemaCheck.errors.some((e) => e.includes('source_evidence')));
  assert.ok(checks.some((c) => c.errors.length > 0));
});

// task #47（2026-08-15、しょうさん監査指摘）: 生成HTMLからルートラッパー（data-ea-report-meta等の
// SPEC §6属性契約）が丸ごと欠落した場合に、ledger_html_audit経由でHOLDになることをgate.mjsの
// 統合レベルで確認する（監査ロジック自体はscripts/check/ledger-html-audit.mjsのauditRootMetaに
// task #13から実装済み。ここではrunGateChecks/decideGateOutcomeへの結線を確認する）
test('必須ケース: 生成HTMLからルートラッパー（data-ea-*属性）が丸ごと欠落する → ledger_html_auditでHOLD', async () => {
  const { runGateChecks, decideGateOutcome } = await loadGate();
  const html = baseHtml().replace(/^<div data-ea-report-meta="[^"]*"[^>]*>\n/, '<div>\n');
  const checks = await runGateChecks({
    ledger: baseLedger(), html, reportPolicy: REPORT_POLICY, btcGuide: BTC_GUIDE,
    skipMobile: true, skipLinkReachability: true,
  });
  const htmlAuditCheck = checks.find((c) => c.name === 'ledger_html_audit');
  assert.ok(htmlAuditCheck.errors.some((e) => e.includes('ROOT_META_MISSING')), JSON.stringify(htmlAuditCheck));
  const decision = decideGateOutcome(checks, { belowThreshold: false, reasons: [] });
  assert.equal(decision, 'HOLD');
});

test('meta.outcome=HOLD（収集段の鮮度検証/フェールクローズ由来）はledger_outcomeでHOLDを伝播する', async () => {
  const { runGateChecks } = await loadGate();
  const ledger = baseLedger();
  ledger.meta.outcome = 'HOLD';
  ledger.meta.holds = ['判定不能: 2件のソースが同時に失敗'];
  const checks = await runGateChecks({
    ledger, html: baseHtml(), reportPolicy: REPORT_POLICY, btcGuide: BTC_GUIDE,
    skipMobile: true, skipLinkReachability: true,
  });
  const outcomeCheck = checks.find((c) => c.name === 'ledger_outcome');
  assert.ok(outcomeCheck.errors.some((e) => e.includes('判定不能')));
});

test('禁止語混入・許可外ドメインリンクはpolicy_lintでHOLD', async () => {
  const { runGateChecks } = await loadGate();
  const html = baseHtml().replace('8月18日（火）', '8月18日（火） JST').replace(
    '</div>\n</div>',
    '<a href="https://not-allowlisted.test/">リンク</a></div>\n</div>'
  );
  const checks = await runGateChecks({
    ledger: baseLedger(), html, reportPolicy: REPORT_POLICY, btcGuide: BTC_GUIDE,
    skipMobile: true, skipLinkReachability: true,
  });
  const lintCheck = checks.find((c) => c.name === 'policy_lint');
  assert.ok(lintCheck.errors.some((e) => e.includes('FORBIDDEN_READER_TERM')));
  assert.ok(lintCheck.errors.some((e) => e.includes('LINK_DOMAIN_NOT_ALLOWLISTED')));
});

// task #38実ネットワーク検証（しょうさん指摘2026-08-15）で新設した3状態判定（PUBLISH_READY/
// REVIEW_REQUIRED/HOLD）のテスト。8/17週で★★★0件・掲載対象3件のままPUBLISH_READYが
// 出てしまった事例を受け、検査エラーが無くてもイベント件数が下限を下回ればREVIEW_REQUIRED
// とし、output/へコミットしない安全網を追加した
const VOLUME_POLICY = { min_displayed_events: 4, require_at_least_one_star3: true };

test('decideGateOutcome: 検査エラーがあれば下限チェックの結果に関わらずHOLD', async () => {
  const { decideGateOutcome } = await loadGate();
  const checks = [{ name: 'ledger_schema', errors: ['出典が空'], warnings: [] }];
  const decision = decideGateOutcome(checks, { belowThreshold: false, reasons: [] });
  assert.equal(decision, 'HOLD');
});

test('decideGateOutcome: 検査エラー無し・件数下限抵触ありはREVIEW_REQUIRED', async () => {
  const { decideGateOutcome } = await loadGate();
  const checks = [{ name: 'ledger_schema', errors: [], warnings: [] }];
  const decision = decideGateOutcome(checks, { belowThreshold: true, reasons: ['最重要（★★★）イベントが0件です'] });
  assert.equal(decision, 'REVIEW_REQUIRED');
});

test('decideGateOutcome: acknowledgeLowVolume:trueなら件数下限抵触があってもPUBLISH_READYへ格上げされる', async () => {
  const { decideGateOutcome } = await loadGate();
  const checks = [{ name: 'ledger_schema', errors: [], warnings: [] }];
  const decision = decideGateOutcome(checks, { belowThreshold: true, reasons: ['test'] }, { acknowledgeLowVolume: true });
  assert.equal(decision, 'PUBLISH_READY');
});

test('decideGateOutcome: acknowledgeLowVolume:trueでも検査エラーがあればHOLDのまま（オーバーライドはHOLDを上書きしない）', async () => {
  const { decideGateOutcome } = await loadGate();
  const checks = [{ name: 'ledger_schema', errors: ['出典が空'], warnings: [] }];
  const decision = decideGateOutcome(checks, { belowThreshold: true, reasons: ['test'] }, { acknowledgeLowVolume: true });
  assert.equal(decision, 'HOLD');
});

test('decideGateOutcome: 検査エラー無し・件数下限もクリアならPUBLISH_READY', async () => {
  const { decideGateOutcome } = await loadGate();
  const checks = [{ name: 'ledger_schema', errors: [], warnings: [] }];
  const decision = decideGateOutcome(checks, { belowThreshold: false, reasons: [] });
  assert.equal(decision, 'PUBLISH_READY');
});

// task #93（2026-09-06、しょうさん指示: 掲載件数の推移監視）: 絶対下限(volumeCheck)は
// クリアしていても、trendCheck.belowThresholdがtrueならREVIEW_REQUIRED
test('decideGateOutcome: 絶対下限はクリアでもtrendCheck.belowThresholdがtrueならREVIEW_REQUIRED', async () => {
  const { decideGateOutcome } = await loadGate();
  const checks = [{ name: 'ledger_schema', errors: [], warnings: [] }];
  const decision = decideGateOutcome(
    checks,
    { belowThreshold: false, reasons: [] },
    { trendCheck: { belowThreshold: true, reasons: ['過去実績比で異常に少ない'] } }
  );
  assert.equal(decision, 'REVIEW_REQUIRED');
});

test('decideGateOutcome: trendCheck省略時は従来どおりvolumeCheckのみで判定する（後方互換）', async () => {
  const { decideGateOutcome } = await loadGate();
  const checks = [{ name: 'ledger_schema', errors: [], warnings: [] }];
  const decision = decideGateOutcome(checks, { belowThreshold: false, reasons: [] });
  assert.equal(decision, 'PUBLISH_READY');
});

test('decideGateOutcome: acknowledgeLowVolume:trueはtrendCheckの抵触もPUBLISH_READYへ格上げする', async () => {
  const { decideGateOutcome } = await loadGate();
  const checks = [{ name: 'ledger_schema', errors: [], warnings: [] }];
  const decision = decideGateOutcome(
    checks,
    { belowThreshold: false, reasons: [] },
    { acknowledgeLowVolume: true, trendCheck: { belowThreshold: true, reasons: ['test'] } }
  );
  assert.equal(decision, 'PUBLISH_READY');
});

// task #38の8/17週の再現ケース: baseLedger()は既定でイベント1件のみ（掲載対象<4件）のため、
// 実際のrunGateChecks()結果と組み合わせてもREVIEW_REQUIRED相当になることを確認する
test('統合: baseLedger()（イベント1件のみ）はchecksにERROR無しでもcheckEventVolumeで下限抵触する', async () => {
  const { runGateChecks, decideGateOutcome } = await loadGate();
  const { checkEventVolume } = await import('../scripts/lib/validate-event-volume.js');
  const checks = await runGateChecks({
    ledger: baseLedger(), html: baseHtml(), reportPolicy: REPORT_POLICY, btcGuide: BTC_GUIDE,
    skipMobile: true, skipLinkReachability: true,
  });
  assert.deepEqual(checks.flatMap((c) => c.errors), []);
  const volumeCheck = checkEventVolume(baseLedger(), VOLUME_POLICY);
  assert.equal(volumeCheck.belowThreshold, true);
  assert.equal(decideGateOutcome(checks, volumeCheck), 'REVIEW_REQUIRED');
});

// 2026-10-03追加（しょうさん指摘item3続き: 12/28週[年末年始]の生成[12/26]までに手動公開経路が
// 必要）。applyLowVolumeAcknowledgment()の単体テスト
test('applyLowVolumeAcknowledgment: acknowledgeLowVolume:true・belowThreshold:true・decision:PUBLISH_READYの場合のみledger.metaに記録する', async () => {
  const { applyLowVolumeAcknowledgment } = await loadGate();
  const ledger = baseLedger();
  const updated = applyLowVolumeAcknowledgment(ledger, {
    decision: 'PUBLISH_READY',
    volumeCheck: { belowThreshold: true },
    trendCheck: { belowThreshold: false },
    acknowledgeLowVolume: true,
    checkedAtJst: '2026-12-26T08:06:00+09:00',
  });
  assert.notEqual(updated, ledger, '元のledgerとは別オブジェクトが返るはず');
  assert.deepEqual(updated.meta.low_volume_acknowledged, {
    acknowledged: true,
    acknowledged_at: '2026-12-26T08:06:00+09:00',
    reason: '件数下限チェック（または過去実績比較の推移チェック）に抵触したが、内容を確認のうえ手動で公開を承認した（--acknowledge-low-volume）',
  });
  // 元のledgerは変更されない（イミュータブル）
  assert.equal(ledger.meta.low_volume_acknowledged, undefined);
});

test('applyLowVolumeAcknowledgment: decision:HOLDの場合は記録しない（監査エラーがある週をこのフラグで公開してしまうことは絶対に無い）', async () => {
  const { applyLowVolumeAcknowledgment } = await loadGate();
  const ledger = baseLedger();
  const updated = applyLowVolumeAcknowledgment(ledger, {
    decision: 'HOLD',
    volumeCheck: { belowThreshold: true },
    trendCheck: { belowThreshold: false },
    acknowledgeLowVolume: true,
    checkedAtJst: '2026-12-26T08:06:00+09:00',
  });
  assert.equal(updated, ledger, 'HOLDの場合は元のledgerがそのまま返るはず（変更なし）');
});

test('applyLowVolumeAcknowledgment: acknowledgeLowVolume:falseなら記録しない（通常のREVIEW_REQUIRED停止時）', async () => {
  const { applyLowVolumeAcknowledgment } = await loadGate();
  const ledger = baseLedger();
  const updated = applyLowVolumeAcknowledgment(ledger, {
    decision: 'REVIEW_REQUIRED',
    volumeCheck: { belowThreshold: true },
    trendCheck: { belowThreshold: false },
    acknowledgeLowVolume: false,
    checkedAtJst: '2026-12-26T08:06:00+09:00',
  });
  assert.equal(updated, ledger);
});

test('applyLowVolumeAcknowledgment: belowThresholdがfalse（そもそも下限抵触していない）なら記録しない', async () => {
  const { applyLowVolumeAcknowledgment } = await loadGate();
  const ledger = baseLedger();
  const updated = applyLowVolumeAcknowledgment(ledger, {
    decision: 'PUBLISH_READY',
    volumeCheck: { belowThreshold: false },
    trendCheck: { belowThreshold: false },
    acknowledgeLowVolume: true,
    checkedAtJst: '2026-12-26T08:06:00+09:00',
  });
  assert.equal(updated, ledger, '確認すべき下限抵触自体が無いので記録は不要');
});

// 2026-10-03追加: baseLedger()（1件のみ）の低件数シナリオで、REVIEW_REQUIRED→
// acknowledge_low_volumeによるPUBLISH_READY格上げ→台帳への記録、という一連の流れを
// runGateChecks/decideGateOutcome/applyLowVolumeAcknowledgmentの実結線で確認する
// （しょうさん指示: 「過去の少件数シナリオ（テスト用の台帳）で一連の流れを試験」）
test('統合: 低件数シナリオ（baseLedger）でREVIEW_REQUIRED→acknowledge_low_volumeでPUBLISH_READYへ格上げされ、台帳に記録される', async () => {
  const { runGateChecks, decideGateOutcome, applyLowVolumeAcknowledgment } = await loadGate();
  const { checkEventVolume } = await import('../scripts/lib/validate-event-volume.js');

  const checks = await runGateChecks({
    ledger: baseLedger(), html: baseHtml(), reportPolicy: REPORT_POLICY, btcGuide: BTC_GUIDE,
    skipMobile: true, skipLinkReachability: true,
  });
  const volumeCheck = checkEventVolume(baseLedger(), VOLUME_POLICY);

  // 1回目（未確認）: REVIEW_REQUIRED、台帳は変更されない
  const firstDecision = decideGateOutcome(checks, volumeCheck);
  assert.equal(firstDecision, 'REVIEW_REQUIRED');
  const ledgerAfterFirst = applyLowVolumeAcknowledgment(baseLedger(), {
    decision: firstDecision, volumeCheck, trendCheck: undefined, acknowledgeLowVolume: false, checkedAtJst: '2026-12-26T08:06:00+09:00',
  });
  assert.equal(ledgerAfterFirst.meta.low_volume_acknowledged, undefined);

  // 2回目（acknowledge_low_volume=true、しょうさんがレビュー用HTMLを確認後に手動実行）:
  // PUBLISH_READYへ格上げされ、台帳に確認記録が残る
  const secondDecision = decideGateOutcome(checks, volumeCheck, { acknowledgeLowVolume: true });
  assert.equal(secondDecision, 'PUBLISH_READY');
  const ledgerAfterSecond = applyLowVolumeAcknowledgment(baseLedger(), {
    decision: secondDecision, volumeCheck, trendCheck: undefined, acknowledgeLowVolume: true, checkedAtJst: '2026-12-27T10:00:00+09:00',
  });
  assert.equal(ledgerAfterSecond.meta.low_volume_acknowledged.acknowledged, true);
  assert.equal(ledgerAfterSecond.meta.low_volume_acknowledged.acknowledged_at, '2026-12-27T10:00:00+09:00');
});
