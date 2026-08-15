#!/usr/bin/env node
// task #41ライブ検証その4（2026-08-15）: source-recon-h3.mjsで判明したとおり、HICPの静的カレンダー
// （sthicp.en.html）は"ges"（Prices, output, demand and labour）カテゴリ配下にあった。
// GDPも同じ"output"カテゴリに分類されている可能性が高いため、gesカテゴリの索引ページ自体
// （トップレベル索引ではなくカテゴリ内索引）を取得し、GDP相当のページを探す
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRobotsChecker } from '../lib/robots.js';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase1-source-recon-h4)';
const WAIT_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const section = (title) => log(`\n##### ${title} #####`);

function stripTags(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#8217;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

async function fetchRaw(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(30000), redirect: 'follow' });
  const buf = Buffer.from(await res.arrayBuffer());
  return { ok: res.ok, status: res.status, bytes: buf.length, contentType: res.headers.get('content-type'), text: buf.toString('utf8') };
}

function extractLinks(html) {
  const links = [];
  const RE = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = RE.exec(html))) {
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    links.push({ href: m[1], text });
  }
  return links;
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
    const safeName = id.replace(/[^a-z0-9_.]/gi, '_');
    writeFileSync(join(OUT_DIR, `recon_h4.${safeName}.html`), res.text);
    log(`[FETCH] ${url} -> HTTP ${res.status} ${res.bytes}B content-type=${res.contentType}`);
    return res;
  } catch (e) {
    log(`[ERROR] ${url} -> ${e.message}`);
    return null;
  }
}

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  section(`phase1 source-recon-h4 start ${new Date().toISOString()}`);
  const robotsChecker = createRobotsChecker({ userAgent: UA, waitMs: WAIT_MS });

  const gesIndex = await fetchAndLog(
    'ecb_statscal.ges_index',
    'https://www.ecb.europa.eu/press/calendars/statscal/ges/html/index.en.html',
    robotsChecker
  );
  if (gesIndex) {
    const bodyText = stripTags(gesIndex.text);
    log(`  BODY LENGTH (stripped): ${bodyText.length}字`);
    const links = extractLinks(gesIndex.text);
    // gesカテゴリ配下（相対パスやges/htmlを含む）のリンクだけに絞って全件出す
    const gesLinks = links.filter((l) => /\/statscal\/ges\//i.test(l.href) || /^st[a-z]+\.en\.html/i.test(l.href));
    log(`  GESカテゴリ配下リンク（${gesLinks.length}件）: ${JSON.stringify(gesLinks, null, 2)}`);
    // GDP/national accounts/outputらしきリンクを抽出
    const gdpLinks = gesLinks.filter((l) => /gdp|national account|gross domestic|output/i.test(l.text) || /gdp|natacc|stna/i.test(l.href));
    log(`  GDP候補: ${JSON.stringify(gdpLinks, null, 2)}`);

    for (const gl of gdpLinks) {
      let absUrl = gl.href;
      if (absUrl.startsWith('/')) absUrl = 'https://www.ecb.europa.eu' + absUrl;
      else if (!absUrl.startsWith('http')) absUrl = new URL(absUrl, 'https://www.ecb.europa.eu/press/calendars/statscal/ges/html/index.en.html').toString();
      const gdpRes = await fetchAndLog(`ecb_statscal.gdp.${gl.text.slice(0, 25)}`, absUrl, robotsChecker);
      if (gdpRes) {
        const gdpBody = stripTags(gdpRes.text);
        log(`  GDP候補ページ FULL BODY: ${gdpBody}`);
      }
    }
    // 念のため全gesLinksの本文も軽くログ（GDPフィルタで漏れた場合の目視確認用）
    log(`  参考: gesカテゴリ内の全ページタイトル一覧（GDPフィルタ漏れ確認用）: ${JSON.stringify(gesLinks.map((l) => l.text))}`);
  }

  section(`phase1 source-recon-h4 end ${new Date().toISOString()}`);
})();
