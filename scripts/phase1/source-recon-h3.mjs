#!/usr/bin/env node
// task #41ライブ検証その3（2026-08-15、しょうさん発見）: EurostatのSPA制約を迂回し、
// ECBが静的HTMLで公開しているStatistical calendars（statscal）配下のページからHICP・GDPの
// 実日程・実時刻を取得する。sthicp.en.htmlにはHICP速報値（flash、15:00 CET）と確報値
// （seasonally adjusted、12:00 CET）が別時刻で明記されているとのこと（しょうさん実地確認）。
// GDP相当の静的ページの有無も、statscal配下の索引ページから探索する
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRobotsChecker } from '../lib/robots.js';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase1-source-recon-h3)';
const WAIT_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const section = (title) => log(`\n##### ${title} #####`);

function stripTags(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#8217;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

async function fetchRaw(url, headers = { Accept: '*/*' }) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(30000), redirect: 'follow' });
  const buf = Buffer.from(await res.arrayBuffer());
  return { ok: res.ok, status: res.status, bytes: buf.length, contentType: res.headers.get('content-type'), text: buf.toString('utf8') };
}

// hrefリンクを href/リンクテキストのペアとして抽出（stripTagsする前の生HTMLに対して使う）
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
    writeFileSync(join(OUT_DIR, `recon_h3.${safeName}.html`), res.text);
    log(`[FETCH] ${url} -> HTTP ${res.status} ${res.bytes}B content-type=${res.contentType}`);
    return res;
  } catch (e) {
    log(`[ERROR] ${url} -> ${e.message}`);
    return null;
  }
}

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  section(`phase1 source-recon-h3 start ${new Date().toISOString()}`);
  const robotsChecker = createRobotsChecker({ userAgent: UA, waitMs: WAIT_MS });

  // 1) HICP静的カレンダー本体
  const hicp = await fetchAndLog(
    'ecb_statscal.sthicp',
    'https://www.ecb.europa.eu/press/calendars/statscal/ges/html/sthicp.en.html',
    robotsChecker
  );
  if (hicp) {
    const bodyText = stripTags(hicp.text);
    log(`  BODY LENGTH (stripped): ${bodyText.length}字`);
    log(`  FULL BODY: ${bodyText}`);
  }

  // 2) statscal索引ページ（しょうさん指定URL・英語版の両方を試す）
  for (const [id, url] of [
    ['ecb_statscal.index_et', 'https://ecb.europa.eu/press/calendars/statscal/html/index.et.html'],
    ['ecb_statscal.index_en', 'https://www.ecb.europa.eu/press/calendars/statscal/html/index.en.html'],
  ]) {
    const res = await fetchAndLog(id, url, robotsChecker);
    if (!res) continue;
    const bodyText = stripTags(res.text);
    log(`  BODY LENGTH (stripped): ${bodyText.length}字`);
    log(`  BODY EXCERPT (先頭3000字): ${bodyText.slice(0, 3000)}`);
    const links = extractLinks(res.text);
    log(`  LINKS FOUND: ${links.length}件`);
    const gdpLinks = links.filter((l) => /gdp|national accounts|gross domestic/i.test(l.text) || /gdp/i.test(l.href));
    log(`  GDP候補リンク: ${JSON.stringify(gdpLinks, null, 2)}`);
    const allStatscalLinks = links.filter((l) => /statscal/i.test(l.href));
    log(`  statscal配下の全リンク（参考）: ${JSON.stringify(allStatscalLinks, null, 2)}`);

    // GDP候補が見つかったら追撃フェッチする
    for (const gl of gdpLinks) {
      let absUrl = gl.href;
      if (absUrl.startsWith('/')) absUrl = 'https://www.ecb.europa.eu' + absUrl;
      else if (!absUrl.startsWith('http')) absUrl = new URL(absUrl, url).toString();
      const gdpRes = await fetchAndLog(`ecb_statscal.gdp_candidate.${gl.text.slice(0, 20)}`, absUrl, robotsChecker);
      if (gdpRes) {
        const gdpBody = stripTags(gdpRes.text);
        log(`  GDP候補ページ BODY LENGTH: ${gdpBody.length}字`);
        log(`  GDP候補ページ FULL BODY: ${gdpBody}`);
      }
    }
  }

  section(`phase1 source-recon-h3 end ${new Date().toISOString()}`);
})();
