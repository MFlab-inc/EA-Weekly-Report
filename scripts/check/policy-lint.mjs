#!/usr/bin/env node
// ポリシーlint＋リンク検査（task #13・SPEC.md §8「新設」）。
// 禁止語・禁止タグ・禁止セクション・免責/出典文言の存在に加え、外部リンクの到達性と
// 許可ドメインホワイトリスト（config/btc-weekend-guide.json の allowed_domains）を検査する
// （rebuild-plan §13.4注意2: 類似ドメイン事故の防止）。
// scripts/checkers/*.js と同様、軽量な正規表現ベースのHTML走査で実装する（外部HTMLパーサ非依存）。
import { readFileSync } from 'node:fs';
import { argv, exit } from 'node:process';

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

export function runStaticLint(html, { reportPolicy, btcGuide }) {
  const text = stripTags(html).replace(/\s+/g, ' ').trim();
  const errors = [
    ...lintForbiddenTags(html),
    ...lintForbiddenTerms(text, reportPolicy.forbidden_reader_terms),
    ...lintForbiddenSections(text, reportPolicy.forbidden_sections),
    ...lintDisclaimerPresence(text, reportPolicy),
    ...lintLinkDomains(extractHrefs(html), btcGuide.allowed_domains),
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
