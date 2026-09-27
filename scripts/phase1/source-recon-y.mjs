#!/usr/bin/env node
// Phase 1 追加実測（2026-09-27、しょうさん指示: au_rba_speeches[RSS、常に最新1件のみ]が
// 総裁・副総裁級の★★★を無警告で落とす経路になっているため、RBA公式の事前予定表ページを
// gb_boe_calendar・us_frb_calendarと同じ位置づけの事前告知ソースとして追加する）。
// https://www.rba.gov.au/coming-up/index.html の実HTML構造をそのままダンプする
// （抽出器実装のfixture採取・監査記録用）。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRobotsChecker } from '../lib/robots.js';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase1-source-recon-y)';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const log = (...a) => console.log(...a);
const section = (title) => log(`\n##### ${title} #####`);

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  section(`phase1 source-recon-y start ${new Date().toISOString()}`);
  const robotsChecker = createRobotsChecker({ userAgent: UA, waitMs: 1500 });
  const url = 'https://www.rba.gov.au/coming-up/index.html';
  const verdict = await robotsChecker.isAllowed(url);
  section('ROBOTS.TXT判定');
  log(JSON.stringify(verdict));
  if (!verdict.allowed) {
    log(`[SKIP-DISALLOWED] ${url} — ${verdict.reason}`);
    return;
  }
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(30000) });
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(join(OUT_DIR, 'rba_coming_up.raw.html'), buf);
  const raw = buf.toString('utf8');
  log(`[FETCH] HTTP ${res.status} ${buf.length}B ct=${res.headers.get('content-type')} sha256=${sha256(buf)}`);

  section('FULL RAW HTML');
  log(raw);

  section(`phase1 source-recon-y end ${new Date().toISOString()}`);
})();
