#!/usr/bin/env node
// Phase 1 追加実測その2（2026-08-15）: SNB event_schedule.htmlのICSリンク周辺のHTML構造を確認し、
// 「どのICSがMonetary policy assessment/Summary of monetary policy discussionか」をタイトル・日付付きで
// 特定する。あわせて対象イベントのICS本文を全文取得し、DTSTART/SUMMARYで発表時刻を裏取りする。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRobotsChecker } from '../lib/robots.js';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase1-source-recon-f)';
const WAIT_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const section = (title) => log(`\n##### ${title} #####`);

async function fetchOne(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(30000), redirect: 'follow' });
  const buf = Buffer.from(await res.arrayBuffer());
  return { ok: res.ok, status: res.status, bytes: buf.length, contentType: res.headers.get('content-type'), text: buf.toString('utf8') };
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  section(`phase1 source-recon-f start ${new Date().toISOString()}`);
  const robotsChecker = createRobotsChecker({ userAgent: UA, waitMs: WAIT_MS });
  const url = 'https://www.snb.ch/en/services-events/digital-services/event-schedule';

  const verdict = await robotsChecker.isAllowed(url);
  if (!verdict.allowed) {
    log(`[SKIP-DISALLOWED] ${url} — ${verdict.reason}`);
    return;
  }
  const page = await fetchOne(url);
  await sleep(WAIT_MS);
  writeFileSync(join(OUT_DIR, 'snb_policy_rate.event_schedule_full.html'), page.text);
  log(`[FETCH] event_schedule: HTTP ${page.status} ${page.bytes}B`);

  // 各.icsリンクの直前1200文字（タグ除去後400文字相当）を「イベントブロック」として抽出する
  const re = /href\s*=\s*["']([^"']+\.ics[^"']*)["']/gi;
  let m;
  const blocks = [];
  while ((m = re.exec(page.text)) !== null) {
    const icsHref = m[1];
    const start = Math.max(0, m.index - 1500);
    const contextHtml = page.text.slice(start, m.index);
    const contextText = stripTags(contextHtml).slice(-500); // 直前500文字（タグ除去後）
    blocks.push({ icsUrl: new URL(icsHref, url).toString(), contextText });
  }
  section(`イベントブロック抽出（${blocks.length}件、先頭30件を表示）`);
  blocks.slice(0, 30).forEach((b, i) => {
    log(`[${i}] ${b.icsUrl}`);
    log(`    context: ...${b.contextText}`);
  });

  // "Monetary policy assessment" または "Summary of monetary policy discussion" を含むブロックを抽出
  const targets = blocks.filter((b) => /monetary policy assessment|summary of monetary policy discussion/i.test(b.contextText));
  section(`対象イベント（Monetary policy assessment / Summary of monetary policy discussion）: ${targets.length}件`);
  for (const t of targets) {
    log(`- ${t.icsUrl}`);
    log(`  context: ...${t.contextText}`);
  }

  // 対象イベントのICS本文を全文取得してDTSTART/SUMMARYを確認（最大12件、politeness優先）
  section('対象イベントのICS本文実測（DTSTART/SUMMARY確認）');
  const icsResults = [];
  for (const t of targets.slice(0, 12)) {
    const v = await robotsChecker.isAllowed(t.icsUrl);
    if (!v.allowed) {
      log(`[SKIP] ${t.icsUrl} — ${v.reason}`);
      continue;
    }
    const res = await fetchOne(t.icsUrl);
    await sleep(WAIT_MS);
    const summaryM = /SUMMARY:([^\r\n]+)/.exec(res.text);
    const dtstartM = /DTSTART[^:]*:([^\r\n]+)/.exec(res.text);
    const dtendM = /DTEND[^:]*:([^\r\n]+)/.exec(res.text);
    const tzidM = /DTSTART;TZID=([^:]+):/.exec(res.text);
    log(`[ICS] ${t.icsUrl}`);
    log(`  SUMMARY=${summaryM?.[1] || '(none)'} DTSTART=${dtstartM?.[1] || '(none)'} TZID=${tzidM?.[1] || '(none)'} DTEND=${dtendM?.[1] || '(none)'}`);
    icsResults.push({ url: t.icsUrl, summary: summaryM?.[1], dtstart: dtstartM?.[1], dtend: dtendM?.[1], tzid: tzidM?.[1], fullText: res.text });
  }

  writeFileSync(join(OUT_DIR, 'recon-f-report.json'), JSON.stringify({ blockCount: blocks.length, targetCount: targets.length, icsResults }, null, 2));
  section(`phase1 source-recon-f end ${new Date().toISOString()}`);
})();
