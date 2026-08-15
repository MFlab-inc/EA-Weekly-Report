#!/usr/bin/env node
// Phase 0 実測スクリプト（HANDOFF.md §3 項目1〜3）
// GitHub Actionsランナー上で実行する想定（.github/workflows/phase0-measure.yml から起動）。
// - 生データは phase0-out/ に保存（artifact化。リポジトリにはコミットしない）
// - 標準出力には構造分析・件数・最小限の抜粋のみを出す
// - phase0-out/ に既存ファイルがあれば再取得しない（reuse_run_id での再解析用）
// - アクセスマナー: 取得間1500ms・UA明示・リトライ3回（SPEC §3.6）
// Phase 0 完了後、このディレクトリは削除する。
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = 'phase0-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase0-measurement)';
const WAIT_MS = 1500;
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)=(.*)$/);
  return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
}));
const targets = args.targets || 'all';
const note = args.note || '';

const TARGETS = {
  robots_minkabu:   { url: 'https://fx.minkabu.jp/robots.txt', file: 'robots_minkabu.txt', group: 'minkabu' },
  minkabu_20260803: { url: 'https://fx.minkabu.jp/indicators?date=2026-08-03', file: 'minkabu_2026-08-03.html', group: 'minkabu' },
  minkabu_20260810: { url: 'https://fx.minkabu.jp/indicators?date=2026-08-10', file: 'minkabu_2026-08-10.html', group: 'minkabu' },
  minkabu_20260817: { url: 'https://fx.minkabu.jp/indicators?date=2026-08-17', file: 'minkabu_2026-08-17.html', group: 'minkabu' },
  robots_ff:        { url: 'https://nfs.faireconomy.media/robots.txt', file: 'robots_ff.txt', group: 'ff' },
  ff_lastweek:      { url: 'https://nfs.faireconomy.media/ff_calendar_lastweek.json', file: 'ff_lastweek.json', group: 'ff' },
  ff_thisweek:      { url: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json', file: 'ff_thisweek.json', group: 'ff' },
  ff_nextweek:      { url: 'https://nfs.faireconomy.media/ff_calendar_nextweek.json', file: 'ff_nextweek.json', group: 'ff' },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha256 = buf => createHash('sha256').update(buf).digest('hex');
const nowIso = () => new Date().toISOString();

function log(...a) { console.log(...a); }
function section(title) { log(`\n##### ${title} #####`); }

async function fetchOne(name, t, meta) {
  const path = join(OUT_DIR, t.file);
  if (existsSync(path)) {
    log(`[REUSED] ${name}: ${t.file} already present, skipping fetch`);
    meta[name] = { url: t.url, reused: true };
    return;
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch(t.url, {
        headers: { 'User-Agent': UA, 'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8' },
        signal: AbortSignal.timeout(30000),
        redirect: 'follow',
      });
      const buf = Buffer.from(await res.arrayBuffer());
      const ms = Date.now() - started;
      meta[name] = {
        url: t.url, status: res.status, ok: res.ok, ms, bytes: buf.length,
        contentType: res.headers.get('content-type'),
        lastModified: res.headers.get('last-modified'),
        cacheControl: res.headers.get('cache-control'),
        age: res.headers.get('age'),
        server: res.headers.get('server'),
        finalUrl: res.url,
        sha256: sha256(buf), fetchedAt: nowIso(), attempt,
      };
      writeFileSync(path, buf);
      log(`[FETCH] ${name}: HTTP ${res.status} ${buf.length} bytes ${ms}ms ct=${meta[name].contentType} final=${res.url}`);
      return;
    } catch (e) {
      log(`[FETCH-ERR] ${name} attempt ${attempt}/3: ${e.message}`);
      meta[name] = { url: t.url, error: String(e.message), attempt, fetchedAt: nowIso() };
      if (attempt < 3) await sleep(2000 * attempt);
    }
  }
}

// ---------- 正規化・突合ヘルパー ----------
const normalize = s => (s || '')
  .normalize('NFKC')
  .replace(/[\s　]/g, '')
  .replace(/[【】\[\]（）()「」・]/g, '');

function excerptAround(html, index, before, after) {
  const s = Math.max(0, index - before);
  return html.slice(s, Math.min(html.length, index + after)).replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ');
}

// ---------- みんかぶ行パース（run 2以降・artifact再解析用） ----------
const COUNTRY_JA_TO_CODE = {
  '日本': 'JP', '米国': 'US', '英国': 'GB', '豪州': 'AU', '中国': 'CN',
  'ニュージーランド': 'NZ', 'カナダ': 'CA', 'ユーロ圏': 'EU', 'ドイツ': 'DE', 'フランス': 'FR', 'スイス': 'CH',
};

function parseMinkabuTables(html) {
  const rows = [];
  const tables = html.split(/<table\b/).slice(1);
  for (const t of tables) {
    const cap = t.match(/<caption[^>]*>([^<]*)<\/caption>/);
    const dm = cap && cap[1].match(/(\d{4})年(\d{2})月(\d{2})日/);
    if (!dm) continue;
    const date = `${dm[1]}-${dm[2]}-${dm[3]}`;
    for (const tr of t.split(/<tr\b/).slice(1)) {
      const imp = tr.match(/data_importance="(\d)"/);
      if (!imp) continue;
      const country = (tr.match(/data_country="([A-Z]+)"/) || [])[1] || '';
      const time = ((tr.match(/<span>([^<]{1,12})<\/span>/) || [])[1] || '').trim();
      const nameM = tr.match(/<p class="flexbox__grow fbd">([^<]+)<\/p>/);
      const code = (tr.match(/href="\/indicators\/([A-Za-z0-9-]+)"/) || [])[1] || '';
      rows.push({ date, time, imp: Number(imp[1]), country, name: nameM ? nameM[1].trim() : '', code });
    }
  }
  return rows;
}

function analyzeMinkabuRows(name, html, expected) {
  const rows = parseMinkabuTables(html);
  log(`--- row-level parse: ${rows.length} rows ---`);
  if (!rows.length) return;
  const byDay = {}, byImp = {};
  let noTime = 0;
  for (const r of rows) {
    byDay[r.date] = (byDay[r.date] || 0) + 1;
    byImp[r.imp] = (byImp[r.imp] || 0) + 1;
    if (!/^\d{1,2}:\d{2}$/.test(r.time)) noTime++;
  }
  log(`rows_by_day=${JSON.stringify(byDay)}`);
  log(`rows_by_importance=${JSON.stringify(byImp)} rows_without_HH:MM_time=${noTime}`);

  // 重要度上位（★4以上）の全行: 逆方向の閾値校正用（掲載されなかった★4/★5がないか）
  log(`--- rows with data_importance >= 4 ---`);
  for (const r of rows.filter(r => r.imp >= 4)) {
    log(`  ${r.date} ${r.time.padEnd(5)} [imp${r.imp}] ${r.country} ${r.name} (${r.code})`);
  }

  // 既刊イベントとの行単位マッチ（★5段階→★3段階マッピング校正用）
  const wk = name.includes('2026-08-03') ? '2026-08-03' : name.includes('2026-08-10') ? '2026-08-10' : null;
  if (wk && expected) {
    log(`--- expected-event row match (week ${wk}) ---`);
    for (const ev of expected.events.filter(e => e.week === wk)) {
      const code = COUNTRY_JA_TO_CODE[ev.country_ja] || '';
      const cands = rows.filter(r =>
        r.date === ev.date && (!code || r.country === code) &&
        ev.minkabu_keys.some(k => normalize(r.name).includes(normalize(k)))
      );
      if (cands.length) {
        log(`  HIT  [報★${ev.stars}] ${ev.name_ja}`);
        for (const c of cands) log(`       -> ${c.time} [imp${c.imp}] ${c.name} (${c.code})`);
      } else {
        log(`  MISS [報★${ev.stars}] ${ev.name_ja}`);
      }
    }
  }
}

// ---------- みんかぶ分析 ----------
function analyzeMinkabu(name, path, expected) {
  section(`ANALYSIS minkabu: ${name}`);
  const html = readFileSync(path, 'utf8');
  log(`length=${html.length}`);
  try {
    // 静的/動的レンダリング判定の材料
    const scriptCount = (html.match(/<script/g) || []).length;
    const tableCount = (html.match(/<table/g) || []).length;
    const trCount = (html.match(/<tr/g) || []).length;
    const markers = ['__NEXT_DATA__', 'window.__NUXT__', '__INITIAL_STATE__', 'id="app"', 'data-reactroot', 'v-cloak']
      .filter(m => html.includes(m));
    log(`script_tags=${scriptCount} table_tags=${tableCount} tr_tags=${trCount} spa_markers=${JSON.stringify(markers)}`);

    // 週表示・日付マーカー
    const dates = [...new Set((html.match(/20\d{2}\/\d{2}\/\d{2}/g) || []))].slice(0, 12);
    log(`date_markers(YYYY/MM/DD, distinct, first12)=${JSON.stringify(dates)}`);
    const mdDates = [...new Set((html.match(/\d{2}\/\d{2}\s*[（(][月火水木金土日][)）]/g) || []))].slice(0, 12);
    log(`date_markers(MM/DD(曜), distinct, first12)=${JSON.stringify(mdDates)}`);

    // データ取得時間
    const dtIdx = html.indexOf('データ取得時間');
    if (dtIdx >= 0) {
      log(`データ取得時間 FOUND at ${dtIdx}: >>> ${excerptAround(html, dtIdx, 40, 200)} <<<`);
    } else {
      const alt = ['取得時間', '更新時間', '更新日時'].map(k => [k, html.indexOf(k)]).filter(([, i]) => i >= 0);
      log(`データ取得時間 NOT FOUND. alternatives=${JSON.stringify(alt.map(([k, i]) => `${k}@${i}`))}`);
      if (alt.length) log(`excerpt(${alt[0][0]}): >>> ${excerptAround(html, alt[0][1], 40, 200)} <<<`);
    }

    // ★の表現方法
    const starChar = (html.match(/★/g) || []).length;
    const starRuns = {};
    for (const m of html.match(/★{1,5}/g) || []) starRuns[m.length] = (starRuns[m.length] || 0) + 1;
    log(`star_char_total=${starChar} star_run_histogram(len->count)=${JSON.stringify(starRuns)}`);
    const starClasses = {};
    for (const m of html.matchAll(/class="([^"]*(?:[Ss]tar|importance|rank|rating|imp\b)[^"]*)"/g)) {
      starClasses[m[1]] = (starClasses[m[1]] || 0) + 1;
    }
    log(`star_like_classes=${JSON.stringify(starClasses)}`);
    const imgAlts = {};
    for (const m of html.matchAll(/<img[^>]*alt="([^"]*)"[^>]*>/g)) {
      imgAlts[m[1]] = (imgAlts[m[1]] || 0) + 1;
    }
    const altTop = Object.entries(imgAlts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    log(`img_alt_top10=${JSON.stringify(altTop)}`);
    if (starChar > 0) {
      const i = html.indexOf('★');
      log(`first_star_context: >>> ${excerptAround(html, i, 700, 700)} <<<`);
    } else {
      // ★文字が無い場合は重要度らしき要素の手掛かりを出す
      const kw = ['重要度', 'importance', 'star'];
      for (const k of kw) {
        const i = html.indexOf(k);
        if (i >= 0) { log(`keyword'${k}'_context: >>> ${excerptAround(html, i, 300, 500)} <<<`); break; }
      }
    }

    // 先頭テーブルの構造抜粋
    const ti = html.indexOf('<table');
    if (ti >= 0) log(`first_table_excerpt: >>> ${excerptAround(html, ti, 0, 1500)} <<<`);

    // 既刊イベント名の存在確認（統計系のみ・正規化部分一致）
    const nHtml = normalize(html);
    const wk = name.includes('2026-08-03') ? '2026-08-03' : name.includes('2026-08-10') ? '2026-08-10' : null;
    if (wk && expected) {
      log(`--- expected-event key match (week ${wk}) ---`);
      for (const ev of expected.events.filter(e => e.week === wk)) {
        const hits = ev.minkabu_keys.map(k => {
          const nk = normalize(k);
          let c = 0, idx = 0;
          while ((idx = nHtml.indexOf(nk, idx)) >= 0) { c++; idx += nk.length; }
          return `${k}:${c}`;
        });
        log(`  [${ev.stars === 3 ? '★★★' : '★★'}] ${ev.name_ja} => ${hits.join(' ')}`);
      }
    }
    analyzeMinkabuRows(name, html, expected);
  } catch (e) {
    log(`[ANALYZE-ERR] ${name}: ${e.stack}`);
  }
}

// ---------- Forex Factory 分析 ----------
function jstDate(isoStr) {
  try {
    const d = new Date(isoStr);
    if (isNaN(d)) return null;
    return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
  } catch { return null; }
}

function analyzeFF(name, path, expected) {
  section(`ANALYSIS forexfactory: ${name}`);
  const raw = readFileSync(path, 'utf8');
  log(`bytes=${raw.length}`);
  if (/Request Denied|exceeded the limit/i.test(raw)) {
    log(`[RATE-LIMITED] FF calendar export rate limit hit (2req/5min/network). head=${raw.slice(0, 300)}`);
    return;
  }
  let events;
  try {
    events = JSON.parse(raw);
  } catch (e) {
    log(`[NOT JSON] parse error: ${e.message}. head=${raw.slice(0, 300)}`);
    return;
  }
  if (!Array.isArray(events)) { log(`[UNEXPECTED SHAPE] typeof=${typeof events} keys=${Object.keys(events || {}).slice(0, 10)}`); return; }
  log(`event_count=${events.length}`);
  if (events.length === 0) return;
  log(`fields_of_first=${JSON.stringify(Object.keys(events[0]))}`);
  const dates = events.map(e => e.date).filter(Boolean).sort();
  log(`date_range=${dates[0]} .. ${dates[dates.length - 1]}`);
  log(`date_range_jst=${jstDate(dates[0])} .. ${jstDate(dates[dates.length - 1])}`);
  const by = key => {
    const m = {};
    for (const e of events) m[e[key]] = (m[e[key]] || 0) + 1;
    return m;
  };
  log(`by_impact=${JSON.stringify(by('impact'))}`);
  log(`by_country=${JSON.stringify(by('country'))}`);

  // 全イベント一覧（date / JST換算 / country / impact / title）
  log(`--- all events (date | jst | country | impact | title) ---`);
  for (const e of events) {
    log(`  ${e.date} | ${jstDate(e.date)} | ${e.country} | ${e.impact} | ${e.title}`);
  }

  // 既刊イベント（FF照合対象）との突合
  if (expected) {
    log(`--- expected-event FF pattern match ---`);
    for (const ev of expected.events) {
      const pats = ev.ff_patterns.map(p => p.toLowerCase());
      const hits = events.filter(e =>
        e.country === ev.ff_country &&
        pats.some(p => String(e.title || '').toLowerCase().includes(p)) &&
        (jstDate(e.date) || '').startsWith(ev.date)
      );
      if (hits.length) {
        log(`  HIT   [${ev.date}] ${ev.name_ja} => ${hits.map(h => `${h.title}@${h.date}(impact:${h.impact})`).join(' / ')}`);
      } else {
        // 日付を跨ぎ得るので週内・国・パターン一致も見る
        const loose = events.filter(e => e.country === ev.ff_country && pats.some(p => String(e.title || '').toLowerCase().includes(p)));
        log(`  MISS  [${ev.date}] ${ev.name_ja}${loose.length ? ` (week-loose: ${loose.map(h => `${h.title}@${h.date}`).join(' / ')})` : ''}`);
      }
    }
  }
}

// ---------- main ----------
(async () => {
  section(`phase0-measure start ${nowIso()} targets=${targets} note=${note}`);
  mkdirSync(OUT_DIR, { recursive: true });
  const metaPath = join(OUT_DIR, 'meta.json');
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : { runs: [] };
  const runMeta = { startedAt: nowIso(), targets, note, fetches: {} };

  // ff-only: FFのレート制限（ネットワーク単位で5分に2リクエスト・Actions共有IP）に配慮し
  // thisweek/nextweek の2リクエストのみに絞る（robots・lastweekは取得済み知見で不要）
  const FF_ONLY = ['ff_thisweek', 'ff_nextweek'];
  const list = Object.entries(TARGETS).filter(([name, t]) =>
    targets === 'all' ? true : FF_ONLY.includes(name));
  for (const [name, t] of list) {
    await fetchOne(name, t, runMeta.fetches);
    if (!runMeta.fetches[name]?.reused) await sleep(WAIT_MS);
  }
  meta.runs.push(runMeta);
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  section('FETCH META');
  log(JSON.stringify(runMeta, null, 2));

  let expected = null;
  try {
    expected = JSON.parse(readFileSync(join(SCRIPT_DIR, 'expected-events.json'), 'utf8'));
  } catch (e) {
    log(`[WARN] expected-events.json unavailable: ${e.message}`);
  }

  for (const [name, t] of Object.entries(TARGETS)) {
    const path = join(OUT_DIR, t.file);
    if (!existsSync(path)) continue;
    if (t.file.startsWith('robots')) {
      section(`ROBOTS: ${name}`);
      log(readFileSync(path, 'utf8').slice(0, 2000));
    } else if (t.group === 'minkabu') {
      analyzeMinkabu(t.file.replace('.html', ''), path, expected);
    } else {
      analyzeFF(name, path, expected);
    }
  }
  section(`phase0-measure end ${nowIso()}`);
})();
