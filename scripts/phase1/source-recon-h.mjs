#!/usr/bin/env node
// task #41ライブ検証（しょうさん指示2026-08-15）: task #41で追加した新規ソース群（WebSearch経由
// 確認が大半）の実タイトル・実日付・実時刻を実ネットワークで確認する。開発サンドボックスは
// 該当ドメインへの直接フェッチが軒並みブロックされるため、本スクリプトはGitHub Actions
// （実ネットワーク到達可能）上で実行し、ジョブログから結果を回収する運用とする
// （scripts/phase1/source-recon-*.mjsの既存パターンを踏襲）。
//
// PART A: annual_schedule_config型の新規ソース（jp_stat_cpi・jp_esri_gdp・jp_customs_trade・
//   eurostat_hicp・eurostat_gdp・eu_flash_pmi・gb_flash_pmi・nz_stats_cpi・nz_stats_gdp・
//   cn_nbs_data・ecb_policy_rate[accounts]・boc_policy_rate[summary]）の該当ページを生取得し、
//   本文抜粋をログ出力する（人間/Claudeが目視で日付・タイトル・時刻の一致を確認する）。
// PART B: weekly_scrape/date_api_fred型で今回kind追加した既存ソース（au_abs[gdp]・
//   gb_ons[cpi]・us_bls_fred[gdp release_id=53]）を実際の抽出関数・API呼び出しで実行し、
//   config登録済みのmatch/release_idが実データで機能することを確認する。
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRobotsChecker } from '../lib/robots.js';
import { extractAbsCalendar } from '../checkers/extractors/abs.js';
import { extractOnsReleases } from '../checkers/extractors/ons.js';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase1-source-recon-h)';
const WAIT_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const section = (title) => log(`\n##### ${title} #####`);

function stripTags(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#8217;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

async function fetchOne(url, headers = { Accept: '*/*' }) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(30000), redirect: 'follow' });
  const buf = Buffer.from(await res.arrayBuffer());
  return { ok: res.ok, status: res.status, bytes: buf.length, contentType: res.headers.get('content-type'), text: buf.toString('utf8') };
}

// PART A: 生取得して本文抜粋をログ出力するだけのターゲット一覧
const PART_A_TARGETS = [
  { id: 'jp_stat_cpi.cpi_qa_schedule_rule', url: 'https://www.stat.go.jp/data/cpi/4-1.html' },
  { id: 'jp_stat_cpi.cpi_index', url: 'https://www.stat.go.jp/data/cpi/index.html' },
  { id: 'jp_esri_gdp.sokuhou_top', url: 'https://www.esri.cao.go.jp/jp/sna/sokuhou/sokuhou_top.html' },
  { id: 'jp_esri_gdp.kouhyou_yotei', url: 'https://www.esri.cao.go.jp/jp/sna/kouhyou/kouhyou_top.html' },
  { id: 'jp_customs_trade.release_calendar', url: 'https://www.customs.go.jp/toukei/calendar/calend.htm' },
  { id: 'eurostat_hicp.release_calendar', url: 'https://ec.europa.eu/eurostat/news/release-calendar' },
  { id: 'eu_flash_pmi.press_release_hub', url: 'https://www.pmi.spglobal.com/Public/Home/PressRelease' },
  { id: 'gb_flash_pmi.release_dates_pdf', url: 'https://www.pmi.spglobal.com/Public/Home/PDF/UK_Rel_Dates' },
  { id: 'nz_stats_cpi.release_calendar', url: 'https://www.stats.govt.nz/release-calendar/' },
  { id: 'cn_nbs_data.release_calendar_en', url: 'https://www.stats.gov.cn/english/PressRelease/ReleaseCalendar/' },
  { id: 'ecb_policy_rate.accounts_index', url: 'https://www.ecb.europa.eu/press/accounts/html/index.en.html' },
  { id: 'boc_policy_rate.summary_deliberations_index', url: 'https://www.bankofcanada.ca/publications/summary-governing-council-deliberations/' },
];

async function runPartA(robotsChecker) {
  section('PART A: 生取得＋本文抜粋（annual_schedule_config新規ソース）');
  for (const t of PART_A_TARGETS) {
    section(`SOURCE: ${t.id}`);
    const verdict = await robotsChecker.isAllowed(t.url);
    if (!verdict.allowed) {
      log(`[SKIP-DISALLOWED] ${t.url} — ${verdict.reason}`);
      continue;
    }
    try {
      const res = await fetchOne(t.url);
      await sleep(WAIT_MS);
      const safeName = t.id.replace(/[^a-z0-9_.]/gi, '_');
      writeFileSync(join(OUT_DIR, `recon_h.${safeName}.html`), res.text);
      log(`[FETCH] ${t.url} -> HTTP ${res.status} ${res.bytes}B content-type=${res.contentType}`);
      const bodyText = stripTags(res.text);
      log(`  BODY EXCERPT (先頭4000字): ${bodyText.slice(0, 4000)}`);
    } catch (e) {
      log(`[ERROR] ${t.url} -> ${e.message}`);
    }
  }
}

// PART B: 既存weekly_scrape/date_api_fredソースへのkind追加を実データで検証
async function runPartB(robotsChecker) {
  section('PART B: 既存ソースへのkind追加（au_abs.gdp / gb_ons.cpi / us_bls_fred.gdp）の実データ検証');

  // au_abs: future_releases_calendarを実取得し、extractAbsCalendar()でGDP行の有無を確認
  section('SOURCE: au_abs (gdp追加の実データ確認)');
  {
    const url = 'https://www.abs.gov.au/release-calendar/future-releases-calendar';
    const verdict = await robotsChecker.isAllowed(url);
    if (!verdict.allowed) {
      log(`[SKIP-DISALLOWED] ${url} — ${verdict.reason}`);
    } else {
      try {
        const res = await fetchOne(url);
        await sleep(WAIT_MS);
        writeFileSync(join(OUT_DIR, 'recon_h.au_abs.future_releases_calendar.html'), res.text);
        log(`[FETCH] HTTP ${res.status} ${res.bytes}B`);
        const extracted = extractAbsCalendar(res.text);
        if (!extracted.ok) {
          log(`[EXTRACT-FAIL] ${extracted.reason}`);
        } else {
          log(`[EXTRACT] ${extracted.rows.length}件の行を抽出`);
          const gdpRows = extracted.rows.filter((r) => r.title.toLowerCase().includes('national accounts'));
          log(`  GDP候補行（"national accounts"含む）: ${JSON.stringify(gdpRows, null, 2)}`);
          log(`  全行タイトル一覧: ${JSON.stringify(extracted.rows.map((r) => `${r.title} @ ${r.utcInstant}`), null, 2)}`);
        }
      } catch (e) {
        log(`[ERROR] ${url} -> ${e.message}`);
      }
    }
  }

  // gb_ons: CPIクエリターゲットを実取得し、extractOnsReleases()でCPI行の有無を確認
  section('SOURCE: gb_ons (cpi追加の実データ確認)');
  {
    const url = 'https://api.beta.ons.gov.uk/v1/search/releases?release-type=type-upcoming&query=CPI';
    const verdict = await robotsChecker.isAllowed(url);
    if (!verdict.allowed) {
      log(`[SKIP-DISALLOWED] ${url} — ${verdict.reason}`);
    } else {
      try {
        const res = await fetchOne(url, { Accept: 'application/json' });
        await sleep(WAIT_MS);
        writeFileSync(join(OUT_DIR, 'recon_h.gb_ons.releases_api_upcoming_cpi.json'), res.text);
        log(`[FETCH] HTTP ${res.status} ${res.bytes}B`);
        const extracted = extractOnsReleases(res.text);
        if (!extracted.ok) {
          log(`[EXTRACT-FAIL] ${extracted.reason}`);
        } else {
          log(`[EXTRACT] ${extracted.rows.length}件の行を抽出: ${JSON.stringify(extracted.rows, null, 2)}`);
        }
      } catch (e) {
        log(`[ERROR] ${url} -> ${e.message}`);
      }
    }
  }

  // us_bls_fred: release_id=53（GDP）を実API呼び出しで確認（FRED_API_KEY必須）
  section('SOURCE: us_bls_fred (gdp release_id=53追加の実データ確認)');
  {
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey) {
      log('[SKIP] FRED_API_KEY未設定');
    } else {
      const url = new URL('https://api.stlouisfed.org/fred/release/dates');
      url.searchParams.set('release_id', '53');
      url.searchParams.set('api_key', apiKey);
      url.searchParams.set('file_type', 'json');
      url.searchParams.set('realtime_start', '2026-01-01');
      url.searchParams.set('realtime_end', '2026-12-31');
      try {
        const res = await fetchOne(url.toString(), { Accept: 'application/json' });
        await sleep(WAIT_MS);
        writeFileSync(join(OUT_DIR, 'recon_h.us_bls_fred.release_53_gdp.json'), res.text);
        log(`[FETCH] HTTP ${res.status} ${res.bytes}B`);
        log(`  BODY: ${res.text.slice(0, 3000)}`);
      } catch (e) {
        log(`[ERROR] ${url} -> ${e.message}`);
      }
    }
  }
}

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  section(`phase1 source-recon-h start ${new Date().toISOString()}`);
  const robotsChecker = createRobotsChecker({ userAgent: UA, waitMs: WAIT_MS });
  await runPartA(robotsChecker);
  await runPartB(robotsChecker);
  section(`phase1 source-recon-h end ${new Date().toISOString()}`);
})();
