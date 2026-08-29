#!/usr/bin/env node
// ポリシーlint＋リンク検査（task #13・SPEC.md §8「新設」）。
// 禁止語・禁止タグ・禁止セクション・免責/出典文言の存在に加え、外部リンクの到達性と
// 許可ドメインホワイトリスト（config/btc-weekend-guide.json の allowed_domains）を検査する
// （rebuild-plan §13.4注意2: 類似ドメイン事故の防止）。
// scripts/checkers/*.js と同様、軽量な正規表現ベースのHTML走査で実装する（外部HTMLパーサ非依存）。
import { readFileSync } from 'node:fs';
import { argv, exit } from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// scripts/render/ledger-to-week-input.jsの国名ピル辞書をデフォルトの検査対象コード一覧として使う
// （lintLeakedCountryCodesのデフォルト引数。呼び出し側から明示的に別辞書を渡すことも可能）。
// NZのみ意図的に「NZ」のまま日本語化しない既刊実例（validate-country-currency-coverage.jsの
// DEFAULT_RAW_CODE_ALLOWLISTと同じ理由）のため、値がコード自身と一致する国は検査対象から除外する
// （含めると正常な「NZ雇用統計」等の表記まで誤検出してしまう）
const { COUNTRY_JA_BY_ISO } = require('../render/ledger-to-week-input.js');
const DEFAULT_LEAK_CHECK_CODES = Object.entries(COUNTRY_JA_BY_ISO)
  .filter(([code, ja]) => ja !== code)
  .map(([code]) => code);

const FORBIDDEN_TAGS = ['html', 'head', 'body', 'script', 'style', 'form', 'input', 'button', 'iframe', 'object', 'embed', 'link', 'meta', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

function parseArgs(args) {
  const opts = { html: null, btcGuideConfig: 'config/btc-weekend-guide.json', reportPolicyConfig: 'config/report-policy.json', skipLinkReachability: false };
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--btc-guide-config') opts.btcGuideConfig = args[++i];
    else if (args[i] === '--report-policy-config') opts.reportPolicyConfig = args[++i];
    else if (args[i] === '--skip-link-reachability') opts.skipLinkReachability = true;
    else rest.push(args[i]);
  }
  opts.html = rest[0];
  return opts;
}

function stripTags(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
}

export function lintForbiddenTags(html) {
  const errors = [];
  for (const tag of FORBIDDEN_TAGS) {
    const re = new RegExp(`<${tag}[\\s>]`, 'i');
    if (re.test(html)) errors.push(`FORBIDDEN_HTML_TAG: <${tag}>は使用できません`);
  }
  const eventHandlerRe = /\s(on[a-z]+)\s*=/gi;
  let m;
  while ((m = eventHandlerRe.exec(html)) !== null) {
    errors.push(`INLINE_EVENT_HANDLER: イベントハンドラ属性${m[1]}は使用できません`);
  }
  return errors;
}

export function lintForbiddenTerms(text, forbiddenTerms) {
  const errors = [];
  for (const term of forbiddenTerms || []) {
    if (text.includes(term)) errors.push(`FORBIDDEN_READER_TERM: 読者向け表記に禁止語が含まれています: "${term}"`);
  }
  return errors;
}

export function lintForbiddenSections(text, forbiddenSections) {
  const errors = [];
  for (const section of forbiddenSections || []) {
    if (text.includes(section)) errors.push(`FORBIDDEN_SECTION: 禁止セクションに該当する文言が含まれています: "${section}"`);
  }
  return errors;
}

export function lintDisclaimerPresence(text, reportPolicy) {
  const errors = [];
  if (!reportPolicy.footer_disclaimer || !text.includes(reportPolicy.footer_disclaimer)) {
    errors.push('FOOTER_DISCLAIMER_MISSING: 免責文言（footer_disclaimer）がHTMLに見つかりません');
  }
  if (!reportPolicy.footer_source_statement || !text.includes(reportPolicy.footer_source_statement)) {
    errors.push('FOOTER_SOURCE_STATEMENT_MISSING: 出典表記（footer_source_statement）がHTMLに見つかりません');
  }
  return errors;
}

// 読者可視テキストへ生のISOコード（DE・GB等）が漏れていないかを検査する（task #54、
// しょうさん指摘2026-08-15: DE国追加時にCOUNTRY_JA_BY_ISOへの登録漏れで国名ピル・
// ヒーロー文言が「DE」のまま漏れ、「DEDE」と二重表示された事故の再発防止）。ポリシー上、
// 読者向けは日本語国名のみが正当（国コードはHTML属性値やdata-ea-*には出て良いが、
// タグを除去した後の可視テキストには出てはならない）。単語境界一致のため、通貨コード
// （JPY・USD等の3文字）とは衝突しない（\bJP\bは"JPY"の途中には一致しない）。
// 既知の限界: 単語境界チェックのため、リーク値の直後に区切り文字なしで別のラテン文字列が
// 続く場合（例: 修正漏れの「DE」+「ZEW景況感指数」＝"DEZEW..."）は内部に境界が無く検出できない。
// この完全な取りこぼしはscripts/lib/validate-country-currency-coverage.jsのrawCodeLeakチェック
// （辞書の値自体が生コードのままでないかを直接検証、text走査に依存しない）で捕捉する設計とし、
// 本lintはあくまで実運用上の大半のケース（ピル同士の隣接・「・」区切り等）を捉える二段目の
// 安全網と位置付ける
export function lintLeakedCountryCodes(text, countryCodes) {
  const errors = [];
  for (const code of countryCodes || []) {
    const re = new RegExp(`\\b${code}\\b`);
    const m = re.exec(text);
    if (m) errors.push(`LEAKED_COUNTRY_CODE: 読者可視テキストに生のISO国コード「${code}」が漏れています（日本語国名で表示すること。COUNTRY_JA_BY_ISO/CURRENCY_BY_COUNTRYへの登録漏れの可能性）`);
  }
  return errors;
}

// 英語イベント名の露出検出（SPEC §6「英語イベント名禁止」のvalidate対象。2026-08-29、
// しょうさん指摘: AU/gdpの手動登録エントリでdisplay_nameに公式英語名の断片
// 『Australian National Accounts』がそのまま残っていたが、forbidden_reader_terms（完全一致
// リスト）・lintLeakedCountryCodes（既知ISOコードのみ）のどちらも検出できていなかった）。
// GDP/CPI/PMI/ISM/RBNZ/BOJ/BOC等の英語略称は経済指標カレンダーの表記慣行として単体では
// 正当に使われる（本レポート自身が「ISM製造業景況指数」「RBNZ政策金利＆声明発表」のように
// 常用している）ため、単純な「ラテン文字が含まれるか」では大量の誤検知になる。
// 「大文字始まりの単語が空白を挟んで2語以上連続する」という強めのシグナルのみを検出することで、
// 単体の略称とは区別する（"Australian National Accounts"は3語連続でヒットする）。
// ただし国名ピル「NZ」＋通貨ピル「NZD」のように、全て大文字のコード同士が隣接表示されて
// 偶然「2語連続」に見えるケースは誤検知になる（NZはCOUNTRY_JA_BY_ISOで意図的に日本語化しない
// 既刊実例）。英語の地の文と全大文字コードを区別するため、2語以上のうち少なくとも1語は
// 「先頭大文字＋残り小文字」（Title Case、例: Australian）であることを追加条件とする
// （NZ・NZD・RBNZ・GDP等は全大文字のため単独ではヒットしない）。
// 検査範囲は停止スケジュール（ea-halt-day）と対象週の注目イベント（ea-date-group、
// ea-event-cardを含む）のみに限定する。土日のBTC/USDガイドの「Crypto Risk Monitor」
// 「TradingView」等の外部サイト名（しょうさん承認済み・正式名称の引用）はこれらのclassを
// 持たないため、スコープ限定により自然に対象外となる
const ENGLISH_PHRASE_RE = /\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,}\b/g;
const TITLE_CASE_WORD_RE = /^[A-Z][a-z]+$/;
const EVENT_TEXT_BLOCK_RE = /<div\b[^>]*class="(?:ea-halt-day|ea-date-group)"[^>]*>([\s\S]*?)(?=<div\b[^>]*class="(?:ea-halt-day|ea-date-group)"|<!-- ▼|$)/g;

export function lintEnglishEventNameLeak(html) {
  const errors = [];
  const seen = new Set();
  let m;
  const blockRe = new RegExp(EVENT_TEXT_BLOCK_RE);
  while ((m = blockRe.exec(html)) !== null) {
    const text = stripTags(m[1]).replace(/\s+/g, ' ');
    for (const hit of text.match(ENGLISH_PHRASE_RE) || []) {
      if (seen.has(hit)) continue;
      if (!hit.split(/\s+/).some((w) => TITLE_CASE_WORD_RE.test(w))) continue; // 全大文字コード同士の隣接は対象外
      seen.add(hit);
      errors.push(`ENGLISH_EVENT_NAME_LEAK: 停止スケジュール／注目イベントに英語表記の疑いがある文字列が含まれています（display_nameの見直しが必要な可能性、SPEC §6）: "${hit}"`);
    }
  }
  return errors;
}

// href="..." を正規表現で抽出する（軽量パーサ方針。scripts/checkers/extractors/*.jsと同様）
export function extractHrefs(html) {
  const hrefs = [];
  const re = /<a\b[^>]*\shref\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) hrefs.push(m[1]);
  return hrefs;
}

export function lintLinkDomains(hrefs, allowedDomains) {
  const errors = [];
  const allowedSet = new Set(allowedDomains || []);
  for (const href of hrefs) {
    let url;
    try {
      url = new URL(href);
    } catch {
      errors.push(`LINK_URL_INVALID: 外部リンクが有効なURLではありません: ${href}`);
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      errors.push(`LINK_PROTOCOL_INVALID: 外部リンクがhttp(s)ではありません: ${href}`);
      continue;
    }
    if (!allowedSet.has(url.hostname)) {
      errors.push(`LINK_DOMAIN_NOT_ALLOWLISTED: 許可ドメイン一覧に無いドメインへのリンクです（類似ドメイン事故防止・rebuild-plan §13.4）: ${url.hostname} (${href})`);
    }
  }
  return errors;
}

const REACHABILITY_UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; link-reachability-check)';

// UA未設定のHEADリクエストを拒否するサイトがある（実測: coinpost.jpがUA無しHEADに403を返す）ため、
// UAを明示した上でHEAD→（405/501等の場合のみ）GETの順にフォールバックする
async function fetchReachable(href, fetchImpl, timeoutMs) {
  const headers = { 'User-Agent': REACHABILITY_UA };
  let res = await fetchImpl(href, { method: 'HEAD', redirect: 'follow', headers, signal: AbortSignal.timeout(timeoutMs) });
  if (res.status === 405 || res.status === 501) {
    res = await fetchImpl(href, { method: 'GET', redirect: 'follow', headers, signal: AbortSignal.timeout(timeoutMs) });
  }
  return res;
}

// 到達性チェックはWARNING止まり（HOLDしない）。実測（2026-08-15）でcoinpost.jp等の消費者向けサイトが
// 定型的なHEAD/GETリクエストにボット対策で403を返すことを確認した。これは「リンク自体が壊れている」
// のではなく「人間のブラウザなら開けるが機械的な到達性チェックには応答しない」ケースであり、
// 週次配信のたびに誤ってHOLDになるのは実運用上の害の方が大きい。ドメインホワイトリスト照合
// （lintLinkDomains、類似ドメイン事故防止）は実害が大きいためERRORのまま維持する
export async function checkLinkReachability(hrefs, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const warnings = [];
  for (const href of hrefs) {
    try {
      const res = await fetchReachable(href, fetchImpl, timeoutMs);
      if (!res.ok) {
        warnings.push(`LINK_UNREACHABLE: HTTP ${res.status}を返しました（ボット対策等で機械チェックのみ拒否されている可能性。実際にブラウザで開けるか確認推奨）: ${href}`);
      }
    } catch (e) {
      warnings.push(`LINK_UNREACHABLE: 到達確認に失敗しました（${String(e?.message || e)}）: ${href}`);
    }
  }
  return warnings;
}

export function runStaticLint(html, { reportPolicy, btcGuide, countryCodes = DEFAULT_LEAK_CHECK_CODES }) {
  const text = stripTags(html).replace(/\s+/g, ' ').trim();
  const errors = [
    ...lintForbiddenTags(html),
    ...lintForbiddenTerms(text, reportPolicy.forbidden_reader_terms),
    ...lintForbiddenSections(text, reportPolicy.forbidden_sections),
    ...lintDisclaimerPresence(text, reportPolicy),
    ...lintLinkDomains(extractHrefs(html), btcGuide.allowed_domains),
    ...lintLeakedCountryCodes(text, countryCodes),
    ...lintEnglishEventNameLeak(html),
  ];
  return errors;
}

async function main() {
  const opts = parseArgs(argv.slice(2));
  if (!opts.html) {
    console.error('使い方: node policy-lint.mjs <html> [--btc-guide-config path] [--report-policy-config path] [--skip-link-reachability]');
    exit(2);
  }
  const html = readFileSync(opts.html, 'utf8');
  const reportPolicy = JSON.parse(readFileSync(opts.reportPolicyConfig, 'utf8'));
  const btcGuide = JSON.parse(readFileSync(opts.btcGuideConfig, 'utf8'));

  const errors = runStaticLint(html, { reportPolicy, btcGuide });
  const warnings = [];
  if (!opts.skipLinkReachability) {
    warnings.push(...(await checkLinkReachability(extractHrefs(html))));
  }

  for (const e of errors) console.log(`ERROR [${e.split(':')[0]}] ${e}`);
  for (const w of warnings) console.log(`WARNING [${w.split(':')[0]}] ${w}`);
  const status = errors.length ? '配信保留' : '配信可';
  console.log(`判定: ${status}`);
  console.log(`ERROR: ${errors.length} / WARNING: ${warnings.length}`);
  exit(errors.length ? 2 : 0);
}

if (import.meta.url === `file://${argv[1]}`) {
  main();
}
