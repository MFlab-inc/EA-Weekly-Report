#!/usr/bin/env node
// Phase 1 追加実測その3（2026-08-15）: BOCの翌年分一括公表プレスリリース本文から
// 2026年・2027年の政策金利発表日程（全8回・09:45 ET）とMonetary Policy Report同時発表回を
// 正確に確認する（WebSearch要約では日付一覧が不完全だったため本文を直接確認する）。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRobotsChecker } from '../lib/robots.js';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase1-source-recon-g)';
const WAIT_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const section = (title) => log(`\n##### ${title} #####`);

function stripTags(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#8217;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

async function fetchOne(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(30000), redirect: 'follow' });
  const buf = Buffer.from(await res.arrayBuffer());
  return { ok: res.ok, status: res.status, bytes: buf.length, contentType: res.headers.get('content-type'), text: buf.toString('utf8') };
}

const TARGETS = [
  { id: 'release_2027_schedule', url: 'https://www.bankofcanada.ca/2026/07/bank-canada-publishes-2027-schedule-policy-interest-rate-announcements-other-major-publications/' },
  { id: 'release_2026_schedule', url: 'https://www.bankofcanada.ca/2025/08/bank-canada-publishes-2026-schedule-policy-interest-rate-announcements-other-major-publications/' },
];

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  section(`phase1 source-recon-g start ${new Date().toISOString()}`);
  const robotsChecker = createRobotsChecker({ userAgent: UA, waitMs: WAIT_MS });

  for (const t of TARGETS) {
    section(`SOURCE: ${t.id}`);
    const verdict = await robotsChecker.isAllowed(t.url);
    if (!verdict.allowed) {
      log(`[SKIP-DISALLOWED] ${t.url} — ${verdict.reason}`);
      continue;
    }
    const res = await fetchOne(t.url);
    await sleep(WAIT_MS);
    writeFileSync(join(OUT_DIR, `boc_policy_rate.${t.id}.html`), res.text);
    log(`[FETCH] HTTP ${res.status} ${res.bytes}B`);
    const bodyText = stripTags(res.text);
    // 本文中の主要段落（"The Bank" で始まる説明文以降）を広めに出力する
    const idx = bodyText.indexOf('The Bank of Canada today published');
    const excerpt = idx >= 0 ? bodyText.slice(idx, idx + 3000) : bodyText.slice(0, 3000);
    log(`  BODY EXCERPT: ${excerpt}`);
  }
  section(`phase1 source-recon-g end ${new Date().toISOString()}`);
})();
