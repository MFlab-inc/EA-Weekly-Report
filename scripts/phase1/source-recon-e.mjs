#!/usr/bin/env node
// Phase 1 追加実測（2026-08-15、しょうさんのRBNZ・SNB一次ソース訂正＋BOC/manual-events追加指示への対応）。
// scripts/phase1/source-recon-d.mjs等と同じマナー（robots.txt先取得・許可パスのみ最小限フェッチ・1500ms間隔）を踏襲する。
//
// 対象:
// - RBNZ: 訂正後の公式URL（旧until-feb-2027ページは廃止・404）から日程再確認＋発表時刻の公式表記を実測
// - SNB: 「Time schedule」ページ（旧「一括先行公表なし」は誤りだったとしょうさんが一次ソースで訂正）から
//   ICS/iCalendarフィードリンクを抽出し、実際に取得できるか実測評価する（週次自動化の第一候補）
// - BOC: 翌年分の政策金利発表日程を年次プレスリリースで一括公表する慣行の実測確認
//
// 生データは phase1-out/ に保存（コミットしない）。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRobotsChecker } from '../lib/robots.js';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase1-source-recon-e)';
const WAIT_MS = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const log = (...a) => console.log(...a);
const section = (title) => log(`\n##### ${title} #####`);

const SOURCES = [
  {
    id: 'rbnz_policy_rate', name: 'RBNZ（訂正後URL・発表時刻実測）',
    targets: [
      { label: 'schedule_to_feb2028', url: 'https://www.rbnz.govt.nz/news-and-events/how-we-release-information/ocr-decision-dates-and-financial-stability-report-dates-to-feb-2028' },
      { label: 'aug2026_to_feb2027_release', url: 'https://www.rbnz.govt.nz/news-and-events/news/2025/10/monetary-policy-and-financial-stability-report-dates-august-2026-to-february-2027' },
      { label: 'july2026_mpr_event', url: 'https://www.rbnz.govt.nz/news-and-events/events/2026/july/july-monetary-policy-review' },
    ],
  },
  {
    id: 'snb_policy_rate', name: 'SNB（Time scheduleページ・ICSフィード実測評価）',
    targets: [
      { label: 'event_schedule', url: 'https://www.snb.ch/en/services-events/digital-services/event-schedule' },
      { label: 'digital_services', url: 'https://www.snb.ch/en/services-events/digital-services' },
      { label: 'dec2025_press_release', url: 'https://www.snb.ch/en/publications/communication/press-releases-restricted/pre_20251211' },
    ],
  },
  {
    id: 'boc_policy_rate', name: 'BOC（翌年分一括公表プレスリリースの慣行確認）',
    targets: [
      { label: 'release_2027_schedule', url: 'https://www.bankofcanada.ca/2026/07/bank-canada-publishes-2027-schedule-policy-interest-rate-announcements-other-major-publications/' },
      { label: 'release_2026_schedule', url: 'https://www.bankofcanada.ca/2025/08/bank-canada-publishes-2026-schedule-policy-interest-rate-announcements-other-major-publications/' },
    ],
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
  if (/calendar|ics/i.test(contentType || '')) return '.ics';
  if (/xml|rss/i.test(contentType || '')) return '.xml';
  if (/html/i.test(contentType || '')) return '.html';
  const m = url.match(/\.[a-z0-9]{2,5}$/i);
  return m ? m[0] : '.bin';
}

// SNBのHTMLからICS/iCalendarへのリンクを抽出する（実測評価対象。しょうさん指摘のsnb.ch/public/ical/event/...形式や
// 集約フィードを想定するが、実際のhref形式は未知のため .ics / ical / icalendar を含むリンクを広めに拾う）
function extractIcsLinks(html, baseUrl) {
  const links = new Set();
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (/\.ics(\?|$)|ical|icalendar/i.test(href)) {
      try {
        links.add(new URL(href, baseUrl).toString());
      } catch {
        // malformed href, ignore
      }
    }
  }
  return [...links];
}

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  section(`phase1 source-recon-e start ${new Date().toISOString()}`);
  const robotsChecker = createRobotsChecker({ userAgent: UA, waitMs: WAIT_MS });
  const report = { startedAt: new Date().toISOString(), sources: [], icsTests: [] };
  const icsCandidates = [];

  for (const src of SOURCES) {
    section(`SOURCE: ${src.id} (${src.name})`);
    const entry = { id: src.id, name: src.name, targets: [] };
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
          const preview = bodyText.slice(0, 3000).replace(/\s+/g, ' ');
          log(`  preview: ${preview}`);
          if (src.id === 'snb_policy_rate') {
            const found = extractIcsLinks(bodyText, t.url);
            if (found.length) {
              log(`  [ICS-LINKS] ${found.length}件発見: ${found.join(' | ')}`);
              icsCandidates.push(...found);
            } else {
              log('  [ICS-LINKS] このページにICS/icalリンクは見つからなかった');
            }
          }
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

  // SNB ICSリンクの実測評価（重複除去、最大3件に絞って取得試験）
  const uniqueIcs = [...new Set(icsCandidates)].slice(0, 3);
  section(`SNB ICSフィード実測評価（候補${uniqueIcs.length}件）`);
  if (uniqueIcs.length === 0) {
    log('[ICS] event_schedule/digital_servicesページからICS/icalリンクが見つからなかった（フォールバック判断材料）');
  }
  for (const icsUrl of uniqueIcs) {
    const verdict = await robotsChecker.isAllowed(icsUrl);
    if (!verdict.allowed) {
      log(`[ICS-SKIP-DISALLOWED] ${icsUrl} — ${verdict.reason}`);
      report.icsTests.push({ url: icsUrl, fetched: false, reason: verdict.reason });
      continue;
    }
    const res = await fetchOne(icsUrl);
    await sleep(WAIT_MS);
    if (res?.ok) {
      const bodyText = res.buf.toString('utf8');
      const isValidIcs = /BEGIN:VCALENDAR/i.test(bodyText);
      const filePath = join(OUT_DIR, `snb_ics_sample_${sha256(Buffer.from(icsUrl)).slice(0, 8)}.ics`);
      writeFileSync(filePath, res.buf);
      log(`[ICS-FETCH] ${icsUrl}: HTTP ${res.status} ${res.bytes}B ct=${res.contentType} validVCALENDAR=${isValidIcs}`);
      log(`  preview: ${bodyText.slice(0, 800).replace(/\s+/g, ' ')}`);
      report.icsTests.push({ url: icsUrl, fetched: true, status: res.status, bytes: res.bytes, contentType: res.contentType, validVCalendar: isValidIcs, savedAs: filePath });
    } else {
      log(`[ICS-FETCH-ERR] ${icsUrl}: ${res?.error || res?.status}`);
      report.icsTests.push({ url: icsUrl, fetched: false, reason: res?.error || `HTTP ${res?.status}` });
    }
  }

  writeFileSync(join(OUT_DIR, 'recon-e-report.json'), JSON.stringify(report, null, 2));
  section('SUMMARY');
  for (const s of report.sources) {
    const okCount = s.targets.filter((t) => t.fetched).length;
    log(`${s.id}: fetched=${okCount}/${s.targets.length}`);
  }
  log(`SNB ICS tests: ${report.icsTests.filter((t) => t.fetched).length}/${report.icsTests.length} fetched successfully`);
  section(`phase1 source-recon-e end ${new Date().toISOString()}`);
})();
