#!/usr/bin/env node
// Phase 1 追加実測（2026-09-27、しょうさん指示: BOEのラムスデン副総裁登録漏れを受け、
// 他7中銀（FRB/ECB/BOJ/RBA/RBNZ/BOC/SNB）について総裁・副総裁級ロスターが
// officials.jsonへ漏れなく登録されているか横断監査するための一次情報確認）。
//
// 対象: 各中銀の公式「幹部一覧／組織」ページ。BOE用source-recon-u.mjsと異なり、
// サイトごとにナビ構造が違うため、マーカー検出に失敗した場合は先頭から大きめの窓で
// 生テキストを抜き出す方式にフォールバックする。加えて<script>/<style>/<nav>/<header>/
// <footer>要素は事前に除去してノイズを減らす。
// 生データは phase1-out/ に保存（コミットしない）。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRobotsChecker } from '../lib/robots.js';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase1-source-recon-v)';
const WAIT_MS = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const log = (...a) => console.log(...a);
const section = (title) => log(`\n##### ${title} #####`);

async function fetchOne(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: '*/*' },
        signal: AbortSignal.timeout(30000),
        redirect: 'follow',
      });
      const buf = Buffer.from(await res.arrayBuffer());
      return {
        ok: res.ok, status: res.status, ms: Date.now() - started, bytes: buf.length,
        contentType: res.headers.get('content-type'), finalUrl: res.url,
        sha256: sha256(buf), buf, attempt,
      };
    } catch (e) {
      if (attempt === 3) return { error: String(e.message), attempt };
      await sleep(2000 * attempt);
    }
  }
}

// <script>/<style>/<noscript>/<nav>/<header>/<footer>要素をタグごと除去してから平文化する。
// サイトごとのメガメニュー・JSバンドルのノイズを減らし、実コンテンツが後段の窓に入りやすくする。
function stripBoilerplateTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ');
}

function cleanText(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&#8217;/g, "'").replace(/\s+/g, ' ').trim();
}

// マーカーが見つかればその直後から、見つからなければ先頭から、maxLen文字を抜き出す
// （サイトごとに固有のナビ後定型文が不明なため、マーカーはベストエフォート。
// 見つからない場合は大きめの窓で生テキストをダンプする方針＝タスク指示のフォールバック）。
function contentExcerpt(text, { marker, maxLen = 15000 } = {}) {
  let start = 0;
  if (marker) {
    const idx = text.indexOf(marker);
    if (idx >= 0) start = idx + marker.length;
  }
  return text.slice(start, start + maxLen).trim();
}

async function fetchAndReport(robotsChecker, label, url, opts = {}) {
  const verdict = await robotsChecker.isAllowed(url);
  if (!verdict.allowed) {
    log(`[SKIP-DISALLOWED] ${label}: ${url} — ${verdict.reason}`);
    return;
  }
  const res = await fetchOne(url);
  await sleep(WAIT_MS);
  if (res?.ok) {
    const filePath = join(OUT_DIR, `${label}.html`);
    writeFileSync(filePath, res.buf);
    const rawHtml = res.buf.toString('utf8');
    const text = cleanText(stripBoilerplateTags(rawHtml));
    log(`[FETCH] ${label}: HTTP ${res.status} ${res.bytes}B final=${res.finalUrl} sha256=${res.sha256.slice(0, 12)}`);
    log(`  [EXCERPT len=${text.length}]\n${contentExcerpt(text, opts)}`);
  } else {
    log(`[FETCH-ERR] ${label}: HTTP ${res?.status ?? 'ERR'} ${res?.error || ''} final=${res?.finalUrl || ''}`);
  }
}

// バンクごとのターゲット。既存officials.jsonの引用元URL（federalreserve.gov, ecb.europa.eu,
// rba.gov.au, bankofcanada.ca, snb.ch, boj.or.jpの各既知ページ）を軸に、RBNZは候補URLを
// 複数試す（正式な「leadership/people」ページのスラッグが本ラウンドでは未確定なため）。
const TARGETS = [
  // --- US: Federal Reserve Board of Governors ---
  { label: 'us_frb_board_bios_list', url: 'https://www.federalreserve.gov/aboutthefed/bios/board/default.htm', maxLen: 15000 },
  { label: 'us_frb_board_default', url: 'https://www.federalreserve.gov/aboutthefed/board-of-governors.htm', maxLen: 15000 },

  // --- EU: ECB Executive Board ---
  { label: 'eu_ecb_executive_board', url: 'https://www.ecb.europa.eu/ecb/orga/decisions/eb/html/index.en.html', maxLen: 15000 },
  { label: 'eu_ecb_governing_council', url: 'https://www.ecb.europa.eu/ecb/orga/decisions/govc/html/index.en.html', maxLen: 15000 },

  // --- JP: BOJ Policy Board (English + Japanese) ---
  { label: 'jp_boj_policyboard_en', url: 'https://www.boj.or.jp/en/about/organization/policyboard/index.htm', maxLen: 15000 },
  { label: 'jp_boj_policyboard_ja', url: 'https://www.boj.or.jp/about/organization/policyboard/index.htm', maxLen: 15000 },
  { label: 'jp_boj_about_en', url: 'https://www.boj.or.jp/en/about/organization/index.htm', maxLen: 15000 },

  // --- AU: RBA people / structure (post-2025 RBA Act reform: Monetary Policy Board / Governance Board) ---
  { label: 'au_rba_people', url: 'https://www.rba.gov.au/about-rba/people/', maxLen: 15000 },
  { label: 'au_rba_our_structure', url: 'https://www.rba.gov.au/about-rba/our-structure.html', maxLen: 15000 },
  { label: 'au_rba_monetary_policy_board', url: 'https://www.rba.gov.au/monetary-policy/monetary-policy-board.html', maxLen: 15000 },
  { label: 'au_rba_governance_board', url: 'https://www.rba.gov.au/about-rba/our-structure/governance-board.html', maxLen: 15000 },

  // --- NZ: RBNZ leadership (slug not yet confirmed — try several candidates) ---
  { label: 'nz_rbnz_our_people', url: 'https://www.rbnz.govt.nz/about-us/our-people', maxLen: 15000 },
  { label: 'nz_rbnz_leadership', url: 'https://www.rbnz.govt.nz/about-us/leadership-and-governance', maxLen: 15000 },
  { label: 'nz_rbnz_how_organised', url: 'https://www.rbnz.govt.nz/about-us/how-we-are-organised', maxLen: 15000 },
  { label: 'nz_rbnz_mpc', url: 'https://www.rbnz.govt.nz/monetary-policy/about-monetary-policy/monetary-policy-committee', maxLen: 15000 },
  { label: 'nz_rbnz_about_us', url: 'https://www.rbnz.govt.nz/about-us', maxLen: 15000 },

  // --- CA: Bank of Canada Governing Council ---
  { label: 'ca_boc_governing_council', url: 'https://www.bankofcanada.ca/about/governing-council/', maxLen: 15000 },

  // --- CH: SNB Governing Board / supervisory-management boards ---
  { label: 'ch_snb_boards', url: 'https://www.snb.ch/en/the-snb/organisation/supervisory-management-boards', maxLen: 15000 },
];

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  section(`phase1 source-recon-v start ${new Date().toISOString()}`);
  const robotsChecker = createRobotsChecker({ userAgent: UA, waitMs: WAIT_MS });

  section('主要7中銀 総裁・副総裁級ロスター一次情報確認');
  for (const t of TARGETS) {
    await fetchAndReport(robotsChecker, t.label, t.url, { marker: t.marker, maxLen: t.maxLen });
  }

  section(`phase1 source-recon-v end ${new Date().toISOString()}`);
})();
