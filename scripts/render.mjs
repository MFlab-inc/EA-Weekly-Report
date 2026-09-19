#!/usr/bin/env node
// レンダリングステップ（collect→build-ledger→renderの3段目、task #13後継の実データ接続、
// しょうさん指示2026-08-15）。data/ledger/YYYY-MM-DD.jsonをscripts/render/ledger-to-week-input.js
// で weekInput 形へ変換し、既存レンダラー（build-report-data.js・html-renderer.js、design-mock_v1.2.html
// 再現・task #12実装済み）でHTMLを生成する。
//
// heroSummary/heroPillsの生成ルール（しょうさん確定仕様2026-08-15、2026-09-12選定順を改訂）:
// - heroSummary: 対象週の★★★イベントを「重要度の高い順→同順なら時系列順」に並べ、
//   国+kindで重複を除いた上位4件を「、」で連結し、末尾に「を確認する週」を付ける。0件時は
//   config/report-policy.jsonのhero_summary_no_star3_text
// - heroPills: 同じ並び順で最大3件、「{表示名} {M/D}」形式
// - 「重要度の高い順」はconfig/report-policy.jsonのhero_kind_priority（kind配列、先頭が最優先）で
//   決まる。リストに無いkindは最下位（その他）扱い（compareByHeroPriority参照）
//
// 2026-09-12改訂（task #94、しょうさん指摘）: 従来は「対象週内の発生順」のみで上位4件を
// 選んでいたため、FOMC・BOE・日銀の政策金利が揃うような年に数回レベルの重要週でも、
// 時系列的に先に来る経済統計（カナダCPI・独ZEW等）がヒーローに入り、政策金利イベントが
// 1件もヒーローに入らないという実バグがあった（9/14週で発覚）。中銀の政策判断系
// （policy_rate/press_conference/minutes_summary/quarterly_report）を経済統計より上位に
// 置くkind優先順位をconfigへ持たせ、優先度→時系列の2段階ソートに変更した
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
// テンプレートのため、これと同じ辞書[BANK_ABBR_BY_COUNTRY]を単一の真実源として使う）。
// 2026-09-19追記（しょうさん指摘）: official_speech/press_conferenceでname_jaが既にofficials.json
// 解決済みの人名で始まっている場合（例:「シュレーゲルSNB総裁の記者会見」）も同様に冗長なため省く。
// 判定はscripts/lib/build-ledger.jsが算出済みのevent.speaker_named（docs/ledger-schema.md参照）を
// 使う（文字列側から中銀略称や人名を都度推測するのではなく、実際の名前解決結果をそのまま使う）。
// 話者が未解決で役職名のみ・汎用ラベル（「要人発言」等）にフォールバックした場合はspeaker_named=false
// のままとなり、国だけが手がかりのため国名前置を残す
function heroDisplayName(e) {
  const bankAbbr = BANK_ABBR_BY_COUNTRY[e.country];
  if (bankAbbr && e.name_ja.startsWith(bankAbbr)) return e.name_ja;
  if (e.speaker_named) return e.name_ja;
  return `${countryJaOf(e.country)}${e.name_ja}`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// hero_kind_priority配列（先頭が最優先）中のkindの順位を返す。リストに無いkindは
// 配列長（＝最下位「その他」）を返すため、その他同士は下記compareByHeroPriorityの
// 時系列タイブレークで並ぶ（task #94）
function heroKindPriorityRank(kind, priorityOrder) {
  const idx = priorityOrder.indexOf(kind);
  return idx === -1 ? priorityOrder.length : idx;
}

// 「重要度の高い順→同順なら時系列順」の比較関数（task #94、しょうさん確定仕様2026-09-12）。
// datetime_jstが無い（時刻未公表）イベントは呼び出し側で事前にフィルタ済みという前提
// （autoHeroSummary/autoHeroPills両方とも変更前から同じ前提）
function compareByHeroPriority(a, b, priorityOrder) {
  const rankDiff = heroKindPriorityRank(a.kind, priorityOrder) - heroKindPriorityRank(b.kind, priorityOrder);
  if (rankDiff !== 0) return rankDiff;
  return a.datetime_jst.localeCompare(b.datetime_jst);
}

// 対象週の★★★イベントの表示名から、国+kindで重複を除いた上位4件（重要度の高い順→
// 同順なら時系列順、task #94）を「、」で連結し、末尾に「を確認する週」を付ける
// （しょうさん確定仕様2026-08-15・選定順は2026-09-12改訂）。
// 0件時はreportPolicy.hero_summary_no_star3_text。
// datetime_jstが無い（時刻未公表）イベントはautoHeroPillsと同様に対象外とする（2026-08-15修正、
// task #41-3で発覚: `(a.datetime_jst || '').localeCompare(...)`だと空文字列が実時刻より前方に
// ソートされてしまい、時刻未確定のEU GDPが週内で最も早い発表であるかのように1位表示される実バグが
// あった。発生順が不明なイベントを優先度判定の対象に含めるのは誤りという判断は変更後も同じ）
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
  const priorityOrder = reportPolicy.hero_kind_priority || [];
  const star3 = ledger.events
    .filter((e) => e.importance === 3 && e.datetime_jst)
    .sort((a, b) => compareByHeroPriority(a, b, priorityOrder));
  const seenCountryKind = new Set();
  const names = [];
  for (const e of star3) {
    const key = `${e.country}|${e.kind}`;
    if (seenCountryKind.has(key)) continue;
    seenCountryKind.add(key);
    names.push(heroDisplayName(e));
    if (names.length === 4) break;
  }
  if (names.length === 0) return reportPolicy.hero_summary_no_star3_text;
  return `${names.join('、')}を確認する週`;
}

// ★★★を「重要度の高い順→同順なら時系列順」（task #94）に最大3件、「{国名}{表示名} {M/D}」形式
// （しょうさん確定仕様2026-08-15、国名前置はtask #47で追加。autoHeroSummaryと同じ語彙・
// 同じ「一律前置」方針・同じ優先順位）
export function autoHeroPills(ledger, reportPolicy) {
  const priorityOrder = reportPolicy.hero_kind_priority || [];
  return ledger.events
    .filter((e) => e.importance === 3 && e.datetime_jst)
    .sort((a, b) => compareByHeroPriority(a, b, priorityOrder))
    .slice(0, 3)
    .map((e) => `${heroDisplayName(e)} ${Number(e.date_jst.slice(5, 7))}/${Number(e.date_jst.slice(8, 10))}`);
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
    heroPills: override?.heroPills || autoHeroPills(ledger, reportPolicy),
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
