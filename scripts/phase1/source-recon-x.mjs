#!/usr/bin/env node
// Phase 1 追加実測（2026-09-27、しょうさん指摘・確認事項への対応）。
// (a) RBA副総裁ハウザー氏の就任日: officials.json記載（2024-09-16）としょうさん報告
//     （2024年2月12日就任）に食い違いがあるため、しょうさんご提供のURL（rba.gov.au公式）で
//     再確認する
// (b) ECBシュナーベル専務理事の個人bioページで正式な着任日を確認する（8中銀棚卸しで
//     ロスターページのみ確認済み、個人ページ未取得）
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRobotsChecker } from '../lib/robots.js';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase1-source-recon-x)';
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

const TARGETS = [
  { label: 'rba_gov', url: 'https://www.rba.gov.au/about-rba/people/gov.html' },
  { label: 'rba_deputy_gov', url: 'https://www.rba.gov.au/about-rba/people/deputy-gov.html' },
  { label: 'ecb_schnabel', url: 'https://www.ecb.europa.eu/ecb/orga/decisions/eb/html/schnabel.en.html' },
];

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  section(`phase1 source-recon-x start ${new Date().toISOString()}`);
  const robotsChecker = createRobotsChecker({ userAgent: UA, waitMs: WAIT_MS });

  for (const t of TARGETS) {
    const verdict = await robotsChecker.isAllowed(t.url);
    if (!verdict.allowed) {
      log(`[SKIP-DISALLOWED] ${t.label}: ${t.url} — ${verdict.reason}`);
      continue;
    }
    const res = await fetchOne(t.url);
    await sleep(WAIT_MS);
    if (res?.ok) {
      const filePath = join(OUT_DIR, `${t.label}.html`);
      writeFileSync(filePath, res.buf);
      const text = cleanText(res.buf.toString('utf8'));
      log(`[FETCH] ${t.label}: HTTP ${res.status} ${res.bytes}B final=${res.finalUrl} sha256=${res.sha256}`);
      log(`  [DUMP first 4000 chars]\n${text.slice(0, 4000)}`);
    } else {
      log(`[FETCH-ERR] ${t.label}: HTTP ${res?.status ?? 'ERR'} ${res?.error || ''}`);
    }
  }

  section(`phase1 source-recon-x end ${new Date().toISOString()}`);
})();
