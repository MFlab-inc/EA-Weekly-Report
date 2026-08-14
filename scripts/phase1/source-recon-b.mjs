#!/usr/bin/env node
// Phase 1 公式ソース実測（優先度B・6元＋米財務省）。scripts/phase1/source-recon.mjsと同じ
// マナー（robots.txt先取得・許可パスのみ最小限フェッチ・1500ms間隔）を踏襲する。
// 対象URLはWebSearch調査（2026-08-14）に基づく候補。生データは phase1-out/ に保存（コミットしない）。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRobotsChecker } from '../lib/robots.js';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase1-source-recon-b)';
const WAIT_MS = 1500;
const ONLY_IDS = (process.argv[2] || '').split(',').map((s) => s.trim()).filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const log = (...a) => console.log(...a);
const section = (title) => log(`\n##### ${title} #####`);

// WebSearch調査（2026-08-14）で判明した候補URL。B3/B4はpmi.spglobal.com側の正確なカレンダー
// エンドポイントが未確認のため複数バリアントを試す
const SOURCES = [
  {
    id: 'us_treasury', name: '米財務省（TreasuryDirect / Fiscal Data）',
    targets: [
      { label: 'ta_ws_announced', url: 'https://www.treasurydirect.gov/TA_WS/securities/announced?format=json&type=Note' },
      { label: 'fiscaldata_upcoming', url: 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/upcoming_auctions' },
    ],
    annualHint: 'TA_WS(TreasuryDirect)・Fiscal Data APIの2系統のJSON APIが公知。6ヶ月先までのTentative Auction Schedule PDFも四半期更新',
  },
  {
    id: 'jp_mof', name: '日本財務省（MOF・JGB）',
    targets: [
      { label: 'issuance_plan_fy2026', url: 'https://www.mof.go.jp/english/policy/jgbs/issuance/index.htm' },
      { label: 'auction_calendar_index', url: 'https://www.mof.go.jp/english/policy/jgbs/auction/calendar/index.htm' },
    ],
    annualHint: '年間発行計画（毎年12月頃）＋月次入札カレンダーページ（RSS/API無し、HTML+PDF）',
  },
  {
    id: 'us_frb_speeches', name: 'FRB理事講演カレンダー',
    targets: [
      { label: 'speeches_index', url: 'https://www.federalreserve.gov/newsevents/speeches.htm' },
      { label: 'feeds_hub', url: 'https://www.federalreserve.gov/feeds/feeds.htm' },
    ],
    annualHint: '講演は個別告知型（年次一括公表ではない見込み）。feeds.htmでRSS配信の有無・実URLを確認する',
  },
  {
    id: 'cn_pmi', name: 'S&P Global（RatingDog中国PMI）',
    targets: [
      { label: 'pmi_hub', url: 'https://www.pmi.spglobal.com/Public/Home/PressReleases' },
      { label: 'rel_dates_cn', url: 'https://www.pmi.spglobal.com/Public/Home/PDF/CN_Rel_Dates' },
    ],
    annualHint: '製造業=毎月第1営業日・非製造業(Services)=第3営業日（ISM同様の規則性の可能性）。公表元はS&P Global（RatingDogは冠スポンサー）',
  },
  {
    id: 'gb_construction_pmi', name: 'S&P Global／CIPS（英建設業PMI）',
    targets: [
      { label: 'rel_dates_uk', url: 'https://www.pmi.spglobal.com/Public/Home/PDF/UK_Rel_Dates' },
    ],
    annualHint: 'WebSearchでURL候補を確認済み（未実測）。複数国のPMI発表日を横断カバーする一覧PDFの可能性',
  },
  {
    id: 'us_adp', name: 'ADP Research Institute',
    targets: [
      { label: 'calendar_top', url: 'https://adpemploymentreport.com/' },
    ],
    annualHint: 'カレンダーセクションに月次発表日を掲載（RSS/API無し、HTML）',
  },
  {
    id: 'ca_ivey', name: 'Ivey Business School（Ivey PMI）',
    targets: [
      { label: 'faq', url: 'https://iveypmi.uwo.ca/faq/' },
    ],
    annualHint: 'FAQページに年間発表日一覧（2026年1月〜12月分）が掲載されている可能性（WebSearch調査で確認）',
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
  section(`phase1 source-recon-b start ${new Date().toISOString()}`);
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
          const preview = res.buf.toString('utf8').slice(0, 2000).replace(/\s+/g, ' ');
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

  writeFileSync(join(OUT_DIR, 'recon-b-report.json'), JSON.stringify(report, null, 2));
  section('SUMMARY');
  for (const s of report.sources) {
    const okCount = s.targets.filter((t) => t.fetched).length;
    log(`${s.id}: fetched=${okCount}/${s.targets.length}`);
  }
  section(`phase1 source-recon-b end ${new Date().toISOString()}`);
})();
