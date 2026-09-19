#!/usr/bin/env node
// Phase 1 追加実測（2026-09-19、しょうさん指摘: サンドボックスのネットワーク制限を理由に
// 米フラッシュPMI・EIA週間石油在庫・NY連銀総裁講演の調査を先送りしたことへの差し戻し。
// 過去のsource-recon-*.mjsと同じマナー（robots.txt先取得・許可パスのみ最小限フェッチ・
// 1500ms間隔）で、GitHub Actions実ネットワーク経由で実測する。
//
// 対象:
// - 米フラッシュPMI: pmi.spglobal.com（DE/EU/GB flash PMIで既に4経路不成立と確定済みだが、
//   週次自動化ではなく一回限りの日付・時刻確認が目的のため改めて試行する）。UKの
//   PDF/UK_Rel_Dates と同型のUS版URLも試す
// - EIA週間石油在庫統計（Weekly Petroleum Status Report）: 発表スケジュールページ
// - NY連銀総裁講演: 講演一覧ページ・RSS候補
//
// 生データは phase1-out/ に保存（コミットしない）。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRobotsChecker } from '../lib/robots.js';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase1-source-recon-m)';
const WAIT_MS = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const log = (...a) => console.log(...a);
const section = (title) => log(`\n##### ${title} #####`);

const SOURCES = [
  {
    id: 'us_flash_pmi', name: '米フラッシュPMI（S&P Global）日程・時刻実測',
    robotsHost: 'https://www.pmi.spglobal.com',
    targets: [
      { label: 'press_release_hub', url: 'https://www.pmi.spglobal.com/Public/Home/PressRelease' },
      { label: 'us_rel_dates_pdf', url: 'https://www.pmi.spglobal.com/Public/Home/PDF/US_Rel_Dates' },
      { label: 'uk_rel_dates_pdf_forcompare', url: 'https://www.pmi.spglobal.com/Public/Home/PDF/UK_Rel_Dates' },
    ],
    keywords: ['september', 'flash', 'u.s.', 'united states', 'composite', 'manufacturing', 'embargo'],
  },
  {
    id: 'us_eia_weekly_petroleum', name: 'EIA週間石油在庫統計 発表スケジュール実測',
    robotsHost: 'https://www.eia.gov',
    targets: [
      { label: 'weekly_supply_top', url: 'https://www.eia.gov/petroleum/supply/weekly/' },
      { label: 'weekly_schedule', url: 'https://www.eia.gov/petroleum/weekly/schedule.php' },
      { label: 'wpsr_includes_schedule', url: 'https://www.eia.gov/petroleum/weekly/includes/schedule.php' },
    ],
    keywords: ['10:30', 'wednesday', 'thursday', 'holiday', 'release schedule', 'a.m.'],
  },
  {
    id: 'us_nyfed_speeches', name: 'NY連銀総裁講演 一覧ページ・RSS候補実測',
    robotsHost: 'https://www.newyorkfed.org',
    targets: [
      { label: 'speeches_index', url: 'https://www.newyorkfed.org/newsevents/speeches' },
      { label: 'speeches_index_2026', url: 'https://www.newyorkfed.org/newsevents/speeches/2026' },
      { label: 'rss_speeches_guess', url: 'https://www.newyorkfed.org/rss/speeches' },
      { label: 'events_index', url: 'https://www.newyorkfed.org/newsevents/events' },
    ],
    keywords: ['williams', 'speech', 'rss', 'feed', 'application/rss'],
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

// キーワード近傍のテキストを抜粋する（HTML/PDFテキスト双方に使う簡易実装）
function excerptsNear(text, keywords, radius = 250, maxPerKeyword = 2) {
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
  section(`phase1 source-recon-m start ${new Date().toISOString()}`);
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
        log(rRes.buf.toString('utf8').slice(0, 2000));
      } else {
        log(`robots.txt取得失敗: ${rRes?.error || rRes?.status}`);
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
          const preview = bodyText.slice(0, 1500).replace(/\s+/g, ' ');
          log(`  preview: ${preview}`);
          const hits = excerptsNear(bodyText.replace(/<[^>]+>/g, ' '), src.keywords);
          if (hits.length) {
            log(`  [KEYWORD-HITS] ${hits.length}件`);
            hits.forEach((h) => log(`    [${h.keyword}] ...${h.excerpt}...`));
          } else {
            log('  [KEYWORD-HITS] キーワード近傍抜粋なし');
          }
        } else {
          log(`  (非テキストcontent-type=${res.contentType}。サイズ・到達性のみ確認。PDF等は別途手動確認が必要)`);
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

  writeFileSync(join(OUT_DIR, 'recon-m-report.json'), JSON.stringify(report, null, 2));
  section('SUMMARY');
  for (const s of report.sources) {
    const okCount = s.targets.filter((t) => t.fetched).length;
    log(`${s.id}: fetched=${okCount}/${s.targets.length}`);
  }
  section(`phase1 source-recon-m end ${new Date().toISOString()}`);
})();
