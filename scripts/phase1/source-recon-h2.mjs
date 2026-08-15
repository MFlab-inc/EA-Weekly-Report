#!/usr/bin/env node
// task #41ライブ検証その2（2026-08-15）: source-recon-h.mjsの1回目実行で判明した2つの問題を修正した
// 追撃実測。
// 1) jp_stat_cpi・jp_customs_trade（stat.go.jp・customs.go.jp）はShift_JISエンコードのページで、
//    1回目はUTF-8として読んだため文字化けした（TextDecoder('shift_jis')で正しくデコードする）
// 2) ecb_policy_rate（accounts索引）・boc_policy_rate（summary索引）は1回目の4000字抜粋が
//    ナビゲーションメニューで埋まり本文（実際の日程一覧）に到達できなかった（抜粋を拡大し、
//    かつ本文中のアンカーキーワード周辺を優先的に抜き出す）
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRobotsChecker } from '../lib/robots.js';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase1-source-recon-h2)';
const WAIT_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const section = (title) => log(`\n##### ${title} #####`);

function stripTags(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#8217;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

async function fetchRaw(url, headers = { Accept: '*/*' }) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(30000), redirect: 'follow' });
  const buf = Buffer.from(await res.arrayBuffer());
  return { ok: res.ok, status: res.status, bytes: buf.length, contentType: res.headers.get('content-type'), buf };
}

function decodeShiftJis(buf) {
  try {
    return new TextDecoder('shift_jis').decode(buf);
  } catch (e) {
    return `[Shift_JIS decode failed: ${e.message}] ` + buf.toString('utf8');
  }
}

const SJIS_TARGETS = [
  { id: 'jp_stat_cpi.cpi_qa_schedule_rule', url: 'https://www.stat.go.jp/data/cpi/4-1.html' },
  { id: 'jp_stat_cpi.cpi_index', url: 'https://www.stat.go.jp/data/cpi/index.html' },
  { id: 'jp_customs_trade.release_calendar', url: 'https://www.customs.go.jp/toukei/calendar/calend.htm' },
];

const DEEP_TARGETS = [
  { id: 'ecb_policy_rate.accounts_index', url: 'https://www.ecb.europa.eu/press/accounts/html/index.en.html', anchors: ['next release', 'Meeting of', '2026'] },
  { id: 'boc_policy_rate.summary_deliberations_index', url: 'https://www.bankofcanada.ca/publications/summary-governing-council-deliberations/', anchors: ['Summary of Governing Council', 'Fixed announcement date', '2026'] },
];

async function runSjis(robotsChecker) {
  section('PART C: Shift_JISページの再取得（1回目は文字化けした）');
  for (const t of SJIS_TARGETS) {
    section(`SOURCE: ${t.id}`);
    const verdict = await robotsChecker.isAllowed(t.url);
    if (!verdict.allowed) {
      log(`[SKIP-DISALLOWED] ${t.url} — ${verdict.reason}`);
      continue;
    }
    try {
      const res = await fetchRaw(t.url);
      await sleep(WAIT_MS);
      const text = decodeShiftJis(res.buf);
      const safeName = t.id.replace(/[^a-z0-9_.]/gi, '_');
      writeFileSync(join(OUT_DIR, `recon_h2.${safeName}.sjis.html`), text, 'utf8');
      log(`[FETCH] ${t.url} -> HTTP ${res.status} ${res.bytes}B`);
      const bodyText = stripTags(text);
      log(`  BODY EXCERPT (先頭6000字、Shift_JISデコード後): ${bodyText.slice(0, 6000)}`);
    } catch (e) {
      log(`[ERROR] ${t.url} -> ${e.message}`);
    }
  }
}

async function runDeep(robotsChecker) {
  section('PART D: ECB Accounts索引・BOC Summary索引の深掘り（本文アンカー周辺抽出）');
  for (const t of DEEP_TARGETS) {
    section(`SOURCE: ${t.id}`);
    const verdict = await robotsChecker.isAllowed(t.url);
    if (!verdict.allowed) {
      log(`[SKIP-DISALLOWED] ${t.url} — ${verdict.reason}`);
      continue;
    }
    try {
      const res = await fetchRaw(t.url);
      await sleep(WAIT_MS);
      const text = res.buf.toString('utf8');
      const safeName = t.id.replace(/[^a-z0-9_.]/gi, '_');
      writeFileSync(join(OUT_DIR, `recon_h2.${safeName}.html`), text, 'utf8');
      log(`[FETCH] ${t.url} -> HTTP ${res.status} ${res.bytes}B`);
      const bodyText = stripTags(text);
      log(`  BODY LENGTH (stripped): ${bodyText.length}字`);
      for (const anchor of t.anchors) {
        const idx = bodyText.toLowerCase().indexOf(anchor.toLowerCase());
        if (idx < 0) {
          log(`  [ANCHOR NOT FOUND] "${anchor}"`);
        } else {
          log(`  [ANCHOR "${anchor}" @${idx}]: ${bodyText.slice(Math.max(0, idx - 200), idx + 1500)}`);
        }
      }
    } catch (e) {
      log(`[ERROR] ${t.url} -> ${e.message}`);
    }
  }
}

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  section(`phase1 source-recon-h2 start ${new Date().toISOString()}`);
  const robotsChecker = createRobotsChecker({ userAgent: UA, waitMs: WAIT_MS });
  await runSjis(robotsChecker);
  await runDeep(robotsChecker);
  section(`phase1 source-recon-h2 end ${new Date().toISOString()}`);
})();
