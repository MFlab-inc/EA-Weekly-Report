#!/usr/bin/env node
// Phase 1 公式ソース実測（優先度A・9元）。GitHub Actionsランナー上で実行する想定。
// マナー: 各ソースについて robots.txt を先に取得・解析し、対象パスが不許可の場合は
// 実ページを取得しない（代替経路が必要と記録するのみ）。許可されたパスのみ1リクエスト。
// 合計アクセスは1ソースあたり最大2リクエスト（robots.txt＋対象ページ）・間隔1500ms。
// 生データは phase1-out/ に保存（artifact化。リポジトリにはコミットしない）。
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = 'phase1-out';
const UA = 'MFlab-EA-Weekly/1.0 (+https://github.com/MFlab-inc/EA-Weekly-Report; phase1-source-recon)';
const WAIT_MS = 1500;
// カンマ区切りのソースIDを指定すると対象を絞る（アクセス回数を必要最小限にするため）。省略時は全9元。
const ONLY_IDS = (process.argv[2] || '').split(',').map((s) => s.trim()).filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const nowIso = () => new Date().toISOString();
const log = (...a) => console.log(...a);
const section = (title) => log(`\n##### ${title} #####`);

// 優先度A・9元。Web調査（2026-08-14）で確認したURLに基づく。
// annualHint: 年次スケジュール公表パターンの調査結果メモ（実装方式判定の参考）
// run1実測（2026-08-14）の結果を反映。BLS/ISMは代替URLも追加試行する
const SOURCES = [
  {
    id: 'bls', name: '米労働統計局（BLS）',
    targets: [
      { label: 'cpi_schedule', url: 'https://www.bls.gov/schedule/news_release/cpi.htm' },
      { label: 'empsit_schedule', url: 'https://www.bls.gov/schedule/news_release/empsit.htm' },
      { label: 'ical_feed', url: 'https://www.bls.gov/schedule/news_release/bls.ics' },
    ],
    annualHint: '年次ページ(bls.gov/schedule/2026/)が既に全月分公開済み。加えてbls.icsという構造化iCalフィードが存在（要検証）',
  },
  {
    id: 'rba', name: '豪州準備銀行（RBA）',
    targets: [{ label: 'board_meeting_schedule', url: 'https://www.rba.gov.au/schedules-events/board-meeting-schedules.html' }],
    annualHint: '毎年、翌年分の会合日程を媒体発表で公表（例: 2025年に2026年分）。2027年分は2026年内公表予定',
  },
  {
    id: 'census', name: '米国勢調査局（Census Bureau）',
    targets: [
      { label: 'pfei_2026_pdf', url: 'https://www.census.gov/economic-indicators/econcards/assets/pdf/censusreleaseglance_2026.pdf' },
      { label: 'calendar_listview', url: 'https://www.census.gov/economic-indicators/calendar-listview.html' },
      { label: 'indicators_rss', url: 'https://www.census.gov/economic-indicators/econcards/assets/xml/indicator.xml' },
    ],
    annualHint: '政府横断PFEIスケジュール（CPI/PPI/GDP/小売/貿易収支等を含む）が毎年9月頃に翌年分公表。ただしJOLTS非収録の可能性。calendar-listview.htmlにRSSリンクを発見したため追加検証',
  },
  {
    id: 'ons', name: '英国家統計局（ONS）',
    targets: [{ label: 'releases_api_upcoming_gdp', url: 'https://api.beta.ons.gov.uk/v1/search/releases?release-type=type-upcoming&query=GDP' }],
    annualHint: '構造化API（api.beta.ons.gov.uk）が存在。英国統計実施規範により12ヶ月ローリング事前公表＋4週間前確定が原則',
  },
  {
    id: 'statsnz', name: 'ニュージーランド統計局（Stats NZ）',
    targets: [{ label: 'release_calendar', url: 'https://www.stats.govt.nz/release-calendar/' }],
    annualHint: '長期リリース計画ページの存在は確認。事前公表期間（月数）は未確定',
  },
  {
    id: 'statcan', name: 'カナダ統計局（Statistics Canada）',
    targets: [
      { label: 'annual_schedule_pdf', url: 'https://www150.statcan.gc.ca/n1/release-diffusion/2026-eng.pdf' },
      { label: 'release_schedule_html', url: 'https://www150.statcan.gc.ca/n1/dai-quo/cal1-eng.htm' },
    ],
    annualHint: '「2026-2027 release dates」PDFで15ヶ月超先までの主要統計日程を毎年公表。Statistics Canada Open Licenceで自動取得に肯定的',
  },
  {
    id: 'abs', name: '豪州統計局（ABS）',
    targets: [{ label: 'future_releases_calendar', url: 'https://www.abs.gov.au/release-calendar/future-releases-calendar' }],
    annualHint: '公表ホライズンは向こう6ヶ月分のみとの調査結果（年次config化には不十分な可能性・要再確認）。CC BY 4.0ライセンス',
  },
  {
    id: 'ism', name: 'ISM',
    targets: [
      { label: 'rob_report_calendar', url: 'https://www.ismworld.org/supply-management-news-and-reports/reports/rob-report-calendar/' },
      { label: 'mfg_pmi_evergreen', url: 'https://www.ismworld.org/supply-management-news-and-reports/reports/ism-pmi-reports/pmi/' },
    ],
    annualHint: '製造業=毎月第1営業日、非製造業=第3営業日・米東部時間10:00が既定則（祝日ずれのみカレンダー確認要）。構造化フィードなし',
  },
  {
    id: 'boj', name: '日本銀行（BOJ）',
    targets: [
      { label: 'mpm_2026_schedule_pdf', url: 'https://www.boj.or.jp/en/mopo/mpmsche_minu/m_ref/mref250731a.pdf' },
      { label: 'mpm_index', url: 'https://www.boj.or.jp/en/mopo/mpmsche_minu/index.htm' },
    ],
    annualHint: '毎年7月31日に翌年8回の会合日程をPDF公表。主な意見=会合後6営業日目08:50、議事要旨=次回会合後3営業日目08:50',
  },
];

async function fetchOne(url, referer) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: '*/*', ...(referer ? { Referer: referer } : {}) },
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

// 簡易robots.txtパーサ: '*' UA向けのDisallowプレフィックス一覧を返す
function parseRobots(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const groups = []; // [{ agents: [...], disallow: [...] }]
  let current = null;
  for (const raw of lines) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, val] = m;
    const k = key.toLowerCase();
    if (k === 'user-agent') {
      if (!current || current.disallow.length || current.allow.length) {
        current = { agents: [val], disallow: [], allow: [] };
        groups.push(current);
      } else {
        current.agents.push(val);
      }
    } else if (k === 'disallow' && current) {
      if (val) current.disallow.push(val);
    } else if (k === 'allow' && current) {
      if (val) current.allow.push(val);
    }
  }
  return groups;
}

function isDisallowed(groups, pathname) {
  const applicable = groups.filter((g) => g.agents.some((a) => a === '*'));
  const disallow = applicable.flatMap((g) => g.disallow);
  const allow = applicable.flatMap((g) => g.allow);
  const hit = (prefix) => pathname.startsWith(prefix);
  const disallowedBy = disallow.filter(hit).sort((a, b) => b.length - a.length)[0];
  const allowedBy = allow.filter(hit).sort((a, b) => b.length - a.length)[0];
  if (!disallowedBy) return { disallowed: false };
  if (allowedBy && allowedBy.length >= disallowedBy.length) return { disallowed: false };
  return { disallowed: true, rule: disallowedBy };
}

// ホスト単位でrobots.txtを取得・キャッシュする（同一ソース内で複数ホストにまたがる対象URLに対応）。
// HTTP 404は「robots.txtが存在しない＝制限なし」を意味する標準解釈のため許可扱いにする。
// それ以外の失敗（403・ネットワークエラー等）は、実ページへの自動アクセスをブロックせず
// 慎重側に倒してSKIPし、手動確認が必要と記録する。
const robotsCache = new Map();
async function getRobotsForHost(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  const robotsUrl = `${origin}/robots.txt`;
  const res = await fetchOne(robotsUrl);
  await sleep(WAIT_MS);
  let result;
  if (res?.ok) {
    const text = res.buf.toString('utf8');
    const groups = parseRobots(text);
    log(`[robots] ${robotsUrl} -> HTTP ${res.status}, ${groups.length} user-agent group(s)`);
    log(text.slice(0, 1500));
    writeFileSync(join(OUT_DIR, `robots_${origin.replace(/^https?:\/\//, '').replace(/[/:]/g, '_')}.txt`), text);
    result = { ok: true, status: res.status, groups, raw: text.slice(0, 3000) };
  } else if (res?.status === 404) {
    log(`[robots] ${robotsUrl} -> HTTP 404（robots.txt不存在＝制限なしとして扱う）`);
    result = { ok: true, status: 404, groups: [], raw: null, note: 'no robots.txt file = unrestricted by convention' };
  } else {
    log(`[robots-ERR] ${robotsUrl}: ${res?.error || res?.status}。慎重側に倒し、このホストの対象パスは手動確認要としてSKIP`);
    result = { ok: false, error: res?.error || `HTTP ${res?.status}` };
  }
  robotsCache.set(origin, result);
  return result;
}

(async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  section(`phase1 source-recon start ${nowIso()}`);
  const report = { startedAt: nowIso(), sources: [] };

  const targetSources = ONLY_IDS.length ? SOURCES.filter((s) => ONLY_IDS.includes(s.id)) : SOURCES;
  if (ONLY_IDS.length) log(`(絞り込み実行: ${ONLY_IDS.join(', ')})`);
  for (const src of targetSources) {
    section(`SOURCE: ${src.id} (${src.name})`);
    const entry = { id: src.id, name: src.name, annualHint: src.annualHint, targets: [] };

    for (const t of src.targets) {
      const u = new URL(t.url);
      const robots = await getRobotsForHost(u.origin);
      if (!robots.ok) {
        entry.targets.push({ label: t.label, url: t.url, fetched: false, reason: `robots.txt取得失敗（${robots.error}）のため未実施・要手動確認` });
        continue;
      }
      const verdict = isDisallowed(robots.groups, u.pathname);
      if (verdict.disallowed) {
        log(`[SKIP-DISALLOWED] ${t.label}: ${t.url} — robots.txt Disallow: ${verdict.rule}`);
        entry.targets.push({ label: t.label, url: t.url, fetched: false, reason: `robots disallow: ${verdict.rule}（代替経路の検討要）` });
        continue;
      }
      const res = await fetchOne(t.url, `${u.origin}/`);
      await sleep(WAIT_MS);
      if (res?.ok) {
        const isText = /text|json|xml|html|calendar/i.test(res.contentType || '');
        const filePath = join(OUT_DIR, `${src.id}.${t.label}${guessExt(res.contentType, t.url)}`);
        writeFileSync(filePath, res.buf);
        log(`[FETCH] ${t.label}: HTTP ${res.status} ${res.bytes}B ${res.ms}ms ct=${res.contentType} final=${res.finalUrl}`);
        if (isText) {
          const preview = res.buf.toString('utf8').slice(0, 1500).replace(/\s+/g, ' ');
          log(`  preview: ${preview}`);
        } else {
          log(`  (非テキスト content-type。サイズ・到達性のみ確認。詳細解析はPDFパーサ導入後に実施)`);
        }
        entry.targets.push({
          label: t.label, url: t.url, fetched: true, status: res.status, bytes: res.bytes,
          contentType: res.contentType, sha256: res.sha256, savedAs: filePath, finalUrl: res.finalUrl,
        });
        verifyNamesAgainst(src.id, t.label, res.buf, res.contentType);
      } else {
        log(`[FETCH-ERR] ${t.label}: ${res?.error || res?.status}`);
        entry.targets.push({ label: t.label, url: t.url, fetched: false, reason: res?.error || `HTTP ${res?.status}` });
      }
    }
    report.sources.push(entry);
  }

  writeFileSync(join(OUT_DIR, 'recon-report.json'), JSON.stringify(report, null, 2));
  section('SUMMARY');
  for (const s of report.sources) {
    const okCount = s.targets.filter((t) => t.fetched).length;
    log(`${s.id}: fetched=${okCount}/${s.targets.length}`);
  }
  section(`phase1 source-recon end ${nowIso()}`);
})();

// event-names.json の source_verified:false 項目（優先度A関連分）の実データ照合用。
// 取得したテキスト系コンテンツ内に検索語が出現するか確認し、周辺文脈をログへ出す
// （artifactダウンロードが環境上できないため、Actionsログに直接出力する方式とした）。
const NAME_VERIFICATION_TERMS = [
  { key: 'US employment_indicator: JOLTS', terms: ['JOLTS', 'Job Openings'] },
  { key: 'US pmi_ism: ISM Services', terms: ['ISM Services', 'ISM Non-Manufacturing', 'Services PMI'] },
  { key: 'US trade_balance', terms: ['Trade Balance', 'International Trade'] },
  { key: 'CA trade_balance', terms: ['Merchandise Trade', 'International Trade', 'Trade Balance'] },
  { key: 'AU trade_balance', terms: ['Trade Balance', 'International Trade'] },
  { key: 'NZ employment_situation', terms: ['Labour market statistics', 'Household Labour Force', 'Employment Change', 'Unemployment'] },
  { key: 'CA employment_situation', terms: ['Labour Force Survey', 'Employment Change', 'Unemployment'] },
];

function verifyNamesAgainst(sourceId, label, buf, contentType) {
  if (!/text|html|xml|json/i.test(contentType || '')) return;
  const text = buf.toString('utf8');
  for (const item of NAME_VERIFICATION_TERMS) {
    for (const term of item.terms) {
      const idx = text.toLowerCase().indexOf(term.toLowerCase());
      if (idx >= 0) {
        const ctx = text.slice(Math.max(0, idx - 60), idx + term.length + 100).replace(/\s+/g, ' ');
        log(`  [NAME-VERIFY] ${item.key} matched "${term}" in ${sourceId}.${label}: >>> ${ctx} <<<`);
      }
    }
  }
}

function guessExt(contentType, url) {
  if (/pdf/i.test(contentType || '')) return '.pdf';
  if (/json/i.test(contentType || '')) return '.json';
  if (/calendar/i.test(contentType || '')) return '.ics';
  if (/html/i.test(contentType || '')) return '.html';
  const m = url.match(/\.[a-z0-9]{2,5}$/i);
  return m ? m[0] : '.bin';
}
