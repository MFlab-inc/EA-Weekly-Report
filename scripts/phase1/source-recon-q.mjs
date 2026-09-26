#!/usr/bin/env node
// Phase 1 追加実測（2026-09-26、しょうさん指示: BOE事前告知カレンダーの本実装に向けた実測）。
//
// 目的1: bankofengland.co.uk/events/upcoming-events のHTML構造をタグ付きのまま確認する
// （scripts/phase1/source-recon-p.mjsではタグ除去後のテキストダンプしか取得しておらず、
// 抽出器（extractor）を書くには実際のタグ構造が必要）。既知のキーワード（話者名・曜日見出し等）
// の前後をタグ付きで抜粋する。
//
// 目的2: 英国議会Treasury Committeeの開催予定について、committees.parliament.uk（robots.txt取得
// 失敗=HTTP 403で未確認のまま）以外にアクセス可能な一次ソースがあるか確認する。WebSearchで
// committees-api.parliament.uk（UK Parliament公開Committees API）の存在を確認済みのため、
// これのrobots.txt・到達性を実測する。
//
// 生データは phase1-out/ に保存（コミットしない）。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRobotsChecker } from '../lib/robots.js';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase1-source-recon-q)';
const WAIT_MS = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const log = (...a) => console.log(...a);
const section = (title) => log(`\n##### ${title} #####`);

async function fetchOne(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: '*/*' },
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

function rawContextsNear(text, anchors, before = 500, after = 500) {
  const out = [];
  for (const a of anchors) {
    const idx = text.indexOf(a);
    if (idx === -1) {
      out.push({ anchor: a, found: false });
      continue;
    }
    const start = Math.max(0, idx - before);
    const end = Math.min(text.length, idx + a.length + after);
    out.push({ anchor: a, found: true, index: idx, context: text.slice(start, end) });
  }
  return out;
}

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  section(`phase1 source-recon-q start ${new Date().toISOString()}`);
  const robotsChecker = createRobotsChecker({ userAgent: UA, waitMs: WAIT_MS });

  // ---------- 目的1: BOE events/upcoming-events の生HTML構造確認 ----------
  section('PART1: bankofengland.co.uk/events/upcoming-events 生HTML構造');
  {
    const url = 'https://www.bankofengland.co.uk/events/upcoming-events';
    const verdict = await robotsChecker.isAllowed(url);
    if (!verdict.allowed) {
      log(`[SKIP-DISALLOWED] ${url} — ${verdict.reason}`);
    } else {
      const res = await fetchOne(url);
      await sleep(WAIT_MS);
      if (res?.ok) {
        const filePath = join(OUT_DIR, 'boe_upcoming_events.raw.html');
        writeFileSync(filePath, res.buf);
        const raw = res.buf.toString('utf8');
        log(`[FETCH] HTTP ${res.status} ${res.bytes}B ${res.ms}ms ct=${res.contentType} savedAs=${filePath}`);
        const anchors = [
          '<title>', 'Andrew Bailey', 'Lombardelli', 'Thursday 1 October', 'Tuesday 6 October',
          'Upcoming key publications', 'Upcoming speeches, news and publications', 'This page was last updated',
        ];
        const contexts = rawContextsNear(raw, anchors, 400, 600);
        for (const c of contexts) {
          if (!c.found) {
            log(`  [ANCHOR NOT FOUND] "${c.anchor}"`);
            continue;
          }
          log(`  [ANCHOR] "${c.anchor}" @index=${c.index}`);
          log(`  ---RAW CONTEXT START---`);
          log(c.context);
          log(`  ---RAW CONTEXT END---`);
        }
      } else {
        log(`[FETCH-ERR] ${res?.error || res?.status}`);
      }
    }
  }
  await sleep(WAIT_MS);

  // ---------- 目的2: committees-api.parliament.uk の到達性確認 ----------
  section('PART2: committees-api.parliament.uk 到達性確認（Treasury Committee代替一次ソース）');
  {
    const host = 'https://committees-api.parliament.uk';
    log(`--- robots.txt: ${host} ---`);
    const rRes = await fetchOne(`${host}/robots.txt`);
    if (rRes?.ok) {
      log(`status: ${rRes.status}`);
      log(rRes.buf.toString('utf8').slice(0, 1000));
    } else {
      log(`robots.txt取得失敗: ${rRes?.error || rRes?.status}（HTTP 404は制限なし扱い）`);
    }
    await sleep(WAIT_MS);

    const targets = [
      { label: 'index_html', url: `${host}/index.html` },
      { label: 'swagger_v1', url: `${host}/swagger/v1/swagger.json` },
    ];
    for (const t of targets) {
      const verdict = await robotsChecker.isAllowed(t.url);
      if (!verdict.allowed) {
        log(`[SKIP-DISALLOWED] ${t.label}: ${t.url} — ${verdict.reason}`);
        continue;
      }
      const res = await fetchOne(t.url);
      await sleep(WAIT_MS);
      if (res?.ok) {
        const filePath = join(OUT_DIR, `committees_api.${t.label}${/json/i.test(res.contentType || '') ? '.json' : '.html'}`);
        writeFileSync(filePath, res.buf);
        log(`[FETCH] ${t.label}: HTTP ${res.status} ${res.bytes}B ${res.ms}ms ct=${res.contentType} final=${res.finalUrl}`);
        const text = res.buf.toString('utf8');
        if (t.label === 'swagger_v1') {
          try {
            const spec = JSON.parse(text);
            const paths = Object.keys(spec.paths || {});
            log(`  [swagger paths] ${paths.length}件`);
            paths.slice(0, 60).forEach((p) => log(`    ${p}`));
          } catch (e) {
            log(`  swagger.jsonのパース失敗: ${String(e.message)}`);
            log(text.slice(0, 1500));
          }
        } else {
          log(text.slice(0, 2000));
        }
      } else {
        log(`[FETCH-ERR] ${t.label}: ${res?.error || res?.status}`);
      }
    }
  }

  section(`phase1 source-recon-q end ${new Date().toISOString()}`);
})();
