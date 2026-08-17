#!/usr/bin/env node
// task #46（2026-08-15、しょうさん指示）: EU GDP(eurostat_gdp)の時刻null・日程限定的問題について、
// ECB statscal配下にGDP相当の静的ページが無いことが判明した後の第三の経路をライブ検証する。
// 経路A: Eurostat自身が公開する年間骨格PDF（QNA_release_calendar.pdf、"Overview on Main
//        Aggregates releases"）。本文に"PROVISIONAL until confirmed by the Eurostat weekly
//        release calendar"と明記されているとのことで確度は中扱い、経路Bで裏取りする方針
// 経路B: Eurostat GDPニュースリリース本文（URL日付スタンプ規則 2-DDMMYYYY-ap/bp）に埋め込まれた
//        "Next release: ..."等の直近確定日程の記述
// PDFのテキスト抽出はscripts/checkers/extractors/statcan.js（task #15）と同じくpdf-parseを使う
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRobotsChecker } from '../lib/robots.js';
import pdf from 'pdf-parse';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase1-source-recon-i)';
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

async function fetchRaw(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*' },
    signal: AbortSignal.timeout(30000),
    redirect: 'follow',
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { ok: res.ok, status: res.status, bytes: buf.length, contentType: res.headers.get('content-type'), buf };
}

async function fetchAndLog(id, url, robotsChecker) {
  section(`SOURCE: ${id}`);
  const verdict = await robotsChecker.isAllowed(url);
  if (!verdict.allowed) {
    log(`[SKIP-DISALLOWED] ${url} — ${verdict.reason}`);
    return null;
  }
  try {
    const res = await fetchRaw(url);
    await sleep(WAIT_MS);
    log(`[FETCH] ${url} -> HTTP ${res.status} ${res.bytes}B content-type=${res.contentType}`);
    if (!res.ok) return null;
    const safeName = id.replace(/[^a-z0-9_.]/gi, '_');
    writeFileSync(join(OUT_DIR, `recon_i.${safeName}${/pdf/i.test(res.contentType || '') ? '.pdf' : '.html'}`), res.buf);
    return res;
  } catch (e) {
    log(`[ERROR] ${url} -> ${e.message}`);
    return null;
  }
}

// "Next release"周辺のテキストを抜き出す（教訓2の反省: 固定長切り出しだと本文が
// ナビゲーションメニューに埋もれて拾えないことがあったため、キーワード起点で抽出する）
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

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  section(`phase1 source-recon-i start ${new Date().toISOString()}`);
  const robotsChecker = createRobotsChecker({ userAgent: UA, waitMs: WAIT_MS });

  // ===== 経路A: 年間骨格PDF =====
  const pdfRes = await fetchAndLog(
    'eurostat_gdp.route_a_pdf',
    'https://ec.europa.eu/eurostat/documents/24987/6642470/QNA_release_calendar.pdf',
    robotsChecker
  );
  if (pdfRes) {
    try {
      const parsed = await pdf(pdfRes.buf);
      log(`  PDF TEXT LENGTH: ${parsed.text.length}字 / ${parsed.numpages}ページ`);
      log(`  PDF FULL TEXT:\n${parsed.text}`);
    } catch (e) {
      log(`  [PDF-PARSE-ERROR] ${e.message}`);
    }
  }

  // ===== 経路B: 直近ニュースリリース本文（Next release記載） =====
  for (const [id, url] of [
    ['eurostat_gdp.route_b_20260814', 'https://ec.europa.eu/eurostat/web/products-euro-indicators/w/2-14082026-ap'],
    ['eurostat_gdp.route_b_20260730', 'https://ec.europa.eu/eurostat/web/products-euro-indicators/w/2-30072026-ap'],
  ]) {
    const res = await fetchAndLog(id, url, robotsChecker);
    if (!res) continue;
    const bodyText = stripTags(res.buf.toString('utf8'));
    log(`  BODY LENGTH (stripped): ${bodyText.length}字`);
    const hits = extractAround(bodyText, ['[Nn]ext release', '次回', 'flash estimate', 'estimate']);
    log(`  KEYWORD HITS (${hits.length}件): ${JSON.stringify(hits, null, 2)}`);
    log(`  FULL BODY (先頭5000字): ${bodyText.slice(0, 5000)}`);
  }

  section(`phase1 source-recon-i end ${new Date().toISOString()}`);
})();
