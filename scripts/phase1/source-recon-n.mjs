#!/usr/bin/env node
// Phase 1 追加実測（2026-09-19、しょうさん指摘: au-gdp-2026-09-24の誤マッピング疑いの調査）。
//
// 経緯: config/event-names.jsonのAU×gdpエントリのmatchキーワードが
// ["australian national accounts"]という広い部分一致になっており、ABS公式の
// 「Australian National Accounts: National Income, Expenditure and Product」（四半期GDP、
// 既に2026-09-02発表分をau-gdp-2026-09-02として捕捉済み）だけでなく、同じ接頭辞を持つ別リリース
// 「Australian National Accounts: Finance and Wealth」（家計・法人の資産・負債＝国富統計、
// GDPとは別物）も誤って同じgdp kindに分類してしまっている疑いがある。
//
// 本スクリプトはau_abs.access.targets（future-releases-calendar）を実ネットワークで取得し、
// 2026-09-24前後に掲載されている実際のイベント名・datetime属性を確認する（推測で済ませない）。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRobotsChecker } from '../lib/robots.js';
import { extractAbsCalendar } from '../checkers/extractors/abs.js';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase1-source-recon-n)';
const WAIT_MS = 1500;
const TARGET_URL = 'https://www.abs.gov.au/release-calendar/future-releases-calendar';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const log = (...a) => console.log(...a);

async function fetchOne(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html' },
        signal: AbortSignal.timeout(30000),
        redirect: 'follow',
      });
      const buf = Buffer.from(await res.arrayBuffer());
      return { ok: res.ok, status: res.status, ms: Date.now() - started, bytes: buf.length, buf, finalUrl: res.url };
    } catch (e) {
      if (attempt === 3) return { error: String(e.message) };
      await sleep(2000 * attempt);
    }
  }
}

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  log(`##### phase1 source-recon-n start ${new Date().toISOString()} #####`);
  const robotsChecker = createRobotsChecker({ userAgent: UA, waitMs: WAIT_MS });

  const verdict = await robotsChecker.isAllowed(TARGET_URL);
  if (!verdict.allowed) {
    log(`[SKIP-DISALLOWED] ${TARGET_URL} — ${verdict.reason}`);
    process.exit(1);
  }
  await sleep(WAIT_MS);

  const res = await fetchOne(TARGET_URL);
  if (!res?.ok) {
    log(`[FETCH-ERR] ${TARGET_URL}: ${res?.error || res?.status}`);
    process.exit(1);
  }
  const filePath = join(OUT_DIR, 'au_abs.future_releases_calendar.html');
  writeFileSync(filePath, res.buf);
  log(`[FETCH] HTTP ${res.status} ${res.bytes}B ${res.ms}ms final=${res.finalUrl}`);

  const html = res.buf.toString('utf8');
  const extracted = extractAbsCalendar(html);
  if (!extracted.ok) {
    log(`[EXTRACT-ERR] ${extracted.reason}`);
    process.exit(1);
  }
  log(`[EXTRACT] ${extracted.rows.length}件のrowを抽出`);

  log('\n##### すべてのrow（日時降順） #####');
  const sorted = [...extracted.rows].sort((a, b) => a.utcInstant.localeCompare(b.utcInstant));
  for (const r of sorted) {
    log(`  ${r.utcInstant}  ${r.title}`);
  }

  log('\n##### "national accounts"を含む行（大文字小文字不問） #####');
  const naRows = extracted.rows.filter((r) => r.title.toLowerCase().includes('national accounts'));
  for (const r of naRows) {
    log(`  utcInstant=${r.utcInstant}  title="${r.title}"`);
  }

  log('\n##### 2026-09-24前後（09-20〜09-28）のUTC日付を持つ全行 #####');
  const nearRows = extracted.rows.filter((r) => r.utcInstant >= '2026-09-20' && r.utcInstant <= '2026-09-28T23:59:59Z');
  for (const r of nearRows) {
    log(`  utcInstant=${r.utcInstant}  title="${r.title}"`);
  }

  writeFileSync(join(OUT_DIR, 'recon-n-report.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), sha256: sha256(res.buf), rows: extracted.rows }, null, 2));
  log(`\n##### phase1 source-recon-n end ${new Date().toISOString()} #####`);
})();
