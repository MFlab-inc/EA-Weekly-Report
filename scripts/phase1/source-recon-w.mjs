#!/usr/bin/env node
// Phase 1 追加実測フォローアップ（2026-09-27、source-recon-vの結果を受けた補完確認）。
//
// source-recon-vで判明した論点への追加確認:
// 1) US: federalreserve.gov roster実測でJerome Powell（前議長、現理事）がofficials.json未登録と
//    判明。個人bioページで役職・在任期間を追加確認する。
// 2) AU: rba.gov.au/about-rba/people/ の実測がタイトルのみ（261文字）でAssistant Governor各氏の
//    氏名を再確認できなかった。<nav>/<header>/<footer>除去が本文まで削ってしまった疑いがあるため、
//    今回はscript/style以外は除去しないライト版クリーニングで再試行する。
// （注: 当初はAUの推測URL複数とNZ robots.txt再試行も含めていたが、次のラウンドで原因不明の
//  長時間待機が発生したため対象を上記2件のみに絞った。NZはrobots.txt自体がHTTP 403で
//  取得失敗＝確定的にブロックされていることをsource-recon-vで既に確認済みのため再試行不要と判断）
// 生データは phase1-out/ に保存（コミットしない）。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRobotsChecker } from '../lib/robots.js';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase1-source-recon-w)';
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

function stripHeavy(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ');
}
// ライト版: script/styleのみ除去（nav/header/footerは残す。前ラウンドでこれらタグ内に
// 実コンテンツが巻き込まれて消えた疑いがあるため）
function stripLight(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
}

function cleanText(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&#8217;/g, "'").replace(/\s+/g, ' ').trim();
}

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
    const stripFn = opts.light ? stripLight : stripHeavy;
    const text = cleanText(stripFn(rawHtml));
    log(`[FETCH] ${label}: HTTP ${res.status} ${res.bytes}B final=${res.finalUrl} sha256=${res.sha256.slice(0, 12)}`);
    log(`  [EXCERPT len=${text.length}]\n${contentExcerpt(text, opts)}`);
  } else {
    log(`[FETCH-ERR] ${label}: HTTP ${res?.status ?? 'ERR'} ${res?.error || ''} final=${res?.finalUrl || ''}`);
  }
}

// 前ラウンド(v)でau_rba_our_structure/monetary_policy_board/governance_boardの推測URLが
// いずれも404で、その後の待機がスケジューリング遅延なのか実際のハングなのか切り分けが
// つかなかったため、本ラウンドは既知で確実に200が返る2件のみに絞り、追加の推測URLや
// NZ再試行（robots.txt HTTP403は前ラウンドで確定的に確認済みのため再試行しない）は行わない。
const TARGETS = [
  // --- US follow-up: Jerome Powell個人bioページ（現理事としての在任情報確認） ---
  { label: 'us_frb_powell_bio', url: 'https://www.federalreserve.gov/aboutthefed/bios/board/powell.htm', maxLen: 6000 },

  // --- AU follow-up: 前ラウンドの過剰除去を疑いライト版クリーニングで再取得（既知の200 URL） ---
  { label: 'au_rba_people_light', url: 'https://www.rba.gov.au/about-rba/people/', maxLen: 20000, light: true },
];

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  section(`phase1 source-recon-w start ${new Date().toISOString()}`);
  const robotsChecker = createRobotsChecker({ userAgent: UA, waitMs: WAIT_MS });

  section('フォローアップ確認: US Powell個人bio / AU再取得（ライト版） / NZ robots再試行');
  for (const t of TARGETS) {
    await fetchAndReport(robotsChecker, t.label, t.url, { marker: t.marker, maxLen: t.maxLen, light: t.light });
  }

  section(`phase1 source-recon-w end ${new Date().toISOString()}`);
})();
