#!/usr/bin/env node
// Phase 1 追加実測（2026-10-03、しょうさん指摘: 9/28週のABS貿易収支［International Trade in
// Goods, August 2026、2026-10-01発表］が欠落していた）。au_absの実測ground truthを取得し、
// (a) 現在の掲載horizon（何日/何週間先まで載っているか）、(b) "International Trade in Goods"が
// どういう表記・日時で載っているか、(c) 2026-11-05（9月分、次回該当分）が現時点で既に掲載
// 範囲内かどうか、を確認する。サンドボックスからはABS側のbot対策（robots.txt自体がHTTP 403）
// によりfetch不可なため、GitHub Actions実ネットワーク経由で実測する。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRobotsChecker } from '../lib/robots.js';
import { extractAbsCalendar } from '../checkers/extractors/abs.js';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase1-source-recon-z)';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const log = (...a) => console.log(...a);
const section = (title) => log(`\n##### ${title} #####`);

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  section(`phase1 source-recon-z start ${new Date().toISOString()}`);
  const robotsChecker = createRobotsChecker({ userAgent: UA, waitMs: 1500 });
  const url = 'https://www.abs.gov.au/release-calendar/future-releases-calendar';
  const verdict = await robotsChecker.isAllowed(url);
  section('ROBOTS.TXT判定');
  log(JSON.stringify(verdict));
  if (!verdict.allowed) {
    log(`[SKIP-DISALLOWED] ${url} — ${verdict.reason}`);
    return;
  }
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(30000) });
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(join(OUT_DIR, 'abs_future_releases.raw.html'), buf);
  const text = buf.toString('utf8');
  log(`[FETCH] HTTP ${res.status} ${buf.length}B ct=${res.headers.get('content-type')} sha256=${sha256(buf)}`);

  const parsed = extractAbsCalendar(text);
  section(`抽出結果（既存extractAbsCalendar使用） ok=${parsed.ok}`);
  if (!parsed.ok) {
    log('reason:', parsed.reason);
  } else {
    log(`抽出件数: ${parsed.rows.length}`);
    const sorted = [...parsed.rows].sort((a, b) => a.utcInstant.localeCompare(b.utcInstant));
    for (const r of sorted) log(r.utcInstant, '|', r.title);

    section('International Trade関連の行のみ抽出');
    const tradeRows = sorted.filter((r) => /trade/i.test(r.title));
    for (const r of tradeRows) log(r.utcInstant, '|', r.title);

    section('キーワード"international trade in goods"との一致判定（大文字小文字無視）');
    for (const r of tradeRows) {
      const matched = r.title.toLowerCase().includes('international trade in goods');
      log(`${matched ? 'MATCH' : 'NO-MATCH'} :: "${r.title}"`);
    }

    section('horizon（最新行の日時、全体の最小/最大日時）');
    if (sorted.length > 0) {
      log('最小(最も近い):', sorted[0].utcInstant, sorted[0].title);
      log('最大(最も遠い):', sorted[sorted.length - 1].utcInstant, sorted[sorted.length - 1].title);
    }
  }

  section('ページネーション・月指定クエリ・API呼び出しの手がかり（horizon延長の代替経路調査）');
  const hints = [
    /page=\d+/gi, /\bmonth=/gi, /\byear=/gi, /load-?more/gi, /next-?page/gi,
    /\/api\/[\w-]+/gi, /fetch\(['"][^'"]+['"]/gi, /href="[^"]*future-releases[^"]*"/gi,
  ];
  for (const re of hints) {
    const found = [...new Set([...text.matchAll(re)].map((m) => m[0]))];
    if (found.length > 0) log(`${re}: ${found.slice(0, 10).join(' | ')}`);
  }
  const paginationNav = text.match(/<nav[^>]*pag[^>]*>[\s\S]{0,500}/i);
  if (paginationNav) log('pagination-nav excerpt:', paginationNav[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 500));

  section('月指定URL（/future-releases-calendar/YYYYMM）の実測 — horizon不足の根本解決になるか確認');
  for (const ym of ['202611', '202612']) {
    const monthUrl = `https://www.abs.gov.au/release-calendar/future-releases-calendar/${ym}`;
    const mVerdict = await robotsChecker.isAllowed(monthUrl);
    if (!mVerdict.allowed) {
      log(`[SKIP-DISALLOWED] ${monthUrl} — ${mVerdict.reason}`);
      continue;
    }
    const mRes = await fetch(monthUrl, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(30000) });
    const mText = await mRes.text();
    log(`[FETCH] ${ym}: HTTP ${mRes.status} ${mText.length}B final=${mRes.url}`);
    const mParsed = extractAbsCalendar(mText);
    if (!mParsed.ok) {
      log(`  抽出失敗: ${mParsed.reason}`);
      continue;
    }
    const mSorted = [...mParsed.rows].sort((a, b) => a.utcInstant.localeCompare(b.utcInstant));
    log(`  抽出件数: ${mSorted.length}`);
    for (const r of mSorted) log(' ', r.utcInstant, '|', r.title);
    const tradeHit = mSorted.find((r) => r.title.toLowerCase().includes('international trade in goods'));
    log(`  International Trade in Goods: ${tradeHit ? `FOUND ${tradeHit.utcInstant}` : 'NOT FOUND'}`);
  }

  section(`phase1 source-recon-z end ${new Date().toISOString()}`);
})();
