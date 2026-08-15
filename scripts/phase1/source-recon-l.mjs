#!/usr/bin/env node
// task #50/52/53（2026-08-15、しょうさんのManus突合指摘・国×kind拡張）: 複数の新規調査対象を
// 一括でライブ検証する。WebSearch経由の事前調査（research agent）で発見した候補URLを実測する:
// - JP retail_sales: METI 商業動態統計（公表スケジュール・速報結果ページ）
// - DE country追加: Destatis年次カレンダー・ZEW景況感指数発表日程・Ifo業況指数・HCOB PMI
// - EU retail_sales: Eurostat個別リリースページ（"4-DDMMYYYY-ap"パターン、GDP/HICPと同じ経路B）
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRobotsChecker } from '../lib/robots.js';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase1-source-recon-l)';
const WAIT_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const section = (title) => log(`\n##### ${title} #####`);

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8217;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractAround(text, keywords, windowBefore = 100, windowAfter = 400) {
  const hits = [];
  for (const kw of keywords) {
    const re = new RegExp(kw, 'gi');
    let m;
    while ((m = re.exec(text))) {
      const start = Math.max(0, m.index - windowBefore);
      const end = Math.min(text.length, m.index + kw.length + windowAfter);
      hits.push({ keyword: kw, excerpt: text.slice(start, end) });
    }
  }
  return hits;
}

async function fetchAndLog(id, url, robotsChecker, { shiftJis = false } = {}) {
  section(`SOURCE: ${id}`);
  const verdict = await robotsChecker.isAllowed(url);
  if (!verdict.allowed) {
    log(`[SKIP-DISALLOWED] ${url} — ${verdict.reason}`);
    return null;
  }
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: '*/*' },
      signal: AbortSignal.timeout(30000),
      redirect: 'follow',
    });
    const buf = Buffer.from(await res.arrayBuffer());
    await sleep(WAIT_MS);
    log(`[FETCH] ${url} -> HTTP ${res.status} ${buf.length}B content-type=${res.headers.get('content-type')}`);
    if (!res.ok) return null;
    const text = shiftJis ? new TextDecoder('shift_jis').decode(buf) : buf.toString('utf8');
    const safeName = id.replace(/[^a-z0-9_.]/gi, '_');
    writeFileSync(join(OUT_DIR, `recon_l.${safeName}.html`), text);
    return text;
  } catch (e) {
    log(`[ERROR] ${url} -> ${e.message}`);
    return null;
  }
}

async function fetchLogText(id, url, robotsChecker, keywords, opts) {
  const text = await fetchAndLog(id, url, robotsChecker, opts);
  if (!text) return;
  const body = stripTags(text);
  log(`  BODY LENGTH (stripped): ${body.length}字`);
  if (keywords) {
    const hits = extractAround(body, keywords);
    log(`  KEYWORD HITS (${hits.length}件): ${JSON.stringify(hits, null, 2)}`);
  }
  log(`  BODY EXCERPT (先頭4000字): ${body.slice(0, 4000)}`);
}

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  section(`phase1 source-recon-l start ${new Date().toISOString()}`);
  const robotsChecker = createRobotsChecker({ userAgent: UA, waitMs: WAIT_MS });

  // ===== JP retail_sales: METI 商業動態統計 =====
  await fetchLogText(
    'jp_meti.kohyo_schedule',
    'https://www.meti.go.jp/english/statistics/kohyo.html',
    robotsChecker,
    ['[Cc]ommerce', '[Rr]etail']
  );
  await fetchLogText(
    'jp_meti.syoudou_index',
    'https://www.meti.go.jp/statistics/tyo/syoudou/index.html',
    robotsChecker,
    ['公表予定', '次回'],
    { shiftJis: true }
  );
  await fetchLogText(
    'jp_meti.syoudou_sokuho',
    'https://www.meti.go.jp/statistics/tyo/syoudou/result/sokuho_1.html',
    robotsChecker,
    ['次回', '公表'],
    { shiftJis: true }
  );

  // ===== DE country追加: Destatis =====
  await fetchLogText(
    'de_destatis.weekly_preview',
    'https://www.destatis.de/EN/Press/Dates/Weekly-Preview-Rebrush/Weeklypreview.html',
    robotsChecker,
    ['[Rr]etail', '[Gg]ross domestic', '[Cc]onsumer price']
  );
  await fetchLogText(
    'de_destatis.annual_calendar',
    'https://www.destatis.de/SiteGlobals/Forms/Suche/Termine/EN/Terminsuche_Formular.html',
    robotsChecker,
    ['[Rr]etail', '[Gg]ross domestic']
  );

  // ===== DE country追加: ZEW（強い候補、年次プレスリリースで確定日程） =====
  await fetchLogText(
    'de_zew.2026_release_dates',
    'https://www.zew.de/en/press/latest-press-releases/2026-release-dates-for-zew-indicator-of-economic-sentiment-fixed',
    robotsChecker,
    ['[Rr]elease', '2026']
  );

  // ===== DE country追加: Ifo =====
  await fetchLogText(
    'de_ifo.press',
    'https://www.ifo.de/en/press-release',
    robotsChecker,
    ['[Bb]usiness [Cc]limate', '[Rr]elease']
  );
  // task #53（しょうさん指摘: de_ifo.pressの本文にリンクとして言及されていた
  // 「Calendar of Events and Release Dates」の実URLが未確認のため、有力候補を実測する）
  await fetchLogText(
    'de_ifo.events',
    'https://www.ifo.de/en/events',
    robotsChecker,
    ['[Bb]usiness [Cc]limate', '[Rr]elease', '2026', '[Cc]alendar']
  );

  // ===== DE country追加: HCOB PMI =====
  await fetchLogText(
    'de_hcob.pmi_insights',
    'https://hcob-bank.com/en/insights/pmi/',
    robotsChecker,
    ['[Rr]elease', 'PMI', '[Ss]chedule']
  );

  // ===== task #16/53: flash PMI代替経路（レガシーIHS Markitドメイン、pmi.spglobal.comとは別ドメイン
  // のためrobots.txt 403の対象外である可能性がある。research agentが発見した候補） =====
  await fetchLogText(
    'markit_legacy.press_releases',
    'https://www.markiteconomics.com/Public/Release/PressReleases',
    robotsChecker,
    ['[Ff]lash', 'PMI', '[Gg]ermany', '[Ee]urozone']
  );

  // ===== EU retail_sales: Eurostat個別リリースページ（経路B、"4-"プレフィックス） =====
  await fetchLogText(
    'eu_eurostat.retail_route_b_20260806',
    'https://ec.europa.eu/eurostat/web/products-euro-indicators/w/4-06082026-ap',
    robotsChecker,
    ['[Nn]ext release', '[Vv]olume of retail trade']
  );

  section(`phase1 source-recon-l end ${new Date().toISOString()}`);
})();
