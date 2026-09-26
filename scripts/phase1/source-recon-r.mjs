#!/usr/bin/env node
// Phase 1 追加実測（2026-09-26、しょうさん指示: Treasury Committee代替一次ソースの実データ到達性確認）。
//
// source-recon-q.mjsでcommittees-api.parliament.uk（UK Parliament公開Committees API）の
// swagger.jsonが認証なしで取得でき、/api/Committees/{id}/Events・/api/OralEvidence等の
// エンドポイントが存在することを確認済み。ただしswagger仕様の存在＝実データへの認証なし
// アクセス可否ではないため、実際にTreasury Committee（id=158、committees.parliament.uk上の
// URLから既知）のイベントデータを取得できるかを実測する。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRobotsChecker } from '../lib/robots.js';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase1-source-recon-r)';
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
        headers: { 'User-Agent': UA, Accept: 'application/json,*/*' },
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

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  section(`phase1 source-recon-r start ${new Date().toISOString()}`);
  const robotsChecker = createRobotsChecker({ userAgent: UA, waitMs: WAIT_MS });
  const host = 'https://committees-api.parliament.uk';

  const targets = [
    { label: 'committee_158', url: `${host}/api/Committees/158` },
    { label: 'committee_158_events', url: `${host}/api/Committees/158/Events?skip=0&take=20` },
    { label: 'oral_evidence_search', url: `${host}/api/OralEvidence?CommitteeId=158&skip=0&take=10` },
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
      const filePath = join(OUT_DIR, `${t.label}.json`);
      writeFileSync(filePath, res.buf);
      log(`[FETCH] ${t.label}: HTTP ${res.status} ${res.bytes}B ${res.ms}ms ct=${res.contentType} final=${res.finalUrl}`);
      const text = res.buf.toString('utf8');
      log(text.slice(0, 3000));
    } else {
      log(`[FETCH-ERR] ${t.label}: HTTP ${res?.status ?? 'ERR'} ${res?.error || ''}`);
      if (res?.buf) log(res.buf.toString('utf8').slice(0, 1000));
    }
  }

  section(`phase1 source-recon-r end ${new Date().toISOString()}`);
})();
