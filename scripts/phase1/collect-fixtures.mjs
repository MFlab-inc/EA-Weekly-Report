#!/usr/bin/env node
// weekly_scrape／annual_schedule_config（BOJ）対象元の実データを1回だけ取得し、
// test/fixtures/official-sources/ にfixtureとしてリポジトリへ保存するためのスクリプト。
// 目的: task #9の抽出ルール実装・既刊2週の捕捉テストをオフラインで反復可能にする
// （しょうさん指示 2026-08-14「fixtureを使ってオフラインで反復・実アクセスは最小回数」）。
// GitHub Actions上で実行し、コミット・pushまでActions側で行う（開発サンドボックスは
// egressブロックのため直接フェッチできない）。
//
// マナー: robots.txt確認後のみフェッチ・1ソース1〜2ターゲット・間隔1500ms（既存のPhase1 recon方針を踏襲）
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRobotsChecker } from '../lib/robots.js';

const FIXTURE_ROOT = 'test/fixtures/official-sources';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; fixture-collection)';
const WAIT_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// config/official-sources.jsonから対象を読み込む（weekly_scrapeかつactive、およびjp_boj）
function loadTargets() {
  const config = JSON.parse(readFileSync('config/official-sources.json', 'utf8'));
  return config.sources
    .filter((s) => (s.type === 'weekly_scrape' && s.status === 'active') || s.id === 'jp_boj')
    .map((s) => ({ id: s.id, targets: s.access?.targets || [] }))
    .filter((s) => s.targets.length > 0);
}

function guessExt(contentType, url) {
  if (/pdf/i.test(contentType || '')) return '.pdf';
  if (/json/i.test(contentType || '')) return '.json';
  if (/xml|rss/i.test(contentType || '')) return '.xml';
  if (/html/i.test(contentType || '')) return '.html';
  const m = url.match(/\.[a-z0-9]{2,5}$/i);
  return m ? m[0] : '.bin';
}

async function fetchOne(url) {
  const started = Date.now();
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*' },
    signal: AbortSignal.timeout(30000),
    redirect: 'follow',
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { ok: res.ok, status: res.status, ms: Date.now() - started, bytes: buf.length, contentType: res.headers.get('content-type'), buf };
}

(async () => {
  const robotsChecker = createRobotsChecker({ userAgent: UA, waitMs: WAIT_MS });
  const sources = loadTargets();
  const manifest = { collectedAt: new Date().toISOString(), sources: [] };

  for (const src of sources) {
    console.log(`\n##### ${src.id} #####`);
    const entry = { id: src.id, files: [] };
    for (const t of src.targets) {
      const verdict = await robotsChecker.isAllowed(t.url);
      if (!verdict.allowed) {
        console.log(`[SKIP] ${t.label}: ${verdict.reason}`);
        entry.files.push({ label: t.label, url: t.url, saved: false, reason: verdict.reason });
        continue;
      }
      try {
        const res = await fetchOne(t.url);
        const ext = guessExt(res.contentType, t.url);
        const filePath = join(FIXTURE_ROOT, src.id, `${t.label}${ext}`);
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, res.buf);
        console.log(`[SAVED] ${t.label}: HTTP ${res.status} ${res.bytes}B ${res.ms}ms ct=${res.contentType} -> ${filePath}`);
        entry.files.push({ label: t.label, url: t.url, saved: true, path: filePath, status: res.status, bytes: res.bytes, contentType: res.contentType });
      } catch (e) {
        console.log(`[ERROR] ${t.label}: ${e?.message || e}`);
        entry.files.push({ label: t.label, url: t.url, saved: false, reason: String(e?.message || e) });
      }
      await sleep(WAIT_MS);
    }
    manifest.sources.push(entry);
  }

  mkdirSync(FIXTURE_ROOT, { recursive: true });
  writeFileSync(join(FIXTURE_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('\n##### DONE #####');
  console.log(JSON.stringify(manifest, null, 2));
})();
