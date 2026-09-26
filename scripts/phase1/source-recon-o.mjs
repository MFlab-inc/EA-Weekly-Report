#!/usr/bin/env node
// Phase 1 追加実測（2026-09-26、しょうさん指示: 9/21週FF月曜事後突合の失敗内容の裏取り）。
//
// 経緯: 2026-09-21の月曜事後突合（monday-ff-cross-check）が相違・欠落ありでrun失敗した
// （discrepancy-report.json）。しょうさん指示により、①（取りこぼし疑い）・③（時刻相違）に
// 該当する項目はFFを根拠にせず公式サイトで裏取りしてから判断する。
//
// 対象:
// - ③ BOC（マックレム総裁、9/21講演）: 台帳=11:20 ET（00:20 JST）/ FF=11:05 ET（00:05 JST）。
//   一次ソース（発表当時に確認済みの特定URL）を再確認し、11:20 ETが講演開始時刻で
//   間違いないか再検証する
// - ③ RBA（ブロック総裁、9/22講演）: 台帳=13:00 AEST（12:00 JST）/ FF=13:10 AEST（12:10 JST、
//   別人[Hunter]の講演時刻[04:00 JST]と混在）。RBA公式の speeches archive で再確認する
// - ① BOE（ベイリー総裁、9/25と推定される講演、FF独自検出）: 台帳に対応イベントが1件もない。
//   BOE公式の講演フィード・一覧ページを実ネットワーク経由で確認し、実在するか・時刻は何時かを
//   確認する（見つからない場合は「未確認」として報告し、推測で埋めない）
//
// 生データは phase1-out/ に保存（コミットしない）。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRobotsChecker } from '../lib/robots.js';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase1-source-recon-o)';
const WAIT_MS = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const log = (...a) => console.log(...a);
const section = (title) => log(`\n##### ${title} #####`);

const SOURCES = [
  {
    id: 'boc_macklem_20260921_reverify', name: 'BOC マックレム総裁9/21講演の一次ソース再確認',
    robotsHost: 'https://www.bankofcanada.ca',
    dumpTop: 3000,
    targets: [
      { label: 'advisory_page', url: 'https://www.bankofcanada.ca/2026/09/speech-tiff-macklem-governor-bank-canada-2026-09-21/' },
      { label: 'speeches_feed', url: 'https://www.bankofcanada.ca/content_type/speeches/feed/' },
    ],
    keywords: ['11:20', '11:05', 'Eastern Time', 'Macklem', 'Halifax'],
  },
  {
    id: 'rba_bullock_20260922_reverify', name: 'RBA ブロック総裁9/22講演の一次ソース再確認',
    robotsHost: 'https://www.rba.gov.au',
    dumpTop: 3000,
    targets: [
      { label: 'speeches_2026', url: 'https://www.rba.gov.au/speeches/2026/' },
      { label: 'coming_up', url: 'https://www.rba.gov.au/coming-up/index.html' },
      { label: 'schedules_calendar', url: 'https://www.rba.gov.au/schedules-events/calendar/' },
    ],
    keywords: ['Bullock', '13:00', '13:10', 'CEDA', 'Fireside'],
  },
  {
    id: 'boe_bailey_20260925_check', name: 'BOE ベイリー総裁9/25講演疑いの一次ソース確認（FF独自検出・未検証）',
    robotsHost: 'https://www.bankofengland.co.uk',
    dumpTop: 4000,
    targets: [
      { label: 'speeches_rss', url: 'https://www.bankofengland.co.uk/rss/speeches' },
      { label: 'news_speeches', url: 'https://www.bankofengland.co.uk/news/speeches' },
    ],
    keywords: ['Bailey', '25 September', 'September 2026', '18:15', '18.15'],
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
  section(`phase1 source-recon-o start ${new Date().toISOString()}`);
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
          const hits = excerptsNear(stripped, src.keywords, 250, 3);
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

  writeFileSync(join(OUT_DIR, 'recon-o-report.json'), JSON.stringify(report, null, 2));
  section('SUMMARY');
  for (const s of report.sources) {
    const okCount = s.targets.filter((t) => t.fetched).length;
    log(`${s.id}: fetched=${okCount}/${s.targets.length}`);
  }
  section(`phase1 source-recon-o end ${new Date().toISOString()}`);
})();
