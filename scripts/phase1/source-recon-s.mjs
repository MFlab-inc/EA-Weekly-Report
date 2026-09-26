#!/usr/bin/env node
// Phase 1 追加実測（2026-09-26）: gb_boe_calendar実装のfixture採取用。
// scripts/checkers/extractors/boe-calendar.js（実装予定）が実際にパースする範囲
// （<title>タグ、および<div class="page-content"から<h2>Upcoming key publications</h2>まで）
// をそのまま生HTMLでダンプする。test/fixtures/official-sources/gb_boe_calendar/へfixtureとして
// 保存するための元データ採取（このスクリプト自体は監査記録として残す）。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRobotsChecker } from '../lib/robots.js';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase1-source-recon-s)';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const log = (...a) => console.log(...a);
const section = (title) => log(`\n##### ${title} #####`);

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  section(`phase1 source-recon-s start ${new Date().toISOString()}`);
  const robotsChecker = createRobotsChecker({ userAgent: UA, waitMs: 1500 });
  const url = 'https://www.bankofengland.co.uk/events/upcoming-events';
  const verdict = await robotsChecker.isAllowed(url);
  if (!verdict.allowed) {
    log(`[SKIP-DISALLOWED] ${url} — ${verdict.reason}`);
    return;
  }
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(30000) });
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(join(OUT_DIR, 'boe_upcoming_events.raw.html'), buf);
  const raw = buf.toString('utf8');
  log(`[FETCH] HTTP ${res.status} ${buf.length}B ct=${res.headers.get('content-type')} sha256=${sha256(buf)}`);

  const titleM = /<title>[^<]*<\/title>/.exec(raw);
  section('TITLE TAG（生HTML）');
  log(titleM ? titleM[0] : '(見つからず)');

  const startIdx = raw.indexOf('<div class="page-content"');
  const endMarker = '<h2>Upcoming key publications</h2>';
  const endIdx = raw.indexOf(endMarker);
  section(`EVENTS SECTION（startIdx=${startIdx} endIdx=${endIdx} 長さ=${endIdx - startIdx}）`);
  if (startIdx === -1 || endIdx === -1) {
    log('[WARN] 開始/終了マーカーが見つからない');
  } else {
    log(raw.slice(startIdx, endIdx + endMarker.length));
  }

  section(`phase1 source-recon-s end ${new Date().toISOString()}`);
})();
