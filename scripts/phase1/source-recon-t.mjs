#!/usr/bin/env node
// Phase 1 追加実測（2026-09-27）: Treasury Committee代替API（committees-api.parliament.uk）
// が「未来（未実施）」の委員会イベント／口頭証言セッションを返せるかを実測する。
//
// これまでの実測（source-recon-q.mjs・source-recon-r.mjs）で以下が判明済み:
//   - committees-api.parliament.ukはrobots.txt/認証なしで到達可能
//   - /api/Committees/158/Events?skip=0&take=20 は取得できるが、返ってきたイベントは
//     2026-09-15・2026-09-09など「今日（実測当時2026-09-26）より過去」の日付のみだった
//   - これが「このエンドポイントは過去分しか返さない」のか「日付フィルタ用のクエリ
//     パラメータを渡せば未来分も出る」のかが未確認だった
//
// 本スクリプトでは:
//   1. swagger.jsonを取得し、/api/Committees/{id}/Events・/api/Events・
//      NextEvent系エンドポイントの実際のパラメータ定義（名前・in・type/format）を
//      ハードコードせずその場で読み取る
//   2. 読み取ったパラメータ名を使って「今日〜90日後」の日付範囲で158番委員会の
//      イベントを問い合わせる
//   3. 比較として日付フィルタなし・take=100でも問い合わせ、返却された各イベントの
//      日付系フィールドを機械的に検出して「今日以降」のものが1件でもあるか判定する
//   4. NextEvent系エンドポイントが見つかればそれも叩く
//
// 生データはphase1-out/に保存（コミットしない）。判定に必要な情報はconsole.logで
// GitHub Actionsジョブログに出す。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRobotsChecker } from '../lib/robots.js';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase1-source-recon-t)';
const WAIT_MS = 1500;
const HOST = 'https://committees-api.parliament.uk';
const TODAY = new Date('2026-09-27T00:00:00Z');
const FUTURE_90D = new Date(TODAY.getTime() + 90 * 24 * 3600 * 1000);

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

function describeParam(p) {
  const schema = p.schema || {};
  return `${p.name} (in=${p.in}, required=${!!p.required}, type=${schema.type || '?'}, format=${schema.format || '-'})${p.description ? ' — ' + p.description : ''}`;
}

// レスポンスJSON中のオブジェクトから「日付っぽいキー」を再帰的に集める（値がISO日付文字列のもの）。
function findDateFields(obj, path = '', out = []) {
  if (obj == null) return out;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => findDateFields(v, `${path}[${i}]`, out));
    return out;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && /date/i.test(k)) {
        out.push({ path: `${path}.${k}`, key: k, value: v });
      } else if (typeof v === 'object') {
        findDateFields(v, `${path}.${k}`, out);
      }
    }
  }
  return out;
}

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  section(`phase1 source-recon-t start ${new Date().toISOString()}`);
  log(`基準日(TODAY)=${TODAY.toISOString()} / FUTURE_90D=${FUTURE_90D.toISOString()}`);
  const robotsChecker = createRobotsChecker({ userAgent: UA, waitMs: WAIT_MS });

  // ---------- STEP1: swagger.json取得・パース ----------
  section('STEP1: swagger.json取得・対象パスのパラメータ定義抽出');
  const swaggerUrl = `${HOST}/swagger/v1/swagger.json`;
  const verdict0 = await robotsChecker.isAllowed(swaggerUrl);
  if (!verdict0.allowed) {
    log(`[SKIP-DISALLOWED] ${swaggerUrl} — ${verdict0.reason}`);
    return;
  }
  const swRes = await fetchOne(swaggerUrl);
  await sleep(WAIT_MS);
  if (!swRes?.ok) {
    log(`[FETCH-ERR] swagger.json: HTTP ${swRes?.status ?? 'ERR'} ${swRes?.error || ''}`);
    return;
  }
  writeFileSync(join(OUT_DIR, 'committees_api.swagger.full.json'), swRes.buf);
  log(`[FETCH] swagger.json: HTTP ${swRes.status} ${swRes.bytes}B ${swRes.ms}ms sha256=${swRes.sha256}`);

  let spec;
  try {
    spec = JSON.parse(swRes.buf.toString('utf8'));
  } catch (e) {
    log(`[PARSE-ERR] swagger.json: ${String(e.message)}`);
    return;
  }
  const allPaths = Object.keys(spec.paths || {});
  log(`[swagger] 総パス数=${allPaths.length}`);

  const eventishPaths = allPaths.filter((p) => /event/i.test(p));
  section('EVENT関連の全パス一覧');
  eventishPaths.forEach((p) => log(`  ${p}  -> methods: ${Object.keys(spec.paths[p]).join(',')}`));

  function dumpPathParams(pathKey) {
    const item = spec.paths[pathKey];
    if (!item) {
      log(`  [NOT FOUND] ${pathKey}`);
      return null;
    }
    const getOp = item.get;
    if (!getOp) {
      log(`  [NO GET] ${pathKey} (methods: ${Object.keys(item).join(',')})`);
      return null;
    }
    log(`  GET ${pathKey}`);
    log(`  summary: ${getOp.summary || '(none)'}`);
    const params = getOp.parameters || [];
    if (!params.length) log('    (パラメータなし)');
    params.forEach((p) => log(`    - ${describeParam(p)}`));
    return params;
  }

  section('対象1: /api/Committees/{id}/Events のパラメータ定義');
  const committeeEventsKey = allPaths.find((p) => /\/api\/Committees\/\{id\}\/Events$/i.test(p)) ||
    allPaths.find((p) => /Committees.*\{id\}.*Events/i.test(p));
  const committeeEventsParams = committeeEventsKey ? dumpPathParams(committeeEventsKey) : (log('  [NOT FOUND] Committees/{id}/Events相当のパスなし'), null);

  section('対象2: /api/Events のパラメータ定義');
  const generalEventsKey = allPaths.find((p) => /^\/api\/Events$/i.test(p));
  const generalEventsParams = generalEventsKey ? dumpPathParams(generalEventsKey) : (log('  [NOT FOUND] /api/Events相当のパスなし'), null);

  section('対象3: NextEvent系パスのパラメータ定義');
  const nextEventKeys = allPaths.filter((p) => /nextevent/i.test(p));
  if (!nextEventKeys.length) log('  [NOT FOUND] NextEvent系パスなし');
  const nextEventParamsByKey = {};
  for (const k of nextEventKeys) {
    nextEventParamsByKey[k] = dumpPathParams(k);
  }

  // ---------- STEP2: 発見したパラメータ名で「未来日付フィルタ」クエリを組み立てて実行 ----------
  section('STEP2: 日付フィルタパラメータを使った未来レンジ問い合わせ');
  function dateParamsOf(params) {
    if (!params) return [];
    return params.filter((p) => /date/i.test(p.name));
  }
  function formatForParam(p, d) {
    const fmt = (p.schema && p.schema.format) || '';
    if (fmt === 'date') return d.toISOString().slice(0, 10);
    return d.toISOString(); // date-time or unknown -> full ISO 8601
  }

  const committeeDateParams = dateParamsOf(committeeEventsParams);
  log(`[date-params] /Committees/{id}/Events 側で見つかった日付系パラメータ: ${committeeDateParams.map((p) => p.name).join(', ') || '(なし)'}`);

  if (committeeEventsKey && committeeDateParams.length) {
    const qs = new URLSearchParams();
    qs.set('skip', '0');
    qs.set('take', '50');
    for (const p of committeeDateParams) {
      const isEnd = /end|to$/i.test(p.name);
      const d = isEnd ? FUTURE_90D : TODAY;
      qs.set(p.name, formatForParam(p, d));
    }
    const pathFilled = committeeEventsKey.replace('{id}', '158');
    const url = `${HOST}${pathFilled}?${qs.toString()}`;
    log(`[QUERY] date-filtered: ${url}`);
    const verdict = await robotsChecker.isAllowed(url);
    if (!verdict.allowed) {
      log(`[SKIP-DISALLOWED] ${url} — ${verdict.reason}`);
    } else {
      const res = await fetchOne(url);
      await sleep(WAIT_MS);
      if (res?.ok) {
        writeFileSync(join(OUT_DIR, 'committee_158_events_datefiltered.json'), res.buf);
        const text = res.buf.toString('utf8');
        log(`[FETCH] date-filtered events: HTTP ${res.status} ${res.bytes}B ct=${res.contentType}`);
        log(text.slice(0, 4000));
        try {
          const json = JSON.parse(text);
          const found = findDateFields(json);
          section('date-filtered結果の日付フィールド一覧・未来判定');
          if (!found.length) log('  日付フィールドが見つからなかった（構造要確認、上のraw JSON参照）');
          for (const f of found) {
            const isFuture = new Date(f.value).getTime() > TODAY.getTime();
            log(`  ${f.path} = ${f.value}  ${isFuture ? '<<< FUTURE (未来日付)' : '(過去/本日以前)'}`);
          }
        } catch (e) {
          log(`  [PARSE-ERR] ${String(e.message)}`);
        }
      } else {
        log(`[FETCH-ERR] date-filtered events: HTTP ${res?.status ?? 'ERR'} ${res?.error || ''}`);
        if (res?.buf) log(res.buf.toString('utf8').slice(0, 1500));
      }
    }
    await sleep(WAIT_MS);
  } else {
    log('[SKIP] 日付フィルタ用パラメータが見つからなかったため、日付フィルタ付き問い合わせは実行しない');
  }

  // ---------- STEP3: 日付フィルタなし・take大で全件確認（未来日付が混ざっていないか） ----------
  section('STEP3: 日付フィルタなし・take=100での全件確認');
  {
    const url = `${HOST}/api/Committees/158/Events?skip=0&take=100`;
    const verdict = await robotsChecker.isAllowed(url);
    if (!verdict.allowed) {
      log(`[SKIP-DISALLOWED] ${url} — ${verdict.reason}`);
    } else {
      const res = await fetchOne(url);
      await sleep(WAIT_MS);
      if (res?.ok) {
        writeFileSync(join(OUT_DIR, 'committee_158_events_take100.json'), res.buf);
        const text = res.buf.toString('utf8');
        log(`[FETCH] take=100: HTTP ${res.status} ${res.bytes}B ct=${res.contentType}`);
        try {
          const json = JSON.parse(text);
          const items = Array.isArray(json) ? json : (json.items || json.Items || json.results || []);
          log(`  件数=${Array.isArray(items) ? items.length : '(配列でない、rawJSON参照)'}`);
          if (!Array.isArray(items)) log(text.slice(0, 3000));
          const found = findDateFields(json);
          const futures = found.filter((f) => new Date(f.value).getTime() > TODAY.getTime());
          log(`  検出された日付フィールド総数=${found.length} / うち未来日付=${futures.length}`);
          futures.forEach((f) => log(`  [FUTURE] ${f.path} = ${f.value}`));
          if (!futures.length) {
            section('take=100件中の日付フィールド一覧（全件・未来判定なし＝すべて過去/本日以前だった場合の内訳）');
            found.slice(0, 40).forEach((f) => log(`  ${f.path} = ${f.value}`));
          }
        } catch (e) {
          log(`  [PARSE-ERR] ${String(e.message)}`);
          log(text.slice(0, 3000));
        }
      } else {
        log(`[FETCH-ERR] take=100: HTTP ${res?.status ?? 'ERR'} ${res?.error || ''}`);
      }
    }
    await sleep(WAIT_MS);
  }

  // ---------- STEP4: NextEvent系エンドポイントの実行 ----------
  section('STEP4: NextEvent系エンドポイントの実行');
  if (!nextEventKeys.length) {
    log('  [SKIP] NextEvent系パスがswaggerに存在しなかった');
  } else {
    for (const k of nextEventKeys) {
      const params = nextEventParamsByKey[k] || [];
      const qs = new URLSearchParams();
      let pathFilled = k;
      if (k.includes('{id}')) {
        pathFilled = k.replace('{id}', '158');
      } else {
        const idParam = params.find((p) => /^id$/i.test(p.name) || /committeeid/i.test(p.name));
        if (idParam) qs.set(idParam.name, '158');
      }
      const url = `${HOST}${pathFilled}${qs.toString() ? '?' + qs.toString() : ''}`;
      log(`[QUERY] NextEvent: ${url}`);
      const verdict = await robotsChecker.isAllowed(url);
      if (!verdict.allowed) {
        log(`[SKIP-DISALLOWED] ${url} — ${verdict.reason}`);
        continue;
      }
      const res = await fetchOne(url);
      await sleep(WAIT_MS);
      if (res?.ok) {
        const safeName = k.replace(/[^a-zA-Z0-9]+/g, '_');
        writeFileSync(join(OUT_DIR, `nextevent_${safeName}.json`), res.buf);
        const text = res.buf.toString('utf8');
        log(`[FETCH] ${k}: HTTP ${res.status} ${res.bytes}B ct=${res.contentType}`);
        log(text.slice(0, 3000));
        try {
          const json = JSON.parse(text);
          const found = findDateFields(json);
          for (const f of found) {
            const isFuture = new Date(f.value).getTime() > TODAY.getTime();
            log(`  ${f.path} = ${f.value}  ${isFuture ? '<<< FUTURE (未来日付)' : '(過去/本日以前)'}`);
          }
        } catch (e) {
          log(`  [PARSE-ERR] ${String(e.message)}`);
        }
      } else {
        log(`[FETCH-ERR] ${k}: HTTP ${res?.status ?? 'ERR'} ${res?.error || ''}`);
        if (res?.buf) log(res.buf.toString('utf8').slice(0, 1500));
      }
      await sleep(WAIT_MS);
    }
  }

  section(`phase1 source-recon-t end ${new Date().toISOString()}`);
})();
