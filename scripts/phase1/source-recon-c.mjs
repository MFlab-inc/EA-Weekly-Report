#!/usr/bin/env node
// Phase 1 公式ソース実測（task #15: Stats NZ・Statistics Canada 追加調査）。
// scripts/phase1/source-recon.mjs・source-recon-b.mjsと同じマナー（robots.txt先取得・
// 許可パスのみ最小限フェッチ・1500ms間隔）を踏襲する。
// 対象URLはWebSearch調査（2026-08-14、しょうさん指示の(a)API/RSS/ICS→(b)年次PDF優先）に基づく候補。
// 生データは phase1-out/ に保存（コミットしない）。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRobotsChecker } from '../lib/robots.js';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase1-source-recon-c)';
const WAIT_MS = 1500;
const ONLY_IDS = (process.argv[2] || '').split(',').map((s) => s.trim()).filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const log = (...a) => console.log(...a);
const section = (title) => log(`\n##### ${title} #####`);

const SOURCES = [
  {
    id: 'nz_statsnz', name: 'ニュージーランド統計局（Stats NZ）',
    targets: [
      { label: 'release_calendar', url: 'https://www.stats.govt.nz/release-calendar/' },
      { label: 'information_releases', url: 'https://www.stats.govt.nz/information-releases/' },
      { label: 'az_info_releases', url: 'https://www.stats.govt.nz/az-of-information-releases/' },
      { label: 'labour_market_2026q2', url: 'https://www.stats.govt.nz/information-releases/labour-market-statistics-june-2026-quarter/' },
    ],
    annualHint: 'open data API（api.stats.govt.nz）は2024-08-30に閉鎖済み（WebSearch調査で確認、(a)API系統は不可）。release-calendar/は前回実測でSPA構造（埋め込みJSONに"MonthRange"ヒントあり、裏側APIのエンドポイント未特定）。individual情報公開ページに次回発表日の予告テキストがあるパターンの有無を確認する',
  },
  {
    id: 'au_aph_economics', name: '豪州議会 下院経済委員会（Parliament of Australia, House Economics Committee）',
    targets: [
      { label: 'house_upcoming_hearings', url: 'https://www.aph.gov.au/Parliamentary_Business/Committees/House/Upcoming_Public_Hearings' },
      { label: 'house_economics_committee', url: 'https://www.aph.gov.au/Parliamentary_Business/Committees/House/Economics' },
      { label: 'rss_reps_upcoming_hearings', url: 'https://www.aph.gov.au/rss/reps/upcoming_hearings' },
      { label: 'rss_house_upcoming_hearings', url: 'https://www.aph.gov.au/rss/house/upcoming_hearings' },
    ],
    annualHint: 'RBA総裁の下院経済委員会証言（au-rba-bullock-2026-08-14、★★★）の担当ソース未定義。2026-08-14 WebSearch調査でHouse Committees: Upcoming Public Hearingsページと、Senate側で確認されたRSSパターン（/senate/rss/upcoming_hearings）のHouse版候補を発見。委員会は年2回（2月・8月頃）RBA総裁を招致する慣行があるとみられる（biannual hearings）が確定はしていない',
  },
  {
    id: 'ca_statcan', name: 'カナダ統計局（Statistics Canada）',
    targets: [
      { label: 'annual_pdf_2026', url: 'https://www150.statcan.gc.ca/n1/release-diffusion/2026-eng.pdf' },
      { label: 'annual_pdf_2026_en_path', url: 'https://www150.statcan.gc.ca/n1/en/release-diffusion/2026-eng.pdf' },
      { label: 'cal1_search_form', url: 'https://www150.statcan.gc.ca/n1/dai-quo/cal1-eng.htm' },
      { label: 'rss_feeds_index', url: 'https://www.statcan.gc.ca/en/sc/rss' },
    ],
    annualHint: 'WebSearch調査（2026-08-14）で「2026-2027 release dates Major economic releases」というタイトルのPDFが annual_pdf_2026 のURLで発見された（cal1-eng.htm自体は検索フォームで直リンク不可と既知）。RSSは"The Daily"の発表後ニュースフィードのため事前スケジュールには使えない見込みだが、念のため一覧を確認する',
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
  section(`phase1 source-recon-c start ${new Date().toISOString()}`);
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
          const preview = res.buf.toString('utf8').slice(0, 3000).replace(/\s+/g, ' ');
          log(`  preview: ${preview}`);
          const hrefs = [...res.buf.toString('utf8').matchAll(/href=["']([^"']+)["']/g)]
            .map((m) => m[1])
            .filter((h) => /\.pdf|\.ics|\.json|\.xml|rss|api/i.test(h));
          if (hrefs.length) log(`  candidate links: ${[...new Set(hrefs)].slice(0, 30).join(' | ')}`);
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

  writeFileSync(join(OUT_DIR, 'recon-c-report.json'), JSON.stringify(report, null, 2));
  section('SUMMARY');
  for (const s of report.sources) {
    const okCount = s.targets.filter((t) => t.fetched).length;
    log(`${s.id}: fetched=${okCount}/${s.targets.length}`);
  }
  section(`phase1 source-recon-c end ${new Date().toISOString()}`);
})();
