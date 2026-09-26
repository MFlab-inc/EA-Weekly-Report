#!/usr/bin/env node
// Phase 1 追加実測（2026-09-26、しょうさん指示: gb_boe_speeches（RSS）の性質切り分け）。
//
// 経緯: source-recon-o.mjsでBOE公式講演RSS（bankofengland.co.uk/rss/speeches）を確認したところ、
// 実測日（9/26）時点の最新項目が2日前（9/24）に留まっており、事前告知ではなく実施後掲載型
// （us_frb_speechesと同種の構造的限界）の疑いが強い。しょうさん指摘: 「RSSに無い＝実在しない」と
// 断定するのは早く、以下2点を切り分ける必要がある。
//
// (a) gb_boe_speeches（RSS）自体が事前告知型か実施後掲載型か: 過去に取得したfixture
//   （2026-08-29実測、test/fixtures/official-sources/gb_boe_speeches/speeches_rss.xml）は
//   全項目が取得日より過去（7月分のみ）だった。本ラウンドでは、事前告知が載る可能性のある
//   別ページ（events/upcoming-events等）を実測し、事前掲載の実例があるか確認する
// (b) 9/25のベイリー総裁について、原稿を伴わない登壇（パネル・対談・議会証言等）の可能性を
//   BOEニュース一覧・英国議会Treasury Committeeの記録で確認する
//
// 生データは phase1-out/ に保存（コミットしない）。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRobotsChecker } from '../lib/robots.js';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase1-source-recon-p)';
const WAIT_MS = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const log = (...a) => console.log(...a);
const section = (title) => log(`\n##### ${title} #####`);

const SOURCES = [
  {
    id: 'boe_upcoming_events_check', name: 'BOE events/upcoming-events（事前告知型の疑い）を実測',
    robotsHost: 'https://www.bankofengland.co.uk',
    dumpTop: 6000,
    targets: [
      { label: 'events_upcoming_events', url: 'https://www.bankofengland.co.uk/events/upcoming-events' },
      { label: 'news_upcoming', url: 'https://www.bankofengland.co.uk/news/upcoming' },
    ],
    keywords: ['Bailey', '25 September', '24 September', '26 September', 'Lombardelli', 'Monetary Economics Conference'],
  },
  {
    id: 'uk_treasury_committee_check', name: '英国議会Treasury Committeeの9月開催予定を実測',
    robotsHost: 'https://committees.parliament.uk',
    dumpTop: 5000,
    targets: [
      { label: 'work_8621', url: 'https://committees.parliament.uk/work/8621/bank-of-england-monetary-policy-reports/?fromfind=true' },
      { label: 'committee_158', url: 'https://committees.parliament.uk/committee/158/treasury-committee/' },
    ],
    keywords: ['Bailey', '25 September', '24 September', '26 September', 'oral evidence'],
  },
];

async function fetchOne(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: '*/*' },
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
  if (/json/i.test(contentType || '')) return '.json';
  if (/xml|rss/i.test(contentType || '')) return '.xml';
  if (/html/i.test(contentType || '')) return '.html';
  const m = url.match(/\.[a-z0-9]{2,5}$/i);
  return m ? m[0] : '.bin';
}

function excerptsNear(text, keywords, radius = 250, maxPerKeyword = 3) {
  const lower = text.toLowerCase();
  const out = [];
  for (const kw of keywords) {
    let idx = 0;
    let found = 0;
    while (found < maxPerKeyword) {
      const at = lower.indexOf(kw.toLowerCase(), idx);
      if (at === -1) break;
      const start = Math.max(0, at - radius);
      const end = Math.min(text.length, at + kw.length + radius);
      out.push({ keyword: kw, excerpt: text.slice(start, end).replace(/\s+/g, ' ') });
      idx = at + kw.length;
      found += 1;
    }
  }
  return out;
}

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  section(`phase1 source-recon-p start ${new Date().toISOString()}`);
  const robotsChecker = createRobotsChecker({ userAgent: UA, waitMs: WAIT_MS });
  const report = { startedAt: new Date().toISOString(), sources: [] };

  for (const src of SOURCES) {
    section(`SOURCE: ${src.id} (${src.name})`);
    const entry = { id: src.id, name: src.name, targets: [] };

    log(`--- robots.txt: ${src.robotsHost} ---`);
    try {
      const rRes = await fetchOne(`${src.robotsHost}/robots.txt`);
      if (rRes?.ok) {
        log(`status: ${rRes.status}`);
      } else {
        log(`robots.txt取得失敗: ${rRes?.error || rRes?.status}（HTTP 404は制限なし扱い）`);
      }
    } catch (e) {
      log(`robots.txtエラー: ${String(e?.message || e)}`);
    }
    await sleep(WAIT_MS);

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
          const bodyText = res.buf.toString('utf8');
          const stripped = bodyText.replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ');
          log(`  [TOP-DUMP first ${src.dumpTop} chars]`);
          log(stripped.slice(0, src.dumpTop));
          const hits = excerptsNear(stripped, src.keywords, 300, 3);
          if (hits.length) {
            log(`  [KEYWORD-HITS] ${hits.length}件`);
            hits.forEach((h) => log(`    [${h.keyword}] ...${h.excerpt}...`));
          } else {
            log('  [KEYWORD-HITS] キーワード近傍抜粋なし');
          }
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

  writeFileSync(join(OUT_DIR, 'recon-p-report.json'), JSON.stringify(report, null, 2));
  section('SUMMARY');
  for (const s of report.sources) {
    const okCount = s.targets.filter((t) => t.fetched).length;
    log(`${s.id}: fetched=${okCount}/${s.targets.length}`);
  }
  section(`phase1 source-recon-p end ${new Date().toISOString()}`);
})();
