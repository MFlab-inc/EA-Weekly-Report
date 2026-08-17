#!/usr/bin/env node
// PUBLISH_READY判定ゲート（task #13、しょうさん再定義2026-08-15「5. PUBLISH_READY判定（gate）—
// 1〜4の結果を集約。1件でも不合格ならHOLD、output/は更新しない」）。
// 全てNode.jsで完結する（旧publish_gate.pyから置き換え。Pythonは本パイプラインから撤去した）。
// 集約する検査:
//   1. 台帳スキーマ検証（scripts/lib/validate-ledger.js）— 空のsource_evidence等はここでHOLD
//   2. 台帳自体のmeta.outcome（鮮度検証・クロス突合/定例欠落は収集段のharness.mjs/fail-closed.jsで
//      既に評価済みでledger.meta.outcome/warnings/holdsへ反映されている。ここではその結果を読むのみ）
//   3. 台帳×HTML突合検査（scripts/check/ledger-html-audit.mjs）
//   4. ポリシーlint＋リンク検査（scripts/check/policy-lint.mjs）
//   5. モバイル多幅レイアウト検証（scripts/check/mobile-layout-check.mjs、Playwright）
//   6. イベント件数の下限チェック（scripts/lib/validate-event-volume.js。2026-08-15新設・task #38）
//
// 判定は3状態（しょうさん指示2026-08-15、task #38: 8/17週で★★★0件のままPUBLISH_READYが
// 出た事例を受けて新設）:
//   PUBLISH_READY   — 1〜5全てERROR無し かつ 6の下限チェックもクリア → output/へコミット
//   REVIEW_REQUIRED — 1〜5はERROR無しだが6の下限チェックに抵触 → output/へコミットしない
//                     （artifact/プレビューにのみ出力。理由を明記）。人間が内容を確認し、
//                     妥当なら --acknowledge-low-volume を付けて再実行することでコミットさせる
//                     （weekly.yml移設時にworkflow_dispatch入力から本フラグへ渡す設計を想定。
//                     現時点ではweekly.ymlは移設保留中のためCLIフラグのみ実装済み）
//   HOLD            — 1〜5のいずれかにERRORがある → 従来どおりoutput/は更新しない
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { argv, exit } from 'node:process';

import { validateLedger } from '../lib/validate-ledger.js';
import { auditLedgerHtml } from './ledger-html-audit.mjs';
import { runStaticLint, extractHrefs, checkLinkReachability } from './policy-lint.mjs';
import { checkMobileLayout, summarizeResults as summarizeMobileResults } from './mobile-layout-check.mjs';
import { nowJstIso } from '../lib/tz-convert.js';
import { checkEventVolume } from '../lib/validate-event-volume.js';

function parseArgs(args) {
  const opts = {
    ledger: null, html: null, result: 'gate-result.json',
    btcGuideConfig: 'config/btc-weekend-guide.json', reportPolicyConfig: 'config/report-policy.json',
    volumeCheckConfig: 'config/volume-check-policy.json',
    skipMobile: false, skipLinkReachability: false, acknowledgeLowVolume: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ledger') opts.ledger = args[++i];
    else if (args[i] === '--html') opts.html = args[++i];
    else if (args[i] === '--result') opts.result = args[++i];
    else if (args[i] === '--btc-guide-config') opts.btcGuideConfig = args[++i];
    else if (args[i] === '--report-policy-config') opts.reportPolicyConfig = args[++i];
    else if (args[i] === '--volume-check-config') opts.volumeCheckConfig = args[++i];
    else if (args[i] === '--skip-mobile') opts.skipMobile = true;
    else if (args[i] === '--skip-link-reachability') opts.skipLinkReachability = true;
    else if (args[i] === '--acknowledge-low-volume') opts.acknowledgeLowVolume = true;
  }
  return opts;
}

// 戻り値: { name, errors: string[], warnings: string[] }[]
export async function runGateChecks({ ledger, html, reportPolicy, btcGuide, skipMobile = false, skipLinkReachability = false, mobileHtmlPath } = {}) {
  const checks = [];

  const ledgerValidation = validateLedger(ledger);
  checks.push({ name: 'ledger_schema', errors: ledgerValidation.errors, warnings: [] });

  const outcomeErrors = ledger?.meta?.outcome === 'HOLD' ? (ledger.meta.holds || []).map((h) => `UPSTREAM_HOLD: ${h}`) : [];
  checks.push({ name: 'ledger_outcome', errors: outcomeErrors, warnings: ledger?.meta?.warnings || [] });

  const auditErrors = ledgerValidation.ok ? auditLedgerHtml(html, ledger) : ['SKIPPED: 台帳スキーマ不合格のため突合検査は省略'];
  checks.push({ name: 'ledger_html_audit', errors: ledgerValidation.ok ? auditErrors : [], warnings: ledgerValidation.ok ? [] : auditErrors });

  const lintErrors = runStaticLint(html, { reportPolicy, btcGuide });
  const lintWarnings = skipLinkReachability ? [] : await checkLinkReachability(extractHrefs(html));
  checks.push({ name: 'policy_lint', errors: lintErrors, warnings: lintWarnings });

  if (skipMobile) {
    checks.push({ name: 'mobile_layout', errors: [], warnings: ['SKIPPED: --skip-mobile指定'] });
  } else {
    const mobileResults = await checkMobileLayout(mobileHtmlPath);
    checks.push({ name: 'mobile_layout', errors: summarizeMobileResults(mobileResults), warnings: [] });
  }

  return checks;
}

// PUBLISH_READY/REVIEW_REQUIRED/HOLDの3状態判定（純粋関数）。
// checksに1件でもERRORがあればHOLD最優先（下限チェックの結果に関わらず）。
// acknowledgeLowVolume:trueは「人間が内容を確認し妥当と判断した」ことを表す明示的な
// オーバーライドで、下限チェックの抵触をPUBLISH_READY相当に格上げする（HOLDは上書きしない）
export function decideGateOutcome(checks, volumeCheck, { acknowledgeLowVolume = false } = {}) {
  const hasError = checks.some((c) => c.errors.length > 0);
  if (hasError) return 'HOLD';
  if (volumeCheck.belowThreshold && !acknowledgeLowVolume) return 'REVIEW_REQUIRED';
  return 'PUBLISH_READY';
}

async function main() {
  const opts = parseArgs(argv.slice(2));
  if (!opts.ledger || !opts.html) {
    console.error('使い方: node gate.mjs --ledger <ledger.json> --html <html> [--result <path>] [--skip-mobile] [--skip-link-reachability] [--acknowledge-low-volume]');
    exit(2);
  }
  const ledger = JSON.parse(readFileSync(opts.ledger, 'utf8'));
  const html = readFileSync(opts.html, 'utf8');
  const reportPolicy = JSON.parse(readFileSync(opts.reportPolicyConfig, 'utf8'));
  const btcGuide = JSON.parse(readFileSync(opts.btcGuideConfig, 'utf8'));
  const volumeCheckPolicy = JSON.parse(readFileSync(opts.volumeCheckConfig, 'utf8'));

  const checks = await runGateChecks({
    ledger, html, reportPolicy, btcGuide,
    skipMobile: opts.skipMobile, skipLinkReachability: opts.skipLinkReachability, mobileHtmlPath: opts.html,
  });
  const volumeCheck = checkEventVolume(ledger, volumeCheckPolicy);
  const decision = decideGateOutcome(checks, volumeCheck, { acknowledgeLowVolume: opts.acknowledgeLowVolume });

  const payload = {
    schema_version: '1.1',
    decision,
    checked_at_jst: nowJstIso(),
    checks,
    volume_check: { ...volumeCheck, acknowledged: opts.acknowledgeLowVolume },
    rule: 'いずれかの検査でERRORが1件でもあればHOLD。ERRORが無くイベント件数の下限チェックに抵触すればREVIEW_REQUIRED。いずれもクリアすればPUBLISH_READY。HOLD/REVIEW_REQUIRED時は完成版として配信・投稿せず、output/は更新しない。',
  };
  mkdirSync(dirname(opts.result) || '.', { recursive: true });
  writeFileSync(opts.result, JSON.stringify(payload, null, 2) + '\n');

  console.log(`判定: ${decision}`);
  console.log(`監査記録: ${opts.result}`);
  for (const c of checks) {
    console.log(`  - ${c.name}: ERROR=${c.errors.length} WARNING=${c.warnings.length}`);
    for (const e of c.errors) console.log(`      ERROR: ${e}`);
  }
  console.log(`  - volume_check: 掲載対象=${volumeCheck.displayedCount}件 / ★★★=${volumeCheck.star3Count}件${volumeCheck.belowThreshold ? ` (${volumeCheck.reasons.join('、')})` : ''}`);

  if (decision === 'HOLD') {
    console.log('配信保留（HOLD）: いずれかの検査エラーを解消してください。');
    exit(2);
  }
  if (decision === 'REVIEW_REQUIRED') {
    console.log('人手確認が必要（REVIEW_REQUIRED）: 検査エラーは無いが、イベント件数が下限を下回っています。内容を確認し、妥当であれば --acknowledge-low-volume を付けて再実行してください。');
    exit(3);
  }
  console.log('配信可（PUBLISH_READY）: 監査エラー・件数下限抵触ともに検出されませんでした。');
}

if (import.meta.url === `file://${argv[1]}`) {
  main();
}
