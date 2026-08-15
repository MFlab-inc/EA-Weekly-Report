#!/usr/bin/env node
// task #47（2026-08-15）: 8/17週フルパイプライン実ネットワーク検証で、gb_onsソースから
// 「消費者物価指数（CPI）」が同一日時（2026-08-19 15:00 JST）に2件重複して出力される事象を発見。
// harness.mjsのgb_ons抽出はprimaryLabel未指定でquery=GDP・query=CPIの2ターゲットをマージする方式
// （task #41で導入）だが、両クエリのレスポンス間でrowの重複排除をしていない。
// ONS releases APIの実レスポンスを直接比較し、(a)同一リリースが両クエリに重複して現れる
// harnessマージ側の設計不備なのか、(b)実際に2件の別個のCPI関連リリースが存在するのか切り分ける
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRobotsChecker } from '../lib/robots.js';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase1-source-recon-j)';
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
    writeFileSync(join(OUT_DIR, `recon_j.${safeName}.json`), text);
    return text;
  } catch (e) {
    log(`[ERROR] ${url} -> ${e.message}`);
    return null;
  }
}

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  section(`phase1 source-recon-j start ${new Date().toISOString()}`);
  const robotsChecker = createRobotsChecker({ userAgent: UA, waitMs: WAIT_MS });

  const gdpText = await fetchAndLog(
    'gb_ons.releases_api_upcoming_gdp',
    'https://api.beta.ons.gov.uk/v1/search/releases?release-type=type-upcoming&query=GDP',
    robotsChecker
  );
  const cpiText = await fetchAndLog(
    'gb_ons.releases_api_upcoming_cpi',
    'https://api.beta.ons.gov.uk/v1/search/releases?release-type=type-upcoming&query=CPI',
    robotsChecker
  );

  for (const [label, text] of [['GDP query', gdpText], ['CPI query', cpiText]]) {
    if (!text) continue;
    try {
      const body = JSON.parse(text);
      const releases = body?.releases || [];
      log(`\n--- ${label}: total_count=${body.total_count} releases.length=${releases.length} ---`);
      for (const r of releases) {
        const d = r?.description || {};
        log(`  title="${d.title}" release_date=${d.release_date} cancelled=${d.cancelled} postponed=${d.postponed} uri=${r.uri}`);
      }
    } catch (e) {
      log(`[PARSE-ERROR] ${label}: ${e.message}`);
    }
  }

  section(`phase1 source-recon-j end ${new Date().toISOString()}`);
})();
