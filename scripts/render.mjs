#!/usr/bin/env node
// レンダリングステップ（collect→build-ledger→renderの3段目、task #13後継の実データ接続、
// しょうさん指示2026-08-15）。data/ledger/YYYY-MM-DD.jsonをscripts/render/ledger-to-week-input.js
// で weekInput 形へ変換し、既存レンダラー（build-report-data.js・html-renderer.js、design-mock_v1.2.html
// 再現・task #12実装済み）でHTMLを生成する。
//
// heroSummary/heroPillsの生成ルール（しょうさん確定仕様2026-08-15）:
// - heroSummary: 対象週の★★★イベントの表示名から、国+kindで重複を除いた上位4件
//   （対象週内の発生順）を「、」で連結し、末尾に「を確認する週」を付ける。0件時は
//   config/report-policy.jsonのhero_summary_no_star3_text
// - heroPills: ★★★を日付順に最大3件、「{表示名} {M/D}」形式
// このスクリプトは:
// - --narrative <path> で {reportMeta?, createdDateJa?, heroSummary, heroPills} を持つJSON/JSファイルを
//   指定すれば、そちらを優先する（任意の上書き。通常は指定不要）
// - 指定が無い場合は上記ルールで自動生成する（既刊2週で検証済み。test/render.test.js参照。
//   既刊の実際の文言とは選定基準が異なるため一致しない場合がある点に注意
//   ＝既刊は複数kindを1フレーズにまとめる等の追加編集を行っているため）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildReportData } = require('./render/build-report-data.js');
const { renderReportHtml } = require('./render/html-renderer.js');
const { ledgerToWeekInput, countryJaOf } = require('./render/ledger-to-week-input.js');
const { BANK_ABBR_BY_COUNTRY } = require('./lib/naming.js');

// name_jaが既にその国の中銀略称（naming.BANK_ABBR_BY_COUNTRY、例: RBNZ/BOC/ECB/BOE/RBA/日銀）で
// 始まっている場合は国名前置を省く（2026-08-29、しょうさん指摘: 「NZRBNZ政策金利＆声明発表」
// 「カナダBOC政策金利＆声明発表」のように国名と中銀略称が重複表示されていた。naming.jsの
// policyRateName/quarterlyReportName/bojOpinionsName等が生成するname_jaは中銀略称で始まる
// テンプレートのため、これと同じ辞書[BANK_ABBR_BY_COUNTRY]を単一の真実源として使う）
function heroDisplayName(country, nameJa) {
  const bankAbbr = BANK_ABBR_BY_COUNTRY[country];
  if (bankAbbr && nameJa.startsWith(bankAbbr)) return nameJa;
  return `${countryJaOf(country)}${nameJa}`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// 対象週の★★★イベントの表示名から、国+kindで重複を除いた上位4件（対象週内の発生順）を
// 「、」で連結し、末尾に「を確認する週」を付ける（しょうさん確定仕様2026-08-15）。
// 0件時はreportPolicy.hero_summary_no_star3_text。
// datetime_jstが無い（時刻未公表）イベントはautoHeroPillsと同様に対象外とする（2026-08-15修正、
// task #41-3で発覚: `(a.datetime_jst || '').localeCompare(...)`だと空文字列が実時刻より前方に
// ソートされてしまい、時刻未確定のEU GDPが週内で最も早い発表であるかのように1位表示される実バグが
// あった。「対象週内の発生順」という仕様の趣旨上、発生順が不明なイベントを先頭に置くのは誤り）
//
// 2026-08-15追記（task #47、しょうさん監査指摘）: 表示名のみだと同一kindの別国イベント
// （例: カナダCPIと英国CPI）が「消費者物価指数（CPI）、消費者物価指数（CPI）」のように区別不能な
// まま並んでしまう（8/17週の実ネットワーク検証で発覚）。カード側の国名ピルと同じ語彙
// （ledger-to-week-input.jsのcountryJaOf・COUNTRY_JA_BY_ISO）を表示名の前に付けて解消する。
// 2026-08-29追記（しょうさん指摘）: 上記の「全件一律に前置する」方針を修正した。
// name_jaがnaming.BANK_ABBR_BY_COUNTRY（RBNZ/BOC/ECB/BOE/RBA/日銀等）で始まる場合、
// 国名前置と中銀略称が重複表示されてしまう（例:「NZRBNZ政策金利＆声明発表」
// 「カナダBOC政策金利＆声明発表」）。中銀略称は国名を代替する識別子として十分機能するため、
// この場合のみ国名前置を省く（heroDisplayName参照。停止スケジュールの国名ピル表示は
// 別ロジック[html-renderer.jsのcountryPill]でこの変更の影響を受けない）
export function autoHeroSummary(ledger, reportPolicy) {
  const star3 = ledger.events
    .filter((e) => e.importance === 3 && e.datetime_jst)
    .sort((a, b) => a.datetime_jst.localeCompare(b.datetime_jst));
  const seenCountryKind = new Set();
  const names = [];
  for (const e of star3) {
    const key = `${e.country}|${e.kind}`;
    if (seenCountryKind.has(key)) continue;
    seenCountryKind.add(key);
    names.push(heroDisplayName(e.country, e.name_ja));
    if (names.length === 4) break;
  }
  if (names.length === 0) return reportPolicy.hero_summary_no_star3_text;
  return `${names.join('、')}を確認する週`;
}

// ★★★を日付順に最大3件、「{国名}{表示名} {M/D}」形式（しょうさん確定仕様2026-08-15、
// 国名前置はtask #47で追加。autoHeroSummaryと同じ語彙・同じ「一律前置」方針）
export function autoHeroPills(ledger) {
  return ledger.events
    .filter((e) => e.importance === 3 && e.datetime_jst)
    .sort((a, b) => a.datetime_jst.localeCompare(b.datetime_jst))
    .slice(0, 3)
    .map((e) => `${heroDisplayName(e.country, e.name_ja)} ${Number(e.date_jst.slice(5, 7))}/${Number(e.date_jst.slice(8, 10))}`);
}

function autoCreatedDateJa(now) {
  const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const d = new Date(jstMs);
  const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WEEKDAY_JA[d.getUTCDay()]}）`;
}

export function buildNarrative(ledger, reportPolicy, override, now = new Date()) {
  return {
    reportMeta: override?.reportMeta || `ea-weekly-${ledger.meta.target_week_start.replace(/-/g, '')}`,
    createdDateJa: override?.createdDateJa || autoCreatedDateJa(now),
    heroSummary: override?.heroSummary || autoHeroSummary(ledger, reportPolicy),
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

  const narrative = buildNarrative(ledger, reportPolicy, override);

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
