#!/usr/bin/env node
// task #50/51（2026-08-15、しょうさんのManus突合指摘）: gb_onsは登録済みだが雇用統計
// （employment_situation）・小売売上高（retail_sales）がkind未登録のため8/18・8/21分が欠落していた。
// 既存のquery=GDP/CPIパターンと同じONS releases APIで、雇用・小売の実タイトルを特定する
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRobotsChecker } from '../lib/robots.js';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase1-source-recon-k)';
const WAIT_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const section = (title) => log(`\n##### ${title} #####`);

async function fetchAndLog(id, url, robotsChecker) {
  section(`SOURCE: ${id}`);
  const verdict = await robotsChecker.isAllowed(url);
  if (!verdict.allowed) {
    log(`[SKIP-DISALLOWED] ${url} — ${verdict.reason}`);
    return null;
  }
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
      redirect: 'follow',
    });
    const text = await res.text();
    await sleep(WAIT_MS);
    log(`[FETCH] ${url} -> HTTP ${res.status} ${text.length}B`);
    const safeName = id.replace(/[^a-z0-9_.]/gi, '_');
    writeFileSync(join(OUT_DIR, `recon_k.${safeName}.json`), text);
    return text;
  } catch (e) {
    log(`[ERROR] ${url} -> ${e.message}`);
    return null;
  }
}

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  section(`phase1 source-recon-k start ${new Date().toISOString()}`);
  const robotsChecker = createRobotsChecker({ userAgent: UA, waitMs: WAIT_MS });

  // 複数のクエリ候補を試す（正式名称が確定していないため広めに）
  const queries = [
    ['labour', 'Labour'],
    ['employment', 'Employment'],
    ['retail', 'Retail'],
  ];

  for (const [id, q] of queries) {
    const url = `https://api.beta.ons.gov.uk/v1/search/releases?release-type=type-upcoming&query=${encodeURIComponent(q)}`;
    const text = await fetchAndLog(`gb_ons.releases_api_upcoming_${id}`, url, robotsChecker);
    if (!text) continue;
    try {
      const body = JSON.parse(text);
      const releases = body?.releases || [];
      log(`\n--- query=${q}: releases.length=${releases.length} ---`);
      for (const r of releases) {
        const d = r?.description || {};
        log(`  title="${d.title}" release_date=${d.release_date} cancelled=${d.cancelled} postponed=${d.postponed} uri=${r.uri}`);
      }
    } catch (e) {
      log(`[PARSE-ERROR] query=${q}: ${e.message}`);
    }
  }

  section(`phase1 source-recon-k end ${new Date().toISOString()}`);
})();
