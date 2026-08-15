#!/usr/bin/env node
// Phase 1 公式ソース実測（task #19: policy_rate担当ソース7中銀のうちBOJ以外6中銀）。
// scripts/phase1/source-recon.mjs等と同じマナー（robots.txt先取得・許可パスのみ最小限
// フェッチ・1500ms間隔）を踏襲する。
// 対象URLはWebSearch調査（2026-08-15）に基づく候補。しょうさん指示により、まず年間会合
// 日程の事前公表ページ/PDFの有無を実測する（annual_schedule_config型が使えるか確認）。
// 生データは phase1-out/ に保存（コミットしない）。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRobotsChecker } from '../lib/robots.js';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase1-source-recon-d)';
const WAIT_MS = 1500;
const ONLY_IDS = (process.argv[2] || '').split(',').map((s) => s.trim()).filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const log = (...a) => console.log(...a);
const section = (title) => log(`\n##### ${title} #####`);

const SOURCES = [
  {
    id: 'us_frb_policy_rate', name: 'FRB（FOMC政策金利カレンダー）',
    targets: [
      { label: 'fomc_calendars', url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm' },
    ],
    annualHint: 'WebSearch確認（2026-08-15）: 2026年8回（1/27-28, 3/17-18, 4/28-29, 6/16-17, 7/28-29, 9/15-16, 10/27-28, 12/8-9）。既存us_frb_speeches（理事講演）とは別物、混同しないこと',
  },
  {
    id: 'ecb_policy_rate', name: 'ECB（Governing Council政策金利カレンダー）',
    targets: [
      { label: 'gc_calendar', url: 'https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html' },
    ],
    annualHint: 'WebSearch確認: 2026年7回（3/19, 4/30, 6/11, 7/23, 9/10, 10/29, 12/17）。ユーロ圏という「国」概念とconfigのcountryフィールド設計の整合を要検討（countryを"EU"とするか等）',
  },
  {
    id: 'boe_policy_rate', name: 'BOE（MPC政策金利カレンダー）',
    targets: [
      { label: 'upcoming_mpc_dates', url: 'https://www.bankofengland.co.uk/monetary-policy/upcoming-mpc-dates' },
    ],
    annualHint: 'WebSearch確認: 専用の「upcoming MPC dates」ページが存在。年8回・毎回12:00(UK時間)発表',
  },
  {
    id: 'boc_policy_rate', name: 'BOC（政策金利発表カレンダー）',
    targets: [
      { label: 'upcoming_events', url: 'https://www.bankofcanada.ca/press/upcoming-events/' },
    ],
    annualHint: 'WebSearch確認: 年8回・9:45AM ET発表。前年に翌年分を公式プレスリリースで公表する慣行あり（例: 2025年8月に2026年分公表）',
  },
  {
    id: 'rbnz_policy_rate', name: 'RBNZ（OCR政策金利カレンダー）',
    targets: [
      { label: 'ocr_decision_dates', url: 'https://www.rbnz.govt.nz/news-and-events/how-we-release-information/monetary-policy-and-ocr-decision-dates-until-february-2027' },
    ],
    annualHint: 'WebSearch確認: 「until February 2027」という専用の先行公表ページが存在。年7回（2026-27年度は制度変更中）',
  },
  {
    id: 'snb_policy_rate', name: 'SNB（金融政策評価カレンダー）',
    targets: [
      { label: 'decisions_page', url: 'https://www.snb.ch/en/the-snb/mandates-goals/monetary-policy/decisions' },
      { label: 'data_portal_calendar', url: 'https://data.snb.ch/en/calendar' },
    ],
    annualHint: '2026-08-15追加実測: decisionsページは過去実績のみと判明（2000年まで遡るアーカイブ、将来日程なし）。WebSearchでdata.snb.ch/en/calendar（データポータル）とiCalendar配信の存在を新たに発見したため追加確認する',
  },
];

async function fetchOne(url, referer) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: '*/*', ...(referer ? { Referer: referer } : {}) },
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

function guessExt(contentType, url) {
  if (/pdf/i.test(contentType || '')) return '.pdf';
  if (/json/i.test(contentType || '')) return '.json';
  if (/xml|rss/i.test(contentType || '')) return '.xml';
  if (/html/i.test(contentType || '')) return '.html';
  const m = url.match(/\.[a-z0-9]{2,5}$/i);
  return m ? m[0] : '.bin';
}

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  section(`phase1 source-recon-d start ${new Date().toISOString()}`);
  const robotsChecker = createRobotsChecker({ userAgent: UA, waitMs: WAIT_MS });
  const report = { startedAt: new Date().toISOString(), sources: [] };

  const targetSources = ONLY_IDS.length ? SOURCES.filter((s) => ONLY_IDS.includes(s.id)) : SOURCES;
  if (ONLY_IDS.length) log(`(絞り込み実行: ${ONLY_IDS.join(', ')})`);

  for (const src of targetSources) {
    section(`SOURCE: ${src.id} (${src.name})`);
    const entry = { id: src.id, name: src.name, annualHint: src.annualHint, targets: [] };
    for (const t of src.targets) {
      const verdict = await robotsChecker.isAllowed(t.url);
      if (!verdict.allowed) {
        log(`[SKIP-DISALLOWED] ${t.label}: ${t.url} — ${verdict.reason}`);
        entry.targets.push({ label: t.label, url: t.url, fetched: false, reason: verdict.reason });
        continue;
      }
      const res = await fetchOne(t.url);
      await sleep(WAIT_MS);
      if (res?.ok) {
        const filePath = join(OUT_DIR, `${src.id}.${t.label}${guessExt(res.contentType, t.url)}`);
        writeFileSync(filePath, res.buf);
        log(`[FETCH] ${t.label}: HTTP ${res.status} ${res.bytes}B ${res.ms}ms ct=${res.contentType} final=${res.finalUrl}`);
        if (/text|json|xml|html/i.test(res.contentType || '')) {
          const preview = res.buf.toString('utf8').slice(0, 2500).replace(/\s+/g, ' ');
          log(`  preview: ${preview}`);
        } else {
          log('  (非テキストcontent-type。サイズ・到達性のみ確認)');
        }
        entry.targets.push({
          label: t.label, url: t.url, fetched: true, status: res.status, bytes: res.bytes,
          contentType: res.contentType, sha256: res.sha256, savedAs: filePath, finalUrl: res.finalUrl,
        });
      } else {
        log(`[FETCH-ERR] ${t.label}: ${res?.error || res?.status}`);
        entry.targets.push({ label: t.label, url: t.url, fetched: false, reason: res?.error || `HTTP ${res?.status}` });
      }
    }
    report.sources.push(entry);
  }

  writeFileSync(join(OUT_DIR, 'recon-d-report.json'), JSON.stringify(report, null, 2));
  section('SUMMARY');
  for (const s of report.sources) {
    const okCount = s.targets.filter((t) => t.fetched).length;
    log(`${s.id}: fetched=${okCount}/${s.targets.length}`);
  }
  section(`phase1 source-recon-d end ${new Date().toISOString()}`);
})();
