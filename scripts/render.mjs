#!/usr/bin/env node
// レンダリングステップ（collect→build-ledger→renderの3段目、task #13後継の実データ接続、
// しょうさん指示2026-08-15）。data/ledger/YYYY-MM-DD.jsonをscripts/render/ledger-to-week-input.js
// で weekInput 形へ変換し、既存レンダラー（build-report-data.js・html-renderer.js、design-mock_v1.2.html
// 再現・task #12実装済み）でHTMLを生成する。
//
// heroSummary/heroPills（ヒーロー要約文）は「その週の特に注目すべき事象を選び簡潔に言い表す」という
// 編集判断を伴い、台帳から機械的に一意に導出できない（ledgerToWeekInputのコメント参照）。
// このスクリプトは:
// - --narrative <path> で {reportMeta?, createdDateJa?, heroSummary, heroPills} を持つJSON/JSファイルを
//   指定すれば、それを人手キュレーション済みの入力として使う（推奨。既刊相当の品質になる）
// - 指定が無い場合は台帳のimportance=3イベントから事実列挙のみの簡易要約を機械生成する
//   （SPEC §6.2「事実列挙のみ」の範囲に収まる最小限の自動フォールバック。既刊のような複数イベントの
//   まとめ表現[例:「ISM製造業・非製造業」]は行わないため、既刊ほど簡潔ではない点に留意。
//   完全無人運用を可能にするための最終防波堤であり、品質を保証するものではない）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildReportData } = require('./render/build-report-data.js');
const { renderReportHtml } = require('./render/html-renderer.js');
const { ledgerToWeekInput } = require('./render/ledger-to-week-input.js');

function pad2(n) {
  return String(n).padStart(2, '0');
}

// 対象週のimportance=3イベント名から「事実列挙のみ」の簡易要約を組み立てる（--narrative未指定時の
// 最終フォールバック。上記ファイルコメント参照。上限4件で打ち切る：既刊実例[4フレーズ]と同程度の分量に抑える）
function autoHeroSummary(ledger) {
  const names = [...new Set(ledger.events.filter((e) => e.importance === 3).map((e) => e.name_ja))];
  if (names.length === 0) return '対象週に最重要（★★★）イベントはありません';
  return `${names.slice(0, 4).join('、')}を確認する週`;
}

function autoHeroPills(ledger) {
  return ledger.events
    .filter((e) => e.importance === 3 && e.datetime_jst)
    .sort((a, b) => a.datetime_jst.localeCompare(b.datetime_jst))
    .slice(0, 3)
    .map((e) => `${e.name_ja} ${Number(e.date_jst.slice(5, 7))}/${Number(e.date_jst.slice(8, 10))}`);
}

function autoCreatedDateJa(now) {
  const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const d = new Date(jstMs);
  const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WEEKDAY_JA[d.getUTCDay()]}）`;
}

export function buildNarrative(ledger, override, now = new Date()) {
  return {
    reportMeta: override?.reportMeta || `ea-weekly-${ledger.meta.target_week_start.replace(/-/g, '')}`,
    createdDateJa: override?.createdDateJa || autoCreatedDateJa(now),
    heroSummary: override?.heroSummary || autoHeroSummary(ledger),
    heroPills: override?.heroPills || autoHeroPills(ledger),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const ledgerPathArg = args.find((a) => !a.startsWith('--'));
  const narrativeIdx = args.indexOf('--narrative');
  const narrativePath = narrativeIdx >= 0 ? args[narrativeIdx + 1] : null;
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 ? args[outIdx + 1] : null;

  if (!ledgerPathArg || !outPath) {
    console.error('usage: node scripts/render.mjs <ledger.json> --out <output.html> [--narrative <narrative.json>]');
    process.exit(1);
  }

  const ledger = JSON.parse(readFileSync(resolve(ledgerPathArg), 'utf8'));
  const override = narrativePath ? JSON.parse(readFileSync(resolve(narrativePath), 'utf8')) : null;
  const eventComments = JSON.parse(readFileSync('config/event-comments.json', 'utf8'));
  const reportPolicy = JSON.parse(readFileSync('config/report-policy.json', 'utf8'));
  const btcGuide = JSON.parse(readFileSync('config/btc-weekend-guide.json', 'utf8'));

  const narrative = buildNarrative(ledger, override);
  if (!override) {
    console.warn('警告: --narrativeが未指定のため、heroSummary/heroPillsを台帳から自動生成した（既刊のような編集judgment済みの簡潔な表現ではない。可能であれば公開前に人手で確認・上書きすること）');
  }

  const weekInput = ledgerToWeekInput(ledger, narrative, eventComments);
  const reportData = buildReportData(weekInput);
  const html = renderReportHtml(reportData, { reportPolicy, btcGuide });

  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(resolve(outPath), html);
  console.log(`render完了: ${outPath} (${html.length} bytes)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
