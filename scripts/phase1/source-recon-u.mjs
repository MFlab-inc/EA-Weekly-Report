#!/usr/bin/env node
// Phase 1 追加実測（2026-09-27、しょうさん指示: 9/28週のラムスデン副総裁講演★★★欠落を受け、
// BOE要人（総裁・副総裁4職・チーフエコノミスト・MPC外部委員）をofficials.jsonへ正しく登録する
// ための一次情報確認）。
//
// 対象: BOEの役職別ロスター（Governors/Monetary Policy Committee/Financial Policy Committee）と、
// 今回のgb_boe_calendar実測でWARNとなった9名＋既知の副総裁3名の個人bioページ。
// 生データは phase1-out/ に保存（コミットしない）。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRobotsChecker } from '../lib/robots.js';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase1-source-recon-u)';
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

function cleanText(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

// ナビゲーションのメガメニュー（全ページ共通・長大）を読み飛ばし、実コンテンツの直前に
//必ず現れる検索ウィジェットの定型文以降を抜き出す（前ラウンドで固定4000文字窓が
// ナビ分に消費され実コンテンツへ届かないケースがあったため、マーカー基準に変更）
const CONTENT_MARKER = 'Please enter a search term.';
function contentExcerpt(text, maxLen = 6000) {
  const idx = text.lastIndexOf(CONTENT_MARKER);
  const start = idx >= 0 ? idx + CONTENT_MARKER.length : 0;
  return text.slice(start, start + maxLen).trim();
}

const ROSTER_TARGETS = [
  { label: 'governors', url: 'https://www.bankofengland.co.uk/about/people/governors' },
  { label: 'monetary_policy_committee', url: 'https://www.bankofengland.co.uk/about/people/monetary-policy-committee' },
  { label: 'financial_policy_committee', url: 'https://www.bankofengland.co.uk/about/people/financial-policy-committee' },
];

// 個人bioページ。スラッグは実測で確定させる（404なら別表記の可能性ありとしてSKIP扱いにする）。
// 前ラウンド（2026-09-27）実測: dave-ramsdenは404、david-ramsden（しょうさん提供URL）で確認要。
// catherine-l-mann/alan-m-taylorも404だったため別表記を試す
const BIO_TARGETS = [
  { label: 'david-ramsden', url: 'https://www.bankofengland.co.uk/about/people/david-ramsden/biography' },
  { label: 'clare-lombardelli', url: 'https://www.bankofengland.co.uk/about/people/clare-lombardelli/biography' },
  { label: 'sarah-breeden', url: 'https://www.bankofengland.co.uk/about/people/sarah-breeden/biography' },
  { label: 'katharine-braddick', url: 'https://www.bankofengland.co.uk/about/people/katharine-braddick/biography' },
  { label: 'huw-pill', url: 'https://www.bankofengland.co.uk/about/people/huw-pill/biography' },
  { label: 'catherine-mann', url: 'https://www.bankofengland.co.uk/about/people/catherine-mann/biography' },
  { label: 'catherine-l-mann', url: 'https://www.bankofengland.co.uk/about/people/catherine-l-mann/biography' },
  { label: 'alan-taylor', url: 'https://www.bankofengland.co.uk/about/people/alan-taylor/biography' },
  { label: 'nathanael-benjamin', url: 'https://www.bankofengland.co.uk/about/people/nathanael-benjamin/biography' },
  { label: 'sasha-mills', url: 'https://www.bankofengland.co.uk/about/people/sasha-mills/biography' },
  { label: 'victoria-saporta', url: 'https://www.bankofengland.co.uk/about/people/victoria-saporta/biography' },
  { label: 'phil-evans', url: 'https://www.bankofengland.co.uk/about/people/phil-evans/biography' },
  { label: 'philip-evans', url: 'https://www.bankofengland.co.uk/about/people/philip-evans/biography' },
];

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  section(`phase1 source-recon-u start ${new Date().toISOString()}`);
  const robotsChecker = createRobotsChecker({ userAgent: UA, waitMs: WAIT_MS });

  section('PART1: ロスターページ（Governors/MPC/FPC）');
  for (const t of ROSTER_TARGETS) {
    const verdict = await robotsChecker.isAllowed(t.url);
    if (!verdict.allowed) {
      log(`[SKIP-DISALLOWED] ${t.label}: ${t.url} — ${verdict.reason}`);
      continue;
    }
    const res = await fetchOne(t.url);
    await sleep(WAIT_MS);
    if (res?.ok) {
      const filePath = join(OUT_DIR, `roster_${t.label}.html`);
      writeFileSync(filePath, res.buf);
      const text = cleanText(res.buf.toString('utf8'));
      log(`[FETCH] ${t.label}: HTTP ${res.status} ${res.bytes}B final=${res.finalUrl}`);
      // ページタイトル直後〜3000文字（役職一覧が載る本文冒頭部分）を抜粋
      log(`  [EXCERPT]\n${contentExcerpt(text, 6000)}`);
    } else {
      log(`[FETCH-ERR] ${t.label}: HTTP ${res?.status ?? 'ERR'} ${res?.error || ''}`);
    }
  }

  section('PART2: 個人bioページ（肩書確認）');
  for (const t of BIO_TARGETS) {
    const verdict = await robotsChecker.isAllowed(t.url);
    if (!verdict.allowed) {
      log(`[SKIP-DISALLOWED] ${t.label}: ${t.url} — ${verdict.reason}`);
      continue;
    }
    const res = await fetchOne(t.url);
    await sleep(WAIT_MS);
    if (res?.ok) {
      const filePath = join(OUT_DIR, `bio_${t.label}.html`);
      writeFileSync(filePath, res.buf);
      const text = cleanText(res.buf.toString('utf8'));
      log(`[FETCH] ${t.label}: HTTP ${res.status} ${res.bytes}B final=${res.finalUrl}`);
      log(`  [EXCERPT]\n${contentExcerpt(text, 3000)}`);
    } else {
      log(`[FETCH-ERR] ${t.label}: HTTP ${res?.status ?? 'ERR'} ${res?.error || ''}`);
    }
  }

  section(`phase1 source-recon-u end ${new Date().toISOString()}`);
})();
